import { getDefaults } from '../../src/core/config';
import {
  applyTriage, authorize, claimTask, effectiveAutonomy, recordResult, redact, setAutonomy, TriageDenied,
} from '../../src/core/triage';
import { MemoryStorage, PathError, Storage } from '../../src/core/storage';
import { addTask, LifecycleError } from '../../src/core/lifecycle';

const NOW = new Date('2026-10-22T17:00:00Z');
const DOC = `# Alpha

## 🔄 Active

- [ ] Plain task
- [ ] Triage task 🤖:triage
- [ ] Assist task 🤖:assist
  - [ ] 🪄 Agent child
  - [ ] 🙋 Human child
- [ ] Full task 🤖:full
  - [ ] 🪄 Full child
- [ ] Odd level 🤖:root
- [x] Done task 🤖:full
`;
// 0-based lines
const L = { plain: 4, triage: 5, assist: 6, agentChild: 7, humanChild: 8, full: 9, fullChild: 10, odd: 11, done: 12 };
const agent = { actor: 'mcp:t1' };
const owner = { actor: 'cli', owner: true };
const ref = (line: number) => ({ path: 'tasks/alpha.md', line });

async function setup(doc = DOC) {
  const storage = new MemoryStorage();
  await storage.write('tasks/alpha.md', doc);
  const ctx = { storage, config: getDefaults(), now: () => NOW };
  const text = async () => (await storage.read('tasks/alpha.md')).content;
  const log = async () => (await storage.read('tasks/logs/alpha.md').catch(() => ({ content: '' }))).content;
  return { storage, ctx, text, log };
}

// @req FR:ai-triage-assist/autonomy.gate
describe('authorize', () => {
  it('maps levels to actions, deny by default', () => {
    const table: Record<string, string[]> = {
      none: [], triage: ['triage', 'record'], assist: ['triage', 'record', 'claim', 'complete-subtask'],
      full: ['triage', 'record', 'claim', 'complete-subtask', 'complete-task'],
    };
    for (const [lvl, ok] of Object.entries(table)) {
      for (const a of ['triage', 'record', 'claim', 'complete-subtask', 'complete-task']) expect([lvl, a, authorize(lvl, a)]).toEqual([lvl, a, ok.includes(a)]);
    }
  });
  it('never allows merge, deploy, or unknown input', () => {
    for (const lvl of ['none', 'triage', 'assist', 'full', 'root', '', undefined as never]) {
      for (const a of ['merge', 'deploy', 'push', '', undefined as never, '__proto__']) expect(authorize(lvl, a)).toBe(false);
    }
    expect(authorize('admin', 'triage')).toBe(false);
    expect(authorize('__proto__', 'triage')).toBe(false);
    expect(authorize('toString', 'triage')).toBe(false);
  });
});

// @req FR:ai-triage-assist/autonomy.marker
describe('effectiveAutonomy', () => {
  it('reads the marker, inherits down, ignores unknown levels', () => {
    expect(effectiveAutonomy(DOC, L.plain)).toBe('none');
    expect(effectiveAutonomy(DOC, L.triage)).toBe('triage');
    expect(effectiveAutonomy(DOC, L.assist)).toBe('assist');
    expect(effectiveAutonomy(DOC, L.agentChild)).toBe('assist');
    expect(effectiveAutonomy(DOC, L.humanChild)).toBe('assist');
    expect(effectiveAutonomy(DOC, L.fullChild)).toBe('full');
    expect(effectiveAutonomy(DOC, L.odd)).toBe('none');
    expect(effectiveAutonomy(DOC, 999)).toBe('none');
    expect(effectiveAutonomy(DOC, 0)).toBe('none');
  });
  it('a child marker overrides its parent', () => {
    const d = `# A\n\n## Active\n\n- [ ] P 🤖:full\n  - [ ] C 🤖:triage\n`;
    expect(effectiveAutonomy(d, 5)).toBe('triage');
  });
});

