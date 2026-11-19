/**
 * Mail readers for the item detail: one per signed-in mailbox, from this machine's token caches. Read only.
 * @req FR:inbox-page/detail.read @req FR:inbox-page/detail.offline.cause
 */
import { accountCachePath, cacheDir, FileTokenCache, graphToken, hasScope } from '../graph/auth';
import { graphTransport, timedFetch } from '../graph/transport';
import { readThread } from '../email/graph-mail';
import { createGraphGuard } from '../email/guard';
import type { MailReader } from './detail';

/** `account` to its reader; undefined when the account has no sign-in with a mail scope on this machine. */
export function createMailReaders(o: { dir?: string; fetch?: typeof fetch } = {}): (account: string) => Promise<MailReader | undefined> {
  return async (account) => {
    let cache: FileTokenCache;
    try { cache = new FileTokenCache(accountCachePath(account, o.dir ?? cacheDir())); } catch { return undefined; }
    const t = await cache.read().catch(() => null);
    if (!t || !(hasScope(t.scopes, 'Mail.Read') || hasScope(t.scopes, 'Mail.ReadWrite'))) return undefined;
    const transport = graphTransport({ token: graphToken(cache, { fetch: timedFetch(o.fetch) }), ...(o.fetch ? { fetch: o.fetch } : {}) });
    // Observe mode: the detail can never write, whatever the token allows.
    const guard = createGraphGuard({ mode: 'observe' });
    return { thread: (id) => readThread({ transport, account, guard }, id) };
  };
}
