/** Ask the task's agent to fill in a row that fails the quality gate: one `enrich` inbox entry, delivered even on a 🙋 row. */
import { readFileSync } from 'fs';
import { join } from 'path';
import { createApiHandler, ROUTES } from '../../src/api/handler';
import { createAuth, createTokenService, MemoryTokenStore, routeScope } from '../../src/api';
import { pendingDeliveries } from '../../src/agents/delivery';
import { putAgent } from '../../src/core/agents';
import { listInbox } from '../../src/core/inbox';
import { MemoryStorage } from '../../src/core/storage';

const NOW = new Date('2026-11-18T18:00:00Z');
// Line 6 (0-based): a 🙋 row with no context. Line 7: a row that passes.
const F4 = '# 🎧 Flantastic 4\n\n- **Repository:** https://github.com/flanakin/f4-music\n\n## 🔄 Active\n\n- [ ] 🙋 Review and send the launch post\n- [ ] 🙋 Merge #97 after CI\n';

async function mk() {
  const storage = new MemoryStorage();
  await storage.write('tasks/flantastic-4.md', F4);
  const ctx = { storage, now: () => NOW };
  await putAgent(ctx, 'cid-manager', { name: 'Cid Manager', scope: ['flantastic-4'] });
  const tokens = createTokenService({ store: new MemoryTokenStore(), now: () => NOW });
  const auth = createAuth({ owners: [], tokens });
  const token = auth.wrap(createApiHandler({ storage, authorize: auth.authorize, now: () => NOW }));
  const owner = createApiHandler({ storage, authorize: () => true, now: () => NOW });
  const mint = async (...scopes: string[]) => (await tokens.create({ name: 'cid-manager', scopes: scopes as never })).token;
  const call = async (who: string | 'owner', path: string, body: unknown = {}) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (who === 'owner') headers['x-ms-client-principal'] = Buffer.from(JSON.stringify({ userDetails: 'me', identityProvider: 'github', userRoles: ['authenticated'] })).toString('base64');
    else headers.authorization = `Bearer ${who}`;
    const res = await (who === 'owner' ? owner : token)(new Request(`https://x.test/api${path}`, { method: 'POST', headers, body: JSON.stringify(body) }));
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : undefined };
  };
  return { ctx, storage, call, mint };
}

describe('POST /tasks/{ref}/enrich', () => {
  // @req FR:product-reset/api.enrich
  it('is registered with the tasks:write scope and documented', () => {
    expect(routeScope('tasks.enrich')).toBe('tasks:write');
    expect(ROUTES.some((r) => r.name === 'tasks.enrich' && r.method === 'POST' && r.doc === '/tasks/{ref}/enrich')).toBe(true);
    expect(readFileSync(join(__dirname, '../../docs/api/openapi.yaml'), 'utf8')).toContain('/tasks/{ref}/enrich:');
  });

  // @req FR:product-reset/api.enrich @req FR:product-reset/quality.enrich @req FR:agent-inbox/inbox.kinds
  it('sends one enrich message to the task agent that names the missing checks; never edits the row', async () => {
    const { ctx, storage, call } = await mk();
    const r = await call('owner', '/tasks/flantastic-4:6/enrich');
    expect(r.status).toBe(202);
    expect(r.json).toEqual({ id: expect.stringMatching(/^in-/), agent: 'cid-manager', missing: ['doneWhen', 'context', 'single'] });
    const [e] = await listInbox(ctx, { project: 'flantastic-4' });
    expect(e).toMatchObject({ id: r.json.id, kind: 'enrich', to: 'agent', agent: 'cid-manager', state: 'open' });
    expect(e.text).toContain('doneWhen, context, single');
    expect(e.text).toContain('docs/task-rubric.md');
    expect(e.text).toContain('stack check tasks/flantastic-4.md:7');
    expect((await storage.read('tasks/flantastic-4.md')).content).toBe(F4);
  });

  // @req FR:product-reset/quality.enrich
  it('returns the open message instead of sending a second one', async () => {
    const { ctx, call } = await mk();
    const a = await call('owner', '/tasks/flantastic-4:6/enrich');
    const b = await call('owner', '/tasks/flantastic-4:6/enrich');
    expect(b.status).toBe(202);
    expect(b.json.id).toBe(a.json.id);
    expect(await listInbox(ctx, { project: 'flantastic-4' })).toHaveLength(1);
  });

  // @req FR:product-reset/api.enrich @req FR:product-reset/quality.enrich
  it('refuses a row that scores 4, a missing row, and a non-owner caller', async () => {
    const { call, mint } = await mk();
    expect((await call('owner', '/tasks/flantastic-4:7/enrich')).status).toBe(409);
    expect((await call('owner', '/tasks/flantastic-4:99/enrich')).status).toBe(404);
    expect((await call('owner', '/tasks/nope/enrich')).status).toBe(422);
    expect((await call(await mint('tasks:write'), '/tasks/flantastic-4:6/enrich')).status).toBe(403);
  });

  // @req FR:agent-delivery/pick.entries @req FR:product-reset/quality.enrich
  it('delivery picks the enrich message up, on a 🙋 row too', async () => {
    const { ctx, call } = await mk();
    const r = await call('owner', '/tasks/flantastic-4:6/enrich');
    expect((await pendingDeliveries(ctx)).map((e) => e.id)).toEqual([r.json.id]);
  });
});
