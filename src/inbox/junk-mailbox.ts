/**
 * The mailbox side of the Inbox Junk actions. Every Graph request passes the email guard: the only write is a move to Archive
 * of the ids the owner clicked. The unsubscribe is the sender's own RFC 8058 one-click target, sent with the safe HTTP client.
 * @req FR:inbox-page/junk.archive.ids @req FR:inbox-page/junk.unsubscribe @req FR:inbox-page/junk.unsubscribe.other @req FR:inbox-page/junk.never
 */
import { accountCachePath, cacheDir, FileTokenCache, graphToken, hasScope } from '../graph/auth';
import { graphTransport, timedFetch } from '../graph/transport';
import { createGraphActions, headerMap } from '../email/graph-mail';
import { createGraphGuard, GRAPH_BASE, type Transport } from '../email/guard';
import { createSafeHttp } from '../email/http';
import { unsubscribeTarget, type Http } from '../email/hygiene';
import type { JunkMailbox } from './junk';

const ID = /^[A-Za-z0-9_=-]{1,512}$/;

export function junkMailbox(o: { transport: Transport; http: Http }): JunkMailbox {
  return {
    async archive(ids) {
      const ok = ids.filter((i) => ID.test(i));
      // The owner's click approves exactly these ids, for Archive only. @req FR:email-inbox-zero/gate.guard
      const actions = createGraphActions({ transport: o.transport, approvedMoves: new Map(ok.map((i) => [i, 'archive' as const])) });
      const moved: string[] = [];
      // A 404 is a message that already left the folder.
      for (const id of ok) if (await actions.move(id, 'archive').then(() => true, (e: unknown) => (e as { status?: unknown })?.status === 404)) moved.push(id);
      return moved;
    },
    async unsubscribe(id) {
      if (!ID.test(id)) return false;
      const guard = createGraphGuard({ mode: 'observe' });
      const url = `${GRAPH_BASE}/me/messages/${encodeURIComponent(id)}?${new URLSearchParams({ $select: 'internetMessageHeaders,from' }).toString()}`;
      const d = (await guard.call({ method: 'GET', url }, o.transport).catch(() => null)) as { internetMessageHeaders?: unknown; from?: { emailAddress?: { address?: unknown } } } | null;
      if (!d) return false;
      const from = typeof d.from?.emailAddress?.address === 'string' ? d.from.emailAddress.address : '';
      const t = unsubscribeTarget(headerMap(d.internetMessageHeaders), from);
      // Only a signed one-click target; a link or a mailto is the owner's to open. @req FR:inbox-page/junk.unsubscribe.other
      if (t.method !== 'one-click' || !t.url) return false;
      const status = await o.http.post(t.url, 'List-Unsubscribe=One-Click', { 'Content-Type': 'application/x-www-form-urlencoded' }).then((x) => x.status, () => 0);
      return status >= 200 && status < 300;
    },
  };
}

/** `account` to its junk mailbox; undefined when the account has no sign-in that can write (`Mail.ReadWrite`) on this machine. @req FR:inbox-page/junk.archive.readonly */
export function createJunkMailboxes(o: { dir?: string; fetch?: typeof fetch; http?: Http } = {}): (account: string) => Promise<JunkMailbox | undefined> {
  return async (account) => {
    let cache: FileTokenCache;
    try { cache = new FileTokenCache(accountCachePath(account, o.dir ?? cacheDir())); } catch { return undefined; }
    const t = await cache.read().catch(() => null);
    if (!t || !hasScope(t.scopes, 'Mail.ReadWrite')) return undefined;
    return junkMailbox({ transport: graphTransport({ token: graphToken(cache, { fetch: timedFetch(o.fetch) }), ...(o.fetch ? { fetch: o.fetch } : {}) }), http: o.http ?? createSafeHttp() });
  };
}
