/** @req FR:inbox-page/web.view */
import { describe, expect, it } from 'vitest';
import { actionsFor, emptyText, SOURCE, statusLine, tomorrow, type ActionInfo, type InboxRow, type SourcesSummary } from '../src/inbox';

const cat: ActionInfo[] = [{ id: 'reply-draft', label: 'Draft reply', ready: true }, { id: 'mark-done', label: 'Mark done', ready: true }, { id: 'unsubscribe', label: 'Unsubscribe', ready: false }];
const row = (o: Partial<InboxRow>): InboxRow => ({ id: 'mail-a', source: 'email', account: 'a', from: 'x', subject: 's', receivedAt: '2026-01-01', unread: true, summary: '', suggested: 'unsubscribe', actions: ['unsubscribe', 'reply-draft', 'mark-done'], ...o });

describe('inbox actions', () => {
  it('suggested action is primary; the rest follow', () => {
    const a = actionsFor(row({}), cat);
    expect(a.primary?.id).toBe('unsubscribe');
    expect(a.more.map((x) => x.id)).toEqual(['reply-draft', 'mark-done']);
  });
  it('chats never offer reply-draft', () => {
    expect(actionsFor(row({ source: 'teams' }), cat).more.map((x) => x.id)).toEqual(['mark-done']);
  });
  // @req FR:connector-github/item.label
  it('labels every source, GitHub included', () => {
    expect(SOURCE.github).toBe('GitHub');
  });
  it('tomorrow is the next local date', () => {
    expect(tomorrow(new Date(2026, 0, 31, 12))).toBe('2026-02-01');
  });
});

/** @req FR:inbox-page/web.empty @req FR:inbox-page/web.status */
describe('inbox status', () => {
  const sum = (o: Partial<SourcesSummary> = {}): SourcesSummary => ({ connected: 0, total: 2, fresh: 0, attention: true, canClaimZero: false, headline: 'No inboxes connected', ...o });
  it('claims Inbox zero only when a source is fresh', () => {
    expect(emptyText(sum())).toEqual({ zero: false, what: 'No inboxes connected' });
    expect(emptyText(sum({ fresh: 1, canClaimZero: true, headline: null }))).toEqual({ zero: true, what: 'Inbox zero. Nothing needs you.' });
    expect(emptyText(sum({ headline: 'Last synced 3h ago' }))).toEqual({ zero: false, what: 'Last synced 3h ago' });
    expect(emptyText(undefined)).toEqual({ zero: false, what: 'Inbox status unknown' });
  });
  it('the quiet status line is the headline, or nothing', () => {
    expect(statusLine(sum({ headline: 'Email sign-in expired: a@x.com' }))).toBe('Email sign-in expired: a@x.com');
    expect(statusLine(sum({ attention: false, headline: null }))).toBeNull();
    expect(statusLine(undefined)).toBeNull();
  });
});
