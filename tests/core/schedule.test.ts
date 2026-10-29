import { ConfigError, parseConfig, type TimeBlock } from '../../src/core/config';
import { blockKind, daySchedule } from '../../src/core/schedule';

const ALL = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'];
const b = (name: string, days: string[], startTime: string, endTime: string, emoji: string, extra: Partial<TimeBlock> = {}) => ({ name, days, startTime, endTime, emoji, ...extra });

// Michael's week: sleeps 02:00-08:00, project time 23:00-02:00.
const michael = parseConfig({
  timezone: 'America/Los_Angeles',
  timeBlocks: [
    b('Work', WEEK, '08:00', '16:00', '☀️'),
    b('Family evening', WEEK, '16:00', '20:00', '🏠', { label: 'Family', kind: 'personal' }),
    b('Family weekend', ['Sat', 'Sun'], '08:00', '20:00', '🏠', { label: 'Family', kind: 'personal' }),
    b('Shichael', ALL, '20:00', '23:00', '💕', { kind: 'personal' }),
    b('Project', ALL, '23:00', '02:00', '🌙'),
    b('Sleep', ALL, '02:00', '08:00', '😴'),
  ],
});

describe('blockKind', () => {
  // @req FR:schedule/profile.kind
  it('reads kind, else infers sleep from the name, label, or 😴, else focus', () => {
    expect(blockKind(b('Family', ALL, '16:00', '20:00', '🏠', { kind: 'personal' }) as TimeBlock)).toBe('personal');
    expect(blockKind(b('Sleep', ALL, '02:00', '08:00', '🛏') as TimeBlock)).toBe('sleep');
    expect(blockKind(b('Night', ALL, '02:00', '08:00', '🛏', { label: 'Asleep' }) as TimeBlock)).toBe('sleep');
    expect(blockKind(b('Night', ALL, '02:00', '08:00', '😴') as TimeBlock)).toBe('sleep');
    expect(blockKind(b('Work', ALL, '08:00', '16:00', '☀️') as TimeBlock)).toBe('focus');
  });

  // @req FR:schedule/profile.kind
  it('parseConfig keeps a valid kind and rejects any other', () => {
    const c = parseConfig({ timeBlocks: [b('Family', ALL, '16:00', '20:00', '🏠', { kind: 'personal' })] });
    expect(c.timeBlocks[0].kind).toBe('personal');
    expect(() => parseConfig({ timeBlocks: [{ ...b('X', ALL, '16:00', '20:00', '🏠'), kind: 'nap' }] })).toThrow(ConfigError);
    expect(() => parseConfig({ timeBlocks: [{ ...b('X', ALL, '16:00', '20:00', '🏠'), kind: 'nap' }] })).toThrow(/timeBlocks\[0\]\.kind/);
  });
});

