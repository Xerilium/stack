/**
 * Ask routing core: address, turn, owner questions, agent replies (`.xe/features/ask-routing/spec.md`).
 */
import { execFileSync } from 'child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { answerAsk, askTurn, handleAsk, listAsks, putAsk, readAsk, replyAsk, AskDenied, markDelivery } from '../../src/core/asks';
import { ConflictError, MemoryStorage } from '../../src/core/storage';
import { GitStorage } from '../../src/core/storage-git';
import { run } from '../../src/cli/run';

const NOW = new Date('2026-11-19T14:00:00Z');
const LINK = '[Stack architect](#local_abc-123)';

function mk() {
  const storage = new MemoryStorage();
  let tick = 0;
  const ctx = { storage, now: () => new Date(NOW.getTime() + 1000 * tick++) };
  return { storage, ctx };
}
const base = { ask: 'Approve merging PR 879 into dev', kind: 'approve' as const, from: 'allyte-cos', why: 'CI is green' };

// @req FR:ask-routing/addr.link
describe('agent link', () => {
  it('is stored as > agent: metadata and read back', async () => {
    const { ctx, storage } = mk();
    await putAsk(ctx, 'a1', { ...base, agent: LINK }, 'allyte-cos');
    expect((await storage.read('tasks/asks.md')).content).toContain(`  > agent: ${LINK}`);
    expect((await readAsk(ctx, 'a1'))!.ask.agent).toBe(LINK);
  });
  it('refuses a value that is not a session link', async () => {
    const { ctx } = mk();
    await expect(putAsk(ctx, 'a1', { ...base, agent: 'Stack architect' }, 'x')).rejects.toThrow(/agent must be a link/);
  });
});

// @req FR:ask-routing/addr.context
describe('context rule', () => {
  it('a new agent ask needs why', async () => {
    const { ctx } = mk();
    await expect(putAsk(ctx, 'a1', { ask: 'Approve X', kind: 'approve', from: 'cos' }, 'cos', { agent: true })).rejects.toThrow(/why is required/);
    await putAsk(ctx, 'a1', { ask: 'Approve X', kind: 'approve', from: 'cos', why: 'Because' }, 'cos', { agent: true });
    // an update need not repeat it
    await expect(putAsk(ctx, 'a1', { ask: 'Approve Y' }, 'cos', { agent: true })).resolves.toMatchObject({ created: false });
  });
});

// @req FR:ask-routing/turn.derive @req FR:ask-routing/turn.list
describe('turn', () => {
  it('derives whose move it is', () => {
    expect(askTurn({ from: 'cos', state: 'open' })).toBe('owner');
    expect(askTurn({ from: 'cos', state: 'answered' })).toBe('agent');
    expect(askTurn({ from: 'cos', state: 'done' })).toBe('none');
    expect(askTurn({ from: 'owner', state: 'open' })).toBe('agent');
    expect(askTurn({ from: 'owner', state: 'answered' })).toBe('owner');
    expect(askTurn({ from: 'owner', state: 'done' })).toBe('none');
  });
  it('listAsks filters by turn and lists turn on each item', async () => {
    const { ctx } = mk();
    await putAsk(ctx, 'a1', base, 'allyte-cos');
    await putAsk(ctx, 'q1', { ask: 'What blocks PR 316?', from: 'owner', agent: LINK }, 'owner');
    const all = await listAsks(ctx, { state: 'all' });
    expect(Object.fromEntries(all.items.map((i) => [i.key, i.turn]))).toEqual({ a1: 'owner', q1: 'agent' });
    expect((await listAsks(ctx, { state: 'all', turn: 'owner' })).items.map((i) => i.key)).toEqual(['a1']);
    expect((await listAsks(ctx, { state: 'all', turn: 'agent' })).items.map((i) => i.key)).toEqual(['q1']);
  });
});

