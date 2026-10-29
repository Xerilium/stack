import { createApiHandler, ROUTES } from '../../src/api/handler';
import { createAuth, createTokenService, MemoryTokenStore, routeScope } from '../../src/api';
import { MemoryStorage } from '../../src/core/storage';
import { readFileSync } from 'fs';
import { join } from 'path';

const NOW = new Date('2026-10-28T18:00:00Z');
const DOC = `# Alpha

## 🔄 Active

- [ ] Launch
  - [ ] 🪄 Draft notes https://github.com/o/r/pull/7
  - [ ] 🙋 Approve the notes
`;

async function mk(prs?: Parameters<typeof createApiHandler>[0]['prs']) {
  const storage = new MemoryStorage();
  await storage.write('tasks/alpha.md', DOC);
  const tokens = createTokenService({ store: new MemoryTokenStore(), now: () => NOW });
  const auth = createAuth({ owners: [], tokens });
  const token = auth.wrap(createApiHandler({ storage, authorize: auth.authorize, now: () => NOW, prs }));
  // The owner session: SWA principal header, no token (the local `stack web` server marks its one user the same way).
  const owner = createApiHandler({ storage, authorize: () => true, now: () => NOW, prs });
  const mint = async (...scopes: string[]) => (await tokens.create({ name: 't', scopes: scopes as never })).token;
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

// @req FR:agent-inbox/api.send @req FR:agent-inbox/api.list @req FR:agent-inbox/api.handle @req FR:agent-inbox/api.agents
describe('inbox and agents routes', () => {
  it('are registered with their scopes and in the OpenAPI document', () => {
    const want: [string, string, string][] = [['inbox.send', 'POST', 'tasks:write'], ['inbox.list', 'GET', 'tasks:read'], ['inbox.handle', 'POST', 'tasks:write'], ['agents.list', 'GET', 'tasks:read']];
    for (const [name, method, scope] of want) {
      expect(routeScope(name)).toBe(scope);
      expect(ROUTES.some((r) => r.name === name && r.method === method)).toBe(true);
    }
    const doc = readFileSync(join(__dirname, '../../docs/api/openapi.yaml'), 'utf8');
    for (const p of ['/inbox:', '/inbox/handled:', '/agents:']) expect(doc).toContain(p);
  });

  it('owner sends; tokens cannot write in the owner voice', async () => {
    const { call, mint, storage } = await mk();
    const r = await call('owner', 'POST', '/inbox', { ref: 'alpha:5', text: 'Keep it short', expect: '🪄 Draft notes https://github.com/o/r/pull/7' });
    expect(r.status).toBe(201);
    expect(r.json).toEqual({ id: expect.stringMatching(/^in-/), path: 'tasks/inbox/alpha.md' });
    const w = await mint('tasks:write');
    expect((await call(w, 'POST', '/inbox', { ref: 'alpha:5', text: 'spoof' })).status).toBe(403);
    expect((await call(null, 'POST', '/inbox', { ref: 'alpha:5', text: 'x' })).status).toBe(401);
    expect((await storage.read('tasks/inbox/alpha.md')).content).not.toContain('spoof');
  });

  it('validates the body and the row', async () => {
    const { call } = await mk();
    expect((await call('owner', 'POST', '/inbox', { ref: 'alpha:5', text: '' })).status).toBe(422);
    expect((await call('owner', 'POST', '/inbox', { ref: 'alpha:5', text: 'a\nb' })).status).toBe(422);
    expect((await call('owner', 'POST', '/inbox', { ref: 'alpha:5', text: 'x', kind: 'order' })).status).toBe(422);
    expect((await call('owner', 'POST', '/inbox', { ref: 'alpha:5', text: 'x', extra: 1 })).status).toBe(422);
    expect((await call('owner', 'POST', '/inbox', { ref: 'alpha:2', text: 'x' })).status).toBe(404);
    expect((await call('owner', 'POST', '/inbox', { ref: 'alpha:5', text: 'x', expect: 'stale' })).status).toBe(409);
  });

  it('agents list open entries and mark them handled', async () => {
    const { call, mint } = await mk();
    const sent = (await call('owner', 'POST', '/inbox', { ref: 'alpha:6', text: 'June 3', kind: 'decision' })).json;
    const ro = await mint('tasks:read');
    const rw = await mint('tasks:write');
    const list = await call(ro, 'GET', '/inbox');
    expect(list.status).toBe(200);
    expect(list.json.items).toEqual([expect.objectContaining({ id: sent.id, project: 'alpha', ref: 'alpha:6', row: 'alpha:6', kind: 'decision', to: 'human', text: 'June 3', state: 'open' })]);
    expect((await call(ro, 'POST', '/inbox/handled', { id: sent.id })).status).toBe(403);
    expect((await call(rw, 'POST', '/inbox/handled', { id: sent.id, note: 'Booked' })).json).toEqual({ changed: true });
    expect((await call(rw, 'POST', '/inbox/handled', { id: 'in-20260101T000000Z-0000' })).status).toBe(404);
    expect((await call(ro, 'GET', '/inbox')).json.items).toEqual([]);
    expect((await call(ro, 'GET', '/inbox?state=all&project=alpha')).json.items[0]).toMatchObject({ state: 'handled', note: 'Booked' });
    expect((await call(ro, 'GET', '/inbox?state=maybe')).status).toBe(422);
  });

  it('GET /agents returns activity with PR status from the provider', async () => {
    const { call, mint } = await mk(async (prs) => new Map(prs.map((p) => [p.url, { state: 'open', checks: 'failing', title: 'Notes', updatedAt: '2026-10-28T12:00:00Z' } as const])));
    const ro = await mint('tasks:read');
    const r = await call(ro, 'GET', '/agents');
    expect(r.status).toBe(200);
    expect(r.json.items).toEqual([expect.objectContaining({ ref: 'alpha:5', project: 'alpha', state: 'failing', waitingOn: 'alpha:6', prs: [expect.objectContaining({ repo: 'o/r', number: 7, checks: 'failing' })] })]);
  });
});
