/**
 * `stack graph login|status|logout`: the owner's one-time Graph sign-in. Prints the sign-in message and scopes; never a token.
 * @req FR:graph-signin/cli.login @req FR:graph-signin/cli.status @req FR:graph-signin/cli.logout
 */
import { accountCachePath, defaultCachePath, tenantFor, FileTokenCache, FEATURES, pollDeviceCode, scopesFor, startDeviceCode, type Feature } from '../graph/auth';
import { UsageError } from './args';

export interface GraphIO { out(s: string): void; err(s: string): void }
const flag = (f: Record<string, string | true>, n: string): string | undefined => (typeof f[n] === 'string' ? (f[n] as string) : undefined);

export async function graphCmd(action: string | undefined, f: Record<string, string | true>, io: GraphIO, json: boolean): Promise<number> {
  const account = flag(f, 'account')?.trim().toLowerCase();
  let accountPath: string | undefined;
  try { accountPath = account ? accountCachePath(account) : undefined; } catch { throw new UsageError('--account must be a mailbox address'); }
  const cache = new FileTokenCache(flag(f, 'cache') ?? accountPath ?? process.env.STACK_GRAPH_CACHE ?? defaultCachePath());
  if (action === 'login') {
    const clientId = flag(f, 'client-id');
    if (!clientId) throw new UsageError('Missing --client-id (the app registration id; see docs/runbook.md)');
    const features = (flag(f, 'with') ?? 'calendar').split(',').map((s) => s.trim()).filter(Boolean);
    const bad = features.filter((x) => !(x in FEATURES));
    if (bad.length) throw new UsageError(`Unknown --with: ${bad.join(', ')} (use ${Object.keys(FEATURES).join(', ')})`);
    const tenant = flag(f, 'tenant') ?? tenantFor(account);
    const scopes = scopesFor(features as Feature[]);
    const code = await startDeviceCode({ tenant, clientId, scopes });
    // With --json, stdout is only JSON; the sign-in message goes to stderr.
    (json ? io.err : io.out)(`${code.message || `Open ${code.verificationUri} and enter ${code.userCode}`}\n`);
    const g = await pollDeviceCode({ tenant, clientId, code });
    await cache.write({ version: 1, tenant, clientId, scopes: g.scopes.length ? g.scopes : scopes, refreshToken: g.refreshToken, accessToken: g.accessToken, expiresAt: g.expiresAt, ...(account ? { account } : {}) });
    io.out(json ? `${JSON.stringify({ signedIn: true, tenant, scopes: g.scopes, cache: cache.path })}\n` : `Signed in. Scopes: ${g.scopes.join(' ')}\nSaved to ${cache.path}\n`);
    return 0;
  }
  if (action === 'status') {
    const t = await cache.read();
    if (!t) { io.out(json ? `${JSON.stringify({ signedIn: false })}\n` : 'not signed in\n'); return 4; }
    const v = { signedIn: true, ...(t.account ? { account: t.account } : {}), tenant: t.tenant, scopes: t.scopes, expiresAt: t.expiresAt ? new Date(t.expiresAt).toISOString() : null };
    io.out(json ? `${JSON.stringify(v)}\n` : `signed in · ${t.tenant} · ${t.scopes.join(' ')}${v.expiresAt ? ` · access token until ${v.expiresAt}` : ''}\n`);
    return 0;
  }
  if (action === 'logout') {
    await cache.clear();
    io.out(json ? `${JSON.stringify({ signedIn: false })}\n` : 'Signed out\n');
    return 0;
  }
  throw new UsageError('Use: stack graph login --client-id <id> [--tenant t] [--account addr] [--with calendar,mail,drafts] | status | logout');
}
