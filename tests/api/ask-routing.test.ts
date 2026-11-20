import { createApiHandler, ROUTES } from '../../src/api/handler';
import { createAuth, createTokenService, MemoryTokenStore, routeScope } from '../../src/api';
import { MemoryStorage } from '../../src/core/storage';
import { readFileSync } from 'fs';
import { join } from 'path';

const NOW = new Date('2026-11-19T18:00:00Z');
const LINK = '[Stack architect](#local_abc)';
const BODY = { ask: 'Approve merging PR 879 into dev', kind: 'approve', why: 'CI is green', recommend: 'Approve', agent: LINK };

async function mk() {
  const storage = new MemoryStorage();
  const tokens = createTokenService({ store: new MemoryTokenStore(), now: () => NOW });
  const auth = createAuth({ owners: [], tokens });
  const token = auth.wrap(createApiHandler({ storage, authorize: auth.authorize, now: () => NOW }));
  const owner = createApiHandler({ storage, authorize: () => true, now: () => NOW });
  const w = (await tokens.create({ name: 'cos', scopes: ['tasks:write', 'tasks:read'] as never })).token;
  const call = async (who: 'owner' | 'token', method: 'GET' | 'POST', path: string, body?: unknown) => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (who === 'owner') headers['x-ms-client-principal'] = Buffer.from(JSON.stringify({ userDetails: 'me', identityProvider: 'github', userRoles: ['authenticated'] })).toString('base64');
    else headers.authorization = `Bearer ${w}`;
    const req = new Request(`https://x.test/api${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) });
    const res = await (who === 'owner' ? owner : token)(req);
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : undefined };
  };
  return { call };
}

// @req FR:ask-routing/reply.surfaces @req FR:ask-routing/addr.api
describe('ask routing routes', () => {
  it('asks.reply is registered with tasks:write and in the OpenAPI document', () => {
    expect(routeScope('asks.reply')).toBe('tasks:write');
    expect(ROUTES.some((r) => r.name === 'asks.reply' && r.method === 'POST')).toBe(true);
    expect(readFileSync(join(__dirname, '../../docs/api/openapi.yaml'), 'utf8')).toContain('/asks/{key}/reply:');
  });
  it('a token puts an ask with an agent link; a bad link is 400', async () => {
    const { call } = await mk();
    expect((await call('token', 'POST', '/asks/a1', BODY)).status).toBe(200);
    expect((await call('token', 'POST', '/asks/a2', { ...BODY, agent: 'not a link' })).status).toBe(400);
    const list = await call('owner', 'GET', '/asks?state=all');
    expect(list.json.items[0]).toMatchObject({ key: 'a1', agent: LINK, turn: 'owner' });
  });
  // @req FR:ask-routing/addr.context
  it('a new token ask without why is 400', async () => {
    const { call } = await mk();
    const { why: _w, ...noWhy } = BODY;
    const r = await call('token', 'POST', '/asks/a1', noWhy);
    expect(r.status).toBe(400);
    expect(JSON.stringify(r.json)).toContain('why is required');
  });
  // @req FR:ask-routing/ask.put
  it('only the owner writes from owner; the owner question lists as the agent turn', async () => {
    const { call } = await mk();
    expect((await call('token', 'POST', '/asks/q1', { ask: 'Status?', from: 'owner', agent: LINK, why: 'x' })).status).toBe(403);
    expect((await call('owner', 'POST', '/asks/q1', { ask: 'Status?', from: 'owner', agent: LINK })).status).toBe(200);
    expect((await call('owner', 'GET', '/asks?state=all&turn=agent')).json.items.map((i: { key: string }) => i.key)).toEqual(['q1']);
    expect((await call('owner', 'GET', '/asks?state=all&turn=owner')).json.items).toEqual([]);
  });
  it('the agent replies with its token; the owner sees the reply as his turn', async () => {
    const { call } = await mk();
    await call('owner', 'POST', '/asks/q1', { ask: 'Status?', from: 'owner', agent: LINK });
    const r = await call('token', 'POST', '/asks/q1/reply', { text: 'Green' });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ changed: true });
    const item = (await call('owner', 'GET', '/asks?state=all')).json.items[0];
    expect(item).toMatchObject({ key: 'q1', state: 'answered', text: 'Green', turn: 'owner' });
    expect((await call('token', 'POST', '/asks/q1/reply', {})).status).toBe(400);
  });
});
