import type { Task } from './types';

/** Pure helpers for the Now and Projects views. @req FR:web-app/now.active @req FR:web-app/projects.glance */
export const isActive = (t: Task) => /active/i.test(t.section) || t.section.includes('🔄');
export const isUpNext = (t: Task) => /up next/i.test(t.section) || t.section.includes('⏭');

/** Subtask counts for the row at `i` (rows deeper than it, up to the next row at its depth or shallower). */
export function progress(tasks: Task[], i: number): { done: number; total: number } {
  const base = tasks[i];
  let done = 0, total = 0;
  for (let k = i + 1; k < tasks.length; k++) {
    const t = tasks[k];
    if (t.project !== base.project || t.depth <= base.depth) break;
    total++;
    if (t.done) done++;
  }
  return { done, total };
}

/** Subtasks (all depths) of a row, in order. */
export function children(tasks: Task[], ref: string): Task[] {
  const i = tasks.findIndex((t) => t.ref === ref);
  if (i < 0) return [];
  const out: Task[] = [];
  for (let k = i + 1; k < tasks.length; k++) {
    if (tasks[k].project !== tasks[i].project || tasks[k].depth <= tasks[i].depth) break;
    out.push(tasks[k]);
  }
  return out;
}

/** Open top-level tasks in Active sections, file order. */
export const activeTasks = (tasks: Task[]): Task[] => tasks.filter((t) => !t.done && t.depth === 0 && isActive(t));

/** First open top-level task per project: Active, else Up next, else any. */
export function topTask(tasks: Task[], project: string): Task | undefined {
  const open = tasks.filter((t) => t.project === project && !t.done && t.depth === 0);
  return open.find(isActive) ?? open.find(isUpNext) ?? open[0];
}

/** Rows visible in the list: hides subtasks of collapsed parents. Rows of collapsed sections are dropped. */
export function visibleRows(rows: Task[], all: Task[], expanded: Set<string>, collapsed: Set<string>, force = false): Task[] {
  const out: Task[] = [];
  const parentOf = new Map<string, string>();
  const stack: Task[] = [];
  for (const t of all) {
    while (stack.length && (stack[stack.length - 1].project !== t.project || stack[stack.length - 1].depth >= t.depth)) stack.pop();
    if (stack.length) parentOf.set(t.ref, stack[stack.length - 1].ref);
    stack.push(t);
  }
  const open = (ref: string): boolean => { const p = parentOf.get(ref); return !p || (expanded.has(p) && open(p)); };
  for (const t of rows) {
    if (!force && collapsed.has(`${t.project}/${t.section}`)) continue;
    if (t.depth > 0 && !force && !open(t.ref)) continue;
    out.push(t);
  }
  return out;
}

/** Sections open by default. */
export const startsOpen = (section: string) => /active|up next/i.test(section) || section.includes('🔄') || section.includes('⏭');

export type DeferChoice = { label: string; key: string; hours?: number; days?: number };
export const DEFER: DeferChoice[] = [
  { label: 'Later today (2 hours)', key: '1', hours: 2 },
  { label: 'Tomorrow', key: '2', days: 1 },
  { label: 'Next week', key: '3', days: 7 },
];

// ---- Now ranking (client side, for the lists under the focus task)
import { parseRow } from './row';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** Calendar days from `now` to a `Oct 23` / `Feb 1, 2027` date; null when it is not a plain date. */
export function dueDays(due: string | undefined, now = new Date()): number | null {
  const m = due && /^([A-Za-z]{3})[a-z]*\s+(\d{1,2})(?:,\s*(\d{4}))?/.exec(due);
  if (!m) return null;
  const mo = MONTHS.indexOf(m[1].toLowerCase());
  if (mo < 0) return null;
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const at = (y: number) => Math.round((Date.UTC(y, mo, Number(m[2])) - today) / 864e5);
  if (m[3]) return at(Number(m[3]));
  return [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(at).reduce((b, d) => (Math.abs(d + 60) < Math.abs(b + 60) ? d : b));
}
export const HORIZON_DAYS = 14;
const PRIO: Record<string, number> = { '🚨': 3, '‼️': 2, '🔺': 1, '🔻': -1 };
const vsx = (s: string) => s.replace(/️/g, '');
const PRIO_BY = new Map(Object.entries(PRIO).map(([k, v]) => [vsx(k), v]));

/** A task you could act on now: not parked, blocked, started later, or due beyond the horizon. */
export function actionable(t: Task, now = new Date()): boolean {
  if (t.done) return false;
  const r = parseRow(t.text);
  if (r.suspend || (r.start && (dueDays(r.start, now) ?? 0) > 0)) return false;
  if (/🅿️?/u.test(t.text) || (r.status && vsx(r.status) === '⛔')) return false;
  const d = dueDays(r.due, now);
  return d === null || d <= HORIZON_DAYS;
}

const REASON = /^(after|pending|blocked on|blocked by|until|waiting on|waiting for)\s+(.*)$/i;
const NOT_A_NAME = /^(?:(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d|\d{1,2}(?::\d\d)?\s*(?:am|pm)?$)/i;
/** Title key; same steps as titleKey in the core scorer so both resolve the same names. */
const keyOf = (text: string): string => text.replace(/--.*$/, ' ')
  .replace(/(?:📅|⏰|💤)\s*[^:]*:/gu, ' ').replace(/🔄\s*[^:]*:/gu, ' ')
  .replace(/[\p{Extended_Pictographic}️‍]/gu, ' ').replace(/[`*_]/g, '')
  .replace(/\s+/g, ' ').trim().toLowerCase().replace(/[.:;,]+$/, '').replace(/^the\s+/, '').trim();

/** Names a row says it waits on (the reason after `--`, up to a `;`); mirrors blockedOn in the core scorer. @req FR:web-app/now.blockers */
export function blockedOn(text: string): string[] {
  const i = text.indexOf('--');
  const m = i < 0 ? null : REASON.exec(text.slice(i + 2).trim());
  return m ? m[2].split(';')[0].split(/\s*(?:,|&|\band\b)\s*/i).map(keyOf).filter((n) => n !== '' && !NOT_A_NAME.test(n)) : [];
}

/**
 * Blocked row ref -> refs it waits on, among open Active rows (the rows the core scorer sees): same project first (exact
 * title, else a title that starts with the name), other projects only on an exact title.
 */
export function blockerEdges(all: Task[]): Map<string, string[]> {
  const keyed = all.filter((t) => !t.done && isActive(t)).map((t) => ({ t, key: keyOf(t.text) }));
  const out = new Map<string, string[]>();
  for (const { t } of keyed) {
    const found = new Set<string>();
    for (const name of blockedOn(t.text)) {
      const mine = keyed.filter((x) => x.t.project === t.project && x.t.ref !== t.ref);
      const exact = mine.filter((x) => x.key === name);
      const lead = new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\W|$)`);
      const hit = exact.length ? exact : name.length >= 3 ? mine.filter((x) => lead.test(x.key)) : [];
      const only = hit.length ? hit : keyed.filter((x) => x.t.project !== t.project && x.key === name);
      if (only.length === 1) found.add(only[0].t.ref);
    }
    if (found.size) out.set(t.ref, [...found]);
  }
  return out;
}

