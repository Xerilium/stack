/** @req FR:agent-sessions/driver.interface @req FR:agent-sessions/driver.sdk @req FR:agent-sessions/driver.active */
import { mkdirSync, mkdtempSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createSdkDriver, encodeCwd, projectOf, SessionBusy, sessionState, toolKind, type SdkLike, type Update } from '../../src/agents';

const NOW = new Date('2026-10-29T10:00:00Z');
const ms = (minAgo: number) => NOW.getTime() - minAgo * 60_000;

function fakeSdk(over: Partial<SdkLike> = {}): SdkLike & { calls: unknown[] } {
  const calls: unknown[] = [];
  return {
    calls,
    getSessionMessages: async () => [
      { type: 'user', uuid: 'u1', session_id: 's', parent_tool_use_id: null, parent_agent_id: null, message: { role: 'user', content: 'Fix the parser' } },
      { type: 'assistant', uuid: 'a1', session_id: 's', parent_tool_use_id: null, parent_agent_id: null, message: { role: 'assistant', content: [{ type: 'text', text: 'Looking.' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'git status --short' } }] } },
      { type: 'user', uuid: 'u2', session_id: 's', parent_tool_use_id: null, parent_agent_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'M src/x.ts' }] } },
      { type: 'assistant', uuid: 'a2', session_id: 's', parent_tool_use_id: null, parent_agent_id: null, message: { role: 'assistant', content: [{ type: 'text', text: 'Done. Token ghp_abcdefghijklmnopqrstuvwxyz0123456789ab leaked.' }] } },
    ],
    query: (args) => { calls.push(args); return (async function* () { yield* script(args); })() as never; },
    ...over,
  };
}

/** What the SDK would stream for a prompt: text deltas, a tool call that asks permission, its result, and the result message. */
async function* script(args: { prompt: string; options?: Record<string, unknown> }): AsyncGenerator<unknown> {
  const sid = (args.options?.resume as string) ?? 'new-0000-0000-0000-000000000009';
  yield { type: 'system', subtype: 'init', session_id: sid, cwd: '/Users/me/dev/stack', model: 'claude-sonnet-5-5' };
  yield { type: 'stream_event', session_id: sid, parent_tool_use_id: null, event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'On it' } } };
  yield { type: 'stream_event', session_id: sid, parent_tool_use_id: null, event: { type: 'content_block_delta', delta: { type: 'text_delta', text: '.' } } };
  yield { type: 'assistant', session_id: sid, parent_tool_use_id: null, message: { role: 'assistant', content: [{ type: 'text', text: 'On it.' }, { type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'git push' } }] } };
  const can = args.options?.canUseTool as ((n: string, i: Record<string, unknown>, o: Record<string, unknown>) => Promise<{ behavior: string; message?: string }>) | undefined;
  const decision = can ? await can('Bash', { command: 'git push' }, { toolUseID: 'tu1', requestId: 'req-1', signal: new AbortController().signal }) : { behavior: 'allow' };
  yield { type: 'user', session_id: sid, parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', content: decision.behavior === 'allow' ? 'pushed' : `denied: ${decision.message}`, is_error: decision.behavior !== 'allow' }] } };
  yield { type: 'result', subtype: 'success', session_id: sid, num_turns: 2, duration_ms: 1200, total_cost_usd: 0.1234, result: 'Pushed.', usage: {}, modelUsage: { 'claude-sonnet-5-5': { inputTokens: 100, outputTokens: 50, cacheReadInputTokens: 1000, cacheCreationInputTokens: 200, costUSD: 0.1234 } }, permission_denials: [] };
}

