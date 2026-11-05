/**
 * Auto-priority: untagged-task report, owner-pick match, and logged-miss regression checks.
 * @req FR:auto-priority/tags.@function @req FR:auto-priority/picks.@function @req FR:auto-priority/misses.@function
 */
import type { ScoredTask } from './scoring';

/** One logged miss. @req FR:auto-priority/$miss */
export interface Miss { date: string; above: string; below: string }
export interface PickMatch { hits: string[]; misses: string[]; n: number }
type Row = { text: string; context?: string };

const SCORING = ['Value', 'Impact', 'Priority'];
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const has = (row: Row, phrase: string): boolean =>
  new RegExp(`(?<![\\p{L}\\p{N}])${esc(phrase)}(?![\\p{L}\\p{N}])`, 'iu').test(`${row.text}\n${row.context ?? ''}`);

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
