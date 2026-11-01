/**
 * Home = top of the stack: the one thing now, whether it fits the time left, the next two, the top of every project.
 * Pure; the view only draws it.
 * @req FR:web-app/home.one @req FR:web-app/home.fit @req FR:web-app/home.next @req FR:web-app/home.projects
 */
import { dueDays, isUpNext } from './now';
import type { Busy } from './meetings';
import { nowMinutes, type Day } from './plan';
import { effortMinutes, parseRow } from './row';
import type { Project, Task } from './types';

const DEFAULT_MIN = 30;

export interface Countdown { text: string; tone: 'late' | 'soon' | 'calm' }
/** `today`, `tomorrow`, a weekday inside the week, `in nd`, or `nd late`. */
export function countdown(due: string | undefined, now: Date): Countdown | null {
  const d = dueDays(due, now);
  if (d === null) return null;
  if (d < 0) return { text: `${-d}d late`, tone: 'late' };
  if (d === 0) return { text: 'today', tone: 'soon' };
  if (d === 1) return { text: 'tomorrow', tone: 'soon' };
  if (d < 7) return { text: new Date(now.getFullYear(), now.getMonth(), now.getDate() + d).toLocaleDateString('en-US', { weekday: 'short' }), tone: 'calm' };
  return { text: `in ${d}d`, tone: 'calm' };
}

export interface HomeItem { task: Task; minutes: number; assumed: boolean; due: Countdown | null }
export interface HomeProject { project: string; title: string; top: HomeItem; shown: boolean }
export interface Home { one: HomeItem | null; fits: boolean; instead: HomeItem | null; next: HomeItem[]; five: HomeItem[]; projects: HomeProject[] }
/** Tasks that fit a 5-minute gap: 15 minutes or less. @req FR:web-app/home2.five */
const FIVE_MAX = 15;

/** Expected time is the full effort (30 min assumed when unset), never capped: a 3 h task must not "fit" 2 h. */
const item = (t: Task, now: Date): HomeItem => { const r = parseRow(t.text); const est = effortMinutes(r.effort); return { task: t, minutes: est || DEFAULT_MIN, assumed: !est, due: countdown(r.due, now) }; };
const doing = (t: Task) => /🚧/u.test(t.text);

/** One ranked task from `GET /rank`: a leaf names the top-level row it sits under. @req FR:task-lifecycle/rank.output */
export interface RankItem { ref: string; text: string; project: string; score: number; rule?: string; root?: string }

/**
 * Home draws what the server ranked, in that order (a leaf shows as its top-level row), minus what is already in
 * Needs you; it never ranks anything itself, so Home, `GET /next`, `stack next` and stack.md agree.
 * @req FR:web-app/now.active
 * @req FR:web-app/home3.dedupe
 * @req FR:ask-queue/needs.dedupe
 */
export function homeOf(o: { tasks: Task[]; projects: Project[]; ranked: RankItem[]; /** Refs shown in Needs you: held back from Home. */ exclude?: Set<string>; now: Date; minutesLeft: number; /** Only rows that belong to the personal block (its emoji or its projects) may use the time. @req FR:home/home.window @req FR:home/day.blocks */ allow?: { emoji: string; projects?: string[] } }): Home {
  const { tasks, now } = o;
  const byRef = new Map(tasks.map((t) => [t.ref, t]));
  const hidden = o.exclude ?? new Set<string>();
  const seen = new Set<string>();
  const rows: Task[] = [];
  for (const r of o.ranked) {
    const t = byRef.get(r.root ?? r.ref);
    if (!t || t.done || seen.has(t.ref) || hidden.has(t.ref) || hidden.has(r.ref)) continue;
    seen.add(t.ref); rows.push(t);
  }
  // NOW is the server's first; under it, in-progress (🚧) rows come first, then the server's order.
  const oneTask = rows[0] ?? null;
  const tail = rows.slice(1);
  const rest = [...tail.filter(doing), ...tail.filter((t) => !doing(t))];
  const ordered = oneTask ? [oneTask, ...rest] : [];
  const one = oneTask ? item(oneTask, now) : null;
  const vs = (s: string) => s.replace(/\uFE0F/g, '');
  const may = (i: HomeItem) => !o.allow || vs(i.task.text).includes(vs(o.allow.emoji)) || !!o.allow.projects?.includes(i.task.project);
  const fits = !one || (one.minutes <= o.minutesLeft && may(one));
  const instead = !fits && o.minutesLeft > 0 ? (rest.map((t) => item(t, now)).find((i) => i.minutes <= o.minutesLeft && may(i)) ?? null) : null;
  // Instead never repeats under Up next
  const next = rest.filter((t) => t.ref !== instead?.task.ref).slice(0, 2).map((t) => item(t, now));
  const shownRefs = new Set([oneTask?.ref, instead?.task.ref, ...next.map((n) => n.task.ref)].filter((r): r is string => !!r));
  // a short task for a short gap, ranked, never one already on screen
  const five = rest.filter((t) => !shownRefs.has(t.ref)).map((t) => item(t, now)).filter((i) => !i.assumed && i.minutes <= FIVE_MAX).slice(0, 3);
  five.forEach((f) => shownRefs.add(f.task.ref));
  // projects in the order of their top ranked row. @req FR:web-app/home2.order
  const rankOf = new Map(ordered.map((t, i) => [t.ref, i]));
  const projects: HomeProject[] = [];
  for (const p of o.projects) {
    const mine = tasks.filter((t) => t.project === p.name && !t.done && t.depth === 0 && !hidden.has(t.ref));
    // No arbitrary first row as a fallback: the server may have hidden it (a hide rule). @req FR:web-app/home.projects
    const top = ordered.find((t) => t.project === p.name) ?? mine.find(isUpNext);
    if (top) projects.push({ project: p.name, title: p.title || p.name, top: item(top, now), shown: shownRefs.has(top.ref) });
  }
  projects.sort((a, b) => (rankOf.get(a.top.task.ref) ?? Infinity) - (rankOf.get(b.top.task.ref) ?? Infinity));
  return { one, fits, instead, next, five, projects };
}

