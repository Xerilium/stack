/**
 * The reply box of one mailbox: the stored draft of an item, and the one send. Types and the send flow; the mailbox is injected.
 * @req FR:email-send/draft.api @req FR:email-send/send.api @req FR:email-send/send.done @req FR:email-send/send.done.fail
 */
import { handleAsk } from '../core/asks';
import type { LifecycleContext } from '../core/lifecycle';
import { NotFoundError } from '../core/storage';
import { updateInbox } from './runner';
import type { InboxItem } from './types';

export interface ReplyDraft { messageId: string; text: string; at: string; link?: string }
export interface ReplyBox {
  /** Send is on for this account. @req FR:email-send/send.optin */
  canSend: boolean;
  get(itemId: string): ReplyDraft | undefined;
  save(itemId: string, messageId: string, text: string): void;
  remove(itemId: string): void;
  /** Sends the reply to the message. Rejects when Send is off or the send failed. */
  send(messageId: string, text: string): Promise<void>;
}
export class SendOff extends Error { constructor() { super('Send is off for this account'); this.name = 'SendOff'; } }
export class SendFailed extends Error { constructor() { super('Could not send. The draft is kept.'); this.name = 'SendFailed'; } }

/** What the detail shows: the text, whether Send is on, and the Outlook link of a mailbox draft. @req FR:email-send/draft.api.detail */
export function replyDraft(box: ReplyBox | undefined, item: InboxItem): { text: string; canSend: boolean; link?: string } | undefined {
  const d = item.source === 'email' && item.messageId ? box?.get(item.id) : undefined;
  return d ? { text: d.text, canSend: box!.canSend, ...(d.link ? { link: d.link } : {}) } : undefined;
}

/**
 * The owner clicked Send: one reply to the item's message with exactly this text. After the send, the draft and the item go
 * and the ask is resolved; a failed send changes nothing. @req FR:email-send/send.done @req FR:email-send/send.done.fail
 */
export async function sendItemReply(ctx: LifecycleContext, item: InboxItem, text: string, box: ReplyBox | undefined): Promise<{ ok: true }> {
  if (item.source !== 'email' || !item.messageId) throw new SendOff();
  if (!box?.canSend) throw new SendOff();
  try { await box.send(item.messageId, text); } catch { throw new SendFailed(); }
  box.remove(item.id);
  await updateInbox(ctx, (cur) => cur.filter((i) => i.id !== item.id));
  try { await handleAsk(ctx, item.askKey ?? item.id, { outcome: 'resolved', note: 'Reply sent from Stack' }, 'inbox'); } catch (e) { if (!(e instanceof NotFoundError)) throw e; }
  return { ok: true };
}
