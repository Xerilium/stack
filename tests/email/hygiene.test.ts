import { createHash } from 'crypto';
import { answerAsk, asksPath, parseAsk, putAsk } from '../../src/core/asks';
import { createGraphGuard, GRAPH_BASE, GraphDenied } from '../../src/email/guard';
import { applyApproved, approvedChoice, memoryState, observe, subKey, unsubscribeTarget, writeHygieneAsks, type Http, type MailActions } from '../../src/email/hygiene';
import { DEFAULT_RULES, prefilter } from '../../src/email/rules';
import { runTriage } from '../../src/email/run';
import { toAsk } from '../../src/email/to-ask';
import type { Classifier, MailProvider, Message, TriageResult } from '../../src/email/types';
import { mkCtx, msg, NOW } from './fixtures';

const H = 3600_000;
const old = (h: number) => new Date(NOW.getTime() - h * H).toISOString();
const read = async (storage: { read(p: string): Promise<{ content: string }> }, key: string) => parseAsk(key, (await storage.read(asksPath(key))).content);
const news = (over: Partial<Message> = {}): Message => msg({
  id: 'n1', conversationId: 'cn1', subject: 'Weekly digest #12', from: { name: 'Cloud Weekly', address: 'news@weekly.example.test' }, receivedAt: old(30), bodyPreview: 'This week in cloud.',
  headers: { 'List-Id': '<weekly.example.test>', 'List-Unsubscribe': '<https://weekly.example.test/u/abc>, <mailto:u@weekly.example.test>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }, ...over,
});
const settled = (m: Message, cls: TriageResult['class']): TriageResult => ({ message: m, class: cls, confidence: 1 });
function actions() {
  const moved: { id: string; to: string }[] = [];
  const a: MailActions = { move: jest.fn(async (id, to) => { moved.push({ id, to }); }) };
  return { a, moved };
}
const ctxNow = () => { const c = mkCtx(); return { ...c, ctx: { ...c.ctx, now: () => NOW } }; };

// @req FR:email-inbox-zero/gate.guard
describe('guard: approved moves only', () => {
  const G = GRAPH_BASE;
  const move = (id: string, body: unknown) => ({ method: 'POST', url: `${G}/me/messages/${id}/move`, body });
  it('allows archive or junk moves for approved ids, nothing else', () => {
    const g = createGraphGuard({ mode: 'drafts', approvedMoves: new Set(['A1']) });
    expect(() => g.check(move('A1', { destinationId: 'archive' }))).not.toThrow();
    expect(() => g.check(move('A1', { destinationId: 'junkemail' }))).not.toThrow();
    for (const bad of [move('A2', { destinationId: 'archive' }), move('A1', { destinationId: 'deleteditems' }), move('A1', { destinationId: 'archive', x: 1 }), { method: 'DELETE', url: `${G}/me/messages/A1` }, { method: 'POST', url: `${G}/me/messages/A1/send` }, { method: 'POST', url: `${G}/me/messages/A1/copy`, body: { destinationId: 'archive' } }]) {
      expect(() => g.check(bad)).toThrow(GraphDenied);
    }
  });
  it('denies every move without approvals, or outside drafts mode', () => {
    expect(() => createGraphGuard({ mode: 'drafts' }).check(move('A1', { destinationId: 'archive' }))).toThrow(GraphDenied);
    expect(() => createGraphGuard({ mode: 'observe', approvedMoves: new Set(['A1']) }).check(move('A1', { destinationId: 'archive' }))).toThrow(GraphDenied);
  });
});

// @req FR:email-inbox-zero/batch.spam
describe('spam by headers', () => {
  it('settles failing DMARC (or SPF and DKIM) as spam, never a VIP', () => {
    const r = (h: string) => prefilter(msg({ headers: { 'Authentication-Results': h } }), DEFAULT_RULES)?.class ?? null;
    expect(r('spf=pass; dkim=pass; dmarc=fail action=none')).toBe('spam');
    expect(r('spf=fail; dkim=fail; dmarc=none')).toBe('spam');
    expect(r('spf=fail; dkim=pass; dmarc=pass')).toBeNull();
    expect(prefilter(msg({ from: { address: 'boss@example.test' }, headers: { 'Authentication-Results': 'dmarc=fail' } }), { ...DEFAULT_RULES, vip: ['boss@example.test'] })?.class).toBeNull();
  });
  it('spam never gets its own ask', () => expect(toAsk(settled(msg(), 'spam'))).toBeNull());
});

// @req FR:email-inbox-zero/batch.archive @req FR:email-inbox-zero/batch.spam
describe('batch asks', () => {
  it('collects settled mail older than the window into one approve ask, and spam into another', async () => {
    const { storage, ctx } = ctxNow();
    const s = await memoryState().get();
    observe(s, settled(news(), 'newsletter'), { now: NOW });
    observe(s, settled(msg({ id: 'r1', conversationId: 'cr', subject: 'Your receipt', receivedAt: old(48) }), 'receipt'), { now: NOW });
    observe(s, settled(msg({ id: 'fresh', conversationId: 'cf', receivedAt: old(2) }), 'fyi'), { now: NOW });
    observe(s, settled(msg({ id: 'x1', conversationId: 'cx', subject: 'You won', receivedAt: old(1) }), 'spam'), { now: NOW });
    observe(s, settled(msg({ id: 'q1', conversationId: 'cq' }), 'needs_reply'), { now: NOW });
    await writeHygieneAsks(ctx, s, { now: NOW });
    const a = await read(storage, 'mail-archive');
    expect(a).toMatchObject({ kind: 'approve', ask: 'Archive 2 settled messages?', recommend: 'Archive', default: 'Nothing moves', reversible: true, from: 'email-triage' });
    expect(a.detail).toMatch(/newsletter · Cloud Weekly · Weekly digest #12/);
    expect(a.detail).not.toMatch(/Quarterly/);
    expect(await read(storage, 'mail-spam')).toMatchObject({ kind: 'approve', ask: 'Move 1 spam message to Junk?' });
  });

  it('updates the same ask instead of adding one, and writes none when empty', async () => {
    const { storage, ctx } = ctxNow();
    const s = await memoryState().get();
    await writeHygieneAsks(ctx, s, { now: NOW });
    expect(await storage.listAsks!()).toEqual([]);
    observe(s, settled(news(), 'newsletter'), { now: NOW });
    await writeHygieneAsks(ctx, s, { now: NOW });
    observe(s, settled(news({ id: 'n2', conversationId: 'cn2' }), 'newsletter'), { now: NOW });
    await writeHygieneAsks(ctx, s, { now: NOW });
    expect((await storage.listAsks!()).filter((p) => p.includes('mail-archive'))).toHaveLength(1);
    expect((await read(storage, 'mail-archive')).ask).toBe('Archive 2 settled messages?');
  });

  it('never changes an ask the owner already answered', async () => {
    const { storage, ctx } = ctxNow();
    const s = await memoryState().get();
    observe(s, settled(news(), 'newsletter'), { now: NOW });
    await writeHygieneAsks(ctx, s, { now: NOW });
    await answerAsk(ctx, 'mail-archive', { answer: 'go' });
    observe(s, settled(news({ id: 'n2', conversationId: 'cn2' }), 'newsletter'), { now: NOW });
    await writeHygieneAsks(ctx, s, { now: NOW });
    expect((await read(storage, 'mail-archive')).ask).toBe('Archive 1 settled message?');
    expect(s.archiveAsked).toEqual(['n1']);
  });
});

// @req FR:email-inbox-zero/gate.answered @req FR:email-inbox-zero/batch.act @req FR:email-inbox-zero/gate.once
describe('applyApproved', () => {
  async function seeded() {
    const c = ctxNow();
    const state = memoryState();
    const s = await state.get();
    observe(s, settled(news(), 'newsletter'), { now: NOW });
    observe(s, settled(news({ id: 'n2', conversationId: 'cn2' }), 'newsletter'), { now: NOW });
    await writeHygieneAsks(c.ctx, s, { now: NOW });
    await state.put(s);
    return { ...c, state };
  }
  it('does nothing while the ask is open, rejected, or not written by email-triage', async () => {
    const { storage, ctx, state } = await seeded();
    const { a, moved } = actions();
    await applyApproved(ctx, { state, actions: a });
    await answerAsk(ctx, 'mail-archive', { answer: 'no' });
    await applyApproved(ctx, { state, actions: a });
    expect(moved).toEqual([]);
    expect(await read(storage, 'mail-archive')).toMatchObject({ state: 'done', note: 'Nothing moved' });
    expect(await approvedChoice(ctx, 'mail-archive')).toBeNull();
    await putAsk(ctx, 'mail-spam', { ask: 'Move 9 spam messages to Junk?', kind: 'approve', from: 'someone-else' }, 'someone-else');
    await answerAsk(ctx, 'mail-spam', { answer: 'go' });
    expect(await approvedChoice(ctx, 'mail-spam')).toBeNull();
  });
  it('moves exactly the recorded ids once after go, then handles the ask', async () => {
    const { storage, ctx, state } = await seeded();
    const { a, moved } = actions();
    await answerAsk(ctx, 'mail-archive', { answer: 'go' });
    expect(await approvedChoice(ctx, 'mail-archive')).toBe('go');
    const r = await applyApproved(ctx, { state, actions: a });
    expect(moved).toEqual([{ id: 'n1', to: 'archive' }, { id: 'n2', to: 'archive' }]);
    expect(r).toMatchObject({ archived: 2, junked: 0, failed: 0 });
    expect(await read(storage, 'mail-archive')).toMatchObject({ state: 'done', outcome: 'handled', note: 'Archived 2' });
    await applyApproved(ctx, { state, actions: a });
    expect(moved).toHaveLength(2);
    expect((await state.get()).archive).toEqual([]);
  });
  it('keeps ids that failed to move and reports them', async () => {
    const { storage, ctx, state } = await seeded();
    const a: MailActions = { move: jest.fn(async (id) => { if (id === 'n2') throw new Error('gone'); }) };
    await answerAsk(ctx, 'mail-archive', { answer: 'go' });
    expect(await applyApproved(ctx, { state, actions: a })).toMatchObject({ archived: 1, failed: 1 });
    expect((await read(storage, 'mail-archive')).note).toBe('Archived 1; 1 failed and stays listed');
    expect((await state.get()).archive.map((x) => x.id)).toEqual(['n2']);
  });
});

// @req FR:email-inbox-zero/sub.ledger @req FR:email-inbox-zero/sub.value
describe('subscriptions', () => {
  const judge = { newsletterValue: jest.fn(async (...a: [string, string[]]) => a && 'Weekly roundup of Azure pricing changes.') };
  it('ledgers each list, asks on the second issue with the stated value, and recommends by read rate', async () => {
    const { storage, ctx } = ctxNow();
    const s = await memoryState().get();
    observe(s, settled(news(), 'newsletter'), { now: NOW });
    await writeHygieneAsks(ctx, s, { now: NOW, judge });
    const key = subKey('weekly.example.test');
    expect(await storage.listAsks!()).not.toContain(asksPath(key));
    observe(s, settled(news({ id: 'n2', conversationId: 'cn2', subject: 'Weekly digest #13' }), 'newsletter'), { now: NOW });
    await writeHygieneAsks(ctx, s, { now: NOW, judge });
    expect(judge.newsletterValue).toHaveBeenCalledWith('Cloud Weekly', ['Weekly digest #12', 'Weekly digest #13']);
    const a = await read(storage, key);
    expect(a).toMatchObject({ kind: 'decide', ask: 'Keep Cloud Weekly?', why: 'Weekly roundup of Azure pricing changes.', options: ['Keep', 'Unsubscribe', 'Archive on arrival'], recommend: 'Keep', default: 'Keep (nothing changes)' });
    expect(s.subs[key]).toMatchObject({ issues: 2, read: 0, method: 'one-click' });
  });
  it('recommends Unsubscribe when under 20% of at least 3 issues were read; counts reads from later deltas', async () => {
    const { storage, ctx } = ctxNow();
    const s = await memoryState().get();
    for (const i of [1, 2, 3, 4, 5, 6]) observe(s, settled(news({ id: `n${i}`, conversationId: `c${i}` }), 'newsletter'), { now: NOW });
    observe(s, settled(news({ id: 'n1', conversationId: 'c1', isRead: true }), 'newsletter'), { now: NOW });
    expect(s.subs[subKey('weekly.example.test')]).toMatchObject({ issues: 6, read: 1 });
    await writeHygieneAsks(ctx, s, { now: NOW, judge });
    expect((await read(storage, subKey('weekly.example.test'))).recommend).toBe('Unsubscribe');
  });
  it('keys by sender address when there is no List-Id', () => {
    expect(subKey('a@b.example.test')).toBe(`sub-${createHash('sha1').update('a@b.example.test').digest('hex').slice(0, 12)}`);
  });
});

// @req FR:email-inbox-zero/sub.revisit @req FR:email-inbox-zero/sub.unsubscribe
describe('subscription decisions', () => {
  async function decided(option: string, headers?: Record<string, string>) {
    const { storage, ctx } = ctxNow();
    const state = memoryState();
    const s = await state.get();
    for (const i of [1, 2]) observe(s, settled(news({ id: `n${i}`, conversationId: `c${i}`, ...(headers ? { headers } : {}) }), 'newsletter'), { now: NOW });
    await writeHygieneAsks(ctx, s, { now: NOW, judge: { newsletterValue: async () => 'Pricing news.' } });
    await state.put(s);
    const key = subKey('weekly.example.test');
    await answerAsk(ctx, key, { answer: 'option', text: option });
    return { storage, ctx, state, key };
  }
  const http = (status = 200) => {
    const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
    const h: Http = { post: jest.fn(async (url: string, body: string, headers: Record<string, string>) => { calls.push({ url, body, headers }); return { status }; }) };
    return { h, calls };
  };

  it('Keep records the value and re-asks with evidence after 30 days', async () => {
    const { storage, ctx, state, key } = await decided('Keep');
    await applyApproved(ctx, { state, actions: actions().a });
    expect(await read(storage, key)).toMatchObject({ state: 'done', outcome: 'handled' });
    const s = await state.get();
    expect(s.subs[key]).toMatchObject({ decision: 'keep', value: 'Pricing news.', revisit: new Date(NOW.getTime() + 30 * 24 * H).toISOString() });
    const later = new Date(NOW.getTime() + 31 * 24 * H);
    observe(s, settled(news({ id: 'n3', conversationId: 'c3', isRead: true }), 'newsletter'), { now: later });
    await writeHygieneAsks(ctx, s, { now: later });
    const a = await read(storage, key);
    expect(a).toMatchObject({ state: 'open', kind: 'decide', ask: 'Still worth it? Cloud Weekly', options: ['Keep', 'Unsubscribe', 'Archive on arrival'] });
    expect(a.why).toBe(`Expected "Pricing news." Read 1 of 3 issues since ${NOW.toISOString().slice(0, 10)}.`);
  });

  it('Unsubscribe sends one RFC 8058 one-click POST to the https header URL and handles the ask', async () => {
    const { storage, ctx, state, key } = await decided('Unsubscribe');
    const { h, calls } = http();
    await applyApproved(ctx, { state, actions: actions().a, http: h });
    expect(calls).toEqual([{ url: 'https://weekly.example.test/u/abc', body: 'List-Unsubscribe=One-Click', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }]);
    expect(await read(storage, key)).toMatchObject({ state: 'done', note: 'Unsubscribed (one-click)' });
    expect((await state.get()).subs[key].decision).toBe('unsubscribed');
    await applyApproved(ctx, { state, actions: actions().a, http: h });
    expect(calls).toHaveLength(1);
  });

  it('a failed POST or a link-only list becomes a go-do with the link; mailto is never sent', async () => {
    const failed = await decided('Unsubscribe');
    await applyApproved(failed.ctx, { state: failed.state, actions: actions().a, http: http(500).h });
    expect(await read(failed.storage, failed.key)).toMatchObject({ state: 'open', kind: 'go-do', link: 'https://weekly.example.test/u/abc', ask: 'Unsubscribe from Cloud Weekly (one-click failed: HTTP 500)' });

    const linkOnly = await decided('Unsubscribe', { 'List-Id': '<weekly.example.test>', 'List-Unsubscribe': '<https://weekly.example.test/u/abc>' });
    const { h, calls } = http();
    await applyApproved(linkOnly.ctx, { state: linkOnly.state, actions: actions().a, http: h });
    expect(calls).toEqual([]);
    expect(await read(linkOnly.storage, linkOnly.key)).toMatchObject({ kind: 'go-do', link: 'https://weekly.example.test/u/abc' });

    const mailto = await decided('Unsubscribe', { 'List-Id': '<weekly.example.test>', 'List-Unsubscribe': '<mailto:u@weekly.example.test>' });
    await applyApproved(mailto.ctx, { state: mailto.state, actions: actions().a, http: h });
    expect(calls).toEqual([]);
    expect(await read(mailto.storage, mailto.key)).toMatchObject({ kind: 'go-do', ask: 'Unsubscribe from Cloud Weekly (by email: u@weekly.example.test)' });
  });

  it('Archive on arrival adds later issues to the archive batch (still needs approval)', async () => {
    const { storage, ctx, state } = await decided('Archive on arrival');
    const { a, moved } = actions();
    await applyApproved(ctx, { state, actions: a });
    const s = await state.get();
    observe(s, settled(news({ id: 'n9', conversationId: 'c9', subject: 'Weekly digest #99', receivedAt: old(1) }), 'newsletter'), { now: NOW });
    await writeHygieneAsks(ctx, s, { now: NOW });
    expect((await read(storage, 'mail-archive')).detail).toMatch(/Weekly digest #99/);
    expect(moved).toEqual([]);
  });

  it.each([
    ['<https://10.0.0.1/u>', null], ['<https://localhost/u>', null], ['<http://weekly.example.test/u>', null], ['<https://user:pw@weekly.example.test/u>', null],
    ['<https://weekly.example.test/u?id=1>', 'https://weekly.example.test/u?id=1'], ['<https://[::1]/u>', null],
  ])('unsubscribeTarget(%p) is %p', (h, url) => {
    expect(unsubscribeTarget({ 'List-Unsubscribe': h, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }).url ?? null).toBe(url);
  });
});

// @req FR:email-inbox-zero/sum.ask @req FR:email-inbox-zero/sum.cheap
describe('thread summaries', () => {
  it('puts the classifier summary at the top of the ask detail, never on sensitive asks', () => {
    const r = (cls: TriageResult['class'], extra: Partial<TriageResult> = {}) => toAsk({ message: msg(), class: cls, confidence: 0.9, summary: 'Alex wants the plan by Friday. Budget is open.', ...extra });
    expect(r('needs_decision', { options: ['A', 'B'] })?.detail).toBe('Thread: Alex wants the plan by Friday. Budget is open.');
    expect(r('needs_reply')?.detail).toBe('Thread: Alex wants the plan by Friday. Budget is open.');
    expect(r('needs_reply', { draft: { text: 'Yes.', webLink: 'https://outlook.example.test/d', voice: { score: 100, pass: true, violations: [], profile: true } } })?.detail).toBe('Thread: Alex wants the plan by Friday. Budget is open.\n\nVoice: 100/100\n\nYes.');
    expect(r('sensitive')?.detail).toBeUndefined();
  });
  it('comes from the one classifier call', async () => {
    const { storage, ctx } = mkCtx();
    const provider: MailProvider = { delta: async () => ({ messages: [msg()], cursor: 'c' }), createDraft: async () => ({ id: 'D', webLink: 'https://outlook.example.test/d' }) };
    const classifier: Classifier = { classify: jest.fn(async () => ({ class: 'needs_decision' as const, urgency: 1, confidence: 0.9, reason: 'r', options: ['A', 'B'], summary: 'Short summary.' })) };
    await runTriage({ ctx, provider, classifier, rules: DEFAULT_RULES });
    expect(classifier.classify).toHaveBeenCalledTimes(1);
    const key = `mail-${createHash('sha1').update('conv-1').digest('hex').slice(0, 12)}`;
    expect((await read(storage, key)).detail).toBe('Thread: Short summary.');
  });
});

// @req FR:email-inbox-zero/batch.act
describe('runTriage with hygiene', () => {
  it('observes every result, writes batch asks and applies approvals on the next pass', async () => {
    const { storage, ctx } = ctxNow();
    const state = memoryState();
    const provider: MailProvider = { delta: async () => ({ messages: [news(), msg({ id: 'q', conversationId: 'cq', receivedAt: old(30) })], cursor: 'c' }), createDraft: async () => ({ id: 'D', webLink: 'https://outlook.example.test/d' }) };
    const classifier: Classifier = { classify: async () => ({ class: 'fyi', urgency: 0, confidence: 0.9, reason: 'info' }) };
    const { a, moved } = actions();
    const { summary } = await runTriage({ ctx, provider, classifier, rules: DEFAULT_RULES, hygiene: { state, actions: a } });
    expect((await read(storage, 'mail-archive')).ask).toBe('Archive 2 settled messages?');
    expect(summary).toMatchObject({ archivePending: 2, spamPending: 0 });
    await answerAsk(ctx, 'mail-archive', { answer: 'go' });
    const provider2: MailProvider = { ...provider, delta: async () => ({ messages: [], cursor: 'c2' }) };
    await runTriage({ ctx, provider: provider2, classifier, rules: DEFAULT_RULES, hygiene: { state, actions: a } });
    expect(moved.map((m) => m.id).sort()).toEqual(['n1', 'q']);
  });
});