/** Parent ref of each row (by depth, within its project). */
function parents(all: Task[]): Map<string, string> {
  const out = new Map<string, string>();
  const stack: Task[] = [];
  for (const t of all) {
    while (stack.length && (stack[stack.length - 1].project !== t.project || stack[stack.length - 1].depth >= t.depth)) stack.pop();
    if (stack.length) out.set(t.ref, stack[stack.length - 1].ref);
    stack.push(t);
  }
  return out;
}

type Key = [number, number, number];
const cmp = (a: Key, b: Key) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2];
const parkedRow = (t: Task, now: Date): boolean => { const r = parseRow(t.text); return !!r.suspend || !!(r.start && (dueDays(r.start, now) ?? 0) > 0) || /🅿️?/u.test(t.text) || (dueDays(r.due, now) ?? 0) > HORIZON_DAYS; };
const rowKey = (t: Task, now: Date): Key => {
  const r = parseRow(t.text);
  const d = dueDays(r.due, now);
  return [d === null ? 0 : d < -30 ? 1 : d <= 0 ? 3 : d <= 3 ? 2 : d <= 7 ? 1 : 0, r.status && vsx(r.status) === '🚧' ? 1 : 0, r.priority ? PRIO_BY.get(vsx(r.priority)) ?? 0 : 0];
};

/**
 * Order for the Now lists: due-soon first, then in progress, then priority, then file order (stable). A row that blocks
 * others takes the best key among the rows it blocks (transitive, never a sum); subtasks of a blocked row are held up too,
 * and a subtask under a blocker inherits through its ancestors. @req FR:web-app/now.blockers
 */
export function rankNow(tasks: Task[], now = new Date(), all: Task[] = tasks): Task[] {
  const edges = blockerEdges(all);
  const blocks = new Map<string, string[]>();
  for (const [blocked, bs] of edges) for (const b of bs) blocks.set(b, [...(blocks.get(b) ?? []), blocked]);
  const byRef = new Map(all.map((t) => [t.ref, t]));
  const parentOf = parents(all);
  const kids = new Map<string, string[]>();
  for (const [c, p] of parentOf) kids.set(p, [...(kids.get(p) ?? []), c]);
  const ancestors = (ref: string): string[] => {
    const out: string[] = [];
    for (let p = parentOf.get(ref); p && !out.includes(p); p = parentOf.get(p)) out.push(p);
    return out;
  };
  const parked = (t: Task): boolean => [t.ref, ...ancestors(t.ref)].some((r) => { const x = byRef.get(r); return !!x && parkedRow(x, now); });
  const lent = (ref: string): Key | undefined => {
    let best: Key | undefined;
    const seen = new Set<string>([ref]);
    const queue = [...(blocks.get(ref) ?? [])];
    while (queue.length) {
      const r = queue.pop()!;
      const x = byRef.get(r);
      if (!x || seen.has(r) || x.done) continue;
      seen.add(r);
      if (parked(x)) continue;
      const k = rowKey(x, now);
      if (!best || cmp(k, best) < 0) best = k;
      queue.push(...(blocks.get(r) ?? []), ...(kids.get(r) ?? []));
    }
    return best;
  };
  const effective = (t: Task): Key => {
    let best = rowKey(t, now);
    for (const r of [t.ref, ...ancestors(t.ref)]) { const k = lent(r); if (k && cmp(k, best) < 0) best = k; }
    return best;
  };
  return tasks.map((t, i) => ({ t, i, k: effective(t) }))
    .sort((a, b) => cmp(a.k, b.k) || a.i - b.i).map((x) => x.t);
}
