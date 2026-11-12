/** @req FR:inbox-page/web.view */
import { describe, expect, it } from 'vitest';
import { actionsFor, emptyText, lastSync, MODE_TEXT, panelOpen, progressLine, SOURCE, stepLabel, tomorrow, type ActionInfo, type InboxRow, type SourceRow, type SourcesSummary } from '../src/inbox';

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

/** @req FR:inbox-page/web.empty @req FR:inbox-page/web.sources */
describe('inbox sources', () => {
  const sum = (o: Partial<SourcesSummary> = {}): SourcesSummary => ({ connected: 0, total: 2, fresh: 0, attention: true, canClaimZero: false, headline: 'No inboxes connected', ...o });
  it('claims Inbox zero only when a source is fresh', () => {
    expect(emptyText(sum())).toEqual({ zero: false, what: 'No inboxes connected' });
    expect(emptyText(sum({ fresh: 1, canClaimZero: true, headline: null }))).toEqual({ zero: true, what: 'Inbox zero. Nothing needs you.' });
    expect(emptyText(sum({ headline: 'Last synced 3h ago' }))).toEqual({ zero: false, what: 'Last synced 3h ago' });
    expect(emptyText(undefined)).toEqual({ zero: false, what: 'Inbox status unknown' });
  });
  it('progress line, panel open rule, last sync and mode text', () => {
    expect(progressLine(sum({ connected: 2, total: 7 }))).toBe('2 of 7 sources connected');
    expect(panelOpen(sum())).toBe(true);
    expect(panelOpen(sum({ attention: false, headline: null }))).toBe(false);
    const now = new Date('2026-11-11T18:00:00Z');
    expect(lastSync(undefined, now)).toBe('Never synced');
    expect(lastSync('2026-11-11T15:00:00Z', now)).toBe('Synced 3h ago');
    expect(lastSync('2026-11-11T17:58:00Z', now)).toBe('Synced 2m ago');
    expect(MODE_TEXT.drafts).toMatch(/drafts/);
    expect(MODE_TEXT['read-only']).toMatch(/Read-only/);
  });
  it('the step button names the action', () => {
    const s = (state: SourceRow['state'], planned = false): SourceRow => ({ kind: 'email', account: 'a@x.com', state, ...(planned ? { planned } : {}) });
    expect(stepLabel(s('not-connected'))).toBe('Connect');
    expect(stepLabel(s('error'))).toBe('Fix');
    expect(stepLabel(s('stale'))).toBe('Next step');
    expect(stepLabel(s('not-connected', true))).toBe('What it needs');
  });
});
