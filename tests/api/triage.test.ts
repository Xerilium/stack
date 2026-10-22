import { createApiHandler, ROUTES } from '../../src/api/handler';
import { createAuth, createTokenService, MemoryTokenStore, routeScope } from '../../src/api';
import { MemoryStorage } from '../../src/core/storage';
import { readFileSync } from 'fs';
import { join } from 'path';

const NOW = new Date('2026-10-22T18:00:00Z');
const DOC = `# Alpha

## 🔄 Active

- [ ] Plain task
- [ ] Triage task 🤖:triage
- [ ] Assist task 🤖:assist
  - [ ] 🪄 Agent child
`;

async function mk() {
  const storage = new MemoryStorage();
  await storage.write('tasks/alpha.md', DOC);
  const tokens = createTokenService({ store: new MemoryTokenStore(), now: () => NOW });
  const auth = createAuth({ owners: [], tokens });
  const h = auth.wrap(createApiHandler({ storage, authorize: auth.authorize, now: () => NOW }));
  const mint = async (...scopes: string[]) => (await tokens.create({ name: 't', scopes: scopes as never })).token;
  const call = async (token: string | null, path: string, body: unknown) => {
    const headers: Record<string, string> = { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) };
    const res = await h(new Request(`https://x.test/api${path}`, { method: 'POST', headers, body: JSON.stringify(body) }));
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : undefined };
  };
  return { storage, mint, call };
}

// @req FR:ai-triage-assist/api.routes
describe('triage routes', () => {
  it('are registered, mapped to tasks:write, and denied for unmapped/read-only callers', async () => {
    for (const n of ['tasks.triage', 'tasks.claim', 'tasks.result']) {
      expect(routeScope(n)).toBe('tasks:write');
      expect(ROUTES.some((r) => r.name === n && r.method === 'POST')).toBe(true);
    }
    const { call, mint, storage } = await mk();
    const ro = await mint('tasks:read');
    for (const p of ['/tasks/triage', '/tasks/claim', '/tasks/result']) {
      expect((await call(null, p, { ref: 'alpha:5' })).status).toBe(401);
      expect((await call(ro, p, { ref: 'alpha:5' })).status).toBe(403);
    }
    expect((await storage.read('tasks/alpha.md')).content).toBe(DOC);
  });

  it('triage applies a suggestion', async () => {
    const { call, mint, storage } = await mk();
    const t = await mint('tasks:write');
    const r = await call(t, '/tasks/triage', { ref: 'alpha:5', agent: 'Draft', human: 'Decide', priority: '🔺' });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ changed: true, ref: 'alpha:5', applied: ['priority'] });
    expect(r.json.added).toHaveLength(2);
    expect((await storage.read('tasks/alpha.md')).content).toContain('🪄 Draft');
  });

  it('autonomy none is forbidden, not silently ignored', async () => {
    const { call, mint, storage } = await mk();
    const t = await mint('tasks:write');
    const r = await call(t, '/tasks/triage', { ref: 'alpha:4', agent: 'x' });
    expect(r.status).toBe(403);
    expect(r.json.error.code).toBe('forbidden');
    expect((await storage.read('tasks/alpha.md')).content).toBe(DOC);
  });

  it('claim and result', async () => {
    const { call, mint, storage } = await mk();
    const t = await mint('write');
    expect((await call(t, '/tasks/claim', { ref: 'alpha:7' })).json).toMatchObject({ changed: true, ref: 'alpha:7' });
    const r = await call(t, '/tasks/result', { ref: 'alpha:7', outcome: 'done', summary: 'did it', complete: true });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ logged: true, completed: true, deferred: false });
    expect((await storage.read('tasks/logs/alpha.md')).content).toContain('did it');
    const d = await call(t, '/tasks/result', { ref: 'alpha:6', outcome: 'done', summary: 'parent', complete: true });
    expect(d.json).toMatchObject({ completed: false, deferred: true });
    expect(d.json.human).toMatch(/^alpha:\d+$/);
  });

  it('validates strictly', async () => {
    const { call, mint } = await mk();
    const t = await mint('write');
    const code = async (p: string, b: unknown) => (await call(t, p, b)).status;
    expect(await code('/tasks/triage', {})).toBe(422);
    expect(await code('/tasks/triage', { ref: 'alpha:5', autonomy: 'full' })).toBe(422);
    expect(await code('/tasks/triage', { ref: 'alpha:5', agent: 'a\nb' })).toBe(422);
    expect(await code('/tasks/triage', { ref: 'alpha:5', priority: 'None' })).toBe(422);
    expect(await code('/tasks/triage', { ref: 'alpha:5', status: '🚧' })).toBe(422);
    expect(await code('/tasks/claim', { ref: 'alpha:7', actor: 'bot' })).toBe(422);
    expect(await code('/tasks/result', { ref: 'alpha:7', outcome: 'done', summary: 'x', actor: 'bot' })).toBe(422);
    expect(await code('/tasks/result', { ref: 'alpha:7', outcome: 'merged', summary: 'x' })).toBe(422);
    expect(await code('/tasks/result', { ref: 'alpha:7', outcome: 'done' })).toBe(422);
    expect(await code('/tasks/result', { ref: 'alpha:7', outcome: 'done', summary: 'a\nb' })).toBe(422);
    expect(await code('/tasks/result', { ref: 'alpha:99', outcome: 'done', summary: 'x' })).toBe(404);
  });

  // @req FR:ai-triage-assist/result.actor
  it('stamps the actor from the authenticated token', async () => {
    const { call, mint, storage } = await mk();
    const t = await mint('write');
    await call(t, '/tasks/result', { ref: 'alpha:7', outcome: 'done', summary: 'x' });
    const log = (await storage.read('tasks/logs/alpha.md')).content;
    expect(log).toMatch(/- actor: token:[0-9a-f]{16}\n/);
    expect(log).toContain(`token:${t.slice(4, 20)}`);
  });

  // @req FR:ai-triage-assist/autonomy.set
  it('agent-reachable writes cannot carry the autonomy marker', async () => {
    const { call, mint, storage } = await mk();
    const t = await mint('write');
    for (const text of ['sneaky 🤖:full', 'x 🤖\u200b:full', '🤖:assist']) {
      expect((await call(t, '/tasks', { project: 'alpha', text })).status).toBe(422);
      expect((await call(t, '/capture', { text: `${text} #alpha` })).status).toBe(422);
    }
    expect((await call(t, '/tasks/complete', { ref: 'alpha:7', summary: 'ok 🤖:full' })).status).toBe(422);
    expect((await storage.read('tasks/alpha.md')).content).toBe(DOC);
  });

  it('is documented in openapi', () => {
    const y = readFileSync(join(__dirname, '../../docs/api/openapi.yaml'), 'utf8');
    for (const p of ['/tasks/triage:', '/tasks/claim:', '/tasks/result:']) expect(y).toContain(p);
  });
});
