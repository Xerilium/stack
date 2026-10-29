/**
 * `MailProvider` over Microsoft Graph. Every request goes through the email guard; the only write is a reply draft.
 * @req FR:day-inputs/mail.graph @req FR:day-inputs/mail.draft @req FR:day-inputs/mail.cursor
 */
import { createReplyRequest } from './draft';
import { createGraphGuard, GRAPH_BASE, type GraphGuard, type Transport } from './guard';
import type { MailProvider, Message } from './types';

const SELECT = 'id,conversationId,subject,from,receivedDateTime,bodyPreview,webLink';
const MAX_PAGES = 50;
const FOLDER = /^[A-Za-z0-9_=-]{1,512}$/;

interface GraphMessage {
  id?: unknown; conversationId?: unknown; subject?: unknown; from?: { emailAddress?: { name?: unknown; address?: unknown } };
  receivedDateTime?: unknown; bodyPreview?: unknown; webLink?: unknown; '@odata.type'?: unknown; '@removed'?: unknown;
}
const str = (v: unknown) => (typeof v === 'string' ? v : '');

function toMessage(g: GraphMessage): Message {
  const name = str(g.from?.emailAddress?.name);
  const webLink = str(g.webLink);
  const odataType = str(g['@odata.type']);
  return {
    id: str(g.id), conversationId: str(g.conversationId), subject: str(g.subject), from: { ...(name ? { name } : {}), address: str(g.from?.emailAddress?.address) },
    receivedAt: str(g.receivedDateTime), bodyPreview: str(g.bodyPreview), ...(webLink ? { webLink } : {}), ...(odataType ? { odataType } : {}),
  };
}

export function createGraphMail(o: { transport: Transport; folder?: string; guard?: GraphGuard }): MailProvider {
  const folder = o.folder ?? 'inbox';
  if (!FOLDER.test(folder)) throw new Error('Invalid mail folder');
  const guard = o.guard ?? createGraphGuard();
  const base = `${GRAPH_BASE}/me/mailFolders/${folder}/messages/delta`;
  /** A cursor is only ever a delta link Graph gave us for this folder. @req FR:day-inputs/mail.cursor */
  const validCursor = (c: string) => {
    let u: URL;
    try { u = new URL(c); } catch { return false; }
    return `${u.origin}${u.pathname}` === base && !u.hash && [...u.searchParams.keys()].every((k) => k === '$deltatoken' || k === '$skiptoken');
  };
  return {
    async delta(cursor) {
      if (cursor !== undefined && !validCursor(cursor)) throw new Error('Invalid mail cursor');
      let url: string | undefined = cursor ?? `${base}?${new URLSearchParams({ $select: SELECT }).toString()}`;
      const messages: Message[] = [];
      let next = cursor ?? base;
      for (let page = 0; url && page < MAX_PAGES; page++) {
        const body = (await guard.call({ method: 'GET', url }, o.transport)) as { value?: unknown; '@odata.nextLink'?: unknown; '@odata.deltaLink'?: unknown };
        if (!body || typeof body !== 'object' || !Array.isArray(body.value)) throw new Error('Bad mail page');
        for (const g of body.value as GraphMessage[]) if (!g['@removed']) messages.push(toMessage(g));
        if (typeof body['@odata.deltaLink'] === 'string') next = body['@odata.deltaLink'];
        url = typeof body['@odata.nextLink'] === 'string' ? body['@odata.nextLink'] : undefined;
        if (url) guard.check({ method: 'GET', url });
      }
      return { messages, cursor: next };
    },
    async createDraft(messageId, text) {
      const d = (await guard.call(createReplyRequest(messageId, text), o.transport)) as { id?: unknown; webLink?: unknown };
      return { id: str(d?.id), webLink: str(d?.webLink) };
    },
  };
}
