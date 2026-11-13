/** Delivery state and sign-in over the API. @req FR:agent-delivery/state.api @req FR:agent-delivery/login.signin @req FR:agent-delivery/live.offer */
import { readFileSync } from 'fs';
import { join } from 'path';
import { createAuth, createTokenService, MemoryTokenStore, routeScope } from '../../src/api';
import { createApiHandler, ROUTES, type ApiDeps } from '../../src/api/handler';
import { MemoryStorage } from '../../src/core/storage';

const NOW = new Date('2026-11-12T10:00:00Z');
const OWNER = Buffer.from(JSON.stringify({ userDetails: 'me', identityProvider: 'github', userRoles: ['authenticated'] })).toString('base64');

async function mk(extra: Partial<ApiDeps> = {}) {
  const storage = new MemoryStorage();
  const tokens = createTokenService({ store: new MemoryTokenStore(), now: () => NOW });
  const auth = createAuth({ owners: [], tokens });
  const deps = { storage, now: () => NOW, ...extra };
  const owner = createApiHandler({ ...deps, authorize: () => true });
  const token = auth.wrap(createApiHandler({ ...deps, authorize: auth.authorize }));
  const call = async (method: string, path: string, who: 'owner' | string = 'owner') => {
    const headers: Record<string, string> = who === 'owner' ? { 'x-ms-client-principal': OWNER } : { authorization: `Bearer ${who}` };
    const res = await (who === 'owner' ? owner : token)(new Request(`https://x.test/api${path}`, { method, headers }));
    return { status: res.status, json: (await res.json()) as any };
  };
  return { call, mint: async () => (await tokens.create({ name: 't', scopes: ['tasks:read', 'tasks:write'] as never })).token };
}

describe('/inbox/delivery', () => {
  it('routes are registered, scoped, documented', () => {
    expect(routeScope('inbox.delivery')).toBe('tasks:read');
    expect(routeScope('inbox.deliveryLogin')).toBe('tasks:write');
    expect(ROUTES.some((r) => r.name === 'inbox.delivery' && r.method === 'GET')).toBe(true);
    const doc = readFileSync(join(__dirname, '../../docs/api/openapi.yaml'), 'utf8');
    expect(doc).toContain('/inbox/delivery:');
    expect(doc).toContain('/inbox/delivery/login:');
  });

  it('returns the state for the row; 404 without delivery; 403 for tokens', async () => {
    const seen: string[] = [];
    const status = { mode: 'claude', login: 'ok', items: { 'in-1': { state: 'working', agent: 'cid' } } };
    const { call, mint } = await mk({ delivery: { status: async (r) => { seen.push(r); return status; }, login: () => ({ started: true }) } });
    expect(await call('GET', '/inbox/delivery?ref=alpha:4')).toEqual({ status: 200, json: status });
    expect(seen).toEqual(['alpha:4']);
    expect((await call('GET', '/inbox/delivery?ref=nope')).status).toBe(422);
    expect((await call('GET', '/inbox/delivery?ref=alpha:4', await mint())).status).toBe(403);
    expect(await call('POST', '/inbox/delivery/login')).toEqual({ status: 200, json: { started: true } });
    expect((await call('POST', '/inbox/delivery/login', await mint())).status).toBe(403);
    const none = await mk();
    expect((await none.call('GET', '/inbox/delivery?ref=alpha:4')).status).toBe(404);
    expect((await none.call('POST', '/inbox/delivery/login')).status).toBe(404);
  });
});

// @req FR:settings/agents.api
describe('/inbox/delivery summary', () => {
  it('without a ref returns {mode, login}; owner only; 404 without delivery', async () => {
    const { call, mint } = await mk({ delivery: { status: async () => ({}), summary: () => ({ mode: 'off', login: 'expired' }), login: () => ({ started: true }) } });
    expect(await call('GET', '/inbox/delivery')).toEqual({ status: 200, json: { mode: 'off', login: 'expired' } });
    expect((await call('GET', '/inbox/delivery', await mint())).status).toBe(403);
    expect((await (await mk()).call('GET', '/inbox/delivery')).status).toBe(404);
  });
});
