/** My day grid: slots, blocks, lanes, free slots, placements, view pref. */
import { describe, expect, it } from 'vitest';
import { freeSlots, gridOf, labelOf, loadPlaced, loadView, resolvePlaced, savePlaced, saveView, slotRange, SLOT } from '../src/grid';
import { buildPlan, type Day } from '../src/plan';
import type { CalEvent } from '../src/meetings';
import type { Task } from '../src/types';

const origin = new Date(2026, 10, 12);
const iso = (h: number, m = 0) => new Date(2026, 10, 12, h, m).toISOString();
const ev = (id: string, h: number, m: number, h2: number, m2: number, o: Partial<CalEvent> = {}): CalEvent => ({ id, subject: id, start: iso(h, m), end: iso(h2, m2), allDay: false, showAs: 'busy', cancelled: false, online: false, ...o });
const day: Day = { start: 8 * 60 + 15, end: 18 * 60 + 10, origin, blocks: [{ name: 'Family', emoji: '🏠', kind: 'personal', start: 17 * 60, end: 18 * 60 }] };
const task = (ref: string, text: string): Task => ({ ref, text, project: 'p', section: '🔄 Active', done: false, depth: 0, notes: [] } as unknown as Task);
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }; };

describe('grid slots', () => {
  // @req FR:my-day-grid/grid.slots
  it('runs from wake rounded down to bed rounded up, in equal 30-minute slots', () => {
    expect(SLOT).toBe(30);
    expect(slotRange(day)).toEqual({ from: 8 * 60, to: 18 * 60 + 30 });
    expect(labelOf(9 * 60)).toBe('9a');
    expect(labelOf(12 * 60)).toBe('12p');
    expect(labelOf(25 * 60)).toBe('1a');
  });
});

describe('grid blocks', () => {
  const plan = buildPlan([task('p:1', 'Write deck 🟡')], new Date(2026, 10, 12, 10), day, 300, { busy: [] });
  // @req FR:my-day-grid/grid.meetings
  it('draws each blocking event at its own time; drops free, cancelled, and all-day events', () => {
    const g = gridOf(plan, day, [ev('a', 9, 0, 10, 0), ev('free', 11, 0, 12, 0, { showAs: 'free' }), ev('gone', 11, 0, 12, 0, { cancelled: true }), ev('ad', 0, 0, 23, 59, { allDay: true })]);
    const m = g.items.filter((i) => i.kind === 'meeting');
    expect(m.map((i) => [i.id, i.start, i.end])).toEqual([['a', 540, 600]]);
  });
  it('puts overlapping blocks side by side', () => {
    const g = gridOf({ ...plan, blocks: [] }, day, [ev('a', 9, 0, 10, 0), ev('b', 9, 30, 10, 30), ev('c', 11, 0, 11, 30)]);
    const by = Object.fromEntries(g.items.map((i) => [i.id, [i.lane, i.lanes]]));
    expect(by).toEqual({ a: [0, 2], b: [1, 2], c: [0, 1] });
  });
  // @req FR:my-day-grid/grid.tasks
  it('draws planned tasks at their start with their estimate', () => {
    const g = gridOf(plan, day, []);
    const t = g.items.find((i) => i.kind === 'task');
    expect(t && [t.start, t.end]).toEqual([600, 660]);
  });
  // @req FR:my-day-grid/grid.free
  it('free slots: empty, inside the day, not past', () => {
    const g = gridOf(plan, day, [ev('a', 11, 0, 11, 45)]);
    const free = freeSlots(g, 10 * 60 + 10);
    expect(free).not.toContain(570); // past
    expect(free).not.toContain(660);
    expect(free).not.toContain(690); // the meeting runs to 11:45
    expect(free).not.toContain(600); // the task
    expect(free).toContain(720);
    expect(free.at(-1)).toBe(18 * 60);
  });
});

describe('placements', () => {
  // @req FR:my-day-grid/grid.place
  it('the planner books a placed task at its time first', () => {
    const ts = [task('p:1', 'First 🟢'), task('p:2', 'Second 🟢')];
    const plan = buildPlan(ts, new Date(2026, 10, 12, 10), day, 300, { busy: [], fixed: { 'p:2': 14 * 60 } });
    expect(plan.blocks.map((b) => [b.task.ref, b.start])).toEqual([['p:1', 600], ['p:2', 840]]);
    expect(plan.blocks.find((b) => b.task.ref === 'p:2')?.placed).toBe(true);
  });
  it('a placement in the past is ignored', () => {
    const plan = buildPlan([task('p:1', 'First 🟢')], new Date(2026, 10, 12, 10), day, 300, { busy: [], fixed: { 'p:1': 9 * 60 } });
    expect(plan.blocks[0].start).toBe(600);
    expect(plan.blocks[0].placed).toBeFalsy();
  });
  it('a placed task is booked even over Available', () => {
    const plan = buildPlan([task('p:1', 'Big 🟠')], new Date(2026, 10, 12, 10), day, 30, { busy: [], fixed: { 'p:1': 12 * 60 } });
    expect(plan.blocks.map((b) => b.start)).toEqual([720]);
    expect(plan.overflow).toEqual([]);
  });
  it('saves per date, drops older dates, survives broken storage', () => {
    const s = mem();
    expect(savePlaced(s, '2026-11-11', 'p:1', { at: 600, title: 'A' }, '2026-11-11')).toEqual({ 'p:1': { at: 600, title: 'A' } });
    savePlaced(s, '2026-11-12', 'p:2', { at: 840, title: 'B' }, '2026-11-12');
    expect(loadPlaced(s, '2026-11-12')).toEqual({ 'p:2': { at: 840, title: 'B' } });
    expect(resolvePlaced(loadPlaced(s, '2026-11-12'), [{ ref: 'p:3', text: 'B' }])).toEqual({ 'p:3': 840 }); // the row moved
    expect(resolvePlaced(loadPlaced(s, '2026-11-12'), [{ ref: 'p:2', text: 'C' }])).toEqual({}); // another task took the line
    expect(loadPlaced(s, '2026-11-11')).toEqual({}); // pruned
    expect(savePlaced(s, '2026-11-12', 'p:2', null, '2026-11-12')).toEqual({});
    const broken = { getItem: () => { throw new Error('x'); }, setItem: () => { throw new Error('x'); }, removeItem: () => { throw new Error('x'); } };
    expect(loadPlaced(broken, '2026-11-12')).toEqual({});
    expect(() => savePlaced(broken, '2026-11-12', 'p:1', { at: 600, title: 'A' }, '2026-11-12')).not.toThrow();
    s.m.set('stack.placed', '{bad');
    expect(loadPlaced(s, '2026-11-12')).toEqual({});
  });
});

describe('view pref', () => {
  // @req FR:my-day-grid/view.default
  it('defaults to grid and remembers agenda', () => {
    const s = mem();
    expect(loadView(s)).toBe('grid');
    saveView(s, 'agenda');
    expect(loadView(s)).toBe('agenda');
    expect(loadView(undefined)).toBe('grid');
    s.m.set('stack.myday.view', 'weird');
    expect(loadView(s)).toBe('grid');
  });
});

describe('short items', () => {
  it('a 15-minute item holds its lane for a whole slot, so the next one sits beside it', () => {
    const p = buildPlan([], new Date(2026, 10, 12, 10), day, 0, { busy: [] });
    const g = gridOf(p, day, [ev('a', 9, 0, 9, 15), ev('b', 9, 15, 9, 30)]);
    expect(g.items.map((i) => [i.id, i.lane, i.lanes])).toEqual([['a', 0, 2], ['b', 1, 2]]);
  });
});
