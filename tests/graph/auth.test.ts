import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { assertSafeScopes, FileTokenCache, hasScope, graphToken, GraphSignInError, GraphSignInRequired, pollDeviceCode, scopesFor, startDeviceCode, type CachedToken } from '../../src/graph/auth';

const TENANT = 'organizations';
const CLIENT = '11111111-2222-3333-4444-555555555555';
type Hit = { url: string; form: URLSearchParams };
function fakeLogin(replies: Record<string, unknown>[]) {
  const hits: Hit[] = [];
  const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    hits.push({ url: String(url), form: new URLSearchParams(String(init?.body)) });
    const r = replies.shift() ?? { error: 'server_error' };
    return new Response(JSON.stringify(r), { status: 'error' in r ? 400 : 200 });
  }) as typeof globalThis.fetch;
  return { fetch, hits };
}
const tmp = () => mkdtempSync(join(tmpdir(), 'graph-'));

// @req FR:graph-signin/scope.sets
describe('scopes', () => {
  it('maps features to least-privilege scopes plus offline_access', () => {
    expect(scopesFor(['calendar'])).toEqual(['Calendars.Read', 'offline_access']);
    expect(scopesFor(['calendar', 'mail', 'drafts', 'calendar'])).toEqual(['Calendars.Read', 'Mail.Read', 'Mail.ReadWrite', 'offline_access']);
    expect(() => scopesFor(['send' as never])).toThrow();
  });
});

// @req FR:graph-signin/scope.never
describe('never send or write', () => {
  it('refuses send, write, shared, and .default scopes', () => {
    for (const s of ['Mail.Send', 'mail.send', 'Mail.Send.Shared', 'Calendars.ReadWrite', 'Calendars.ReadWrite.Shared', 'https://graph.microsoft.com/.default', 'Mail.Read.All', 'Mail.Read.Shared', 'MailboxSettings.ReadWrite', 'https://outlook.office.com/Mail.Send', 'https://outlook.office.com/Mail.Read', 'Files.ReadWrite']) expect(() => assertSafeScopes(['offline_access', s])).toThrow();
    expect(() => assertSafeScopes(['Calendars.Read', 'Mail.Read', 'Mail.ReadWrite', 'offline_access', 'openid', 'profile', 'email', 'User.Read', 'https://graph.microsoft.com/Calendars.Read', 'calendars.read'])).not.toThrow();
  });
});

// @req FR:graph-signin/flow.start @req FR:graph-signin/flow.host
describe('device code start', () => {
  it('posts to the tenant devicecode endpoint and maps the reply', async () => {
    const f = fakeLogin([{ device_code: 'dc', user_code: 'ABCD-EFGH', verification_uri: 'https://microsoft.com/devicelogin', expires_in: 900, interval: 5, message: 'To sign in, use a web browser…' }]);
    const r = await startDeviceCode({ tenant: TENANT, clientId: CLIENT, scopes: scopesFor(['calendar']), fetch: f.fetch });
    expect(f.hits[0].url).toBe('https://login.microsoftonline.com/organizations/oauth2/v2.0/devicecode');
    expect(f.hits[0].form.get('client_id')).toBe(CLIENT);
    expect(f.hits[0].form.get('scope')).toBe('Calendars.Read offline_access');
    expect(r).toEqual({ deviceCode: 'dc', userCode: 'ABCD-EFGH', verificationUri: 'https://microsoft.com/devicelogin', expiresIn: 900, interval: 5, message: 'To sign in, use a web browser…' });
  });
  it('refuses bad tenants, client ids, and unsafe scopes before any request', async () => {
    const f = fakeLogin([]);
    for (const o of [{ tenant: '../x', clientId: CLIENT, scopes: ['Calendars.Read'] }, { tenant: TENANT, clientId: 'nope', scopes: ['Calendars.Read'] }, { tenant: TENANT, clientId: CLIENT, scopes: ['Mail.Send'] }]) {
      await expect(startDeviceCode({ ...o, fetch: f.fetch })).rejects.toThrow();
    }
    expect(f.hits).toHaveLength(0);
  });
});