// @req FR:ai-triage-assist/autonomy.set
describe('setAutonomy', () => {
  it('writes, replaces, and removes the marker', async () => {
    const { ctx, text } = await setup();
    await setAutonomy(ctx, ref(L.plain), 'assist');
    expect(await text()).toContain('- [ ] Plain task 🤖:assist\n');
    await setAutonomy(ctx, ref(L.plain), 'full');
    expect(await text()).toContain('- [ ] Plain task 🤖:full\n');
    await setAutonomy(ctx, ref(L.plain), 'none');
    expect(await text()).toContain('- [ ] Plain task\n');
    await expect(setAutonomy(ctx, ref(L.plain), 'root' as never)).rejects.toThrow();
  });
  it('subtask text can never carry the marker', async () => {
    const { ctx, text } = await setup();
    await expect(applyTriage(ctx, ref(L.assist), { agent: 'sneaky 🤖:full' }, agent)).rejects.toThrow();
    expect(await text()).toBe(DOC);
  });
});

// @req FR:ai-triage-assist/triage.subtasks @req FR:ai-triage-assist/triage.props @req FR:ai-triage-assist/triage.gate @req FR:ai-triage-assist/triage.open
describe('applyTriage', () => {
  it('adds 🪄 and 🙋 subtasks and fills missing props', async () => {
    const { ctx, text } = await setup();
    const r = await applyTriage(ctx, ref(L.triage), { agent: 'Draft the plan', human: 'Pick the vendor', priority: '🔺', effort: '🟡' }, agent);
    expect(r.changed).toBe(true);
    expect(r.applied.sort()).toEqual(['effort', 'priority']);
    const t = await text();
    expect(t).toMatch(/- \[ \] 🔺 Triage task 🤖:triage 🟡\n/);
    expect(t).toContain('  - [ ] 🪄 Draft the plan\n');
    expect(t).toContain('  - [ ] 🙋 Pick the vendor\n');
    expect(r.added).toHaveLength(2);
  });
  it('is idempotent', async () => {
    const { ctx, text } = await setup();
    await applyTriage(ctx, ref(L.triage), { agent: 'Draft the plan', priority: '🔺' }, agent);
    const once = await text();
    const r = await applyTriage(ctx, ref(L.triage), { agent: 'Draft the plan', priority: '🔺' }, agent);
    expect(r.changed).toBe(false);
    expect(await text()).toBe(once);
  });
  it('never overwrites an existing priority/effort/impact', async () => {
    const { ctx, text } = await setup(DOC.replace('Triage task 🤖:triage', '🚨 Triage task 🤖:triage 🟢'));
    const r = await applyTriage(ctx, ref(L.triage), { priority: '🔻', effort: '🔴', impact: '⬆️' }, agent);
    expect(r.applied).toEqual(['impact']);
    const t = await text();
    expect(t).toContain('🚨');
    expect(t).not.toContain('🔻');
    expect(t).not.toContain('🔴');
  });
  it('is denied at autonomy none and writes nothing', async () => {
    const { ctx, text, storage } = await setup();
    await expect(applyTriage(ctx, ref(L.plain), { agent: 'x' }, agent)).rejects.toBeInstanceOf(TriageDenied);
    await expect(applyTriage(ctx, ref(L.odd), { agent: 'x' }, agent)).rejects.toBeInstanceOf(TriageDenied);
    expect(await text()).toBe(DOC);
    expect(await storage.list()).toEqual(['tasks/alpha.md']);
  });
  it('owner skips the gate', async () => {
    const { ctx, text } = await setup();
    await applyTriage(ctx, ref(L.plain), { human: 'Decide' }, owner);
    expect(await text()).toContain('  - [ ] 🙋 Decide\n');
  });
  it('rejects bad subtask text and bad props', async () => {
    const { ctx, text } = await setup();
    const bad = ['', '   ', 'a\nb', 'a\rb', 'a\u2028b', 'a\u0085b', 'a\u0000b', 'x'.repeat(201), '🪄 nested', '🙋 nested', '💤 Oct 30: later', '⛔️ blocked', '🅿️ parked', '🚧 doing'];
    for (const b of bad) await expect(applyTriage(ctx, ref(L.triage), { agent: b }, agent)).rejects.toThrow();
    for (const b of bad) await expect(applyTriage(ctx, ref(L.triage), { human: b }, agent)).rejects.toThrow();
    await expect(applyTriage(ctx, ref(L.triage), { priority: 'None' as never }, agent)).rejects.toThrow();
    await expect(applyTriage(ctx, ref(L.triage), { priority: '🟢' as never }, agent)).rejects.toThrow();
    await expect(applyTriage(ctx, ref(L.triage), { status: '🚧' } as never, agent)).rejects.toThrow();
    expect(await text()).toBe(DOC);
  });
  it('only acts on open rows, within the file', async () => {
    const { ctx } = await setup();
    await expect(applyTriage(ctx, ref(L.done), { agent: 'x' }, owner)).rejects.toThrow();
    await expect(applyTriage(ctx, ref(2), { agent: 'x' }, owner)).rejects.toThrow();
    await expect(applyTriage(ctx, ref(999), { agent: 'x' }, owner)).rejects.toThrow();
  });
  it('caps children per task', async () => {
    const { ctx } = await setup();
    for (let i = 0; i < 20; i++) await applyTriage(ctx, ref(L.triage), { agent: `step ${i}` }, agent);
    await expect(applyTriage(ctx, ref(L.triage), { agent: 'one more' }, agent)).rejects.toThrow(/children/i);
  });
});

