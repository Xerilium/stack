/** @req FR:cos-view/brief.meetings @req FR:cos-view/brief.messages @req FR:cos-view/brief.actions @req FR:cos-view/brief.meetings.detail */
import { describe, expect, it } from 'vitest';
import { briefOf } from '../src/brief';
import type { AskItem } from '../src/asks';
import type { Busy } from '../src/meetings';
import type { Day } from '../src/plan';

const day: Day = { start: 8 * 60, end: 18 * 60 };
const at = (h: number, m = 0) => new Date(2026, 10, 5, h, m);
const ask = (key: string, from: string, score: number, extra: Partial<AskItem> = {}): AskItem => ({ key, state: 'open', ask: key, kind: 'answer', from, reversible: true, priority: 'normal', blocks: 0, created: '', updated: '', score, overdue: false, ...extra });
const busy = (start: number, end: number, title: string, extra: Record<string, string> = {}): Busy => ({ start, end, titles: [title], events: [{ id: title, subject: title, start: '', end: '', allDay: false, showAs: 'busy', cancelled: false, online: !!extra.joinUrl, ...extra }] });

describe('briefOf', () => {
  it('meetings: two that have not ended, soonest first, with minutes to start', () => {
    const b = briefOf({ asks: [], busy: [busy(540, 570, 'Done'), busy(630, 660, 'A'), busy(700, 730, 'B'), busy(800, 830, 'C')], day, now: at(10, 0) });
    expect(b.meetings.map((m) => m.title)).toEqual(['A', 'B']);
    expect(b.meetings[0].in).toBe(30);
  });
  it('meetings: one in progress is now, and a join link shows within 10 min', () => {
    const b = briefOf({ asks: [], busy: [busy(590, 650, 'On', { joinUrl: 'https://j/1' }), busy(700, 720, 'Later', { joinUrl: 'https://j/2' })], day, now: at(10, 0) });
    expect(b.meetings[0]).toMatchObject({ title: 'On', now: true, join: 'https://j/1' });
    expect(b.meetings[1].join).toBeUndefined();
  });
  it('carries owner, topic, and the recurring join link', () => {
    const b = briefOf({ asks: [], busy: [busy(605, 640, 'Sync', { owner: '🧰 CoS', topic: 'Roadmap', joinUrl: 'https://j/9' })], day, now: at(10, 0) });
    expect(b.meetings[0]).toMatchObject({ owner: '🧰 CoS', topic: 'Roadmap', join: 'https://j/9' });
  });
  it('messages are email-triage asks; actions are the rest; 3 each, best score first, with overflow counts', () => {
    const asks = [ask('m1', 'email-triage', 10), ask('m2', 'email-triage', 50), ask('m3', 'email-triage', 20), ask('m4', 'email-triage', 5), ask('a1', 'Chief of Staff', 99), ask('a2', 'x agent', 1), ask('done', 'email-triage', 100, { state: 'done' })];
    const b = briefOf({ asks, busy: [], day, now: at(10) });
    expect(b.messages.map((a) => a.key)).toEqual(['m2', 'm3', 'm1']);
    expect(b.moreMessages).toBe(1);
    expect(b.actions.map((a) => a.key)).toEqual(['a1', 'a2']);
    expect(b.moreActions).toBe(0);
  });
  it('returns only what Now draws', () => {
    expect(Object.keys(briefOf({ asks: [], busy: [], day, now: at(10) })).sort()).toEqual(['actions', 'meetings', 'messages', 'moreActions', 'moreMessages']);
  });
});
