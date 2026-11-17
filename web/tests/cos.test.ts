/** @req FR:cos-base-of-ops/state.report @req FR:cos-base-of-ops/state.age @req FR:cos-base-of-ops/state.stale @req FR:cos-base-of-ops/state.line @req FR:cos-base-of-ops/msg.anchor @req FR:cos-base-of-ops/compose.prs @req FR:cos-base-of-ops/route.view */
import { describe, expect, it } from 'vitest';
import { anchorFor, cosName, cosReport, prSummary, reportState, stateLine, type CosReport } from '../src/cos';
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

describe('prSummary', () => {
  const row = (n: number, group: string, nextAction: string | null) => ({ url: `https://github.com/o/r/pull/${n}`, repo: 'o/r', number: n, title: `PR ${n}`, group, project: 'x', nextAction });
  const board = { at: NOW.toISOString(), user: 'me', agents: { count: 2, source: 'sessions' }, counts: { waiting: 0, processing: 4, pending: 2, paused: 0 }, footer: { running: 0, waiting: 0, parked: 0 }, queue: true,
    rows: [row(1, 'waiting', 'signoff'), row(2, 'processing', null), row(3, 'processing', 'validate'), row(4, 'pending', 'approve'), row(5, 'pending', 'publish')] } as unknown as PrBoard;
  // @req FR:cos-base-of-ops/compose.prs
  it('counts per group as the PR page tabs count them (countOf), in its order with its labels; up to 3 PRs with a next action', () => {
    const s = prSummary(board);
    expect(s.counts.map((c) => `${c.label}:${c.n}`)).toEqual(['Processing:2', 'Waiting on me:1', 'Pending:2', 'Paused:0']);
    expect(s.need.map((x) => x.number)).toEqual([1, 3, 4]);
    expect(prSummary(null)).toEqual({ counts: [], need: [] });
  });
});