// @req FR:ai-triage-assist/claim.start @req FR:ai-triage-assist/claim.log
describe('claimTask', () => {
  it('starts an assist-level 🪄 row and logs it', async () => {
    const { ctx, text, log } = await setup();
    const r = await claimTask(ctx, ref(L.agentChild), agent);
    expect(r.changed).toBe(true);
    expect(await text()).toContain('- [ ] 🚧 🪄 Agent child');
    expect(await log()).toMatch(/claimed/);
    expect((await claimTask(ctx, ref(L.agentChild), agent)).changed).toBe(false);
  });
  it('refuses triage-only, none, 🙋, and closed rows', async () => {
    const { ctx, text } = await setup();
    for (const l of [L.plain, L.triage, L.humanChild, L.odd]) await expect(claimTask(ctx, ref(l), agent)).rejects.toBeInstanceOf(TriageDenied);
    await expect(claimTask(ctx, ref(L.done), agent)).rejects.toThrow();
    expect(await text()).toBe(DOC);
  });
});

// @req FR:ai-triage-assist/result.log @req FR:ai-triage-assist/result.nosilent @req FR:ai-triage-assist/result.noblock
describe('recordResult', () => {
  it('logs without completing when completion is not requested', async () => {
    const { ctx, text, log } = await setup();
    const r = await recordResult(ctx, ref(L.agentChild), { outcome: 'done', summary: 'Wrote it' }, agent);
    expect(r).toMatchObject({ logged: true, completed: false, deferred: false });
    expect(await text()).toBe(DOC);
    const l = await log();
    expect(l).toContain('# Alpha');
    expect(l).toContain('2026-10-22T17:00:00.000Z');
    expect(l).toContain('mcp:t1');
    expect(l).toContain('tasks/alpha.md:8');
    expect(l).toMatch(/outcome: done/);
    expect(l).toMatch(/level: assist/);
    expect(l).toMatch(/completed: no/);
    expect(l).toContain('Wrote it');
  });
  it('appends, never rewrites earlier entries', async () => {
    const { ctx, log } = await setup();
    await recordResult(ctx, ref(L.agentChild), { outcome: 'partial', summary: 'first' }, agent);
    const a = await log();
    await recordResult(ctx, ref(L.agentChild), { outcome: 'done', summary: 'second' }, agent);
    const b = await log();
    expect(b.startsWith(a)).toBe(true);
    expect(b).toContain('second');
  });
  it('completes a 🪄 subtask at assist', async () => {
    const { ctx, text, log } = await setup();
    const r = await recordResult(ctx, ref(L.agentChild), { outcome: 'done', summary: 'ok', complete: true }, agent);
    expect(r.completed).toBe(true);
    expect(await text()).toContain('- [x] 🪄 Agent child');
    expect(await log()).toMatch(/completed: yes/);
  });
  it('defers completion beyond autonomy with a 🙋 review subtask and a log line', async () => {
    const { ctx, text, log } = await setup();
    // assist cannot complete a parent task
    const r = await recordResult(ctx, ref(L.assist), { outcome: 'done', summary: 'all done', complete: true }, agent);
    expect(r).toMatchObject({ completed: false, deferred: true });
    expect(r.human).toBeDefined();
    const t = await text();
    expect(t).toContain('- [ ] Assist task 🤖:assist');
    expect(t).toMatch(/ {2}- \[ \] 🙋 Review and complete/);
    expect(await log()).toMatch(/completed: deferred/);
    // idempotent review subtask
    await recordResult(ctx, ref(L.assist), { outcome: 'done', summary: 'again', complete: true }, agent);
    expect((await text()).match(/🙋 Review and complete/g)).toHaveLength(1);
  });
  it('full completes a task, but not over an open 🙋 child, a 🙋 row, a non-done outcome', async () => {
    const { ctx, text } = await setup(DOC.replace('  - [ ] 🪄 Full child', '  - [ ] 🪄 Full child\n  - [ ] 🙋 Needs eyes'));
    const r1 = await recordResult(ctx, ref(L.full), { outcome: 'done', summary: 's', complete: true }, agent);
    expect(r1.deferred).toBe(true);
    expect(await text()).toContain('- [ ] Full task 🤖:full');
    const r2 = await recordResult(ctx, ref(L.fullChild), { outcome: 'partial', summary: 's', complete: true }, agent);
    expect(r2).toMatchObject({ completed: false, deferred: true });
    await expect(recordResult(ctx, ref(L.fullChild + 1), { outcome: 'done', summary: 's', complete: true }, agent)).rejects.toBeInstanceOf(TriageDenied);
    expect(await text()).toContain('- [ ] 🙋 Needs eyes');
  });
  it('full completes a task with no open human work', async () => {
    const { ctx, text } = await setup();
    const r = await recordResult(ctx, ref(L.fullChild - 1), { outcome: 'done', summary: 's', complete: true }, agent);
    // open 🪄 child remains: still completable, 🪄 is agent work
    expect(r.completed).toBe(true);
    expect(await text()).toContain('- [x] Full task 🤖:full');
  });
  it('blocked and needs-human add a 🙋 subtask and return normally', async () => {
    const { ctx, text } = await setup();
    const r = await recordResult(ctx, ref(L.agentChild), { outcome: 'blocked', summary: 'need API key', human: 'Provide the API key' }, agent);
    expect(r.logged).toBe(true);
    expect(r.human).toBeDefined();
    expect(await text()).toContain('  - [ ] 🙋 Provide the API key');
    const r2 = await recordResult(ctx, ref(L.agentChild), { outcome: 'needs-human', summary: 'unsure' }, agent);
    expect(r2.human).toBeDefined();
    expect(await text()).toMatch(/🙋 Review: /);
  });
  it('denied at none; allowed to log at triage but not to complete', async () => {
    const { ctx, text, storage } = await setup();
    await expect(recordResult(ctx, ref(L.plain), { outcome: 'done', summary: 'x' }, agent)).rejects.toBeInstanceOf(TriageDenied);
    expect(await storage.list()).toEqual(['tasks/alpha.md']);
    await expect(storage.read('tasks/logs/alpha.md')).rejects.toThrow();
    const r = await recordResult(ctx, ref(L.triage), { outcome: 'done', summary: 'x', complete: true }, agent);
    expect(r).toMatchObject({ logged: true, completed: false, deferred: true });
    expect(await text()).toContain('- [ ] Triage task 🤖:triage');
  });
  it('validates fields', async () => {
    const { ctx } = await setup();
    const base = { outcome: 'done' as const, summary: 'ok' };
    await expect(recordResult(ctx, ref(L.agentChild), { ...base, outcome: 'merged' as never }, agent)).rejects.toThrow();
    for (const s of ['', 'a\nb', 'a\u2028b', 'x'.repeat(501)]) await expect(recordResult(ctx, ref(L.agentChild), { ...base, summary: s }, agent)).rejects.toThrow();
    for (const a of ['', 'a b', 'a\nb', 'x'.repeat(65), '../x', 'a`b']) await expect(recordResult(ctx, ref(L.agentChild), base, { actor: a })).rejects.toThrow();
  });
  it('writes the log under tasks/logs, never as a project', async () => {
    const { ctx, storage } = await setup();
    await recordResult(ctx, ref(L.agentChild), { outcome: 'done', summary: 'ok' }, agent);
    expect(await storage.list()).toEqual(['tasks/alpha.md']);
    expect((await storage.read('tasks/logs/alpha.md')).content).toContain('ok');
  });
});

