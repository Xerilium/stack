/**
 * In-app Connect: PKCE in the browser with a loopback listener, device code fallback, accounts, drafts, setup.
 * No real network: the login host, the listener and the browser opener are fakes.
 * @req FR:graph-signin/flow.pkce @req FR:graph-signin/flow.idtoken
 * @req FR:connect-accounts/flow.browser @req FR:connect-accounts/flow.callback @req FR:connect-accounts/flow.device @req FR:connect-accounts/flow.account
 * @req FR:connect-accounts/flow.save @req FR:connect-accounts/flow.session @req FR:connect-accounts/scope.default @req FR:connect-accounts/scope.drafts
 * @req FR:connect-accounts/acct.list @req FR:connect-accounts/acct.health @req FR:connect-accounts/acct.remove
 * @req FR:connect-accounts/setup.client @req FR:connect-accounts/setup.run
 */
import { createHash } from 'crypto';
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { accountCachePath, authorizeUrl, FileTokenCache, idClaims, MSA_TENANT, pkcePair, redeemAuthCode, GraphSignInError } from '../../src/graph/auth';
import { AccountHealth, createConnect, loopbackListen, readClientId, runSetup, type ConnectSession, type Listen } from '../../src/graph/connect';
import { probeLocal } from '../../src/inbox/probe';
import { GraphHttpError } from '../../src/graph/transport';

