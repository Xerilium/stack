import { createHash } from 'crypto';
import { answerAsk, asksPath, parseAsk, putAsk } from '../../src/core/asks';
import { createGraphGuard, GRAPH_BASE, GraphDenied } from '../../src/email/guard';
import { applyApproved, approvedChoice, approvedMoves, memoryState, observe, safeHttps, subKey, unsubscribeTarget, writeHygieneAsks, type BatchKind, type HygieneState, type Http, type MailActions } from '../../src/email/hygiene';
import { DEFAULT_RULES, prefilter } from '../../src/email/rules';
import { runTriage } from '../../src/email/run';
import { toAsk } from '../../src/email/to-ask';
import type { Classifier, MailProvider, Message, TriageResult } from '../../src/email/types';
import { mkCtx, msg, NOW } from './fixtures';

const H = 3600_000;
const old = (h: number) => new Date(NOW.getTime() - h * H).toISOString();
const read = async (storage: { read(p: string): Promise<{ content: string }> }, key: string) => parseAsk(key, (await storage.read(asksPath(key))).content);
const SIGNED = { 'Authentication-Results': 'mx.example.test; spf=pass; dkim=pass header.d=weekly.example.test; dmarc=pass' };
const news = (over: Partial<Message> = {}): Message => msg({
  id: 'n1', conversationId: 'cn1', subject: 'Weekly digest #12', from: { name: 'Cloud Weekly', address: 'news@weekly.example.test' }, receivedAt: old(30), bodyPreview: 'This week in cloud.',
  headers: { ...SIGNED, 'List-Id': '<weekly.example.test>', 'List-Unsubscribe': '<https://weekly.example.test/u/abc>, <mailto:u@weekly.example.test>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }, ...over,
});
const settled = (m: Message, cls: TriageResult['class'], extra: Partial<TriageResult> = {}): TriageResult => ({ message: m, class: cls, confidence: 1, ...extra });
const keyOf = (s: HygieneState, kind: BatchKind) => s.batches.find((b) => b.kind === kind)!.key;
function actions(fail: (id: string) => unknown = () => undefined) {
  const moved: { id: string; to: string }[] = [];
  const a: MailActions = { move: jest.fn(async (id, to) => { const e = fail(id); if (e) throw e; moved.push({ id, to }); }) };
  return { a, moved };
}
const ctxNow = () => { const c = mkCtx(); return { ...c, ctx: { ...c.ctx, now: () => NOW } }; };

// @req FR:email-inbox-zero/gate.guard
describe('guard: approved moves only, each to its one folder', () => {
  const move = (id: string, body: unknown) => ({ method: 'POST', url: `${GRAPH_BASE}/me/messages/${id}/move`, body });
  it('allows exactly the approved id and folder, nothing else', () => {
    const g = createGraphGuard({ mode: 'drafts', approvedMoves: new Map([['A1', 'archive' as const], ['S1', 'junkemail' as const]]) });
    expect(() => g.check(move('A1', { destinationId: 'archive' }))).not.toThrow();
    expect(() => g.check(move('S1', { destinationId: 'junkemail' }))).not.toThrow();
    for (const bad of [move('A1', { destinationId: 'junkemail' }), move('A2', { destinationId: 'archive' }), move('A1', { destinationId: 'deleteditems' }), move('A1', { destinationId: 'archive', x: 1 }), { method: 'DELETE', url: `${GRAPH_BASE}/me/messages/A1` }, { method: 'POST', url: `${GRAPH_BASE}/me/messages/A1/send` }, { method: 'POST', url: `${GRAPH_BASE}/me/messages/A1/copy`, body: { destinationId: 'archive' } }]) {
      expect(() => g.check(bad)).toThrow(GraphDenied);
    }
  });
  it('denies every move without approvals, or outside drafts mode', () => {
    expect(() => createGraphGuard({ mode: 'drafts' }).check(move('A1', { destinationId: 'archive' }))).toThrow(GraphDenied);
    expect(() => createGraphGuard({ mode: 'observe', approvedMoves: new Map([['A1', 'archive' as const]]) }).check(move('A1', { destinationId: 'archive' }))).toThrow(GraphDenied);
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
    expect(await writeHygieneAsks(ctx, s, { now: NOW })).toEqual({ archive: 2, spam: 1 });
    const a = await read(storage, keyOf(s, 'archive'));
    expect(keyOf(s, 'archive')).toMatch(/^mail-archive-[0-9a-f]{10}$/);
    expect(a).toMatchObject({ kind: 'approve', ask: 'Archive 2 settled messages?', recommend: 'Archive', default: 'Nothing moves', reversible: true, from: 'email-triage' });
    expect(a.detail).toMatch(/newsletter · Cloud Weekly · Weekly digest #12/);
    expect(a.detail).not.toMatch(/Quarterly/);
    expect(await read(storage, keyOf(s, 'spam'))).toMatchObject({ kind: 'approve', ask: 'Move 1 spam message to Junk?' });
  });

  it('never rewrites an open batch: new mail waits for the next one, so a go covers exactly what was shown', async () => {
    const { storage, ctx } = ctxNow();
    const s = await memoryState().get();
    await writeHygieneAsks(ctx, s, { now: NOW });
    expect(await storage.listAsks!()).toEqual([]);
    observe(s, settled(news(), 'newsletter'), { now: NOW });
    await writeHygieneAsks(ctx, s, { now: NOW });
    const first = keyOf(s, 'archive');
    observe(s, settled(news({ id: 'n2', conversationId: 'cn2' }), 'newsletter'), { now: NOW });
    await writeHygieneAsks(ctx, s, { now: NOW });
    expect(s.batches).toHaveLength(1);
    expect(s.batches[0].ids).toEqual(['n1']);
    expect((await read(storage, first)).ask).toBe('Archive 1 settled message?');
  });

  it('keeps VIP mail and declined mail out of every batch', async () => {
    const s = await memoryState().get();
    observe(s, settled(msg({ id: 'v1', receivedAt: old(30) }), 'fyi', { vip: true }), { now: NOW });
    observe(s, settled(msg({ id: 'v2', receivedAt: old(30) }), 'spam', { vip: true }), { now: NOW });
    s.declined.push('d1');
    observe(s, settled(msg({ id: 'd1', receivedAt: old(30) }), 'fyi'), { now: NOW });
    expect([...s.archive, ...s.spam]).toEqual([]);
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
    return { ...c, state, key: keyOf(s, 'archive') };
  }

  it('does nothing while open or after a retract; "no" declines for good', async () => {
    const { storage, ctx, state, key } = await seeded();
    const { a, moved } = actions();
    await applyApproved(ctx, { state, actions: a });
    await answerAsk(ctx, key, { answer: 'go' });
    await answerAsk(ctx, key, { answer: 'retract' });
    await applyApproved(ctx, { state, actions: a });
    expect(moved).toEqual([]);
    await answerAsk(ctx, key, { answer: 'no' });
    await applyApproved(ctx, { state, actions: a });
    expect(moved).toEqual([]);
    expect(await read(storage, key)).toMatchObject({ state: 'done', note: 'Nothing moved; these will not be asked about again' });
    const s = await state.get();
    expect(s.declined).toEqual(['n1', 'n2']);
    observe(s, settled(news({ isRead: true }), 'newsletter'), { now: NOW });
    expect(s.archive).toEqual([]);
  });

  it('ignores a go on an ask someone else rewrote, or one written by another agent', async () => {
    const { storage, ctx, state, key } = await seeded();
    await putAsk(ctx, key, { ask: 'Archive 2 settled messages? (also 40 more)' }, 'other-agent');
    await answerAsk(ctx, key, { answer: 'go' });
    expect((await approvedMoves(ctx, await state.get())).size).toBe(0);
    const { a, moved } = actions();
    await applyApproved(ctx, { state, actions: a });
    expect(moved).toEqual([]);
    expect(await read(storage, key)).toMatchObject({ state: 'done', note: 'Changed outside email-triage; nothing moved' });
    await putAsk(ctx, 'mail-spam-x', { ask: 'Move 9 spam messages to Junk?', kind: 'approve', from: 'someone-else' }, 'someone-else');
    await answerAsk(ctx, 'mail-spam-x', { answer: 'go' });
    expect(await approvedChoice(ctx, 'mail-spam-x')).toBeNull();
  });

  it('moves exactly the listed ids once after go, to the batch folder, then handles the ask', async () => {
    const { storage, ctx, state, key } = await seeded();
    const { a, moved } = actions();
    await answerAsk(ctx, key, { answer: 'go' });
    expect([...(await approvedMoves(ctx, await state.get()))]).toEqual([['n1', 'archive'], ['n2', 'archive']]);
    const r = await applyApproved(ctx, { state, actions: a });
    expect(moved).toEqual([{ id: 'n1', to: 'archive' }, { id: 'n2', to: 'archive' }]);
    expect(r).toMatchObject({ archived: 2, junked: 0, failed: 0 });
    expect(await read(storage, key)).toMatchObject({ state: 'done', outcome: 'handled', note: 'Archived 2' });
    await applyApproved(ctx, { state, actions: a });
    expect(moved).toHaveLength(2);
    expect((await state.get())).toMatchObject({ archive: [], batches: [] });
  });

  it('treats 404 as already moved (crash retry), re-asks real failures in a new batch', async () => {
    const { storage, ctx, state, key } = await seeded();
    const { a } = actions((id) => (id === 'n1' ? Object.assign(new Error('gone'), { status: 404 }) : id === 'n2' ? new Error('throttled') : undefined));
    await answerAsk(ctx, key, { answer: 'go' });
    expect(await applyApproved(ctx, { state, actions: a })).toMatchObject({ archived: 0, failed: 1 });
    expect((await read(storage, key)).note).toBe('Archived 0; 1 failed and will be asked again');
    const s = await state.get();
    expect(s.archive.map((x) => x.id)).toEqual(['n2']);
    await writeHygieneAsks(ctx, s, { now: NOW });
    expect(s.batches[0].ids).toEqual(['n2']);
  });

  it('a reply or a question is not an approval: nothing moves, mail is asked again', async () => {
    const { storage, ctx, state, key } = await seeded();
    const { a, moved } = actions();
    await answerAsk(ctx, key, { answer: 'ask', text: 'What is in it?' });
    await applyApproved(ctx, { state, actions: a });
    expect(moved).toEqual([]);
    expect((await read(storage, key)).note).toBe('Nothing moved (not an approval); a new batch will be asked');
    expect((await state.get()).declined).toEqual([]);
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
    expect(await read(storage, key)).toMatchObject({ kind: 'decide', ask: 'Keep Cloud Weekly?', why: 'Weekly roundup of Azure pricing changes.', options: ['Keep', 'Unsubscribe', 'Archive on arrival'], recommend: 'Keep', default: 'Keep (nothing changes)' });
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
  it('only a DKIM-passing issue can set where an unsubscribe goes; one-click needs DKIM', () => {
    const s = { version: 1 as const, archive: [], spam: [], batches: [], declined: [], subs: {} } as HygieneState;
    observe(s, settled(news(), 'newsletter'), { now: NOW });
    observe(s, settled(news({ id: 'evil', headers: { 'List-Id': '<weekly.example.test>', 'List-Unsubscribe': '<https://evil.example.test/x>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }), 'newsletter'), { now: NOW });
    expect(s.subs[subKey('weekly.example.test')].url).toBe('https://weekly.example.test/u/abc');
    expect(unsubscribeTarget({ 'List-Unsubscribe': '<https://weekly.example.test/u>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }).method).toBe('link');
  });
  it('keys by sender address when there is no List-Id', () => {
    expect(subKey('a@b.example.test')).toBe(`sub-${createHash('sha1').update('a@b.example.test').digest('hex').slice(0, 12)}`);
  });
});

// @req FR:email-inbox-zero/sub.revisit @req FR:email-inbox-zero/sub.unsubscribe
describe('subscription decisions', () => {
  async function decided(answer: { answer: 'option' | 'no' | 'ask'; text?: string }, headers?: Record<string, string>) {
    const { storage, ctx } = ctxNow();
    const state = memoryState();
    const s = await state.get();
    for (const i of [1, 2]) observe(s, settled(news({ id: `n${i}`, conversationId: `c${i}`, ...(headers ? { headers } : {}) }), 'newsletter'), { now: NOW });
    await writeHygieneAsks(ctx, s, { now: NOW, judge: { newsletterValue: async () => 'Pricing news.' } });
    await state.put(s);
    const key = subKey('weekly.example.test');
    await answerAsk(ctx, key, answer);
    return { storage, ctx, state, key };
  }
  const opt = (text: string) => ({ answer: 'option' as const, text });
  const http = (status = 200) => {
    const calls: { url: string; body: string; headers: Record<string, string> }[] = [];
    const h: Http = { post: jest.fn(async (url: string, body: string, headers: Record<string, string>) => { calls.push({ url, body, headers }); return { status }; }) };
    return { h, calls };
  };

  it('Keep records the value and re-asks after 30 days with reads since the decision', async () => {
    const { storage, ctx, state, key } = await decided(opt('Keep'));
    await applyApproved(ctx, { state, actions: actions().a });
    expect(await read(storage, key)).toMatchObject({ state: 'done', outcome: 'handled' });
    const s = await state.get();
    expect(s.subs[key]).toMatchObject({ decision: 'keep', value: 'Pricing news.', revisit: new Date(NOW.getTime() + 30 * 24 * H).toISOString(), since: { issues: 2, read: 0 } });
    const later = new Date(NOW.getTime() + 31 * 24 * H);
    observe(s, settled(news({ id: 'n3', conversationId: 'c3', isRead: true }), 'newsletter'), { now: later });
    await writeHygieneAsks(ctx, s, { now: later });
    const a = await read(storage, key);
    expect(a).toMatchObject({ state: 'open', kind: 'decide', ask: 'Still worth it? Cloud Weekly', options: ['Keep', 'Unsubscribe', 'Archive on arrival'] });
    expect(a.why).toBe(`Expected "Pricing news." Read 1 of 1 issue since ${NOW.toISOString().slice(0, 10)}.`);
  });

  it('a "no" or a question does not nag: it keeps quietly until the revisit', async () => {
    for (const ans of [{ answer: 'no' as const }, { answer: 'ask' as const, text: 'why?' }]) {
      const { ctx, state, key } = await decided(ans);
      await applyApproved(ctx, { state, actions: actions().a });
      const s = await state.get();
      expect(s.subs[key]).toMatchObject({ decision: 'keep', asked: false });
      await writeHygieneAsks(ctx, s, { now: NOW, judge: { newsletterValue: async () => 'x' } });
      expect(s.subs[key].asked).toBe(false);
    }
  });

  it('Unsubscribe sends one RFC 8058 one-click POST to the https header URL and handles the ask', async () => {
    const { storage, ctx, state, key } = await decided(opt('Unsubscribe'));
    const { h, calls } = http();
    await applyApproved(ctx, { state, actions: actions().a, http: h });
    expect(calls).toEqual([{ url: 'https://weekly.example.test/u/abc', body: 'List-Unsubscribe=One-Click', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }]);
    expect(await read(storage, key)).toMatchObject({ state: 'done', note: 'Unsubscribed (one-click)' });
    expect((await state.get()).subs[key].decision).toBe('unsubscribed');
    await applyApproved(ctx, { state, actions: actions().a, http: h });
    expect(calls).toHaveLength(1);
  });

  it('a failed POST or a link-only list becomes a go-do with the link; mailto is never sent', async () => {
    const failed = await decided(opt('Unsubscribe'));
    await applyApproved(failed.ctx, { state: failed.state, actions: actions().a, http: http(500).h });
    expect(await read(failed.storage, failed.key)).toMatchObject({ state: 'open', kind: 'go-do', link: 'https://weekly.example.test/u/abc', ask: 'Unsubscribe from Cloud Weekly (one-click failed: HTTP 500)' });

    const linkOnly = await decided(opt('Unsubscribe'), { ...SIGNED, 'List-Id': '<weekly.example.test>', 'List-Unsubscribe': '<https://weekly.example.test/u/abc>' });
    const { h, calls } = http();
    await applyApproved(linkOnly.ctx, { state: linkOnly.state, actions: actions().a, http: h });
    expect(calls).toEqual([]);
    expect(await read(linkOnly.storage, linkOnly.key)).toMatchObject({ kind: 'go-do', link: 'https://weekly.example.test/u/abc' });

    const mailto = await decided(opt('Unsubscribe'), { ...SIGNED, 'List-Id': '<weekly.example.test>', 'List-Unsubscribe': '<mailto:u@weekly.example.test>' });
    await applyApproved(mailto.ctx, { state: mailto.state, actions: actions().a, http: h });
    expect(calls).toEqual([]);
    expect(await read(mailto.storage, mailto.key)).toMatchObject({ kind: 'go-do', ask: 'Unsubscribe from Cloud Weekly (by email: u@weekly.example.test)' });
  });

  it('Archive on arrival puts later issues in the next batch (still needs approval)', async () => {
    const { storage, ctx, state } = await decided(opt('Archive on arrival'));
    const { a, moved } = actions();
    await applyApproved(ctx, { state, actions: a });
    const s = await state.get();
    s.batches = []; s.archive = [];
    observe(s, settled(news({ id: 'n9', conversationId: 'c9', subject: 'Weekly digest #99', receivedAt: old(1) }), 'newsletter'), { now: NOW });
    await writeHygieneAsks(ctx, s, { now: NOW });
    expect((await read(storage, keyOf(s, 'archive'))).detail).toMatch(/Weekly digest #99/);
    expect(moved).toEqual([]);
  });

  it.each([
    ['https://10.0.0.1/u', null], ['https://localhost/u', null], ['https://localhost./u', null], ['https://printer.local/u', null], ['https://wiki.internal/u', null], ['https://intranet/u', null],
    ['http://weekly.example.test/u', null], ['https://user:pw@weekly.example.test/u', null], ['https://[::1]/u', null],
    ['https://weekly.example.test/u?id=1', 'https://weekly.example.test/u?id=1'],
  ])('safeHttps(%p) is %p', (u, out) => expect(safeHttps(u) ?? null).toBe(out));
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
  const provider = (messages: Message[]): MailProvider => ({ delta: async () => ({ messages, cursor: 'c' }), createDraft: async () => ({ id: 'D', webLink: 'https://outlook.example.test/d' }) });
  const classifier: Classifier = { classify: async () => ({ class: 'fyi', urgency: 0, confidence: 0.9, reason: 'info' }) };
  it('observes each triaged message, writes batch asks and applies approvals on the next pass', async () => {
    const { ctx } = ctxNow();
    const state = memoryState();
    const { a, moved } = actions();
    const { summary } = await runTriage({ ctx, provider: provider([news(), msg({ id: 'q', conversationId: 'cq', receivedAt: old(30) })]), classifier, rules: DEFAULT_RULES, hygiene: { state, actions: a } });
    expect(summary).toMatchObject({ archivePending: 2, spamPending: 0 });
    await answerAsk(ctx, keyOf(await state.get(), 'archive'), { answer: 'go' });
    await runTriage({ ctx, provider: provider([]), classifier, rules: DEFAULT_RULES, hygiene: { state, actions: a } });
    expect(moved.map((m) => m.id).sort()).toEqual(['n1', 'q']);
  });
  it('never spreads a class to older messages in the thread', async () => {
    const { ctx } = ctxNow();
    const state = memoryState();
    await runTriage({ ctx, provider: provider([msg({ id: 'old', conversationId: 'c1', receivedAt: old(40) }), msg({ id: 'new', conversationId: 'c1', receivedAt: old(30), headers: { 'Authentication-Results': 'dmarc=fail' } })]), classifier, rules: DEFAULT_RULES, hygiene: { state, actions: actions().a } });
    expect((await state.get()).spam.map((x) => x.id)).toEqual(['new']);
    expect((await state.get()).archive).toEqual([]);
  });
  it('writes no batch or subscription asks in observe mode (no actions)', async () => {
    const { storage, ctx } = ctxNow();
    await runTriage({ ctx, provider: provider([news(), news({ id: 'n2', conversationId: 'cn2' })]), classifier, rules: DEFAULT_RULES, hygiene: { state: memoryState(), judge: { newsletterValue: async () => 'x' } } });
    expect(await storage.listAsks!()).toEqual([]);
  });
});

// Round 2 @req FR:email-inbox-zero/gate.guard @req FR:email-inbox-zero/gate.answered @req FR:email-inbox-zero/sub.ledger
describe('round 2 regressions', () => {
  it('denies a move with no folder, even with approvals', () => {
    const g = createGraphGuard({ mode: 'drafts', approvedMoves: new Map([['A1', 'archive' as const]]) });
    for (const body of [{ destinationId: undefined }, {}, { destinationId: null }]) expect(() => g.check({ method: 'POST', url: `${GRAPH_BASE}/me/messages/ZZ/move`, body })).toThrow(GraphDenied);
  });
  it('refuses a batch whose kind or recommendation was changed, or that changed after the answer', async () => {
    const { ctx } = ctxNow();
    const state = memoryState();
    const s = await state.get();
    observe(s, settled(news(), 'newsletter'), { now: NOW });
    await writeHygieneAsks(ctx, s, { now: NOW });
    const key = keyOf(s, 'archive');
    await putAsk(ctx, key, { recommend: 'Keep all' }, 'email-triage');
    await answerAsk(ctx, key, { answer: 'go' });
    expect((await approvedMoves(ctx, s)).size).toBe(0);

    const c2 = mkCtx(); // a ticking clock: every write has its own time
    const s2 = await memoryState().get();
    observe(s2, settled(news(), 'newsletter'), { now: NOW });
    await writeHygieneAsks(c2.ctx, s2, { now: NOW });
    const k2 = keyOf(s2, 'archive');
    const original = (await read(c2.storage, k2)).ask;
    await answerAsk(c2.ctx, k2, { answer: 'go' });
    expect((await approvedMoves(c2.ctx, s2)).size).toBe(1);
    await putAsk(c2.ctx, k2, { ask: 'Archive 900 settled messages?' }, 'email-triage');
    await putAsk(c2.ctx, k2, { ask: original }, 'email-triage');
    expect((await approvedMoves(c2.ctx, s2)).size).toBe(0);
  });
  it('accepts an unsubscribe target only with DKIM aligned to the From domain', () => {
    const h = (ar: string) => ({ 'Authentication-Results': ar, 'List-Unsubscribe': '<https://weekly.example.test/u>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' });
    expect(unsubscribeTarget(h('dkim=pass header.d=weekly.example.test'), 'news@weekly.example.test').method).toBe('one-click');
    expect(unsubscribeTarget(h('dkim=pass header.d=example.test'), 'news@weekly.example.test').method).toBe('one-click');
    expect(unsubscribeTarget(h('dkim=pass header.d=attacker.example'), 'news@weekly.example.test').method).toBe('link');
    expect(unsubscribeTarget(h('dkim=pass'), 'news@weekly.example.test').method).toBe('link');
    const s = { version: 1 as const, archive: [], spam: [], batches: [], declined: [], subs: {} } as HygieneState;
    observe(s, settled(news({ headers: { 'List-Id': '<weekly.example.test>', 'List-Unsubscribe': '<mailto:x@weekly.example.test>' } }), 'newsletter'), { now: NOW });
    expect(s.subs[subKey('weekly.example.test')].method).toBe('none');
  });
  it('caps a batch at 200 messages', async () => {
    const { ctx } = ctxNow();
    const s = await memoryState().get();
    for (let i = 0; i < 250; i++) observe(s, settled(msg({ id: `m${i}`, conversationId: `c${i}`, receivedAt: old(30) }), 'fyi'), { now: NOW });
    await writeHygieneAsks(ctx, s, { now: NOW });
    expect(s.batches[0].ids).toHaveLength(200);
  });
});

// Round 3 @req FR:email-inbox-zero/sub.ledger
describe('round 3: subscription rows bind to their signer', () => {
  const sub = subKey('weekly.example.test');
  it('ignores an aligned signature from another domain on the same List-Id, and a second Authentication-Results', () => {
    const s = { version: 1 as const, archive: [], spam: [], batches: [], declined: [], subs: {} } as HygieneState;
    observe(s, settled(news(), 'newsletter'), { now: NOW });
    expect(s.subs[sub]).toMatchObject({ domain: 'weekly.example.test', url: 'https://weekly.example.test/u/abc', method: 'one-click' });
    observe(s, settled(news({ id: 'e1', from: { address: 'x@evil.example.net' }, headers: { 'Authentication-Results': 'dkim=pass header.d=evil.example.net', 'List-Id': '<weekly.example.test>', 'List-Unsubscribe': '<https://evil.example.net/u>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }), 'newsletter'), { now: NOW });
    observe(s, settled(news({ id: 'e2', headers: { 'Authentication-Results': 'mx; dkim=none; dmarc=none', 'authentication-results': 'x; dkim=pass header.d=weekly.example.test', 'List-Id': '<weekly.example.test>', 'List-Unsubscribe': '<https://weekly.example.test/evil>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } }), 'newsletter'), { now: NOW });
    expect(s.subs[sub]).toMatchObject({ url: 'https://weekly.example.test/u/abc', method: 'one-click' });
  });
  it('one-click only to a URL under the signing domain; an ESP link is a link', () => {
    const h = { 'Authentication-Results': 'dkim=pass header.d=weekly.example.test', 'List-Unsubscribe': '<https://esp.example.net/u>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
    expect(unsubscribeTarget(h, 'news@weekly.example.test')).toEqual({ method: 'link', url: 'https://esp.example.net/u' });
  });
});
