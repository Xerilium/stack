/** @req FR:web-app/now.active @req FR:web-app/projects.glance @req FR:web-app/list.view */
import { describe, expect, it } from 'vitest';
import { activeTasks, children, progress, topTask, visibleRows } from '../src/now';
import type { Task } from '../src/types';

const t = (ref: string, project: string, section: string, depth = 0, done = false): Task => ({ ref, text: ref, project, section, done, depth, notes: [] });
const all = [
  t('a:1', 'a', '🔄 Active'), t('a:2', 'a', '🔄 Active', 1, true), t('a:3', 'a', '🔄 Active', 1), t('a:4', 'a', '🔄 Active'),
  t('a:6', 'a', '⏭️ Up next'), t('b:1', 'b', '⏭️ Up next'), t('b:2', 'b', '🗄️ Later'), t('c:1', 'c', '🗄️ Later', 0, true), t('c:2', 'c', '🗄️ Later'),
];

describe('now helpers', () => {
  it('lists open top-level Active tasks', () => expect(activeTasks(all).map((x) => x.ref)).toEqual(['a:1', 'a:4']));
  it('counts subtask progress', () => { expect(progress(all, 0)).toEqual({ done: 1, total: 2 }); expect(progress(all, 3)).toEqual({ done: 0, total: 0 }); });
  it('returns children', () => expect(children(all, 'a:1').map((x) => x.ref)).toEqual(['a:2', 'a:3']));
  it('picks the top task: Active, then Up next, then any', () => {
    expect(topTask(all, 'a')?.ref).toBe('a:1');
    expect(topTask(all, 'b')?.ref).toBe('b:1');
    expect(topTask(all, 'c')?.ref).toBe('c:2');
    expect(topTask(all, 'zzz')).toBeUndefined();
  });
  it('hides subtasks until expanded and honors collapsed sections', () => {
    expect(visibleRows(all, all, new Set(), new Set()).map((x) => x.ref)).not.toContain('a:2');
    expect(visibleRows(all, all, new Set(['a:1']), new Set()).map((x) => x.ref)).toContain('a:2');
    expect(visibleRows(all, all, new Set(), new Set(['b/⏭️ Up next'])).map((x) => x.ref)).not.toContain('b:1');
  });
});

import { actionable, dueDays, rankNow } from '../src/now';
// @req FR:web-app/now.active
describe('now ranking', () => {
  const day = new Date(2026, 9, 23);
  const row = (text: string): Task => ({ ref: text, text, project: 'a', section: '🔄 Active', done: false, depth: 0, notes: [] });
  it('reads due days', () => {
    expect(dueDays('Oct 23', day)).toBe(0);
    expect(dueDays('Feb 1, 2027', day)).toBe(101);
    expect(dueDays('Mondays', day)).toBeNull();
  });
  it('drops parked, started-later, and far-future tasks', () => {
    expect(actionable(row('📅 Feb 1, 2027: Taxes'), day)).toBe(false);
    expect(actionable(row('⏰ Jan 7, 2027: Prep'), day)).toBe(false);
    expect(actionable(row('💤 Oct 24: Wait'), day)).toBe(false);
    expect(actionable(row('⛔️ Blocked'), day)).toBe(false);
    expect(actionable(row('📅 Oct 30: Soon'), day)).toBe(true);
  });
  it('ranks due-soon, then in progress, then priority', () => {
    const r = rankNow([row('plain'), row('🔺 raised'), row('🚧 doing'), row('📅 Oct 30: week'), row('📅 Oct 22: late')], day).map((t) => t.text);
    expect(r).toEqual(['📅 Oct 22: late', '📅 Oct 30: week', '🚧 doing', '🔺 raised', 'plain']);
  });
});

