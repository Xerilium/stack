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
const MAX_MATCH = 100;
/** A real calendar day: 2026-02-31 is not one. */
const realDay = (s: string): boolean => DAY.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;

/**
 * @req FR:scoring-engine/overrides.invalid
 * Rules from the text of the file: invalid rules are skipped, an unreadable file has none.
 */
export function parsePriorities(text: string): PriorityRule[] {
  let raw: unknown;
  try { raw = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { return []; }
  const list = (raw as { rules?: unknown } | null)?.rules;
  if (!Array.isArray(list)) return [];
  const out: PriorityRule[] = [];
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const { match, effect, why, until, by } = r as Record<string, unknown>;
    if (typeof match !== 'string' || !match.trim() || match.trim().length > MAX_MATCH || typeof effect !== 'string' || !EFFECTS.includes(effect)) continue;
    if (until !== undefined && (typeof until !== 'string' || !realDay(until))) continue;
    out.push({ match: match.trim(), effect: effect as PriorityRule['effect'], ...(typeof why === 'string' ? { why } : {}), ...(until ? { until: until as string } : {}), ...(typeof by === 'string' ? { by } : {}) });
  }
  return out;
}

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** The phrase appears as whole words, case-insensitively. @req FR:scoring-engine/overrides.match */
const wordsRe = (phrase: string): RegExp => new RegExp(`(?<![\\p{L}\\p{N}])${esc(phrase)}(?![\\p{L}\\p{N}])`, 'iu');

const norm = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
export interface Matched { rule: PriorityRule; index: number; /** `own`: the project, or the row itself; `parent`: only a row above it. */ via: 'own' | 'parent' }
type Row = { text: string; project: string; context?: string };

/**
 * Finds, for a row, the first live rule in file order that matches it. A rule that names a project (by name or title)
 * applies to that project only; any other rule matches a whole word or phrase in the row, or in the rows above it.
 * @req FR:scoring-engine/overrides.match @req FR:scoring-engine/overrides.match.project @req FR:scoring-engine/overrides.match.first
 */
export function matcherFor(rules: PriorityRule[], at: Date, projects: string[], timeZone?: string): (row: Row) => Matched | undefined {
  // "Today" is the owner's day, not UTC: a rule `until` a date stops at local midnight of that date.
  let today = at.toISOString().slice(0, 10);
  try { if (timeZone) today = at.toLocaleDateString('en-CA', { timeZone }); } catch { /* an unknown zone keeps the UTC day */ }
  const known = new Set(projects.map(norm));
  const live = rules.map((rule, index) => ({ rule, index })).filter(({ rule }) => !rule.until || today < rule.until);
  const words = new Map(live.map(({ rule }) => [rule.match, wordsRe(rule.match)]));
  return (row) => {
    for (const { rule, index } of live) {
      if (known.has(norm(rule.match))) { if (norm(row.project) === norm(rule.match)) return { rule, index, via: 'own' }; continue; }
      const re = words.get(rule.match)!;
      if (re.test(row.text)) return { rule, index, via: 'own' };
      if (row.context && re.test(row.context)) return { rule, index, via: 'parent' };
    }
    return undefined;
  };
}

/**
 * Orders rows by tier (top, unmatched, down), keeping the engine order inside a tier; hide removes. Top rows follow
 * the order of their rules, and inside one rule the rows that match on their own come before those matching through a parent.
 * @req FR:scoring-engine/overrides.tiers @req FR:scoring-engine/overrides.hide @req FR:scoring-engine/overrides.until
 */
export function applyOverrides<T extends Row>(ranked: T[], rules: PriorityRule[], at: Date, projects: string[] = [...new Set(ranked.map((r) => r.project))], timeZone?: string): T[] {
  if (!rules.length) return ranked;
  const match = matcherFor(rules, at, projects, timeZone);
  const keep: { row: T; t: number; k: number; v: number; i: number }[] = [];
  ranked.forEach((row, i) => {
    const m = match(row);
    if (m?.rule.effect === 'hide') return;
    keep.push({ row, t: m?.rule.effect === 'top' ? 0 : m?.rule.effect === 'down' ? 2 : 1, k: m?.rule.effect === 'top' ? m.index : 0, v: m?.rule.effect === 'top' && m.via === 'parent' ? 1 : 0, i });
  });
  return keep.sort((a, b) => a.t - b.t || a.k - b.k || a.v - b.v || a.i - b.i).map((k) => k.row);
}
