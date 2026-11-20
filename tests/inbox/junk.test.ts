import { MemoryStorage } from '../../src/core/storage';
import { clearJunk, fromTriage, INBOX_PATH, isJunk, readInbox, runAction, syncInbox, type InboxItem, type JunkMailbox } from '../../src/inbox';
import { CLASSIFY_SYSTEM } from '../../src/email/models';
import type { TriageResult } from '../../src/email/types';

const item = (o: Partial<InboxItem> = {}): InboxItem => ({ id: 'mail-aaaaaaaaaaaa', source: 'email', account: 'me@example.test', from: 'Weekly Digest', subject: 'Ten things', receivedAt: '2026-10-28T09:00:00Z', unread: true, urgency: 0, summary: 'Newsletter.', suggested: 'unsubscribe', actions: ['not-junk', 'mark-done'], messageId: 'AAMk1', kind: 'newsletter', ...o });
const SPAM = item({ id: 'mail-bbbbbbbbbbbb', messageId: 'AAMk2', kind: 'spam', from: 'Growth Co' });
const REAL = item({ id: 'mail-cccccccccccc', messageId: 'AAMk3', kind: 'needs_reply', from: 'Ann' });
const OTHER = item({ id: 'mail-dddddddddddd', messageId: 'AAMk4', account: 'ro@example.test' });
async function mk(items: InboxItem[]) {
  const storage = new MemoryStorage();
  await storage.writeAux(INBOX_PATH, JSON.stringify(items), { expectedVersion: null });
  return { storage };
}
const res = (cls: TriageResult['class'], conv = 'c1'): TriageResult => ({ message: { id: 'AAMk1', conversationId: conv, subject: 'Ten things', from: { name: 'Weekly Digest', address: 'news@x.test' }, receivedAt: '2026-10-28T09:00:00Z', bodyPreview: 'p' }, class: cls, confidence: 1 });

// @req FR:inbox-page/junk.class @req FR:inbox-page/junk.class.restore
describe('isJunk', () => {
  it('is an email item of kind spam or newsletter that the owner did not restore', () => {
    expect([item(), SPAM, REAL, item({ notJunk: true }), item({ source: 'teams' }), item({ kind: 'receipt' })].map(isJunk)).toEqual([true, true, false, false, false, false]);
  });
  it('the classifier prompt names cold outreach as spam', () => {
    expect(CLASSIFY_SYSTEM).toMatch(/spam \([^)]*cold sales or recruiting outreach/);
  });
  it('a junk item offers Not junk', () => {
    expect(fromTriage(res('newsletter'), 'a').actions).toContain('not-junk');
    expect(fromTriage(res('spam'), 'a').actions).toContain('not-junk');
    expect(fromTriage(res('needs_reply'), 'a').actions).not.toContain('not-junk');
  });
});

// @req FR:inbox-page/junk.restore @req FR:inbox-page/junk.restore.keep
describe('not-junk', () => {
  it('sets notJunk on the item, and a later pass keeps it', async () => {
    const first = fromTriage(res('newsletter'), 'me@example.test');
    const ctx = await mk([first, SPAM]);
    expect(await runAction(first, { action: 'not-junk' }, { ctx })).toEqual({ ok: true });
    expect((await readInbox(ctx.storage)).map((i) => [i.id, i.notJunk === true, isJunk(i)])).toEqual(expect.arrayContaining([[first.id, true, false], [SPAM.id, false, true]]));
    await syncInbox(ctx, { account: 'me@example.test', results: [res('newsletter')] });
    expect((await readInbox(ctx.storage)).find((i) => i.id === first.id)?.notJunk).toBe(true);
  });
});

const ALL = ['mail-aaaaaaaaaaaa', 'mail-bbbbbbbbbbbb', 'mail-cccccccccccc', 'mail-dddddddddddd', 'mail-eeeeeeeeeeee', 'mail-ffffffffffff'];
function box(o: { fail?: string[]; oneClick?: string[] } = {}) {
  const log: string[] = [];
  const mailbox: JunkMailbox = {
    async archive(ids) { log.push(`archive ${ids.join(',')}`); return ids.filter((i) => !o.fail?.includes(i)); },
    async unsubscribe(id) { log.push(`unsubscribe ${id}`); return !!o.oneClick?.includes(id); },
  };
  return { log, mailbox };
}