// ---- The window: how long you have now, from the schedule and the calendar.

/** "I have" picks, in minutes (keys h then 1-4). */
export const HAVE = [15, 30, 60, 120];

export interface Window {
  /** Minutes you have now. */ minutes: number;
  /** Set from "I have N min". */ have?: boolean;
  /** The commitment that ends the window. */ until?: { kind: 'meeting' | 'personal' | 'bed'; label: string; at: number };
  /** You are in a meeting, personal time, or asleep (or past bed) until `until`. */ inside?: { kind: 'meeting' | 'personal' | 'sleep'; label: string; until: number };
  /** In personal time, tasks tagged with the block's emoji may use the rest of it. */ allow?: { emoji: string; projects?: string[]; minutes: number };
}

const labelOf = (b: { name: string; label?: string }) => b.label ?? b.name;

/** Minutes until the next meeting, personal block, or bed; or what you are inside now. `have` overrides. @req FR:home/home.window @req FR:home/home.have */
export function windowNow(day: Day, busy: Busy[], now: Date, have?: number | null): Window {
  const at = nowMinutes(now, day);
  const personal = (day.blocks ?? []).filter((b) => b.kind === 'personal');
  const nextUp: NonNullable<Window['until']>[] = [
    ...busy.filter((m) => m.start > at).map((m) => ({ kind: 'meeting' as const, label: m.titles[0] ?? 'Meeting', at: m.start })),
    ...personal.filter((b) => b.start > at).map((b) => ({ kind: 'personal' as const, label: labelOf(b), at: b.start })),
    { kind: 'bed' as const, label: day.origin ? 'bed' : 'end of day', at: day.end },
  ];
  const until = nextUp.filter((x) => x.at > at).sort((a, b) => a.at - b.at)[0];
  if (have != null) return { minutes: Math.max(0, have), have: true, ...(until ? { until } : {}) };
  if (day.asleep || at < day.start) return { minutes: 0, inside: { kind: 'sleep', label: 'Sleep', until: day.start } };
  // Past bed: back at the next wake (the same clock time tomorrow until the schedule refetches).
  if (at >= day.end) return { minutes: 0, inside: { kind: 'sleep', label: day.origin ? 'Past bed' : 'After hours', until: day.start + 1440 } };
  const m = busy.find((x) => x.start <= at && at < x.end);
  if (m) return { minutes: 0, inside: { kind: 'meeting', label: m.titles[0] ?? 'Meeting', until: m.end } };
  const p = personal.find((b) => b.start <= at && at < b.end);
  // Tagged tasks may use the block up to its end or the next meeting, whichever is first.
  if (p) return { minutes: 0, inside: { kind: 'personal', label: labelOf(p), until: p.end }, allow: { emoji: p.emoji, ...(p.projects?.length ? { projects: p.projects } : {}), minutes: Math.min(p.end, ...busy.filter((x) => x.start > at).map((x) => x.start)) - at } };
  return { minutes: Math.max(0, (until?.at ?? day.end) - at), ...(until ? { until } : {}) };
}
