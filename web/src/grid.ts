/**
 * My day as a grid of equal 30-minute slots. Pure, except the two storage helpers (which take the store).
 * @req FR:my-day-grid/grid.slots @req FR:my-day-grid/grid.meetings @req FR:my-day-grid/grid.tasks @req FR:my-day-grid/grid.free
 */
import { busyIntervals, type CalEvent } from './meetings';
import type { Block, Day, Plan } from './plan';
import { parseRow } from './row';

const titleOf = (t: { text: string }) => parseRow(t.text).title || t.text;

export const SLOT = 30;
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
type Base = { id: string; start: number; end: number; lane: number; lanes: number };
export type GridItem = (Base & { kind: 'meeting'; e: CalEvent }) | (Base & { kind: 'task'; b: Block }) | (Base & { kind: 'email'; count: number });
export interface Grid { from: number; to: number; items: GridItem[] }

/** Wake rounded down and bed rounded up to the slot. */
export const slotRange = (day: Day) => ({ from: Math.floor(day.start / SLOT) * SLOT, to: Math.ceil(day.end / SLOT) * SLOT });

/** `9a`, `12p`; minutes past 24:00 wrap. */
export const labelOf = (m: number) => { const h = Math.floor(m / 60) % 24; return `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`; };

const BLOCKING = new Set(['busy', 'tentative', 'oof']);

/** Each blocking event at its own time, planned tasks, and the email block; overlapping items share lanes. `now` is unused here but kept for symmetry with `freeSlots`. */
export function gridOf(plan: Plan, day: Day, events: CalEvent[]): Grid {
  const { from, to } = slotRange(day);
  const origin = day.origin ?? new Date();
  const raw: GridItem[] = [];
  for (const e of events) {
    if (!BLOCKING.has(e.showAs) || e.cancelled || e.allDay) continue;
    const s = busyIntervals([e], origin, 2)[0];
    if (!s || s.end <= from || s.start >= to) continue;
    raw.push({ kind: 'meeting', id: e.id, start: s.start, end: s.end, e, lane: 0, lanes: 1 });
  }
  for (const b of plan.blocks) raw.push({ kind: 'task', id: b.task.ref, start: b.start, end: b.end, b, lane: 0, lanes: 1 });
  if (plan.email) raw.push({ kind: 'email', id: 'email', start: plan.email.start, end: plan.email.end, count: plan.email.count, lane: 0, lanes: 1 });
  raw.sort((a, b) => a.start - b.start || b.end - a.end);
  // Clusters of overlapping items; inside one, each item takes the first lane that is free at its start.
  let cluster: GridItem[] = [];
  let lanesEnd: number[] = [];
  let clusterEnd = -Infinity;
  const close = () => { for (const i of cluster) i.lanes = lanesEnd.length; cluster = []; lanesEnd = []; };
  for (const it of raw) {
    if (it.start >= clusterEnd) close();
    // An item is drawn at least one slot tall, so it holds its lane that long.
    const end = Math.max(it.end, it.start + SLOT);
    let lane = lanesEnd.findIndex((e) => e <= it.start);
    if (lane < 0) { lane = lanesEnd.length; lanesEnd.push(end); } else lanesEnd[lane] = end;
    it.lane = lane;
    cluster.push(it);
    clusterEnd = Math.max(clusterEnd, end);
  }
  close();
  return { from, to, items: raw };
}

/** Slot starts with no item in them, at or after `now` (all of them when `now` is null). */
export function freeSlots(g: Grid, now: number | null): number[] {
  const out: number[] = [];
  for (let s = g.from; s < g.to; s += SLOT) {
    if (now !== null && s < now) continue;
    if (!g.items.some((i) => i.start < s + SLOT && i.end > s)) out.push(s);
  }
  return out;
}

/* ---- Per-device storage: placements by date, and the Grid/Agenda choice. @req FR:my-day-grid/grid.place @req FR:my-day-grid/view.default ---- */
const PLACED = 'stack.placed';
const VIEW = 'stack.myday.view';
/** A placement keeps the task title too: a ref is a line number, which moves when rows are added above. */
export interface Spot { at: number; title: string }
type Placed = Record<string, Record<string, Spot>>;
const readAll = (s: Store | undefined): Placed => {
  try { const v = JSON.parse(s?.getItem(PLACED) ?? '{}') as unknown; return v && typeof v === 'object' && !Array.isArray(v) ? v as Placed : {}; } catch { return {}; }
};

/** The placements saved for `date` (ref to spot). */
export function loadPlaced(s: Store | undefined, date: string): Record<string, Spot> {
  const d = readAll(s)[date];
  return d && typeof d === 'object' ? Object.fromEntries(Object.entries(d).filter(([, v]) => typeof v?.at === 'number' && typeof v?.title === 'string')) : {};
}

/** Placements as the planner wants them (ref to start): the saved ref when its title still matches, else the open task with that title; else dropped. */
export function resolvePlaced(saved: Record<string, Spot>, tasks: { ref: string; text: string }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [ref, v] of Object.entries(saved)) {
    const t = tasks.find((x) => x.ref === ref && titleOf(x) === v.title) ?? tasks.find((x) => titleOf(x) === v.title);
    if (t) out[t.ref] = v.at;
  }
  return out;
}

/** Places `ref` at `spot` on `date` (null removes it); dates before `today` are dropped. Returns that date's placements. Never throws. */
export function savePlaced(s: Store | undefined, date: string, ref: string, spot: Spot | null, today: string): Record<string, Spot> {
  const all = readAll(s);
  const day = { ...loadPlaced(s, date) };
  if (spot === null) delete day[ref]; else day[ref] = spot;
  const next: Placed = Object.fromEntries(Object.entries({ ...all, [date]: day }).filter(([k, v]) => k >= today && Object.keys(v ?? {}).length));
  try { if (Object.keys(next).length) s?.setItem(PLACED, JSON.stringify(next)); else s?.removeItem(PLACED); } catch { /* storage is a convenience */ }
  return day;
}

export type DayView = 'grid' | 'agenda';
export const loadView = (s: Store | undefined): DayView => { try { return s?.getItem(VIEW) === 'agenda' ? 'agenda' : 'grid'; } catch { return 'grid'; } };
export const saveView = (s: Store | undefined, v: DayView) => { try { s?.setItem(VIEW, v); } catch { /* storage is a convenience */ } };
