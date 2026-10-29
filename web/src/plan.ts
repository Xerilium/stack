import { actionable, children, dueDays, isActive, isMessage, rankNow } from './now';
import { effortMinutes, parseRow } from './row';
import type { Task } from './types';
import { emailMinutes, type Busy } from './meetings';

/** Day plan and decisions. Pure; the views only draw it. @req FR:web-app/today.plan @req FR:web-app/today.fit @req FR:web-app/today.needs */
export interface Day { start: number; end: number } // minutes after midnight
export const DEFAULT_DAY: Day = { start: 9 * 60, end: 18 * 60 };
export interface Block { task: Task; start: number; end: number; partial: boolean; assumed: boolean }
/** `left`: work day left; `budget`: minutes you have; `free`: budget not booked; `short`: minutes the left-out tasks need; `assumed`: blocks using the default estimate. */
/** `atRisk`: left-out tasks due today, late by 30 days or less, or in progress (listed first in `overflow`); `riskShort`: minutes they need. */
export interface Plan { meetings: Busy[]; email?: { start: number; end: number; count: number }; blocks: Block[]; overflow: Task[]; atRisk: Task[]; left: number; busy: number; budget: number; free: number; short: number; riskShort: number; assumed: number }

const MAX_BLOCK = 120;
const DEFAULT_MIN = 30;

/** Open rows with no open row below them: the things you actually do. */
export function openLeaves(tasks: Task[]): Task[] {
  const out: Task[] = [];
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (t.done) continue;
    let open = false;
    for (let k = i + 1; k < tasks.length && tasks[k].project === t.project && tasks[k].depth > t.depth; k++) if (!tasks[k].done) { open = true; break; }
    if (!open) out.push(t);
  }
  return out;
}

const whoOf = (t: Task) => parseRow(t.text).who;

/** Tasks for the plan: yours (not an agent's, not a decision), active, actionable, leaf, ranked. */
export function planCandidates(tasks: Task[], now: Date, first?: string): Task[] {
  const mine = openLeaves(tasks).filter((t) => isActive(t) && actionable(t, now) && !whoOf(t));
  const ranked = rankNow(mine, now, tasks);
  const head = first ? ranked.filter((t) => t.ref === first) : [];
  return [...head, ...ranked.filter((t) => t.ref !== first)];
}

const round15 = (m: number) => Math.ceil(m / 15) * 15;

/** Minutes a task books: its effort (30 min assumed when unset), capped at 2 h. */
export function estimate(t: Task): { minutes: number; assumed: boolean; partial: boolean } {
  const est = effortMinutes(parseRow(t.text).effort);
  return { minutes: Math.min(est || DEFAULT_MIN, MAX_BLOCK), assumed: !est, partial: est > MAX_BLOCK };
}

/** Due today, late by 30 days or less (older is stale), or in progress. */
export function atRiskTask(t: Task, now: Date): boolean {
  const r = parseRow(t.text);
  const d = dueDays(r.due, now);
  return (d !== null && d <= 0 && d >= -30) || (!!r.status && r.status.replace(/\uFE0F/g, '') === '🚧');
}

/** First bookable minute: now rounded up to 15, never before the work day starts. */
export const planStart = (now: Date, day: Day = DEFAULT_DAY) => Math.max(day.start, round15(now.getHours() * 60 + now.getMinutes()));

/**
 * Packs candidates in rank order into `budget` minutes from the plan start (default: what is left of the work day).
 * A task that does not fit is skipped and later, smaller ones may still fit.
 */
