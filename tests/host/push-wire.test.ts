import { setup, ENV } from './helpers';
import type { PushRequest } from '../../src/host/push-sender';
import { PushCheckTimeout, withPush } from '../../src/host/push';

// RFC 8291 example keys: a valid P-256 pair for VAPID and a valid subscription key.
const VAPID_ENV = {
  STACK_VAPID_PUBLIC_KEY: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  STACK_VAPID_PRIVATE_KEY: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  STACK_VAPID_SUBJECT: 'mailto:owner@example.test',
  STACK_PUSH_QUIET: 'off',
};
const SUB = { endpoint: 'https://web.push.apple.com/QGp1', keys: { p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', auth: 'BTBZMqHH6r4Tts7J_aSIgg' } };
const JSON_H = { 'content-type': 'application/json' };
const soon = () => new Date(Date.now() + 30 * 60_000).toISOString().replace(/\.\d{3}Z$/, 'Z');

async function paired(env: Record<string, string> = { ...ENV, ...VAPID_ENV }, status = 201) {
  const reqs: PushRequest[] = [];
  const s = await setup(env, { pushTransport: async (r) => { reqs.push(r); return { status }; } });
  const c = await s.owner('/api/auth/devices', { method: 'POST', headers: JSON_H, body: JSON.stringify({ name: 'iPhone' }) });
  const { token } = (await c.json()) as { token: string };
  const put = await s.req('/api/auth/devices/me/push', { method: 'PUT', headers: { ...JSON_H, authorization: `Bearer ${token}` }, body: JSON.stringify(SUB) });
  expect(put.status).toBe(200);
  const agent = await s.mint('tasks:write', 'tasks:read');
  const putAsk = (key: string, body: object) => s.req(`/api/asks/${key}`, { method: 'POST', headers: { ...JSON_H, authorization: `Bearer ${agent}` }, body: JSON.stringify(body) });
  const check = (tok = agent) => s.req('/api/push/check', { method: 'POST', headers: { ...JSON_H, authorization: `Bearer ${tok}` }, body: '{}' });
  return { ...s, reqs, putAsk, check, agent };
}

describe('host push wiring', () => {
  // @req FR:iphone-access/check.asks @req FR:iphone-access/check.read @req FR:iphone-access/notify.dedupe.store @req FR:iphone-access/send.private
  it('an ask write due within 1h pushes once; a later check skips it', async () => {
    const s = await paired();
    const w = await s.putAsk('deploy-ok', { ask: 'Approve deploy', kind: 'approve', by: soon() });
    expect(w.status).toBeLessThan(300);
    // The write starts the check in the background; this check queues behind it.
    const c = await s.check();
    expect(c.status).toBe(200);
    expect(await c.json()).toEqual({ sent: 0, removed: 0, failed: 0, skipped: 1 });
    expect(s.reqs[0].url).toBe(SUB.endpoint);
    expect(s.reqs[0].headers.authorization).toMatch(/^vapid t=/);
    expect(s.reqs).toHaveLength(1);
    const ledger = await s.storage.readAux('.stack/push-sent.json');
    expect(ledger?.content).toContain('deploy-ok');
    expect(ledger?.content).not.toContain('web.push.apple.com');
    const logs = s.logs.join('\n');
    for (const secret of [VAPID_ENV.STACK_VAPID_PRIVATE_KEY, 'web.push.apple.com', SUB.keys.auth, 'Approve deploy']) expect(logs).not.toContain(secret);
  });

  // @req FR:iphone-access/check.asks
  it('an ask with no near deadline pushes nothing', async () => {
    const s = await paired();
    await s.putAsk('later', { ask: 'Later', kind: 'approve', by: new Date(Date.now() + 5 * 3600_000).toISOString() });
    await s.putAsk('none', { ask: 'No deadline', kind: 'approve' });
    await s.check();
    expect(s.reqs).toHaveLength(0);
  });

  // @req FR:iphone-access/notify.prune @req FR:iphone-access/send.status
  it('a 410 from the push service removes the subscription', async () => {
    const s = await paired(undefined, 410);
    await s.putAsk('k', { ask: 'K', kind: 'approve', by: soon() });
    expect(await (await s.check()).json()).toEqual({ sent: 0, removed: 0, failed: 0, skipped: 0 });
    const file = await s.storage.readAux('.stack/devices.json');
    expect(file?.content).not.toContain('web.push.apple.com');
  });

  // @req FR:iphone-access/check.@http
  it('check needs tasks:write or an owner session', async () => {
    const s = await paired();
    expect((await s.req('/api/push/check', { method: 'POST', body: '{}' })).status).toBe(401);
    expect((await s.check(await s.mint('tasks:read'))).status).toBe(403);
    expect((await s.owner('/api/push/check', { method: 'POST', headers: JSON_H, body: '{}' })).status).toBe(200);
    expect((await s.req('/api/push/check', { headers: { authorization: `Bearer ${s.agent}` } })).status).toBe(405);
  });

  // @req FR:iphone-access/check.config
  it('push stays off without full VAPID config; a bad key logs no value', async () => {
    const off = await paired({ ...ENV });
    expect((await off.check()).status).toBe(404);
    await off.putAsk('k', { ask: 'K', kind: 'approve', by: soon() });
    expect(off.reqs).toHaveLength(0);
    const bad = await paired({ ...ENV, ...VAPID_ENV, STACK_VAPID_PRIVATE_KEY: 'AAAA' });
    expect((await bad.check()).status).toBe(404);
    expect(bad.logs).toContain('host: STACK_VAPID_* invalid');
    expect(bad.logs.join('\n')).not.toContain('AAAA');
  });
});

describe('ask-write check runs in the background', () => {
  const ok = async () => new Response('{}', { status: 200 });
  const authorize = async () => true;
  const write = () => new Request('https://h/api/asks/k', { method: 'POST' });
  const counts = { sent: 1, removed: 0, failed: 0, skipped: 0 };

  // @req FR:iphone-access/check.asks
  it('the ask write answers before a slow check ends', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let ended = false;
    const check = async () => { await gate; ended = true; return counts; };
    const h = withPush(ok, { authorize, check, onError: () => undefined });
    const res = await h(write());
    expect(res.status).toBe(200);
    expect(ended).toBe(false);
    release();
  });

  // @req FR:iphone-access/check.asks
  it('a failed or hung check is logged and never changes the answer', async () => {
    // onError resolves a promise, so the test awaits the log and never sleeps.
    const logged = () => { let got!: (e: unknown) => void; const p = new Promise<unknown>((r) => { got = r; }); return { p, onError: (e: unknown) => got(e) }; };
    const a = logged();
    const fail = withPush(ok, { authorize, check: async () => { throw new Error('boom'); }, onError: a.onError });
    expect((await fail(write())).status).toBe(200);
    expect(await a.p).toEqual(new Error('boom'));
    const b = logged();
    const hung = withPush(ok, { authorize, check: () => new Promise<never>(() => undefined), onError: b.onError, checkTimeoutMs: 20 });
    expect((await hung(write())).status).toBe(200);
    expect(await b.p).toBeInstanceOf(PushCheckTimeout);
  });
});
