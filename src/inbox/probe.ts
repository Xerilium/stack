/**
 * The local probe for inbox sources: Graph token caches on this machine and the GitHub sign-in.
 * Reads scopes and account names only, never a token value; makes no network call.
 * @req FR:inbox-page/src.probe @req FR:inbox-page/src.safe
 */
import { execFile } from 'child_process';
import { basename } from 'path';
import { cacheDir as graphCacheDir, FileTokenCache, hasScope, listCachePaths } from '../graph/auth';
import type { AccountHealth } from '../graph/connect';
import { safeClientId, type SourceProbe } from './sources';

/** True when `gh auth status` exits 0. Fixed args, no shell, 5 second cap; output is ignored. */
export const ghSignedIn = (): Promise<boolean> => new Promise((ok) => {
  execFile('gh', ['auth', 'status', '--hostname', 'github.com'], { timeout: 5000, windowsHide: true }, (e) => ok(!e));
});

/** `health`: marks from live reads; an expired account is `signin-expired`. @req FR:connect-accounts/acct.sources */
export interface ProbeOptions { cacheDir?: string; env?: NodeJS.ProcessEnv; gh?: () => Promise<boolean>; health?: AccountHealth }

/** @req FR:inbox-page/src.probe */
export async function probeLocal(o: ProbeOptions = {}): Promise<SourceProbe> {
  const env = o.env ?? process.env;
  const emails: SourceProbe['emails'] = [];
  let clientId: string | undefined;
  let unnamedMail: SourceProbe['unnamedMail'];
  for (const path of listCachePaths(o.cacheDir ?? graphCacheDir())) {
    const named = /^graph-token-(.+)\.json$/.exec(basename(path))?.[1]?.toLowerCase();
    try {
      const t = await new FileTokenCache(path).read();
      if (!t) continue;
      // The id reaches a copyable command: a GUID only. @req FR:inbox-page/src.safe
      clientId ??= safeClientId(t.clientId);
      const drafts = hasScope(t.scopes, 'Mail.ReadWrite');
      if (!(drafts || hasScope(t.scopes, 'Mail.Read'))) continue;
      const account = (t.account ?? named)?.toLowerCase();
      if (!account) { unnamedMail = { mode: drafts ? 'drafts' : 'read-only' }; continue; }
      emails.push({ account, mode: drafts ? 'drafts' : 'read-only', ...(o.health?.get(account) === 'expired' ? { error: 'signin-expired' as const } : {}) });
    } catch {
      // Loose permissions or a bad file: say so by account; the error text could quote the file, so it is dropped.
      if (named) emails.push({ account: named, mode: 'read-only', error: 'token-unreadable' });
    }
  }
  let github = !!env.GITHUB_TOKEN?.trim();
  if (!github) github = await (o.gh ?? ghSignedIn)().catch(() => false);
  return { emails, github, ...(unnamedMail ? { unnamedMail } : {}), ...(clientId ? { clientId } : {}) };
}

/** A probe for the API: re-runs at most once per `ttlMs` so a page refresh never spawns `gh` each time. */
export function cachedProbe(o: ProbeOptions & { ttlMs?: number; now?: () => number } = {}): (opts?: { fresh?: boolean }) => Promise<SourceProbe> {
  const now = o.now ?? (() => Date.now());
  let last: { at: number; value: Promise<SourceProbe> } | null = null;
  return (opts) => {
    if (!opts?.fresh && last && now() - last.at < (o.ttlMs ?? 60_000)) return last.value;
    const value = probeLocal(o);
    last = { at: now(), value };
    const mine = last;
    value.catch(() => { if (last === mine) last = null; });
    return value;
  };
}
