/**
 * The ask courier: carries each turn to the asking session and wakes it (`.xe/features/ask-routing/spec.md`).
 */
import { answerAsk, putAsk, readAsk } from '../../src/core/asks';
import { MemoryStorage } from '../../src/core/storage';
import { SessionBusy, type Update } from '../../src/agents/driver';
import { courierPass, deliveryPrompt, startAskCourier, type CourierDeps } from '../../src/agents/ask-courier';

const NOW = new Date('2026-11-19T14:00:00Z');
const LINK = '[Stack architect](#local_abc)';
const base = { ask: 'Approve merging PR 879', kind: 'approve' as const, from: 'Stack architect', why: 'CI is green', agent: LINK };

function mk(o: { state?: string; sessions?: { id: string; cli?: string; state: string }[]; prompt?: (r: { sessionId?: string; text: string }) => Promise<{ runId: string; sessionId: string | null }> } = {}) {
  const storage = new MemoryStorage();
  const ctx = { storage, now: () => NOW };
  const prompts: { sessionId?: string; text: string }[] = [];
  const subs = new Map<string, (u: Update) => void>();
  const deps: CourierDeps = {
    ctx,
    runs: {
      prompt: o.prompt ?? (async (r) => { prompts.push(r); return { runId: `run-${prompts.length}`, sessionId: r.sessionId ?? null }; }),
      subscribe: (key, on) => { subs.set(key, on); return () => undefined; },
      running: () => false,
    },
    inventory: () => ({ sessions: (o.sessions ?? [{ id: 'local_abc', cli: 'cli-abc', state: o.state ?? 'idle' }]) as never }),
  };
  return { ctx, deps, prompts, subs };
}

// @req FR:ask-routing/deliver.pick @req FR:ask-routing/deliver.wake @req FR:ask-routing/deliver.prompt
describe('courier pass', () => {
  it('wakes the asking session with the answer, once', async () => {
    const { ctx, deps, prompts } = mk();
    await putAsk(ctx, 'a1', base, 'x');
    expect(await courierPass(deps)).toEqual([]); // owner's turn
    await answerAsk(ctx, 'a1', { answer: 'go' });
    expect(await courierPass(deps)).toEqual([{ key: 'a1', result: 'delivered' }]);
    expect(prompts).toHaveLength(1);
    expect(prompts[0].sessionId).toBe('cli-abc');
    expect(prompts[0].text).toContain('the owner answered your ask a1 ("Approve merging PR 879"): Approved');
    expect(prompts[0].text).toContain('stack asks handle a1 --outcome handled');
    const a = (await readAsk(ctx, 'a1'))!.ask;
    expect(a.delivered).toBe(NOW.toISOString());
    expect(a.thread.at(-1)).toBe(`- ${NOW.toISOString()} stack: delivered to Stack architect`);
    expect(await courierPass(deps)).toEqual([]);
    expect(prompts).toHaveLength(1);
  });
  it('skips asks with no agent link', async () => {
    const { ctx, deps, prompts } = mk();
    const noLink = { ...base, agent: undefined };
    await putAsk(ctx, 'a1', noLink, 'x');
    await answerAsk(ctx, 'a1', { answer: 'go' });
    expect(await courierPass(deps)).toEqual([]);
    expect(prompts).toHaveLength(0);
  });
  it('builds the owner-question prompt with the thread tail', () => {
    const t = deliveryPrompt({ key: 'q1', ask: 'Status?', from: 'owner', state: 'open', thread: ['- t you: first'] } as never);
    expect(t).toContain('the owner asks you (q1): Status?');
    expect(t).toContain('Thread: you: first');
    expect(t).toContain('stack asks reply q1 --text');
  });
});

// @req FR:ask-routing/deliver.find
describe('session gone', () => {
  it('marks undelivered and stops trying', async () => {
    const { ctx, deps, prompts } = mk({ sessions: [] });
    await putAsk(ctx, 'a1', base, 'x');
    await answerAsk(ctx, 'a1', { answer: 'no' });
    expect(await courierPass(deps)).toEqual([{ key: 'a1', result: 'gone' }]);
    const a = (await readAsk(ctx, 'a1'))!.ask;
    expect(a.undelivered).toBe('Session gone');
    expect(a.delivered).toBeUndefined();
    expect(await courierPass(deps)).toEqual([]);
    expect(prompts).toHaveLength(0);
  });
  it('finds a session Stack started by its Claude Code id', async () => {
    const { ctx, deps, prompts } = mk({ sessions: [{ id: 'other', cli: 'abc', state: 'idle' }] });
    await putAsk(ctx, 'a1', base, 'x');
    await answerAsk(ctx, 'a1', { answer: 'go' });
    expect(await courierPass(deps)).toEqual([{ key: 'a1', result: 'delivered' }]);
    expect(prompts[0].sessionId).toBe('abc');
  });
});

