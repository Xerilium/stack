import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { parseConfig } from '../../src/core/config';
import { ScoringProject, ScoringTask, getEngine, legacyEngine, listEngines } from '../../src/core/scoring';
import {
  balancedEngine, registerBalancedEngine, compareEngines, renderReport, runBakeoff,
} from '../../src/core/bakeoff';

const config = parseConfig();
let seq = 0;
const task = (text: string, project = 'Secret'): ScoringTask => ({ id: `${project}_${seq++}`, parent: null, text, level: 0, project });
const proj = (name: string, texts: string[], extra: Partial<ScoringProject> = {}): ScoringProject =>
  ({ name, value: [], weeklyCapacity: 40, capacity: {}, tasks: texts.map(t => task(t, name)), ...extra });

// @req FR:scoring-bakeoff/engine.interface
describe('balancedEngine', () => {
  it('has id balanced', () => expect(balancedEngine.id).toBe('balanced'));

  // @req FR:scoring-bakeoff/engine.shape
  it('keeps tasks, flags and breakdown parts from legacy', () => {
    const ps = [proj('A', ['x 🟢 ‼️', 'y 🔴', 'z 🅿️ 🟡'])];
    const l = legacyEngine.score(ps, config);
    const b = balancedEngine.score(ps, config);
    expect(b.map(s => s.task)).toEqual(l.map(s => s.task));
    expect(b.map(s => [s.leaf, s.parked])).toEqual(l.map(s => [s.leaf, s.parked]));
    b.forEach((s, i) => {
      expect(s.breakdown.baseScore).toBe(l[i].breakdown.baseScore);
      expect(s.breakdown.effortHours).toBe(l[i].breakdown.effortHours);
      expect(s.breakdown.emojiContributions).toEqual(l[i].breakdown.emojiContributions);
      expect(s.breakdown.calculatedTotal).toBe(s.score);
    });
  });

  // @req FR:scoring-bakeoff/engine.divisor
  it('divides by the square root of effort hours', () => {
    const ps = [proj('A', ['x 🔴'])]; // 4h -> sqrt 2
    const l = legacyEngine.score(ps, config)[0];
    const b = balancedEngine.score(ps, config)[0];
    expect(b.score).toBeCloseTo(l.breakdown.baseScore / 2, 10);
  });

  // @req FR:scoring-bakeoff/engine.sign
  it('does not let bigger negative tasks outrank smaller ones', () => {
    const ps = [proj('A', ['a ⏳ 🔹', 'b ⏳ ⚫️'], { value: [] })];
    const cfg = parseConfig();
    const lg = legacyEngine.score(ps, cfg);
    const bl = balancedEngine.score(ps, cfg);
    expect(lg[0].breakdown.baseScore).toBeLessThan(0);
    // legacy inversion: big negative task scores higher than small one
    expect(lg[1].score).toBeGreaterThan(lg[0].score);
    expect(bl[1].score).toBeLessThan(bl[0].score);
  });

  // @req FR:scoring-bakeoff/engine.divisor
  it('favors a big valuable task over a trivial one more than legacy does', () => {
    const ps = [proj('A', ['tiny 🔹 ⬆️', 'big 🔴 💰 💰 ⬆️'])];
    const l = legacyEngine.score(ps, config);
    const b = balancedEngine.score(ps, config);
    expect(l[0].score).toBeGreaterThan(l[1].score);
    expect(b[1].score).toBeGreaterThan(b[0].score);
  });

  // @req FR:scoring-bakeoff/engine.filter
  it('filters like legacy', () => {
    const ps = [proj('A', ['x ☀️', 'y 🏠', 'z'])];
    const at = new Date('2026-10-21T20:00:00Z');
    const s = balancedEngine.score(ps, config);
    expect(balancedEngine.filter(s, ps, config, at).map(t => t.task.id))
      .toEqual(legacyEngine.filter(s, ps, config, at).map(t => t.task.id));
  });
});

describe('registration', () => {
  // @req FR:scoring-bakeoff/engine.register @req FR:scoring-bakeoff/engine.default
  it('registers once, is idempotent, and keeps legacy default', () => {
    registerBalancedEngine();
    registerBalancedEngine();
    expect(listEngines().filter(i => i === 'balanced')).toHaveLength(1);
    expect(getEngine('balanced')).toBe(balancedEngine);
    expect(getEngine()).toBe(legacyEngine);
  });
});

const sample = (): ScoringProject[] => [
  proj('Secret Alpha', ['a 🔹', 'b 🔴 💰 💰 ⬆️', 'c 🟡 ‼️', 'd 🅿️ 🟢', 'e 🟠 🚧', 'f', 'g ⚫️ 🔝']),
  proj('Secret Beta', ['h 🟢 ⏳', 'i 🔹 ⬇️', 'j 🔴 ⏳']),
];

