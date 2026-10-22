import { createHmac } from 'crypto';
import { createBotHandler, type BotDeps } from '../../src/bots/handler';
import type { Client } from '../../src/bots/commands';

const NOW = 1_800_000_000_000;
const ts = String(NOW / 1000);
const hmac = (s: string, m: string) => createHmac('sha256', s).update(m).digest('hex');

const mkClient = () => {
  const calls: string[] = [];
  const c: Client = {
    next: async () => { calls.push('next'); return { ref: 'a:1', text: 'Do it', project: 'a' }; },
    add: async (p, t) => { calls.push(`add ${p} ${t}`); return { ref: 'a:2' }; },
    start: async () => { calls.push('start'); return { ref: 'a:1' }; },
    complete: async () => { calls.push('complete'); return { ref: 'a:1' }; },
    skip: async () => { calls.push('skip'); return { ref: 'a:1' }; },
  };
  return { c, calls };
};
const mk = (over: Partial<BotDeps> = {}) => {
  const { c, calls } = mkClient();
  const errs: string[] = [];
  const h = createBotHandler({
    client: c, now: () => NOW, onError: (n) => errs.push(n),
    slack: { signingSecret: 'sl', allow: ['U1'] },
    imessage: { secret: 'im', allow: ['+15551234567'] },
    webhook: { secret: 'wh', allow: ['Ci-Bot'] },
    github: { secret: 'gh', allow: ['octo'] },
    ...over,
  });
  return { h, calls, errs };
};
const send = async (h: ReturnType<typeof mk>['h'], path: string, body: string, headers: Record<string, string>, method = 'POST') => {
  const r = await h(new Request(`https://x.test${path}`, { method, body: method === 'GET' ? undefined : body, headers }));
  const text = await r.text();
  return { status: r.status, text, json: text ? JSON.parse(text) : undefined };
};
const slack = (body: string, o: { secret?: string; t?: string; type?: string } = {}) => ({
  'content-type': o.type ?? 'application/x-www-form-urlencoded',
  'x-slack-request-timestamp': o.t ?? ts,
  'x-slack-signature': `v0=${hmac(o.secret ?? 'sl', `v0:${o.t ?? ts}:${body}`)}`,
});
const wh = (path: string, body: string, secret: string, o: { t?: string; type?: string } = {}) => ({
  'content-type': o.type ?? 'application/json', 'x-stack-timestamp': o.t ?? ts,
  'x-stack-signature': `sha256=${hmac(secret, `${o.t ?? ts}.${body}`)}`,
});
const gh = (body: string, event = 'issue_comment', secret = 'gh') => ({
  'content-type': 'application/json', 'x-github-event': event, 'x-hub-signature-256': `sha256=${hmac(secret, body)}`,
});

// @req FR:chat-bots/slack.command @req FR:chat-bots/router.@function
describe('slack', () => {
  const body = 'user_id=U1&text=what%27s+next&command=%2Fstack';
  it('answers a signed command from an allowed user', async () => {
    const { h, calls } = mk();
    const r = await send(h, '/bots/slack', body, slack(body));
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ response_type: 'ephemeral', text: 'Next: Do it (a) [a:1]' });
    expect(calls).toEqual(['next']);
  });
  // @req FR:chat-bots/allow.deny @req FR:chat-bots/allow.order
  it('denies unlisted user before any call', async () => {
    const { h, calls } = mk();
    const b = 'user_id=U9&text=next';
    const r = await send(h, '/bots/slack', b, slack(b));
    expect(r.status).toBe(403);
    expect(calls).toEqual([]);
  });
  it('denies everyone with empty or missing allow-list', async () => {
    for (const s of [{ signingSecret: 'sl', allow: [] }, { signingSecret: 'sl' }] as never[]) {
      const { h, calls } = mk({ slack: s });
      expect((await send(h, '/bots/slack', body, slack(body))).status).toBe(403);
      expect(calls).toEqual([]);
    }
  });
  // @req FR:chat-bots/sig.order @req FR:chat-bots/router.errors
  it('401 on bad signature, stale timestamp, missing headers; same message', async () => {
    const { h, calls } = mk();
    const a = await send(h, '/bots/slack', body, slack(body, { secret: 'bad' }));
    const b = await send(h, '/bots/slack', body, slack(body, { t: String(NOW / 1000 - 1000) }));
    const c = await send(h, '/bots/slack', body, { 'content-type': 'application/x-www-form-urlencoded' });
    for (const r of [a, b, c]) expect(r.status).toBe(401);
    expect(a.text).toBe(b.text);
    expect(a.text).toBe(c.text);
    expect(calls).toEqual([]);
  });
  it('401 when secret unconfigured is 404 (channel off)', async () => {
    const { h } = mk({ slack: undefined });
    expect((await send(h, '/bots/slack', body, slack(body))).status).toBe(404);
  });
  it('rejects malformed form: missing user or text, duplicate fields', async () => {
    const { h } = mk();
    for (const b of ['text=next', 'user_id=U1', 'user_id=U1&user_id=U2&text=next']) {
      expect((await send(h, '/bots/slack', b, slack(b))).status).toBe(400);
    }
  });
  // @req FR:chat-bots/slack.challenge
  it('answers url_verification only when signed', async () => {
    const { h } = mk();
    const b = JSON.stringify({ type: 'url_verification', challenge: 'abc' });
    const ok = await send(h, '/bots/slack', b, slack(b, { type: 'application/json' }));
    expect(ok.status).toBe(200);
    expect(ok.json).toEqual({ challenge: 'abc' });
    const bad = await send(h, '/bots/slack', b, slack(b, { type: 'application/json', secret: 'x' }));
    expect(bad.status).toBe(401);
  });
});

