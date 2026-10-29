/** @req FR:home/myday.timeline */
import { describe, expect, it } from 'vitest';
import type { Busy } from '../src/meetings';
import type { Block, Day, Plan } from '../src/plan';
import { timelineOf, type Row } from '../src/timeline';
import type { Task } from '../src/types';

const L = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m);
const day: Day = {
  start: 480, end: 1560, origin: L(28, 0),
  blocks: [
    { name: 'Work', emoji: '☀️', kind: 'focus', start: 480, end: 960 },
    { name: 'Family evening', label: 'Family', emoji: '🏠', kind: 'personal', start: 960, end: 1200 },
    { name: 'Project', emoji: '🌙', kind: 'focus', start: 1380, end: 1560 },
  ],
};
const task = (ref: string): Task => ({ ref, text: ref, project: 'a', section: '🔄 Active', done: false, depth: 0, notes: [] });
const block = (ref: string, start: number, end: number): Block => ({ task: task(ref), start, end, partial: false, assumed: false });
const plan = (blocks: Block[], meetings: Busy[] = []): Plan => ({ meetings, blocks, overflow: [], atRisk: [], left: 0, busy: 0, budget: 0, free: 0, short: 0, riskShort: 0, assumed: 0 });
const show = (rows: Row[]) => rows.map((r) => (r.kind === 'band' ? `band ${r.name}` : r.kind === 'gap' ? `gap ${r.at}+${r.min}` : r.kind === 'block' ? `task ${r.b.task.ref}` : r.kind === 'meeting' ? `meeting ${r.at}` : r.kind));

describe('My day timeline', () => {
  it('bands end at their block; time between blocks sits under Open; free gaps skip personal time', () => {
    const p = plan([block('w1', 915, 945), block('o1', 1200, 1320), block('p1', 1380, 1440)], [{ start: 955, end: 990, titles: ['Sync'], events: [] }]);
    const t = timelineOf(p, day, 915, 1560, 910);
    expect(show(t.rows)).toEqual([
      'band Work', 'now', 'task w1', 'meeting 955', 'band Family',
      'band Open', 'task o1', 'gap 1320+60', 'band Project', 'task p1', 'gap 1440+120',
    ]);
  });
  it('the now line sits inside the band it falls in', () => {
    const t = timelineOf(plan([block('w1', 915, 945)]), day, 915, 1560, 910);
    expect(show(t.rows).slice(0, 3)).toEqual(['band Work', 'now', 'task w1']);
  });
  it('Earlier folds only bands that are fully past', () => {
    expect(timelineOf(plan([]), day, 915, 1560, 910).earlier).toBeNull();
    expect(timelineOf(plan([]), day, 1395, 1560, 1392).earlier).toEqual({ from: 480, to: 1200 });
  });
  it('now between blocks sits under an Open header', () => {
    const t = timelineOf(plan([block('o1', 1260, 1290)]), day, 1260, 1560, 1258);
    expect(show(t.rows).slice(0, 3)).toEqual(['band Open', 'now', 'task o1']);
  });
  it('a meeting under way sits under its band header', () => {
    const t = timelineOf(plan([], [{ start: 955, end: 990, titles: ['Sync'], events: [] }]), day, 975, 1560, 970);
    expect(show(t.rows).slice(0, 3)).toEqual(['band Family', 'meeting 955', 'now']);
  });
  it('asleep: no now line', () => {
    expect(show(timelineOf(plan([]), { ...day, asleep: true }, 480, 1560, -300).rows)).not.toContain('now');
  });
});