// @req FR:ask-routing/ask.put @req FR:ask-routing/ask.follow
describe('owner questions', () => {
  it('needs an agent link and defaults kind to answer', async () => {
    const { ctx } = mk();
    await expect(putAsk(ctx, 'q1', { ask: 'Status?', from: 'owner' }, 'owner')).rejects.toThrow(/agent is required/);
    await putAsk(ctx, 'q1', { ask: 'Status?', from: 'owner', agent: LINK }, 'owner');
    expect((await readAsk(ctx, 'q1'))!.ask).toMatchObject({ kind: 'answer', from: 'owner', state: 'open' });
  });
  it('only the owner writes from owner', async () => {
    const { ctx } = mk();
    await expect(putAsk(ctx, 'q1', { ask: 'Status?', from: 'owner', agent: LINK }, 'cos', { writer: 'token:cos' })).rejects.toThrow(AskDenied);
    await expect(putAsk(ctx, 'q1', { ask: 'Status?', from: 'owner', agent: LINK, why: 'w' }, 'cos', { agent: true })).rejects.toThrow(AskDenied);
  });
  // @req FR:ask-routing/ask.close
  it('only the owner closes his question; a token replies only on its own asks', async () => {
    const { ctx } = mk();
    await putAsk(ctx, 'q1', { ask: 'Status?', from: 'owner', agent: LINK }, 'owner');
    await expect(handleAsk(ctx, 'q1', { outcome: 'handled' }, 'cos')).rejects.toThrow(AskDenied);
    await expect(replyAsk(ctx, 'q1', { text: 'x' }, 'cos', { writer: 'token:cos' })).rejects.toThrow(AskDenied);
    await putAsk(ctx, 'a1', base, 'allyte-cos', { writer: 'token:allyte-cos' });
    await expect(replyAsk(ctx, 'a1', { text: 'x' }, 'allyte-cos', { writer: 'token:allyte-cos' })).resolves.toEqual({ changed: true });
    await expect(replyAsk(ctx, 'a1', { text: 'x' }, 'cos', { writer: 'token:other' })).rejects.toThrow(AskDenied);
  });
  // @req FR:ask-routing/addr.api
  it('a token cannot set an agent link', async () => {
    const { ctx } = mk();
    await expect(putAsk(ctx, 'a1', { ...base, agent: LINK }, 'cos', { writer: 'token:cos', agent: true })).rejects.toThrow(AskDenied);
  });
  // @req FR:ask-routing/deliver.reset
  it('reopening or relinking an owner question clears the old delivery', async () => {
    const { ctx } = mk();
    await putAsk(ctx, 'q1', { ask: 'Status?', from: 'owner', agent: LINK }, 'owner');
    expect(await markDelivery(ctx, 'q1', { claim: true })).toBe(true);
    await markDelivery(ctx, 'q1', { failed: 'Session gone' });
    await putAsk(ctx, 'q1', { agent: '[Stack architect](#local_new)' }, 'owner');
    expect((await readAsk(ctx, 'q1'))!.ask.undelivered).toBeUndefined();
    expect(await markDelivery(ctx, 'q1', { claim: true })).toBe(true);
    await answerAsk(ctx, 'q1', { answer: 'done' });
    await putAsk(ctx, 'q1', { reopen: true }, 'owner');
    expect((await readAsk(ctx, 'q1'))!.ask.delivered).toBeUndefined();
  });
  it('a follow-up gives the turn back to the agent; done closes it', async () => {
    const { ctx } = mk();
    await putAsk(ctx, 'q1', { ask: 'Status?', from: 'owner', agent: LINK }, 'owner');
    await replyAsk(ctx, 'q1', { text: 'Blocked on CI' }, 'Stack architect');
    let a = (await readAsk(ctx, 'q1'))!.ask;
    expect(a).toMatchObject({ state: 'answered', answer: 'reply', text: 'Blocked on CI' });
    await answerAsk(ctx, 'q1', { answer: 'ask', text: 'Which check?' });
    a = (await readAsk(ctx, 'q1'))!.ask;
    expect(a.state).toBe('open');
    expect(a.answer).toBeUndefined();
    expect(a.thread.at(-1)).toMatch(/ you: Which check\?$/);
    await replyAsk(ctx, 'q1', { text: 'lint' }, 'Stack architect');
    await answerAsk(ctx, 'q1', { answer: 'done' });
    expect((await readAsk(ctx, 'q1'))!.ask.state).toBe('done');
  });
});

