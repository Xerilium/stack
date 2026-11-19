/**
 * The only send in Stack: one reply to one message, after the owner clicked Send on that exact text.
 * The request is `POST /me/messages/{id}/reply` with the comment only; the server supplies recipients, subject and thread.
 * @req FR:email-send/send.approve @req FR:email-send/send.text @req FR:email-send/send.text.empty
 */
import { DRAFT_MARKER } from './draft';
import { createGraphGuard, GRAPH_BASE, sendDigest, type Transport } from './guard';

/** The text as the owner sends it: no AI draft marker, no outer blank space. @req FR:email-send/send.text */
export const cleanReply = (text: string): string => text.split(DRAFT_MARKER).join('').trim();

export async function sendReply(o: { transport: Transport }, messageId: string, text: string): Promise<void> {
  const comment = cleanReply(text);
  if (!comment) throw new Error('Reply text is required');
  // One approval for this click: this message id and this text. Observe mode: nothing else can be written. @req FR:email-send/send.approve
  const guard = createGraphGuard({ mode: 'observe', approvedSends: new Map([[messageId, sendDigest(comment)]]) });
  await guard.call({ method: 'POST', url: `${GRAPH_BASE}/me/messages/${encodeURIComponent(messageId)}/reply`, body: { comment } }, o.transport);
}
