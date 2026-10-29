/** @req FR:agent-team/talk.start @req FR:agent-team/review.run @req FR:agent-team/review.record @req FR:agent-team/review.needs @req FR:agent-team/review.read @req FR:agent-team/driver.options @req FR:agent-team/driver.cwd */
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createRunManager, createSdkDriver, READ_ONLY_TOOLS, WRITE_TOOLS, type AgentDriver, type Run, type SdkLike, type Update } from '../../src/agents';
import { listReviews, parseVerdict, personaOf, reviewTask, sessionTitle, startAgentRun, taskContext } from '../../src/agents/team';
import { listAsks } from '../../src/core/asks';
import { putAgent, reviewOf } from '../../src/core/agents';
import { MemoryStorage } from '../../src/core/storage';

const NOW = new Date('2026-10-29T10:00:00Z');
const F4 = '# 🎧 Flantastic 4\n\n- **Agents:**\n  - `🎧 Cid Manager` — label manager\n\n## 🔄 Active\n\n- [ ] Release the single 🟡\n  > cover is done\n  - [ ] Upload to DistroKid\n- [ ] Ship labels\n';
const wait = (ms = 15) => new Promise((r) => setTimeout(r, ms));
async function until(fn: () => boolean | Promise<boolean>, ms = 2000) { const t0 = Date.now(); while (!(await fn())) { if (Date.now() - t0 > ms) throw new Error('timeout'); await wait(5); } }

/** A driver that records prompts and plays one scripted `done`. */
function fakeDriver(done: Partial<Extract<Update, { type: 'done' }>> = {}) {
  const prompts: Parameters<AgentDriver['prompt']>[0][] = [];
  const driver: AgentDriver = {
    listSessions: async () => [],
    getMessages: async () => [],
    async prompt(req) {
      prompts.push(req);
      const updates = (async function* (): AsyncGenerator<Update> {
        yield { type: 'session', sessionId: `a1b2c3d4-0000-0000-0000-00000000000${prompts.length}` };
        yield { type: 'message_chunk', role: 'assistant', text: 'ok' };
        yield { type: 'done', stopReason: 'end_turn', cost: { usd: 0.3, tokens: 100 }, turns: 2, durationMs: 50, ...done };
      })();
      return { id: `run-${prompts.length}`, sessionId: null, updates } as Run;
    },
    cancel: async () => false,
  };
  return { driver, prompts };
}

async function mk(done?: Partial<Extract<Update, { type: 'done' }>>) {
  const storage = new MemoryStorage();
  await storage.write('tasks/flantastic-4.md', F4);
  let t = 0;
  const ctx = { storage, now: () => new Date(NOW.getTime() + 1000 * t++) };
  await putAgent(ctx, 'cid-manager', { name: '🎧 Cid Manager', role: 'Label manager', scope: ['flantastic-4'], model: 'sonnet', prompt: 'Own the label.' });
  await putAgent(ctx, 'cos', { name: 'CoS', scope: ['*'] });
  const { driver, prompts } = fakeDriver(done);
  const runs = createRunManager({ driver, ctx, cwd: '/repo' });
  return { storage, ctx, runs, prompts };
}

describe('taskContext and persona', () => {
  it('describes the row, its notes, subtasks, section, and project; the persona names the agent, scope, and ask rule', async () => {
    const { ctx } = await mk();
    const c = await taskContext(ctx, { path: 'tasks/flantastic-4.md', line: 7 });
    expect(c).toMatchObject({ title: 'Release the single 🟡', project: 'flantastic-4', section: '🔄 Active' });
    expect(c.text).toBe('Project: 🎧 Flantastic 4 (tasks/flantastic-4.md)\nSection: 🔄 Active\nTask (line 8):\n- [ ] Release the single 🟡\n  > cover is done\n  - [ ] Upload to DistroKid');
    expect((await taskContext(ctx, { path: 'tasks/flantastic-4.md', line: 9 })).text).toContain('Parent: Release the single 🟡');
    await expect(taskContext(ctx, { path: 'tasks/flantastic-4.md', line: 99 })).rejects.toThrow(/not found/i);
    const p = personaOf({ slug: 'cid-manager', name: '🎧 Cid Manager', role: 'Label manager', scope: ['flantastic-4'], mode: 'ad-hoc', prompt: 'Own the label.', defined: true, projects: ['flantastic-4'] }, 'Task: x');
    expect(p).toContain('You are 🎧 Cid Manager, Label manager, an agent in Stack');
    expect(p).toContain('Your scope: flantastic-4');
    expect(p).toContain('stack asks put');
    expect(p.endsWith('Own the label.\n\n## Context\n\nTask: x')).toBe(true);
  });
});

describe('sessionTitle', () => {
  it('keeps the ` · <ref>` suffix inside the 80 characters the session store keeps', () => {
    const long = sessionTitle(`🎧 Cid Manager · ${'Release the single and tell the label '.repeat(4)}`, 'flantastic-4:16');
    expect(long).toHaveLength(80);
    expect(long.endsWith(' · flantastic-4:16')).toBe(true);
    expect(sessionTitle('CoS · flantastic-4', '')).toBe('CoS · flantastic-4');
  });
});

