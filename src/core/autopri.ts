/**
 * Auto-priority: untagged-task report, owner-pick match, and logged-miss regression checks.
 * @req FR:auto-priority/tags.@function @req FR:auto-priority/picks.@function @req FR:auto-priority/misses.@function
 */
import type { StackConfig } from './config';
import type { ScoredTask, ScoringEngine, ScoringProject } from './scoring';
import { wordsRe } from './regex';
import { byScore, daysUntilDue, filterByTimeBlock, isMessage, legacyEngine, listEngines, registerEngine, resolveBlockers, weighProjects } from './scoring';

/** One logged miss. @req FR:auto-priority/$miss */
export interface Miss { date: string; above: string; below: string }
export interface PickMatch { hits: string[]; misses: string[]; n: number }
type Row = { text: string; context?: string };

const SCORING = ['Value', 'Impact', 'Priority'];
const has = (row: Row, phrase: string): boolean => wordsRe(phrase).test(`${row.text}\n${row.context ?? ''}`);

/** @req FR:auto-priority/tags.untagged @req FR:auto-priority/tags.parked */
export function untaggedTasks(scored: ScoredTask[]): ScoredTask[] {
  return scored.filter((s) => s.leaf && !s.parked && !s.breakdown.emojiContributions.some((e) => SCORING.includes(e.category)));
}

/** @req FR:auto-priority/picks.match */
export function pickMatch(ranked: Row[], picks: string[], n = 10): PickMatch {
  const top = ranked.slice(0, n);
  const hits = picks.filter((p) => top.some((r) => has(r, p)));
  return { hits, misses: picks.filter((p) => !hits.includes(p)), n };
}

const MISS = /^-\s+(\d{4}-\d{2}-\d{2}):\s+"([^"]+)"\s+over\s+"([^"]+)"\s*$/;

/** @req FR:auto-priority/misses.parse */
export function parseMisses(text: string): Miss[] {
  const out: Miss[] = [];
  let inSection = false;
  for (const line of text.split(/\r?\n/)) {
    if (/^#{1,6}\s/.test(line)) inSection = /^#{1,6}\s+Auto-pri misses\s*$/i.test(line);
    else if (inSection) { const m = MISS.exec(line); if (m) out.push({ date: m[1], above: m[2], below: m[3] }); }
  }
  return out;
}

/** @req FR:auto-priority/misses.check */
export function checkMisses(ranked: Row[], misses: Miss[]): Miss[] {
  return misses.filter((m) => {
    const a = ranked.findIndex((r) => has(r, m.above));
    const b = ranked.findIndex((r) => has(r, m.below));
    return a < 0 || (b >= 0 && a > b);
  });
}

// ---------------------------------------------------------------- engine

/** Unblocker marker: work that speeds all other work. */
export const UNBLOCK = '🔓';
const UNBLOCK_SCORE = 4000;
const URGENT_SCORE = 2000;
const STALE_DAYS = 30;
/** Share of the project's own value (💰, 🌟 …) added to each of its tasks. @req FR:auto-priority/engine.project-value */
const PROJECT_VALUE_SHARE = 0.5;

/** Hard-date pull: full when due or overdue (not stale), fading fast with distance. @req FR:auto-priority/engine.urgency */
const urgency = (days: number | null): number =>
  days === null || days < -STALE_DAYS ? 0 : days <= 0 ? URGENT_SCORE : URGENT_SCORE / (1 + days) ** 2;

/** Score parts per task id, before blockers lift. @req FR:auto-priority/explain.parts */
export interface AutopriParts { unblock: number; urgency: number; value: number }
export function autopriParts(all: ScoredTask[], projects: ScoringProject[], config: StackConfig, at?: Date): Map<string, AutopriParts> {
  const byId = new Map(all.map((s) => [s.task.id, s]));
  const projectValue = new Map(weighProjects(projects, config).map((w) => [w.name.toLowerCase(), w.valueScore]));
  const out = new Map<string, AutopriParts>();
  for (const s of all) {
    let unblock = 0;
    const seen = new Set<string>();
    for (let cur: ScoredTask | undefined = s; cur && !seen.has(cur.task.id); cur = cur.task.parent ? byId.get(cur.task.parent) : undefined) {
      seen.add(cur.task.id);
      if (cur.task.text.includes(UNBLOCK)) { unblock = UNBLOCK_SCORE; break; }
    }
    const value = (s.breakdown.baseScore + PROJECT_VALUE_SHARE * (projectValue.get(s.task.project.toLowerCase()) ?? 0)) / Math.sqrt(Math.max(s.breakdown.effortHours, 0.01));
    out.set(s.task.id, { unblock, urgency: urgency(at ? daysUntilDue(s.task.text, config, at) : null), value });
  }
  return out;
}

/**
 * `(unblock + urgency + value) / sqrt(effort)`, then blockers take the score of what they block.
 * @req FR:auto-priority/engine.@function @req FR:auto-priority/engine.unblock @req FR:auto-priority/engine.blockers
 * @req FR:auto-priority/engine.horizon @req FR:auto-priority/engine.rows
 */
export const autopriEngine: ScoringEngine = {
  id: 'autopri',
  score: legacyEngine.score,
  filter: legacyEngine.filter,
  rank(all, projects, config, at, opts = {}) {
    const byId = new Map(all.map((s) => [s.task.id, s]));
    const parts = autopriParts(all, projects, config, at);
    const raw = new Map([...parts].map(([id, p]) => [id, p.unblock + p.urgency + p.value]));
    const blocks = new Map<string, string[]>();
    for (const [blocked, blockers] of resolveBlockers(projects)) for (const b of blockers) blocks.set(b, [...(blocks.get(b) ?? []), blocked]);
    const live = (s: ScoredTask) => !s.parked && !isMessage(s.task.text);
    const score = (id: string): number => {
      let best = raw.get(id)!;
      const seen = new Set<string>([id]);
      const queue = [...(blocks.get(id) ?? [])];
      while (queue.length) {
        const next = queue.pop()!;
        const n = byId.get(next);
        if (seen.has(next) || !n) continue;
        seen.add(next);
        if (live(n)) best = Math.max(best, raw.get(next)!);
        queue.push(...(blocks.get(next) ?? []));
      }
      return best;
    };
    const candidates = all.filter((s) => s.leaf && live(s));
    const kept = at && !opts.ignoreBlocks ? filterByTimeBlock(candidates, projects, config, at) : candidates;
    return byScore(kept.map((s) => ({ ...s, score: score(s.task.id) })));
  },
};

/** Registers `autopri` once. Never changes the default engine. @req FR:auto-priority/engine.@function */
export function registerAutopriEngine(): void {
  if (!listEngines().includes(autopriEngine.id)) registerEngine(autopriEngine);
}
