import { parseConfig } from '../../src/core/config';
import { daysUntilDue, getEngine, NOW_HORIZON_DAYS, OVERDUE_WINDOW_DAYS, rankTasks, type ScoringProject } from '../../src/core/scoring';
import { actionable, dueDays, HORIZON_DAYS, OVERDUE_WINDOW_DAYS as WEB_WINDOW, rankNow } from '../../web/src/now';

// The web client ranks over HTTP rows (it may not import src/); this keeps its date rules in step with the stack engine.
// @req FR:scoring-engine/engine.stack @req FR:web-app/now.active
const config = { ...parseConfig(), timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const row = (text: string) => ({ ref: text, text, project: 'P', section: '🔄 Active', done: false, depth: 0, notes: [] });

describe('web now ranking matches the stack engine', () => {
  it('shares constants', () => {
    expect(HORIZON_DAYS).toBe(NOW_HORIZON_DAYS);
    expect(WEB_WINDOW).toBe(OVERDUE_WINDOW_DAYS);
  });

  it.each(['2026-01-05T12:00', '2026-10-23T12:00', '2026-12-30T12:00'])('due days agree on %s', (iso) => {
    const at = new Date(iso);
    for (const mo of MONTHS) for (const d of [1, 15, 28]) for (const y of ['', ', 2027']) {
      const due = `${mo} ${d}${y}`;
      expect([due, dueDays(due, at)]).toEqual([due, daysUntilDue(`📅 ${due}: x`, config, at)]);
    }
  });

  it('candidates and due order agree', () => {
    const at = new Date('2026-10-23T12:00');
    const texts = ['Plain 🟢', '📅 Oct 30: week 🟢', '📅 Oct 22: late 🟢', '📅 Oct 25: soon 🟢', '📅 Sep 1: stale 🟢', '📅 Mar 1: far 🟢', '💬 reply 🟢'];
    const p: ScoringProject = { name: 'P', value: [], weeklyCapacity: 40, capacity: {}, tasks: texts.map((text, i) => ({ id: `P_${i}`, parent: null, text, level: 0, project: 'P' })) };
    const server = rankTasks(getEngine('stack'), [p], config, at).map((s) => s.task.text);
    const web = rankNow(texts.map(row).filter((t) => actionable(t, at)), at).map((t) => t.text);
    expect(web).toEqual(server);
  });
});
