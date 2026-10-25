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
const keyOf = (text: string): string => parseRow(text.replace(/--.*$/, ' ')).title.toLowerCase().replace(/[`*_]/g, '').replace(/\s+/g, ' ').replace(/[.:;,]+$/, '').trim();

/** Names a row says it waits on (the reason after `--`); mirrors blockedOn in the core scorer. @req FR:web-app/now.blockers */
export function blockedOn(text: string): string[] {
  const i = text.indexOf('--');
  const m = i < 0 ? null : REASON.exec(text.slice(i + 2).trim());
  return m ? m[2].split(';')[0].split(/\s*(?:,|&|\band\b)\s*/i).map((x) => keyOf(x)).filter(Boolean) : [];
}

/** Blocked row ref -> refs it waits on: same project first (exact title, then whole word), other projects only on an exact title. */
export function blockerEdges(all: Task[]): Map<string, string[]> {
  const keyed = all.filter((t) => !t.done).map((t) => ({ t, key: keyOf(t.text) }));
  const word = (name: string) => new RegExp(`(^|\\W)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\W|$)`);
  const out = new Map<string, string[]>();
  for (const { t } of keyed) {
    const found = new Set<string>();
    for (const name of blockedOn(t.text)) {
      const mine = keyed.filter((x) => x.t.project === t.project && x.t.ref !== t.ref);
      const exact = mine.filter((x) => x.key === name);
      const part = exact.length === 0 && name.length >= 3 ? mine.filter((x) => word(name).test(x.key)) : [];
      const hit = exact.length ? exact : part;
      if (hit.length === 1) { found.add(hit[0].t.ref); continue; }
      if (hit.length > 1) continue;
      const far = keyed.filter((x) => x.t.project !== t.project && x.key === name);
      if (far.length === 1) found.add(far[0].t.ref);
    }
    if (found.size) out.set(t.ref, [...found]);
  }
  return out;
}

type Key = [number, number, number];
const cmp = (a: Key, b: Key) => b[0] - a[0] || b[1] - a[1] || b[2] - a[2];
const parked = (t: Task, now: Date): boolean => { const r = parseRow(t.text); return !!r.suspend || !!(r.start && (dueDays(r.start, now) ?? 0) > 0) || /🅿️?/u.test(t.text) || (dueDays(r.due, now) ?? 0) > HORIZON_DAYS; };
const rowKey = (t: Task, now: Date): Key => {
  const r = parseRow(t.text);
  const d = dueDays(r.due, now);
  return [d === null ? 0 : d < -30 ? 1 : d <= 0 ? 3 : d <= 3 ? 2 : d <= 7 ? 1 : 0, r.status && vsx(r.status) === '🚧' ? 1 : 0, r.priority ? PRIO_BY.get(vsx(r.priority)) ?? 0 : 0];
};

/**
 * Order for the Now lists: due-soon first, then in progress, then priority, then file order (stable). A row that blocks
 * others takes the best key among the rows it blocks (transitive, never a sum). @req FR:web-app/now.blockers
 */
export function rankNow(tasks: Task[], now = new Date(), all: Task[] = tasks): Task[] {
  const edges = blockerEdges(all);
  const blocks = new Map<string, string[]>();
  for (const [blocked, bs] of edges) for (const b of bs) blocks.set(b, [...(blocks.get(b) ?? []), blocked]);
  const byRef = new Map(all.map((t) => [t.ref, t]));
  const effective = (t: Task): Key => {
    let best = rowKey(t, now);
    const seen = new Set<string>([t.ref]);
    const queue = [...(blocks.get(t.ref) ?? [])];
    while (queue.length) {
      const ref = queue.pop()!;
      const x = byRef.get(ref);
      if (!x || seen.has(ref) || x.done) continue;
      seen.add(ref);
      if (parked(x, now)) continue;
      const k = rowKey(x, now);
      if (cmp(k, best) < 0) best = k;
      queue.push(...(blocks.get(ref) ?? []));
    }
    return best;
  };
  return tasks.map((t, i) => ({ t, i, k: effective(t) }))
    .sort((a, b) => cmp(a.k, b.k) || a.i - b.i).map((x) => x.t);
}