// @req FR:ask-routing/deliver.busy
describe('busy session', () => {
  it('is tried again on the next pass', async () => {
    let busy = true;
    const sent: string[] = [];
    const { ctx, deps } = mk({ prompt: async (r) => { if (busy) throw new SessionBusy('busy'); sent.push(r.text); return { runId: 'r', sessionId: 'cli-abc' }; } });
    await putAsk(ctx, 'a1', base, 'x');
    await answerAsk(ctx, 'a1', { answer: 'go' });
    expect(await courierPass(deps)).toEqual([{ key: 'a1', result: 'busy' }]);
    expect((await readAsk(ctx, 'a1'))!.ask.delivered).toBeUndefined();
    busy = false;
    expect(await courierPass(deps)).toEqual([{ key: 'a1', result: 'delivered' }]);
    expect(sent).toHaveLength(1);
  });
  it('never prompts a running session', async () => {
    const { ctx, deps, prompts } = mk({ state: 'running' });
    await putAsk(ctx, 'a1', base, 'x');
    await answerAsk(ctx, 'a1', { answer: 'go' });
    expect(await courierPass(deps)).toEqual([{ key: 'a1', result: 'busy' }]);
    expect(prompts).toHaveLength(0);
  });
  it('an error other than busy is undelivered with the reason', async () => {
    const { ctx, deps } = mk({ prompt: async () => { throw new Error('No such session'); } });
    await putAsk(ctx, 'a1', base, 'x');
    await answerAsk(ctx, 'a1', { answer: 'go' });
    expect(await courierPass(deps)).toEqual([{ key: 'a1', result: 'failed' }]);
    expect((await readAsk(ctx, 'a1'))!.ask.undelivered).toBe('No such session');
  });
});

const ended = (deps: CourierDeps) => new Promise<boolean>((ok) => { deps.onFallback = (_k, posted) => ok(posted); });

// @req FR:ask-routing/deliver.fallback
describe('owner question fallback', () => {
  it('posts the final text as the reply when the agent did not reply', async () => {
    const { ctx, deps, subs } = mk();
    await putAsk(ctx, 'q1', { ask: 'What blocks 316?', from: 'owner', agent: LINK }, 'owner');
    expect(await courierPass(deps)).toEqual([{ key: 'q1', result: 'delivered' }]);
    const done = ended(deps);
    subs.get('run-1')!({ type: 'done', stopReason: 'end_turn', cost: { usd: 0, tokens: 0 }, turns: 1, durationMs: 1, text: 'Lint fails on\nmain.' });
    expect(await done).toBe(true);
    const a = (await readAsk(ctx, 'q1'))!.ask;
    expect(a).toMatchObject({ state: 'answered', answer: 'reply', text: 'Lint fails on main.' });
  });
  it('posts nothing when the agent already replied', async () => {
    const { ctx, deps, subs } = mk();
    await putAsk(ctx, 'q1', { ask: 'Status?', from: 'owner', agent: LINK }, 'owner');
    await courierPass(deps);
    const { replyAsk } = await import('../../src/core/asks');
    await replyAsk(ctx, 'q1', { text: 'Green' }, 'Stack architect');
    const done = ended(deps);
    subs.get('run-1')!({ type: 'done', stopReason: 'end_turn', cost: { usd: 0, tokens: 0 }, turns: 1, durationMs: 1, text: 'I replied.' });
    expect(await done).toBe(false);
    expect((await readAsk(ctx, 'q1'))!.ask.text).toBe('Green');
  });
});

// @req FR:ask-routing/deliver.loop @req FR:ask-routing/deliver.once
describe('loop', () => {
  it('runs at start and never overlaps; two couriers deliver once', async () => {
    const { ctx, deps, prompts } = mk();
    await putAsk(ctx, 'a1', base, 'x');
    await answerAsk(ctx, 'a1', { answer: 'go' });
    const l1 = startAskCourier(deps, { intervalMs: 60_000 });
    const l2 = startAskCourier({ ...deps, ctx: { ...ctx } }, { intervalMs: 60_000 });
    await l1.close(); await l2.close();
    expect(prompts).toHaveLength(1);
  });
});