// @req FR:ask-routing/reply.cmd
describe('agent reply', () => {
  it('answers an owner question in the thread', async () => {
    const { ctx } = mk();
    await putAsk(ctx, 'q1', { ask: 'Status?', from: 'owner', agent: LINK }, 'owner');
    await replyAsk(ctx, 'q1', { text: 'Green' }, 'Stack architect');
    const a = (await readAsk(ctx, 'q1'))!.ask;
    expect(a.thread.at(-1)).toMatch(/^- \S+ Stack architect: Green$/);
  });
  it('reopens an answered agent ask, adds context to an open one, refuses a done one', async () => {
    const { ctx } = mk();
    await putAsk(ctx, 'a1', base, 'allyte-cos');
    await replyAsk(ctx, 'a1', { text: 'Roland approved too' }, 'allyte-cos');
    expect((await readAsk(ctx, 'a1'))!.ask).toMatchObject({ state: 'open' });
    await answerAsk(ctx, 'a1', { answer: 'ask', text: 'All checks?' });
    await replyAsk(ctx, 'a1', { text: 'Yes, 14 of 14' }, 'allyte-cos');
    const a = (await readAsk(ctx, 'a1'))!.ask;
    expect(a.state).toBe('open');
    expect(a.thread.map((l) => l.replace(/^- \S+ /, ''))).toEqual(['allyte-cos: Roland approved too', 'you: All checks?', 'allyte-cos: Yes, 14 of 14']);
    await answerAsk(ctx, 'a1', { answer: 'done' });
    await (await import('../../src/core/asks')).handleAsk(ctx, 'a1', { outcome: 'handled' }, 'allyte-cos');
    await expect(replyAsk(ctx, 'a1', { text: 'x' }, 'allyte-cos')).rejects.toThrow(ConflictError);
  });
  it('refuses empty or long text', async () => {
    const { ctx } = mk();
    await putAsk(ctx, 'a1', base, 'allyte-cos');
    await expect(replyAsk(ctx, 'a1', { text: ' ' }, 'x')).rejects.toThrow(/text/);
    await expect(replyAsk(ctx, 'a1', { text: 'word '.repeat(250) }, 'x')).rejects.toThrow(/text/);
  });
});

// @req FR:ask-routing/deliver.reset @req FR:ask-routing/deliver.once
describe('delivery marks', () => {
  it('a claim wins once per turn; a new agent turn clears it', async () => {
    const { ctx } = mk();
    await putAsk(ctx, 'a1', { ...base, agent: LINK }, 'allyte-cos');
    expect(await markDelivery(ctx, 'a1', { claim: true })).toBe(false); // owner's turn: nothing to deliver
    await answerAsk(ctx, 'a1', { answer: 'go' });
    expect(await markDelivery(ctx, 'a1', { claim: true })).toBe(true);
    expect(await markDelivery(ctx, 'a1', { claim: true })).toBe(false);
    expect((await readAsk(ctx, 'a1'))!.ask.delivered).toBeDefined();
    await replyAsk(ctx, 'a1', { text: 'Which branch?' }, 'allyte-cos');
    await answerAsk(ctx, 'a1', { answer: 'reply', text: 'dev' });
    expect((await readAsk(ctx, 'a1'))!.ask.delivered).toBeUndefined();
    expect(await markDelivery(ctx, 'a1', { claim: true })).toBe(true);
  });
  it('two writers at once: one claim wins, the answer and a reply both land', async () => {
    // two git storages on one repo, as two processes (host and CLI): only the repo write lock and file versions keep the writes apart
    const dir = mkdtempSync(join(tmpdir(), 'stack-race-'));
    const env = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
    const git = (...a: string[]) => execFileSync('git', a, { cwd: dir, env });
    git('init', '-q', '-b', 'main'); git('config', 'user.name', 't'); git('config', 'user.email', 't@t');
    writeFileSync(join(dir, 'README.md'), 'r\n'); git('add', '.'); git('commit', '-q', '-m', 'init');
    const c1 = { storage: new GitStorage(dir), now: () => NOW };
    const c2 = { storage: new GitStorage(dir), now: () => NOW };
    await putAsk(c1, 'a1', { ...base, agent: LINK }, 'allyte-cos');
    await putAsk(c1, 'a2', { ...base, agent: LINK }, 'allyte-cos');
    await answerAsk(c1, 'a1', { answer: 'go' });
    const [x, y, z] = await Promise.all([markDelivery(c1, 'a1', { claim: true }), markDelivery(c2, 'a1', { claim: true }), answerAsk(c2, 'a2', { answer: 'no' })]);
    expect([x, y].filter(Boolean)).toHaveLength(1);
    expect(z.changed).toBe(true);
    expect((await readAsk(c1, 'a2'))!.ask.answer).toBe('no');
  });
});

