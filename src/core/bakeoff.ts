import * as fs from 'fs';
import * as path from 'path';
import { parseConfig, type StackConfig } from './config';
import { parseProject } from './parser';
import {
  ScoredTask, ScoringEngine, ScoringProject,
  extractEmojis, legacyEngine, listEngines, rankTasks, registerEngine, toScoringProject,
} from './scoring';

// ---------------------------------------------------------------- engine

/**
 * Redesigned scoring: same parts as legacy, but effort is dampened (square root) and
 * negative bases are multiplied, not divided, so big bad tasks never beat small bad ones.
 * @req FR:scoring-bakeoff/engine.interface @req FR:scoring-bakeoff/engine.shape @req FR:scoring-bakeoff/engine.divisor
 * @req FR:scoring-bakeoff/engine.sign @req FR:scoring-bakeoff/engine.filter
 */
export const balancedEngine: ScoringEngine = {
  id: 'balanced',
  score(projects, config) {
    return legacyEngine.score(projects, config).map(s => {
      const { baseScore, effortHours } = s.breakdown;
      const effective = Math.sqrt(effortHours);
      const score = baseScore >= 0 ? baseScore / effective : baseScore * effective;
      return { ...s, score, breakdown: { ...s.breakdown, calculatedTotal: score } };
    });
  },
  filter: (tasks, projects, config, at) => legacyEngine.filter(tasks, projects, config, at),
};

/**
 * Registers `balanced` once. Never changes the default engine.
 * @req FR:scoring-bakeoff/engine.register @req FR:scoring-bakeoff/engine.default
 */
export function registerBalancedEngine(): void {
  if (!listEngines().includes(balancedEngine.id)) registerEngine(balancedEngine);
}

// ---------------------------------------------------------------- compare

export interface EffortMix { quick: number; medium: number; large: number; none: number }

export interface Mover {
  project: string;
  effort: string;
  priority: string[];
  impact: string[];
  rankA: number;
  rankB: number;
}

/** @req FR:scoring-bakeoff/compare.@function */
export interface BakeoffResult {
  engineA: string;
  engineB: string;
  topN: number;
  taskCount: number;
  top1Agree: boolean;
  topNOverlap: number;
  spearman: number;
  meanRankShift: number;
  maxRankShift: number;
  effortMix: { a: EffortMix; b: EffortMix };
  movers: Mover[];
}

const QUICK = ['🔹', '🟢'];
const MEDIUM = ['🟡', '🟠'];
const LARGE = ['🔴', '⚫️'];
const MOVERS = 5;

const letters = (i: number): string => {
  let s = '';
  for (let n = i; n >= 0; n = Math.floor(n / 26) - 1) s = String.fromCharCode(65 + (n % 26)) + s;
  return `Project ${s}`;
};

/** @req FR:scoring-bakeoff/compare.population */
function population(engine: ScoringEngine, projects: ScoringProject[], config: StackConfig): ScoredTask[] {
  return rankTasks(engine, projects, config);
}

/**
 * Rank the same unparked leaves with two engines and summarize how they differ.
 * @req FR:scoring-bakeoff/compare.@function @req FR:scoring-bakeoff/compare.agreement @req FR:scoring-bakeoff/compare.effort-mix
 * @req FR:scoring-bakeoff/compare.movers @req FR:scoring-bakeoff/compare.empty @req FR:scoring-bakeoff/compare.pure
 */
export function compareEngines(
  a: ScoringEngine, b: ScoringEngine, projects: ScoringProject[], config: StackConfig, topN = 10,
): BakeoffResult {
  const ra = population(a, projects, config);
  const rb = population(b, projects, config);
  const n = ra.length;
  const rankA = new Map(ra.map((s, i) => [s.task.id, i + 1]));
  const rankB = new Map(rb.map((s, i) => [s.task.id, i + 1]));
  const projectLetter = new Map(projects.map((p, i) => [p.name, letters(i)]));
  const empty: EffortMix = { quick: 0, medium: 0, large: 0, none: 0 };

  const mix = (ranked: ScoredTask[]): EffortMix => {
    const m = { ...empty };
    for (const s of ranked.slice(0, topN)) {
      const e = extractEmojis(s.task.text, config).Effort;
      if (e.some(x => QUICK.includes(x))) m.quick++;
      else if (e.some(x => MEDIUM.includes(x))) m.medium++;
      else if (e.some(x => LARGE.includes(x))) m.large++;
      else m.none++;
    }
    return m;
  };

  if (n === 0) {
    return {
      engineA: a.id, engineB: b.id, topN, taskCount: 0, top1Agree: false, topNOverlap: 0, spearman: 0,
      meanRankShift: 0, maxRankShift: 0, effortMix: { a: { ...empty }, b: { ...empty } }, movers: [],
    };
  }

  const k = Math.min(topN, n);
  const topA = new Set(ra.slice(0, k).map(s => s.task.id));
  const overlap = rb.slice(0, k).filter(s => topA.has(s.task.id)).length / k;
  const shifts = ra.map(s => Math.abs(rankA.get(s.task.id)! - rankB.get(s.task.id)!));
  const d2 = ra.reduce((sum, s) => sum + (rankA.get(s.task.id)! - rankB.get(s.task.id)!) ** 2, 0);
  const spearman = n > 1 ? 1 - (6 * d2) / (n * (n * n - 1)) : 1;

  const movers = ra
    .map((s, i) => ({ s, shift: shifts[i], rankA: rankA.get(s.task.id)!, rankB: rankB.get(s.task.id)! }))
    .sort((x, y) => y.shift - x.shift || x.rankA - y.rankA)
    .slice(0, MOVERS)
    .filter(m => m.shift > 0)
    .map(({ s, rankA: ia, rankB: ib }): Mover => {
      const e = extractEmojis(s.task.text, config);
      return {
        project: projectLetter.get(s.task.project) ?? 'Project ?', effort: e.Effort[0] ?? 'none',
        priority: e.Priority, impact: e.Impact, rankA: ia, rankB: ib,
      };
    });

  return {
    engineA: a.id, engineB: b.id, topN, taskCount: n, top1Agree: ra[0].task.id === rb[0].task.id,
    topNOverlap: overlap, spearman, meanRankShift: shifts.reduce((x, y) => x + y, 0) / n,
    maxRankShift: Math.max(...shifts), effortMix: { a: mix(ra), b: mix(rb) }, movers,
  };
}