describe('daySchedule', () => {
  // @req FR:schedule/profile.day @req FR:schedule/profile.wake @req FR:schedule/profile.contain
  it('at 23:12 the day runs to 02:00, not to the end of the work day', () => {
    const d = daySchedule(michael, new Date('2026-10-29T06:12:00Z')); // Wed Oct 28 23:12 PDT
    expect(d).toMatchObject({ date: '2026-10-28', wake: '2026-10-28T15:00:00.000Z', bed: '2026-10-29T09:00:00.000Z', asleep: false });
    expect(d.blocks.map((x) => [x.name, x.kind, x.start, x.end])).toEqual([
      ['Work', 'focus', '2026-10-28T15:00:00.000Z', '2026-10-28T23:00:00.000Z'],
      ['Family evening', 'personal', '2026-10-28T23:00:00.000Z', '2026-10-29T03:00:00.000Z'],
      ['Shichael', 'personal', '2026-10-29T03:00:00.000Z', '2026-10-29T06:00:00.000Z'],
      ['Project', 'focus', '2026-10-29T06:00:00.000Z', '2026-10-29T09:00:00.000Z'],
    ]);
    expect(d.blocks[1]).toMatchObject({ label: 'Family', emoji: '🏠' });
  });

  // @req FR:schedule/profile.contain
  it('at 01:00 it is still the previous date\'s day', () => {
    const d = daySchedule(michael, new Date('2026-10-29T08:00:00Z')); // Thu 01:00 PDT
    expect(d).toMatchObject({ date: '2026-10-28', asleep: false, bed: '2026-10-29T09:00:00.000Z' });
  });

  // @req FR:schedule/profile.contain
  it('in sleep time it returns the next waking day, marked asleep', () => {
    for (const at of ['2026-10-29T10:00:00Z', '2026-10-29T14:59:00Z']) { // Thu 03:00 and 07:59 PDT
      const d = daySchedule(michael, new Date(at));
      expect(d).toMatchObject({ date: '2026-10-29', wake: '2026-10-29T15:00:00.000Z', bed: '2026-10-30T09:00:00.000Z', asleep: true });
    }
  });

  // @req FR:schedule/profile.day
  it('uses each weekday\'s own blocks', () => {
    const c = parseConfig({
      timezone: 'America/Los_Angeles',
      timeBlocks: [
        b('Work', WEEK, '09:00', '17:00', '☀️'),
        b('Sleep', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'], '01:00', '07:00', '😴'),
        b('Sleep in', ['Sat', 'Sun'], '03:00', '10:00', '😴'),
      ],
    });
    const fri = daySchedule(c, new Date('2026-10-30T20:00:00Z')); // Fri 13:00 PDT
    expect(fri).toMatchObject({ date: '2026-10-30', wake: '2026-10-30T14:00:00.000Z', bed: '2026-10-31T10:00:00.000Z' });
    const sat = daySchedule(c, new Date('2026-10-31T20:00:00Z')); // Sat 13:00 PDT
    expect(sat).toMatchObject({ date: '2026-10-31', wake: '2026-10-31T17:00:00.000Z' });
    expect(sat.blocks).toEqual([]);
  });

  // @req FR:schedule/profile.wake
  it('merges sleep blocks that touch', () => {
    const c = parseConfig({ timezone: 'UTC', timeBlocks: [b('Sleep', ALL, '00:00', '06:00', '😴'), b('Doze', ALL, '06:00', '08:00', '💤', { kind: 'sleep' }), b('Late', ALL, '22:00', '00:00', '🌙', { kind: 'sleep' })] });
    const d = daySchedule(c, new Date('2026-10-28T12:00:00Z'));
    expect(d).toMatchObject({ date: '2026-10-28', wake: '2026-10-28T08:00:00.000Z', bed: '2026-10-28T22:00:00.000Z' });
  });

  // @req FR:schedule/profile.nosleep
  it('without a sleep block the day is startOfDay plus 16 hours', () => {
    const c = parseConfig({ timezone: 'UTC', startOfDay: '07:00', timeBlocks: [b('Work', ALL, '09:00', '17:00', '☀️')] });
    const d = daySchedule(c, new Date('2026-10-28T12:00:00Z'));
    expect(d).toMatchObject({ date: '2026-10-28', wake: '2026-10-28T07:00:00.000Z', bed: '2026-10-28T23:00:00.000Z', asleep: false });
    expect(d.blocks).toHaveLength(1);
    expect(daySchedule(c, new Date('2026-10-28T23:30:00Z'))).toMatchObject({ date: '2026-10-29', asleep: true });
    expect(daySchedule(c, new Date('2026-10-28T03:00:00Z'))).toMatchObject({ date: '2026-10-28', asleep: true });
  });

  // @req FR:schedule/profile.dst
  it('keeps local clock times across the fall-back change', () => {
    const sat = daySchedule(michael, new Date('2026-11-01T06:00:00Z')); // Sat Oct 31 23:00 PDT
    expect(sat).toMatchObject({ date: '2026-10-31', wake: '2026-10-31T15:00:00.000Z', bed: '2026-11-01T10:00:00.000Z' }); // bed 02:00 PST
    const sun = daySchedule(michael, new Date('2026-11-01T20:00:00Z')); // Sun 12:00 PST
    expect(sun).toMatchObject({ date: '2026-11-01', wake: '2026-11-01T16:00:00.000Z', bed: '2026-11-02T10:00:00.000Z' });
  });

  // @req FR:schedule/profile.wake
  it('a day with no sleep for over a day after wake ends 16 hours after wake', () => {
    const c = parseConfig({ timezone: 'UTC', timeBlocks: [b('Sleep', ['Sun', 'Mon', 'Tue', 'Wed', 'Thu'], '23:00', '07:00', '😴')] });
    const fri = daySchedule(c, new Date('2026-10-30T12:00:00Z')); // Fri
    expect(fri).toMatchObject({ date: '2026-10-30', wake: '2026-10-30T07:00:00.000Z', bed: '2026-10-30T23:00:00.000Z' });
  });

  // @req FR:schedule/profile.wake
  it('a nap neither ends nor starts the day; it comes back as personal time', () => {
    const c = parseConfig({ timezone: 'UTC', timeBlocks: [b('Sleep', ALL, '23:00', '07:00', '😴'), b('Nap', ALL, '13:00', '13:30', '😴')] });
    const d = daySchedule(c, new Date('2026-10-28T10:00:00Z'));
    expect(d).toMatchObject({ date: '2026-10-28', wake: '2026-10-28T07:00:00.000Z', bed: '2026-10-28T23:00:00.000Z', asleep: false });
    expect(d.blocks).toEqual([{ name: 'Nap', emoji: '😴', kind: 'personal', start: '2026-10-28T13:00:00.000Z', end: '2026-10-28T13:30:00.000Z' }]);
  });

  // @req FR:schedule/profile.dst
  it('on the spring-forward night a 02:00 bed is 03:00 PDT, not an hour early', () => {
    const sat = daySchedule(michael, new Date('2026-03-08T07:30:00Z')); // Sat Mar 7 23:30 PST
    expect(sat).toMatchObject({ date: '2026-03-07', bed: '2026-03-08T10:00:00.000Z' }); // 03:00 PDT
  });
});
