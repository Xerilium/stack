/** @req FR:inbox-page/web.view */
import { describe, expect, it } from 'vitest';
import { replyNote, actionsFor, isJunk, junkActions, junkReason, junkToast, splitJunk, openLabel, person, when, doneText, emptyText, SOURCE, statusLine, tomorrow, type ActionInfo, type InboxRow, type SourcesSummary } from '../src/inbox';

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

/** @req FR:inbox-page/web.empty @req FR:inbox-page/web.empty.headline @req FR:inbox-page/web.empty.unknown @req FR:inbox-page/web.status */
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

// @req FR:inbox-page/web.toast
describe('inbox toast words', () => {
  it('says the result in plain words for each ready action', () => {
    expect(doneText({ id: 'mark-done', label: 'Mark done', ready: true })).toBe('Marked done');
    expect(doneText({ id: 'snooze', label: 'Snooze', ready: true })).toBe('Snoozed until tomorrow');
    expect(doneText({ id: 'ask-me-later', label: 'Ask me later', ready: true })).toBe('Deferred until tomorrow');
    expect(doneText({ id: 'create-task', label: 'Create task', ready: true })).toBe('Task created');
  });
  // @req FR:inbox-page/web.toast.other
  it('says Done for an action it does not know', () => {
    expect(doneText({ id: 'archive', label: 'Archive', ready: true })).toBe('Done');
  });
});

/** @req FR:inbox-page/detail.head @req FR:inbox-page/detail.thread.mine @req FR:inbox-page/detail.offline */
describe('inbox detail helpers', () => {
  it('names a person with the address, and the owner as You', () => {
    expect(person({ name: 'Ann', address: 'ann@x.test' })).toBe('Ann <ann@x.test>');
    expect(person({ address: 'ann@x.test' })).toBe('ann@x.test');
    expect(person({ name: 'Me', address: 'me@x.test' }, true)).toBe('You');
  });
  it('names the open link by source', () => {
    expect(openLabel('email')).toBe('Open in Outlook');
    expect(openLabel('teams')).toBe('Open in Teams');
  });
  it('formats a time, and keeps a bad one as it is', () => {
    expect(when('2026-10-28T16:00:00Z')).toMatch(/Oct 28/);
    expect(when('soon')).toBe('soon');
  });
});

/** @req FR:inbox-page/junk.class @req FR:inbox-page/junk.class.restore @req FR:inbox-page/junk.group @req FR:inbox-page/junk.group.reason @req FR:inbox-page/junk.restore.web */
describe('inbox junk', () => {
  const news = row({ id: 'mail-n', kind: 'newsletter' }); const spam = row({ id: 'mail-s', kind: 'spam' }); const real = row({ id: 'mail-r', kind: 'needs_reply' });
  it('is email of kind spam or newsletter that was not restored', () => {
    expect([news, spam, real, row({ kind: 'spam', notJunk: true }), row({ kind: 'spam', source: 'slack' })].map(isJunk)).toEqual([true, true, false, false, false]);
    expect(splitJunk([news, real, spam])).toEqual({ main: [real], junk: [news, spam] });
    expect([junkReason(news), junkReason(spam)]).toEqual(['Newsletter', 'Spam or cold outreach']);
  });
  it('a junk row leads with Not junk', () => {
    const c: ActionInfo[] = [...cat, { id: 'not-junk', label: 'Not junk', ready: true }];
    const a = junkActions(row({ kind: 'newsletter', actions: ['unsubscribe', 'not-junk', 'mark-done'] }), c);
    expect(a.primary?.id).toBe('not-junk');
    expect(a.more.map((x) => x.id)).toEqual(['unsubscribe', 'mark-done']);
  });
  // @req FR:inbox-page/junk.archive.readonly
  it('says what a Junk action did', () => {
    expect(junkToast({ archived: 12, unsubscribed: 0, kept: 1 })).toBe('Archived 12. 1 stays: Stack cannot move that mail.');
    expect(junkToast({ archived: 12, unsubscribed: 4, kept: 3 })).toBe('Unsubscribed from 4. Archived 12. 3 stay: Stack cannot move that mail.');
    expect(junkToast({ archived: 0, unsubscribed: 0, kept: 2 })).toBe('Nothing was archived. 2 stay: Stack cannot move that mail.');
  });
});

/** @req FR:email-send/draft.outlook @req FR:email-send/send.web */
describe('reply box note', () => {
  it('says when Send is on and when it is off', () => {
    expect(replyNote({ text: 'x', canSend: true })).toBe('Stack sends this reply when you click Send.');
    expect(replyNote({ text: 'x', canSend: false, link: 'https://outlook.example.test/d/1' })).toBe('Send is off for this account.');
  });
});
