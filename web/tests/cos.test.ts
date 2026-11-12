/** @req FR:cos-base-of-ops/state.report @req FR:cos-base-of-ops/state.age @req FR:cos-base-of-ops/state.stale @req FR:cos-base-of-ops/state.line @req FR:cos-base-of-ops/msg.anchor @req FR:cos-base-of-ops/compose.prs @req FR:cos-base-of-ops/route.view */
import { describe, expect, it } from 'vitest';
import { anchorFor, cosName, cosReport, prSummary, prsTab, reportState, stateLine, type CosReport } from '../src/cos';
import type { TeamAgent } from '../src/team';
import type { PrBoard } from '../src/prs';
import type { Task } from '../src/types';

const NOW = new Date('2026-11-12T16:00:00Z');
const rep = (agent: string, project: string, at: string, o: Partial<CosReport> = {}): CosReport => ({ agent, project, at, top: [], asks: [], blockers: [], progress: [], ...o });
const ag = (slug: string, scope: string[], o: Partial<TeamAgent> = {}): TeamAgent => ({ slug, name: slug, scope, mode: 'ad-hoc', prompt: '', defined: true, source: 'stack', projects: [], ...o });
const task = (ref: string, project: string, section: string, o: Partial<Task> = {}): Task => ({ ref, text: ref, project, section, done: false, depth: 0, notes: [], ...o });

describe('cosReport', () => {
  // @req FR:cos-base-of-ops/state.report
  it('the newest report by the CoS; project all wins over a newer single project', () => {
    const list = [rep('cos', 'stack', '2026-11-12T15:00:00Z'), rep('other', 'all', '2026-11-12T15:59:00Z'), rep('cos', 'all', '2026-11-12T14:00:00Z')];
    expect(cosReport(list, 'cos')?.project).toBe('all');
    expect(cosReport(list.filter((r) => r.project !== 'all'), 'cos')?.project).toBe('stack');
    expect(cosReport(list, 'nobody')).toBeUndefined();
    expect(cosReport(null, 'cos')).toBeUndefined();
  });
});

describe('reportState', () => {
  // @req FR:cos-base-of-ops/state.age @req FR:cos-base-of-ops/state.stale
  it('none, fresh with an age, or stale past 24 h with the date', () => {
    expect(reportState(undefined, NOW)).toEqual({ kind: 'none', text: 'CoS has not reported yet' });
    expect(reportState(rep('cos', 'all', '2026-11-12T15:48:00Z'), NOW)).toMatchObject({ kind: 'fresh', text: 'Last report 12m ago' });
    expect(reportState(rep('cos', 'all', '2026-11-12T15:59:40Z'), NOW)).toMatchObject({ kind: 'fresh', text: 'Last report just now' });
    expect(reportState(rep('cos', 'all', '2026-11-12T13:00:00Z'), NOW)).toMatchObject({ kind: 'fresh', text: 'Last report 3h ago' });
    const s = reportState(rep('cos', 'all', '2026-11-10T17:30:00Z'), NOW);
    expect(s.kind).toBe('stale');
    expect(s.text).toMatch(/^CoS has not reported since Tue, Nov 10, 9:30\s?AM$/);
  });
});

describe('stateLine', () => {
  // @req FR:cos-base-of-ops/state.line
  it('only the parts whose source loaded; never a fake zero', () => {
    expect(stateLine({ open: 3, blockers: 2, running: 11 })).toBe('3 need you, 2 blocked, 11 moving');
    expect(stateLine({ open: 0, running: 1 })).toBe('0 need you, 1 moving');
    expect(stateLine({})).toBeNull();
    expect(stateLine({ blockers: 1 })).toBe('1 blocked');
  });
});

describe('cosName', () => {
  // @req FR:cos-base-of-ops/route.nav
  it('the roll-up agent, else Chief of Staff', () => {
    expect(cosName([ag('labels', ['f4']), ag('cos', ['*'], { name: 'Roland' })])).toBe('Roland');
    expect(cosName([ag('labels', ['f4'])])).toBe('Chief of Staff');
  });
});

describe('anchorFor', () => {
  // @req FR:cos-base-of-ops/msg.anchor
  it('the first open top-level task the CoS owns, Active first; else the first open task; none when empty', () => {
    const team = [ag('cos', ['*']), ag('cid', ['f4'])];
    const tasks = [task('f4:3', 'f4', '🔄 Active'), task('alpha:9', 'alpha', '📋 Backlog'), task('alpha:4', 'alpha', '🔄 Active'), task('alpha:5', 'alpha', '🔄 Active', { depth: 1 })];
    expect(anchorFor(tasks, team, 'cos')?.ref).toBe('alpha:4');
    expect(anchorFor(tasks, team, 'cid')?.ref).toBe('f4:3');
    expect(anchorFor([task('f4:3', 'f4', 'Backlog')], team, 'cos')?.ref).toBe('f4:3');
    expect(anchorFor([task('f4:3', 'f4', 'Active', { done: true })], team, 'cos')).toBeUndefined();
  });
});

describe('prSummary and prsTab', () => {
  const e = (n: number) => ({ repo: 'o/r', number: n, url: `https://github.com/o/r/pull/${n}`, title: `PR ${n}` });
  const board = { at: NOW.toISOString(), user: 'me', agents: { count: 2, source: 'sessions' }, counts: { blocked: 1, waiting: 0, processing: 4, pending: 2, paused: 0 }, footer: { running: 0, waiting: 0, parked: 0 }, queue: true,
    rows: [{ group: 'blocked', project: 'x' }, { group: 'processing', project: 'x', healthy: false }, { group: 'processing', project: 'x', healthy: true }, { group: 'pending', project: 'x' }],
    escalations: { blocked: [e(1), e(2)], enable: [e(3), e(4)], live: [e(5)] } } as unknown as PrBoard;
  // @req FR:cos-base-of-ops/compose.prs
  it('counts per group as the flyout tabs count them (countOf), in PR page order with its labels; up to 3 escalations, blocked first', () => {
    const s = prSummary(board);
    expect(s.counts.map((c) => `${c.label}:${c.n}`)).toEqual(['Blocked on me:1', 'Waiting on me:0', 'Processing:1', 'Pending:1', 'Paused:0']);
    expect(s.esc.map((x) => `${x.number}:${x.kind}`)).toEqual(['1:blocked', '2:blocked', '3:enable']);
    expect(prSummary(null)).toEqual({ counts: [], esc: [] });
  });
  // @req FR:cos-base-of-ops/route.view
  it('#/prs and #/prs?tab= name the flyout tab; other hashes do not', () => {
    expect(prsTab('#/prs')).toBe('default');
    expect(prsTab('#/prs?tab=blocked')).toBe('blocked');
    expect(prsTab('#/prs?tab=escalations')).toBe('escalations');
    expect(prsTab('#/prs?tab=bogus')).toBe('default');
    expect(prsTab('#/cos')).toBeNull();
  });
});
