/** @req FR:cos-view/brief.meetings @req FR:cos-view/brief.messages @req FR:cos-view/brief.actions @req FR:cos-view/brief.ninety */
import { describe, expect, it } from 'vitest';
import { briefOf } from '../src/brief';
import type { AskItem } from '../src/asks';
import type { Busy } from '../src/meetings';
import type { Day } from '../src/plan';

const day: Day = { start: 8 * 60, end: 18 * 60 };
const at = (h: number, m = 0) => new Date(2026, 10, 5, h, m);
const ask = (key: string, from: string, score: number, extra: Partial<AskItem> = {}): AskItem => ({ key, state: 'open', ask: key, kind: 'answer', from, reversible: true, priority: 'normal', blocks: 0, created: '', updated: '', score, overdue: false, ...extra });
const busy = (start: number, end: number, title: string, joinUrl?: string): Busy => ({ start, end, titles: [title], events: [{ id: title, subject: title, start: '', end: '', allDay: false, showAs: 'busy', cancelled: false, online: !!joinUrl, ...(joinUrl ? { joinUrl } : {}) }] });

describe('briefOf', () => {
  it('meetings: two that have not ended, soonest first, with minutes to start', () => {
    const b = briefOf({ asks: [], busy: [busy(540, 570, 'Done'), busy(630, 660, 'A'), busy(700, 730, 'B'), busy(800, 830, 'C')], day, now: at(10, 0), one: null });
    expect(b.meetings.map((m) => m.title)).toEqual(['A', 'B']);
    expect(b.meetings[0].in).toBe(30);
  });
  it('meetings: one in progress is now, and a join link shows within 10 min', () => {
    const b = briefOf({ asks: [], busy: [busy(590, 650, 'On', 'https://j/1'), busy(700, 720, 'Later', 'https://j/2')], day, now: at(10, 0), one: null });
    expect(b.meetings[0]).toMatchObject({ title: 'On', now: true, join: 'https://j/1' });
    expect(b.meetings[1].join).toBeUndefined();
  });
  it('messages are email-triage asks; actions are the rest; 3 each, best score first, with overflow counts', () => {
    const asks = [ask('m1', 'email-triage', 10), ask('m2', 'email-triage', 50), ask('m3', 'email-triage', 20), ask('m4', 'email-triage', 5), ask('a1', 'Chief of Staff', 99), ask('a2', 'x agent', 1), ask('done', 'email-triage', 100, { state: 'done' })];
    const b = briefOf({ asks, busy: [], day, now: at(10), one: null });
    expect(b.messages.map((a) => a.key)).toEqual(['m2', 'm3', 'm1']);
    expect(b.moreMessages).toBe(1);
    expect(b.actions.map((a) => a.key)).toEqual(['a1', 'a2']);
    expect(b.moreActions).toBe(0);
  });
  it('next 90 minutes: meetings and gaps of 15 min or more, clipped to 90 min and bed', () => {
    const b = briefOf({ asks: [], busy: [busy(610, 640, 'Sync'), busy(660, 670, 'Quick')], day, now: at(10, 0), one: null });
    expect(b.ninety.map((s) => [s.kind, s.start, s.end])).toEqual([['free', 600, 610], ['meeting', 610, 640], ['free', 640, 660], ['meeting', 660, 670], ['free', 670, 690]].filter((s) => (s[2] as number) - (s[1] as number) >= 15 || s[0] === 'meeting'));
  });
  it('next 90 minutes: stops at bed', () => {
    const b = briefOf({ asks: [], busy: [], day, now: at(17, 0), one: null });
    expect(b.ninety).toEqual([{ kind: 'free', start: 1020, end: 1080, now: true }]);
  });
  it('the one task goes in the first gap long enough for it', () => {
    const one = { task: { ref: 'a:1', text: 'T', project: 'a', section: '', done: false, depth: 0, notes: [] }, minutes: 30, assumed: false, due: null };
    const b = briefOf({ asks: [], busy: [busy(610, 640, 'Sync')], day, now: at(10, 0), one });
    expect(b.ninety.find((s) => s.task)).toMatchObject({ kind: 'free', start: 640 });
  });
});

describe('briefOf: meeting detail and free window', () => {
  const b2 = (title: string, s: number, e: number, extra: Record<string, string> = {}): Busy => ({ start: s, end: e, titles: [title], events: [{ id: title, subject: title, start: '', end: '', allDay: false, showAs: 'busy', cancelled: false, online: false, ...extra }] });
  it('carries owner, topic, and the recurring join link', () => {
    const b = briefOf({ asks: [], busy: [b2('Sync', 605, 640, { owner: '🧰 CoS', topic: 'Roadmap', joinUrl: 'https://j/9' })], day, now: at(10, 0), one: null });
    expect(b.meetings[0]).toMatchObject({ owner: '🧰 CoS', topic: 'Roadmap', join: 'https://j/9' });
  });
  it('free until the next meeting, with minutes', () => {
    const b = briefOf({ asks: [], busy: [b2('Sync', 645, 700)], day, now: at(10, 0), one: null });
    expect(b.free).toEqual({ busy: false, until: 645, minutes: 45 });
  });
  it('free until bed when nothing is left', () => {
    expect(briefOf({ asks: [], busy: [], day, now: at(17, 0), one: null }).free).toEqual({ busy: false, until: 1080, minutes: 60 });
  });
  it('in a meeting: until it ends (back-to-back meetings chain)', () => {
    const b = briefOf({ asks: [], busy: [b2('A', 590, 650)], day, now: at(10, 0), one: null });
    expect(b.free).toEqual({ busy: true, until: 650, minutes: 50 });
  });
});