import { blockedOn, blockerEdges } from '../src/now';
// @req FR:web-app/now.blockers
describe('blocker inheritance in the Now lists', () => {
  const day = new Date(2026, 9, 23);
  const row = (text: string, project = 'a'): Task => ({ ref: `${project}:${text}`, text, project, section: '🔄 Active', done: false, depth: 0, notes: [] });
  it('reads reasons and resolves them', () => {
    expect(blockedOn('⛔️ Phase 2 🟡 -- Pending phase 1')).toEqual(['phase 1']);
    expect(blockedOn('⛔️ X -- After A, B and C')).toEqual(['a', 'b', 'c']);
    expect(blockedOn('⛔️ X -- need licences')).toEqual([]);
    const rows = [row('Phase 1 🟡'), row('⛔️ Phase 2 🟡 -- Pending phase 1')];
    expect(blockerEdges(rows).get(rows[1].ref)).toEqual([rows[0].ref]);
  });
  it('ranks a blocker with the most urgent task it blocks (transitive, max)', () => {
    const rows = [row('gate'), row('🔺 plain'), row('⛔️ B -- After gate'), row('🚨 ⛔️ C -- After B')];
    const r = rankNow([rows[0], rows[1]], day, rows).map((t) => t.text);
    expect(r).toEqual(['gate', '🔺 plain']);
    expect(rankNow([rows[1], rows[0]], day, rows).map((t) => t.text)).toEqual(['gate', '🔺 plain']);
  });
  it('lends nothing from parked or far-future rows, and survives cycles', () => {
    for (const lender of ['🚨 ⛔️ 🅿️ X -- After gate', '🚨 ⛔️ 📅 Mar 1, 2027: X -- After gate']) {
      const rows = [row('gate'), row('🔺 plain'), row(lender)];
      expect(rankNow([rows[1], rows[0]], day, rows).map((t) => t.text)).toEqual(['🔺 plain', 'gate']);
    }
    const cyc = [row('⛔️ A -- After B'), row('⛔️ B -- After A')];
    expect(() => rankNow(cyc, day, cyc)).not.toThrow();
  });
});

import { planCandidates } from '../src/plan';
describe('blocker inheritance: subtasks, sections, plan', () => {
  const day = new Date(2026, 9, 23);
  const row = (text: string, depth = 0, section = '🔄 Active'): Task => ({ ref: `a:${text}`, text, project: 'a', section, done: false, depth, notes: [] });
  it('a blocked parent lends its most urgent subtask', () => {
    const rows = [row('Phase 1'), row('🔺 plain'), row('⛔️ Phase 2 -- Pending phase 1'), row('🚨 📅 Oct 23: ship', 1)];
    expect(rankNow([rows[1], rows[0]], day, rows).map((t) => t.text)).toEqual(['Phase 1', '🔺 plain']);
  });
  it('rows outside Active lend nothing', () => {
    const rows = [row('gate'), row('🔺 plain'), row('🚨 ⛔️ X -- After gate', 0, '⏭️ Up next')];
    expect(rankNow([rows[1], rows[0]], day, rows).map((t) => t.text)).toEqual(['🔺 plain', 'gate']);
  });
  it('no false links on a word in the middle of a title', () => {
    const rows = [row('Email Bob about contract'), row('🔺 plain'), row('🚨 ⛔️ X -- Waiting on Bob')];
    expect(rankNow([rows[1], rows[0]], day, rows).map((t) => t.text)).toEqual(['🔺 plain', 'Email Bob about contract']);
  });
  it('the day plan ranks a leaf under a blocker first', () => {
    const rows = [row('Gate'), row('step one', 1), row('🔺 plain'), row('🚨 ⛔️ ship -- After gate')];
    expect(planCandidates(rows, day).map((t) => t.text)).toEqual(['step one', '🔺 plain']);
  });
  it('a parked parent makes its subtasks lend nothing', () => {
    const rows = [row('gate'), row('🔺 plain'), row('🅿️ ⛔️ X -- After gate'), row('🚨 sub', 1)];
    expect(rankNow([rows[1], rows[0]], day, rows).map((t) => t.text)).toEqual(['🔺 plain', 'gate']);
  });
});
