import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parseQmPlan, QmInvalid, QmStore } from '../../src/core/qm-plan';

const PLAN = {
  version: 1, asOf: '2026-11-18T19:00:00Z',
  projects: [
    { project: 'Stack', agent: { name: 'stack-architect', sessionId: 'local_abc', url: 'https://example.com/s' }, tasks: [{ title: 'Ship QM', url: 'https://github.com/o/r/pull/1' }, { title: 'Fix CI' }], weeklyTokens: 2000000, preAckMin: 10, postReviewMin: 30 },
    { project: 'FOCUS', agent: { name: 'focus-lead' }, tasks: [], weeklyTokens: null, preAckMin: null, postReviewMin: null },
  ],
};
const home = () => mkdtempSync(join(tmpdir(), 'stack-qm-'));
const issues = (body: unknown) => { try { parseQmPlan(body); } catch (e) { if (e instanceof QmInvalid) return e.issues.map((i) => i.field); throw e; } throw new Error('expected QmInvalid'); };

describe('parseQmPlan', () => {
  // @req FR:qm-plan/store.schema
  it('accepts a full plan, nulls as pending', () => {
    expect(parseQmPlan(PLAN)).toEqual(PLAN);
  });

  // @req FR:qm-plan/store.schema
  it('lists every issue', () => {
    expect(issues('x')).toEqual(['body']);
    expect(issues({ ...PLAN, version: 2, extra: 1 })).toEqual(expect.arrayContaining(['version', 'extra']));
    expect(issues({ ...PLAN, asOf: 'soon' })).toEqual(['asOf']);
    const p = { ...PLAN.projects[0], tasks: Array(6).fill({ title: 't' }), weeklyTokens: -1, preAckMin: 1.5, agent: { name: '' }, bogus: 1 };
    expect(issues({ ...PLAN, projects: [p] })).toEqual(expect.arrayContaining(['projects[0].tasks', 'projects[0].weeklyTokens', 'projects[0].preAckMin', 'projects[0].agent.name', 'projects[0].bogus']));
    expect(issues({ ...PLAN, projects: [{ ...PLAN.projects[0], tasks: [{ title: 'a', url: 'http://x' }] }] })).toEqual(['projects[0].tasks[0].url']);
    expect(issues({ version: 1, asOf: PLAN.asOf })).toEqual(['projects']);
    expect(issues({ ...PLAN, projects: [PLAN.projects[0], { ...PLAN.projects[1], project: 'stack' }] })).toEqual(['projects[1].project']);
  });
});

describe('QmStore', () => {
  // @req FR:qm-plan/store.path @req FR:qm-plan/store.read
  it('reads no plan for a missing or broken file', () => {
    const dir = home(); const s = new QmStore(dir);
    expect(s.file).toBe(join(dir, 'qm-plan.json'));
    expect(s.read()).toEqual({ plan: null });
    writeFileSync(s.file, '{nope');
    expect(s.read()).toEqual({ plan: null, broken: true });
    const d = new QmStore(home()); mkdirSync(d.file); // unreadable (EISDIR) is broken, not missing
    expect(d.read()).toEqual({ plan: null, broken: true });
  });

  // @req FR:qm-plan/store.put
  it('validates and replaces the plan atomically', () => {
    const dir = join(home(), 'nested'); const s = new QmStore(dir);
    expect(() => s.put({ version: 1 })).toThrow(QmInvalid);
    expect(existsSync(s.file)).toBe(false);
    s.put(PLAN);
    expect(JSON.parse(readFileSync(s.file, 'utf8'))).toEqual(PLAN);
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    s.put({ ...PLAN, projects: [] });
    expect(s.read().plan?.projects).toEqual([]);
  });
});

describe('QmStore live', () => {
  // @req FR:qm-plan/live.event
  it('tells onWrite listeners after a put, never on a failed put, and unhooks', () => {
    const s = new QmStore(home()); let n = 0;
    const off = s.onWrite(() => { n++; });
    s.onWrite(() => { throw new Error('a listener never fails a write'); });
    expect(() => s.put({ version: 1 })).toThrow(QmInvalid);
    expect(n).toBe(0);
    s.put(PLAN);
    expect(n).toBe(1);
    off(); s.put(PLAN);
    expect(n).toBe(1);
  });

  // @req FR:qm-plan/live.event @req FR:qm-plan/live.event.stop
  it('watch reports a changed mtime (a write by another process) and stops', () => {
    const s = new QmStore(home()); const seen: number[] = [];
    let hook: ((cur: { mtimeMs: number }, prev: { mtimeMs: number }) => void) | undefined; let opts: unknown; let unhooked: unknown;
    const poll = { watchFile: (f: string, o: unknown, fn: typeof hook) => { expect(f).toBe(s.file); opts = o; hook = fn; }, unwatchFile: (f: string, fn: unknown) => { expect(f).toBe(s.file); unhooked = fn; } };
    const stop = s.watch((m) => seen.push(m), 20, poll);
    expect(opts).toEqual({ persistent: false, interval: 20 }); // never keeps the process alive
    hook!({ mtimeMs: 0 }, { mtimeMs: 0 }); // a missing file's first poll: not news
    hook!({ mtimeMs: 5 }, { mtimeMs: 0 });
    hook!({ mtimeMs: 5 }, { mtimeMs: 5 });
    hook!({ mtimeMs: 0 }, { mtimeMs: 5 }); // deleted
    expect(seen).toEqual([5, 0]);
    stop();
    expect(unhooked).toBe(hook);
  });
});