// @req FR:scoring-bakeoff/compare.@function
describe('compareEngines', () => {
  // @req FR:scoring-bakeoff/compare.population
  it('ranks unparked leaves only', () => {
    expect(compareEngines(legacyEngine, balancedEngine, sample(), config).taskCount).toBe(9);
  });

  // @req FR:scoring-bakeoff/compare.agreement
  it('is perfect for identical engines', () => {
    const r = compareEngines(legacyEngine, legacyEngine, sample(), config, 3);
    expect(r.top1Agree).toBe(true);
    expect(r.topNOverlap).toBe(1);
    expect(r.spearman).toBeCloseTo(1, 10);
    expect(r.meanRankShift).toBe(0);
    expect(r.maxRankShift).toBe(0);
  });

  // @req FR:scoring-bakeoff/compare.agreement
  it('shows differences between the engines', () => {
    const r = compareEngines(legacyEngine, balancedEngine, sample(), config, 3);
    expect(r.spearman).toBeLessThan(1);
    expect(r.spearman).toBeGreaterThan(0);
    expect(r.maxRankShift).toBeGreaterThan(0);
    expect(r.topNOverlap).toBeGreaterThanOrEqual(0);
    expect(r.topNOverlap).toBeLessThanOrEqual(1);
  });

  // @req FR:scoring-bakeoff/compare.effort-mix
  it('reports effort mix of the top N for each engine', () => {
    const r = compareEngines(legacyEngine, balancedEngine, sample(), config, 4);
    for (const mix of [r.effortMix.a, r.effortMix.b]) {
      expect(mix.quick + mix.medium + mix.large + mix.none).toBe(4);
    }
    expect(r.effortMix.b.large).toBeGreaterThanOrEqual(r.effortMix.a.large);
  });

  // @req FR:scoring-bakeoff/compare.movers
  it('anonymizes movers', () => {
    const r = compareEngines(legacyEngine, balancedEngine, sample(), config);
    expect(r.movers.length).toBeGreaterThan(0);
    const json = JSON.stringify(r);
    expect(json).not.toMatch(/Secret/);
    expect(r.movers[0].project).toMatch(/^Project [A-Z]$/);
    const m = r.movers[0];
    expect(Math.abs(m.rankA - m.rankB)).toBe(r.maxRankShift);
  });

  // @req FR:scoring-bakeoff/compare.empty
  it('handles no tasks', () => {
    const r = compareEngines(legacyEngine, balancedEngine, [], config);
    expect(r).toMatchObject({ taskCount: 0, topNOverlap: 0, spearman: 0, meanRankShift: 0, maxRankShift: 0, movers: [] });
    expect(r.top1Agree).toBe(false);
  });

  // @req FR:scoring-bakeoff/compare.pure
  it('is deterministic and does not mutate input', () => {
    const ps = sample();
    const before = JSON.stringify(ps);
    const a = compareEngines(legacyEngine, balancedEngine, ps, config);
    expect(JSON.stringify(ps)).toBe(before);
    expect(compareEngines(legacyEngine, balancedEngine, ps, config)).toEqual(a);
  });
});

// @req FR:scoring-bakeoff/report.@function
describe('renderReport', () => {
  const r = () => compareEngines(legacyEngine, balancedEngine, sample(), config);

  // @req FR:scoring-bakeoff/report.aggregate
  it('has no task text or names', () => {
    const md = renderReport(r(), 'Keep legacy.');
    expect(md).not.toMatch(/Secret/);
    expect(md).toMatch(/Spearman/);
    expect(md).toMatch(/Project [A-Z]/);
  });

  // @req FR:scoring-bakeoff/report.recommendation
  it('states default unchanged and includes recommendation', () => {
    const md = renderReport(r(), 'Keep legacy for now.');
    expect(md).toMatch(/default.*unchanged/i);
    expect(md).toContain('Keep legacy for now.');
  });
});

// @req FR:scoring-bakeoff/run.@function
describe('runBakeoff', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bakeoff-'));
  const dir = path.join(tmp, 'tasks');
  fs.mkdirSync(dir);
  fs.writeFileSync(path.join(dir, 'zeta-proj.md'), '# Zeta Private\n\n## 🔄 Active\n\n- [ ] top secret thing 🔴 💰\n- [ ] other 🔹\n');
  fs.writeFileSync(path.join(dir, 'alpha.md'), '# Alpha Private\n\n## 🔄 Active\n\n- [ ] hush 🟡 ‼️\n');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'ignored');
  const out = path.join(tmp, 'out', 'report.md');

  // @req FR:scoring-bakeoff/run.load @req FR:scoring-bakeoff/run.readonly
  it('loads md files, writes only the report, and leaks nothing', () => {
    const snapshot = fs.readdirSync(dir).map(f => [f, fs.statSync(path.join(dir, f)).mtimeMs]);
    const r = runBakeoff(dir, out, 'Keep legacy.');
    expect(r.taskCount).toBe(3);
    const md = fs.readFileSync(out, 'utf8');
    expect(md).not.toMatch(/Private|secret|hush|zeta|alpha/i);
    expect(fs.readdirSync(dir).map(f => [f, fs.statSync(path.join(dir, f)).mtimeMs])).toEqual(snapshot);
    expect(fs.readdirSync(dir)).toHaveLength(3);
  });

  afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));
});
