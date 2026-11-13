import { readInbox, runInbox, syncInbox, type ChatConnector, type ChatItem } from '../../src/inbox';
import { runTriage } from '../../src/email/run';
import type { TriageResult } from '../../src/email/types';
import { mkCtx, msg } from '../email/fixtures';

const res = (id: string, conv: string, over: Partial<TriageResult> = {}): TriageResult => ({ message: msg({ id, conversationId: conv }), class: 'needs_reply', confidence: 0.9, urgency: 1, summary: `Summary ${conv}`, ...over });
const chat = (id: string, source: 'teams' | 'slack', at = '2026-10-28T13:00:00Z'): ChatItem => ({
  id, source, account: 'ws', from: 'Sam', subject: 'Lunch', receivedAt: at, unread: true, urgency: 1, summary: 'Lunch today?', suggested: 'ask-me-later', actions: ['ask-me-later'],
});

// @req FR:inbox-page/run.email
describe('syncInbox', () => {
  it('writes items with summary and suggested action', async () => {
    const { ctx, storage } = mkCtx();
    await syncInbox(ctx, { account: 'a@example.test', results: [res('m1', 'c1')] });
    const items = await readInbox(storage);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ source: 'email', account: 'a@example.test', summary: 'Summary c1', suggested: 'reply-draft', messageId: 'm1' });
  });
  it('keeps items of other mailboxes and replaces by id', async () => {
    const { ctx, storage } = mkCtx();
    await syncInbox(ctx, { account: 'a@example.test', results: [res('m1', 'c1'), res('m2', 'c2')] });
    await syncInbox(ctx, { account: 'b@example.test', results: [res('m3', 'c3')] });
    await syncInbox(ctx, { account: 'a@example.test', results: [res('m4', 'c1', { class: 'receipt', summary: 'Paid' })] });
    const items = await readInbox(storage);
    expect(items.map((i) => i.account).sort()).toEqual(['a@example.test', 'a@example.test', 'b@example.test']);
    expect(items.find((i) => i.summary === 'Paid')?.suggested).toBe('mark-done');
    expect(items.filter((i) => i.summary === 'Summary c1')).toHaveLength(0);
  });
  it('keeps at most 500 items', async () => {
    const { ctx, storage } = mkCtx();
    await syncInbox(ctx, { account: 'a', results: Array.from({ length: 510 }, (_, i) => res(`m${i}`, `c${i}`)) });
    expect(await readInbox(storage)).toHaveLength(500);
  });
});

// @req FR:inbox-page/run.email
describe('triage results hook', () => {
  it('runTriage returns the results it triaged', async () => {
    const { ctx } = mkCtx();
    const provider = { delta: async () => ({ messages: [msg()], cursor: 'x' }), createDraft: async () => ({ id: 'D', webLink: 'https://o.example.test/D' }) };
    const r = await runTriage({ ctx, provider, rules: { owner: [], vip: [], sensitive: [], sensitivePatterns: [], sensitiveKeywords: [], receiptSenderPatterns: [], receiptSubjectPatterns: [] }, classifier: { classify: async () => ({ class: 'fyi', urgency: 0, confidence: 0.9, reason: 'r' }) } });
    expect(r.results.map((x) => x.class)).toEqual(['fyi']);
  });
});

// @req FR:inbox-page/run.chat
describe('runInbox', () => {
  const conn = (items: ChatItem[]): ChatConnector => ({ unread: async () => items });
  const bad: ChatConnector = { unread: async () => { throw new Error('secret-token-xyz'); } };
  it('replaces chat items per source and writes one ask each', async () => {
    const { ctx, storage } = mkCtx();
    await syncInbox(ctx, { account: 'a', results: [res('m1', 'c1')] });
    const r1 = await runInbox(ctx, { connectors: { teams: conn([chat('chat-aaaaaaaaaaaa', 'teams'), chat('chat-bbbbbbbbbbbb', 'teams')]), slack: conn([chat('chat-cccccccccccc', 'slack')]) } });
    expect(r1).toEqual({ chats: 3, failed: [] });
    expect((await readInbox(storage)).map((i) => i.source).sort()).toEqual(['email', 'slack', 'teams', 'teams']);
    expect(await storage.listAsks()).toHaveLength(3);
    await runInbox(ctx, { connectors: { teams: conn([chat('chat-aaaaaaaaaaaa', 'teams')]) } });
    expect((await readInbox(storage)).filter((i) => i.source === 'teams')).toHaveLength(1);
    expect((await readInbox(storage)).filter((i) => i.source === 'slack')).toHaveLength(1);
  });
  it('a failed connector keeps its items, others run, error has no detail', async () => {
    const { ctx, storage } = mkCtx();
    await runInbox(ctx, { connectors: { slack: conn([chat('chat-cccccccccccc', 'slack')]) } });
    const r = await runInbox(ctx, { connectors: { slack: bad, teams: conn([chat('chat-aaaaaaaaaaaa', 'teams')]) } });
    expect(r).toEqual({ chats: 1, failed: ['slack'] });
    expect(JSON.stringify(r)).not.toContain('secret');
    expect((await readInbox(storage)).map((i) => i.source).sort()).toEqual(['slack', 'teams']);
  });
});
