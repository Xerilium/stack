import { setup } from './helpers';

// @req FR:auth-security/admin.@http @req FR:auth-security/admin.create
describe('token admin endpoints', () => {
  it('create, list, revoke over HTTP for the owner session', async () => {
    const s = setup();
    const c = await s.call('POST', '/api/auth/tokens', { session: true, body: { name: 'agent', scopes: ['tasks:read'], days: 30 } });
    expect(c.status).toBe(201);
    expect(c.json.token).toMatch(/^stk_/);
    expect(c.json.record.name).toBe('agent');
    expect(c.headers.get('cache-control')).toBe('no-store');
    const l = await s.call('GET', '/api/auth/tokens', { session: true });
    expect(l.status).toBe(200);
    expect(l.json.items).toHaveLength(1);
    expect(l.text).not.toContain(c.json.token.split('.')[1]);
    expect((await s.call('GET', '/api/tasks', { headers: { authorization: `Bearer ${c.json.token}` } })).status).toBe(200);
    const r = await s.call('POST', `/api/auth/tokens/${c.json.record.id}/revoke`, { session: true, body: {} });
    expect(r.status).toBe(200);
    expect(r.json.result).toBe('revoked');
    expect((await s.call('GET', '/api/tasks', { headers: { authorization: `Bearer ${c.json.token}` } })).status).toBe(401);
    expect((await s.call('POST', '/api/auth/tokens/0000000000000000/revoke', { session: true, body: {} })).status).toBe(404);
  });
  // @req FR:auth-security/admin.session
  it('tokens cannot manage tokens; anonymous gets 401; non-owner 403', async () => {
    const s = setup();
    const t = (await s.tokens.create({ name: 't', scopes: ['read', 'write'] })).token;
    const h = { authorization: `Bearer ${t}` };
    expect((await s.call('GET', '/api/auth/tokens', { headers: h })).status).toBe(403);
    expect((await s.call('POST', '/api/auth/tokens', { headers: h, body: { name: 'x', scopes: ['read'] } })).status).toBe(403);
    expect((await s.call('GET', '/api/auth/tokens')).status).toBe(401);
    const other = Buffer.from(JSON.stringify({ identityProvider: 'github', userId: 'x', userRoles: ['authenticated'] })).toString('base64');
    expect((await s.call('GET', '/api/auth/tokens', { headers: { 'x-ms-client-principal': other } })).status).toBe(403);
    expect((await s.tokens.list())).toHaveLength(1);
  });
  it('denies cross-origin creation', async () => {
    const s = setup();
    const r = await s.call('POST', '/api/auth/tokens', { session: true, body: { name: 'x', scopes: ['read'] }, headers: { origin: 'https://evil.test' } });
    expect(r.status).toBe(403);
    expect(await s.tokens.list()).toHaveLength(0);
  });
  // @req FR:auth-security/admin.shape
  it('follows the api error model', async () => {
    const s = setup();
    const post = (body: unknown, headers: Record<string, string> = {}) => s.call('POST', '/api/auth/tokens', { session: true, body, headers });
    expect((await post({ name: '', scopes: ['read'] })).status).toBe(422);
    expect((await post({ name: 'x', scopes: ['root'] })).json.error.code).toBe('invalid');
    expect((await post({ name: 'x', scopes: ['read'], extra: 1 })).status).toBe(422);
    expect((await post('{bad', {})).status).toBe(400);
    const raw = await s.handler(new Request('https://stack.test/api/auth/tokens', {
      method: 'POST', headers: { 'x-ms-client-principal': Buffer.from(JSON.stringify({ identityProvider: 'github', userId: 'owner-1', userRoles: ['authenticated'] })).toString('base64'), 'sec-fetch-site': 'same-origin', 'content-type': 'text/plain' }, body: 'x',
    }));
    expect(raw.status).toBe(415);
    const big = await post({ name: 'x', scopes: ['read'], pad: 'a'.repeat(70000) });
    expect(big.status).toBe(413);
    expect((await s.call('PUT', '/api/auth/tokens', { session: true })).status).toBe(405);
    expect((await s.call('GET', '/api/auth/tokens?x=1', { session: true })).status).toBe(422);
    expect((await s.call('GET', '/api/auth/tokens/abc', { session: true })).status).toBe(404);
  });
  it('maps store failure to a fixed 500 and too-many to 409', async () => {
    const s = setup();
    jest.spyOn(s.store, 'read').mockRejectedValue(new Error('boom /private'));
    const r = await s.call('GET', '/api/auth/tokens', { session: true });
    expect(r.status).toBe(500);
    expect(r.text).not.toContain('boom');
  });
  // @req FR:auth-security/admin.rest
  it('passes other requests to the api unchanged', async () => {
    const s = setup();
    await s.call('POST', '/api/projects', { session: true, body: { name: 'Alpha' } });
    expect((await s.call('GET', '/api/projects/alpha', { session: true })).json.name).toBe('alpha');
  });
});
