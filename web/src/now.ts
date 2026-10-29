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
    if (/^\s*💬/u.test(t.text)) continue; // replies are messages, not subtasks
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
// Mirrors the server's stack engine (src/core/scoring.ts) over HTTP-shaped rows; tests/parity/now-parity.test.ts keeps them in step.
import { parseRow } from './row';

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
/** A year-less date up to this many days past is overdue; older means its next occurrence. */
export const OVERDUE_WINDOW_DAYS = 60;
/** Calendar days from `now` to a `Oct 23` / `Feb 1, 2027` date; null when it is not a plain date. */
export function dueDays(due: string | undefined, now = new Date()): number | null {
  const m = due && /^([A-Za-z]{3})[a-z]*\s+(\d{1,2})(?:,\s*(\d{4}))?/.exec(due);
  if (!m) return null;
  const mo = MONTHS.indexOf(m[1].toLowerCase());
  if (mo < 0) return null;
  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const at = (y: number) => Math.round((Date.UTC(y, mo, Number(m[2])) - today) / 864e5);
  if (m[3]) return at(Number(m[3]));
  return [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1].map(at).find((d) => d >= -OVERDUE_WINDOW_DAYS)!;
}
export const HORIZON_DAYS = 14;
const STALE_DAYS = 30;
/** Due-soon tier: 3 overdue/today, 2 within 3 days, 1 within a week or stale (overdue more than 30 days), 0 undated or later. */
export const dueTier = (d: number | null): number => (d === null ? 0 : d < -STALE_DAYS ? 1 : d <= 0 ? 3 : d <= 3 ? 2 : d <= 7 ? 1 : 0);
/** Reply rows (`💬 …`) are messages to an agent, not work. */
export const isMessage = (t: Task): boolean => /^\s*💬/u.test(t.text);
const PRIO: Record<string, number> = { '🚨': 3, '‼️': 2, '🔺': 1, '🔻': -1 };
const vsx = (s: string) => s.replace(/️/g, '');
const PRIO_BY = new Map(Object.entries(PRIO).map(([k, v]) => [vsx(k), v]));

/** A task you could act on now: not a reply, parked, blocked, started later, or due beyond the horizon. */
export function actionable(t: Task, now = new Date()): boolean {
  if (t.done || isMessage(t)) return false;
  const r = parseRow(t.text);
  if (r.suspend || (r.start && (dueDays(r.start, now) ?? 0) > 0)) return false;
  if (/🅿️?/u.test(t.text) || (r.status && vsx(r.status) === '⛔')) return false;
  const d = dueDays(r.due, now);
  return d === null || d <= HORIZON_DAYS;
}

/** Order for the Now lists: due-soon first, then in progress, then priority, then file order (stable). */
export function rankNow(tasks: Task[], now = new Date()): Task[] {
  const key = (t: Task) => {
    const r = parseRow(t.text);
    return [dueTier(dueDays(r.due, now)), r.status && vsx(r.status) === '🚧' ? 1 : 0, r.priority ? PRIO_BY.get(vsx(r.priority)) ?? 0 : 0];
  };
  return tasks.map((t, i) => ({ t, i, k: key(t) }))
    .sort((a, b) => b.k[0] - a.k[0] || b.k[1] - a.k[1] || b.k[2] - a.k[2] || a.i - b.i).map((x) => x.t);
}
