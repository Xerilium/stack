/**
 * The owner's priorities as plain tables: Now (top 3), Promote to Autopilot (PRs), Today, Next 3 days. One row per priority
 * with its project, agent and next action; one row per PR ready for Autopilot. Each row and table is stamped with its last
 * live check. Pure: the caller reads the stores and hands them in.
 * @req FR:priorities-tables/rows.@function @req FR:priorities-tables/rows.input @req FR:priorities-tables/rows.output @req FR:priorities-tables/$view
 */
import type { NextAction, PrDetail } from './pr-board';
import type { Pri, PriDay, PriWindow } from './pris';
import { linker, priAction, priOrder } from './pris-rank';

/** One PR board row, as the view needs it. `specLines` is the changed spec lines (null when unknown). */
export interface BoardRowInput { url: string; repo: string; number: number; title: string; project: string; nextAction: NextAction | null; specLines?: number | null }
/** The PR board: `at` is the last good poll (null before the first). */
export interface BoardInput { at: string | null; rows: BoardRowInput[] }
/** The session inventory: `at` is its last read. */
export interface SessionsInput { at: string; sessions: { id: string; title: string; link: string }[] }
export interface ViewInput { pris: Pri[]; now: Date; timeZone?: string; sessions?: SessionsInput; board?: BoardInput }

export interface PriRow { id: string; project: string; agent: { name: string; link: string } | null; action: string; at: string; stale: boolean }
export interface PriTable { at: string; stale: boolean; rows: PriRow[] }
export interface PrRow { project: string; number: number; url: string; title: string; at: string; stale: boolean }
export interface PrTable { at: string; stale: boolean; rows: PrRow[] }
export interface PrioritiesView { at: string; now: PriTable; autopilot: PrTable; today: PriTable; next: PriTable }

const NOW_ROWS = 3;
const NEXT_DAYS = 3;
const WORDS = 20;
const STALE_MS = 30 * 60_000;
const DAY_MS = 86_400_000;
const NONE = '--';

/**
 * At most 20 words; a cut cell ends with an ellipsis.
 * @req FR:priorities-tables/rows.words
 */
export function cut(s: string, n = WORDS): string {
  const w = s.trim().split(/\s+/).filter(Boolean);
  return w.length <= n ? w.join(' ') : `${w.slice(0, n).join(' ')}…`;
}

/** Weekday and minute of the day of `at` in `timeZone`. */
function wall(at: Date, timeZone?: string): { day: PriDay; min: number } {
  const parts = new Intl.DateTimeFormat('en-US', { weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...(timeZone ? { timeZone } : {}) }).formatToParts(at);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return { day: get('weekday').toLowerCase().slice(0, 3) as PriDay, min: Number(get('hour')) * 60 + Number(get('minute')) };
}
const mins = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3));
/** `15:00` to `3 PM`, `15:30` to `3:30 PM`. */
export function clockText(hhmm: string): string {
  const h = Number(hhmm.slice(0, 2)); const m = hhmm.slice(3);
  return `${h % 12 || 12}${m === '00' ? '' : `:${m}`} ${h < 12 ? 'AM' : 'PM'}`;
}
const dayName = (d: PriDay) => `${d[0].toUpperCase()}${d.slice(1)}`;
const onDay = (w: PriWindow, d: PriDay) => !w.days || w.days.includes(d);

type Today = { state: 'open' } | { state: 'later'; from: string } | { state: 'past' };
/** Whether a priority is open now, opens later today, or is done for today. @req FR:priorities-tables/order.window @req FR:priorities-tables/order.window.day @req FR:priorities-tables/order.window.edge */
function todayOf(p: Pri, day: PriDay, min: number): Today {
  if (!p.windows?.length) return { state: 'open' };
  let later: string | undefined;
  for (const w of p.windows.filter((x) => onDay(x, day))) {
    const from = w.from ? mins(w.from) : 0; const to = w.to ? mins(w.to) : 1440;
    if (from <= min && min < to) return { state: 'open' };
    if (from > min && (!later || w.from! < later)) later = w.from!;
  }
  return later ? { state: 'later', from: later } : { state: 'past' };
}

/**
 * The project name: the label, else the title before the first parenthesis.
 * @req FR:priorities-tables/rows.project
 */
const projectOf = (p: Pri) => cut(p.label ?? (p.title.split('(')[0].trim() || p.title));
/**
 * The fixed `action`, else the note action, else the first doing item, then the first todo item.
 * @req FR:priorities-tables/rows.action @req FR:priorities-tables/rows.action.fixed @req FR:priorities-tables/rows.action.item @req FR:priorities-tables/rows.action.none
 */
const actionOf = (p: Pri): string | undefined => p.action ?? priAction(p) ?? (p.items.find((i) => i.status === 'doing') ?? p.items.find((i) => i.status === 'todo'))?.text;

const stamp = (now: Date, times: number[]) => { const at = Math.min(now.getTime(), ...times.filter((t) => !Number.isNaN(t))); return { at: new Date(at).toISOString(), stale: now.getTime() - at > STALE_MS }; };

