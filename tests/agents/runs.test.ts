/** @req FR:agent-sessions/run.events @req FR:agent-sessions/run.cancel @req FR:agent-sessions/run.record @req FR:agent-sessions/sessions.list */
import { createRunManager, type AgentDriver, type Run, type Session, type Update } from '../../src/agents';
import { MemoryStorage } from '../../src/core/storage';

const NOW = new Date('2026-10-29T10:00:00Z');
const S1: Session = { id: 'a1b2c3d4-0000-0000-0000-000000000001', title: 'stack: web', project: 'stack', cwd: '/x/stack', branch: 'main', lastActive: new Date(NOW.getTime() - 60_000).toISOString(), active: true, cost: { usd: 1, tokens: 10 }, prs: [] };
const S2: Session = { ...S1, id: 'a1b2c3d4-0000-0000-0000-000000000002', title: 'todo: plan', project: 'todo', cwd: '/x/todo', lastActive: new Date(NOW.getTime() - 3 * 3600_000).toISOString(), active: false, cost: { usd: 0.2, tokens: 5 } };

/** A driver whose runs are fed by hand. */
function fakeDriver(sessions: Session[] = [S1, S2]) {
  const feeds = new Map<string, { push: (u: Update) => void; end: () => void }>();
  const cancelled: string[] = [];
  const driver: AgentDriver = {
    listSessions: async () => sessions,
    getMessages: async () => [],
    async prompt(req) {
      const id = `run-${feeds.size + 1}`;
      const queue: Update[] = []; let done = false; let wake: (() => void) | null = null;
      const push = (u: Update) => { queue.push(u); wake?.(); };
      const end = () => { done = true; wake?.(); };
      feeds.set(id, { push, end });
      const updates = (async function* () { for (;;) { if (queue.length) { yield queue.shift()!; continue; } if (done) return; await new Promise<void>((ok) => { wake = ok; }); wake = null; } })();
      const run: Run = { id, sessionId: req.sessionId ?? null, updates };
      return run;
    },
    async cancel(id) { cancelled.push(id); const f = feeds.get(id); if (!f) return false; f.push({ type: 'done', stopReason: 'cancelled', cost: { usd: 0, tokens: 0 }, turns: 0, durationMs: 0 }); f.end(); return true; },
  };
  return { driver, feeds, cancelled };
}
const wait = (ms = 10) => new Promise((r) => setTimeout(r, ms));
const chunk = (text: string): Update => ({ type: 'message_chunk', role: 'assistant', text });
const done: Update = { type: 'done', stopReason: 'end_turn', cost: { usd: 0.12, tokens: 300 }, turns: 3, durationMs: 900 };

