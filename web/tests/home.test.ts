import { describe, expect, it } from 'vitest';
import { countdown, homeOf, topAsksOf } from '../src/home';
import type { Project, Task } from '../src/types';
import type { RankItem } from '../src/home';

const at = new Date(2026, 9, 29, 15, 0); // Thu 3 pm
const T = (ref: string, text: string, project = 'alpha', section = '🔄 Active', depth = 0): Task => ({ ref, text, project, section, done: false, depth, notes: [] });
const P = (name: string): Project => ({ name, title: name[0].toUpperCase() + name.slice(1), open: 1, done: 0, metadata: {} });

describe('countdown', () => {
  it('words the distance to a due date', () => {
    expect(countdown('Oct 29', at)).toEqual({ text: 'today', tone: 'soon' });
    expect(countdown('Oct 30', at)).toEqual({ text: 'tomorrow', tone: 'soon' });
    expect(countdown('Oct 31', at)).toEqual({ text: 'Sat', tone: 'calm' });
    expect(countdown('Nov 12', at)).toEqual({ text: 'in 14d', tone: 'calm' });
    expect(countdown('Oct 27', at)).toEqual({ text: '2d late', tone: 'late' });
    expect(countdown(undefined, at)).toBeNull();
  });
});

const R = (ref: string, root?: string, project = 'alpha'): RankItem => ({ ref, text: ref, project, score: 1, ...(root ? { root } : {}) });
const next = (...refs: string[]): RankItem[] => refs.map((r) => R(r));

describe('homeOf', () => {
  const tasks = [
    T('alpha:1', '📅 Oct 30: Ship the web app 🟠'),       // 2 h
    T('alpha:2', 'Write docs 🟢'),                        // 30 m
    T('alpha:3', '🚧 Fix the build 🔹'),                   // doing, 12 m
    T('beta:1', 'Plan the trip 🟡', 'beta'),              // 1 h
    T('gamma:1', 'Someday thing', 'gamma', '📋 Backlog'),
  ];
  const projects = [P('alpha'), P('beta'), P('gamma')];
  const ranked = next('alpha:1', 'alpha:2', 'alpha:3', 'beta:1');

  // @req FR:web-app/now.active
  it('draws only what the server ranked, in that order, in-progress first; the page does not rank', () => {
    const h = homeOf({ tasks, projects, ranked: next('beta:1', 'alpha:2', 'alpha:1'), now: at, minutesLeft: 600 });
    expect(h.one?.task.ref).toBe('beta:1');
    const doing = homeOf({ tasks, projects, ranked, now: at, minutesLeft: 600 });
    expect(doing.one?.task.ref).toBe('alpha:1'); // NOW is the server's first, even with a 🚧 row below
    expect(homeOf({ tasks, projects, ranked: [], now: at, minutesLeft: 600 }).one).toBeNull();
  });
  // @req FR:web-app/home.one @req FR:task-lifecycle/rank.root
  it('a ranked leaf is shown as its top-level row', () => {
    const t2 = [...tasks, T('alpha:9', 'Pay bills 💰', 'alpha'), { ...T('alpha:10', 'Mortgage', 'alpha'), depth: 1 }];
    const h = homeOf({ tasks: t2, projects, ranked: [R('alpha:10', 'alpha:9'), R('alpha:2')], now: at, minutesLeft: 600 });
    expect(h.one?.task.ref).toBe('alpha:9');
  });
  // @req FR:web-app/home.fit
  it('says when the one thing does not fit and offers the best ranked task that does', () => {
    const h = homeOf({ tasks, projects, ranked: next('alpha:1', 'alpha:2', 'beta:1'), now: at, minutesLeft: 45 });
    expect(h.fits).toBe(false);
    expect(h.instead?.task.ref).toBe('alpha:2');
    expect(h.instead?.minutes).toBe(30);
    expect(homeOf({ tasks, projects, ranked: next('alpha:1', 'alpha:2'), now: at, minutesLeft: 0 }).instead).toBeNull();
    const big = homeOf({ tasks: [T('alpha:9', 'Deep work ⚫️')], projects, ranked: next('alpha:9'), now: at, minutesLeft: 120 });
    expect(big.one?.minutes).toBe(480);
    expect(big.fits).toBe(false);
  });
  // @req FR:web-app/home.projects @req FR:web-app/home2.order
  it('projects are in the order of their top ranked row; a project with nothing ranked is left out unless it has an Up next row', () => {
    const h = homeOf({ tasks, projects, ranked: next('beta:1', 'alpha:2', 'alpha:1'), now: at, minutesLeft: 600 });
    expect(h.projects.map((p) => [p.project, p.top.task.ref])).toEqual([
      ['beta', 'beta:1'],
      ['alpha', 'alpha:2'],
    ]);
  });
  // @req FR:web-app/home.projects
  it('a project with nothing ranked shows its Up next row, never an arbitrary open row (the ranking may have hidden it)', () => {
    const t2 = [...tasks, T('delta:1', 'Hidden by a rule', 'delta'), T('eps:1', 'Next in line', 'eps', '⏭️ Up next')];
    const h = homeOf({ tasks: t2, projects: [...projects, P('delta'), P('eps')], ranked: next('alpha:1'), now: at, minutesLeft: 600 });
    expect(h.projects.map((p) => p.project)).toContain('eps');
    expect(h.projects.map((p) => p.project)).not.toContain('delta');
  });
  // @req FR:web-app/home.fit
  it('no effort set: 30 min assumed and marked', () => {
    const t = T('alpha:5', 'Call the plumber');
    const h = homeOf({ tasks: [t], projects: [P('alpha')], ranked: next('alpha:5'), now: at, minutesLeft: 60 });
    expect(h.one).toMatchObject({ minutes: 30, assumed: true });
    expect(h.projects[0].top.assumed).toBe(true);
  });
  // @req FR:web-app/home.one
  it('nothing ranked: nothing to do, no suggestion', () => {
    const h = homeOf({ tasks: [], projects: [], ranked: [], now: at, minutesLeft: 180 });
    expect(h.one).toBeNull();
    expect(h.projects).toEqual([]);
  });
});