/** A session store with three transcripts: one written a minute ago (active), one ten hours ago, one two days ago. */
function store() {
  const home = mkdtempSync(join(tmpdir(), 'stack-home-'));
  const put = (dir: string, id: string, lines: unknown[], minAgo: number) => {
    const folder = join(home, 'projects', dir); mkdirSync(folder, { recursive: true });
    const p = join(folder, `${id}.jsonl`); writeFileSync(p, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
    utimesSync(p, new Date(ms(minAgo)), new Date(ms(minAgo)));
  };
  const user = (text: string, cwd: string, gitBranch?: string) => ({ type: 'user', cwd, gitBranch, message: { role: 'user', content: text }, timestamp: NOW.toISOString() });
  put('-Users-me-dev-stack', 'a1b2c3d4-0000-0000-0000-000000000001', [user('Ship the web app', '/Users/me/dev/stack', 'main'), { type: 'custom-title', customTitle: 'stack: web app' }, { type: 'pr-link', prUrl: 'https://github.com/o/r/pull/9' }, { type: 'cost-state', totalCostUSD: 1.5, modelUsage: { m: { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 1, cacheCreationInputTokens: 1, costUSD: 1.5 } } }], 1);
  put('-Users-me-dev-stack--claude-worktrees-zany-fox-1a2b3c', 'a1b2c3d4-0000-0000-0000-000000000002', [user('Fix the parser bug', '/Users/me/dev/stack/.claude/worktrees/zany-fox-1a2b3c', 'xe/fix')], 600);
  put('-Users-me-dev-todo', 'a1b2c3d4-0000-0000-0000-000000000003', [user('Plan my week and [link](http://x.test) ' + 'word '.repeat(30), '/Users/me/dev/todo')], 60 * 48);
  return home;
}

const collect = async (it: AsyncIterable<Update>) => { const out: Update[] = []; for await (const u of it) out.push(u); return out; };

describe('helpers', () => {
  it('projectOf names the repo, also from a worktree path', () => {
    expect(projectOf('/Users/me/dev/stack')).toBe('stack');
    expect(projectOf('/Users/me/dev/stack/.claude/worktrees/zany-fox-1a2b3c')).toBe('stack');
    expect(projectOf('/Users/me/dev/stack/.claude/worktrees/zany-fox-1a2b3c/web')).toBe('stack');
    expect(projectOf('/')).toBe('');
  });
  it('sessionState: running, needs-you, active, idle, stale', () => {
    expect(sessionState({ lastActive: ms(1), running: false, needsYou: false }, NOW)).toBe('active');
    expect(sessionState({ lastActive: ms(1), running: true, needsYou: false }, NOW)).toBe('running');
    expect(sessionState({ lastActive: ms(1), running: true, needsYou: true }, NOW)).toBe('needs-you');
    expect(sessionState({ lastActive: ms(3), running: false, needsYou: false }, NOW)).toBe('idle');
    expect(sessionState({ lastActive: ms(60 * 25), running: false, needsYou: false }, NOW)).toBe('stale');
  });
  it('toolKind maps Claude tools to ACP kinds', () => {
    expect(['Bash', 'Read', 'Grep', 'Edit', 'Write', 'WebFetch', 'Agent', 'mcp__x__y'].map(toolKind)).toEqual(['execute', 'read', 'search', 'edit', 'edit', 'fetch', 'other', 'other']);
  });
  it('encodeCwd matches the session store folder name', () => {
    expect(encodeCwd('/Users/me/proj')).toBe('-Users-me-proj');
    expect(encodeCwd('/Users/me/dev/stack/.claude/worktrees/a_b')).toBe('-Users-me-dev-stack--claude-worktrees-a-b');
  });
});

describe('createSdkDriver', () => {
  const home = store();
  it('lists sessions from the store: title, project, branch, lastActive, cost, pull requests', async () => {
    const d = createSdkDriver({ sdk: fakeSdk(), configDir: store(), now: () => NOW });
    const s = await d.listSessions({ limit: 10 });
    expect(s.map((x) => x.id.slice(-1))).toEqual(['1', '2', '3']);
    expect(s[0]).toMatchObject({ title: 'stack: web app', project: 'stack', cwd: '/Users/me/dev/stack', branch: 'main', lastActive: new Date(ms(1)).toISOString(), active: true, prs: ['https://github.com/o/r/pull/9'] });
    expect(s[1]).toMatchObject({ title: 'Fix the parser bug', project: 'stack', branch: 'xe/fix', active: false, prs: [] });
    expect(s[2].title).toBe(('Plan my week and (link)(http://x.test) ' + 'word '.repeat(30)).slice(0, 80));
    expect(s[2].branch).toBeUndefined();
  });
  it('getMessages collapses tool calls to one line, cuts and redacts text', async () => {
    const d = createSdkDriver({ sdk: fakeSdk(), configDir: home, now: () => NOW });
    const m = await d.getMessages('a1b2c3d4-0000-0000-0000-000000000002', { limit: 10 });
    expect((await d.getMessages('a1b2c3d4-0000-0000-0000-000000000002', { limit: 2 })).map((x) => x.text)).toEqual(['⚙ Bash: git status --short', 'Done. (redacted) leaked.']);
    expect(m.map((x) => [x.role, x.text])).toEqual([
      ['user', 'Fix the parser'], ['assistant', 'Looking.'], ['assistant', '⚙ Bash: git status --short'], ['assistant', 'Done. (redacted) leaked.'],
    ]);
  });
  it('prompt streams ACP-shaped updates and routes the permission request through onPermission', async () => {
    const sdk = fakeSdk();
    const d = createSdkDriver({ sdk, now: () => NOW });
    const asked: unknown[] = [];
    const run = await d.prompt({ sessionId: 'a1b2c3d4-0000-0000-0000-000000000002', text: 'Push it', onPermission: async (req) => { asked.push(req); return { optionId: req.options[2].optionId }; } });
    expect(run.sessionId).toBe('a1b2c3d4-0000-0000-0000-000000000002');
    const u = await collect(run.updates);
    expect(u.map((x) => x.type)).toEqual(['message_chunk', 'message_chunk', 'tool_call', 'permission', 'tool_update', 'done']);
    expect(u[0]).toEqual({ type: 'message_chunk', role: 'assistant', text: 'On it' });
    expect(u[2]).toMatchObject({ type: 'tool_call', callId: 'tu1', title: 'Bash: git push', kind: 'execute', status: 'pending' });
    expect(u[3]).toMatchObject({ type: 'permission', requestId: 'req-1', callId: 'tu1', title: 'Allow Bash: git push', options: [{ optionId: 'allow', kind: 'allow_once' }, { optionId: 'allow-session', kind: 'allow_always' }, { optionId: 'deny', kind: 'reject_once' }] });
    expect(u[4]).toMatchObject({ type: 'tool_update', callId: 'tu1', status: 'failed' });
    expect(u[5]).toEqual({ type: 'done', stopReason: 'end_turn', cost: { usd: 0.1234, tokens: 1350 }, turns: 2, durationMs: 1200 });
    expect(asked).toHaveLength(1);
    const opts = (sdk.calls[0] as { options: Record<string, unknown> }).options;
    expect(opts).toMatchObject({ resume: 'a1b2c3d4-0000-0000-0000-000000000002', includePartialMessages: true });
    expect(opts.abortController).toBeInstanceOf(AbortController);
  });
  it('a deny with the owner words reaches the agent; allow-session skips the next ask for that tool', async () => {
    const d = createSdkDriver({ sdk: fakeSdk(), configDir: home, now: () => NOW });
    const run = await d.prompt({ sessionId: 'a1b2c3d4-0000-0000-0000-000000000002', text: 'x', onPermission: async () => ({ optionId: 'deny', message: 'Not on main' }) });
    const u = await collect(run.updates);
    expect(u.find((x) => x.type === 'tool_update')).toMatchObject({ status: 'failed', output: 'denied: Not on main' });
  });
  it('a new session reports its id from the init message and uses cwd', async () => {
    const sdk = fakeSdk();
    const d = createSdkDriver({ sdk, now: () => NOW });
    const run = await d.prompt({ cwd: '/Users/me/dev/stack', text: 'Start', onPermission: async () => ({ optionId: 'allow' }) });
    expect(run.sessionId).toBeNull();
    await collect(run.updates);
    expect(run.sessionId).toBe('new-0000-0000-0000-000000000009');
    expect((sdk.calls[0] as { options: Record<string, unknown> }).options).toMatchObject({ cwd: '/Users/me/dev/stack' });
  });
  it('refuses a session that is active elsewhere or already running', async () => {
    const d = createSdkDriver({ sdk: fakeSdk(), configDir: home, now: () => NOW });
    await expect(d.prompt({ sessionId: 'a1b2c3d4-0000-0000-0000-000000000001', text: 'x', onPermission: async () => ({ optionId: 'allow' }) })).rejects.toThrow(SessionBusy);
    const first = await d.prompt({ sessionId: 'a1b2c3d4-0000-0000-0000-000000000002', text: 'x', onPermission: async () => ({ optionId: 'allow' }) });
    await expect(d.prompt({ sessionId: 'a1b2c3d4-0000-0000-0000-000000000002', text: 'y', onPermission: async () => ({ optionId: 'allow' }) })).rejects.toThrow(SessionBusy);
    await collect(first.updates);
    const again = await d.prompt({ sessionId: 'a1b2c3d4-0000-0000-0000-000000000002', text: 'z', onPermission: async () => ({ optionId: 'allow' }) });
    await collect(again.updates);
  });
  it('cancel aborts the run: done with stopReason cancelled', async () => {
    const sdk = fakeSdk({ query: (args) => { const ac = (args.options as { abortController: AbortController }).abortController; return (async function* () { yield { type: 'stream_event', session_id: 's', parent_tool_use_id: null, event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } } }; await new Promise<void>((ok) => ac.signal.addEventListener('abort', () => ok())); throw new Error('aborted'); })() as never; } });
    const d = createSdkDriver({ sdk, now: () => NOW });
    const run = await d.prompt({ sessionId: 'a1b2c3d4-0000-0000-0000-000000000002', text: 'x', onPermission: async () => ({ optionId: 'allow' }) });
    const seen: Update[] = [];
    const reading = (async () => { for await (const u of run.updates) { seen.push(u); if (u.type === 'message_chunk') await d.cancel(run.id); } })();
    await reading;
    expect(seen[seen.length - 1]).toMatchObject({ type: 'done', stopReason: 'cancelled' });
    expect(await d.cancel('nope')).toBe(false);
  });
  it('an SDK error ends the run with stopReason error and the message', async () => {
    const sdk = fakeSdk({ query: () => (async function* () { yield { type: 'result', subtype: 'error_max_budget_usd', session_id: 's', num_turns: 1, duration_ms: 5, total_cost_usd: 2, usage: {}, modelUsage: {}, permission_denials: [], errors: ['budget'] }; })() as never });
    const d = createSdkDriver({ sdk, now: () => NOW });
    const run = await d.prompt({ sessionId: 'a1b2c3d4-0000-0000-0000-000000000002', text: 'x', onPermission: async () => ({ optionId: 'allow' }) });
    const u = await collect(run.updates);
    expect(u[u.length - 1]).toMatchObject({ type: 'done', stopReason: 'max_budget', cost: { usd: 2 } });
    const sdk2 = fakeSdk({ query: () => (async function* () { yield { type: 'system', subtype: 'init', session_id: 's' }; throw new Error('boom'); })() as never });
    const run2 = await createSdkDriver({ sdk: sdk2, configDir: home, now: () => NOW }).prompt({ sessionId: 'a1b2c3d4-0000-0000-0000-000000000002', text: 'x', onPermission: async () => ({ optionId: 'allow' }) });
    const u2 = await collect(run2.updates);
    expect(u2[u2.length - 1]).toMatchObject({ type: 'done', stopReason: 'error', error: 'boom' });
  });
});
