import { createHash } from 'crypto';
import { asksPath, handleAsk, parseAsk } from '../../src/core/asks';
import { DEFAULT_RULES } from '../../src/email/rules';
import { runTriage } from '../../src/email/run';
import type { Classification, Classifier, Drafter, MailProvider, Message } from '../../src/email/types';
import { mkCtx, msg } from './fixtures';

const rules = { ...DEFAULT_RULES, owner: ['me@example.test'], sensitive: ['counsel@example.test'] };
const bulk = { 'List-Unsubscribe': '<mailto:u@example.test>' };
const keyOf = (c: string) => `mail-${createHash('sha1').update(c).digest('hex').slice(0, 12)}`;

function setup(messages: Message[], cl: (m: Message) => Classification) {
  const created: { id: string; text: string }[] = [];
  const provider: MailProvider = {
    delta: async (cursor) => ({ messages, cursor: `${cursor ?? 'c0'}+` }),
    createDraft: async (id, text) => { created.push({ id, text }); return { id: `D-${id}`, webLink: `https://outlook.example.test/mail/drafts/${id}` }; },
  };
  const classifier: Classifier = { classify: jest.fn(async (m) => cl(m)) };
  const drafter: Drafter = { draft: jest.fn(async () => 'Thanks, Friday works.') };
  return { provider, classifier, drafter, created };
}
const needsReply: Classification = { class: 'needs_reply', urgency: 1, confidence: 0.9, reason: 'Question' };

// @req FR:email-triage/ask.quiet @req FR:email-triage/ask.reply
describe('runTriage', () => {
  it('runs delta, prefilter, classify, draft, putAsk and reports counters', async () => {
    const { storage, ctx } = mkCtx();
    const s = setup([
      msg({ id: 'm1', conversationId: 'c1' }),
      msg({ id: 'm2', conversationId: 'c2', headers: bulk }),
      msg({ id: 'm3', conversationId: 'c3', subject: 'Your receipt', bodyPreview: 'Thanks.' }),
      msg({ id: 'm4', conversationId: 'c4', from: { name: 'Counsel', address: 'counsel@example.test' } }),
      msg({ id: 'm5', conversationId: 'c5', subject: 'FYI' }),
    ], (m) => (m.id === 'm5' ? { class: 'fyi', urgency: 0, confidence: 0.9, reason: 'info' } : needsReply));
    const { cursor, summary } = await runTriage({ ctx, provider: s.provider, classifier: s.classifier, drafter: s.drafter, rules, project: 'work', cursor: 'c9' });
    expect(cursor).toBe('c9+');
    expect(summary).toMatchObject({ messages: 5, rules: 3, model: 2, drafts: 1, asks: 2 });
    expect(summary.counts).toMatchObject({ needs_reply: 1, newsletter: 1, receipt: 1, sensitive: 1, fyi: 1 });
    expect(s.created).toEqual([{ id: 'm1', text: expect.stringMatching(/^⟦AI draft: review before sending⟧\nThanks, Friday works\.$/) }]);
    expect((await storage.listAsks!()).sort()).toEqual([asksPath(keyOf('c1')), asksPath(keyOf('c4'))].sort());
    const a = parseAsk(keyOf('c1'), (await storage.read(asksPath(keyOf('c1')))).content);
    expect(a).toMatchObject({ kind: 'review', project: 'work', link: 'https://outlook.example.test/mail/drafts/m1' });
  });

  it('never gives a sensitive message to the classifier or drafter', async () => {
    const { ctx } = mkCtx();
    const s = setup([msg({ from: { address: 'counsel@example.test' }, bodyPreview: 'SECRET-BODY-TEXT' })], () => needsReply);
    await runTriage({ ctx, provider: s.provider, classifier: s.classifier, drafter: s.drafter, rules });
    expect(s.classifier.classify).not.toHaveBeenCalled();
    expect(s.drafter.draft).not.toHaveBeenCalled();
  });

  it('floors urgency for VIPs and passes the flag to the classifier', async () => {
    const { ctx } = mkCtx();
    const s = setup([msg({ from: { address: 'boss@example.test' }, headers: bulk })], () => ({ class: 'needs_reply', urgency: 0, confidence: 0.9, reason: 'x' }));
    await runTriage({ ctx, provider: s.provider, classifier: s.classifier, drafter: s.drafter, rules: { ...rules, vip: ['boss@example.test'] } });
    expect(s.classifier.classify).toHaveBeenCalledWith(expect.anything(), { vip: true });
    const a = parseAsk('k', (await ctx.storage.read(asksPath(keyOf('conv-1')))).content);
    expect(a.priority).toBe('normal');
  });

  it('classifies only the newest message per conversation', async () => {
    const { ctx } = mkCtx();
    const s = setup([
      msg({ id: 'old', receivedAt: '2026-10-28T10:00:00Z' }),
      msg({ id: 'new', receivedAt: '2026-10-28T12:00:00Z' }),
    ], () => needsReply);
    await runTriage({ ctx, provider: s.provider, classifier: s.classifier, drafter: s.drafter, rules });
    expect(s.classifier.classify).toHaveBeenCalledTimes(1);
    expect((s.classifier.classify as jest.Mock).mock.calls[0][0].id).toBe('new');
  });

  it('without a drafter (observe) a reply need still reaches the owner and nothing is written to the mailbox', async () => {
    const { storage, ctx } = mkCtx();
    const s = setup([msg()], () => needsReply);
    const { summary } = await runTriage({ ctx, provider: s.provider, classifier: s.classifier, rules });
    expect(s.created).toEqual([]);
    expect(summary).toMatchObject({ drafts: 0, asks: 1 });
    expect(parseAsk('k', (await storage.read(asksPath(keyOf('conv-1')))).content).kind).toBe('go-do');
  });

  it('distrusts the classifier: unknown class or injection suspicion goes to the owner undrafted', async () => {
    const { storage, ctx } = mkCtx();
    const s = setup([
      msg({ id: 'a', conversationId: 'ca' }),
      msg({ id: 'b', conversationId: 'cb' }),
    ], (m) => (m.id === 'a' ? ({ class: 'wire_money', urgency: 3, confidence: 1, reason: 'x' } as unknown as Classification) : { ...needsReply, injectionSuspected: true }));
    const { summary } = await runTriage({ ctx, provider: s.provider, classifier: s.classifier, drafter: s.drafter, rules });
    expect(s.created).toEqual([]);
    expect(summary.counts.needs_decision).toBe(2);
    for (const c of ['ca', 'cb']) expect(parseAsk('k', (await storage.read(asksPath(keyOf(c)))).content).kind).toBe('answer');
  });
});

