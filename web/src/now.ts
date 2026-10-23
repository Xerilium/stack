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