export function buildPlan(candidates: Task[], now: Date, day: Day = DEFAULT_DAY, budget?: number, opts: { busy?: Busy[]; email?: number } = {}): Plan {
  const start = planStart(now, day);
  const left = Math.max(0, day.end - start);
  const cap = Math.max(0, budget ?? left);
  const meetings = (opts.busy ?? []).filter((m) => m.end > start);
  const taken: [number, number][] = meetings.map((m) => [m.start, m.end]);
  /** First free slot at or after the plan start that holds `m` minutes (first fit, so a short task fills the gap before a meeting). */
  const slot = (m: number): number | null => {
    let t = start;
    for (const [a, b] of [...taken].sort((x, y) => x[0] - y[0])) {
      if (t + m <= a) break;
      if (b > t) t = b;
    }
    return t + m <= 24 * 60 ? t : null;
  };
  let booked = 0;
  let email: Plan['email'];
  const em = emailMinutes(opts.email ?? 0);
  if (em > 0 && em <= cap) {
    const t = slot(em);
    if (t !== null) { email = { start: t, end: t + em, count: opts.email! }; taken.push([t, t + em]); booked += em; }
  }
  const blocks: Block[] = [];
  const overflow: Task[] = [];
  let short = 0;
  for (const t of candidates) {
    const e = estimate(t);
    const at = booked + e.minutes <= cap ? slot(e.minutes) : null;
    if (at === null) { overflow.push(t); short += e.minutes; continue; }
    blocks.push({ task: t, start: at, end: at + e.minutes, partial: e.partial, assumed: e.assumed });
    taken.push([at, at + e.minutes]);
    booked += e.minutes;
  }
  blocks.sort((x, y) => x.start - y.start);
  const atRisk = overflow.filter((t) => atRiskTask(t, now));
  const rest = overflow.filter((t) => !atRisk.includes(t));
  const riskShort = atRisk.reduce((m, t) => m + estimate(t).minutes, 0);
  return { meetings, ...(email ? { email } : {}), blocks, overflow: [...atRisk, ...rest], atRisk, left, busy: booked, budget: cap, free: cap - booked, short, riskShort, assumed: blocks.filter((b) => b.assumed).length };
}

export const clock = (m: number) => { const h = Math.floor(m / 60) % 24; return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')}${h < 12 ? 'a' : 'p'}`; };
export const span = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ''}` : `${m}m`);

const strip = (s: string) => s.replace(/^\s*>\s?/, '').replace(/\*\*/g, '').replace(/\s+/g, ' ').trim();
const ancestorsOf = (tasks: Task[], t: Task): Task[] => {
  const out: Task[] = [];
  let want = t.depth;
  for (let i = tasks.findIndex((x) => x.ref === t.ref) - 1; i >= 0 && want > 0; i--) {
    if (tasks[i].project !== t.project) break;
    if (tasks[i].depth < want) { out.push(tasks[i]); want = tasks[i].depth; }
  }
  return out;
};

export interface Decision { task: Task; context?: Task; recommendation?: string }

/** The recommendation an agent left: a note line mentioning "recommend" on the row, its parent, or a sibling. */
export function recommendationOf(tasks: Task[], t: Task): string | undefined {
  const scope = [t, ...ancestorsOf(tasks, t)];
  const par = scope[1];
  const sibs = par ? tasks.filter((x) => x.project === t.project && x.depth === t.depth && ancestorsOf(tasks, x)[0]?.ref === par.ref) : [];
  for (const row of [...scope, ...sibs]) {
    const notes = row.notes.map(strip);
    const at = notes.findIndex((n) => /recommend/i.test(n));
    if (at < 0) continue;
    let text = notes[at].replace(/^(my )?(recommendation|recommended path|recommend)\s*(for [^:]+)?:?\s*/i, '').trim();
    if (text === '' || /:$/.test(text)) text = [text, ...notes.slice(at + 1).filter((x) => x !== '')].slice(0, 2).join(' ').trim();
    return text || notes[at];
  }
  return undefined;
}

const doing = (t: Task) => parseRow(t.text).status?.replace(/️/g, '') === '🚧';
/** A 🙋 row with an open 💬 reply under it is answered: the agent has its decision. */
const answered = (tasks: Task[], t: Task) => children(tasks, t.ref).some((c) => !c.done && isMessage(c));

/** Open 🙋 rows in active work (an Active section, or under a row in progress): what only you can do or decide. */
export function decisions(tasks: Task[], now: Date): Decision[] {
  const rows = tasks.filter((t) => !t.done && whoOf(t) === 'human' && actionable(t, now) && !answered(tasks, t) && (isActive(t) || ancestorsOf(tasks, t).some(doing)));
  const withParent = rows.map((t) => ({ task: t, context: ancestorsOf(tasks, t)[0], recommendation: recommendationOf(tasks, t) }));
  const ranked = rankNow(rows, now, tasks);
  return ranked.map((r) => withParent.find((x) => x.task.ref === r.ref)!);
}