// @req FR:ask-routing/addr.env @req FR:ask-routing/reply.surfaces
describe('CLI', () => {
  const env = { ...process.env };
  afterEach(() => { process.env = { ...env }; });
  it('put links the caller session from its environment; reply posts in the thread', async () => {
    const d = mkdtempSync(join(tmpdir(), 'stack-route-'));
    process.env.CLAUDE_CODE_HOST_SESSION_ID = 'local_abc-123';
    process.env.CLAUDE_CODE_SESSION_ID = 'cli-1';
    let out = '';
    const go = (...a: string[]) => run([...a, '--dir', d, '--no-commit'], { out: (s) => { out += s; }, err: (s) => { out += s; } });
    expect(await go('asks', 'put', 'a1', '--ask', 'Approve X', '--kind', 'approve', '--from', 'Stack architect', '--why', 'CI green')).toBe(0);
    expect(readFileSync(join(d, 'tasks/asks.md'), 'utf8')).toContain('> agent: [Stack architect](#local_abc-123)');
    expect(await go('asks', 'put', 'a2', '--ask', 'Approve Y', '--kind', 'approve', '--from', 'cos')).not.toBe(0);
    expect(out).toContain('why is required');
    expect(await go('asks', 'reply', 'a1', '--from', 'Stack architect', '--text', 'More context')).toBe(0);
    expect(readFileSync(join(d, 'tasks/asks.md'), 'utf8')).toMatch(/> - \S+ Stack architect: More context/);
  });
  it('without a host id links local_<session id>', async () => {
    const d = mkdtempSync(join(tmpdir(), 'stack-route-'));
    delete process.env.CLAUDE_CODE_HOST_SESSION_ID;
    process.env.CLAUDE_CODE_SESSION_ID = 'cli-1';
    expect(await run(['asks', 'put', 'a1', '--ask', 'Approve X', '--kind', 'approve', '--from', 'cos', '--why', 'w', '--dir', d, '--no-commit'], { out: () => undefined, err: () => undefined })).toBe(0);
    expect(readFileSync(join(d, 'tasks/asks.md'), 'utf8')).toContain('> agent: [cos](#local_cli-1)');
  });
});

// @req FR:ask-routing/doc.snippet
describe('agent doc', () => {
  it('opens with the paste-ready rule and its exact commands', () => {
    const doc = readFileSync(join(__dirname, '../../docs/asks.md'), 'utf8');
    const rule = doc.slice(doc.indexOf('## The rule'), doc.indexOf('## Put an ask'));
    for (const s of ['Never use `AskUserQuestion`', '--why', '--recommend', '--link', 'end your turn', 'Stack resumes this session', 'stack asks handle <key>', 'stack asks reply <key>']) expect(rule).toContain(s);
    expect(doc.indexOf('## The rule')).toBeGreaterThan(0);
  });
});
