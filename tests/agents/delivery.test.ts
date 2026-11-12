/**
 * Agent delivery: an injected runner stands in for `claude`; no process starts and no model is called.
 * @req FR:agent-delivery/pick.entries @req FR:agent-delivery/pick.agent @req FR:agent-delivery/pick.serial @req FR:agent-delivery/pick.once
 * @req NFR:agent-delivery/delivery.seam
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  checkLogin, deliveryArgs, deliverySettings, DeliveryStore, deliveryStatus, liveSessionFor, NEVER_TOOLS, pendingDeliveries, PREFIX,
  runDeliveryPass, startDeliveryLoop, startLogin, type DeliveryDeps,
} from '../../src/agents/delivery';
import type { Runner } from '../../src/email/llm';
import { putAgent } from '../../src/core/agents';
import { answerAsk, readAsk, listAsks } from '../../src/core/asks';
import { handleEntry, listInbox, replyFromAgent, sendToInbox } from '../../src/core/inbox';
import { getDefaults, parseConfig } from '../../src/core/config';
import { MemoryStorage } from '../../src/core/storage';
import type { Inventory, SessionItem } from '../../src/core/session-inventory';

const NOW = new Date('2026-11-12T10:00:00Z');
const F4 = '# 🎧 Flantastic 4\n\n- **Repos:** f4-music\n\n## 🔄 Active\n\n- [ ] 🤖 Release the single 🟡\n- [ ] 🙋 Sign the contract\n- [ ] 🤖 Mix the B side\n';

interface Call { cmd: string; args: string[]; stdin: string; cwd: string; system?: string }
type Reply = { code?: number; stdout?: string; stderr?: string } | Error;
function fakeRunner(o: { login?: boolean | 'weird'; replies?: Reply[] } = {}) {
  const calls: Call[] = [];
  const replies = [...(o.replies ?? [])];
  const run: Runner = async (cmd, args, stdin, opts) => {
    const i = args.indexOf('--system-prompt-file');
    calls.push({ cmd, args, stdin, cwd: opts.cwd, ...(i >= 0 ? { system: readFileSync(args[i + 1], 'utf8') } : {}) });
    if (args[0] === 'auth') {
      if (o.login === 'weird') return { code: 2, stdout: 'garbage', stderr: '' };
      const ok = o.login ?? true;
      return { code: ok ? 0 : 1, stdout: JSON.stringify({ loggedIn: ok }), stderr: '' };
    }
    const r = replies.shift() ?? { stdout: JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'On it: the single ships Friday. token ghp_abcdefghijklmnopqrstuvwxyz0123456789', total_cost_usd: 0.03 }) };
    if (r instanceof Error) throw r;
    return { code: r.code ?? 0, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  return { run, calls, prompts: () => calls.filter((c) => c.args[0] === '-p') };
}

let home: string;
beforeEach(() => { home = mkdtempSync(join(tmpdir(), 'stack-delivery-')); });
afterEach(() => { rmSync(home, { recursive: true, force: true }); });

async function mk(o: Parameters<typeof fakeRunner>[0] = {}, extra: Partial<DeliveryDeps> = {}) {
  const storage = new MemoryStorage();
  await storage.write('tasks/flantastic-4.md', F4);
  let t = 0;
  const ctx = { storage, now: () => new Date(NOW.getTime() + 1000 * t++) };
  await putAgent(ctx, 'cos', { name: 'CoS', scope: ['*'] }); // the roll-up: Now names the specific agent, and so does delivery
  await putAgent(ctx, 'cid', { name: '🎧 Cid', scope: ['flantastic-4'], tools: ['Read', 'Grep', 'Bash'], prompt: 'You run the label.' });
  const f = fakeRunner(o);
  const store = new DeliveryStore(home, ctx.now);
  const d: DeliveryDeps = { ctx, settings: deliverySettings(getDefaults(), '/dev/todo'), store, run: f.run, repoDir: '/dev/todo', isRepo: () => false, ...extra };
  return { storage, ctx, d, store, ...f };
}
const ref = (line: number) => ({ path: 'tasks/flantastic-4.md', line });

describe('pendingDeliveries', () => {
  it('picks open owner messages to agents only (FR:pick.entries)', async () => {
    const { ctx } = await mk();
    const a = await sendToInbox(ctx, ref(6), 'Ship it Friday', 'instruction');
    const b = await sendToInbox(ctx, ref(6), 'Also the cover', 'reply');
    await sendToInbox(ctx, ref(6), 'Approved', 'decision');
    await sendToInbox(ctx, ref(7), 'I will sign', 'instruction'); // 🙋 row: to human
    await replyFromAgent(ctx, ref(6), 'Noted', 'cid');
    const w = await sendToInbox(ctx, ref(6), 'oops', 'instruction');
    await handleEntry(ctx, w.id, 'owner', undefined, { withdrawn: true });
    expect((await pendingDeliveries(ctx)).map((e) => e.id)).toEqual([a.id, b.id]);
    expect(await pendingDeliveries(ctx, { project: 'other' })).toEqual([]);
  });
});

describe('runDeliveryPass', () => {
  /** @req FR:agent-delivery/run.reply @req FR:agent-delivery/run.prompt @req FR:agent-delivery/safe.log @req FR:agent-delivery/safe.prefix */
  it('runs the agent, posts its reply as the agent, and handles the entry', async () => {
    const { ctx, d, prompts, store } = await mk();
    await replyFromAgent(ctx, ref(6), 'Mastering is done', 'cid');
    const e = await sendToInbox(ctx, ref(6), 'When does the single ship?', 'instruction');
    const r = await runDeliveryPass(d);
    expect(r.items).toEqual([{ id: e.id, state: 'delivered', agent: 'cid' }]);
    const p = prompts()[0];
    expect(p.stdin).toContain('Release the single');
    expect(p.stdin).toContain('Mastering is done');
    expect(p.stdin).toMatch(/Message to answer[^\n]*\n+When does the single ship\?/);
    expect(p.system!.startsWith(PREFIX)).toBe(true);
    expect(p.system).toContain('You run the label.');
    const all = await listInbox(ctx, { state: 'all' });
    expect(all.find((x) => x.id === e.id)).toMatchObject({ state: 'handled', note: 'Delivered' });
    expect(all.filter((x) => x.from === 'agent').map((x) => [x.agent, x.text])).toContainEqual(['cid', 'On it: the single ships Friday. [redacted]']);
    expect(store.read().items[e.id]).toMatchObject({ state: 'delivered', agent: 'cid' });
    const log = readFileSync(join(home, 'delivery.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(log).toEqual([expect.objectContaining({ entry: e.id, agent: 'cid', project: 'flantastic-4', state: 'delivered', usd: 0.03 })]);
    const raw = readFileSync(join(home, 'delivery.log'), 'utf8');
    expect(raw).not.toContain('single ship');
    expect(raw).not.toContain('Friday');
  });

  /** @req FR:agent-delivery/run.cli @req FR:agent-delivery/safe.never */
  it('runs claude -p in safe mode with the agent tools and no auto-allow beyond reads', async () => {
    const { ctx, d, prompts } = await mk();
    await sendToInbox(ctx, ref(6), 'Status?', 'instruction');
    await runDeliveryPass(d);
    const a = prompts()[0].args;
    for (const f of ['-p', '--safe-mode', '--strict-mcp-config', '--no-session-persistence']) expect(a).toContain(f);
    expect(a.slice(a.indexOf('--setting-sources'), a.indexOf('--setting-sources') + 2)).toEqual(['--setting-sources', '']); // no owner allow rules
    expect(a.slice(a.indexOf('--output-format'), a.indexOf('--output-format') + 2)).toEqual(['--output-format', 'json']);
    expect(a.slice(a.indexOf('--permission-mode'), a.indexOf('--permission-mode') + 2)).toEqual(['--permission-mode', 'default']);
    expect(a.slice(a.indexOf('--max-budget-usd'), a.indexOf('--max-budget-usd') + 2)).toEqual(['--max-budget-usd', '0.5']);
    expect(a.slice(a.indexOf('--tools'), a.indexOf('--tools') + 2)).toEqual(['--tools', 'Read,Grep']); // Bash is never in a delivery run
    expect(a.slice(a.indexOf('--allowedTools'), a.indexOf('--allowedTools') + 2)).toEqual(['--allowedTools', 'Read(./**)']); // reads inside the working folder only
    expect(a.join(' ')).not.toMatch(/dangerously|bypassPermissions|acceptEdits/);
    const never = a[a.indexOf('--disallowedTools') + 1];
    for (const t of ['Bash(gh pr merge:*)', 'Bash(gh pr edit:*)', 'Bash(gh label:*)', 'Bash(git push:*)', 'Bash(stack email:*)']) expect(never.split(',')).toContain(t);
    expect(NEVER_TOOLS).toContain('Bash(gh issue edit:*)');
  });

  it('builds args with the agent model and default tools when the file lists none', () => {
    const a = deliveryArgs({ model: 'claude-sonnet-5-5', maxUsd: 1, systemFile: '/x' });
    expect(a).toContain('claude-sonnet-5-5');
    expect(a[a.indexOf('--tools') + 1]).toBe('Read,Grep,Glob,Edit,Write,WebFetch,WebSearch');
    expect(a[a.indexOf('--allowedTools') + 1]).toBe('Read(./**)');
    expect(deliveryArgs({ tools: ['Edit'], maxUsd: 1, systemFile: '/x' })).not.toContain('--allowedTools');
    // @req FR:agent-delivery/safe.noshell
    const shell = deliveryArgs({ tools: ['Bash', 'BashOutput', 'KillShell', 'Read'], maxUsd: 1, systemFile: '/x' });
    expect(shell[shell.indexOf('--tools') + 1]).toBe('Read');
    // An approved ask adds exactly that rule.
    const ok = deliveryArgs({ maxUsd: 1, systemFile: '/x', approved: ['Edit(src/a.ts)'] });
    expect(ok[ok.indexOf('--allowedTools') + 1]).toBe('Read(./**),Edit(src/a.ts)');
  });

  /** @req FR:agent-delivery/run.cwd */
  it('runs in the project repo under the repos root, else the task repo', async () => {
    const { ctx, d, prompts } = await mk({}, { isRepo: (dir) => dir === '/dev/f4-music' });
    await sendToInbox(ctx, ref(6), 'Go', 'instruction');
    await runDeliveryPass(d);
    expect(prompts()[0].cwd).toBe('/dev/f4-music');
    const m = await mk();
    await sendToInbox(m.ctx, ref(6), 'Go', 'instruction');
    await runDeliveryPass(m.d);
    expect(m.prompts()[0].cwd).toBe('/dev/todo');
  });

  /** @req FR:agent-delivery/run.limits */
  it('marks a timeout or a cost-cap stop failed and never retries it (FR:pick.once)', async () => {
    const { ctx, d, prompts, store } = await mk({ replies: [new Error('claude timed out after 300s'), { stdout: JSON.stringify({ subtype: 'error_max_budget_usd', is_error: true, total_cost_usd: 0.5 }) }] });
    const a = await sendToInbox(ctx, ref(6), 'One', 'instruction');
    const b = await sendToInbox(ctx, ref(8), 'Two', 'instruction');
    const r = await runDeliveryPass(d);
    expect(r.items).toEqual([{ id: a.id, state: 'failed', agent: 'cid', reason: 'Timed out' }, { id: b.id, state: 'failed', agent: 'cid', reason: 'Cost cap reached' }]);
    expect(store.read().items[a.id].state).toBe('failed');
    await runDeliveryPass(d);
    expect(prompts()).toHaveLength(2);
    expect((await listInbox(ctx)).map((e) => e.id)).toEqual([a.id, b.id]); // still open: the owner sees Not delivered
  });

  it('fails an empty reply', async () => {
    const { ctx, d } = await mk({ replies: [{ stdout: JSON.stringify({ subtype: 'success', is_error: false, result: '  ' }) }] });
    await sendToInbox(ctx, ref(6), 'Hi', 'instruction');
    expect((await runDeliveryPass(d)).items[0]).toMatchObject({ state: 'failed', reason: 'Agent sent no reply' });
  });

  /** @req FR:agent-delivery/run.asks */
  it('turns denied tool calls into asks and never re-runs them', async () => {
    const denials = [{ tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'npm test' } }, { tool_name: 'Edit', tool_use_id: 't2', tool_input: { file_path: 'a.ts' } }];
    const { ctx, d, prompts } = await mk({ replies: [{ stdout: JSON.stringify({ subtype: 'success', is_error: false, result: 'I need to run tests.', permission_denials: denials }) }] });
    const e = await sendToInbox(ctx, ref(6), 'Fix it', 'instruction');
    await runDeliveryPass(d);
    const asks = (await listAsks(ctx, { state: 'open' })).items.filter((x) => x.key.startsWith('perm-dl-'));
    expect(asks).toHaveLength(2);
    expect(asks[0]).toMatchObject({ kind: 'approve', recommend: 'Deny', from: 'cid', ref: 'flantastic-4:6' });
    expect(asks[0].ask).toContain('Bash');
    expect(asks[0].why).toContain('npm test');
    expect(asks[0].key).toContain(e.id.slice(-4));
    expect(prompts()).toHaveLength(1);
  });

  /** @req FR:agent-delivery/pick.serial */
  it('delivers one message at a time per agent, oldest first, and skips an agent that is working', async () => {
    const { ctx, d, prompts, store } = await mk();
    const a = await sendToInbox(ctx, ref(6), 'First', 'instruction');
    const b = await sendToInbox(ctx, ref(6), 'Second', 'instruction');
    store.set('in-other', { state: 'working', at: new Date(NOW.getTime() + 50_000).toISOString(), agent: 'cid' });
    expect((await runDeliveryPass(d)).items).toEqual([]);
    store.set('in-other', { state: 'failed', at: NOW.toISOString(), agent: 'cid', reason: 'x' });
    const r = await runDeliveryPass(d);
    expect(r.items.map((x) => x.id)).toEqual([a.id, b.id]);
    expect(prompts().map((p) => p.stdin.trim().split('\n').pop())).toEqual(['First', 'Second']);
  });

  /** @req FR:agent-delivery/pick.agent */
  it('fails an entry no agent covers and does not retry it', async () => {
    const storage = new MemoryStorage();
    await storage.write('tasks/solo.md', '# Solo\n\n## Active\n\n- [ ] 🤖 Lonely task\n');
    const ctx = { storage, now: () => NOW };
    const f = fakeRunner();
    const d: DeliveryDeps = { ctx, settings: deliverySettings(getDefaults(), '/r'), store: new DeliveryStore(home, ctx.now), run: f.run, repoDir: '/r', isRepo: () => false };
    const e = await sendToInbox(ctx, { path: 'tasks/solo.md', line: 4 }, 'Hello', 'instruction');
    expect((await runDeliveryPass(d)).items).toEqual([{ id: e.id, state: 'failed', agent: '', reason: 'No agent for this task' }]);
    expect((await runDeliveryPass(d)).items).toEqual([]);
    expect(f.prompts()).toHaveLength(0);
  });
});

