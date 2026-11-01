/**
 * Owner and Chief of Staff priority overrides: `.stack/priorities.json`, applied on top of the engine order.
 * @req FR:scoring-engine/overrides.@json @req FR:scoring-engine/overrides.@function
 */

/** One override. @req FR:scoring-engine/$priority-rule */
export interface PriorityRule {
  /** A project name or title, or a word or phrase in the row text. */
  match: string;
  effect: 'top' | 'down' | 'hide';
  why?: string;
  /** YYYY-MM-DD; the rule stops applying on that date. */
  until?: string;
  by?: string;
}

export const PRIORITIES_PATH = '.stack/priorities.json';
const EFFECTS: readonly string[] = ['top', 'down', 'hide'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Rules from the file's text: invalid rules are skipped, an unreadable file has none. @req FR:scoring-engine/overrides.invalid */
export function parsePriorities(text: string): PriorityRule[] {
  let raw: unknown;
  try { raw = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { return []; }
  const list = (raw as { rules?: unknown } | null)?.rules;
  if (!Array.isArray(list)) return [];
  const out: PriorityRule[] = [];
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const { match, effect, why, until, by } = r as Record<string, unknown>;
    if (typeof match !== 'string' || !match.trim() || typeof effect !== 'string' || !EFFECTS.includes(effect)) continue;
    if (until !== undefined && (typeof until !== 'string' || !DAY.test(until) || Number.isNaN(Date.parse(until)))) continue;
    out.push({ match: match.trim(), effect: effect as PriorityRule['effect'], ...(typeof why === 'string' ? { why } : {}), ...(until ? { until: until as string } : {}), ...(typeof by === 'string' ? { by } : {}) });
  }
  return out;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The phrase appears as whole words, case-insensitively. @req FR:scoring-engine/overrides.match */
const has = (haystack: string, phrase: string): boolean => new RegExp(`(?<![\\p{L}\\p{N}])${esc(phrase)}(?![\\p{L}\\p{N}])`, 'iu').test(haystack);

/** The first live rule in file order that matches the row. @req FR:scoring-engine/overrides.match.first */
export function ruleFor(row: { text: string; project: string; context?: string }, rules: PriorityRule[], at: Date): PriorityRule | undefined {
  const today = at.toISOString().slice(0, 10);
  return rules.find((r) => (!r.until || today < r.until) && (has(row.project, r.match) || has(row.text, r.match) || (!!row.context && has(row.context, r.match))));
}

/**
 * Orders rows by tier (top, unmatched, down), keeping the engine order inside a tier; hide removes.
 * @req FR:scoring-engine/overrides.tiers @req FR:scoring-engine/overrides.hide @req FR:scoring-engine/overrides.until
 */
export function applyOverrides<T extends { text: string; project: string; context?: string }>(ranked: T[], rules: PriorityRule[], at: Date): T[] {
  if (!rules.length) return ranked;
  // tier 0: top (by rule position), 1: unmatched, 2: down
  const keep: { row: T; t: number; k: number; i: number }[] = [];
  ranked.forEach((row, i) => {
    const r = ruleFor(row, rules, at);
    if (r?.effect === 'hide') return;
    keep.push({ row, t: r?.effect === 'top' ? 0 : r?.effect === 'down' ? 2 : 1, k: r?.effect === 'top' ? rules.indexOf(r) : 0, i });
  });
  return keep.sort((a, b) => a.t - b.t || a.k - b.k || a.i - b.i).map((k) => k.row);
}
