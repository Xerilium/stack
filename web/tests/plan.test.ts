/** @req FR:web-app/today.plan @req FR:web-app/today.needs */
import { describe, expect, it } from 'vitest';
import { buildPlan, clock, decisions, DEFAULT_DAY, estimate, openLeaves, planCandidates, recommendationOf, span } from '../src/plan';
import type { Task } from '../src/types';

let n = 0;
const t = (text: string, depth = 0, notes: string[] = [], project = 'a', done = false, section = '🔄 Active'): Task => ({ ref: `${project}:${++n}`, text, project, section, done, depth, notes });
const at = (h: number, m = 0) => new Date(2026, 9, 23, h, m);

describe('day plan', () => {
  it('finds leaves', () => {
    const rows = [t('parent'), t('kid', 1), t('done kid', 1, [], 'a', true), t('solo')];
    expect(openLeaves(rows).map((x) => x.text)).toEqual(['kid', 'solo']);
  });
  it('packs tasks into what is left of the day, round up to 15 min', () => {
    const a = t('A 🟡'), b = t('B 🟠'), c = t('C 🟢');
    const p = buildPlan([a, b, c], at(14, 7), { start: 9 * 60, end: 17 * 60 });
    expect(p.blocks.map((x) => [x.task.text, clock(x.start), clock(x.end)])).toEqual([['A 🟡', '2:15p', '3:15p'], ['C 🟢', '3:15p', '3:45p']]);
    expect(p.overflow.map((x) => x.text)).toEqual(['B 🟠']);
    expect(span(p.left)).toBe('2h 45m');
  });
  it('caps a long task at 2h and flags it partial; day start clamps early times', () => {
    const p = buildPlan([t('Big ⚫️')], at(6), { start: 9 * 60, end: 18 * 60 });
    expect(p.blocks[0]).toMatchObject({ start: 540, end: 660, partial: true });
  });
  it('plans only your own actionable leaves, hero first', () => {
    const rows = [t('🤖 agent job'), t('🙋 decide'), t('plain 🟢'), t('📅 Oct 23: due today 🟢'), t('📅 Feb 1, 2027: far 🟢')];
    const c = planCandidates(rows, at(10), rows[2].ref).map((x) => x.text);
    expect(c).toEqual(['plain 🟢', '📅 Oct 23: due today 🟢']);
  });
  it('never plans reply rows', () => {
    const ask = t('🙋 Pick a color');
    expect(planCandidates([ask, t('💬 Blue', 1)], at(10)).map((x) => x.text)).toEqual([]);
  });
});

describe('decisions and agents', () => {
  it('lists 🙋 rows with the recommendation found on the row, parent, or sibling', () => {
    const p = t('Decide whether to re-engage');
    const kid = t('🪄 Calculate ROI and recommend', 1, ['> **Recommendation:** Let it drop.']);
    const ask = t('🙋 Make final decision', 1);
    const rows = [p, kid, ask];
    expect(recommendationOf(rows, ask)).toBe('Let it drop.');
    const d = decisions(rows, at(10));
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ task: { text: '🙋 Make final decision' }, context: { text: 'Decide whether to re-engage' }, recommendation: 'Let it drop.' });
  });
  it('an answered 🙋 (open 💬 under it) leaves Needs you', () => {
    const rows = [t('Parent'), t('🪄 Draft options', 1), t('🙋 Pick one', 1), t('💬 Option B', 2)];
    expect(decisions(rows, at(10))).toEqual([]);
  });
  it('ignores 🙋 rows in Backlog unless under a row in progress', () => {
    const back = '📋 Backlog';
    const rows = [t('Later', 0, [], 'a', false, back), t('🙋 Ask', 1, [], 'a', false, back), t('🚧 🪄 Doing', 0, [], 'a', false, back), t('🙋 Now ask', 1, [], 'a', false, back)];
    expect(decisions(rows, at(10)).map((x) => x.task.text)).toEqual(['🙋 Now ask']);
  });
});

describe('recommendation text', () => {
  it('takes the next line when the label stands alone', () => {
    const ask = t('🙋 Review analysis and decide', 1, ['> **Recommendation for Walkman:**', '> - Use Catalyst']);
    expect(recommendationOf([ask], ask)).toBe('- Use Catalyst');
  });
});

/** @req FR:web-app/today.capacity @req FR:web-app/today.fit */
describe('capacity-aware plan', () => {
  it('books no more than the budget and lets smaller tasks fill the gap', () => {
    const a = t('A 🟡'), b = t('B 🟠'), c = t('C 🟢'), d = t('D 🔹');
    const p = buildPlan([a, b, c, d], at(13), DEFAULT_DAY, 100);
    expect(p.blocks.map((x) => x.task.text)).toEqual(['A 🟡', 'C 🟢']);
    expect(p.overflow.map((x) => x.text)).toEqual(['B 🟠', 'D 🔹']);
    expect(p).toMatchObject({ budget: 100, busy: 90, free: 10, short: 132 });
    expect(p.blocks.map((x) => [clock(x.start), clock(x.end)])).toEqual([['1:00p', '2:00p'], ['2:00p', '2:30p']]);
  });
  it('defaults the budget to what is left of the work day and marks estimates', () => {
    const p = buildPlan([t('No effort'), t('E 🟢')], at(17), DEFAULT_DAY);
    expect(p.budget).toBe(60);
    expect(p.blocks.map((x) => x.assumed)).toEqual([true, false]);
    expect(p.assumed).toBe(1);
  });
  it('a budget past the work day runs the clock on; zero books nothing', () => {
    const p = buildPlan([t('A 🟠'), t('B 🟠')], at(17), DEFAULT_DAY, 240);
    expect(p.blocks.map((x) => clock(x.end))).toEqual(['7:00p', '9:00p']);
    expect(buildPlan([t('A 🟢')], at(10), DEFAULT_DAY, 0)).toMatchObject({ blocks: [], busy: 0, free: 0, short: 30 });
  });
  it('estimate is the effort, or 30 min assumed; capped at 2h', () => {
    expect(estimate(t('x'))).toEqual({ minutes: 30, assumed: true, partial: false });
    expect(estimate(t('x ⚫️'))).toEqual({ minutes: 120, assumed: false, partial: true });
  });
});

/** @req FR:web-app/today.fit */
describe('at risk', () => {
  it('flags left-out tasks due today, recently late, or in progress; orders them first', () => {
    const fits = t('Fits 🟠');
    const later = t('Someday 🟢');
    const today = t('📅 Oct 23: Due today 🟢');
    const late = t('📅 Oct 20: Late 🟢');
    const stale = t('📅 Aug 1: Stale 🟢');
    const doing = t('🚧 Doing 🟢');
    const p = buildPlan([fits, later, today, late, stale, doing], at(10), DEFAULT_DAY, 120);
    expect(p.blocks.map((b) => b.task.text)).toEqual(['Fits 🟠']);
    expect(p.atRisk.map((x) => x.text)).toEqual(['📅 Oct 23: Due today 🟢', '📅 Oct 20: Late 🟢', '🚧 Doing 🟢']);
    expect(p.riskShort).toBe(90);
    expect(p.overflow.map((x) => x.text)).toEqual(['📅 Oct 23: Due today 🟢', '📅 Oct 20: Late 🟢', '🚧 Doing 🟢', 'Someday 🟢', '📅 Aug 1: Stale 🟢']);
  });
});