// @req FR:inbox-page/junk.archive @req FR:inbox-page/junk.archive.ids @req FR:inbox-page/junk.archive.readonly @req FR:inbox-page/junk.archive.failed @req FR:inbox-page/junk.unsubscribe @req FR:inbox-page/junk.unsubscribe.other
describe('clearJunk', () => {
  it('archives exactly the junk ids of each writable account and removes those items', async () => {
    const ctx = await mk([item(), SPAM, REAL, OTHER, item({ id: 'mail-eeeeeeeeeeee', messageId: 'AAMk5', notJunk: true })]);
    const b = box();
    const r = await clearJunk(ctx, { ids: ALL, unsubscribe: false, mailbox: async (a) => (a === 'me@example.test' ? b.mailbox : undefined) });
    expect(b.log).toEqual(['archive AAMk1,AAMk2']);
    expect(r).toEqual({ archived: 2, unsubscribed: 0, kept: 1 });
    expect((await readInbox(ctx.storage)).map((i) => i.id).sort()).toEqual(['mail-cccccccccccc', 'mail-dddddddddddd', 'mail-eeeeeeeeeeee']);
  });
  // @req FR:inbox-page/junk.archive.shown
  it('leaves alone junk the owner did not see: only the listed ids move or unsubscribe', async () => {
    const ctx = await mk([item(), SPAM, item({ id: 'mail-ffffffffffff', messageId: 'AAMk6' })]);
    const b = box({ oneClick: ['AAMk1', 'AAMk6'] });
    const r = await clearJunk(ctx, { ids: ['mail-aaaaaaaaaaaa', 'mail-cccccccccccc', 'nope'], unsubscribe: true, mailbox: async () => b.mailbox });
    expect(b.log).toEqual(['unsubscribe AAMk1', 'archive AAMk1']);
    expect(r).toEqual({ archived: 1, unsubscribed: 1, kept: 0 });
    expect((await readInbox(ctx.storage)).map((i) => i.id).sort()).toEqual(['mail-bbbbbbbbbbbb', 'mail-ffffffffffff']);
  });
  it('keeps an item whose move failed', async () => {
    const ctx = await mk([item(), SPAM]);
    const r = await clearJunk(ctx, { ids: ALL, unsubscribe: false, mailbox: async () => box({ fail: ['AAMk2'] }).mailbox });
    expect(r).toEqual({ archived: 1, unsubscribed: 0, kept: 1 });
    expect((await readInbox(ctx.storage)).map((i) => i.id)).toEqual(['mail-bbbbbbbbbbbb']);
  });
  it('unsubscribes newsletters only, before the archive, and counts the one-click ones', async () => {
    const ctx = await mk([item(), SPAM, item({ id: 'mail-ffffffffffff', messageId: 'AAMk6' })]);
    const b = box({ oneClick: ['AAMk1'] });
    const r = await clearJunk(ctx, { ids: ALL, unsubscribe: true, mailbox: async () => b.mailbox });
    expect(b.log).toEqual(['unsubscribe AAMk1', 'unsubscribe AAMk6', 'archive AAMk1,AAMk2,AAMk6']);
    expect(r).toEqual({ archived: 3, unsubscribed: 1, kept: 0 });
  });
  it('a mailbox that throws keeps its items', async () => {
    const ctx = await mk([item()]);
    const r = await clearJunk(ctx, { ids: ALL, unsubscribe: true, mailbox: async () => ({ archive: async () => { throw new Error('x'); }, unsubscribe: async () => { throw new Error('y'); } }) });
    expect(r).toEqual({ archived: 0, unsubscribed: 0, kept: 1 });
    expect(await readInbox(ctx.storage)).toHaveLength(1);
  });
});
