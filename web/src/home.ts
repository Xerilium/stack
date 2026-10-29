/**
 * Home = top of the stack: the one thing now, whether it fits the time left, the next two, the top of every project.
 * Pure; the view only draws it.
 * @req FR:web-app/home.one @req FR:web-app/home.fit @req FR:web-app/home.next @req FR:web-app/home.projects
 */
import { actionable, activeTasks, dueDays, isActive, isUpNext, rankNow } from './now';
import { effortMinutes, parseRow } from './row';
import type { NextTask, Project, Task } from './types';

const DEFAULT_MIN = 30;

export interface Countdown { text: string; tone: 'late' | 'soon' | 'calm' }
/** `today`, `tomorrow`, a weekday inside the week, `in n d`, or `n d late`. */
export function countdown(due: string | undefined, now: Date): Countdown | null {
  const d = dueDays(due, now);
  if (d === null) return null;
  if (d < 0) return { text: `${-d} d late`, tone: 'late' };
  if (d === 0) return { text: 'today', tone: 'soon' };
  if (d === 1) return { text: 'tomorrow', tone: 'soon' };
  if (d < 7) return { text: new Date(now.getFullYear(), now.getMonth(), now.getDate() + d).toLocaleDateString('en-US', { weekday: 'short' }), tone: 'calm' };
  return { text: `in ${d} d`, tone: 'calm' };
}

export interface HomeItem { task: Task; minutes: number; assumed: boolean; due: Countdown | null }
export interface HomeProject { project: string; title: string; top: HomeItem; shown: boolean }
export interface Home { one: HomeItem | null; fits: boolean; instead: HomeItem | null; next: HomeItem[]; projects: HomeProject[] }

/** Expected time is the full effort (30 min assumed when unset), never capped: a 3 h task must not "fit" 2 h. */
const item = (t: Task, now: Date): HomeItem => { const r = parseRow(t.text); const est = effortMinutes(r.effort); return { task: t, minutes: est || DEFAULT_MIN, assumed: !est, due: countdown(r.due, now) }; };
const doing = (t: Task) => /🚧/u.test(t.text);

export function homeOf(o: { tasks: Task[]; projects: Project[]; next: NextTask | null; now: Date; minutesLeft: number }): Home {
  const { tasks, now } = o;
  const oneTask = o.next ? tasks.find((t) => t.ref === o.next!.ref) ?? null : null;
  const one = oneTask ? item(oneTask, now) : null;
  const ranked = rankNow(activeTasks(tasks).filter((t) => t.ref !== oneTask?.ref && actionable(t, now)), now, tasks);
  const ordered = [...ranked.filter(doing), ...ranked.filter((t) => !doing(t))];
  const fits = !one || one.minutes <= o.minutesLeft;
  const instead = !fits && o.minutesLeft > 0 ? (ordered.map((t) => item(t, now)).find((i) => i.minutes <= o.minutesLeft) ?? null) : null;
  // Instead never repeats under Up next
  const next = ordered.filter((t) => t.ref !== instead?.task.ref).slice(0, 2).map((t) => item(t, now));
  const shownRefs = new Set([oneTask?.ref, instead?.task.ref, ...next.map((n) => n.task.ref)].filter((r): r is string => !!r));
  // one ranking pass over every active row, then the first per project
  const rankedAll = rankNow(tasks.filter((t) => !t.done && t.depth === 0 && isActive(t) && actionable(t, now)), now, tasks);
  const projects: HomeProject[] = [];
  for (const p of o.projects) {
    const mine = tasks.filter((t) => t.project === p.name && !t.done && t.depth === 0);
    const top = rankedAll.find((t) => t.project === p.name) ?? mine.find(isUpNext) ?? mine[0];
    if (top) projects.push({ project: p.name, title: p.title || p.name, top: item(top, now), shown: shownRefs.has(top.ref) });
  }
  return { one, fits, instead, next, projects };
}
