/** @req FR:home/day.frame @req FR:home/day.personal @req FR:home/day.available @req FR:home/day.calendar @req FR:home/day.asleep */
import { describe, expect, it } from 'vitest';
import { budgetOf } from '../src/day';
import { busyIntervals, type CalEvent } from '../src/meetings';
import { buildPlan, clock, DEFAULT_DAY, planStart } from '../src/plan';
import { calendarRange, dayFrame, needsRefresh, wallMinutes, type DaySched } from '../src/schedule';
import type { Task } from '../src/types';

const L = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m); // local Oct d
const iso = (d: number, h: number, m = 0) => L(d, h, m).toISOString();
let n = 0;
const t = (text: string): Task => ({ ref: `a:${++n}`, text, project: 'a', section: '🔄 Active', done: false, depth: 0, notes: [] });

// Wed Oct 28: wake 8:00, Work 8-16, Family 16-20 (personal), Shichael 20-23 (personal), Project 23-02, bed 2:00.
const wed: DaySched = {
  timezone: 'America/Los_Angeles', date: '2026-10-28', wake: iso(28, 8), bed: iso(29, 2), asleep: false,
  blocks: [
    { name: 'Work', emoji: '☀️', kind: 'focus', start: iso(28, 8), end: iso(28, 16) },
    { name: 'Family evening', label: 'Family', emoji: '🏠', kind: 'personal', start: iso(28, 16), end: iso(28, 20) },
    { name: 'Shichael', emoji: '💕', kind: 'personal', start: iso(28, 20), end: iso(28, 23) },
    { name: 'Project', emoji: '🌙', kind: 'focus', start: iso(28, 23), end: iso(29, 2) },
  ],
};

describe('day frame', () => {
  it('measures wall-clock minutes from the day\'s local midnight, past 24:00', () => {
    const origin = L(28, 0);
    expect(wallMinutes(L(28, 23, 12), origin)).toBe(23 * 60 + 12);
    expect(wallMinutes(L(29, 1, 30), origin)).toBe(25 * 60 + 30);
  });
  it('turns the schedule into a day from wake to bed with its blocks', () => {
    const f = dayFrame(wed);
    expect(f).toMatchObject({ start: 480, end: 1560 });
    expect(f.origin?.getTime()).toBe(L(28, 0).getTime());
    expect(f.blocks?.map((b) => [b.name, b.kind, b.start, b.end])).toEqual([['Work', 'focus', 480, 960], ['Family evening', 'personal', 960, 1200], ['Shichael', 'personal', 1200, 1380], ['Project', 'focus', 1380, 1560]]);
  });
  it('at 23:12 the plan runs to 2:00a, not 11:15p', () => {
    const day = dayFrame(wed);
    const now = L(28, 23, 12);
    expect(planStart(now, day)).toBe(23 * 60 + 15);
    expect(budgetOf(now, day, null)).toEqual({ minutes: 165, isDefault: true });
    const p = buildPlan([t('Ship it 🟠'), t('Small 🟢')], now, day, 165);
    expect(p.blocks.map((b) => [clock(b.start), clock(b.end)])).toEqual([['11:15p', '1:15a'], ['1:15a', '1:45a']]);
  });
  it('at 1:00a the next calendar date still plans the same day', () => {
    const day = dayFrame(wed);
    expect(planStart(L(29, 1), day)).toBe(25 * 60);
    expect(budgetOf(L(29, 1), day, null).minutes).toBe(60);
  });
  it('asleep: plans the next day from wake', () => {
    const thu: DaySched = { ...wed, date: '2026-10-29', wake: iso(29, 8), bed: iso(30, 2), asleep: true, blocks: [] };
    const day = dayFrame(thu);
    expect(planStart(L(29, 3), day)).toBe(480);
    expect(day.asleep).toBe(true);
  });
  it('falls back to 9-18 without a schedule', () => {
    expect(dayFrame(null)).toEqual(DEFAULT_DAY);
  });
});

describe('personal time', () => {
  const day = dayFrame(wed);
  it('is not task time unless the row carries the block emoji', () => {
    const p = buildPlan([t('Report 🟡'), t('🏠 Mow the lawn 🟡')], L(28, 15, 30), day, 600);
    expect(p.blocks.map((b) => [b.task.text, clock(b.start)])).toEqual([['🏠 Mow the lawn 🟡', '3:30p'], ['Report 🟡', '11:00p']]);
  });
  it('the default budget leaves out personal blocks and meetings, overlaps counted once', () => {
    const ev = (h1: number, h2: number): CalEvent => ({ id: `${h1}`, subject: 'm', start: iso(28, h1), end: iso(28, h2), allDay: false, showAs: 'busy', cancelled: false, online: false });
    const busy = busyIntervals([ev(14, 15), ev(17, 18)], day.origin!, 2);
    // 13:00 -> 2:00: Work 13-16 (3h) minus 1h meeting = 2h, Project 3h; the 17-18 meeting is inside Family.
    expect(budgetOf(L(28, 13), day, null, busy).minutes).toBe(300);
  });
});

describe('calendar range', () => {
  it('asks for the waking day, wake to bed', () => {
    expect(calendarRange(wed, L(28, 12))).toEqual({ from: iso(28, 8), to: iso(29, 2) });
  });
  it('without a schedule asks for the calendar day', () => {
    expect(calendarRange(null, L(28, 12))).toEqual({ from: iso(28, 0), to: iso(29, 0) });
  });
  it('meetings after midnight land on the day', () => {
    const late: CalEvent = { id: 'x', subject: 'APAC call', start: iso(29, 0, 30), end: iso(29, 1), allDay: false, showAs: 'busy', cancelled: false, online: false };
    expect(busyIntervals([late], L(28, 0), 2).map((b) => [b.start, b.end])).toEqual([[1470, 1500]]);
  });
});

describe('refresh', () => {
  // @req FR:home/day.refresh
  it('refetches once now passes bed (or before wake when not asleep)', () => {
    expect(needsRefresh(wed, L(28, 23))).toBe(false);
    expect(needsRefresh(wed, L(29, 2, 1))).toBe(true);
    expect(needsRefresh(null, L(28, 23))).toBe(false);
    const asleep: DaySched = { ...wed, date: '2026-10-29', wake: iso(29, 8), bed: iso(30, 2), asleep: true };
    expect(needsRefresh(asleep, L(29, 7, 59))).toBe(false);
    expect(needsRefresh(asleep, L(29, 8))).toBe(true);
  });
});