// @req FR:web-app/home3.dedupe @req FR:ask-queue/needs.dedupe
describe('no duplicates between Needs you and Home', () => {
  const tasks = [T('alpha:1', 'Decide the vendor 🟡'), T('alpha:2', 'Write docs 🟢'), T('alpha:3', 'Fix the build 🔹'), T('beta:1', 'Plan the trip 🟢', 'beta')];
  const projects = [P('alpha'), P('beta')];
  const all = (h: ReturnType<typeof homeOf>) => [h.one?.task.ref, h.instead?.task.ref, ...h.projects.map((p) => p.top.task.ref)];
  it('a task that is in Needs you is not NOW or a project row', () => {
    const ranked = next('alpha:1', 'alpha:2', 'alpha:3', 'beta:1');
    const without = homeOf({ tasks, projects, ranked, now: at, minutesLeft: 600 });
    expect(all(without)).toContain('alpha:1');
    const h = homeOf({ tasks, projects, ranked, exclude: new Set(['alpha:1']), now: at, minutesLeft: 600 });
    expect(all(h)).not.toContain('alpha:1');
    expect(h.one?.task.ref).toBe('alpha:2');
    const leafHidden = homeOf({ tasks: [...tasks, { ...T('alpha:7', 'Leaf', 'alpha'), depth: 1 }], projects, ranked: [R('alpha:7', 'alpha:2'), R('alpha:1'), R('beta:1')], exclude: new Set(['alpha:7']), now: at, minutesLeft: 600 });
    expect(all(leafHidden)).not.toContain('alpha:2'); // the need is about the leaf; its row is held back too
  });
});

// @req FR:home/home.window
describe('personal time', () => {
  it('only rows tagged for the block fit, and one of them is offered instead', () => {
    const tasks = [T('alpha:1', 'Write the report 🟢'), T('alpha:2', '🏠 Order dinner 🟢')];
    const h = homeOf({ tasks, projects: [P('alpha')], ranked: next('alpha:1', 'alpha:2'), now: at, minutesLeft: 180, allow: { emoji: '🏠' } });
    expect(h.fits).toBe(false);
    expect(h.instead?.task.ref).toBe('alpha:2');
  });
});

// @req FR:top-asks/top.rows @req FR:top-asks/top.one
describe('topAsksOf', () => {
  const tasks = [
    T('alpha:1', 'Ship the web app 🟠'), T('alpha:2', 'Write docs 🟢'),
    T('beta:1', 'Plan the trip 🟡', 'beta'), T('beta:2', 'Book flights 🟢', 'beta'),
    T('gamma:1', 'Fix the outage 🟠', 'gamma'), T('delta:1', 'Someday', 'delta', '📋 Backlog'),
  ];
  const projects = [P('alpha'), P('beta'), P('gamma'), P('delta')];
  it('is the top task, then one row per other project in rank order; the top project is not repeated', () => {
    const h = homeOf({ tasks, projects, ranked: next('beta:1', 'alpha:1', 'beta:2', 'gamma:1', 'alpha:2'), now: at, minutesLeft: 600 });
    const t = topAsksOf(h);
    expect(t.top?.task.ref).toBe('beta:1');
    expect(t.rows.map((r) => [r.project, r.top.task.ref])).toEqual([['alpha', 'alpha:1'], ['gamma', 'gamma:1']]); // no Up next, no second beta row, delta has nothing ranked
  });
  it('when the top task does not fit, the task that fits is the top and its project is not repeated', () => {
    const h = homeOf({ tasks, projects, ranked: next('alpha:1', 'alpha:2', 'beta:1', 'gamma:1'), now: at, minutesLeft: 45 });
    const t = topAsksOf(h);
    expect(t.top?.task.ref).toBe('alpha:2');
    expect(t.rows.map((r) => r.project)).toEqual(['beta', 'gamma']);
  });
  it('nothing ranked or one project: no rows', () => {
    expect(topAsksOf(homeOf({ tasks: [], projects: [], ranked: [], now: at, minutesLeft: 60 }))).toEqual({ top: null, rows: [] });
    expect(topAsksOf(homeOf({ tasks, projects, ranked: next('alpha:1', 'alpha:2'), now: at, minutesLeft: 600 })).rows).toEqual([]);
  });
});
