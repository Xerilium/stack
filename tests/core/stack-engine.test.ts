import { parseConfig } from '../../src/core/config';
import { daysUntilDue, getEngine, rankTasks, type ScoringProject } from '../../src/core/scoring';

const config = parseConfig();
const at = new Date('2026-10-23T17:00:00Z');
const project = (...texts: string[]): ScoringProject => ({
  name: 'P', value: [], weeklyCapacity: 40, capacity: {},
  tasks: texts.map((text, i) => ({ id: `P_${i}`, parent: null, text, level: 0, project: 'P' })),
});
const top = (...texts: string[]) => rankTasks(getEngine('stack'), [project(...texts)], config, at).map((s) => s.task.text);

// @req FR:scoring-engine/engine.stack
describe('stack engine', () => {
  it('parses due dates with and without a year', () => {
    expect(daysUntilDue('📅 Oct 23: x', config, at)).toBe(0);
    expect(daysUntilDue('📅 Oct 21: x', config, at)).toBe(-2);
    expect(daysUntilDue('📅 Feb 1, 2027: 🔄 Quarterly: x', config, at)).toBe(101);
    expect(daysUntilDue('📅 Jan 3: x', config, at)).toBe(72);
    expect(daysUntilDue('no date', config, at)).toBeNull();
  });

  it('never ranks a task due beyond the horizon', () => {
    expect(top('📅 Feb 1, 2027: 🔄 Quarterly: File taxes ⚠️⚠️⚠️ 💰', 'Plain task')).toEqual(['Plain task']);
  });

  it('puts overdue and due-soon ahead of undated work', () => {
    expect(top('Plain task 🟢', '📅 Oct 30: Due next week 🟢', '📅 Oct 22: Overdue 🟢', '📅 Oct 25: Due soon 🟢'))
      .toEqual(['📅 Oct 22: Overdue 🟢', '📅 Oct 25: Due soon 🟢', '📅 Oct 30: Due next week 🟢', 'Plain task 🟢']);
  });

  it('keeps legacy ranking by default for the legacy id', () => {
    const r = rankTasks(getEngine('legacy'), [project('📅 Feb 1, 2027: far ⚠️⚠️⚠️ 💰', 'Plain task')], config, at);
    expect(r[0].task.text).toContain('far');
  });
});
