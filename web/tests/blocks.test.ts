/** @req FR:home/day.blocks */
import { describe, expect, it } from 'vitest';
import { buildPlan, clock, type Day } from '../src/plan';
import { withProjects } from '../src/schedule';
import type { Task } from '../src/types';

const L = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m);
let n = 0;
const t = (text: string, project: string): Task => ({ ref: `${project}:${++n}`, text, project, section: '🔄 Active', done: false, depth: 0, notes: [] });
const base: Day = {
  start: 480, end: 1560, origin: L(28, 0),
  blocks: [
    { name: 'Work', emoji: '☀️', kind: 'focus', start: 480, end: 960 },
    { name: 'Family evening', label: 'Family', emoji: '🏠', kind: 'personal', start: 960, end: 1200 },
    { name: 'Project', emoji: '🌙', kind: 'focus', start: 1380, end: 1560 },
  ],
};
const projects: { name: string; metadata: Record<string, string> }[] = [
  { name: 'allyte', metadata: { 'Work capacity': '8h' } },
  { name: 'stack', metadata: { 'Project capacity': '1h' } },
  { name: 'finance', metadata: { 'Family evening capacity': '2h' } },
  { name: 'misc', metadata: {} },
];
const day = withProjects(base, projects);

describe('work goes in its block', () => {
  it('maps projects to blocks from "<Block> capacity" metadata', () => {
    expect(day.blocks?.map((b) => [b.name, b.projects])).toEqual([['Work', ['allyte']], ['Family evening', ['finance']], ['Project', ['stack']]]);
  });
  it('a project task waits for its block; an open task takes the first focus time', () => {
    const p = buildPlan([t('Stack fix 🟢', 'stack'), t('Allyte deck 🟢', 'allyte'), t('Misc 🟢', 'misc')], L(28, 10), day, 600);
    expect(p.blocks.map((b) => [b.task.project, clock(b.start)])).toEqual([['allyte', '10:00a'], ['misc', '10:30a'], ['stack', '11:00p']]);
  });
  it('a project with capacity in personal time is planned there, outside the focus budget', () => {
    const p = buildPlan([t('Pay bills 🟢', 'finance'), t('Allyte deck 🟢', 'allyte')], L(28, 15, 30), day, 30);
    expect(p.blocks.map((b) => [b.task.project, clock(b.start)])).toEqual([['allyte', '3:30p'], ['finance', '4:00p']]);
  });
  it('a work task that does not fit the work block is left out, not moved into project time', () => {
    const p = buildPlan([t('Allyte deck 🟠', 'allyte')], L(28, 15, 30), day, 600);
    expect(p.blocks).toEqual([]);
    expect(p.overflow.map((x) => x.project)).toEqual(['allyte']);
  });
  it('a row tagged with a block emoji belongs to that block', () => {
    const p = buildPlan([t('🌙 Late idea 🟢', 'misc')], L(28, 10), day, 600);
    expect(clock(p.blocks[0].start)).toBe('11:00p');
  });
  it('a project bound to Work gets no time on a day without a Work block', () => {
    const weekend = withProjects({ ...base, blocks: base.blocks!.filter((b) => b.name !== 'Work') }, projects);
    const p = buildPlan([t('Allyte deck 🟢', 'allyte'), t('Misc 🟢', 'misc')], L(28, 10), weekend, 600);
    expect(p.blocks.map((b) => b.task.project)).toEqual(['misc']);
    expect(p.overflow.map((x) => x.project)).toEqual(['allyte']);
  });
});