// ---------------------------------------------------------------- report

const f = (x: number, d = 2) => x.toFixed(d);
const pct = (x: number, total: number) => (total ? `${Math.round((100 * x) / total)}%` : '0%');

/** @req FR:scoring-bakeoff/report.@function @req FR:scoring-bakeoff/report.aggregate @req FR:scoring-bakeoff/report.recommendation */
export function renderReport(r: BakeoffResult, recommendation: string): string {
  const mixRow = (name: string, m: EffortMix) => {
    const total = m.quick + m.medium + m.large + m.none;
    return `| ${name} | ${pct(m.quick, total)} | ${pct(m.medium, total)} | ${pct(m.large, total)} | ${pct(m.none, total)} |`;
  };
  const movers = r.movers.length
    ? r.movers.map(m => `| ${m.project} | ${m.effort} | ${m.priority.join(' ') || '-'} | ${m.impact.join(' ') || '-'} | ${m.rankA} | ${m.rankB} |`)
    : ['| none | | | | | |'];
  return [
    `# Scoring bake-off: ${r.engineA} vs ${r.engineB}`,
    '',
    `The default engine is unchanged (\`${r.engineA}\`). This report compares it with \`${r.engineB}\` on real task data. It holds aggregate numbers and anonymized examples only.`,
    '',
    '## Recommendation',
    '',
    recommendation,
    '',
    '## Agreement',
    '',
    `Population: ${r.taskCount} unparked leaf tasks, no time filter.`,
    '',
    '| Metric | Value |',
    '| --- | --- |',
    `| Same #1 task | ${r.top1Agree ? 'yes' : 'no'} |`,
    `| Top ${r.topN} overlap | ${pct(r.topNOverlap, 1)} |`,
    `| Spearman rank correlation | ${f(r.spearman)} |`,
    `| Mean rank shift | ${f(r.meanRankShift, 1)} |`,
    `| Max rank shift | ${r.maxRankShift} |`,
    '',
    `## Effort mix of the top ${r.topN}`,
    '',
    '| Engine | Quick | Medium | Large | No effort |',
    '| --- | --- | --- | --- | --- |',
    mixRow(r.engineA, r.effortMix.a),
    mixRow(r.engineB, r.effortMix.b),
    '',
    '## Largest movers (anonymized)',
    '',
    `| Project | Effort | Priority | Impact | ${r.engineA} rank | ${r.engineB} rank |`,
    '| --- | --- | --- | --- | --- | --- |',
    ...movers,
    '',
  ].join('\n');
}

// ---------------------------------------------------------------- runner

/**
 * Reads `*.md` from the tasks directory (read only) and writes one report file.
 * @req FR:scoring-bakeoff/run.@function @req FR:scoring-bakeoff/run.readonly @req FR:scoring-bakeoff/run.load
 */
export function runBakeoff(tasksDir: string, outFile: string, recommendation: string): BakeoffResult {
  const files = fs.readdirSync(tasksDir).filter(n => n.toLowerCase().endsWith('.md')).sort();
  const projects = files.map(n =>
    toScoringProject(parseProject(fs.readFileSync(path.join(tasksDir, n), 'utf8')), path.basename(n, path.extname(n))));
  const result = compareEngines(legacyEngine, balancedEngine, projects, parseConfig());
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, renderReport(result, recommendation));
  return result;
}

/* istanbul ignore next */
if (require.main === module) {
  const [dir, out, ...rec] = process.argv.slice(2);
  if (!dir || !out) {
    console.error('usage: bakeoff <tasksDir> <outFile> [recommendation]');
    process.exit(2);
  }
  runBakeoff(dir, out, rec.join(' ') || 'No recommendation supplied.');
}
