/**
 * Reply boxes from this machine's sign-ins: the local draft file of each mailbox, and the send when the owner turned Send on.
 * @req FR:email-send/draft.api.detail @req FR:email-send/send.optin @req FR:email-send/send.api.off
 */
import { accountCachePath, cacheDir, FileTokenCache, graphToken, hasScope, SEND_SCOPE } from '../graph/auth';
import { graphTransport, timedFetch } from '../graph/transport';
import { draftsPath, putDraft, readDrafts, removeDraft } from '../email/draft-store';
import { cleanReply, sendReply } from '../email/reply-send';
import { SendOff, type ReplyBox } from './reply';

/** `account` to its reply box; undefined when the account has no mail sign-in on this machine. */
export function createReplyBoxes(o: { dir?: string; dataDir?: string; fetch?: typeof fetch; now?: () => Date } = {}): (account: string) => Promise<ReplyBox | undefined> {
  return async (account) => {
    let cache: FileTokenCache; let path: string;
    try { cache = new FileTokenCache(accountCachePath(account, o.dir ?? cacheDir())); path = draftsPath(account, o.dataDir); } catch { return undefined; }
    const t = await cache.read().catch(() => null);
    if (!t || !(hasScope(t.scopes, 'Mail.Read') || hasScope(t.scopes, 'Mail.ReadWrite'))) return undefined;
    // Send is on only when the owner turned it on for this account (the cache then holds the send scope). @req FR:email-send/send.optin
    const canSend = hasScope(t.scopes, SEND_SCOPE);
    return {
      canSend,
      get: (id) => readDrafts(path)[id],
      save: (id, messageId, text) => putDraft(path, id, { ...(readDrafts(path)[id] ?? {}), messageId, text: cleanReply(text), at: (o.now?.() ?? new Date()).toISOString() }),
      remove: (id) => removeDraft(path, id),
      async send(messageId, text) {
        if (!canSend) throw new SendOff();
        await sendReply({ transport: graphTransport({ token: graphToken(cache, { fetch: timedFetch(o.fetch) }), ...(o.fetch ? { fetch: o.fetch } : {}) }) }, messageId, text);
      },
    };
  };
}