describe('races and changes during a run', () => {
  /** @req FR:agent-delivery/pick.serial */
  it('claims an agent under a lock: a fresh claim from another process, even on this entry, blocks', async () => {
    const { ctx, d, prompts, store } = await mk();
    const e = await sendToInbox(ctx, ref(6), 'Hi', 'instruction');
    const other = new DeliveryStore(home, () => NOW);
    expect(other.claim(e.id, 'cid', 60_000)).toBe(true);
    expect(store.claim('in-x', 'cid', 60_000)).toBe(false);
    expect((await runDeliveryPass(d)).items).toEqual([]);
    expect(prompts()).toHaveLength(0);
    expect(existsSync(join(home, 'delivery.lock'))).toBe(false);
  });

  /** @req FR:agent-delivery/pick.entries */
  it('skips a message withdrawn while queued or during its own run', async () => {
    const m = await mk();
    const a = await sendToInbox(m.ctx, ref(6), 'First', 'instruction');
    const b = await sendToInbox(m.ctx, ref(6), 'Second', 'instruction');
    const run: typeof m.run = async (cmd, args, stdin, o) => { if (args[0] === '-p') await handleEntry(m.ctx, b.id, 'owner', undefined, { withdrawn: true }); return m.run(cmd, args, stdin, o); };
    const r = await runDeliveryPass({ ...m.d, run });
    expect(r.items.map((x) => x.id)).toEqual([a.id]);
    expect(m.prompts()).toHaveLength(1);
    const c = await sendToInbox(m.ctx, ref(8), 'Third', 'instruction');
    const self: typeof m.run = async (cmd, args, stdin, o) => { if (args[0] === '-p') await handleEntry(m.ctx, c.id, 'owner', undefined, { withdrawn: true }); return m.run(cmd, args, stdin, o); };
    expect((await runDeliveryPass({ ...m.d, run: self })).items).toEqual([{ id: c.id, state: 'failed', agent: 'cid', reason: 'Withdrawn' }]);
    expect((await listInbox(m.ctx, { state: 'all' })).filter((x) => x.from === 'agent')).toHaveLength(1);
  });

  /** @req FR:agent-delivery/run.reply */
  it('posts on the row where the task is when the run ends', async () => {
    const m = await mk();
    const e = await sendToInbox(m.ctx, ref(6), 'Ship?', 'instruction');
    const run: typeof m.run = async (cmd, args, stdin, o) => {
      if (args[0] === '-p') { const f = await m.storage.read('tasks/flantastic-4.md'); await m.storage.write('tasks/flantastic-4.md', f.content.replace('## 🔄 Active\n\n', '## 🔄 Active\n\n- [ ] 🤖 New on top\n'), { expectedVersion: f.version }); }
      return m.run(cmd, args, stdin, o);
    };
    expect((await runDeliveryPass({ ...m.d, run })).items).toEqual([{ id: e.id, state: 'delivered', agent: 'cid' }]);
    const reply = (await listInbox(m.ctx, { state: 'all' })).find((x) => x.from === 'agent')!;
    expect(reply.ref).toBe('tasks/flantastic-4.md:8');
    expect(reply.task).toContain('Release the single');
  });

  /** @req FR:agent-delivery/pick.once */
  it('finishes a delivered entry left open without a second run', async () => {
    const { ctx, d, prompts, store } = await mk();
    const e = await sendToInbox(ctx, ref(6), 'Hi', 'instruction');
    store.set(e.id, { state: 'delivered', at: NOW.toISOString(), agent: 'cid' });
    await runDeliveryPass(d);
    expect(prompts()).toHaveLength(0);
    expect(await listInbox(ctx)).toEqual([]);
  });

  /** @req FR:agent-delivery/run.prompt */
  it('gives a queued follow-up the reply to the message before it', async () => {
    const { ctx, d, prompts } = await mk();
    await sendToInbox(ctx, ref(6), 'First', 'instruction');
    await sendToInbox(ctx, ref(6), 'Second', 'instruction');
    await runDeliveryPass(d);
    expect(prompts()[1].stdin).toContain('On it: the single ships Friday');
  });
});

