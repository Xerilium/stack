import { ROUTES } from '../../src/api/handler';
import { routeScope } from '../../src/api/auth';
import { principal, setup } from './helpers';

const SAMPLE: Record<string, string> = { '{ref}': 'alpha:3', '{name}': 'alpha' };
const pathOf = (doc: string) => '/api' + doc.replace(/\{\w+\}/g, (m) => SAMPLE[m]);

// @req FR:auth-security/docs.routes @req FR:auth-security/authorize.deny
describe('every route denies unauthenticated requests', () => {
  it.each(ROUTES.map((r) => [r.name, r.method, r.doc]))('%s', async (_n, method, doc) => {
    const { call, storage } = setup();
    const r = await call(method, pathOf(doc), method === 'POST' ? { body: {} } : {});
    expect(r.status).toBe(401);
    expect(r.json.error.code).toBe('unauthorized');
    expect(await storage.list()).toEqual([]);
  });
  it('denies unknown routes, wrong methods, other verbs, and paths outside the base', async () => {
    const { call } = setup();
    for (const [m, p] of [['GET', '/api/nope'], ['DELETE', '/api/tasks'], ['PUT', '/api/next'], ['GET', '/'], ['GET', '/api'], ['OPTIONS', '/api/tasks'],
      ['GET', '/api/auth/tokens'], ['POST', '/api/auth/tokens'], ['POST', '/api/auth/tokens/0000000000000000/revoke'], ['GET', '/api/%zz']]) {
      expect((await call(m, p)).status).toBe(401);
    }
  });
  it('denies with junk credentials', async () => {
    const { call } = setup();
    for (const headers of [
      { 'x-ms-client-principal': 'garbage' }, { 'x-ms-client-principal': principal({ userRoles: ['anonymous'] }) },
      { authorization: 'Bearer nope' }, { authorization: 'Basic abc' }, { 'x-stack-token': '' }, { authorization: 'Bearer ' },
    ]) {
      const r = await call('GET', '/api/next', { headers: headers as unknown as Record<string, string> });
      expect([401, 403]).toContain(r.status);
    }
  });
});

// @req FR:auth-security/authorize.session @req FR:auth-security/session.output
describe('owner session', () => {
  it('lets the owner through every route', async () => {
    const { call } = setup();
    await call('POST', '/api/projects', { session: true, body: { name: 'Alpha' } });
    for (const r of ROUTES) {
      const res = await call(r.method, pathOf(r.doc), { session: true, ...(r.method === 'POST' ? { body: {} } : {}) });
      expect([401, 403]).not.toContain(res.status);
    }
  });
  it('403 for a signed-in non-owner, 401 for a bad principal', async () => {
    const { call } = setup();
    const other = { 'x-ms-client-principal': principal({ userId: 'intruder' }) };
    expect((await call('GET', '/api/next', { headers: other })).status).toBe(403);
    expect((await call('POST', '/api/tasks', { headers: other, body: { project: 'a', text: 'x' } })).status).toBe(403);
    expect((await call('GET', '/api/next', { headers: { 'x-ms-client-principal': 'zzz' } })).status).toBe(401);
  });
  it('denies everyone when no owner is configured', async () => {
    const { call } = setup({ owners: '' });
    expect((await call('GET', '/api/next', { session: true })).status).toBe(403);
  });
  // @req FR:auth-security/session.csrf
  it('denies a session write from another origin, allows same origin or none', async () => {
    const { call } = setup();
    const body = { project: 'a', text: 'x' };
    expect((await call('POST', '/api/tasks', { session: true, body, headers: { origin: 'https://evil.test' } })).status).toBe(403);
    expect((await call('POST', '/api/tasks', { session: true, body, headers: { origin: 'null' } })).status).toBe(403);
    expect((await call('POST', '/api/tasks', { session: true, body, headers: { origin: 'https://stack.test' } })).status).not.toBe(403);
    expect((await call('GET', '/api/next', { session: true, headers: { origin: 'https://evil.test' } })).status).toBe(200);
  });
});