// @req FR:ai-triage-assist/result.noleak
describe('redaction', () => {
  const secrets = [
    'Bearer abcdefghijklmnop1234', 'stk_0123456789abcdef.AbCdEfGhIjKlMnOpQrStUvWxYz0123456789_-abcd',
    'ghp_abcdefghijklmnopqrstuvwxyz0123456789', 'github_pat_11ABCDEFG0abcdefghijklmnop_qrstuvwxyz', 'sk-abcdefghijklmnopqrstuvwxyz123456',
    'xoxb-123456789012-abcdefghij', 'AKIAABCDEFGHIJKLMNOP', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijklmnop',
    'password=hunter2', 'api_key: abc123', 'token = abc', 'Authorization: Basic dXNlcjpwYXNz', 'https://user:pw@example.com/x',
    '-----BEGIN RSA PRIVATE KEY-----', 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789AbCdEf',
  ];
  it.each(secrets)('redacts %s', (s) => {
    const out = redact(`before ${s} after`);
    expect(out).toContain('[redacted]');
    expect(out).toContain('before');
    expect(out).not.toContain(s.split(/[=: ]/).pop() as string);
  });
  it('leaves normal text alone', () => {
    const s = 'Updated docs/api.md and ran 12 tests in 3s; see tasks/alpha.md:8';
    expect(redact(s)).toBe(s);
  });
  it('log never contains secrets from any field', async () => {
    const { ctx, log } = await setup();
    await recordResult(ctx, ref(L.agentChild), { outcome: 'blocked', summary: 'used Bearer abcdefghijklmnop1234 and password=hunter2', human: 'Rotate ghp_abcdefghijklmnopqrstuvwxyz0123456789' }, agent);
    const l = await log();
    expect(l).not.toMatch(/hunter2|abcdefghijklmnop1234|ghp_abc/);
    expect(l).toContain('[redacted]');
  });
});

