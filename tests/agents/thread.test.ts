/** @req FR:agent-thread/thread.read @req FR:agent-thread/thread.assign @req FR:agent-thread/reply.session */
import { createRunManager, type AgentDriver, type Run, type Session, type Update } from '../../src/agents';
import { assignTask, personaOf, reviewTask, taskThread } from '../../src/agents/team';
import { putAgent } from '../../src/core/agents';
import { answerAsk, listAsks, putAsk } from '../../src/core/asks';
import { replyFromAgent, sendToInbox } from '../../src/core/inbox';
import { MemoryStorage } from '../../src/core/storage';

const NOW = new Date('2026-10-29T10:00:00Z');
const F4 = '# 🎧 Flantastic 4\n\n- **Agents:**\n  - `🎧 Cid Manager` — label manager\n\n## 🔄 Active\n\n- [ ] Release the single 🟡\n  - [ ] 🪄 Upload the cover\n  - [ ] Pick the date\n- [ ] 🙋 Sign the contract\n';
const wait = (ms = 15) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean | Promise<boolean>, ms = 2000) { const t0 = Date.now(); while (!(await fn())) { if (Date.now() - t0 > ms) throw new Error('timeout'); await wait(5); } }

function fakeDriver(sessions: Session[] = []) {
  const prompts: Parameters<AgentDriver['prompt']>[0][] = [];
  const driver: AgentDriver = {
    listSessions: async () => sessions,
    getMessages: async () => [],
    async prompt(req) {
      prompts.push(req);
      const n = prompts.length;
      const updates = (async function* (): AsyncGenerator<Update> {
        yield { type: 'session', sessionId: `a1b2c3d4-0000-0000-0000-00000000000${n}` };
        yield { type: 'done', stopReason: 'end_turn', cost: { usd: 0.2, tokens: 10 }, turns: 1, durationMs: 5, text: 'ok', ...(req.options?.schema ? { structured: { verdict: 'partial', plan: 'Cover first', estimate: '1h', needs: [{ what: 'Which cover?', kind: 'answer' }] } } : {}) };
      })();
      return { id: `run-${n}`, sessionId: null, updates } as Run;
    },
    cancel: async () => false,
  };
  return { driver, prompts };
}
async function mk(sessions: Session[] = []) {
  const storage = new MemoryStorage();
  await storage.write('tasks/flantastic-4.md', F4);
  let t = 0;
  const ctx = { storage, now: () => new Date(NOW.getTime() + 1000 * t++) };
  await putAgent(ctx, 'cid-manager', { name: '🎧 Cid Manager', scope: ['flantastic-4'] });
  const { driver, prompts } = fakeDriver(sessions);
  const runs = createRunManager({ driver, ctx, cwd: '/served' });
  return { storage, ctx, runs, prompts };
}

describe('taskThread', () => {
  it('merges owner messages, agent replies, asks on the task, the review verdict, and agent-owned subtasks in time order', async () => {
    const { ctx, runs } = await mk();
    const ref = { path: 'tasks/flantastic-4.md', line: 7 };
    await sendToInbox(ctx, ref, 'Can you take this?', 'reply');
    await replyFromAgent(ctx, ref, 'Yes. One question first.', 'cid-manager');
    await putAsk(ctx, 'q1', { ask: 'Which cover?', kind: 'answer', from: 'cid-manager', ref: 'flantastic-4:7' }, 'cid-manager');
    await putAsk(ctx, 'other', { ask: 'Unrelated', kind: 'answer', from: 'cos' }, 'cos');
    await reviewTask(runs, ctx, 'flantastic-4:7');
    await until(async () => (await listAsks(ctx, { state: 'open' })).items.length === 3);
    const th = await taskThread(ctx, runs, 'flantastic-4:7');
    expect(th.items.map((i) => i.kind)).toEqual(['owner', 'agent', 'ask', 'review', 'ask', 'subtask']);
    expect(th.items[0]).toMatchObject({ kind: 'owner', text: 'Can you take this?', state: 'open' });
    expect(th.items[1]).toMatchObject({ kind: 'agent', agent: 'cid-manager', text: 'Yes. One question first.' });
    expect(th.items[2]).toMatchObject({ kind: 'ask', ask: { key: 'q1', ref: 'flantastic-4:7' } });
    expect(th.items[3]).toMatchObject({ kind: 'review', verdict: 'partial', plan: 'Cover first', estimate: '1h', agent: 'cid-manager' });
    expect((th.items[4] as { ask: { key: string } }).ask.key).toMatch(/^rev-flantastic-4-8-/); // the review's need carries the ref
    expect(th.items[5]).toMatchObject({ kind: 'subtask', ref: 'flantastic-4:8', text: '🪄 Upload the cover', done: false });
    expect(th.review).toMatchObject({ verdict: 'partial', needs: [expect.stringMatching(/^rev-/)] });
    expect(th.session).toBeUndefined();
    // An answered ask still shows; a resolved one too (history), both keyed by ref.
    await answerAsk(ctx, 'q1', { answer: 'reply', text: 'The square one' });
    expect((await taskThread(ctx, undefined, 'flantastic-4:7')).items.filter((i) => i.kind === 'ask')).toHaveLength(2);
    await expect(taskThread(ctx, undefined, 'flantastic-4:99')).rejects.toThrow(/not found/i);
    await expect(taskThread(ctx, undefined, 'nope')).rejects.toThrow(/Bad ref/);
  });
  it('names the task session (by title suffix) when a runner lists one', async () => {
    const sess = (id: string, title: string, lastActive: string): Session => ({ id, title, project: 'x', cwd: '/x', lastActive, active: false, cost: { usd: 0, tokens: 0 }, prs: [] });
    const { ctx, runs } = await mk([sess('a1b2c3d4-0000-0000-0000-000000000001', 'Cid · Release · flantastic-4:7', '2026-10-29T09:00:00Z'), sess('a1b2c3d4-0000-0000-0000-000000000002', 'Cid · review · Release · flantastic-4:7', '2026-10-29T11:00:00Z')]);
    const th = await taskThread(ctx, runs, 'flantastic-4:7');
    expect(th.session).toMatchObject({ id: 'a1b2c3d4-0000-0000-0000-000000000002', state: expect.any(String) });
  });
});

describe('assignTask', () => {
  it('claims the row for the agent and starts the session with the assign prompt; a 🙋 row is refused', async () => {
    const { ctx, runs, prompts, storage } = await mk();
    const r = await assignTask(runs, ctx, 'flantastic-4:7');
    expect(r).toMatchObject({ agent: 'cid-manager', claimed: true, title: expect.stringMatching(/ · flantastic-4:7$/) });
    expect(prompts[0].text).toContain('This task is yours now');
    expect(prompts[0].text).toContain('--ref');
    expect((await storage.read('tasks/flantastic-4.md')).content).toContain('🚧');
    const log = (await storage.read('tasks/logs/flantastic-4.md')).content;
    expect(log).toContain('- actor: agent:cid-manager');
    expect(log).toContain('- action: claimed');
    await expect(assignTask(runs, ctx, 'flantastic-4:10')).rejects.toThrow(/Needs a human/);
    expect(prompts).toHaveLength(1);
  });
});

describe('persona', () => {
  it('tells the agent to reply on the task and raise asks with --ref', () => {
    const p = personaOf({ slug: 'cos', name: 'CoS', scope: ['*'], mode: 'ad-hoc', prompt: '', defined: true, projects: [] });
    expect(p).toContain('stack inbox reply tasks/<file>.md:<line>');
    expect(p).toContain('stack asks put --ref');
  });
});
