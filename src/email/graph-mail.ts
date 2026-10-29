/**
 * `MailProvider` over Microsoft Graph. Every request goes through the email guard; the only write is a reply draft.
 * @req FR:day-inputs/mail.graph @req FR:day-inputs/mail.draft @req FR:day-inputs/mail.cursor
 */
import { createReplyRequest } from './draft';
import { createGraphGuard, GRAPH_BASE, type GraphGuard, type Transport } from './guard';
import type { MailActions } from './hygiene';
import type { MailProvider, Message } from './types';
import type { SentMessage } from './voice';

const SELECT = 'id,conversationId,subject,from,receivedDateTime,bodyPreview,webLink,isRead';
const MAX_PAGES = 50;
const FOLDER = /^[A-Za-z0-9_=-]{1,512}$/;

interface GraphMessage {
  id?: unknown; conversationId?: unknown; subject?: unknown; from?: { emailAddress?: { name?: unknown; address?: unknown } };
  receivedDateTime?: unknown; bodyPreview?: unknown; webLink?: unknown; isRead?: unknown; '@odata.type'?: unknown; '@removed'?: unknown;
}
const str = (v: unknown) => (typeof v === 'string' ? v : '');

function toMessage(g: GraphMessage): Message {
  const name = str(g.from?.emailAddress?.name);
  const webLink = str(g.webLink);
  const odataType = str(g['@odata.type']);
  return {
    id: str(g.id), conversationId: str(g.conversationId), subject: str(g.subject), from: { ...(name ? { name } : {}), address: str(g.from?.emailAddress?.address) },
    receivedAt: str(g.receivedDateTime), bodyPreview: str(g.bodyPreview), ...(webLink ? { webLink } : {}), ...(odataType ? { odataType } : {}),
    ...(typeof g.isRead === 'boolean' ? { isRead: g.isRead } : {}),
  };
}

/** `since` limits a first pass (no cursor) to mail received from that ISO time on, so a big inbox never floods the first run. @req FR:email-runner/cli.run */
export function createGraphMail(o: { transport: Transport; folder?: string; guard?: GraphGuard; since?: string }): MailProvider {
  const folder = o.folder ?? 'inbox';
  if (!FOLDER.test(folder)) throw new Error('Invalid mail folder');
  const guard = o.guard ?? createGraphGuard();
  const base = `${GRAPH_BASE}/me/mailFolders/${folder}/messages/delta`;
  /** A cursor is only ever a delta link Graph gave us for this folder. @req FR:day-inputs/mail.cursor */
  const validCursor = (c: string) => {
    let u: URL;
    try { u = new URL(c); } catch { return false; }
    // Graph returns links as `mailfolders/<folder id>` (lower case, id instead of the well-known name).
    return u.origin === 'https://graph.microsoft.com' && /^\/v1\.0\/me\/mailfolders\/[A-Za-z0-9_=-]{1,512}\/messages\/delta$/i.test(u.pathname) && !u.hash && !u.username && [...u.searchParams.keys()].every((k) => k === '$deltatoken' || k === '$skiptoken');
  };
  return {
    async delta(cursor) {
      if (cursor !== undefined && !validCursor(cursor)) throw new Error('Invalid mail cursor');
      let url: string | undefined = cursor ?? `${base}?${new URLSearchParams({ $select: SELECT, ...(o.since ? { $filter: `receivedDateTime ge ${new Date(o.since).toISOString()}` } : {}) }).toString()}`;
      const messages: Message[] = [];
      let next = url;
      for (let page = 0; url && page < MAX_PAGES; page++) {
        const body = (await guard.call({ method: 'GET', url }, o.transport)) as { value?: unknown; '@odata.nextLink'?: unknown; '@odata.deltaLink'?: unknown };
        if (!body || typeof body !== 'object' || !Array.isArray(body.value)) throw new Error('Bad mail page');
        for (const g of body.value as GraphMessage[]) if (!g['@removed']) messages.push(toMessage(g));
        if (typeof body['@odata.deltaLink'] === 'string') next = body['@odata.deltaLink'];
        url = typeof body['@odata.nextLink'] === 'string' ? body['@odata.nextLink'] : undefined;
        if (url) { guard.check({ method: 'GET', url }); next = url; }
      }
      // Stopped at the page cap: `next` is the last next link, so the next run resumes instead of starting over.
      return { messages, cursor: next };
    },
    async createDraft(messageId, text) {
      const d = (await guard.call(createReplyRequest(messageId, text), o.transport)) as { id?: unknown; webLink?: unknown };
      return { id: str(d?.id), webLink: str(d?.webLink) };
    },
  };
}

export const BODY_CHARS = 4000;
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