describe('run manager', () => {
  it('starts a run, buffers updates, replays them to a late subscriber, then streams live ones and closes', async () => {
    const { driver, feeds } = fakeDriver();
    const storage = new MemoryStorage();
    const rm = createRunManager({ driver, ctx: { storage, now: () => NOW }, keepMs: 1000 });
    const r = await rm.prompt({ sessionId: S1.id, text: 'Hello' });
    expect(r).toEqual({ runId: 'run-1', sessionId: S1.id });
    feeds.get('run-1')!.push(chunk('Hi'));
    await wait();
    const seen: Update[] = []; let closed = false;
    const off = rm.subscribe(S1.id, (u) => seen.push(u), () => { closed = true; })!;
    expect(seen).toEqual([chunk('Hi')]);
    feeds.get('run-1')!.push(chunk(' there')); feeds.get('run-1')!.push(done); feeds.get('run-1')!.end();
    await wait();
    expect(seen).toEqual([chunk('Hi'), chunk(' there'), done]);
    expect(closed).toBe(true);
    off();
    expect(rm.subscribe('zzz', () => undefined, () => undefined)).toBeNull();
  });
  it('one run per session; running state; cancel ends it', async () => {
    const { driver, cancelled } = fakeDriver();
    const rm = createRunManager({ driver, ctx: { storage: new MemoryStorage(), now: () => NOW } });
    await rm.prompt({ sessionId: S1.id, text: 'a' });
    expect(rm.running(S1.id)).toBe(true);
    await expect(rm.prompt({ sessionId: S1.id, text: 'b' })).rejects.toThrow(/active|running/i);
    expect(await rm.cancel(S1.id)).toEqual({ changed: true });
    expect(cancelled).toEqual(['run-1']);
    await wait();
    expect(rm.running(S1.id)).toBe(false);
    expect(await rm.cancel(S1.id)).toEqual({ changed: false });
  });
  it('a new session gets its id once the driver reports it, and subscribers can find it by runId first', async () => {
    const { driver, feeds } = fakeDriver();
    const rm = createRunManager({ driver, ctx: { storage: new MemoryStorage(), now: () => NOW } });
    const r = await rm.prompt({ cwd: '/x/stack', text: 'new' });
    expect(r).toEqual({ runId: 'run-1', sessionId: null });
    const seen: Update[] = [];
    expect(rm.subscribe('run-1', (u) => seen.push(u), () => undefined)).not.toBeNull();
    feeds.get('run-1')!.push({ type: 'session', sessionId: 'new-1' });
    await wait();
    expect(rm.sessionOf('run-1')).toBe('new-1');
    expect(rm.running('new-1')).toBe(true);
  });
  it('records one redacted log line per finished run in tasks/logs/sessions.md', async () => {
    const { driver, feeds } = fakeDriver();
    const storage = new MemoryStorage();
    const rm = createRunManager({ driver, ctx: { storage, now: () => NOW } });
    await rm.prompt({ sessionId: S1.id, text: 'Push with ghp_abcdefghijklmnopqrstuvwxyz0123456789ab then ' + 'write the release notes '.repeat(12) });
    feeds.get('run-1')!.push(done); feeds.get('run-1')!.end();
    await wait(30);
    const log = (await storage.read('tasks/logs/sessions.md')).content;
    expect(log).toMatch(/^- 2026-10-29T10:00:00\.000Z a1b2c3d4 end_turn \$0\.12 300 tokens: Push with \(redacted\) then write the release notes/m);
    expect(log).not.toContain('ghp_');
    expect(log.split('\n').find((l) => l.startsWith('- '))!.length).toBeLessThan(200);
  });
  it('old runs are forgotten after keepMs; a session with no run has nothing to subscribe to', async () => {
    const { driver, feeds } = fakeDriver();
    const rm = createRunManager({ driver, ctx: { storage: new MemoryStorage(), now: () => NOW }, keepMs: 20 });
    await rm.prompt({ sessionId: S1.id, text: 'a' });
    feeds.get('run-1')!.push(done); feeds.get('run-1')!.end();
    await wait();
    expect(rm.subscribe(S1.id, () => undefined, () => undefined)).not.toBeNull();
    await wait(40);
    expect(rm.subscribe(S1.id, () => undefined, () => undefined)).toBeNull();
  });
});

// @req FR:agent-sessions/sessions.owner @req FR:agent-sessions/sessions.cost @req FR:agent-sessions/$session @req FR:agent-sessions/$cost
describe('owners', () => {
  const ALLYTE = '# Allyte\n\n- **Repos:** finops-hubs\n\n## Active\n\n- [ ] x\n';
  const S3: Session = { ...S1, id: 'a1b2c3d4-0000-0000-0000-000000000003', title: 'hubs', project: 'finops-hubs', cwd: '/x/finops-hubs/.claude/worktrees/zany-fox-1a2b3c', lastActive: new Date(NOW.getTime() - 120_000).toISOString(), active: false, cost: { usd: 2, tokens: 50 } };
  const S4: Session = { ...S1, id: 'a1b2c3d4-0000-0000-0000-000000000004', title: 'maenifold', project: 'maenifold-rs', cwd: '/x/maenifold-rs', active: false, cost: { usd: 1, tokens: 7 } };
  async function setup() {
    const storage = new MemoryStorage();
    await storage.write('tasks/allyte.md', ALLYTE);
    await storage.write('tasks/stack.md', '# Stack\n\n## Active\n\n- [ ] y\n');
    const { driver } = fakeDriver([S1, S2, S3, S4]);
    return createRunManager({ driver, ctx: { storage, now: () => NOW } });
  }
  it('every session names the Stack project that owns its repo, or null', async () => {
    const rm = await setup();
    const { items } = await rm.sessions();
    expect(items.map((s) => [s.project, s.owner])).toEqual([['stack', 'stack'], ['maenifold-rs', null], ['finops-hubs', 'allyte'], ['todo', null]]);
  });
  it('cost buckets projects by owner when there is one, else by repo', async () => {
    const rm = await setup();
    const r = await rm.cost(7);
    expect(r.projects.map((p) => [p.project, p.tokens])).toEqual([['allyte', 50], ['maenifold-rs', 7], ['stack', 10], ['todo', 5]]);
  });
});
