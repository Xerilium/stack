/** @req FR:web-app/home.one @req FR:web-app/home.fit @req FR:web-app/home.next @req FR:web-app/home.projects */
import { describe, expect, it } from 'vitest';
import { countdown, homeOf } from '../src/home';
import type { Project, Task } from '../src/types';

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

describe('homeOf', () => {
  const tasks = [
    T('alpha:1', '📅 Oct 30: Ship the web app 🟠'),       // 2 h
    T('alpha:2', 'Write docs 🟢'),                        // 30 m
    T('alpha:3', '🚧 Fix the build 🔹'),                   // doing, 12 m
    T('beta:1', 'Plan the trip 🟡', 'beta'),              // 1 h
    T('gamma:1', 'Someday thing', 'gamma', '📋 Backlog'),
  ];
  const projects = [P('alpha'), P('beta'), P('gamma')];
  const next = { ref: 'alpha:1', text: tasks[0].text, project: 'alpha', score: 9 };

  it('the one thing carries its expected time and countdown; up next is the next two, doing first', () => {
    const h = homeOf({ tasks, projects, next, now: at, minutesLeft: 180 });
    expect(h.one?.task.ref).toBe('alpha:1');
    expect(h.one?.minutes).toBe(120);
    expect(h.one?.assumed).toBe(false);
    expect(h.one?.due).toEqual({ text: 'tomorrow', tone: 'soon' });
    expect(h.fits).toBe(true);
    expect(h.instead).toBeNull();
    expect(h.next.map((n) => n.task.ref)).toEqual(['alpha:3', 'alpha:2']);
  });
  it('says when the one thing does not fit and offers the best task that does', () => {
    const h = homeOf({ tasks, projects, next, now: at, minutesLeft: 45 });
    expect(h.fits).toBe(false);
    expect(h.instead?.task.ref).toBe('alpha:3');
    expect(h.instead?.minutes).toBe(12);
    expect(h.next.map((n) => n.task.ref)).toEqual(['alpha:2', 'beta:1']); // instead never repeats under up next
    expect(h.projects.find((p) => p.project === 'alpha')?.shown).toBe(true);
    expect(homeOf({ tasks, projects, next, now: at, minutesLeft: 0 }).instead).toBeNull();
    // a 3 h task never "fits" a 2 h budget (no cap)
    const big = homeOf({ tasks: [T('alpha:9', 'Deep work ⚫️')], projects, next: { ref: 'alpha:9', text: 'Deep work ⚫️', project: 'alpha', score: 1 }, now: at, minutesLeft: 120 });
    expect(big.one?.minutes).toBe(480);
    expect(big.fits).toBe(false);
  });
  it('one row per project: the top task, skipping projects whose top is already shown', () => {
    const h = homeOf({ tasks, projects, next, now: at, minutesLeft: 180 });
    expect(h.projects.map((p) => [p.project, p.top.task.ref, p.shown])).toEqual([
      ['alpha', 'alpha:1', true],
      ['beta', 'beta:1', false],
      ['gamma', 'gamma:1', false],
    ]);
    expect(h.projects[1].top.minutes).toBe(60);
  });
  it('no effort set: 30 min assumed and marked', () => {
    const t = T('alpha:5', 'Call the plumber');
    const h = homeOf({ tasks: [t], projects: [P('alpha')], next: { ref: 'alpha:5', text: t.text, project: 'alpha', score: 1 }, now: at, minutesLeft: 60 });
    expect(h.one).toMatchObject({ minutes: 30, assumed: true });
    expect(h.projects[0].top.assumed).toBe(true);
  });
  it('no next task: nothing to do, no suggestion', () => {
    const h = homeOf({ tasks: [], projects: [], next: null, now: at, minutesLeft: 180 });
    expect(h.one).toBeNull();
    expect(h.next).toEqual([]);
  });
});

// @req FR:web-app/home2.order @req FR:web-app/home2.five
describe('home round 3', () => {
  const at = new Date(2026, 9, 29, 10, 0);
  const tasks = [
    T('alpha:1', '🚨 Alpha fire 🟠'),
    T('alpha:2', 'Quick email 🔹'),
    T('alpha:3', 'Another quick one 🔹'),
    T('beta:1', 'Beta plan 🟢', 'beta'),
    T('beta:2', 'Tiny beta 🔹', 'beta'),
    T('beta:3', 'Backlog tiny 🔹', 'beta', '📋 Backlog'),
    T('zeta:1', 'Zeta thing 🟡', 'zeta'), // last in file order, so beta ranks above it
  ];
  const projects = [P('beta'), P('zeta'), P('alpha')];
  it('projects are in priority order (by their top task), not alphabetical or file order', () => {
    const h = homeOf({ tasks, projects, next: { ref: 'alpha:1', text: tasks[1].text, project: 'alpha', score: 9 }, now: at, minutesLeft: 240 });
    expect(h.projects.map((p) => p.project)).toEqual(['alpha', 'beta', 'zeta']);
  });
  it('"only have 5 min": up to 3 ranked active tasks of 15 minutes or less that are not already on screen', () => {
    const h = homeOf({ tasks, projects, next: { ref: 'alpha:1', text: tasks[1].text, project: 'alpha', score: 9 }, now: at, minutesLeft: 240 });
    const shown = new Set([h.one?.task.ref, ...h.next.map((n) => n.task.ref)]);
    expect(h.five.length).toBeGreaterThan(0);
    expect(h.five.length).toBeLessThanOrEqual(3);
    for (const f of h.five) { expect(f.minutes).toBeLessThanOrEqual(15); expect(shown.has(f.task.ref)).toBe(false); expect(f.task.ref).not.toBe('beta:3'); }
  });
});

// @req FR:home/home.window
describe('personal time', () => {
  it('only rows tagged for the block fit, and one of them is offered instead', () => {
    const tasks = [T('alpha:1', 'Write the report 🟢'), T('alpha:2', '🏠 Order dinner 🟢')];
    const h = homeOf({ tasks, projects: [P('alpha')], next: { ref: 'alpha:1', text: tasks[0].text, project: 'alpha', score: 1 }, now: at, minutesLeft: 180, allow: '🏠' });
    expect(h.fits).toBe(false);
    expect(h.instead?.task.ref).toBe('alpha:2');
  });
});