// @req FR:ai-triage-assist/result.path
describe('storage path', () => {
  it('accepts only tasks/logs/<name>.md and hides it from list', async () => {
    const s: Storage = new MemoryStorage();
    await s.write('tasks/logs/alpha.md', 'x');
    expect(await s.list()).toEqual([]);
    for (const p of ['tasks/logs/.x.md', 'tasks/logs/a/b.md', 'tasks/logs/../x.md', 'tasks/logs/x.txt', 'logs/x.md', 'tasks/logs/README.md']) {
      await expect(s.write(p, 'x')).rejects.toBeInstanceOf(PathError);
    }
  });
});

// Findings from the security review of PR 33.
describe('hardening', () => {
  const HOLD = `# Alpha

## 🔄 Active

- [ ] Blocked ⛔️ 🤖:assist
  - [ ] 🪄 Child of blocked
- [ ] Parked 🅿️ 🤖:assist
- [ ] Plan 🪄 deploy 🤖:assist
- [x] Closed 🤖:full
  - [ ] 🪄 Under closed
- [ ] Mine 🤖:assist
  - [ ] 🔺 🪄 Prefixed child
`;
  const H = { blocked: 4, blockedChild: 5, parked: 6, plan: 7, under: 9, mine: 10, prefixed: 11 };

  it('claim never overrides blocked, parked, or closed rows', async () => {
    const { ctx, text } = await setup(HOLD);
    for (const l of [H.blocked, H.parked, H.under]) await expect(claimTask(ctx, ref(l), agent)).rejects.toThrow();
    expect(await text()).toBe(HOLD);
  });

  it('triage and results also refuse rows under a closed row', async () => {
    const { ctx, text } = await setup(HOLD);
    await expect(applyTriage(ctx, ref(H.under), { human: 'x' }, owner)).rejects.toThrow(/not open/);
    await expect(recordResult(ctx, ref(H.under), { outcome: 'done', summary: 'x' }, agent)).rejects.toThrow();
    expect(await text()).toBe(HOLD);
  });

  it('never completes a held row', async () => {
    const { ctx, text } = await setup(HOLD);
    const r = await recordResult(ctx, ref(H.blockedChild), { outcome: 'done', summary: 'x', complete: true }, agent);
    expect(r.completed).toBe(true); // the 🪄 child itself is not held
    const b = await recordResult(ctx, ref(H.blocked), { outcome: 'done', summary: 'x', complete: true }, { actor: 'a', owner: false });
    expect(b.completed).toBe(false);
    expect(await text()).toContain('- [ ] Blocked ⛔️ 🤖:assist');
  });

  it('🪄 in the middle of a row does not make it a subtask', async () => {
    const { ctx, text } = await setup(HOLD);
    const r = await recordResult(ctx, ref(H.plan), { outcome: 'done', summary: 'x', complete: true }, agent);
    expect(r).toMatchObject({ completed: false, deferred: true }); // assist cannot complete a task
    expect(await text()).toContain('- [ ] Plan 🪄 deploy 🤖:assist');
  });

  it('a 🪄 child behind status or priority emoji still counts as a subtask', async () => {
    const { ctx, text } = await setup(HOLD);
    const r = await recordResult(ctx, ref(H.prefixed), { outcome: 'done', summary: 'x', complete: true }, agent);
    expect(r.completed).toBe(true);
    expect(await text()).toContain('- [x] 🔺 🪄 Prefixed child');
  });

  it('a concurrent edit above the row fails the write instead of landing on another row', async () => {
    const { ctx, storage, text } = await setup();
    const real = storage.write.bind(storage);
    let inserted = false;
    storage.write = async (p, content, o) => {
      if (!inserted && p.startsWith('tasks/logs/')) {
        inserted = true;
        const cur = (await storage.read('tasks/alpha.md')).content;
        await real('tasks/alpha.md', cur.replace('- [ ] Plain task\n', '- [ ] Plain task\n- [ ] Squeezed in\n'));
      }
      return real(p, content, o);
    };
    await expect(recordResult(ctx, ref(L.agentChild), { outcome: 'done', summary: 'x', complete: true }, agent)).rejects.toThrow();
    expect(await text()).not.toContain('[x]'.concat(' 🪄 Agent child'));
  });

  it('a full log rolls to the next file and still records the hand-off', async () => {
    const { ctx, storage } = await setup();
    await storage.write('tasks/logs/alpha.md', '# x\n'.padEnd(300 * 1024, 'y'));
    const r = await recordResult(ctx, ref(L.agentChild), { outcome: 'blocked', summary: 'stuck' }, agent);
    expect(r.human).toBeDefined();
    expect((await storage.read('tasks/logs/alpha-2.md')).content).toContain('stuck');
  });

  it('logs project files with unusual names', async () => {
    const storage = new MemoryStorage();
    await storage.write('tasks/my project.md', '# Mine\n\n## Active\n\n- [ ] 🪄 Do it 🤖:assist\n');
    const c = { storage, config: getDefaults(), now: () => NOW };
    const r = { path: 'tasks/my project.md', line: 4 };
    await claimTask(c, r, agent);
    expect((await storage.read('tasks/logs/my-project.md')).content).toContain('claimed');
    expect((await storage.read('tasks/my project.md')).content).toContain('🚧');
  });

  it('no half-claim when the log cannot be written', async () => {
    const { ctx, storage, text } = await setup();
    storage.write = async () => { throw new Error('disk'); };
    await expect(claimTask(ctx, ref(L.agentChild), agent)).rejects.toThrow('disk');
    expect(await text()).toBe(DOC);
  });

  it('subtask text rejects every row syntax emoji, even without variation selectors', async () => {
    const { ctx, text } = await setup();
    for (const bad of ['x ☀️ y', 'x ☀ y', 'x 🅿 y', 'x ⏸ y', 'x 🏷️', 'x 🚨', 'x 🟢', 'x ⬆️', 'x 📅 Oct 23: y', 'x ⏰ Oct 5: y', '🔄 Weekly: x', 'x 🤖\u200b:full', 'a\u200b🙋b']) {
      await expect(applyTriage(ctx, ref(L.triage), { agent: bad }, agent)).rejects.toThrow();
    }
    expect(await text()).toBe(DOC);
  });

  it('the generated hand-off text is also validated and syntax-free', async () => {
    const { ctx, text } = await setup();
    await recordResult(ctx, ref(L.agentChild), { outcome: 'needs-human', summary: 'needs ⛔️ 🤖:full 🪄 ☀️ review' }, agent);
    const t = await text();
    expect(t).toMatch(/ {4}- \[ \] 🙋 Review: needs :full review\n/);
    expect(effectiveAutonomy(t, L.agentChild + 1)).toBe('assist');
  });

  it('addTask by an owner is untouched (the API is where agents are stopped)', async () => {
    const { ctx, text } = await setup();
    await addTask(ctx, { project: 'alpha', text: 'Owner row 🤖:full' });
    expect(await text()).toContain('Owner row 🤖:full');
    expect(LifecycleError).toBeDefined();
  });
});

describe('redaction hardening', () => {
  it.each([
    ['password hunter2', 'hunter2'], ['the password is "correct horse"', 'horse'], ['SECRET_KEY=abc123', 'abc123'], ['DATABASE_PASSWORD=abc123', 'abc123'],
    ['token="a b c"', 'b c'], ['ghp_aaaaaaaaaa', 'ghp_aaaaaaaaaa'], ['glpat-abcdefghij1234', 'abcdefghij1234'], ['npm_abcdefghijklmnopqrstuv', 'npm_abcdefghijklmnopqrstuv'],
    ['pa\u200bssword=abc999', 'abc999'], ['postgres://user:p@ss@host/db', 'ss@host'], ['https://token@host/x', 'token@host'], ['eyJhbGciOi.e30.sig', 'eyJhbGciOi'],
    ['ASIAABCDEFGHIJKLMNOP', 'ASIAABCDEFGHIJKLMNOP'],
  ])('redacts %s', (input, leak) => {
    const out = redact(`note: ${input} end`);
    expect(out).not.toContain(leak);
    expect(out).toContain('[redacted]');
  });
});
