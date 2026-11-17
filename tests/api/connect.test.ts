/**
 * Connect routes: owner only, 404 without the service, no secrets in replies; GET /calendar says not-connected with no account.
 * @req FR:connect-accounts/api.get @req FR:connect-accounts/api.setup @req FR:connect-accounts/api.start @req FR:connect-accounts/api.poll
 * @req FR:connect-accounts/api.drafts @req FR:connect-accounts/api.remove @req FR:connect-accounts/cal.fallback
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { createAuth, createTokenService, MemoryTokenStore, routeScope } from '../../src/api';
import { createApiHandler, ROUTES, type ApiDeps } from '../../src/api/handler';
import { MemoryStorage } from '../../src/core/storage';
import { CalendarNotConnected } from '../../src/calendar/accounts';
import type { Connect, ConnectSession } from '../../src/graph/connect';

const NOW = new Date('2026-11-12T18:00:00Z');
const OWNER = Buffer.from(JSON.stringify({ userDetails: 'me', identityProvider: 'github', userRoles: ['authenticated'] })).toString('base64');
const SESSION: ConnectSession = { id: 's1', method: 'browser', state: 'waiting', url: 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?x=1' };

function fakeConnect(clientId = true) {
  const calls: unknown[][] = [];
  const c: Connect = {
    hasClientId: () => clientId,
    start: async (o) => { calls.push(['start', o]); if (!clientId) throw Object.assign(new Error('setup needed'), { code: 'setup_needed' }); return SESSION; },
    get: (id) => (id === 's1' ? SESSION : undefined),
    accounts: async () => [{ account: 'me@outlook.com', type: 'personal', mail: true, calendar: true, drafts: false, state: 'connected' }],
    setDrafts: async (a, on) => { calls.push(['drafts', a, on]); return on ? SESSION : { ok: true as const }; },
    remove: async (a) => { calls.push(['remove', a]); },
    setup: async () => { calls.push(['setup']); return { state: 'needs-azure-signin' }; },
  };
  return { c, calls };
}

function mk(extra: Partial<ApiDeps> = {}) {
  const tokens = createTokenService({ store: new MemoryTokenStore(), now: () => NOW });
  const auth = createAuth({ owners: [], tokens });
  const deps = { storage: new MemoryStorage(), now: () => NOW, ...extra };
  const owner = createApiHandler({ ...deps, authorize: () => true });
  const token = auth.wrap(createApiHandler({ ...deps, authorize: auth.authorize }));
  const call = async (method: string, path: string, body?: unknown, who: 'owner' | string = 'owner') => {
    const headers: Record<string, string> = { ...(who === 'owner' ? { 'x-ms-client-principal': OWNER } : { authorization: `Bearer ${who}` }), ...(body ? { 'content-type': 'application/json' } : {}) };
    const res = await (who === 'owner' ? owner : token)(new Request(`https://x.test/api${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }));
    return { status: res.status, json: (await res.json()) as any };
  };
  return { call, mint: async () => (await tokens.create({ name: 't', scopes: ['tasks:read', 'tasks:write'] as never })).token };
}

describe('connect routes', () => {
  it('are registered, scoped, documented', () => {
    for (const n of ['connect.get', 'connect.setup', 'connect.start', 'connect.poll', 'connect.drafts', 'connect.remove']) {
      expect(ROUTES.some((r) => r.name === n)).toBe(true);
      expect(routeScope(n)).toBeDefined();
    }
    expect(readFileSync(join(__dirname, '../../docs/api/openapi.yaml'), 'utf8')).toContain('/connect/sign-in:');
  });
  it('404 on a host with no connect service', async () => {
    expect((await mk().call('GET', '/connect')).status).toBe(404);
  });
  it('owner only', async () => {
    const m = mk({ connect: fakeConnect().c });
    expect((await m.call('GET', '/connect', undefined, await m.mint())).status).toBe(403);
    expect((await m.call('POST', '/connect/sign-in', {}, await m.mint())).status).toBe(403);
  });
  it('lists setup and accounts; starts, polls, toggles drafts, removes, runs setup', async () => {
    const f = fakeConnect();
    const { call } = mk({ connect: f.c });
    expect((await call('GET', '/connect')).json).toEqual({ setup: { clientId: true }, accounts: [{ account: 'me@outlook.com', type: 'personal', mail: true, calendar: true, drafts: false, state: 'connected' }] });
    const s = await call('POST', '/connect/sign-in', { drafts: true, method: 'device', account: 'Me@Outlook.com' });
    expect(s).toEqual({ status: 201, json: SESSION });
    expect(f.calls[0]).toEqual(['start', { drafts: true, method: 'device', account: 'me@outlook.com' }]);
    expect((await call('GET', '/connect/sign-in/s1')).json).toEqual(SESSION);
    expect((await call('GET', '/connect/sign-in/zz')).status).toBe(404);
    expect((await call('POST', '/connect/drafts', { account: 'me@outlook.com', on: false })).json).toEqual({ ok: true });
    expect((await call('POST', '/connect/drafts', { account: 'me@outlook.com', on: true })).json).toEqual(SESSION);
    expect((await call('POST', '/connect/remove', { account: 'me@outlook.com' })).json).toEqual({ ok: true });
    expect((await call('POST', '/connect/setup')).json).toEqual({ state: 'needs-azure-signin' });
  });
  it('bad input: an account that is not a mailbox address, an unknown method', async () => {
    const { call } = mk({ connect: fakeConnect().c });
    expect((await call('POST', '/connect/remove', { account: 'x; rm -rf ~' })).status).toBe(422);
    expect((await call('POST', '/connect/sign-in', { method: 'password' })).status).toBe(422);
  });
  it('no client id: start is 409 setup needed', async () => {
    const { call } = mk({ connect: fakeConnect(false).c });
    const r = await call('POST', '/connect/sign-in', {});
    expect(r.status).toBe(409);
    expect(JSON.stringify(r.json)).toMatch(/setup/i);
  });
});

// @req FR:connect-accounts/cal.fallback
it('GET /calendar: a provider with no account says not-connected', async () => {
  const { call } = mk({ calendar: { events: async () => { throw new CalendarNotConnected(); } } });
  const r = await call('GET', '/calendar?from=2026-11-12T00:00:00Z&to=2026-11-13T00:00:00Z');
  expect(r.json).toMatchObject({ configured: false, items: [], source: { kind: 'calendar', state: 'not-connected' } });
});