/** HTML mail to plain text: block ends become line breaks, tags go, entities decode. Bounded input, linear patterns. @req FR:email-runner/graph.details */
export function htmlToText(html: string, max = 200_000): string {
  // Outlook puts kilobytes of CSS first: drop style, script and head before any cut, on a bounded input.
  return html.slice(0, max)
    .replace(/<(style|script|head)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr|h[1-6]|blockquote)\s*>/gi, '\n')
    .replace(/<[^>]{0,2000}>/g, '')
    .replace(/&(#x[0-9a-f]{1,6}|#\d{1,7}|[a-z]{2,8});/gi, (m, e: string) => {
      if (e[0] === '#') { const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
      return ENTITIES[e.toLowerCase()] ?? m;
    })
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

interface GraphBody { contentType?: unknown; content?: unknown }
const bodyText = (b?: GraphBody) => { const c = str(b?.content); return str(b?.contentType).toLowerCase() === 'html' ? htmlToText(c) : c; };

/** Headers, the message's own text, and read state, in one guarded GET. @req FR:email-runner/graph.details */
export async function messageDetails(o: { transport: Transport; guard?: GraphGuard }, id: string): Promise<Pick<Message, 'headers' | 'body' | 'isRead'>> {
  const guard = o.guard ?? createGraphGuard();
  const url = `${GRAPH_BASE}/me/messages/${encodeURIComponent(id)}?${new URLSearchParams({ $select: 'internetMessageHeaders,uniqueBody,isRead' }).toString()}`;
  const d = (await guard.call({ method: 'GET', url }, o.transport)) as { internetMessageHeaders?: { name?: unknown; value?: unknown }[]; uniqueBody?: GraphBody; isRead?: unknown };
  const headers: Record<string, string> = {};
  for (const h of Array.isArray(d?.internetMessageHeaders) ? d.internetMessageHeaders.slice(0, 200) : []) {
    const k = str(h?.name); if (!k) continue;
    // The receiving server writes the first Authentication-Results; later ones may come from the sender, so they are dropped.
    if (k.toLowerCase() === 'authentication-results' && Object.keys(headers).some((x) => x.toLowerCase() === 'authentication-results')) continue;
    headers[k] = headers[k] ? `${headers[k]}; ${str(h?.value)}` : str(h?.value);
  }
  return { headers, body: bodyText(d?.uniqueBody).slice(0, BODY_CHARS), ...(typeof d?.isRead === 'boolean' ? { isRead: d.isRead } : {}) };
}

/** Sent items for voice learning: guarded pages of 50, at most `pages`. @req FR:email-runner/graph.sent */
export async function sentItems(o: { transport: Transport; guard?: GraphGuard; pages?: number }): Promise<SentMessage[]> {
  const guard = o.guard ?? createGraphGuard({ mode: 'observe' });
  let url: string | undefined = `${GRAPH_BASE}/me/mailFolders/sentitems/messages?${new URLSearchParams({ $select: 'id,conversationId,subject,body,toRecipients,sentDateTime', $top: '50' }).toString()}`;
  const out: SentMessage[] = [];
  for (let page = 0; url && page < (o.pages ?? 4); page++) {
    const b = (await guard.call({ method: 'GET', url }, o.transport)) as { value?: unknown; '@odata.nextLink'?: unknown };
    if (!b || !Array.isArray(b.value)) throw new Error('Bad sent items page');
    for (const g of b.value as { id?: unknown; conversationId?: unknown; subject?: unknown; body?: GraphBody; sentDateTime?: unknown; toRecipients?: { emailAddress?: { name?: unknown; address?: unknown } }[] }[]) {
      out.push({
        id: str(g.id), conversationId: str(g.conversationId), subject: str(g.subject), sentAt: str(g.sentDateTime), body: bodyText(g.body),
        to: (Array.isArray(g.toRecipients) ? g.toRecipients : []).map((r) => ({ ...(str(r?.emailAddress?.name) ? { name: str(r?.emailAddress?.name) } : {}), address: str(r?.emailAddress?.address) })),
      });
    }
    url = typeof b['@odata.nextLink'] === 'string' ? b['@odata.nextLink'] : undefined;
  }
  return out;
}

/** Moves only the ids approved on an answered ask, to Archive or Junk, through a guard built for this pass. @req FR:email-runner/graph.move */
export function createGraphActions(o: { transport: Transport; approvedMoves: ReadonlyMap<string, 'archive' | 'junkemail'> }): MailActions {
  const guard = createGraphGuard({ mode: 'drafts', approvedMoves: o.approvedMoves });
  return {
    async move(id, destinationId) {
      await guard.call({ method: 'POST', url: `${GRAPH_BASE}/me/messages/${encodeURIComponent(id)}/move`, body: { destinationId } }, o.transport);
    },
  };
}