describe('startAgentRun', () => {
  it('starts a session for the task agent with persona, context, model, and a title the page can map back to the task', async () => {
    const { ctx, runs, prompts } = await mk();
    const r = await startAgentRun(runs, ctx, { ref: 'flantastic-4:7', text: 'Do it' });
    expect(r).toMatchObject({ runId: 'run-1', agent: 'cid-manager', title: '🎧 Cid Manager · Release the single 🟡 · flantastic-4:7' });
    expect(prompts[0]).toMatchObject({ cwd: '/repo', text: 'Do it', options: { model: 'sonnet', title: '🎧 Cid Manager · Release the single 🟡 · flantastic-4:7' } });
    expect(prompts[0].options?.systemPrompt).toContain('## Context\n\nProject: 🎧 Flantastic 4');
    expect(prompts[0].options?.allowedTools).toBeUndefined();
    expect(prompts[0].options?.schema).toBeUndefined();
    const p = await startAgentRun(runs, ctx, { project: 'flantastic-4', agent: 'cos', text: 'Plan' });
    expect(p.title).toBe('CoS · flantastic-4');
    await expect(startAgentRun(runs, ctx, { ref: 'flantastic-4:99', text: 'x' })).rejects.toThrow(/not found/i);
    await expect(startAgentRun(runs, ctx, { ref: 'nope', text: 'x' })).rejects.toThrow(/Bad ref/);
    await expect(startAgentRun(runs, ctx, { project: 'other', agent: 'ghost', text: 'x' })).rejects.toThrow(/No agent ghost/);
  });
});

describe('reviewTask', () => {
  const answer = { verdict: 'partial', plan: 'Upload the cover, then wait for the DistroKid login', estimate: '1h', needs: [{ what: 'Share the DistroKid login', kind: 'go-do', why: 'no credentials' }, { what: 'Confirm the release date', kind: 'answer' }] };
  it('runs read-only with the schema, records the verdict, and turns needs into asks; a re-review resolves the old ones', async () => {
    const { ctx, runs, prompts, storage } = await mk({ structured: answer });
    const r = await reviewTask(runs, ctx, 'flantastic-4:7');
    expect(r).toMatchObject({ runId: 'run-1', agent: 'cid-manager' });
    expect(prompts[0].options).toMatchObject({ allowedTools: READ_ONLY_TOOLS, disallowedTools: WRITE_TOOLS, schema: expect.objectContaining({ type: 'object' }), title: '🎧 Cid Manager · review · Release the single 🟡 · flantastic-4:7' });
    expect(prompts[0].text).toContain('Do not start the work');
    await until(async () => (await listAsks(ctx, { state: 'open' })).items.length === 2);
    const rev = await reviewOf(ctx, { path: 'tasks/flantastic-4.md', line: 7 }, (await listAsks(ctx, { state: 'open' })).items.map((a) => a.key));
    expect(rev).toMatchObject({ verdict: 'partial', plan: 'Upload the cover, then wait for the DistroKid login', estimate: '1h', agent: 'cid-manager' });
    expect(rev!.needs).toEqual([expect.stringMatching(/^rev-flantastic-4-8-\d{8}t\d{6}z-1$/), expect.stringMatching(/-2$/)]);
    const asks = (await listAsks(ctx, { state: 'open' })).items;
    expect(asks.map((a) => [a.kind, a.ask, a.from, a.project, a.blocks])).toEqual([['go-do', 'Share the DistroKid login', 'cid-manager', 'flantastic-4', 1], ['answer', 'Confirm the release date', 'cid-manager', 'flantastic-4', 1]]);
    expect(asks[0].why).toBe('Release the single 🟡 — no credentials');
    expect((await storage.read('tasks/flantastic-4.md')).content).toBe(F4); // no 🙋 row
    const list = await listReviews(ctx, 'flantastic-4');
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ ref: 'flantastic-4:7', verdict: 'partial' });
    expect(await listReviews(ctx, 'nope')).toEqual([]);

    await reviewTask(runs, ctx, 'flantastic-4:7', 'cid-manager');
    await until(async () => (await listAsks(ctx, { state: 'done' })).items.length === 2);
    await until(async () => (await listAsks(ctx, { state: 'open' })).items.length === 2);
    expect((await listAsks(ctx, { state: 'done' })).items[0]).toMatchObject({ outcome: 'resolved', note: 'reviewed again' });
  });
  it('reads the verdict from JSON in the text when there is no structured answer; records nothing without one', async () => {
    const a = await mk({ text: `Here you go:\n${JSON.stringify({ ...answer, needs: [] })}` });
    await reviewTask(a.runs, a.ctx, 'flantastic-4:7');
    await until(async () => (await reviewOf(a.ctx, { path: 'tasks/flantastic-4.md', line: 7 })) !== null);
    const b = await mk({ text: 'nope' });
    await reviewTask(b.runs, b.ctx, 'flantastic-4:7');
    await wait(60);
    expect(await reviewOf(b.ctx, { path: 'tasks/flantastic-4.md', line: 7 })).toBeNull();
    const c = await mk({ stopReason: 'error', error: 'boom', structured: answer });
    await reviewTask(c.runs, c.ctx, 'flantastic-4:7');
    await wait(60);
    expect(await reviewOf(c.ctx, { path: 'tasks/flantastic-4.md', line: 7 })).toBeNull();
    // A row that refuses a log entry (🙋) reports the failure instead of swallowing it.
    const d = await mk({ structured: answer });
    await d.storage.write('tasks/flantastic-4.md', F4.replace('- [ ] Ship labels', '- [ ] 🙋 Ship labels'));
    const errors: unknown[] = [];
    await reviewTask(d.runs, d.ctx, 'flantastic-4:10', undefined, (e) => errors.push(e));
    await wait(80);
    expect(errors).toHaveLength(1);
  });
  it('parseVerdict is strict about the shape', () => {
    expect(parseVerdict({ verdict: 'maybe', plan: 'x', needs: [] })).toBeNull();
    expect(parseVerdict({ verdict: 'can', plan: '', needs: [] })).toBeNull();
    expect(parseVerdict('text {"verdict":"can","plan":"p","needs":[{"what":"","kind":"answer"},{"what":"w","kind":"odd"}],"risks":[1]}')).toEqual({ verdict: 'can', plan: 'p', needs: [{ what: 'w', kind: 'odd' }], risks: ['1'] });
    expect(parseVerdict(undefined)).toBeNull();
  });
});

