/** @req FR:web-app/today.meetings @req FR:web-app/today.mail */
import { describe, expect, it } from 'vitest';
import { busyIntervals, busyWithin, emailMinutes, joinable, type CalEvent } from '../src/meetings';
import { buildPlan, DEFAULT_DAY } from '../src/plan';
import { budgetOf } from '../src/day';
import type { Task } from '../src/types';

const day = new Date(2026, 9, 28);
const iso = (h: number, m = 0) => new Date(2026, 9, 28, h, m).toISOString();
const ev = (id: string, h1: number, m1: number, h2: number, m2: number, o: Partial<CalEvent> = {}): CalEvent => ({ id, subject: id, start: iso(h1, m1), end: iso(h2, m2), allDay: false, showAs: 'busy', cancelled: false, online: false, ...o });
let n = 0;
const t = (text: string): Task => ({ ref: `a:${++n}`, text, project: 'a', section: '🔄 Active', done: false, depth: 0, notes: [] });
const at = (h: number, m = 0) => new Date(2026, 9, 28, h, m);

describe('busy time', () => {
  it('keeps busy, tentative, and out-of-office events; merges overlaps; clips to the day', () => {
    const events = [
      ev('standup', 9, 30, 10, 0), ev('overlap', 9, 45, 10, 15, { showAs: 'tentative' }), ev('free', 11, 0, 12, 0, { showAs: 'free' }),
      ev('gone', 13, 0, 14, 0, { cancelled: true }), ev('allday', 0, 0, 23, 59, { allDay: true }), ev('else', 14, 0, 15, 0, { showAs: 'workingElsewhere' }),
      ev('late', 23, 30, 23, 59), { ...ev('yesterday', 0, 0, 0, 0), start: new Date(2026, 9, 27, 23, 0).toISOString(), end: iso(0, 30) }, ev('oof', 16, 0, 17, 0, { showAs: 'oof' }),
    ];
    expect(busyIntervals(events, day).map((b) => [b.start, b.end, b.titles])).toEqual([
      [0, 30, ['yesterday']], [570, 615, ['standup', 'overlap']], [960, 1020, ['oof']], [1410, 1439, ['late']],
    ]);
    expect(busyWithin(busyIntervals(events, day), 9 * 60, 18 * 60)).toBe(105);
  });
  it('email block: 5 min per ask, 15 to 60 min', () => {
    expect([0, 1, 3, 4, 20].map(emailMinutes)).toEqual([0, 15, 15, 20, 60]);
  });
});

describe('plan around meetings', () => {
  it('never overlaps a meeting: a task that would cross one goes to the first gap that fits; a smaller one fills the gap', () => {
    const busy = busyIntervals([ev('m', 10, 30, 11, 0)], day);
    for (const order of [['A 🟡', 'B 🟢'], ['B 🟢', 'A 🟡']]) {
      const p = buildPlan(order.map(t), at(10), DEFAULT_DAY, 120, { busy });
      expect(p.blocks.map((b) => [b.task.text, b.start, b.end])).toEqual([['B 🟢', 600, 630], ['A 🟡', 660, 720]]);
      expect(p.meetings.map((m) => [m.start, m.end])).toEqual([[630, 660]]);
    }
  });
  it('the email block comes first and counts against the budget', () => {
    const p = buildPlan([t('A 🟡'), t('B 🟢')], at(10), DEFAULT_DAY, 80, { email: 3 });
    expect(p.email).toEqual({ start: 600, end: 615, count: 3 });
    expect(p.blocks.map((b) => b.task.text)).toEqual(['A 🟡']);
    expect(p.busy).toBe(75);
  });
  it('default available subtracts meetings inside the rest of the work day', () => {
    const busy = busyIntervals([ev('m', 9, 0, 9, 30), ev('n', 13, 0, 14, 30)], day);
    expect(budgetOf(at(10), DEFAULT_DAY, null, busy)).toEqual({ minutes: 480 - 90, isDefault: true });
    expect(budgetOf(at(10), DEFAULT_DAY, 120, busy)).toEqual({ minutes: 120, isDefault: false });
  });
});

describe('work day end', () => {
  it('with the default budget nothing is placed past the work day; a smaller later task fills the gap instead', () => {
    const busy = busyIntervals([ev('m', 16, 0, 17, 30)], day);
    const budget = budgetOf(at(15), DEFAULT_DAY, null, busy).minutes; // 3h left - 1h30 meeting = 90m
    const p = buildPlan([t('A 🟡'), t('Big 🟠'), t('C 🟢')], at(15), DEFAULT_DAY, budget, { busy });
    expect(p.blocks.map((b) => [b.task.text, b.start, b.end])).toEqual([['A 🟡', 900, 960], ['C 🟢', 1050, 1080]]);
    expect(p.overflow.map((x) => x.text)).toEqual(['Big 🟠']);
    expect(Math.max(...p.blocks.map((b) => b.end))).toBeLessThanOrEqual(18 * 60);
  });
  it('a budget above the work day runs the clock on past meetings, but only as far as the budget reaches', () => {
    const busy = busyIntervals([ev('m', 17, 0, 17, 30)], day);
    const p = buildPlan([t('A 🟠'), t('B 🟠'), t('C 🟡')], at(16), DEFAULT_DAY, 240, { busy }); // available until 20:30
    expect(p.blocks.map((b) => [b.task.text, b.start, b.end])).toEqual([['C 🟡', 960, 1020], ['A 🟠', 1050, 1170]]);
    expect(p.overflow.map((x) => x.text)).toEqual(['B 🟠']);
  });
});

describe('gaps too small to use', () => {
  it('never spill past the work day with the default budget', () => {
    const busy = busyIntervals([ev('m', 10, 10, 10, 30)], day); // leaves a 10 min gap no task fits
    const budget = budgetOf(at(10), DEFAULT_DAY, null, busy).minutes;
    const p = buildPlan(['🟠', '🟠', '🟠', '🟡', '🔹', '🔹', '🔹'].map((e) => t(`T ${e}`)), at(10), DEFAULT_DAY, budget, { busy });
    expect(Math.max(...p.blocks.map((b) => b.end))).toBeLessThanOrEqual(18 * 60);
    expect(p.overflow).toHaveLength(1);
  });
});

describe('wall clock and join', () => {
  it('places meetings by local clock time on a DST change day', () => {
    const dst = new Date(2026, 10, 1);
    const e = { ...ev('x', 0, 0, 0, 0), start: new Date(2026, 10, 1, 10, 0).toISOString(), end: new Date(2026, 10, 1, 11, 0).toISOString() };
    expect(busyIntervals([e], dst).map((b) => [b.start, b.end])).toEqual([[600, 660]]);
  });
  it('joinable checks each event on its own: the one on now or within 10 minutes', () => {
    const a = ev('a', 9, 0, 10, 0, { joinUrl: 'https://j/a' }), b = ev('b', 9, 30, 11, 0, { joinUrl: 'https://j/b' }), c = ev('c', 11, 5, 12, 0, { joinUrl: 'https://j/c' });
    expect(joinable([a, b, c], at(10, 30))).toBe('https://j/b');
    expect(joinable([a, b, c], at(11, 0))).toBe('https://j/c');
    expect(joinable([a, c], at(10, 30))).toBeUndefined();
  });
});
