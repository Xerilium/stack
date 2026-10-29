import { mkdtempSync, existsSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { run } from '../../src/cli/run';

const CLIENT = '11111111-2222-3333-4444-555555555555';
async function stack(...args: string[]) {
  let out = '', err = '';
  const code = await run(args, { out: (s) => { out += s; }, err: (s) => { err += s; } });
  return { code, out, err };
}
const replies = (list: Record<string, unknown>[]) => {
  const seen: string[] = [];
  jest.spyOn(globalThis, 'fetch').mockImplementation((async (url: string | URL | Request) => {
    seen.push(String(url));
    const r = list.shift() ?? { error: 'server_error' };
    return new Response(JSON.stringify(r), { status: 'error' in r ? 400 : 200 });
  }) as typeof fetch);
  return seen;
};
afterEach(() => jest.restoreAllMocks());

// @req FR:graph-signin/cli.login @req FR:graph-signin/cli.status @req FR:graph-signin/cli.logout
describe('stack graph', () => {
  it('login prints the sign-in message, saves the cache, and never prints a token; status and logout follow', async () => {
    const cache = join(mkdtempSync(join(tmpdir(), 'graph-cli-')), 'graph-token.json');
    const seen = replies([
      { device_code: 'dc', user_code: 'ABCD', verification_uri: 'https://microsoft.com/devicelogin', expires_in: 900, interval: 0, message: 'Go to https://microsoft.com/devicelogin and enter ABCD' },
      { access_token: 'secret-at', refresh_token: 'secret-rt', expires_in: 3600, scope: 'Calendars.Read Mail.Read offline_access' },
    ]);
    const login = await stack('graph', 'login', '--client-id', CLIENT, '--with', 'calendar,mail', '--cache', cache);
    expect(login.code).toBe(0);
    expect(login.out).toContain('enter ABCD');
    expect(login.out).toContain('Calendars.Read Mail.Read offline_access');
    expect(login.out + login.err).not.toMatch(/secret-/);
    expect(seen[0]).toBe('https://login.microsoftonline.com/organizations/oauth2/v2.0/devicecode');
    expect(statSync(cache).mode & 0o777).toBe(0o600);
    const status = await stack('graph', 'status', '--cache', cache, '--json');
    expect(status.code).toBe(0);
    expect(JSON.parse(status.out)).toMatchObject({ signedIn: true, tenant: 'organizations', scopes: ['Calendars.Read', 'Mail.Read', 'offline_access'] });
    expect(status.out).not.toMatch(/secret-/);
    expect((await stack('graph', 'logout', '--cache', cache)).code).toBe(0);
    expect(existsSync(cache)).toBe(false);
    const after = await stack('graph', 'status', '--cache', cache);
    expect(after).toMatchObject({ code: 4 });
    expect(after.out).toContain('not signed in');
    expect((await stack('graph', 'logout', '--cache', cache)).code).toBe(0);
  });
  it('login --json prints only JSON on stdout (the sign-in message goes to stderr)', async () => {
    const cache = join(mkdtempSync(join(tmpdir(), 'graph-cli-')), 'graph-token.json');
    replies([
      { device_code: 'dc', user_code: 'ABCD', verification_uri: 'https://microsoft.com/devicelogin', expires_in: 900, interval: 0, message: 'enter ABCD' },
      { access_token: 'secret-at', refresh_token: 'secret-rt', expires_in: 3600, scope: 'Calendars.Read offline_access' },
    ]);
    const r = await stack('graph', 'login', '--client-id', CLIENT, '--cache', cache, '--json');
    expect(JSON.parse(r.out)).toMatchObject({ signedIn: true });
    expect(r.err).toContain('enter ABCD');
  });
  it('login refuses a grant with an unsafe scope and saves nothing', async () => {
    const cache = join(mkdtempSync(join(tmpdir(), 'graph-cli-')), 'graph-token.json');
    replies([
      { device_code: 'dc', user_code: 'ABCD', verification_uri: 'https://microsoft.com/devicelogin', expires_in: 900, interval: 0, message: 'enter ABCD' },
      { access_token: 'secret-at', refresh_token: 'secret-rt', expires_in: 3600, scope: 'Calendars.Read Mail.Send offline_access' },
    ]);
    const r = await stack('graph', 'login', '--client-id', CLIENT, '--cache', cache);
    expect(r.code).not.toBe(0);
    expect(existsSync(cache)).toBe(false);
  });
  it('login needs a client id and refuses unknown features', async () => {
    const cache = join(mkdtempSync(join(tmpdir(), 'graph-cli-')), 'graph-token.json');
    expect((await stack('graph', 'login', '--cache', cache)).code).toBe(2);
    expect((await stack('graph', 'login', '--client-id', CLIENT, '--with', 'send', '--cache', cache)).code).toBe(2);
    expect((await stack('graph', 'nope', '--cache', cache)).code).toBe(2);
  });
});