describe('SDK driver prompt options', () => {
  it('passes persona, model, title, tool limits, and the schema to query(); done carries text and the structured answer', async () => {
    const calls: { prompt: string; options?: Record<string, unknown> }[] = [];
    const sdk: SdkLike = {
      getSessionMessages: async () => [],
      query: (args) => {
        calls.push(args);
        return (async function* () {
          yield { type: 'system', subtype: 'init', session_id: 'new-0000-0000-0000-000000000009' };
          yield { type: 'result', subtype: 'success', num_turns: 1, duration_ms: 10, total_cost_usd: 0.01, result: '{"verdict":"can"}', structured_output: { verdict: 'can' }, modelUsage: {} };
        })() as never;
      },
    };
    const home = mkdtempSync(join(tmpdir(), 'stack-home-')); mkdirSync(join(home, 'projects'), { recursive: true });
    const d = createSdkDriver({ sdk, configDir: home, now: () => NOW });
    const run = await d.prompt({ cwd: '/x', text: 'go', options: { systemPrompt: 'You are X.', model: 'sonnet', title: 'X · t', allowedTools: READ_ONLY_TOOLS, disallowedTools: WRITE_TOOLS, schema: { type: 'object' } }, onPermission: async () => ({ optionId: 'deny' }) });
    const seen: Update[] = []; for await (const u of run.updates) seen.push(u);
    expect(calls[0].options).toMatchObject({ cwd: '/x', systemPrompt: { type: 'preset', preset: 'claude_code', append: 'You are X.' }, model: 'sonnet', title: 'X · t', allowedTools: READ_ONLY_TOOLS, disallowedTools: WRITE_TOOLS, outputFormat: { type: 'json_schema', schema: { type: 'object' } } });
    expect(seen.find((u) => u.type === 'done')).toMatchObject({ stopReason: 'end_turn', text: '{"verdict":"can"}', structured: { verdict: 'can' } });
    // A resumed session keeps its title.
    const folder = join(home, 'projects', '-x'); mkdirSync(folder, { recursive: true });
    const file = join(folder, 'a1b2c3d4-0000-0000-0000-000000000001.jsonl'); writeFileSync(file, `${JSON.stringify({ type: 'user', cwd: '/x', message: { role: 'user', content: 'hi' } })}\n`); utimesSync(file, new Date(NOW.getTime() - 3600_000), new Date(NOW.getTime() - 3600_000));
    const again = await d.prompt({ sessionId: 'a1b2c3d4-0000-0000-0000-000000000001', text: 'more', options: { title: 'ignored' }, onPermission: async () => ({ optionId: 'deny' }) });
    for await (const u of again.updates) void u;
    expect(calls[1].options?.title).toBeUndefined();
  });
  it('the run manager runs a new session in its folder by default', async () => {
    const { driver, prompts } = fakeDriver();
    const runs = createRunManager({ driver, ctx: { storage: new MemoryStorage() }, cwd: '/served' });
    expect(runs.cwd).toBe('/served');
    await runs.prompt({ text: 'a' });
    await runs.prompt({ text: 'b', cwd: '/other' });
    await runs.prompt({ text: 'c', sessionId: 'a1b2c3d4-0000-0000-0000-000000000009' });
    expect(prompts.map((p) => p.cwd)).toEqual(['/served', '/other', undefined]);
  });
});