// @req FR:auth-security/authorize.bearer @req FR:auth-security/authorize.scope
describe('token auth', () => {
  const tok = async (s: ReturnType<typeof setup>, scopes: string[]) => (await s.tokens.create({ name: 't', scopes })).token;
  const bearer = (t: string) => ({ authorization: `Bearer ${t}` });
  it('accepts Bearer and X-Stack-Token', async () => {
    const s = setup();
    const t = await tok(s, ['read']);
    expect((await s.call('GET', '/api/next', { headers: bearer(t) })).status).toBe(200);
    expect((await s.call('GET', '/api/next', { headers: { 'x-stack-token': t } })).status).toBe(200);
    expect((await s.call('GET', '/api/next', { headers: { authorization: `bearer ${t}` } })).status).toBe(200);
  });
  // @req FR:auth-security/authorize.bearer.invalid
  it('401 for a bad token, even with a valid owner session', async () => {
    const s = setup();
    const r = await s.call('GET', '/api/next', { session: true, headers: bearer('stk_0000000000000000.' + 'A'.repeat(43)) });
    expect(r.status).toBe(401);
    const t = await tok(s, ['read']);
    await s.tokens.revoke(t.slice(4, 20));
    expect((await s.call('GET', '/api/next', { headers: bearer(t) })).status).toBe(401);
  });
  // @req FR:auth-security/authorize.scope.table
  it('maps every route to a required scope and denies unmapped names', () => {
    for (const r of ROUTES) expect(routeScope(r.name)).toMatch(/^(tasks|projects|summaries):(read|write)$/);
    expect(routeScope('unknown')).toBeNull();
    expect(routeScope('tasks.nuke')).toBeNull();
    expect(routeScope('__proto__')).toBeNull();
    expect(routeScope('constructor')).toBeNull();
  });
  // @req FR:auth-security/authorize.scope.deny
  it('enforces the scope matrix on every route', async () => {
    const s = setup();
    await s.call('POST', '/api/projects', { session: true, body: { name: 'Alpha' } });
    const sets: Record<string, string[]> = {
      read: ['read'], write: ['write'], tasksRead: ['tasks:read'], tasksWrite: ['tasks:write'], projRead: ['projects:read'],
      projWrite: ['projects:write'], sumRead: ['summaries:read'],
    };
    for (const [label, scopes] of Object.entries(sets)) {
      const t = await tok(s, scopes);
      for (const r of ROUTES) {
        const need = routeScope(r.name)!;
        const [area, kind] = need.split(':');
        const ok = scopes.includes(need) || scopes.includes(kind);
        const res = await s.call(r.method, pathOf(r.doc), { headers: bearer(t), ...(r.method === 'POST' ? { body: {} } : {}) });
        if (ok) expect([401, 403]).not.toContain(res.status);
        else expect({ label, route: r.name, area, status: res.status }).toEqual({ label, route: r.name, area, status: 403 });
      }
    }
  });
  it('a write scope does not imply read; unknown routes deny tokens', async () => {
    const s = setup();
    const t = await tok(s, ['write']);
    expect((await s.call('GET', '/api/tasks', { headers: bearer(t) })).status).toBe(403);
    const full = await tok(s, [...['read', 'write']]);
    expect((await s.call('GET', '/api/nope', { headers: bearer(full) })).status).toBe(403);
    expect((await s.call('DELETE', '/api/tasks', { headers: bearer(full) })).status).toBe(403);
  });
  it('tokens skip the origin check (no ambient credentials)', async () => {
    const s = setup();
    const t = await tok(s, ['write']);
    const r = await s.call('POST', '/api/tasks', { headers: { ...bearer(t), origin: 'https://other.test' }, body: { project: 'a', text: 'x' } });
    expect(r.status).not.toBe(403);
  });
});

// @req FR:auth-security/authorize.fail
describe('fail closed', () => {
  it('403 without detail when the token store throws', async () => {
    const s = setup();
    const t = (await s.tokens.create({ name: 't', scopes: ['read'] })).token;
    jest.spyOn(s.store, 'read').mockRejectedValue(new Error('disk exploded /secret/path'));
    const r = await s.call('GET', '/api/next', { headers: { authorization: `Bearer ${t}` } });
    expect(r.status).toBe(403);
    expect(r.text).not.toContain('disk');
    expect(r.text).not.toContain('/secret');
  });
});
