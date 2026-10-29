/**
 * Graph request allowlist: the only door to the mailbox. Anything not listed throws before the network is touched.
 * @req FR:email-triage/safe.allowlist @req FR:email-triage/safe.scopes
 */

export const GRAPH_BASE = 'https://graph.microsoft.com/v1.0';

export type WriteMode = 'observe' | 'categories' | 'drafts';

/** Delegated scopes per mode. Read-only until the owner opts in; the send scope is never requested. @req FR:email-triage/safe.scopes */
export const SCOPES: Record<WriteMode, readonly string[]> = {
  observe: ['Mail.Read', 'offline_access'],
  categories: ['Mail.ReadWrite', 'offline_access'],
  drafts: ['Mail.ReadWrite', 'offline_access'],
};
export const scopesFor = (mode: WriteMode): string[] => [...SCOPES[mode]];

export interface GraphRequest { method: string; url: string; body?: unknown }
/** Performs the request; injected so the guard can sit in front of any HTTP client. */
export type Transport<T = unknown> = (req: GraphRequest) => Promise<T>;
export interface GraphGuard {
  /** Throws `GraphDenied` unless the request is allowlisted. */
  check(req: GraphRequest): void;
  /** Checks, then hands the request to the transport. */
  call<T>(req: GraphRequest, transport: Transport<T>): Promise<T>;
}

export class GraphDenied extends Error {
  constructor(readonly method: string, readonly url: string, readonly why: string) {
    super(`Graph request denied (${why}): ${method} ${url}`);
    this.name = 'GraphDenied';
  }
}

/** Always denied, in any mode, even if the allowlist widens later. Matched against whole lower-case path segments. */
export const DENY = ['send', 'sendmail', 'forward', 'reply', 'replyall', 'move', 'copy'] as const;

const ID = '[A-Za-z0-9_=-]{1,512}';
const QUERY = new Set(['$select', '$top', '$filter', '$orderby', '$skiptoken', '$deltatoken']);
const re = (s: string) => new RegExp(`^${s}$`);
// Graph's own next and delta links spell it `mailfolders`.
const FOLDER_MESSAGES = re(`/me/mail[Ff]olders/${ID}/messages(/delta)?`);
const MESSAGE = re(`/me/messages/${ID}`);
const CREATE_REPLY = re(`/me/messages/${ID}/createReply`);
const MOVE = re(`/me/messages/(${ID})/move`);
/** The only folders an approved move may target; both are reversible in Outlook. @req FR:email-inbox-zero/gate.guard */
export const MOVE_TARGETS = ['archive', 'junkemail'] as const;
const hasOnly = (body: unknown, key: string) => !!body && typeof body === 'object' && !Array.isArray(body) && Object.keys(body).length === 1 && key in body;

/** `createGraphGuard()` allows reads, reply drafts and category tags; `mode` narrows it. @req FR:email-triage/safe.allowlist */
export function createGraphGuard(opts: { mode?: WriteMode; approvedMoves?: ReadonlySet<string> } = {}): GraphGuard {
  const mode = opts.mode ?? 'drafts';
  const deny = (req: GraphRequest, why: string): never => { throw new GraphDenied(String(req.method), String(req.url), why); };

  function check(req: GraphRequest): void {
    if (!req || typeof req.url !== 'string' || typeof req.method !== 'string') return deny(req ?? ({} as GraphRequest), 'malformed');
    const method = req.method.toUpperCase();
    if (method === 'DELETE') return deny(req, 'DELETE');
    if (!req.url.startsWith(`${GRAPH_BASE}/`)) return deny(req, 'not the Graph v1.0 endpoint');
    let u: URL;
    try { u = new URL(req.url); } catch { return deny(req, 'bad url'); }
    if (u.origin !== 'https://graph.microsoft.com' || u.username || u.password || u.hash) return deny(req, 'bad url');
    const rel = u.pathname.slice('/v1.0'.length);
    let segs: string[];
    try { segs = rel.split('/').slice(1).map(decodeURIComponent); } catch { return deny(req, 'bad path encoding'); }
    if (segs.some((s) => s === '' || s === '.' || s === '..' || /[/\\?#]/.test(s) || [...s].some((c) => c.charCodeAt(0) < 32))) return deny(req, 'bad path');
    // Defense in depth: a segment naming a denied verb (or its `create` form, bar the allowlisted createReply) is refused before the allowlist is consulted.
    const path = `/${segs.join('/')}`;
    // The one exception to the denied verbs: moving a message the owner approved in an answered ask, to Archive or Junk only. @req FR:email-inbox-zero/gate.guard
    const mv = MOVE.exec(path);
    if (method === 'POST' && mv && mode === 'drafts' && opts.approvedMoves?.has(mv[1]) && hasOnly(req.body, 'destinationId') && (MOVE_TARGETS as readonly string[]).includes((req.body as { destinationId: unknown }).destinationId as string) && ![...u.searchParams.keys()].length) return;
    if (segs.some((s) => DENY.some((d) => s.toLowerCase() === d || (s.toLowerCase() === `create${d}` && d !== 'reply')))) return deny(req, 'denied verb');
    for (const k of u.searchParams.keys()) if (!QUERY.has(k)) return deny(req, `query ${k}`);

    if (method === 'GET' && (FOLDER_MESSAGES.test(path) || MESSAGE.test(path))) return;
    if (method === 'POST' && CREATE_REPLY.test(path)) {
      if (mode !== 'drafts') return deny(req, `createReply needs drafts mode (mode is ${mode})`);
      if (!hasOnly(req.body, 'comment') || typeof (req.body as { comment: unknown }).comment !== 'string') return deny(req, 'createReply body is the comment only');
      return;
    }
    if (method === 'PATCH' && MESSAGE.test(path)) {
      if (mode === 'observe') return deny(req, 'observe mode is read-only');
      const c = hasOnly(req.body, 'categories') ? (req.body as { categories: unknown }).categories : null;
      if (!Array.isArray(c) || !c.every((x) => typeof x === 'string')) return deny(req, 'PATCH is limited to categories');
      return;
    }
    return deny(req, 'not allowlisted');
  }

  return { check, async call<T>(req: GraphRequest, transport: Transport<T>) { check(req); return transport(req); } };
}
