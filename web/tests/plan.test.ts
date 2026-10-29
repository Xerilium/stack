/** @req FR:web-app/today.plan @req FR:web-app/today.needs @req FR:web-app/today.agents */
import { describe, expect, it } from 'vitest';
import { agentWork, buildPlan, clock, decisions, openLeaves, planCandidates, recommendationOf, span } from '../src/plan';
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
  it('ignores 🙋 rows in Backlog unless under a row in progress', () => {
    const back = '📋 Backlog';
    const rows = [t('Later', 0, [], 'a', false, back), t('🙋 Ask', 1, [], 'a', false, back), t('🚧 🪄 Doing', 0, [], 'a', false, back), t('🙋 Now ask', 1, [], 'a', false, back)];
    expect(decisions(rows, at(10)).map((x) => x.task.text)).toEqual(['🙋 Now ask']);
  });
  it('waiting means a 🙋 in the agent\'s own subtree or a sibling, not an unrelated row', () => {
    const rows = [t('🪄 Job A'), t('Other'), t('🙋 Unrelated', 1), t('🪄 Job B'), t('🙋 Mine', 1)];
    expect(agentWork(rows, at(10)).map((x) => [x.task.text, x.state])).toEqual([['🪄 Job B', 'waiting'], ['🪄 Job A', 'queued']]);
  });
  it('shows agent rows as working, waiting on you, or queued', () => {
    const rows = [t('🚧 🤖 Fix build'), t('Parent'), t('🪄 Draft options', 1), t('🙋 Pick one', 1), t('🪄 Other job')];
    expect(agentWork(rows, at(10)).map((x) => [x.task.text, x.state])).toEqual([
      ['🚧 🤖 Fix build', 'working'], ['🪄 Draft options', 'waiting'], ['🪄 Other job', 'queued'],
    ]);
  });
});

describe('recommendation text', () => {
  it('takes the next line when the label stands alone', () => {
    const ask = t('🙋 Review analysis and decide', 1, ['> **Recommendation for Walkman:**', '> - Use Catalyst']);
    expect(recommendationOf([ask], ask)).toBe('- Use Catalyst');
  });
});