describe('daily cap', () => {
  /** @req FR:agent-delivery/run.daily */
  it('stops at the daily cap, raises one ask, and resumes the next day', async () => {
    const m = await mk({ replies: [{ stdout: JSON.stringify({ subtype: 'success', is_error: false, result: 'A', total_cost_usd: 3 }) }, { stdout: JSON.stringify({ subtype: 'success', is_error: false, result: 'B', total_cost_usd: 3 }) }] });
    m.d.settings.dailyCapUsd = 5;
    const a = await sendToInbox(m.ctx, ref(6), 'One', 'instruction');
    const b = await sendToInbox(m.ctx, ref(8), 'Two', 'instruction');
    const c = await sendToInbox(m.ctx, ref(8), 'Three', 'instruction');
    m.store.addSpend(3); // earlier today
    let r = await runDeliveryPass(m.d);
    expect(r.items).toEqual([{ id: a.id, state: 'delivered', agent: 'cid' }, { id: b.id, state: 'not-delivered', agent: 'cid', reason: 'Daily cap reached' }, { id: c.id, state: 'not-delivered', agent: 'cid', reason: 'Daily cap reached' }]);
    expect(m.prompts()).toHaveLength(1);
    await runDeliveryPass(m.d);
    const ask = (await readAsk(m.ctx, 'delivery-cap'))!.ask;
    expect(ask).toMatchObject({ state: 'open', kind: 'go-do', priority: 'high' });
    expect(ask.ask).toContain('daily cap');
    expect((await listAsks(m.ctx, { state: 'all' })).items.filter((x) => x.key === 'delivery-cap')).toHaveLength(1);
    // Next day: spend resets, the cap ask closes, delivery resumes.
    const later = { ...m.d, ctx: { ...m.ctx, now: () => new Date(NOW.getTime() + 864e5) }, store: new DeliveryStore(home, () => new Date(NOW.getTime() + 864e5)) };
    r = await runDeliveryPass(later);
    expect(r.items.map((x) => x.state)).toEqual(['delivered', 'delivered']);
    expect((await readAsk(m.ctx, 'delivery-cap'))!.ask.state).toBe('done');
  });

  it('reads the cap from the config', () => {
    expect(deliverySettings(getDefaults(), '/a/todo').dailyCapUsd).toBe(5);
    expect(deliverySettings(parseConfig({ inbox: { deliveryDailyCapUsd: 12 } }), '/a/todo').dailyCapUsd).toBe(12);
    expect(() => parseConfig({ inbox: { deliveryDailyCapUsd: 0 } })).toThrow();
  });
});