const CLIENT = '11111111-2222-3333-4444-555555555555';
const TID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const tmp = () => mkdtempSync(join(tmpdir(), 'connect-'));
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
const idToken = (claims: Record<string, unknown>) => `${b64({ alg: 'none' })}.${b64(claims)}.sig`;
const tokenReply = (claims: Record<string, unknown>, scope = 'Mail.Read Calendars.Read openid profile offline_access') => ({ access_token: 'AT-secret', refresh_token: 'RT-secret', expires_in: 3600, scope, id_token: idToken(claims) });

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
/** A loopback listener that hands the test its request handler. */
function fakeListen() {
  const box: { handler?: (u: URL) => Promise<{ status: number; body: string }>; closed: boolean } = { closed: false };
  const listen: Listen = async (handler) => { box.handler = handler; return { port: 53682, close: () => { box.closed = true; } }; };
  return { listen, box };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
async function until(f: () => boolean) { for (let i = 0; i < 50 && !f(); i++) await flush(); }

// @req FR:graph-signin/flow.pkce @req FR:graph-signin/flow.idtoken
describe('PKCE and id token', () => {
  it('pkcePair makes a verifier and its S256 challenge', () => {
    const p = pkcePair();
    expect(p.verifier.length).toBeGreaterThanOrEqual(43);
    expect(p.challenge).toBe(createHash('sha256').update(p.verifier).digest('base64url'));
    expect(pkcePair().verifier).not.toBe(p.verifier);
  });
  it('authorizeUrl builds the code request on the login host only', () => {
    const u = new URL(authorizeUrl({ tenant: 'common', clientId: CLIENT, scopes: ['Mail.Read', 'offline_access'], redirectUri: 'http://localhost:53682', challenge: 'c', state: 's', loginHint: 'me@outlook.com' }));
    expect(u.origin + u.pathname).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/authorize');
    expect(Object.fromEntries(u.searchParams)).toMatchObject({ client_id: CLIENT, response_type: 'code', response_mode: 'query', redirect_uri: 'http://localhost:53682', scope: 'Mail.Read offline_access', code_challenge: 'c', code_challenge_method: 'S256', state: 's', login_hint: 'me@outlook.com', prompt: 'select_account' });
  });
  it('refuses a send scope or a redirect that is not loopback', () => {
    const base = { tenant: 'common', clientId: CLIENT, redirectUri: 'http://localhost:1', challenge: 'c', state: 's' };
    expect(() => authorizeUrl({ ...base, scopes: ['Mail.Send'] })).toThrow(GraphSignInError);
    expect(() => authorizeUrl({ ...base, scopes: ['Mail.Read'], redirectUri: 'https://evil.test/cb' })).toThrow(/redirect/);
  });
  it('redeemAuthCode posts the code with the verifier and keeps the id token', async () => {
    const { fetch, hits } = fakeLogin([tokenReply({ preferred_username: 'me@outlook.com', tid: MSA_TENANT })]);
    const g = await redeemAuthCode({ tenant: 'common', clientId: CLIENT, code: 'C', verifier: 'V', redirectUri: 'http://localhost:1', fetch, now: () => 0 });
    expect(hits[0].url).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/token');
    expect(Object.fromEntries(hits[0].form)).toMatchObject({ grant_type: 'authorization_code', code: 'C', code_verifier: 'V', redirect_uri: 'http://localhost:1', client_id: CLIENT });
    expect(g).toMatchObject({ accessToken: 'AT-secret', refreshToken: 'RT-secret', expiresAt: 3_600_000 });
    expect(idClaims(g.idToken!)).toEqual({ account: 'me@outlook.com', tid: MSA_TENANT });
  });
  it('a granted send scope is refused before anything is saved', async () => {
    const { fetch } = fakeLogin([tokenReply({ preferred_username: 'me@outlook.com' }, 'Mail.Read Mail.Send offline_access')]);
    await expect(redeemAuthCode({ tenant: 'common', clientId: CLIENT, code: 'C', verifier: 'V', redirectUri: 'http://localhost:1', fetch })).rejects.toThrow(/unsafe_scope/);
  });
  it('idClaims: email fallback; a bad token gives nothing', () => {
    expect(idClaims(idToken({ email: 'w@contoso.test', tid: TID }))).toEqual({ account: 'w@contoso.test', tid: TID });
    expect(idClaims('nope')).toEqual({});
  });
});

function mk(o: { replies?: Record<string, unknown>[]; open?: (u: string) => Promise<void>; listenFails?: boolean; clientId?: string | undefined } = {}) {
  const dir = tmp();
  const login = fakeLogin(o.replies ?? []);
  const l = fakeListen();
  const opened: string[] = [];
  const health = new AccountHealth();
  const c = createConnect({
    clientId: () => ('clientId' in o ? o.clientId : CLIENT), fetch: login.fetch, cacheDir: dir, health, sleep: async () => undefined,
    listen: o.listenFails ? async () => { throw new Error('EADDRINUSE'); } : l.listen,
    openUrl: o.open ?? (async (u) => { opened.push(u); }),
  });
  return { c, dir, login, l, opened, health };
}

// @req FR:connect-accounts/flow.browser @req FR:connect-accounts/flow.callback @req FR:connect-accounts/flow.account @req FR:connect-accounts/flow.save @req FR:connect-accounts/scope.default
describe('browser sign-in', () => {
  it('opens the sign-in page, takes the code on loopback, saves a 0600 cache named by the account', async () => {
    const { c, dir, login, l, opened } = mk({ replies: [tokenReply({ preferred_username: 'Me@Outlook.com', tid: MSA_TENANT })] });
    const s = await c.start({});
    expect(s).toMatchObject({ method: 'browser', state: 'waiting' });
    expect(opened).toEqual([s.url]);
    const u = new URL(s.url!);
    expect(u.searchParams.get('redirect_uri')).toBe('http://localhost:53682');
    expect(u.searchParams.get('scope')!.split(' ').sort()).toEqual(['Calendars.Read', 'Mail.Read', 'offline_access', 'openid', 'profile']);
    expect(JSON.stringify(s)).not.toMatch(/verifier|secret/i);
    // A stray request (favicon) or a wrong state is refused and changes nothing.
    expect((await l.box.handler!(new URL('http://localhost:53682/favicon.ico'))).status).toBe(404);
    expect((await l.box.handler!(new URL('http://localhost:53682/?code=X&state=wrong'))).status).toBe(400);
    const r = await l.box.handler!(new URL(`http://localhost:53682/?code=CODE&state=${u.searchParams.get('state')}`));
    expect(r).toMatchObject({ status: 200 });
    expect(r.body).toContain('Stack is connected. You can close this tab.');
    expect(login.hits[0].form.get('code_verifier')).toBeTruthy();
    expect(c.get(s.id)).toMatchObject({ state: 'done', account: 'me@outlook.com' });
    expect(l.box.closed).toBe(true);
    const path = accountCachePath('me@outlook.com', dir);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    const t = await new FileTokenCache(path).read();
    expect(t).toMatchObject({ tenant: 'consumers', clientId: CLIENT, account: 'me@outlook.com', refreshToken: 'RT-secret' });
    expect(readFileSync(path, 'utf8')).not.toContain('id_token');
    // A second callback is refused.
    expect((await l.box.handler!(new URL(`http://localhost:53682/?code=CODE&state=${u.searchParams.get('state')}`))).status).toBe(400);
  });
  it('a work account keeps its tenant id; a login hint is sent for a known account', async () => {
    const { c, dir, l } = mk({ replies: [tokenReply({ preferred_username: 'w@contoso.test', tid: TID })] });
    const s = await c.start({ account: 'w@contoso.test' });
    expect(new URL(s.url!).searchParams.get('login_hint')).toBe('w@contoso.test');
    await l.box.handler!(new URL(`http://localhost:53682/?code=C&state=${new URL(s.url!).searchParams.get('state')}`));
    expect((await new FileTokenCache(accountCachePath('w@contoso.test', dir)).read())?.tenant).toBe(TID);
  });
  it('a declined consent ends the session with the OAuth code only', async () => {
    const { c, l } = mk();
    const s = await c.start({});
    await l.box.handler!(new URL(`http://localhost:53682/?error=access_denied&error_description=evil%20text&state=${new URL(s.url!).searchParams.get('state')}`));
    expect(c.get(s.id)).toMatchObject({ state: 'error', error: 'access_denied' });
    expect(JSON.stringify(c.get(s.id))).not.toContain('evil');
  });
  it('an id token without a mailbox address fails with no_account', async () => {
    const { c, l } = mk({ replies: [tokenReply({ tid: TID })] });
    const s = await c.start({});
    await l.box.handler!(new URL(`http://localhost:53682/?code=C&state=${new URL(s.url!).searchParams.get('state')}`));
    expect(c.get(s.id)).toMatchObject({ state: 'error', error: 'no_account' });
  });
  it('no client id: refused before anything opens', async () => {
    const { c, opened } = mk({ clientId: undefined });
    await expect(c.start({})).rejects.toThrow(/setup/i);
    expect(opened).toEqual([]);
  });
});

// @req FR:connect-accounts/flow.device @req FR:connect-accounts/flow.session
describe('device code fallback', () => {
  const dc = { device_code: 'DC-secret', user_code: 'ABCD-1234', verification_uri: 'https://microsoft.com/devicelogin', expires_in: 900, interval: 0, message: 'm' };
  it('when the browser cannot open, the code shows in the page and the server polls', async () => {
    const { c, dir, l } = mk({ open: async () => { throw new Error('no browser'); }, replies: [dc, { error: 'authorization_pending' }, tokenReply({ preferred_username: 'me@hotmail.com', tid: MSA_TENANT })] });
    const s = await c.start({});
    expect(s).toMatchObject({ method: 'device', state: 'waiting', userCode: 'ABCD-1234', verificationUri: 'https://microsoft.com/devicelogin' });
    expect(JSON.stringify(s)).not.toContain('DC-secret');
    expect(l.box.closed).toBe(true);
    await until(() => c.get(s.id)?.state !== 'waiting');
    expect(c.get(s.id)).toMatchObject({ state: 'done', account: 'me@hotmail.com' });
    expect(await new FileTokenCache(accountCachePath('me@hotmail.com', dir)).read()).toMatchObject({ tenant: 'consumers' });
  });
  it('the owner can ask for a code; a listener that cannot start falls back too', async () => {
    expect((await mk({ replies: [dc] }).c.start({ method: 'device' })).method).toBe('device');
    expect((await mk({ listenFails: true, replies: [dc] }).c.start({})).method).toBe('device');
  });
  it('a declined code ends the session', async () => {
    const { c } = mk({ replies: [dc, { error: 'authorization_declined' }], open: async () => { throw new Error('x'); } });
    const s = await c.start({});
    await until(() => c.get(s.id)?.state !== 'waiting');
    expect(c.get(s.id)).toMatchObject({ state: 'error', error: 'authorization_declined' });
  });
  it('an unknown session is undefined', () => expect(mk().c.get('nope')).toBeUndefined());
});

const seed = async (dir: string, account: string, scopes: string[], tenant = 'consumers') =>
  new FileTokenCache(accountCachePath(account, dir)).write({ version: 1, tenant, clientId: CLIENT, scopes, refreshToken: 'RT', accessToken: 'AT', expiresAt: 1, account });

// @req FR:connect-accounts/acct.list @req FR:connect-accounts/acct.health @req FR:connect-accounts/acct.remove @req FR:connect-accounts/scope.drafts
describe('accounts', () => {
  it('lists each cache with type, reads, drafts and state; health marks show', async () => {
    const { c, dir, health } = mk();
    await seed(dir, 'me@outlook.com', ['Mail.Read', 'Calendars.Read', 'offline_access']);
    await seed(dir, 'w@contoso.test', ['Mail.ReadWrite', 'offline_access'], TID);
    writeFileSync(join(dir, 'graph-token-bad@x.com.json'), '{}', { mode: 0o644 });
    health.mark('w@contoso.test', 'expired');
    expect(await c.accounts()).toEqual([
      { account: 'bad@x.com', type: 'work', mail: false, calendar: false, drafts: false, state: 'error' },
      { account: 'me@outlook.com', type: 'personal', mail: true, calendar: true, drafts: false, state: 'connected' },
      { account: 'w@contoso.test', type: 'work', mail: true, calendar: false, drafts: true, state: 'expired' },
    ]);
  });
  // @req FR:connect-accounts/acct.list @req FR:connect-accounts/acct.retry
  it('a row carries down, the last good read and the next retry', async () => {
    const { c, dir, health } = mk();
    await seed(dir, 'me@outlook.com', ['Mail.Read', 'Calendars.Read', 'offline_access']);
    const t0 = Date.parse('2026-11-12T12:00:00Z');
    health.ok('me@outlook.com', t0);
    health.fail('me@outlook.com', new GraphHttpError(502, 'UnknownError'), t0 + 60_000);
    expect(await c.accounts()).toEqual([
      { account: 'me@outlook.com', type: 'personal', mail: true, calendar: true, drafts: false, state: 'down', lastOkAt: new Date(t0).toISOString(), retryAt: new Date(t0 + 90_000).toISOString() },
    ]);
  });
  // @req FR:connect-accounts/acct.retry
  it('an unnamed default cache reads its health by file, the key the calendar uses', async () => {
    const { c, dir, health } = mk();
    const p = join(dir, 'graph-token.json');
    await new FileTokenCache(p).write({ version: 1, tenant: 'consumers', clientId: CLIENT, scopes: ['Calendars.Read', 'offline_access'], refreshToken: 'RT' });
    health.fail(p, new GraphHttpError(502, 'UnknownError'));
    expect((await c.accounts()).map((a) => [a.account, a.state])).toEqual([['', 'down']]);
    await c.remove('');
    expect(health.get(p)).toBeUndefined();
  });
  it('the inbox probe reports an expired mark as signin-expired', async () => {
    const { dir, health } = mk();
    await seed(dir, 'me@outlook.com', ['Mail.Read', 'offline_access']);
    health.mark('me@outlook.com', 'expired');
    expect((await probeLocal({ cacheDir: dir, gh: async () => false, env: {}, health })).emails).toEqual([{ account: 'me@outlook.com', mode: 'read-only', error: 'signin-expired' }]);
  });
  it('drafts on starts a sign-in that asks for Mail.ReadWrite for that account', async () => {
    const { c } = mk();
    const s = (await c.setDrafts('me@outlook.com', true)) as ConnectSession;
    const u = new URL(s.url!);
    expect(u.searchParams.get('scope')).toContain('Mail.ReadWrite');
    expect(u.searchParams.get('login_hint')).toBe('me@outlook.com');
  });
  it('drafts off narrows the cache to read scopes and drops the access token', async () => {
    const { c, dir } = mk();
    await seed(dir, 'me@outlook.com', ['Mail.ReadWrite', 'Calendars.Read', 'offline_access']);
    expect(await c.setDrafts('me@outlook.com', false)).toEqual({ ok: true });
    const t = await new FileTokenCache(accountCachePath('me@outlook.com', dir)).read();
    expect(t?.scopes.sort()).toEqual(['Calendars.Read', 'Mail.Read', 'offline_access']);
    expect(t?.accessToken).toBeUndefined();
  });
  it('disconnect deletes the cache and the mark', async () => {
    const { c, dir, health } = mk();
    await seed(dir, 'me@outlook.com', ['Mail.Read', 'offline_access']);
    health.mark('me@outlook.com', 'error');
    await c.remove('me@outlook.com');
    expect(await c.accounts()).toEqual([]);
    expect(health.get('me@outlook.com')).toBeUndefined();
  });
});

// @req FR:connect-accounts/setup.client @req FR:connect-accounts/setup.run
describe('one-time setup', () => {
  it('client id: env, then user config, then an existing cache; GUIDs only', async () => {
    const dir = tmp();
    const cfg = join(dir, 'config.json');
    expect(readClientId({ env: {}, configPath: cfg, cacheDir: dir })).toBeUndefined();
    await seed(dir, 'me@outlook.com', ['Mail.Read']);
    expect(readClientId({ env: {}, configPath: cfg, cacheDir: dir })).toBe(CLIENT);
    writeFileSync(cfg, JSON.stringify({ repo: 'x', graph: { clientId: '22222222-2222-3333-4444-555555555555' } }));
    expect(readClientId({ env: {}, configPath: cfg, cacheDir: dir })).toBe('22222222-2222-3333-4444-555555555555');
    expect(readClientId({ env: { STACK_GRAPH_CLIENT_ID: '33333333-2222-3333-4444-555555555555' }, configPath: cfg, cacheDir: dir })).toBe('33333333-2222-3333-4444-555555555555');
    expect(readClientId({ env: { STACK_GRAPH_CLIENT_ID: '$(id)' }, configPath: join(dir, 'none.json'), cacheDir: tmp() })).toBeUndefined();
  });
  it('runs the script with pwsh, fixed args, and maps exit codes to states', async () => {
    const calls: { file: string; args: string[] }[] = [];
    const exec = (code: number | 'missing') => async (file: string, args: string[]) => { calls.push({ file, args }); return code === 'missing' ? { missing: true } : { code }; };
    expect(await runSetup({ exec: exec(0), script: '/s/register-stack-app.ps1', clientId: () => CLIENT })).toEqual({ state: 'done' });
    expect(calls[0]).toEqual({ file: 'pwsh', args: ['-NoProfile', '-NonInteractive', '-File', '/s/register-stack-app.ps1'] });
    expect(await runSetup({ exec: exec(0), script: '/s/x.ps1', clientId: () => undefined })).toEqual({ state: 'failed' });
    expect(await runSetup({ exec: exec(3), script: '/s/x.ps1', clientId: () => undefined })).toEqual({ state: 'needs-azure-signin' });
    expect(await runSetup({ exec: exec('missing'), script: '/s/x.ps1', clientId: () => undefined })).toEqual({ state: 'needs-pwsh' });
    expect(await runSetup({ exec: exec(4), script: '/s/x.ps1', clientId: () => undefined })).toEqual({ state: 'needs-pwsh' });
    expect(await runSetup({ exec: exec(1), script: '/s/x.ps1', clientId: () => undefined })).toEqual({ state: 'failed' });
  });
});

// @req FR:connect-accounts/acct.remove @req FR:connect-accounts/flow.save
describe('older default sign-in file', () => {
  const writeDefault = (dir: string, account?: string) => new FileTokenCache(join(dir, 'graph-token.json')).write({ version: 1, tenant: 'consumers', clientId: CLIENT, scopes: ['Calendars.Read'], refreshToken: 'RT', ...(account ? { account } : {}) });
  it('a default file with no account lists as empty and disconnects', async () => {
    const { c, dir } = mk();
    await writeDefault(dir);
    expect((await c.accounts()).map((a) => a.account)).toEqual(['']);
    await c.remove('');
    expect(await c.accounts()).toEqual([]);
  });
  it('a default file that names an account disconnects by that account', async () => {
    const { c, dir } = mk();
    await writeDefault(dir, 'me@outlook.com');
    await c.remove('me@outlook.com');
    expect(await c.accounts()).toEqual([]);
  });
  it('signing in again replaces the default file, so the account lists once', async () => {
    const { c, dir, l } = mk({ replies: [tokenReply({ preferred_username: 'me@outlook.com', tid: MSA_TENANT })] });
    await writeDefault(dir, 'me@outlook.com');
    const s = await c.start({ account: 'me@outlook.com' });
    await l.box.handler!(new URL(`http://localhost:53682/?code=C&state=${new URL(s.url!).searchParams.get('state')}`));
    expect((await c.accounts()).map((a) => a.account)).toEqual(['me@outlook.com']);
  });
});

// @req FR:connect-accounts/flow.session
it('a new sign-in closes a waiting browser listener', async () => {
  const { c, l } = mk({ replies: [{ device_code: 'D', user_code: 'U', verification_uri: 'https://microsoft.com/devicelogin', expires_in: 900, interval: 0 }] });
  const first = await c.start({});
  expect(l.box.closed).toBe(false);
  await c.start({ method: 'device' });
  expect(l.box.closed).toBe(true);
  expect(c.get(first.id)).toMatchObject({ state: 'error', error: 'replaced' });
  // Stop the second poll too, so nothing keeps running after the test.
  await c.start({});
});

// @req FR:connect-accounts/setup.script
describe('register-stack-app.ps1', () => {
  const src = readFileSync(join(__dirname, '../../scripts/register-stack-app.ps1'), 'utf8');
  // Microsoft Graph delegated permission ids (Graph permissions reference).
  const ALLOWED: Record<string, string> = {
    'Mail.Read': '570282fd-fa5c-430d-a7fd-fc8dc98a9dca', 'Calendars.Read': '465a38f9-76ea-45b9-9f34-9e8b0d4b0b42', 'Mail.ReadWrite': '024d486e-b451-40bb-833d-3e66d98c5c73',
    offline_access: '7427e0e9-2fba-42fe-b0c0-848c9e6a8182', openid: '37f7f235-527c-4136-accd-4a02d197296e', profile: '14dad69e-099b-42c9-810b-d002981feec1',
  };
  it('asks only for the allowed delegated scopes, by their real ids', () => {
    const pairs = [...src.matchAll(/'([A-Za-z_.]+)'\s*=\s*'([0-9a-f-]{36})'/g)].map((m) => [m[1], m[2]]);
    expect(Object.fromEntries(pairs)).toEqual(ALLOWED);
    expect(src).not.toMatch(/e383f46e-2787-4529-855e-0e479a3ffac0/); // Mail.Send
    expect(src).toMatch(/Type = 'Scope'/);
    expect(src).not.toMatch(/Type = 'Role'/);
  });
  it('public client, personal and work accounts, loopback redirect, no secret, no credential taken', () => {
    expect(src).toMatch(/-SignInAudience 'AzureADandPersonalMicrosoftAccount'/);
    expect(src).toMatch(/-IsFallbackPublicClient/);
    expect(src).toMatch(/\$RedirectUri = 'http:\/\/localhost'/);
    expect(src).not.toMatch(/New-AzADAppCredential|Get-Credential|-Password|Connect-AzAccount\s+-/);
    expect(src).not.toMatch(/\baz (ad|login|account)\b/); // Az PowerShell only
    expect(src).toMatch(/exit 3/);
  });
});

// @req FR:connect-accounts/flow.session
it('a new sign-in also stops a waiting device code poll', async () => {
  const dc = { device_code: 'D', user_code: 'U', verification_uri: 'https://microsoft.com/devicelogin', expires_in: 900, interval: 0 };
  let polls = 0;
  const fetch = (async (url: string | URL | Request) => {
    if (String(url).endsWith('/devicecode')) return new Response(JSON.stringify(dc));
    polls++;
    return new Response(JSON.stringify({ error: 'authorization_pending' }), { status: 400 });
  }) as typeof globalThis.fetch;
  const c = createConnect({ clientId: () => CLIENT, fetch, cacheDir: tmp(), sleep: () => new Promise((r) => setTimeout(r, 0)), openUrl: async () => undefined, listen: async () => ({ port: 1, close: () => undefined }) });
  const first = await c.start({ method: 'device' });
  await until(() => polls > 0);
  await c.start({ method: 'device' });
  await until(() => c.get(first.id)?.state !== 'waiting');
  expect(c.get(first.id)).toMatchObject({ state: 'error', error: 'replaced' });
  // Stop the second poll too, so nothing keeps running after the test.
  await c.start({});
});

// @req FR:connect-accounts/flow.account @req FR:connect-accounts/flow.session @req FR:connect-accounts/scope.drafts @req FR:connect-accounts/flow.device
describe('review fixes', () => {
  const stateOf = (s: ConnectSession) => new URL(s.url!).searchParams.get('state');
  it('a sign-in for one account fails with account_mismatch when another is picked, and saves nothing', async () => {
    const { c, dir, l } = mk({ replies: [tokenReply({ preferred_username: 'b@outlook.com', tid: MSA_TENANT }, 'Mail.ReadWrite Calendars.Read offline_access')] });
    const s = await c.setDrafts('a@outlook.com', true) as ConnectSession;
    expect(s).toMatchObject({ state: 'waiting', account: 'a@outlook.com' });
    await l.box.handler!(new URL(`http://localhost:53682/?code=C&state=${stateOf(s)}`));
    expect(c.get(s.id)).toMatchObject({ state: 'error', error: 'account_mismatch' });
    expect(await new FileTokenCache(accountCachePath('b@outlook.com', dir)).read()).toBeNull();
  });
  it('an earlier Mail.ReadWrite consent is not saved by a read-only sign-in', async () => {
    const { c, dir, l } = mk({ replies: [tokenReply({ preferred_username: 'me@outlook.com', tid: MSA_TENANT }, 'Mail.ReadWrite Calendars.Read openid profile offline_access')] });
    const s = await c.start({});
    await l.box.handler!(new URL(`http://localhost:53682/?code=C&state=${stateOf(s)}`));
    const t = await new FileTokenCache(accountCachePath('me@outlook.com', dir)).read();
    expect(t!.scopes).not.toContain('Mail.ReadWrite');
    expect(t!.scopes).toContain('Mail.Read');
    expect((await c.accounts())[0]).toMatchObject({ drafts: false, mail: true });
  });
  it('the device code uses the common authority, even for a personal domain tenantFor does not know', async () => {
    const dc = { device_code: 'D', user_code: 'U', verification_uri: 'https://microsoft.com/devicelogin', expires_in: 900, interval: 0 };
    const { c, login } = mk({ replies: [dc] });
    const s = await c.start({ account: 'me@outlook.fr', method: 'device' });
    expect(login.hits[0].url).toBe('https://login.microsoftonline.com/common/oauth2/v2.0/devicecode');
    expect(s.account).toBe('me@outlook.fr');
    await c.start({}); // stop the poll
  });
  it('loopbackListen: the callback that closes the listener still gets its page', async () => {
    let close: () => void = () => undefined;
    const l = await loopbackListen(async () => { close(); return { status: 200, body: 'DONE' }; });
    close = l.close;
    const r = await fetch(`http://127.0.0.1:${l.port}/`);
    expect(r.status).toBe(200);
    expect(await r.text()).toBe('DONE');
  });
});
