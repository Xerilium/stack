/**
 * Draft requests. The text is only ever the `comment`; the server's `createReply` supplies recipients, subject and thread.
 * @req FR:email-triage/safe.draft-marker
 */
import { GRAPH_BASE, type GraphRequest } from './guard';

export const DRAFT_MARKER = '⟦AI draft: review before sending⟧';

/** Marks a draft so an unreviewed one is obvious. Idempotent. @req FR:email-triage/safe.draft-marker */
export function markDraft(text: string): string {
  return text.startsWith(DRAFT_MARKER) ? text : `${DRAFT_MARKER}\n${text}`;
}

/** The one write that makes a draft: `POST createReply` with the marked text as the only body field. @req FR:email-triage/safe.draft-marker */
export function createReplyRequest(messageId: string, text: string): GraphRequest & { method: 'POST'; body: { comment: string } } {
  return { method: 'POST', url: `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}/createReply`, body: { comment: markDraft(text) } };
}