describe('approved permission asks', () => {
  /** @req FR:agent-delivery/run.approved */
  it('re-runs the agent with the approved tool and posts the new reply; a denial just closes', async () => {
    const denials = [{ tool_name: 'Edit', tool_use_id: 't1', tool_input: { file_path: 'src/a.ts' } }, { tool_name: 'WebFetch', tool_use_id: 't2', tool_input: { url: 'https://x.test' } }];
    const m = await mk({ replies: [
      { stdout: JSON.stringify({ subtype: 'success', is_error: false, result: 'Needs you: allow the edit.', permission_denials: denials }) },
      { stdout: JSON.stringify({ subtype: 'success', is_error: false, result: 'Edited src/a.ts.' }) },
    ] });
    const e = await sendToInbox(m.ctx, ref(6), 'Fix it', 'instruction');
    await runDeliveryPass(m.d);
    const keys = (await listAsks(m.ctx, { state: 'open' })).items.map((x) => x.key).filter((k) => k.startsWith('perm-dl-')).sort();
    await answerAsk(m.ctx, keys[0], { answer: 'go' });
    await answerAsk(m.ctx, keys[1], { answer: 'no' });
    const r = await runDeliveryPass(m.d);
    expect(r.items).toEqual([{ id: e.id, state: 'delivered', agent: 'cid' }]);
    const p = m.prompts()[1];
    expect(p.args[p.args.indexOf('--allowedTools') + 1]).toBe('Read(./**),Edit(src/a.ts)');
    expect(p.stdin).toContain('The owner approved: Edit');
    expect(p.stdin).toContain('Fix it');
    const replies = (await listInbox(m.ctx, { state: 'all' })).filter((x) => x.from === 'agent').map((x) => x.text);
    expect(replies).toEqual(['Needs you: allow the edit.', 'Edited src/a.ts.']);
    for (const k of keys) expect((await readAsk(m.ctx, k))!.ask.state).toBe('done');
    await runDeliveryPass(m.d);
    expect(m.prompts()).toHaveLength(2); // never twice
  });
});

