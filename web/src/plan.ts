import { actionable, children, isActive, isMessage, rankNow } from './now';
import { effortMinutes, parseRow } from './row';
import type { Task } from './types';

/** Day plan, agent work, and decisions. Pure; the views only draw it. @req FR:web-app/today.plan @req FR:web-app/today.needs @req FR:web-app/today.agents */
export interface Day { start: number; end: number } // minutes after midnight
export const DEFAULT_DAY: Day = { start: 9 * 60, end: 18 * 60 };
export interface Block { task: Task; start: number; end: number; partial: boolean }
export interface Plan { blocks: Block[]; overflow: Task[]; left: number; busy: number }

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

/** Pack candidates into what is left of the day, in order; what does not fit goes to `overflow`. */
export function buildPlan(candidates: Task[], now: Date, day: Day = DEFAULT_DAY): Plan {
  const nowMin = now.getHours() * 60 + now.getMinutes();
  let cur = Math.max(day.start, round15(nowMin));
  const blocks: Block[] = [];
  const overflow: Task[] = [];
  for (const t of candidates) {
    const est = effortMinutes(parseRow(t.text).effort) || DEFAULT_MIN;
    const minutes = Math.min(est, MAX_BLOCK);
    if (cur + minutes > day.end) { overflow.push(t); continue; }
    blocks.push({ task: t, start: cur, end: cur + minutes, partial: est > MAX_BLOCK });
    cur += minutes;
  }
  return { blocks, overflow, left: Math.max(0, day.end - Math.max(day.start, round15(nowMin))), busy: blocks.reduce((s, b) => s + (b.end - b.start), 0) };
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

export type AgentState = 'working' | 'waiting' | 'queued';
export interface AgentItem { task: Task; state: AgentState }

/** Open agent rows (🤖/🪄) in active work and what each is doing. */
export function agentWork(tasks: Task[], now: Date): AgentItem[] {
  const out: AgentItem[] = [];
  tasks.forEach((t, i) => {
    if (t.done || whoOf(t) !== 'agent' || !actionable(t, now)) return;
    const working = doing(t);
    if (!isActive(t) && !working) return;
    const parent = ancestorsOf(tasks, t)[0];
    const asks = (x: Task) => !x.done && whoOf(x) === 'human' && !answered(tasks, x);
    // waiting: a 🙋 in its own subtree, or a later 🙋 sibling under the same parent
    const waits = children(tasks, t.ref).some(asks)
      || (!!parent && tasks.some((x, k) => k > i && x.project === t.project && x.depth === t.depth && asks(x) && ancestorsOf(tasks, x)[0]?.ref === parent.ref));
    out.push({ task: t, state: working ? 'working' : waits ? 'waiting' : 'queued' });
  });
  const order: Record<AgentState, number> = { working: 0, waiting: 1, queued: 2 };
  return out.sort((a, b) => order[a.state] - order[b.state]);
}
