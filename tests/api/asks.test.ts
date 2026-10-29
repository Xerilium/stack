import { createApiHandler, ROUTES } from '../../src/api/handler';
import { createAuth, createTokenService, MemoryTokenStore, routeScope } from '../../src/api';
import { MemoryStorage } from '../../src/core/storage';
import { readFileSync } from 'fs';
import { join } from 'path';

const NOW = new Date('2026-10-28T18:00:00Z');
const BODY = { ask: 'Approve merging PR 879 into dev', kind: 'approve', recommend: 'Approve', default: 'Merges at 8am', by: '2026-10-29T15:00:00Z', reversible: true, link: 'https://github.com/o/r/pull/879', priority: 'high', effort: '2m' };

async function mk() {
  const storage = new MemoryStorage();
  const tokens = createTokenService({ store: new MemoryTokenStore(), now: () => NOW });
  const auth = createAuth({ owners: [], tokens });
  const token = auth.wrap(createApiHandler({ storage, authorize: auth.authorize, now: () => NOW }));
  const owner = createApiHandler({ storage, authorize: () => true, now: () => NOW });
  const mint = async (...scopes: string[]) => (await tokens.create({ name: 'cos', scopes: scopes as never })).token;
  const call = async (who: string | 'owner' | null, method: 'GET' | 'POST', path: string, body?: unknown) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (who === 'owner') headers['x-ms-client-principal'] = Buffer.from(JSON.stringify({ userDetails: 'me', identityProvider: 'github', userRoles: ['authenticated'] })).toString('base64');
    else if (who) headers.authorization = `Bearer ${who}`;
    const req = new Request(`https://x.test/api${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const res = await (who === 'owner' ? owner : token)(req);
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : undefined };
  };
  return { storage, mint, call };
}

// @req FR:ask-queue/api.list @req FR:ask-queue/api.put @req FR:ask-queue/api.answer @req FR:ask-queue/api.handle
describe('asks routes', () => {
  it('are registered with their scopes and in the OpenAPI document', () => {
    const want: [string, string, string][] = [['asks.list', 'GET', 'tasks:read'], ['asks.put', 'POST', 'tasks:write'], ['asks.answer', 'POST', 'tasks:write'], ['asks.handle', 'POST', 'tasks:write']];
    for (const [name, method, scope] of want) {
      expect(routeScope(name)).toBe(scope);
      expect(ROUTES.some((r) => r.name === name && r.method === method)).toBe(true);
    }
    const doc = readFileSync(join(__dirname, '../../docs/api/openapi.yaml'), 'utf8');
    for (const p of ['/asks:', '/asks/{key}:', '/asks/{key}/answer:', '/asks/{key}/handle:']) expect(doc).toContain(p);
  });

  it('an agent token puts an ask; the owner lists it ranked', async () => {
    const { call, mint } = await mk();
    const w = await mint('tasks:write');
    const r = await call(w, 'POST', '/asks/pr-879-approve', { ...BODY, from: 'allyte-cos' });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ key: 'pr-879-approve', created: true });
    expect((await call(w, 'POST', '/asks/pr-879-approve', BODY)).json.created).toBe(false);
    const list = await call('owner', 'GET', '/asks');
    expect(list.status).toBe(200);
    expect(list.json.total).toBe(1);
    expect(list.json.latest).toBeDefined();
    expect(list.json.items[0]).toMatchObject({ key: 'pr-879-approve', rank: 1, score: expect.any(Number), overdue: false, kind: 'approve', from: 'allyte-cos', ask: 'Approve merging PR 879 into dev', link: 'https://github.com/o/r/pull/879' });
  });

  it('from defaults to the caller', async () => {
    const { call, mint } = await mk();
    await call(await mint('tasks:write'), 'POST', '/asks/a', BODY);
    expect((await call('owner', 'GET', '/asks')).json.items[0].from).toBe('agent');
  });

  it('only the owner answers; tokens get 403 and the ask is untouched', async () => {
    const { call, mint } = await mk();
    const w = await mint('tasks:write');
    await call(w, 'POST', '/asks/a', BODY);
    expect((await call(w, 'POST', '/asks/a/answer', { answer: 'go' })).status).toBe(403);
    expect((await call(null, 'POST', '/asks/a/answer', { answer: 'go' })).status).toBe(401);
    expect((await call('owner', 'GET', '/asks')).json.items).toHaveLength(1);
    expect((await call('owner', 'POST', '/asks/a/answer', { answer: 'go' })).json).toEqual({ changed: true });
    expect((await call('owner', 'GET', '/asks')).json.items).toHaveLength(0);
    const waiting = await call(await mint('tasks:read'), 'GET', '/asks?state=answered');
    expect(waiting.json.items).toEqual([expect.objectContaining({ key: 'a', state: 'answered', answer: 'go' })]);
  });

  it('the agent handles the answer; scopes are enforced', async () => {
    const { call, mint } = await mk();
    const w = await mint('tasks:write');
    const ro = await mint('tasks:read');
    await call(w, 'POST', '/asks/a', BODY);
    await call('owner', 'POST', '/asks/a/answer', { answer: 'ask', text: 'Is CI green?' });
    expect((await call(ro, 'POST', '/asks/a/handle', { outcome: 'handled' })).status).toBe(403);
    expect((await call(w, 'POST', '/asks/a/handle', { outcome: 'reopen', reply: 'All green' })).json).toEqual({ changed: true });
    expect((await call('owner', 'GET', '/asks')).json.items[0].agentReply).toBe('All green');
    expect((await call(w, 'POST', '/asks/a/handle', { outcome: 'handled', note: 'merged' })).json).toEqual({ changed: true });
    expect((await call(w, 'POST', '/asks/a/handle', { outcome: 'handled', note: 'merged' })).json).toEqual({ changed: false });
  });

  it('validates input and maps errors', async () => {
    const { call, mint } = await mk();
    const w = await mint('tasks:write');
    expect((await call(w, 'POST', '/asks/Bad Key', BODY)).status).toBe(422);
    expect((await call(w, 'POST', '/asks/a', { ...BODY, kind: 'order' })).status).toBe(422);
    expect((await call(w, 'POST', '/asks/a', { ...BODY, answer: 'go' })).status).toBe(422);
    expect((await call(w, 'POST', '/asks/a', { ...BODY, link: 'http://x.test' })).status).toBe(422);
    expect((await call(w, 'POST', '/asks/a', { kind: 'approve' })).status).toBe(422);
    expect((await call('owner', 'POST', '/asks/nope/answer', { answer: 'go' })).status).toBe(404);
    expect((await call(w, 'POST', '/asks/nope/handle', { outcome: 'handled' })).status).toBe(404);
    await call(w, 'POST', '/asks/a', BODY);
    await call('owner', 'POST', '/asks/a/answer', { answer: 'go' });
    expect((await call('owner', 'POST', '/asks/a/answer', { answer: 'no' })).status).toBe(409);
    expect((await call('owner', 'GET', '/asks?state=bogus')).status).toBe(422);
    expect((await call('owner', 'GET', '/asks?limit=0')).status).toBe(422);
    await call(w, 'POST', '/asks/b', BODY);
    expect((await call('owner', 'POST', '/asks/b/answer', { answer: 'defer', until: 'someday' })).status).toBe(422);
  });

  it('decide asks take options with commas', async () => {
    const { call, mint } = await mk();
    const w = await mint('tasks:write');
    expect((await call(w, 'POST', '/asks/d', { ask: 'When?', kind: 'decide', options: ['Friday, risky', 'Monday'], recommend: 'Monday' })).status).toBe(200);
    expect((await call('owner', 'POST', '/asks/d/answer', { answer: 'option', text: 'Friday, risky' })).json).toEqual({ changed: true });
  });
});
