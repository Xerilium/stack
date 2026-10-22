/**
 * Channel adapters: Slack, iMessage bridge, generic webhook, GitHub. Pure (Request) -> Response.
 * Order per request: route -> capped raw body -> signature -> parse -> allow-list -> command.
 * @req FR:chat-bots/router.@function
 */
import { parseCommand, runCommand, type Client } from './commands';
import { DEFAULT_REPLAY_SECONDS, verifyGithub, verifySlack, verifyWebhook } from './verify';

export interface ChannelAllow { allow?: readonly string[] }
export interface BotDeps {
  client: Client;
  slack?: { signingSecret: string } & ChannelAllow;
  imessage?: { secret: string } & ChannelAllow;
  webhook?: { secret: string } & ChannelAllow;
  github?: { secret: string } & ChannelAllow;
  basePath?: string;
  now?: () => number;
  replayWindowSeconds?: number;
  /** Receives the error class name only; never message or task data. */
  onError?: (name: string) => void;
}

const MAX_BODY = 64 * 1024;
const STATUS: Record<string, number> = {
  bad_request: 400, unauthorized: 401, forbidden: 403, not_found: 404, method_not_allowed: 405,
  payload_too_large: 413, unsupported_media_type: 415, internal: 500,
};
const MESSAGE: Record<string, string> = {
  bad_request: 'Bad request', unauthorized: 'Unauthorized', forbidden: 'Forbidden', not_found: 'Not found',
  method_not_allowed: 'Method not allowed', payload_too_large: 'Payload too large', unsupported_media_type: 'Unsupported media type',
  internal: 'Internal error',
};

class BotError extends Error {
  constructor(readonly code: keyof typeof STATUS) { super(code); }
}
const ok = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
const fail = (code: string, extra: Record<string, string> = {}) => new Response(
  JSON.stringify({ error: { code, message: MESSAGE[code] } }),
  { status: STATUS[code], headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra } });

/** Stream-capped raw body read (no unbounded buffering, with or without content-length). */
async function readRaw(req: Request): Promise<string> {
  const declared = Number(req.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY) throw new BotError('payload_too_large');
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) { await reader.cancel(); throw new BotError('payload_too_large'); }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

const norm = (s: string) => s.trim().toLowerCase();
/** @req FR:chat-bots/allow.deny */
const allowed = (list: readonly string[] | undefined, sender: unknown): boolean =>
  Array.isArray(list) && typeof sender === 'string' && sender.trim() !== '' && list.some((a) => typeof a === 'string' && norm(a) === norm(sender));

const ctype = (req: Request) => (req.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
function parseJson(raw: string): Record<string, unknown> {
  let v: unknown;
  try { v = JSON.parse(raw); } catch { throw new BotError('bad_request'); }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new BotError('bad_request');
  return v as Record<string, unknown>;
}

export function createBotHandler(deps: BotDeps): (req: Request) => Promise<Response> {
  const base = (deps.basePath ?? '/bots').replace(/\/+$/, '');
  const now = deps.now ?? Date.now;
  const win = deps.replayWindowSeconds ?? DEFAULT_REPLAY_SECONDS;
  const reply = (client: Client, text: string) => runCommand(client, parseCommand(text), deps.onError);

  /** @req FR:chat-bots/webhook.contract @req FR:chat-bots/webhook.imessage @req FR:chat-bots/webhook.shape */
  async function signedJson(req: Request, cfg: { secret: string } & ChannelAllow): Promise<Response> {
    const raw = await readRaw(req);
    if (!verifyWebhook(cfg.secret, raw, req.headers.get('x-stack-timestamp'), req.headers.get('x-stack-signature'), now(), win)) throw new BotError('unauthorized');
    if (ctype(req) !== 'application/json') throw new BotError('unsupported_media_type');
    const b = parseJson(raw);
    const keys = Object.keys(b);
    const optional = typeof b.guid === 'string' || b.guid === undefined;
    if (typeof b.sender !== 'string' || typeof b.text !== 'string' || !optional || keys.some((k) => !['sender', 'text', 'guid'].includes(k))) throw new BotError('bad_request');
    if (!allowed(cfg.allow, b.sender)) throw new BotError('forbidden');
    return ok({ reply: await reply(deps.client, b.text) });
  }

  /** @req FR:chat-bots/slack.command @req FR:chat-bots/slack.challenge */
  async function slack(req: Request, cfg: NonNullable<BotDeps['slack']>): Promise<Response> {
    const raw = await readRaw(req);
    if (!verifySlack(cfg.signingSecret, raw, req.headers.get('x-slack-request-timestamp'), req.headers.get('x-slack-signature'), now(), win)) throw new BotError('unauthorized');
    if (ctype(req) === 'application/json') {
      const b = parseJson(raw);
      if (b.type === 'url_verification' && typeof b.challenge === 'string') return ok({ challenge: b.challenge });
      throw new BotError('bad_request');
    }
    if (ctype(req) !== 'application/x-www-form-urlencoded') throw new BotError('unsupported_media_type');
    const p = new URLSearchParams(raw);
    if (p.getAll('user_id').length !== 1 || p.getAll('text').length !== 1) throw new BotError('bad_request');
    if (!allowed(cfg.allow, p.get('user_id'))) throw new BotError('forbidden');
    return ok({ response_type: 'ephemeral', text: await reply(deps.client, p.get('text')!) });
  }

  /** @req FR:chat-bots/github.event @req FR:chat-bots/github.deliver */
  async function github(req: Request, cfg: NonNullable<BotDeps['github']>): Promise<Response> {
    const raw = await readRaw(req);
    if (!verifyGithub(cfg.secret, raw, req.headers.get('x-hub-signature-256'))) throw new BotError('unauthorized');
    const event = req.headers.get('x-github-event');
    const b = parseJson(raw);
    if (event === 'ping') return ok({ pong: true });
    if (event !== 'issue_comment' || b.action !== 'created') return ok({ ignored: true });
    const login = (b.sender as { login?: unknown } | null)?.login;
    const body = (b.comment as { body?: unknown } | null)?.body;
    if (typeof login !== 'string' || typeof body !== 'string') throw new BotError('bad_request');
    const m = /^\/stack\s+([\s\S]*)$/.exec(body.trim());
    if (!m) return ok({ ignored: true });
    if (!allowed(cfg.allow, login)) throw new BotError('forbidden');
    return ok({ reply: await reply(deps.client, m[1]) });
  }

  return async (req) => {
    try {
      const path = new URL(req.url).pathname;
      if (!path.startsWith(`${base}/`)) throw new BotError('not_found');
      const channel = path.slice(base.length + 1);
      const cfg = ({ slack: deps.slack, imessage: deps.imessage, webhook: deps.webhook, github: deps.github } as Record<string, unknown>)[channel];
      if (!cfg || !["slack", "imessage", "webhook", "github"].includes(channel)) throw new BotError('not_found');
      if (req.method.toUpperCase() !== 'POST') return fail('method_not_allowed', { allow: 'POST' });
      switch (channel) {
        case 'slack': return await slack(req, cfg as NonNullable<BotDeps['slack']>);
        case 'github': return await github(req, cfg as NonNullable<BotDeps['github']>);
        default: return await signedJson(req, cfg as { secret: string } & ChannelAllow);
      }
    } catch (e) {
      if (e instanceof BotError) return fail(e.code);
      deps.onError?.(e instanceof Error ? e.constructor.name : 'unknown');
      return fail('internal');
    }
  };
}
