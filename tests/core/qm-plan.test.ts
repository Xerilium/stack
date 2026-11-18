import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'fs';
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
