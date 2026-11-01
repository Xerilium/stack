import { createApiHandler } from '../../src/api/handler';
import { MemoryStorage } from '../../src/core/storage';
import { NEEDS_PATH } from '../../src/core/needs-you';
import { PRIORITIES_PATH } from '../../src/core/priorities';

const OWNER = Buffer.from(JSON.stringify({ identityProvider: 'github', userId: 'o', userRoles: ['authenticated'] })).toString('base64');
const TOKEN = 'stk_0123456789abcdef.secret';
const NOW = new Date('2026-11-01T22:00:00-07:00');
const seed = async () => {
  const s = new MemoryStorage();
  await s.write('tasks/finance.md', '# 💰 Finance\n\n- **Project value:** 💰💰💰\n\n## 🔄 Active\n\n- [ ] ‼️ 📅 Nov 2: Pay bills 💰💰💰💰 ⬆️\n  - [ ] ‼️ 📅 Nov 1: Mortgage 💰💰 🔹\n');
  await s.write('tasks/focus.md', '# 👓 FOCUS\n\n- **Project value:** 🌟🌟\n\n## 🔄 Active\n\n- [ ] 🚨 📅 Oct 30: FOCUS issues triage 🟡\n');
  await s.write('tasks/other.md', '# Other\n\n## 🔄 Active\n\n- [ ] 🚨 📅 Oct 16: Rewrite Cid copy 🟡\n');
  return s;
};
const mk = async () => {
  const storage = await seed();
  const h = createApiHandler({ storage, authorize: () => true, now: () => NOW });
  const call = async (method: string, path: string, who: 'owner' | 'agent' = 'owner', body?: unknown) => {
    const headers: Record<string, string> = who === 'owner' ? { 'x-ms-client-principal': OWNER } : { authorization: `Bearer ${TOKEN}` };
    if (body !== undefined) headers['content-type'] = 'application/json';
    const res = await h(new Request(`https://x.test${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }));
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : undefined };
  };
  return { storage, call };
};

describe('GET /api/rank', () => {
  // @req FR:api/routes.rank @req FR:task-lifecycle/rank.output
  it('lists the ranked tasks with score, the override that applied, and the top-level row', async () => {
    const { storage, call } = await mk();
    await storage.writeAux(PRIORITIES_PATH, JSON.stringify({ rules: [{ match: 'Pay bills', effect: 'top' }, { match: 'FOCUS', effect: 'down' }] }), { expectedVersion: null });
    const r = await call('GET', '/api/rank');
    expect(r.status).toBe(200);
    const items = r.json.items as { ref: string; text: string; project: string; score: number; rule?: string; root?: string }[];
    expect(items[0].text).toMatch(/Mortgage/);
    expect(items[0].rule).toBe('Pay bills');
    expect(items[0].root).toMatch(/:\d+$/);
    expect(items.at(-1)!.text).toMatch(/FOCUS issues/);
    expect(items.every((i) => typeof i.score === 'number')).toBe(true);
  });
  // @req FR:api/routes.rank @req FR:task-lifecycle/rank.limit
  it('limit caps the list and is validated', async () => {
    const { call } = await mk();
    expect((await call('GET', '/api/rank?limit=2')).json.items).toHaveLength(2);
    expect((await call('GET', '/api/rank?limit=0')).status).toBe(422);
    expect((await call('GET', '/api/rank?limit=201')).status).toBe(422);
  });
  // @req FR:api/routes.rank
  it('blocks=any keeps rows the time block hides; an unknown value is rejected', async () => {
    const { call } = await mk();
    const now = (await call('GET', '/api/rank')).json.items.length;
    const any = (await call('GET', '/api/rank?blocks=any')).json.items.length;
    expect(any).toBeGreaterThanOrEqual(now);
    expect((await call('GET', '/api/rank?blocks=sometimes')).status).toBe(422);
  });
  // @req FR:api/routes.next
  it('/next is the first of /rank, overrides included', async () => {
    const { storage, call } = await mk();
    await storage.writeAux(PRIORITIES_PATH, JSON.stringify({ rules: [{ match: 'Cid copy', effect: 'top' }] }), { expectedVersion: null });
    const rank = (await call('GET', '/api/rank')).json.items[0];
    const next = (await call('GET', '/api/next')).json.task;
    expect(next).toMatchObject({ ref: rank.ref, text: rank.text, project: rank.project, score: rank.score });
    expect(next.text).toMatch(/Cid copy/);
  });
});

describe('needs-you routes', () => {
  const need = { id: 'pay-bills', title: 'Pay bills tonight', recommendation: 'Pay USAA first', default: 'I wait', link: 'https://example.com/x' };
  // @req FR:ask-queue/needs.api
  it('GET lists the items; POST answer records it, undo clears it; owner only', async () => {
    const { storage, call } = await mk();
    await storage.writeAux(NEEDS_PATH, JSON.stringify({ items: [need] }), { expectedVersion: null });
    expect((await call('GET', '/api/needs-you')).json.items.map((n: { id: string }) => n.id)).toEqual(['pay-bills']);
    expect((await call('POST', '/api/needs-you/pay-bills/answer', 'agent', { choice: 'go' })).status).toBe(403);
    expect((await call('POST', '/api/needs-you/pay-bills/answer', 'owner', { choice: 'go' })).status).toBe(200);
    expect((await call('GET', '/api/needs-you')).json.items[0].answer.choice).toBe('go');
    expect((await call('POST', '/api/needs-you/pay-bills/answer', 'owner', { choice: 'undo' })).status).toBe(200);
    expect((await call('GET', '/api/needs-you')).json.items[0].answer).toBeUndefined();
  });
  // @req FR:ask-queue/needs.api
  it('404 for an unknown id, 422 for a bad choice or a defer without until', async () => {
    const { storage, call } = await mk();
    await storage.writeAux(NEEDS_PATH, JSON.stringify({ items: [need] }), { expectedVersion: null });
    expect((await call('POST', '/api/needs-you/nope/answer', 'owner', { choice: 'go' })).status).toBe(404);
    expect((await call('POST', '/api/needs-you/pay-bills/answer', 'owner', { choice: 'sideways' })).status).toBe(422);
    expect((await call('POST', '/api/needs-you/pay-bills/answer', 'owner', { choice: 'defer' })).status).toBe(422);
  });
  // @req FR:ask-queue/needs.read
  it('no file means an empty list', async () => {
    const { call } = await mk();
    expect((await call('GET', '/api/needs-you')).json).toEqual({ items: [] });
  });
});
