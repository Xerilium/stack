/**
 * The local probe: Graph token caches and GitHub sign-in, with no token value read out and no network.
 * @req FR:inbox-page/src.probe @req FR:inbox-page/src.safe
 */
import { chmodSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { FileTokenCache } from '../../src/graph/auth';
import { probeLocal } from '../../src/inbox/probe';

const CLIENT = '11111111-2222-3333-4444-555555555555';
const dir = () => mkdtempSync(join(tmpdir(), 'inbox-probe-'));
const put = (d: string, file: string, scopes: string[], account?: string) =>
  new FileTokenCache(join(d, file)).write({ version: 1, tenant: 'consumers', clientId: CLIENT, scopes, refreshToken: 'SECRET-REFRESH', accessToken: 'SECRET-ACCESS', ...(account ? { account } : {}) });

describe('probeLocal', () => {
  it('one email source per mail cache, mode from scopes; calendar-only and unnamed caches are skipped', async () => {
    const d = dir();
    await put(d, 'graph-token-a@outlook.com.json', ['Mail.Read', 'offline_access'], 'a@outlook.com');
    await put(d, 'graph-token-b@contoso.test.json', ['Mail.ReadWrite', 'offline_access'], 'B@contoso.test');
    await put(d, 'graph-token-cal@outlook.com.json', ['Calendars.Read'], 'cal@outlook.com');
    await put(d, 'graph-token.json', ['Mail.Read']);
    const p = await probeLocal({ cacheDir: d, env: {}, gh: async () => false });
    expect(p.emails).toEqual([{ account: 'a@outlook.com', mode: 'read-only' }, { account: 'b@contoso.test', mode: 'drafts' }]);
    expect(p.clientId).toBe(CLIENT);
    expect(p.github).toBe(false);
    expect(JSON.stringify(p)).not.toMatch(/SECRET/);
  });

  it('a cache with loose permissions is an error, named by its file', async () => {
    const d = dir();
    const f = join(d, 'graph-token-x@outlook.com.json');
    writeFileSync(f, '{"refreshToken":"SECRET"}');
    chmodSync(f, 0o644);
    const p = await probeLocal({ cacheDir: d, env: {}, gh: async () => false });
    expect(p.emails).toEqual([{ account: 'x@outlook.com', mode: 'read-only', error: 'token-unreadable' }]);
    expect(JSON.stringify(p)).not.toMatch(/SECRET/);
  });

  it('GitHub is signed in with GITHUB_TOKEN (no gh call) or when gh says so', async () => {
    let calls = 0;
    const gh = async () => { calls++; return true; };
    expect((await probeLocal({ cacheDir: dir(), env: { GITHUB_TOKEN: 'x' }, gh })).github).toBe(true);
    expect(calls).toBe(0);
    expect((await probeLocal({ cacheDir: dir(), env: {}, gh })).github).toBe(true);
    expect((await probeLocal({ cacheDir: dir(), env: {}, gh: async () => { throw new Error('no gh'); } })).github).toBe(false);
  });

  it('a missing folder is no accounts', async () => {
    expect((await probeLocal({ cacheDir: join(dir(), 'nope'), env: {}, gh: async () => false })).emails).toEqual([]);
  });
});