// @req FR:email-triage/ask.resolve
describe('runTriage owner replies', () => {
  it('handles the open ask as resolved when the owner replied (seen on the next delta)', async () => {
    const { storage, ctx } = mkCtx();
    const first = setup([msg()], () => needsReply);
    await runTriage({ ctx, provider: first.provider, classifier: first.classifier, drafter: first.drafter, rules });
    const next = setup([msg({ id: 'm2', from: { address: 'me@example.test' } })], () => needsReply);
    const { summary } = await runTriage({ ctx, provider: next.provider, classifier: next.classifier, rules });
    expect(next.classifier.classify).not.toHaveBeenCalled();
    expect(summary).toMatchObject({ resolved: 1, counts: { skip: 1 } });
    expect(parseAsk('k', (await storage.read(asksPath(keyOf('conv-1')))).content)).toMatchObject({ state: 'done', outcome: 'resolved' });
  });
});

// @req FR:email-triage/ask.once
describe('runTriage drafts once per conversation', () => {
  it('reuses the draft already recorded on the open ask instead of creating another', async () => {
    const { storage, ctx } = mkCtx();
    const first = setup([msg()], () => needsReply);
    const r1 = await runTriage({ ctx, provider: first.provider, classifier: first.classifier, drafter: first.drafter, rules });
    expect(r1.summary.drafts).toBe(1);
    const again = setup([msg({ id: 'm9', bodyPreview: 'Bump: still waiting' })], () => needsReply);
    const r2 = await runTriage({ ctx, provider: again.provider, classifier: again.classifier, drafter: again.drafter, rules });
    expect(again.created).toEqual([]);
    expect(again.drafter.draft).not.toHaveBeenCalled();
    expect(r2.summary).toMatchObject({ drafts: 0, asks: 1 });
    const a = parseAsk('k', (await storage.read(asksPath(keyOf('conv-1')))).content);
    expect(a).toMatchObject({ state: 'open', kind: 'review', link: 'https://outlook.example.test/mail/drafts/AAMk-msg-1' });
    expect(a.detail).toMatch(/Thanks, Friday works\./);
  });

  it('drafts again once the earlier ask is done', async () => {
    const { ctx } = mkCtx();
    const first = setup([msg()], () => needsReply);
    await runTriage({ ctx, provider: first.provider, classifier: first.classifier, drafter: first.drafter, rules });
    await handleAsk(ctx, keyOf('conv-1'), { outcome: 'handled' }, 'cos');
    const again = setup([msg({ id: 'm9' })], () => needsReply);
    await runTriage({ ctx, provider: again.provider, classifier: again.classifier, drafter: again.drafter, rules });
    expect(again.created.map((c) => c.id)).toEqual(['m9']);
  });
});

