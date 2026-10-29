/** @req FR:home/home.window @req FR:home/home.have */
import { describe, expect, it } from 'vitest';
import { windowNow } from '../src/home';
import type { Busy } from '../src/meetings';
import type { Day } from '../src/plan';

const L = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m);
const day: Day = {
  start: 480, end: 1560, origin: L(28, 0),
  blocks: [
    { name: 'Work', emoji: '☀️', kind: 'focus', start: 480, end: 960 },
    { name: 'Family evening', label: 'Family', emoji: '🏠', kind: 'personal', start: 960, end: 1200 },
    { name: 'Project', emoji: '🌙', kind: 'focus', start: 1380, end: 1560 },
  ],
};
const meeting = (s: number, e: number, title = 'Allyte sync'): Busy => ({ start: s, end: e, titles: [title], events: [] });

describe('window now', () => {
  it('in personal time, tagged tasks get the block up to the next meeting', () => {
    expect(windowNow(day, [meeting(1080, 1110)], L(28, 17))).toMatchObject({ allow: { emoji: '🏠', minutes: 60 } });
  });
  it('runs to the next meeting', () => {
    expect(windowNow(day, [meeting(630, 660)], L(28, 9, 45))).toMatchObject({ minutes: 45, until: { kind: 'meeting', label: 'Allyte sync', at: 630 } });
  });
  it('runs to a personal block or bed when no meeting comes first', () => {
    expect(windowNow(day, [], L(28, 15, 10))).toMatchObject({ minutes: 50, until: { kind: 'personal', label: 'Family', at: 960 } });
    expect(windowNow(day, [], L(28, 23, 12))).toMatchObject({ minutes: 168, until: { kind: 'bed', at: 1560 } });
  });
  it('inside a meeting or personal block says so, with the time after it', () => {
    expect(windowNow(day, [meeting(600, 660)], L(28, 10, 15))).toMatchObject({ minutes: 0, inside: { kind: 'meeting', label: 'Allyte sync', until: 660 } });
    expect(windowNow(day, [], L(28, 17))).toMatchObject({ minutes: 0, inside: { kind: 'personal', label: 'Family', until: 1200 }, allow: { emoji: '🏠', minutes: 180 } });
  });
  it('"I have" overrides the window, even in personal time', () => {
    expect(windowNow(day, [], L(28, 17), 30)).toMatchObject({ minutes: 30, have: true });
  });
  it('past bed (or after hours without a schedule): nothing now', () => {
    expect(windowNow(day, [], L(29, 2, 30))).toMatchObject({ minutes: 0, inside: { kind: 'sleep', label: 'Past bed', until: 480 + 1440 } });
    expect(windowNow({ start: 540, end: 1080 }, [], L(28, 19))).toMatchObject({ minutes: 0, inside: { kind: 'sleep', label: 'After hours', until: 540 + 1440 } });
  });
  it('asleep: nothing now', () => {
    expect(windowNow({ ...day, asleep: true }, [], L(28, 3))).toMatchObject({ minutes: 0, inside: { kind: 'sleep', until: 480 } });
  });
});