/**
 * PRs ready for Autopilot (next action `Enable Autopilot`): fewest changed spec lines first, then board order. The project is
 * the priority the PR links to, else the repo name. Stale without a good board poll.
 * @req FR:priorities-tables/pr.pick @req FR:priorities-tables/pr.order @req FR:priorities-tables/pr.project @req FR:priorities-tables/pr.stale
 */
function autopilotOf(pris: Pri[], now: Date, board?: BoardInput): PrTable {
  const link = linker(pris);
  const byId = new Map(pris.map((p) => [p.id, p]));
  const ok = !!board?.at;
  const s = ok ? stamp(now, [Date.parse(board!.at!)]) : { at: now.toISOString(), stale: true };
  const lines = (r: BoardRowInput) => (typeof r.specLines === 'number' ? r.specLines : Infinity);
  const rows = (board?.rows ?? []).map((r, i) => ({ r, i })).filter(({ r }) => r.nextAction === 'autopilot')
    .sort((a, b) => lines(a.r) - lines(b.r) || a.i - b.i)
    .map(({ r }): PrRow => {
      const l = link({ text: `${r.title} ${r.url} ${r.repo}#${r.number}`, project: r.project, aliases: [] });
      const p = l ? byId.get(l.id) : undefined;
      return { project: p ? projectOf(p) : r.repo.split('/').pop() ?? r.repo, number: r.number, url: r.url, title: cut(r.title), ...s };
    });
  return { ...s, rows };
}

/**
 * The tables. Priority rows follow the day order; Now holds the first 3 open priorities, Today the rest of today, Next 3
 * days the priorities that come up on the next 3 days and not today.
 * @req FR:priorities-tables/rows.status @req FR:priorities-tables/order.day @req FR:priorities-tables/order.now @req FR:priorities-tables/order.today
 * @req FR:priorities-tables/order.today.later @req FR:priorities-tables/order.today.past @req FR:priorities-tables/order.next @req FR:priorities-tables/order.next.when @req FR:priorities-tables/order.next.sort
 */
export function prioritiesView(input: ViewInput): PrioritiesView {
  const { now, timeZone, sessions, board } = input;
  const pris = input.pris.filter((p) => p.status === 'active' || p.status === 'blocked');

  /** @req FR:priorities-tables/agent.link @req FR:priorities-tables/agent.none @req FR:priorities-tables/fresh.row @req FR:priorities-tables/fresh.stale */
  const rowOf = (p: Pri, when?: string): PriRow => {
    const s = p.session ? sessions?.sessions.find((x) => x.id === p.session) : undefined;
    const action = actionOf(p);
    return {
      id: p.id, project: projectOf(p), agent: s ? { name: cut(s.title), link: s.link } : null,
      action: cut(`${when ?? ''}${action ?? NONE}`),
      ...stamp(now, s ? [Date.parse(sessions!.at)] : []),
    };
  };
  /** @req FR:priorities-tables/fresh.table */
  const table = (rows: PriRow[]): PriTable => ({ ...stamp(now, rows.map((r) => Date.parse(r.at))), rows });

  const { day, min } = wall(now, timeZone);
  const open: PriRow[] = []; const today: PriRow[] = [];
  const shown = new Set<string>();
  for (const p of priOrder(pris, now, timeZone)) {
    const t = todayOf(p, day, min);
    if (t.state === 'past') continue;
    shown.add(p.id);
    if (t.state === 'open' && open.length < NOW_ROWS) open.push(rowOf(p));
    else today.push(rowOf(p, t.state === 'later' ? `${clockText(t.from)}: ` : undefined));
  }
  const next: PriRow[] = [];
  for (let d = 1; d <= NEXT_DAYS; d++) {
    const at = new Date(now.getTime() + d * DAY_MS);
    const dd = wall(at, timeZone).day;
    for (const p of priOrder(pris, at, timeZone)) {
      if (shown.has(p.id)) continue;
      // The earliest window of that day gives the start time.
      const w = p.windows?.length ? p.windows.filter((x) => onDay(x, dd)).sort((a, b) => (a.from ?? '') < (b.from ?? '') ? -1 : 1)[0] : {};
      if (!w) continue;
      shown.add(p.id);
      next.push(rowOf(p, `${dayName(dd)}${w.from ? ` ${clockText(w.from)}` : ''}: `));
    }
  }
  return { at: now.toISOString(), now: table(open), autopilot: autopilotOf(pris, now, board), today: table(today), next: table(next) };
}

/** The PR board as the view needs it: rows and the last good poll. */
export function boardInput(b: { at: string | null; rows: (BoardRowInput & { detail?: PrDetail })[] }): BoardInput {
  return { at: b.at, rows: b.rows.map(({ url, repo, number, title, project, nextAction, specLines }) => ({ url, repo, number, title, project, nextAction, specLines: specLines ?? null })) };
}

/** `11:00 AM` in `timeZone`. */
export function timeText(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit', ...(timeZone ? { timeZone } : {}) }).format(new Date(iso)).replace(/\s/g, ' ');
}
