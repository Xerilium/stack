/** Triage results to inbox items. @req FR:inbox-page/item.email @req FR:inbox-page/item.order */
import { redact } from '../core/triage';
import { mailKey } from '../email/to-ask';
import type { TriageClass, TriageResult } from '../email/types';
import type { ActionId, InboxItem } from './types';

const SUGGEST: Record<TriageClass, ActionId> = {
  needs_reply: 'reply-draft', needs_decision: 'ask-me-later', sensitive: 'ask-me-later', newsletter: 'unsubscribe', calendar: 'schedule',
  receipt: 'mark-done', fyi: 'mark-done', skip: 'mark-done', spam: 'mark-done',
};
const OTHERS: ActionId[] = ['mark-done', 'snooze', 'create-task', 'archive', 'unsubscribe', 'delegate', 'schedule', 'forward-draft'];
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 3).trimEnd()}...` : s);

/** Every result becomes an item, quiet classes included. @req FR:inbox-page/item.email */
export function fromTriage(r: TriageResult, account: string): InboxItem {
  const m = r.message;
  const suggested = SUGGEST[r.class];
  const actions: ActionId[] = [suggested, ...(r.class === 'needs_reply' ? [] : ['reply-draft' as const]), ...OTHERS].filter((a, i, all) => all.indexOf(a) === i);
  return {
    id: mailKey(m.conversationId), source: 'email', account, from: m.from.name || m.from.address, subject: m.subject || '(no subject)', receivedAt: m.receivedAt,
    unread: m.isRead !== true, urgency: r.urgency ?? 0, summary: clip(redact(r.summary || r.reason || (r.class === 'sensitive' ? 'Sensitive mail' : m.bodyPreview) || '').replace(/\s+/g, ' ').trim(), 400),
    suggested, actions, ...(m.webLink ? { link: m.webLink } : {}), messageId: m.id, kind: r.class,
  };
}

/** Unread first, then urgency, then newest. @req FR:inbox-page/item.order */
export const orderItems = (items: InboxItem[]): InboxItem[] =>
  [...items].sort((a, b) => Number(b.unread) - Number(a.unread) || (b.urgency ?? 0) - (a.urgency ?? 0) || b.receivedAt.localeCompare(a.receivedAt));