describe('login health', () => {
  /** @req FR:agent-delivery/login.check @req FR:agent-delivery/login.notice */
  it('marks messages not delivered and raises one sign-in ask while signed out; clears it once signed in', async () => {
    const m = await mk({ login: false });
    const e = await sendToInbox(m.ctx, ref(6), 'Anyone?', 'instruction');
    const r = await runDeliveryPass(m.d);
    expect(r.login).toBe('expired');
    expect(r.items).toEqual([{ id: e.id, state: 'not-delivered', agent: 'cid', reason: 'Claude login expired' }]);
    expect(m.prompts()).toHaveLength(0);
    await runDeliveryPass(m.d);
    const ask = (await readAsk(m.ctx, 'delivery-login'))!.ask;
    expect(ask).toMatchObject({ state: 'open', kind: 'go-do', ask: 'Claude login expired: Sign in', priority: 'high' });
    expect(ask.why).toContain('claude auth login');
    expect((await listAsks(m.ctx, { state: 'all' })).items.filter((a) => a.key === 'delivery-login')).toHaveLength(1);
    // Signed in again: the message goes out and the ask is closed.
    const ok = fakeRunner({ login: true });
    const r2 = await runDeliveryPass({ ...m.d, run: ok.run });
    expect(r2.items).toEqual([{ id: e.id, state: 'delivered', agent: 'cid' }]);
    expect((await readAsk(m.ctx, 'delivery-login'))!.ask.state).toBe('done');
    expect(m.store.read().login.state).toBe('ok');
  });

  it('reads a sign-in failure from the run itself', async () => {
    const { ctx, d, store } = await mk({ replies: [{ code: 1, stdout: JSON.stringify({ is_error: true, result: 'OAuth token has expired. Please run /login' }) }] });
    const e = await sendToInbox(ctx, ref(6), 'Hi', 'instruction');
    const r = await runDeliveryPass(d);
    expect(r.items).toEqual([{ id: e.id, state: 'not-delivered', agent: 'cid', reason: 'Claude login expired' }]);
    expect(store.read().login.state).toBe('expired');
  });

  it('does not read sign-in trouble from the agent own words', async () => {
    const { ctx, d, store } = await mk({ replies: [{ code: 1, stdout: JSON.stringify({ is_error: true, result: 'The OAuth authentication refactor broke the build' }) }] });
    const e = await sendToInbox(ctx, ref(6), 'Hi', 'instruction');
    expect((await runDeliveryPass(d)).items).toEqual([{ id: e.id, state: 'failed', agent: 'cid', reason: 'Agent run failed' }]);
    expect(store.read().login.state).toBe('ok');
  });

  it('treats an unreadable status as unknown and still runs', async () => {
    const { d } = await mk({ login: 'weird' });
    expect(await checkLogin(d)).toBe('unknown');
  });

  /** @req FR:agent-delivery/login.signin */
  it('starts the sign-in flow detached, or names the step', async () => {
    const seen: string[][] = [];
    expect(await startLogin(async (cmd, args) => { seen.push([cmd, ...args]); })).toEqual({ started: true });
    expect(seen).toEqual([['claude', 'auth', 'login']]);
    expect(await startLogin(() => { throw new Error('ENOENT'); })).toEqual({ started: false, step: 'claude auth login' });
    // A missing binary fails after spawn returns (the child error event): still the fallback step.
    expect(await startLogin(() => Promise.reject(new Error('spawn claude ENOENT')))).toEqual({ started: false, step: 'claude auth login' });
  });
});

