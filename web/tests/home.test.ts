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
    expect(countdown('Nov 12', at)).toEqual({ text: 'in 14 d', tone: 'calm' });
    expect(countdown('Oct 27', at)).toEqual({ text: '2 d late', tone: 'late' });
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
    expect(homeOf({ tasks, projects, next, now: at, minutesLeft: 0 }).instead).toBeNull();
  });
  it('one row per project: the top task, skipping projects whose top is already shown', () => {
    const h = homeOf({ tasks, projects, next, now: at, minutesLeft: 180 });
    expect(h.projects.map((p) => [p.project, p.task?.ref ?? null, p.shown])).toEqual([
      ['alpha', 'alpha:1', true],
      ['beta', 'beta:1', false],
      ['gamma', 'gamma:1', false],
    ]);
    expect(h.projects[1].minutes).toBe(60);
  });
  it('no next task: nothing to do, no suggestion', () => {
    const h = homeOf({ tasks: [], projects: [], next: null, now: at, minutesLeft: 180 });
    expect(h.one).toBeNull();
    expect(h.next).toEqual([]);
  });
});