// @req FR:chat-bots/webhook.contract @req FR:chat-bots/webhook.imessage
describe('webhook and imessage', () => {
  it('webhook returns reply; sender match is case-insensitive', async () => {
    const { h, calls } = mk();
    const b = JSON.stringify({ sender: 'ci-bot', text: 'add alpha Ship it' });
    const r = await send(h, '/bots/webhook', b, wh('/bots/webhook', b, 'wh'));
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ reply: 'Added a:2' });
    expect(calls).toEqual(['add alpha Ship it']);
  });
  it('imessage uses its own secret and allow-list, accepts guid', async () => {
    const { h } = mk();
    const b = JSON.stringify({ sender: '+15551234567', text: 'next', guid: 'G-1' });
    expect((await send(h, '/bots/imessage', b, wh('', b, 'im'))).json).toEqual({ reply: 'Next: Do it (a) [a:1]' });
    // webhook secret does not work on imessage
    expect((await send(h, '/bots/imessage', b, wh('', b, 'wh'))).status).toBe(401);
    const other = JSON.stringify({ sender: 'Ci-Bot', text: 'next' });
    expect((await send(h, '/bots/imessage', other, wh('', other, 'im'))).status).toBe(403);
  });
  // @req FR:chat-bots/webhook.shape
  it('rejects bad shape, content type, size', async () => {
    const { h } = mk();
    const t = async (b: string, type = 'application/json') => (await send(h, '/bots/webhook', b, wh('', b, 'wh', { type }))).status;
    expect(await t('not json')).toBe(400);
    expect(await t('[]')).toBe(400);
    expect(await t(JSON.stringify({ sender: 'Ci-Bot', text: 5 }))).toBe(400);
    expect(await t(JSON.stringify({ sender: 'Ci-Bot', text: 'next', extra: 1 }))).toBe(400);
    expect(await t(JSON.stringify({ sender: 'Ci-Bot', text: 'next' }), 'text/plain')).toBe(415);
    expect(await t(JSON.stringify({ sender: 'Ci-Bot', text: 'x'.repeat(70_000) }))).toBe(413);
  });
  it('413 even without content-length', async () => {
    const { h } = mk();
    const big = 'x'.repeat(70_000);
    const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(big)); c.close(); } });
    const r = await h(new Request('https://x.test/bots/webhook', { method: 'POST', body: stream, duplex: 'half', headers: wh('', big, 'wh') } as RequestInit));
    expect(r.status).toBe(413);
  });
  it('replay window is configurable', async () => {
    const { h } = mk({ replayWindowSeconds: 10 });
    const b = JSON.stringify({ sender: 'Ci-Bot', text: 'next' });
    const t = String(NOW / 1000 - 11);
    expect((await send(h, '/bots/webhook', b, wh('', b, 'wh', { t }))).status).toBe(401);
  });
});