describe('state and status', () => {
  /** @req FR:agent-delivery/state.file */
  it('keeps state atomic and drops entries older than 30 days', () => {
    let now = NOW;
    const s = new DeliveryStore(home, () => now);
    s.set('in-old', { state: 'delivered', at: NOW.toISOString(), agent: 'a' });
    now = new Date(NOW.getTime() + 31 * 864e5);
    s.set('in-new', { state: 'working', at: now.toISOString(), agent: 'a' });
    expect(Object.keys(s.read().items)).toEqual(['in-new']);
    expect(s.read().login.state).toBe('unknown');
  });

  /** @req FR:agent-delivery/state.api @req FR:agent-delivery/live.find */
  it('reports the row entries, the login, the mode and a live session', async () => {
    const { ctx, d, store } = await mk();
    const e = await sendToInbox(ctx, ref(6), 'Hi', 'instruction');
    await sendToInbox(ctx, ref(8), 'Other row', 'instruction');
    store.set(e.id, { state: 'working', at: NOW.toISOString(), agent: 'cid' });
    const item = (id: string, title: string, state: SessionItem['state'] = 'idle'): SessionItem => ({ id, title, project: 'other' as SessionItem['project'], state, reason: 'idle' as SessionItem['reason'], pinned: false, lastActivityAt: NOW.toISOString(), link: `claude://claude.ai/epitaxy/${id}`, prs: [] });
    const inv = { sessions: [item('s1', 'Unrelated'), item('s2', '🎧 Cid · flantastic-4:6'), item('s3', '🎧 Cid · old', 'done')] } as unknown as Inventory;
    const s = await deliveryStatus(d, 'flantastic-4:6', () => inv);
    expect(s).toEqual({ mode: 'off', login: 'unknown', items: { [e.id]: { state: 'working', agent: 'cid' } }, live: { id: 's2', title: '🎧 Cid · flantastic-4:6', link: 'claude://claude.ai/epitaxy/s2' } });
    expect(liveSessionFor(inv, { name: 'Nobody' }, 'x:1')).toBeUndefined();
    // The agent name must be the whole title head, not a prefix of another word or title.
    const named = { sessions: [item('s4', 'Stack v2 roadmap'), item('s5', 'Stacked PRs')] } as unknown as Inventory;
    expect(liveSessionFor(named, { name: 'Stack' }, 'x:1')).toBeUndefined();
    expect(liveSessionFor({ sessions: [item('s6', 'Stack · todo')] } as unknown as Inventory, { name: 'Stack' }, 'x:1')?.id).toBe('s6');
  });

  /** @req FR:agent-delivery/safe.optin */
  it('defaults delivery off and reads the config', () => {
    expect(deliverySettings(getDefaults(), '/a/todo')).toEqual({ mode: 'off', timeoutMs: 300_000, maxUsd: 0.5, dailyCapUsd: 5, reposRoot: '/a' });
    const c = parseConfig({ inbox: { delivery: 'claude', deliveryTimeoutSeconds: 60, deliveryMaxUsd: 2, reposRoot: '/src' } });
    expect(deliverySettings(c, '/a/todo')).toEqual({ mode: 'claude', timeoutMs: 60_000, maxUsd: 2, dailyCapUsd: 5, reposRoot: '/src' });
    for (const bad of [{ delivery: 'on' }, { deliveryTimeoutSeconds: 5 }, { deliveryMaxUsd: 50 }, { reposRoot: 'rel' }]) expect(() => parseConfig({ inbox: bad })).toThrow();
  });
});

describe('startDeliveryLoop', () => {
  /** @req FR:agent-delivery/host.loop @req NFR:agent-delivery/delivery.lazy */
  it('runs a pass at start and on kick, never overlapping, and stops on close', async () => {
    const { ctx, d, prompts } = await mk();
    await sendToInbox(ctx, ref(6), 'Hi', 'instruction');
    const loop = startDeliveryLoop(d, { intervalMs: 60_000 });
    loop.kick(); loop.kick();
    await loop.close();
    expect(prompts()).toHaveLength(1);
    await sendToInbox(ctx, ref(8), 'Later', 'instruction');
    loop.kick(); // closed: starts nothing
    await loop.close();
    expect(prompts()).toHaveLength(1);
  });
});
