import { mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, unlinkSync, utimesSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { classify, projectOf, readTail, runInventory, type SessionFacts } from '../../src/core/session-inventory';

const NOW = new Date('2026-11-11T18:00:00Z');
const T = NOW.getTime();
const MIN = 60_000;

const base = (o: Partial<SessionFacts> = {}): SessionFacts => ({
  id: 'local_a', title: 'T', cwd: '/Users/u/dev/todo', archived: false, pinned: false, lastActivityAt: T - 60 * MIN,
  lastTurnEdgeAt: T - 60 * MIN, permissionMode: 'default', prs: [], tail: 'turn-end', ...o,
});

describe('classify', () => {
  // @req FR:session-inventory/state.waiting
  it('waiting: question, awaiting person, needs-user, blocked summary, permission prompt', () => {
    expect(classify(base({ tail: 'question' }), T)).toEqual({ state: 'waiting', reason: 'question' });
    expect(classify(base({ awaitingPerson: true }), T).reason).toBe('needs-user');
    expect(classify(base({ wrapUpNeedsUser: true }), T).reason).toBe('needs-user');
    expect(classify(base({ summary: { category: 'blocked', ask: 'Approve' } }), T)).toEqual({ state: 'waiting', reason: 'blocked' });
    expect(classify(base({ tail: 'tool', lastActivityAt: T - 6 * MIN }), T)).toEqual({ state: 'waiting', reason: 'permission' });
    // bypass never prompts: a pending tool is still running
    expect(classify(base({ tail: 'tool', lastActivityAt: T - 6 * MIN, permissionMode: 'bypassPermissions' }), T).state).toBe('running');
    // a blocked summary on an open turn is stale
    expect(classify(base({ tail: 'tool', lastActivityAt: T - MIN, summary: { category: 'blocked' } }), T).state).toBe('running');
  });

  // @req FR:session-inventory/state.stuck
  it('stuck: error, cut short, api error, dead turn, scheduled run at a prompt', () => {
    expect(classify(base({ errorAt: T - 10 * MIN }), T)).toEqual({ state: 'stuck', reason: 'error' });
    expect(classify(base({ errorAt: T - 90 * MIN, lastTurnEdgeAt: T - 60 * MIN }), T).state).toBe('idle');
    expect(classify(base({ cutShort: true }), T).reason).toBe('cut-short');
    expect(classify(base({ tail: 'api-error' }), T).reason).toBe('api-error');
    expect(classify(base({ tail: 'user', lastActivityAt: T - 31 * MIN }), T)).toEqual({ state: 'stuck', reason: 'dead-turn' });
    expect(classify(base({ tail: 'tool', lastActivityAt: T - 6 * MIN, scheduledTaskId: 's1' }), T)).toEqual({ state: 'stuck', reason: 'dead-turn' });
  });

  // @req FR:session-inventory/state.running @req FR:session-inventory/state.activity
  it('running: open turn with recent activity; transcript mtime counts as activity', () => {
    expect(classify(base({ tail: 'tool-result', lastActivityAt: T - 10 * MIN }), T)).toEqual({ state: 'running', reason: 'turn-open' });
    expect(classify(base({ tail: 'user', lastActivityAt: T - 40 * MIN, txMtimeMs: T - MIN }), T).state).toBe('running');
    // no transcript: open when activity is after the turn edge
    expect(classify(base({ tail: undefined, lastActivityAt: T - MIN, lastTurnEdgeAt: T - 5 * MIN }), T).state).toBe('running');
    expect(classify(base({ tail: undefined, lastActivityAt: T - MIN, lastTurnEdgeAt: T - MIN }), T).state).toBe('idle');
  });

  // @req FR:session-inventory/state.done @req FR:session-inventory/state.pinned @req FR:session-inventory/state.idle
  it('done, pinned, idle', () => {
    const merged = { url: 'https://github.com/o/r/pull/1', state: 'MERGED' };
    expect(classify(base({ prs: [merged, { url: 'https://github.com/o/r/pull/2', state: 'CLOSED' }] }), T)).toEqual({ state: 'done', reason: 'pr-merged' });
    expect(classify(base({ prs: [merged, { url: 'https://github.com/o/r/pull/3', state: 'OPEN' }] }), T).state).toBe('idle');
    expect(classify(base({ prs: [merged, { url: 'https://github.com/o/r/pull/3', state: 'OPEN', dismissed: true }] }), T).state).toBe('done');
    expect(classify(base({ prs: [{ url: 'https://github.com/o/r/pull/2', state: 'CLOSED' }] }), T).state).toBe('idle');
    expect(classify(base({ prs: [merged], pinned: true }), T)).toEqual({ state: 'pinned', reason: 'idle' });
    expect(classify(base(), T)).toEqual({ state: 'idle', reason: 'idle' });
  });
});

// @req FR:session-inventory/needs.project
it('projectOf maps the first folder under dev/', () => {
  const cases: [string, string][] = [
    ['/Users/u/dev/finops-hubs/.claude/worktrees/x', 'allyte'], ['/Users/u/dev/finops-hubs.worktrees/a', 'allyte'], ['/Users/u/dev/allyte-web', 'allyte'],
    ['/Users/u/dev/finops-toolkit', 'ftk'], ['/Users/u/dev/FOCUS_Spec.worktrees/b', 'focus'], ['/Users/u/dev/f4-music', 'f4'],
    ['/Users/u/dev/todo/.claude/worktrees/z', 'xerilium'], ['/Users/u/dev/printer-fund-wt/x', 'xerilium'], ['/Users/u/dev/catalyst', 'xerilium'],
    ['/Users/u/dev/fluentui', 'other'], ['/tmp/x', 'other'],
  ];
  for (const [cwd, p] of cases) expect([cwd, projectOf(cwd)]).toEqual([cwd, p]);
});

describe('readTail', () => {
  const dir = mkdtempSync(join(tmpdir(), 'stack-tail-'));
  const write = (name: string, lines: unknown[]) => { const f = join(dir, name); writeFileSync(f, lines.map((l) => JSON.stringify(l)).join('\n') + '\n'); return f; };
  const asst = (content: unknown[]) => ({ type: 'assistant', message: { content } });
  // @req FR:session-inventory/read.tail
  it('keeps only the kind of the last main-chain event', () => {
    expect(readTail(write('a.jsonl', [{ type: 'user', message: { content: 'hi' } }, { type: 'system', subtype: 'stop_hook_summary' }, { type: 'custom-title' }]))).toBe('turn-end');
    expect(readTail(write('b.jsonl', [asst([{ type: 'tool_use', name: 'AskUserQuestion', input: { secret: 's' } }])]))).toBe('question');
    expect(readTail(write('c.jsonl', [asst([{ type: 'tool_use', name: 'Bash' }]), { type: 'assistant', isSidechain: true, message: { content: [{ type: 'text' }] } }]))).toBe('tool');
    expect(readTail(write('d.jsonl', [{ type: 'user', message: { content: [{ type: 'tool_result' }] } }]))).toBe('tool-result');
    expect(readTail(write('e.jsonl', [{ type: 'user', message: { content: 'go' } }, { type: 'system', subtype: 'compact_boundary' }]))).toBe('user');
    expect(readTail(write('f.jsonl', [asst([{ type: 'text', text: 'done' }])]))).toBe('assistant-text');
    expect(readTail(write('g.jsonl', [{ type: 'system', subtype: 'api_error' }]))).toBe('api-error');
    expect(readTail(write('h.jsonl', [{ type: 'attachment' }]))).toBe('none');
    expect(readTail(join(dir, 'missing.jsonl'))).toBeUndefined();
  });
  it('reads past a last line over 64 KiB; an owner interrupt closes the turn', () => {
    const f = join(dir, 'big.jsonl');
    writeFileSync(f, JSON.stringify(asst([{ type: 'tool_use', name: 'Bash' }])) + '\n' + `${JSON.stringify({ type: 'progress', pad: 'x'.repeat(70_000) })}\n`);
    expect(readTail(f)).toBe('tool');
    const g = join(dir, 'huge.jsonl');
    writeFileSync(g, `${JSON.stringify(asst([{ type: 'tool_use', name: 'Write', input: { c: 'x'.repeat(300_000) } }]))}\n`);
    expect(readTail(g)).toBe('tool');
    expect(readTail(write('i.jsonl', [asst([{ type: 'tool_use', name: 'Bash' }]), { type: 'user', message: { content: [{ type: 'text', text: '[Request interrupted by user]' }] } }]))).toBe('turn-end');
    expect(readTail(write('j.jsonl', [{ type: 'user', message: { content: '[Request interrupted by user for tool use]' } }]))).toBe('turn-end');
  });
});

describe('runInventory', () => {
  const setup = () => {
    const root = mkdtempSync(join(tmpdir(), 'stack-inv-'));
    const sessions = join(root, 'sessions'); const projects = join(root, 'projects'); const home = join(root, 'home');
    const acct = join(sessions, 'acct', 'org'); mkdirSync(acct, { recursive: true });
    const put = (id: string, j: Record<string, unknown>, tail?: unknown[]) => {
      const cwd = (j.cwd as string) ?? '/Users/u/dev/todo';
      writeFileSync(join(acct, `${id}.json`), JSON.stringify({ sessionId: id, cliSessionId: `cli-${id}`, cwd, title: id, isArchived: false, lastActivityAt: T - 60 * MIN, lastTurnEdgeAt: T - 60 * MIN, permissionMode: 'default', ...j }));
      if (tail) { const d = join(projects, cwd.replace(/[^A-Za-z0-9]/g, '-')); mkdirSync(d, { recursive: true }); writeFileSync(join(d, `cli-${id}.jsonl`), tail.map((l) => JSON.stringify(l)).join('\n') + '\n'); }
    };
    return { root, sessions, projects, home, acct, put, run: () => runInventory({ sessionsDir: sessions, projectsDir: projects, home, now: () => NOW }) };
  };

  // @req FR:session-inventory/read.files @req FR:session-inventory/read.bad @req FR:session-inventory/state.archived
  // @req FR:session-inventory/needs.list @req FR:session-inventory/needs.rank @req FR:session-inventory/needs.item @req FR:session-inventory/needs.reason
  // @req FR:session-inventory/archive.list @req FR:session-inventory/archive.superseded @req FR:session-inventory/store.result @req FR:session-inventory/$session
  it('classifies, ranks Needs you, lists archive candidates, never writes the session store', () => {
    const e = setup();
    e.put('local_x1', { cwd: '/Users/u/dev/todo', lastActivityAt: T - 2 * MIN }, [{ type: 'assistant', message: { content: [{ type: 'tool_use', name: 'AskUserQuestion' }] } }]);
    e.put('local_a1', { cwd: '/Users/u/dev/finops-hubs', errorAt: T - MIN, error: 'You hit a limit' });
    e.put('local_a2', { cwd: '/Users/u/dev/finops-hubs', lastActivityAt: T - 5 * MIN, lastTurnEdgeAt: T - 5 * MIN, postTurnSummary: { status_category: 'blocked', needs_action: 'Approve the\nplan', summarizes_uuid: 'u1' }, lastAssistantUuid: 'u1' });
    e.put('local_f1', { cwd: '/Users/u/dev/finops-toolkit', prs: [{ url: 'https://github.com/o/r/pull/9', state: 'MERGED' }] });
    e.put('local_old', { scheduledTaskId: 'daily', createdAt: T - 2000 * MIN, interruptedAwaitingPerson: true });
    e.put('local_new', { scheduledTaskId: 'daily', createdAt: T - 100 * MIN, interruptedAwaitingPerson: true });
    e.put('local_arch', { isArchived: true, interruptedAwaitingPerson: true });
    // an archived newer run still supersedes an older one
    e.put('local_w1', { scheduledTaskId: 'weekly', createdAt: T - 3000 * MIN, interruptedAwaitingPerson: true });
    e.put('local_w2', { scheduledTaskId: 'weekly', createdAt: T - 10 * MIN, isArchived: true });
    e.put('local_pin', { isStarred: true });
    writeFileSync(join(e.acct, 'local_bad.json'), '{nope');
    writeFileSync(join(e.acct, 'local_noid.json'), '{}');
    writeFileSync(join(e.acct, 'scheduled-tasks.json'), JSON.stringify({ scheduledTasks: [{ id: 'daily', displayName: 'Daily check-in' }] }));
    const before = readdirSync(e.acct).map((f) => [f, statSync(join(e.acct, f)).mtimeMs]);
    const r = e.run();
    expect(readdirSync(e.acct).map((f) => [f, statSync(join(e.acct, f)).mtimeMs])).toEqual(before);
    expect(r.total).toBe(8);
    expect(r.counts).toEqual({ running: 0, waiting: 5, stuck: 1, done: 1, pinned: 1, idle: 0 });
    expect(r.needsYou.map((s) => s.id)).toEqual(['local_a2', 'local_a1', 'local_x1', 'local_new']);
    const a2 = r.needsYou[0];
    expect(a2).toMatchObject({ project: 'allyte', state: 'waiting', reason: 'blocked', ask: 'Approve the plan', link: 'claude://claude.ai/epitaxy/local_a2', pinned: false, prs: [] });
    expect(a2.lastActivityAt).toBe(new Date(T - 5 * MIN).toISOString());
    expect(r.needsYou[3].scheduled).toEqual({ id: 'daily', name: 'Daily check-in' });
    expect(r.archive.map((s) => [s.id, s.reason])).toEqual([['local_f1', 'pr-merged'], ['local_old', 'superseded'], ['local_w1', 'superseded']]);
    expect(r.sessions[0].id).toBe('local_x1');
    expect(JSON.stringify(r)).not.toContain('AskUserQuestion');
  });

  // @req FR:session-inventory/read.cache @req FR:session-inventory/store.write
  it('caches facts by mtime in ~/.stack/sessions.json and rereads only changed files', () => {
    const e = setup();
    e.put('local_s1', { interruptedAwaitingPerson: true });
    e.put('local_s2', {});
    const f1 = join(e.acct, 'local_s1.json');
    const m = new Date('2026-11-11T17:00:00Z');
    utimesSync(f1, m, m);
    expect(e.run().counts.waiting).toBe(1);
    const file = join(e.home, 'sessions.json');
    expect(statSync(file).mode & 0o777).toBe(0o600);
    const stored = JSON.parse(readFileSync(file, 'utf8'));
    expect(stored).toMatchObject({ version: 1, inventory: { total: 2 } });
    // a change the cache cannot see (same size, same mtime) is not read again
    writeFileSync(f1, readFileSync(f1, 'utf8').replace('"interruptedAwaitingPerson":true', '"interruptedAwaitingPerson":null'));
    utimesSync(f1, m, m);
    expect(e.run().counts.waiting).toBe(1);
    // a new mtime is read again
    const later = new Date(m.getTime() + 5000); utimesSync(f1, later, later);
    expect(e.run().counts.waiting).toBe(0);
    // a cache for another transcripts folder is not used
    const other = runInventory({ sessionsDir: e.sessions, projectsDir: join(e.root, 'other'), home: e.home, now: () => NOW });
    expect(other.counts.waiting).toBe(0);
    expect(JSON.parse(readFileSync(file, 'utf8')).projectsDir).toBe(join(e.root, 'other'));
    // gone files leave the cache
    unlinkSync(join(e.acct, 'local_s2.json'));
    e.run();
    expect(Object.keys(JSON.parse(readFileSync(file, 'utf8')).cache)).toHaveLength(1);
  });

  it('a home that cannot be written never fails the inventory', () => {
    const e = setup();
    writeFileSync(e.home, 'a file, not a folder');
    e.put('local_s1', {});
    expect(e.run().total).toBe(1);
  });

  it('a missing session store is an empty inventory', () => {
    const r = runInventory({ sessionsDir: '/nope/none', projectsDir: '/nope', home: mkdtempSync(join(tmpdir(), 'stack-inv-')), now: () => NOW });
    expect(r).toMatchObject({ total: 0, needsYou: [], archive: [] });
  });

  // @req FR:session-inventory/read.fast
  it('1,000 sessions with a warm cache in under 1 s', () => {
    const e = setup();
    for (let i = 0; i < 1000; i++) e.put(`local_${i}`, { cwd: `/Users/u/dev/p${i % 7}`, prs: [{ url: `https://github.com/o/r/pull/${i}`, state: 'OPEN' }] });
    e.run();
    const t0 = Date.now();
    expect(e.run().total).toBe(1000);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});
