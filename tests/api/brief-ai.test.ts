import { createApiHandler, ROUTES } from '../../src/api/handler';
import { routeScope } from '../../src/api';
import { MemoryStorage } from '../../src/core/storage';
import { putAsk } from '../../src/core/asks';
import type { ClaudeJson, JsonCall } from '../../src/email/llm';

let NOW = new Date('2026-11-05T15:00:00Z');
const seed = async (storage: MemoryStorage, key: string, kind: string, ask: string) =>
  putAsk({ storage, now: () => NOW }, key, { ask, kind, recommend: 'Approve', priority: 'normal', reversible: true } as never, 'cos');

function fake(reply: unknown) {
  const calls: JsonCall[] = [];
  const brief: ClaudeJson = async <T,>(c: JsonCall) => { calls.push(c); if (reply instanceof Error) throw reply; return { value: reply as T, costUsd: 0.01 }; };
  return { brief, calls };
}
async function mk(reply: unknown, owner = true) {
  const storage = new MemoryStorage();
  const f = fake(reply);
  const h = createApiHandler({ storage, authorize: () => true, now: () => NOW, brief: f.brief });
  const get = async (path = '/brief/summary') => {
    const headers: Record<string, string> = {};
    if (owner) headers['x-ms-client-principal'] = Buffer.from(JSON.stringify({ userDetails: 'me', identityProvider: 'github', userRoles: ['authenticated'] })).toString('base64');
    const res = await h(new Request(`https://x.test/api${path}`, { headers }));
    return { status: res.status, json: (await res.json()) as any };
  };
  return { storage, get, ...f };
}

// @req FR:cos-view/brief.ai.route @req FR:cos-view/brief.ai.model @req FR:cos-view/brief.ai.actions @req FR:cos-view/brief.ai.cache @req FR:cos-view/brief.ai.empty
describe('brief summary', () => {
  it('route is registered with read scope', () => {
    expect(routeScope('brief.summary')).toBe('tasks:read');
    expect(ROUTES.some((r) => r.name === 'brief.summary' && r.method === 'GET')).toBe(true);
  });

  it('without a model: configured false', async () => {
    const h = createApiHandler({ storage: new MemoryStorage(), authorize: () => true, now: () => NOW });
    const res = await h(new Request('https://x.test/api/brief/summary', { headers: { 'x-ms-client-principal': Buffer.from(JSON.stringify({ userDetails: 'me', identityProvider: 'github', userRoles: ['authenticated'] })).toString('base64') } }));
    expect(await res.json()).toEqual({ configured: false });
  });

  it('tokens get 403', async () => {
    const t = await mk({ headline: 'x', lines: [] }, false);
    expect((await t.get()).status).toBe(403);
  });

  it('empty: no model call', async () => {
    const t = await mk({ headline: 'x', lines: [] });
    const r = await t.get();
    expect(r.json).toMatchObject({ configured: true, headline: 'Nothing needs you.', lines: [] });
    expect(t.calls).toHaveLength(0);
  });

  it('keeps known keys, caps actions by kind, drops unknown keys, fences asks as data', async () => {
    const t = await mk({ headline: 'Two things', lines: [
      { key: 'a1', text: 'Approve the budget', action: 'go' },
      { key: 'g1', text: 'Go do it', action: 'go' },
      { key: 'g2', text: 'Done it', action: 'done' },
      { key: 'ghost', text: 'Not real', action: 'go' },
    ] });
    await seed(t.storage, 'a1', 'approve', 'Approve budget');
    await seed(t.storage, 'g1', 'go-do', 'Sign the form');
    await seed(t.storage, 'g2', 'go-do', 'Sign the other form');
    const r = await t.get();
    expect(r.json.lines).toEqual([
      { key: 'a1', text: 'Approve the budget', action: 'go' },
      { key: 'g1', text: 'Go do it', action: 'none' },
      { key: 'g2', text: 'Done it', action: 'done' },
    ]);
    expect(t.calls[0].model).toBe('claude-sonnet-5-5');
    expect(t.calls[0].user).toContain('untrusted');
    expect(t.calls[0].user).toContain('Approve budget');
  });

  it('caches per day, refresh forces, a new day starts over', async () => {
    const t = await mk({ headline: 'H', lines: [] });
    await seed(t.storage, 'a1', 'approve', 'Approve budget');
    const a = await t.get();
    const b = await t.get();
    expect(a.json.cached).toBeFalsy();
    expect(b.json.cached).toBe(true);
    expect(t.calls).toHaveLength(1);
    await t.get('/brief/summary?refresh=1');
    expect(t.calls).toHaveLength(2);
    NOW = new Date('2026-11-06T15:00:00Z');
    await t.get();
    expect(t.calls).toHaveLength(3);
    NOW = new Date('2026-11-05T15:00:00Z');
  });

  it('shares one call across concurrent requests', async () => {
    const t = await mk({ headline: 'H', lines: [] });
    await seed(t.storage, 'a1', 'approve', 'Approve budget');
    await Promise.all([t.get(), t.get(), t.get()]);
    expect(t.calls).toHaveLength(1);
  });

  it('failure: generic error, not cached', async () => {
    const t = await mk(new Error('claude exited 1: /secret/path'));
    await seed(t.storage, 'a1', 'approve', 'Approve budget');
    const r = await t.get();
    expect(r.json).toEqual({ configured: true, date: '2026-11-05', error: 'Summary unavailable' });
    await t.get();
    expect(t.calls).toHaveLength(2);
  });
});
