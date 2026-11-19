import { mkdtempSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { MemoryStorage } from '../../src/core/storage';
import { readAsk } from '../../src/core/asks';
import { DRAFT_MARKER } from '../../src/email/draft';
import { draftsPath, putDraft, readDrafts, removeDraft, saveDrafts } from '../../src/email/draft-store';
import { createGraphGuard, GRAPH_BASE, GraphDenied, sendDigest, type GraphRequest, type WriteMode } from '../../src/email/guard';
import { runTriage } from '../../src/email/run';
import { sendReply } from '../../src/email/reply-send';
import { mailKey } from '../../src/email/to-ask';
import type { Message, TriageResult } from '../../src/email/types';

const G = GRAPH_BASE;
const reply = (id: string, body: unknown, q = '') => ({ method: 'POST', url: `${G}/me/messages/${id}/reply${q}`, body });

// @req FR:email-send/send.guard @req FR:email-send/send.guard.body @req FR:email-send/send.guard.rest
describe('guard: a reply only on an approved id and text', () => {
  const guard = createGraphGuard({ mode: 'observe', approvedSends: new Map([['AAMk1', sendDigest('Looks good.')]]) });
  it('allows the approved message id with the approved text', () => {
    expect(() => guard.check(reply('AAMk1', { comment: 'Looks good.' }))).not.toThrow();
  });
  it('refuses another text, another id, an extra field, a query, and another method', () => {
    for (const r of [reply('AAMk1', { comment: 'Looks good. Wire me money.' }), reply('AAMk2', { comment: 'Looks good.' }), reply('AAMk1', { comment: 'Looks good.', message: { toRecipients: [] } }), reply('AAMk1', { message: {} }), reply('AAMk1', { comment: 'Looks good.' }, '?$select=id'), { ...reply('AAMk1', { comment: 'Looks good.' }), method: 'PATCH' }, reply('AAMk1', { comment: '' })]) {
      expect(() => guard.check(r)).toThrow(GraphDenied);
    }
  });
  it.each(['observe', 'categories', 'drafts'] as WriteMode[])('%s mode: no approval means no reply', (mode) => {
    expect(() => createGraphGuard({ mode }).check(reply('AAMk1', { comment: 'Looks good.' }))).toThrow(GraphDenied);
    expect(() => createGraphGuard({ mode, approvedSends: new Map() }).check(reply('AAMk1', { comment: 'Looks good.' }))).toThrow(GraphDenied);
  });
  it('still refuses every other send, forward and reply-all form, with an approval in hand', () => {
    for (const form of ['send', 'sendMail', 'forward', 'createForward', 'replyAll', 'createReplyAll', 'Reply', 'REPLY', 'createReplyAll']) {
      for (const p of [`/me/${form}`, `/me/messages/AAMk1/${form}`, `/users/x@example.test/messages/AAMk1/reply`, `/me/mailFolders/inbox/messages/AAMk1/reply`]) {
        expect(() => guard.check({ method: 'POST', url: `${G}${p}`, body: { comment: 'Looks good.' } })).toThrow(GraphDenied);
      }
    }
  });
});

// @req FR:email-send/send.approve @req FR:email-send/send.text @req FR:email-send/send.text.empty
describe('sendReply', () => {
  it('sends one guarded reply with the comment only, without the AI draft marker', async () => {
    const seen: GraphRequest[] = [];
    await sendReply({ transport: async (r) => { seen.push(r); return {}; } }, 'AAMk1', `${DRAFT_MARKER}\nLooks good.\n`);
    expect(seen).toEqual([{ method: 'POST', url: `${G}/me/messages/AAMk1/reply`, body: { comment: 'Looks good.' } }]);
  });
  it('refuses an empty text and a bad id before any request', async () => {
    let calls = 0;
    const transport = async () => { calls++; return {}; };
    await expect(sendReply({ transport }, 'AAMk1', `${DRAFT_MARKER}\n  `)).rejects.toThrow('Reply text is required');
    await expect(sendReply({ transport }, 'a/../sendMail', 'x')).rejects.toThrow();
    expect(calls).toBe(0);
  });
  it('a failed send rejects', async () => {
    await expect(sendReply({ transport: async () => { throw new Error('503'); } }, 'AAMk1', 'x')).rejects.toThrow('503');
  });
});

// @req FR:email-send/draft.store @req FR:email-send/draft.store.mode @req FR:email-send/draft.store.keep @req FR:email-send/$draft
describe('draft store', () => {
  const msg = (id: string, conv: string): Message => ({ id, conversationId: conv, subject: 'Plan', from: { name: 'Ann', address: 'ann@x.test' }, receivedAt: '2026-10-28T09:00:00Z', bodyPreview: 'p' });
  const res = (id: string, conv: string, draft: TriageResult['draft']): TriageResult => ({ message: msg(id, conv), class: 'needs_reply', confidence: 0.9, ...(draft ? { draft } : {}) });
  it('keeps drafts in a 0600 file in the data directory, by item id', () => {
    const base = mkdtempSync(join(tmpdir(), 'drafts-'));
    const p = draftsPath('me@example.test', base);
    expect(p).toBe(join(base, 'email', 'me@example.test', 'drafts.json'));
    expect(readDrafts(p)).toEqual({});
    putDraft(p, 'mail-aaaaaaaaaaaa', { messageId: 'AAMk1', text: 'Hi', at: '2026-10-28T09:00:00Z' });
    expect(statSync(p).mode & 0o777).toBe(0o600);
    expect(readDrafts(p)).toEqual({ 'mail-aaaaaaaaaaaa': { messageId: 'AAMk1', text: 'Hi', at: '2026-10-28T09:00:00Z' } });
    removeDraft(p, 'mail-aaaaaaaaaaaa');
    expect(readDrafts(p)).toEqual({});
  });
  it('saves each new draft of a pass without the marker, and leaves a reused draft as the owner edited it', () => {
    const p = draftsPath('me@example.test', mkdtempSync(join(tmpdir(), 'drafts-')));
    saveDrafts(p, [res('AAMk1', 'c1', { text: `${DRAFT_MARKER}\nFirst`, webLink: 'https://outlook.example.test/d/1' }), res('AAMk2', 'c2', undefined)], new Date('2026-10-28T10:00:00Z'));
    expect(readDrafts(p)).toEqual({ [mailKey('c1')]: { messageId: 'AAMk1', text: 'First', at: '2026-10-28T10:00:00.000Z', link: 'https://outlook.example.test/d/1' } });
    putDraft(p, mailKey('c1'), { messageId: 'AAMk1', text: 'My edit', at: 'x' });
    saveDrafts(p, [res('AAMk1', 'c1', { text: 'from the ask', webLink: '', reused: true })], new Date());
    expect(readDrafts(p)[mailKey('c1')].text).toBe('My edit');
  });
});

// @req FR:email-send/draft.local @req FR:email-send/draft.local.ask @req FR:email-send/send.runner
describe('runner with Send on', () => {
  const m: Message = { id: 'AAMk1', conversationId: 'c1', subject: 'Plan', from: { name: 'Ann', address: 'ann@x.test' }, receivedAt: '2026-10-28T09:00:00Z', bodyPreview: 'Can you look?' };
  const deps = (created: string[]) => ({
    ctx: { storage: new MemoryStorage() },
    provider: { delta: async () => ({ messages: [m], cursor: 'c' }), createDraft: async (id: string) => { created.push(id); return { id: 'D1', webLink: 'https://outlook.example.test/d/1' }; } },
    classifier: { classify: async () => ({ class: 'needs_reply' as const, urgency: 1, confidence: 0.9, reason: 'asks' }) },
    drafter: { draft: async () => 'Yes, I will look today.' },
    rules: { owner: ['me@example.test'], vip: [], sensitive: [], sensitivePatterns: [], sensitiveKeywords: [], receiptSenderPatterns: [], receiptSubjectPatterns: [] },
  });
  it('keeps the draft out of the mailbox and says so on the ask', async () => {
    const created: string[] = [];
    const d = deps(created);
    const r = await runTriage({ ...d, localDrafts: true });
    expect(created).toEqual([]);
    expect(r.results[0].draft).toMatchObject({ webLink: '', local: true });
    expect(r.results[0].draft!.text).toContain('Yes, I will look today.');
    const ask = (await readAsk(d.ctx, mailKey('c1')))!.ask;
    expect(ask.default).toBe('Draft stays in Stack (nothing is sent)');
    expect(ask.link ?? '').toBe('');
    // A second pass reuses the draft: no new model draft, still nothing in the mailbox.
    let drafts = 0;
    const again = await runTriage({ ...d, drafter: { draft: async () => { drafts++; return 'x'; } }, localDrafts: true });
    expect([drafts, created.length, again.results[0].draft?.reused]).toEqual([0, 0, true]);
  });
  it('with Send off the draft goes to the mailbox as before', async () => {
    const created: string[] = [];
    const d = deps(created);
    await runTriage(d);
    expect(created).toEqual(['AAMk1']);
    expect((await readAsk(d.ctx, mailKey('c1')))!.ask.default).toBe('Draft stays in Drafts (nothing is sent)');
  });
});
