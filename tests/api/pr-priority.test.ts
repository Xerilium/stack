import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createApiHandler, ROUTES } from '../../src/api/handler';
import { createAuth, createTokenService, MemoryTokenStore, routeScope } from '../../src/api';
import { MemoryStorage } from '../../src/core/storage';
import { PrPriorityStore } from '../../src/core/pr-priority';

const NOW = new Date('2026-11-11T18:00:00Z');
const OWNER = { 'x-ms-client-principal': Buffer.from(JSON.stringify({ userDetails: 'me', identityProvider: 'github', userRoles: ['authenticated'] })).toString('base64') };
const U = (n: number) => `https://github.com/o/r/pull/${n}`;

function mk(withStore = true) {
  const store = withStore ? new PrPriorityStore(mkdtempSync(join(tmpdir(), 'stack-home-')), { now: () => NOW }) : undefined;
  const storage = new MemoryStorage();
  const deps = { storage, now: () => NOW, ...(store ? { prPriority: store } : {}) };
  const tokens = createTokenService({ store: new MemoryTokenStore(), now: () => NOW });
  const auth = createAuth({ owners: [], tokens });
  const token = auth.wrap(createApiHandler({ ...deps, authorize: auth.authorize }));
  const owner = createApiHandler({ ...deps, authorize: () => true });
  const call = async (who: string, method: string, path: string, body?: unknown) => {
    const headers: Record<string, string> = { 'content-type': 'application/json', ...(who === 'owner' ? OWNER : { authorization: `Bearer ${who}` }) };
    const res = await (who === 'owner' ? owner : token)(new Request(`https://x.test/api${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }));
    const t = await res.text();
    return { status: res.status, json: t ? JSON.parse(t) : undefined };
  };
  const agentToken = async () => (await tokens.create({ name: 'cos', scopes: ['tasks:read', 'tasks:write'] as never })).token;
  return { call, store: store!, agentToken, storage };
}

const NAMES = ['prPriority.get', 'prPriority.put', 'prPriority.recommend', 'prPriority.decisions', 'prPriority.decide'];

it('routes are registered with scopes and documented', () => {
  expect(NAMES.map(routeScope)).toEqual(['tasks:read', 'tasks:write', 'tasks:write', 'tasks:read', 'tasks:write']);
  expect(ROUTES.filter((r) => NAMES.includes(r.name)).map((r) => `${r.method} ${r.doc}`).sort()).toEqual([
    'GET /pr-priority', 'GET /pr-priority/recommendations', 'POST /pr-priority', 'POST /pr-priority/recommendations', 'POST /pr-priority/recommendations/{id}',
  ]);
  const y = readFileSync(join(__dirname, '../../docs/api/openapi.yaml'), 'utf8');
  expect(y).toContain('/pr-priority:');
  expect(y).toContain('/pr-priority/recommendations/{id}:');
});

// @req FR:pr-priority/api.get @req FR:pr-priority/api.put @req FR:pr-priority/queue.idem
it('GET and POST /pr-priority read and change the queue for the owner with rev checks', async () => {
  const { call } = mk();
  expect(await call('owner', 'GET', '/pr-priority')).toEqual({ status: 200, json: { version: 1, rev: 0, items: [], escalations: null, recommendations: [] } });
  const add = await call('owner', 'POST', '/pr-priority', { rev: 0, op: 'add', ref: U(1) });
  expect(add.status).toBe(200);
  expect(add.json).toMatchObject({ changed: true, rev: 1, items: [{ rank: 1, pr: 1, url: U(1), baseStack: [], acks: [] }] });
  expect((await call('owner', 'POST', '/pr-priority', { rev: 1, op: 'add', ref: 'o/r#1' })).json).toMatchObject({ changed: false, rev: 1 });
  expect((await call('owner', 'POST', '/pr-priority', { rev: 0, op: 'add', ref: 'o/r#2' })).status).toBe(409);
  await call('owner', 'POST', '/pr-priority', { rev: 1, op: 'add', ref: 'o/r#2' });
  const mv = await call('owner', 'POST', '/pr-priority', { rev: 2, op: 'move', ref: 'o/r#1', to: 'top' });
  expect(mv.json.items.map((i: { pr: number }) => i.pr)).toEqual([1, 2]);
  expect((await call('owner', 'POST', '/pr-priority', { rev: 3, op: 'pin', ref: 'o/r#2' })).json.items.map((i: { pr: number; pinned: boolean }) => `${i.pr}${i.pinned ? 'p' : ''}`)).toEqual(['2p', '1']);
  expect((await call('owner', 'POST', '/pr-priority', { rev: 4, op: 'undo' })).json.items.map((i: { pr: number }) => i.pr)).toEqual([1, 2]);
  expect((await call('owner', 'POST', '/pr-priority', { rev: 5, op: 'move', ref: 'o/r#9', rank: 1 })).status).toBe(404);
  expect((await call('owner', 'POST', '/pr-priority', { rev: 5, op: 'move', ref: 'o/r#1' })).status).toBe(422);
  expect((await call('owner', 'POST', '/pr-priority', { rev: 5, op: 'add', ref: 'nope' })).status).toBe(422);
  const ack = await call('owner', 'POST', '/pr-priority', { rev: 5, op: 'ack', ref: 'o/r#1', thread: `${U(1)}#discussion_r1`, note: 'hold is fine' });
  expect(ack.json.items[0].acks).toEqual([{ thread: `${U(1)}#discussion_r1`, note: 'hold is fine', at: NOW.toISOString() }]);
  expect((await call('owner', 'POST', '/pr-priority', { rev: 5, op: 'remove', ref: 'o/r#1' })).json.items.map((i: { pr: number }) => i.pr)).toEqual([2]);
  expect((await mk(false).call('owner', 'GET', '/pr-priority')).status).toBe(404);
});

// @req FR:pr-priority/api.recommend @req FR:pr-priority/api.decisions @req FR:pr-priority/api.decide @req FR:pr-priority/api.get
it('an agent token recommends and reads decisions; only the owner decides and reads the queue', async () => {
  const { call, agentToken } = mk();
  const t = await agentToken();
  expect((await call(t, 'GET', '/pr-priority')).status).toBe(403);
  expect((await call(t, 'POST', '/pr-priority', { rev: 0, op: 'add', ref: 'o/r#1' })).status).toBe(403);
  const r = await call(t, 'POST', '/pr-priority/recommendations', { repo: 'o/r', number: 3, agent: 'xe-cos', reason: 'Release blocker', toRank: 1 });
  expect(r).toMatchObject({ status: 200, json: { created: true, rec: { state: 'open', url: U(3) } } });
  const id = r.json.rec.id as string;
  expect((await call('owner', 'GET', '/pr-priority')).json.recommendations.map((x: { id: string }) => x.id)).toEqual([id]);
  expect((await call(t, 'POST', `/pr-priority/recommendations/${id}`, { decision: 'accept' })).status).toBe(403);
  expect((await call('owner', 'POST', `/pr-priority/recommendations/${id}`, { decision: 'reject' })).status).toBe(422);
  const d = await call('owner', 'POST', `/pr-priority/recommendations/${id}`, { decision: 'reject', reason: 'Not this week' });
  expect(d).toMatchObject({ status: 200, json: { changed: true, rec: { state: 'rejected', decision: { reason: 'Not this week' } }, queue: { items: [] } } });
  expect((await call('owner', 'POST', `/pr-priority/recommendations/${id}`, { decision: 'accept' })).status).toBe(409);
  expect((await call('owner', 'POST', '/pr-priority/recommendations/pp-00000000', { decision: 'accept' })).status).toBe(404);
  const again = await call(t, 'POST', '/pr-priority/recommendations', { repo: 'o/r', number: 3, agent: 'xe-cos', reason: 'release blocking' });
  expect(again.status).toBe(409);
  expect(again.json.error.message).toContain('Not this week');
  expect(again.json.error.details).toEqual([{ field: 'reason', message: `rejected ${NOW.toISOString()} by owner: Not this week (${id})` }]);
  expect((await call(t, 'GET', '/pr-priority/recommendations?agent=xe-cos')).json.items.map((x: { id: string }) => x.id)).toEqual([id]);
  expect((await call(t, 'GET', '/pr-priority/recommendations?agent=zz')).json.items).toEqual([]);
  expect((await call(t, 'POST', '/pr-priority/recommendations', { repo: 'o/r', number: 3, agent: 'Bad', reason: 'x' })).status).toBe(422);
});

// @req FR:pr-priority/needs.list @req FR:pr-priority/needs.actions
it('open recommendations are Needs you decisions; go accepts, other answers name the decide path', async () => {
  const { call, store } = mk();
  const r = await store.recommend({ repo: 'o/r', number: 4, agent: 'cos', reason: 'Hot' });
  if (!('rec' in r)) throw new Error('no rec');
  const n = await call('owner', 'GET', '/needs-you');
  expect(n.json.items).toEqual([expect.objectContaining({ id: `pp.${r.rec.id}`, kind: 'decision', actions: ['accept', 'edit', 'reject'], decide: `/api/pr-priority/recommendations/${r.rec.id}` })]);
  const bad = await call('owner', 'POST', `/needs-you/pp.${r.rec.id}/answer`, { choice: 'reply', text: 'no' });
  expect(bad.status).toBe(400);
  expect(bad.json.error.message).toContain(`/api/pr-priority/recommendations/${r.rec.id}`);
  expect((await call('owner', 'POST', `/needs-you/pp.${r.rec.id}/answer`, { choice: 'go' })).status).toBe(200);
  expect(store.read().items.map((i) => i.number)).toEqual([4]);
  expect((await call('owner', 'GET', '/needs-you')).json.items).toEqual([]);
});

// @req FR:pr-priority/api.pr
it('GET /agents carries each PR priority rank or null', async () => {
  const { call, store, storage } = mk();
  storage.seed('tasks/alpha.md', `# Alpha\n\n## Active\n\n- [ ] 🤖 Ship ${U(1)} and ${U(2)}\n`);
  await store.edit({ op: 'add', ref: 'o/r#2' });
  const a = await call('owner', 'GET', '/agents');
  expect(a.json.items[0].prs.map((p: { number: number; priority: number | null }) => [p.number, p.priority])).toEqual([[1, null], [2, 1]]);
  const none = mk(false);
  none.storage.seed('tasks/alpha.md', `# Alpha\n\n## Active\n\n- [ ] 🤖 Ship ${U(1)}\n`);
  expect((await none.call('owner', 'GET', '/agents')).json.items[0].prs[0].priority).toBeNull();
});
