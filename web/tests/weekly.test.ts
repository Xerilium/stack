/** @req FR:cos-view/meet.expand @req FR:cos-view/meet.enrich */
import { describe, expect, it } from 'vitest';
import { enrich, expandWeekly, type Rule } from '../src/weekly';
import type { CalEvent } from '../src/meetings';

const r = (o: Partial<Rule> & { title: string }): Rule => ({ days: [4], start: '09:00', end: '10:00', ...o });
const thu = new Date(2026, 10, 5, 8, 0); // Thu 5 Nov 2026, ISO week 45 (odd)
const hhmm = (iso: string) => { const d = new Date(iso); return `${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

describe('expandWeekly', () => {
  it('makes busy events with owner, topic, join on matching weekdays only', () => {
    const e = expandWeekly([r({ title: 'A', owner: '🧰 CoS', topic: 'T', join: 'https://j/1' }), r({ title: 'Mon', days: [1] })], thu);
    expect(e).toHaveLength(1);
    expect(e[0]).toMatchObject({ subject: 'A', showAs: 'busy', owner: '🧰 CoS', topic: 'T', joinUrl: 'https://j/1', online: true });
    expect([hhmm(e[0].start), hhmm(e[0].end)]).toEqual(['5 09:00', '5 10:00']);
  });
  it('biweekly runs on even ISO weeks only', () => {
    expect(expandWeekly([r({ title: 'B', biweekly: true })], thu)).toHaveLength(0);
    expect(expandWeekly([r({ title: 'B', biweekly: true })], new Date(2026, 10, 12, 8))).toHaveLength(1);
  });
  it('a meeting past midnight spills into the next day', () => {
    const e = expandWeekly([r({ title: 'Late', days: [3], start: '23:00', end: '01:00' })], thu);
    expect(e).toHaveLength(1);
    expect([hhmm(e[0].start), hhmm(e[0].end)]).toEqual(['4 23:00', '5 01:00']);
  });
});

describe('enrich', () => {
  const ev = (subject: string, extra: Partial<CalEvent> = {}): CalEvent => ({ id: subject, subject, start: '', end: '', allDay: false, showAs: 'busy', cancelled: false, online: false, ...extra });
  it('adds owner, topic, join by title; keeps the event own join', () => {
    const rules = [r({ title: 'FOCUS TF1', owner: 'o', topic: 't', join: 'https://j/r' })];
    const out = enrich([ev('focus tf1 weekly'), ev('Other'), ev('FOCUS TF1', { joinUrl: 'https://j/own' })], rules);
    expect(out[0]).toMatchObject({ owner: 'o', topic: 't', joinUrl: 'https://j/r' });
    expect(out[1].owner).toBeUndefined();
    expect(out[2].joinUrl).toBe('https://j/own');
  });
});
