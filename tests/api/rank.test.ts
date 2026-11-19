import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PriStore } from '../../src/core/pris';
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
  // @req FR:api/routes.rank @req FR:task-lifecycle/rank.owner @req FR:task-lifecycle/rank.stale
  it('lists only owner rows and flags a stale row (storage with line history)', async () => {
    const storage = await seed();
    await storage.write('tasks/allyte.md', '# Allyte\n\n## 🔄 Active\n\n- [ ] 🤖 📅 Nov 1: Accept all FOCUS meeting invites 🟢\n- [ ] 🙋 📅 Oct 20: Send the CIO Review decline 🟢\n');
    const old = new Date('2026-10-15T12:00:00Z').getTime();
    const withHistory = Object.assign(storage, { lineActivity: async (p: string) => (p === 'tasks/allyte.md' ? Array<number>(8).fill(old) : []) });
    const h = createApiHandler({ storage: withHistory, authorize: () => true, now: () => NOW });
    const res = await h(new Request('https://x.test/api/rank?blocks=any', { headers: { 'x-ms-client-principal': OWNER } }));
    const items = ((await res.json()) as { items: { text: string; score: number; stale?: boolean }[] }).items;
    expect(items.some((i) => /FOCUS meeting/.test(i.text))).toBe(false);
    const cio = items.find((i) => /CIO Review/.test(i.text))!;
    expect(cio.stale).toBe(true);
    expect(cio.score).toBeLessThanOrEqual(500);
    expect(items.filter((i) => i.stale)).toHaveLength(1); // rows without history are never stale
  });
  // @req FR:api/routes.rank @req FR:task-lifecycle/rank.limit
  it('limit caps the list and is validated', async () => {
    const { call } = await mk();
    expect((await call('GET', '/api/rank?limit=2')).json.items).toHaveLength(2);
    expect((await call('GET', '/api/rank?limit=0')).status).toBe(422);
    expect((await call('GET', '/api/rank?limit=1000')).status).toBe(200);
    expect((await call('GET', '/api/rank?limit=1001')).status).toBe(422);
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

describe('GET /api/rank with priorities', () => {
  // @req FR:pri-first-ranking/api.@api @req FR:pri-first-ranking/api.order @req FR:pri-first-ranking/api.tasks
  it('ranks tasks linked to a priority first and returns task rows only', async () => {
    const storage = await seed();
    const home = mkdtempSync(join(tmpdir(), 'stack-home-'));
    writeFileSync(join(home, 'pris.json'), JSON.stringify({ version: 1, rev: 1, pris: [{ id: 'p1', title: 'Rewrite', status: 'active', items: [], backlog: [], weekly: [{ week: '2026-W44', text: 'Michael: approve the copy' }], keywords: ['FOCUS issues'] }] }));
    const h = createApiHandler({ storage, authorize: () => true, now: () => NOW, pris: new PriStore(home) });
    const get = async (p: string) => (await (await h(new Request(`https://x.test${p}`, { headers: { 'x-ms-client-principal': OWNER } }))).json()) as { items: { ref: string; text: string }[]; task: { text: string } };
    const { items } = await get('/api/rank');
    expect(items[0].text).toMatch(/FOCUS issues triage/);
    expect(items.every((i) => typeof i.ref === 'string' && !/approve the copy/.test(i.text))).toBe(true);
    expect((await get('/api/next')).task.text).toMatch(/FOCUS issues triage/);
    // The priority the row ranked under; an unlinked row has none. @req FR:pri-first-ranking/api.pri @req FR:api/routes.rank
    const withPri = items as { text: string; pri?: { rank: number; title: string } }[];
    expect(withPri[0].pri).toEqual({ rank: 1, title: 'Rewrite' });
    expect(withPri.slice(1).every((i) => i.pri === undefined)).toBe(true);
    // A new priority list re-ranks: the memo never reuses the old order. @req FR:pri-first-ranking/api.order
    writeFileSync(join(home, 'pris.json'), JSON.stringify({ version: 1, rev: 2, pris: [{ id: 'p1', title: 'Cid', status: 'active', items: [], backlog: [], weekly: [], keywords: ['Cid copy'] }] }));
    expect((await get('/api/rank')).items[0].text).toMatch(/Rewrite Cid copy/);
    writeFileSync(join(home, 'pris.json'), JSON.stringify({ version: 1, rev: 3, pris: [{ id: 'p1', title: 'Rewrite', status: 'active', items: [], backlog: [], weekly: [], keywords: ['FOCUS issues'] }] }));
    expect((await get('/api/rank')).items[0].text).toMatch(/FOCUS issues triage/);
    // @req FR:pri-first-ranking/order.overrides
    await storage.writeAux(PRIORITIES_PATH, JSON.stringify({ rules: [{ match: 'FOCUS', effect: 'down' }] }), { expectedVersion: null });
    expect((await get('/api/rank')).items.at(-1)!.text).toMatch(/FOCUS issues triage/);
  });
});

describe('GET /api/rank?daily=1', () => {
  // @req FR:pri-first-ranking/daily.@api @req FR:pri-first-ranking/daily.pick @req FR:pri-first-ranking/daily.done @req FR:pri-first-ranking/daily.order @req FR:pri-first-ranking/daily.output @req FR:pri-first-ranking/$daily-row
  it('lists each project pick and whether a task was done today', async () => {
    const storage = await seed();
    await storage.write('tasks/focus.md', '# 👓 FOCUS\n\n- **Project value:** 🌟🌟\n\n## 🔄 Active\n\n- [ ] 🚨 📅 Oct 30: FOCUS issues triage 🟡\n- [x] Old FOCUS task\n');
    await storage.write('tasks/done.md', '# Done\n\n## 🔄 Active\n\n- [x] All done here\n');
    const today = NOW.getTime() - 3_600_000; const before = NOW.getTime() - 3 * 86_400_000;
    Object.assign(storage, { lineActivity: async (p: string) => (p === 'tasks/focus.md' ? [before, before, before, before, before, before, before, today] : p === 'tasks/done.md' ? [before, before, before, before, before] : []) });
    const h = createApiHandler({ storage, authorize: () => true, now: () => NOW });
    const get = async (q: string) => (await (await h(new Request(`https://x.test/api/rank${q}`, { headers: { 'x-ms-client-principal': OWNER } }))).json()) as { items: { ref: string; project: string }[]; daily?: { project: string; done: boolean; pick?: { ref: string; text: string } }[] };
    const r = await get('?daily=1');
    const first = (p: string) => r.items.find((i) => i.project === p)?.ref;
    expect(r.daily!.map((d) => d.project)).toEqual([...new Set(r.items.map((i) => i.project))].concat('Done'));
    expect(r.daily!.find((d) => d.project === '👓 FOCUS')).toMatchObject({ done: true, pick: { ref: first('👓 FOCUS') } });
    expect(r.daily!.find((d) => d.project === '💰 Finance')).toMatchObject({ done: false, pick: { ref: first('💰 Finance') } });
    expect(r.daily!.find((d) => d.project === 'Done')).toEqual({ project: 'Done', name: 'done', done: false });
    expect((await get('')).daily).toBeUndefined();
  });
  // @req FR:pri-first-ranking/daily.done @req FR:pri-first-ranking/daily.done.edit @req FR:pri-first-ranking/daily.done.day
  it('counts Stack commits of today; never agent rows', async () => {
    const storage = await seed();
    await storage.write('tasks/finance.md', '# 💰 Finance\n\n- **Project value:** 💰💰💰\n\n## 🔄 Active\n\n- [ ] ‼️ 📅 Nov 2: Pay bills 💰💰💰💰 ⬆️\n- [x] 🤖 Agent reconciled the ledger\n');
    const since: Date[] = [];
    Object.assign(storage, {
      lineActivity: async (p: string) => (p === 'tasks/finance.md' ? Array<number>(8).fill(NOW.getTime()) : []),
      commitSubjects: async (p: string, s: Date) => { since.push(s); return p === 'tasks/other.md' ? ['Roll: Rewrite Cid copy', 'Update notes'] : p === 'tasks/focus.md' ? ['Retitle: FOCUS'] : []; },
    });
    const h = createApiHandler({ storage, authorize: () => true, now: () => NOW });
    const r = (await (await h(new Request('https://x.test/api/rank?daily=1', { headers: { 'x-ms-client-principal': OWNER } }))).json()) as { daily: { project: string; done: boolean }[] };
    const done = Object.fromEntries(r.daily.map((d) => [d.project, d.done]));
    expect(done).toEqual({ '💰 Finance': false, '👓 FOCUS': false, Other: true });
    expect(since[0].toISOString()).toBe('2026-11-01T07:00:00.000Z'); // midnight PT on Nov 1
  });
  // @req FR:pri-first-ranking/daily.done.history
  it('marks no project done when the storage keeps no history', async () => {
    const h = createApiHandler({ storage: await seed(), authorize: () => true, now: () => NOW });
    const r = (await (await h(new Request('https://x.test/api/rank?daily=1', { headers: { 'x-ms-client-principal': OWNER } }))).json()) as { daily: { done: boolean }[] };
    expect(r.daily.length).toBeGreaterThan(0);
    expect(r.daily.every((d) => !d.done)).toBe(true);
  });
});