// @req FR:graph-signin/flow.poll @req FR:graph-signin/flow.host
describe('device code poll', () => {
  const dc = { deviceCode: 'dc', userCode: 'U', verificationUri: 'https://microsoft.com/devicelogin', expiresIn: 900, interval: 5, message: 'm' };
  it('waits on pending, slows down on slow_down, and returns tokens', async () => {
    const f = fakeLogin([{ error: 'authorization_pending' }, { error: 'slow_down' }, { access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: 'Calendars.Read offline_access' }]);
    const waits: number[] = [];
    let t = 1_000_000;
    const r = await pollDeviceCode({ tenant: TENANT, clientId: CLIENT, code: dc, fetch: f.fetch, sleep: async (s) => { waits.push(s); t += s * 1000; }, now: () => t });
    expect(waits).toEqual([5, 5, 10]);
    expect(f.hits[0].url).toBe('https://login.microsoftonline.com/organizations/oauth2/v2.0/token');
    expect(f.hits[0].form.get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:device_code');
    expect(r).toEqual({ accessToken: 'at', refreshToken: 'rt', expiresAt: t + 3600_000, scopes: ['Calendars.Read', 'offline_access'] });
  });
  it('stops on declined, expired, and timeout with the error code only', async () => {
    for (const code of ['access_denied', 'expired_token', 'authorization_declined', 'bad_verification_code']) {
      const f = fakeLogin([{ error: code, error_description: 'secret detail' }]);
      const e = await pollDeviceCode({ tenant: TENANT, clientId: CLIENT, code: dc, fetch: f.fetch, sleep: async () => undefined, now: () => 0 }).catch((x: unknown) => x as GraphSignInError);
      expect(e).toBeInstanceOf(GraphSignInError);
      expect(e).toMatchObject({ code });
      expect(String((e as GraphSignInError).message)).not.toContain("secret detail");
    }
    let t = 0;
    const slow = fakeLogin(Array.from({ length: 500 }, () => ({ error: 'authorization_pending' })));
    await expect(pollDeviceCode({ tenant: TENANT, clientId: CLIENT, code: { ...dc, expiresIn: 30 }, fetch: slow.fetch, sleep: async (s) => { t += s * 1000; }, now: () => t })).rejects.toMatchObject({ code: 'expired_token' });
  });
  it('a grant that includes an unsafe scope is refused, so no such token is ever saved; the error names the scope and the fix', async () => {
    const f = fakeLogin([{ access_token: 'at', refresh_token: 'rt', expires_in: 3600, scope: 'Calendars.Read Mail.Send offline_access' }]);
    const e = await pollDeviceCode({ tenant: TENANT, clientId: CLIENT, code: dc, fetch: f.fetch, sleep: async () => undefined, now: () => 0 }).catch((x: unknown) => x as GraphSignInError);
    expect(e).toMatchObject({ code: 'unsafe_scope' });
    expect(String((e as GraphSignInError).message)).toMatch(/Mail\.Send.*Entra.*revoke the consent/);
    expect(String((e as GraphSignInError).message)).not.toMatch(/\bat\b|\brt\b/);
  });
  it('a grant without a refresh token is an error', async () => {
    const f = fakeLogin([{ access_token: 'at', expires_in: 3600, scope: 'Calendars.Read' }]);
    await expect(pollDeviceCode({ tenant: TENANT, clientId: CLIENT, code: dc, fetch: f.fetch, sleep: async () => undefined, now: () => 0 })).rejects.toMatchObject({ code: 'no_refresh_token' });
  });
});

const token = (o: Partial<CachedToken> = {}): CachedToken => ({ version: 1, tenant: TENANT, clientId: CLIENT, scopes: ['Calendars.Read', 'offline_access'], refreshToken: 'rt1', accessToken: 'at1', expiresAt: 10_000_000, ...o });

// @req FR:graph-signin/cache.file
describe('token cache file', () => {
  it('round-trips with mode 0600 and refuses loose permissions', async () => {
    const d = tmp();
    const c = new FileTokenCache(join(d, 'cfg', 'graph-token.json'));
    expect(await c.read()).toBeNull();
    await c.write(token());
    expect(statSync(join(d, 'cfg', 'graph-token.json')).mode & 0o777).toBe(0o600);
    expect(await c.read()).toEqual(token());
    chmodSync(join(d, 'cfg', 'graph-token.json'), 0o644);
    await expect(c.read()).rejects.toThrow(/permissions/);
    await c.clear();
    await c.clear();
    expect(await c.read()).toBeNull();
  });
  it('refuses a path inside a Stack task repo', () => {
    const repo = tmp();
    mkdirSync(join(repo, 'tasks'));
    expect(() => new FileTokenCache(join(repo, 'graph-token.json'))).toThrow(/task repo/);
    expect(() => new FileTokenCache(join(repo, 'nested', 'deeper', 'graph-token.json'))).toThrow(/task repo/);
  });
  it('rejects a malformed file', async () => {
    const d = tmp();
    const p = join(d, 'graph-token.json');
    writeFileSync(p, '{"version":2}', { mode: 0o600 });
    await expect(new FileTokenCache(p).read()).rejects.toThrow();
  });
});

// @req FR:graph-signin/cache.provider
describe('access token provider', () => {
  it('uses the cached token while it has 5+ minutes, else refreshes once for concurrent callers and saves the rotation', async () => {
    const d = tmp();
    const cache = new FileTokenCache(join(d, 'graph-token.json'));
    await cache.write(token({ expiresAt: 1_000_000 }));
    const f = fakeLogin([{ access_token: 'at2', refresh_token: 'rt2', expires_in: 3600, scope: 'Calendars.Read offline_access' }]);
    let now = 1_000_000 - 6 * 60_000;
    const get = graphToken(cache, { fetch: f.fetch, now: () => now });
    expect(await get()).toBe('at1');
    expect(f.hits).toHaveLength(0);
    now = 1_000_000 - 4 * 60_000;
    expect(await Promise.all([get(), get()])).toEqual(['at2', 'at2']);
    expect(f.hits).toHaveLength(1);
    expect(f.hits[0].form.get('grant_type')).toBe('refresh_token');
    expect(f.hits[0].form.get('refresh_token')).toBe('rt1');
    expect(f.hits[0].form.get('scope')).toBe('Calendars.Read offline_access');
    expect(await cache.read()).toMatchObject({ accessToken: 'at2', refreshToken: 'rt2', expiresAt: now + 3600_000 });
    expect(JSON.stringify(JSON.parse(readFileSync(join(d, 'graph-token.json'), 'utf8')))).not.toContain('rt1');
  });
  it('invalid_grant and a missing cache need a new sign-in', async () => {
    const d = tmp();
    const none = new FileTokenCache(join(d, 'none.json'));
    await expect(graphToken(none, { fetch: fakeLogin([]).fetch, now: () => 0 })()).rejects.toBeInstanceOf(GraphSignInRequired);
    const cache = new FileTokenCache(join(d, 'graph-token.json'));
    await cache.write(token({ expiresAt: 0 }));
    await expect(graphToken(cache, { fetch: fakeLogin([{ error: 'invalid_grant' }]).fetch, now: () => 1 })()).rejects.toBeInstanceOf(GraphSignInRequired);
  });
  it('interaction_required needs a new sign-in; other errors keep their code; a refresh without a new refresh token keeps the old one', async () => {
    const d = tmp();
    const cache = new FileTokenCache(join(d, 'graph-token.json'));
    await cache.write(token({ expiresAt: 0 }));
    await expect(graphToken(cache, { fetch: fakeLogin([{ error: 'interaction_required' }]).fetch, now: () => 1 })()).rejects.toBeInstanceOf(GraphSignInRequired);
    await expect(graphToken(cache, { fetch: fakeLogin([{ error: 'temporarily_unavailable' }]).fetch, now: () => 1 })()).rejects.toMatchObject({ code: 'temporarily_unavailable' });
    expect(await graphToken(cache, { fetch: fakeLogin([{ access_token: 'at9', expires_in: 3600, scope: 'Calendars.Read offline_access' }]).fetch, now: () => 1 })()).toBe('at9');
    expect(await cache.read()).toMatchObject({ refreshToken: 'rt1', accessToken: 'at9' });
  });
  it('a refresh that grants an unsafe scope is refused and nothing is saved', async () => {
    const d = tmp();
    const cache = new FileTokenCache(join(d, 'graph-token.json'));
    await cache.write(token({ expiresAt: 0 }));
    await expect(graphToken(cache, { fetch: fakeLogin([{ access_token: 'bad', refresh_token: 'rt2', expires_in: 3600, scope: 'Calendars.Read Mail.Send' }]).fetch, now: () => 1 })()).rejects.toMatchObject({ code: 'unsafe_scope' });
    expect(await cache.read()).toMatchObject({ refreshToken: 'rt1', accessToken: 'at1' });
  });
  it('force refreshes even when the cached token looks fresh (a 401 from Graph)', async () => {
    const d = tmp();
    const cache = new FileTokenCache(join(d, 'graph-token.json'));
    await cache.write(token({ expiresAt: 10_000_000 }));
    const f = fakeLogin([{ access_token: 'at3', refresh_token: 'rt3', expires_in: 3600, scope: 'Calendars.Read offline_access' }]);
    const get = graphToken(cache, { fetch: f.fetch, now: () => 1 });
    expect(await get()).toBe('at1');
    expect(await get({ force: true })).toBe('at3');
  });
  it('a forced refresh that starts while a normal call is in flight still gets a new token', async () => {
    const d = tmp();
    const cache = new FileTokenCache(join(d, 'graph-token.json'));
    await cache.write(token({ expiresAt: 10_000_000 }));
    const f = fakeLogin([{ access_token: 'at4', refresh_token: 'rt4', expires_in: 3600, scope: 'Calendars.Read offline_access' }]);
    const get = graphToken(cache, { fetch: f.fetch, now: () => 1 });
    expect(await Promise.all([get(), get({ force: true })])).toEqual(['at1', 'at4']);
  });
  it('hasScope matches case-insensitively, with or without the Graph prefix', () => {
    expect(hasScope(['https://graph.microsoft.com/calendars.read'], 'Calendars.Read')).toBe(true);
    expect(hasScope(['Mail.Read'], 'Calendars.Read')).toBe(false);
  });
  it('writes leave no temp file behind', async () => {
    const d = tmp();
    await new FileTokenCache(join(d, 'graph-token.json')).write(token());
    expect(readdirSync(d)).toEqual(['graph-token.json']);
  });
  it('refuses to refresh a cache holding unsafe scopes', async () => {
    const d = tmp();
    const cache = new FileTokenCache(join(d, 'graph-token.json'));
    await cache.write(token({ expiresAt: 0, scopes: ['Mail.Send', 'offline_access'] }));
    const f = fakeLogin([]);
    await expect(graphToken(cache, { fetch: f.fetch, now: () => 1 })()).rejects.toThrow();
    expect(f.hits).toHaveLength(0);
  });
});
