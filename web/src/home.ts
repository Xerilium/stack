/**
 * Home = top of the stack: the one thing now, whether it fits the time left, the next two, the top of every project.
 * Pure; the view only draws it.
 * @req FR:web-app/home.one @req FR:web-app/home.fit @req FR:web-app/home.next @req FR:web-app/home.projects
 */
import { actionable, activeTasks, dueDays, isUpNext, rankNow } from './now';
import { estimate } from './plan';
import { parseRow } from './row';
import type { NextTask, Project, Task } from './types';

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
export interface HomeProject { project: string; title: string; task?: Task; minutes?: number; assumed?: boolean; due?: Countdown | null; shown: boolean; open: number }
export interface Home { one: HomeItem | null; fits: boolean; instead: HomeItem | null; next: HomeItem[]; projects: HomeProject[] }

const item = (t: Task, now: Date): HomeItem => { const e = estimate(t); return { task: t, minutes: e.minutes, assumed: e.assumed, due: countdown(parseRow(t.text).due, now) }; };
const doing = (t: Task) => /🚧/u.test(t.text);

export function homeOf(o: { tasks: Task[]; projects: Project[]; next: NextTask | null; now: Date; minutesLeft: number }): Home {
  const { tasks, now } = o;
  const oneTask = o.next ? tasks.find((t) => t.ref === o.next!.ref) ?? null : null;
  const one = oneTask ? item(oneTask, now) : null;
  const ranked = rankNow(activeTasks(tasks).filter((t) => t.ref !== oneTask?.ref && actionable(t, now)), now, tasks);
  const ordered = [...ranked.filter(doing), ...ranked.filter((t) => !doing(t))];
  const fits = !one || one.minutes <= o.minutesLeft;
  const instead = !fits && o.minutesLeft > 0 ? (ordered.map((t) => item(t, now)).find((i) => i.minutes <= o.minutesLeft) ?? null) : null;
  const next = ordered.slice(0, 2).map((t) => item(t, now));
  const shownRefs = new Set([oneTask?.ref, ...next.map((n) => n.task.ref)].filter(Boolean) as string[]);
  const projects: HomeProject[] = o.projects.map((p) => {
    const mine = tasks.filter((t) => t.project === p.name && !t.done && t.depth === 0);
    const top = rankNow(mine.filter((t) => activeTasks([t]).length && actionable(t, now)), now, tasks)[0] ?? mine.find(isUpNext) ?? mine[0];
    const i = top ? item(top, now) : undefined;
    return { project: p.name, title: p.title || p.name, task: top, minutes: i?.minutes, assumed: i?.assumed, due: i?.due, shown: !!top && shownRefs.has(top.ref), open: mine.length };
  }).filter((p) => p.task);
  return { one, fits, instead, next, projects };
}
