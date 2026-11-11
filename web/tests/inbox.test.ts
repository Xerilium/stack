/** @req FR:inbox-page/web.view */
import { describe, expect, it } from 'vitest';
import { actionsFor, SOURCE, tomorrow, type ActionInfo, type InboxRow } from '../src/inbox';

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