// @req FR:chat-bots/github.event
describe('github', () => {
  const ev = (o: object = {}) => JSON.stringify({ action: 'created', comment: { body: '/stack next' }, sender: { login: 'octo' }, ...o });
  // @req FR:chat-bots/github.deliver
  it('runs /stack comments from allowed logins', async () => {
    const { h, calls } = mk();
    const b = ev();
    const r = await send(h, '/bots/github', b, gh(b));
    expect(r.json).toEqual({ reply: 'Next: Do it (a) [a:1]' });
    expect(calls).toEqual(['next']);
  });
  it('ignores other events/actions/comments, answers ping', async () => {
    const { h, calls } = mk();
    for (const b of [ev({ comment: { body: 'hello' } }), ev({ action: 'edited' }), ev({ comment: { body: '/stacks next' } })]) {
      expect((await send(h, '/bots/github', b, gh(b))).json).toEqual({ ignored: true });
    }
    const p = ev();
    expect((await send(h, '/bots/github', p, gh(p, 'push'))).json).toEqual({ ignored: true });
    expect((await send(h, '/bots/github', '{}', gh('{}', 'ping'))).json).toEqual({ pong: true });
    expect(calls).toEqual([]);
  });
  it('401 for bad signature, 403 for unlisted sender (ignored events from unlisted still need signature)', async () => {
    const { h, calls } = mk();
    const b = ev();
    expect((await send(h, '/bots/github', b, gh(b, 'issue_comment', 'bad'))).status).toBe(401);
    const o = ev({ sender: { login: 'evil' } });
    expect((await send(h, '/bots/github', o, gh(o))).status).toBe(403);
    expect(calls).toEqual([]);
  });
  it('rejects malformed payloads', async () => {
    const { h } = mk();
    for (const b of ['nope', '[]', ev({ sender: {} }), ev({ comment: null })]) {
      expect((await send(h, '/bots/github', b, gh(b))).status).toBe(400);
    }
  });
});

// @req FR:chat-bots/router.errors @req FR:chat-bots/router.nolog
describe('routing and errors', () => {
  it('404 unknown path, 405 wrong method with Allow-free fixed body', async () => {
    const { h } = mk();
    expect((await send(h, '/other', '', {})).status).toBe(404);
    expect((await send(h, '/bots/nope', '', {})).status).toBe(404);
    const g = await send(h, '/bots/slack', '', {}, 'GET');
    expect(g.status).toBe(405);
    expect(g.json.error.code).toBe('method_not_allowed');
  });
  it('custom basePath', async () => {
    const { h } = mk({ basePath: '/x/b' });
    const b = JSON.stringify({ sender: 'Ci-Bot', text: 'next' });
    expect((await send(h, '/x/b/webhook', b, wh('', b, 'wh'))).status).toBe(200);
    expect((await send(h, '/bots/webhook', b, wh('', b, 'wh'))).status).toBe(404);
  });
  it('client throw is 500 internal with fixed text; onError gets class name only', async () => {
    const { c } = mkClient();
    const errs: string[] = [];
    class Boom extends Error {}
    const h = createBotHandler({
      client: { ...c, next: async () => { throw new Boom('SECRET task text +1555'); } }, now: () => NOW, onError: (n) => errs.push(n),
      webhook: { secret: 'wh', allow: ['Ci-Bot'] },
    });
    const ok = JSON.stringify({ sender: 'Ci-Bot', text: 'next' });
    const r = await send(h, '/bots/webhook', ok, wh('', ok, 'wh'));
    expect(r.status).toBe(200);
    expect(r.json.reply).toBe('Failed');
    expect(errs).toEqual(['Boom']);
    expect(JSON.stringify(errs)).not.toMatch(/SECRET/);
  });
  it('never logs message data (console spy)', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => jest.spyOn(console, m).mockImplementation(() => undefined));
    const { h } = mk();
    const b = JSON.stringify({ sender: 'Ci-Bot', text: 'add alpha SECRETTASK' });
    await send(h, '/bots/webhook', b, wh('', b, 'wh'));
    await send(h, '/bots/webhook', b, wh('', b, 'bad'));
    spies.forEach((s) => { expect(s).not.toHaveBeenCalled(); s.mockRestore(); });
  });
  it('error responses are JSON with fixed shape', async () => {
    const { h } = mk();
    const r = await send(h, '/bots/webhook', '{}', {});
    expect(r.status).toBe(401);
    expect(r.json).toEqual({ error: { code: 'unauthorized', message: 'Unauthorized' } });
  });
});

// @req FR:chat-bots/sig.order
describe('non-UTF-8 body', () => {
  it('signed over raw bytes is rejected (fails closed, 401)', async () => {
    const { h, calls } = mk();
    const raw = Buffer.concat([Buffer.from('{"a":"'), Buffer.from([0xff, 0xfe]), Buffer.from('"}')]);
    const sig = createHmac('sha256', 'gh').update(raw).digest('hex');
    const r = await h(new Request('https://x.test/bots/github', {
      method: 'POST', body: raw,
      headers: { 'content-type': 'application/json', 'x-github-event': 'issue_comment', 'x-hub-signature-256': `sha256=${sig}` },
    }));
    expect(r.status).toBe(401);
    expect(calls).toEqual([]);
  });
});
