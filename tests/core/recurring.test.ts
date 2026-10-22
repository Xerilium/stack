import { isRecurring, parseRecurringRow, rollRecurring } from '../../src/core/recurring';

const ref = new Date(Date.UTC(2026, 0, 1));

// @req FR:recurring-rows/detect.@function
describe('isRecurring', () => {
  // @req FR:recurring-rows/detect.non-recurring
  it('detects 🔄 rows with a cadence', () => {
    expect(isRecurring('- [ ] 📅 Feb 15: 🔄 Monthly: Pay bills 🔹', ref)).toBe(true);
    expect(isRecurring('- [ ] 📅 Feb 15: Pay bills', ref)).toBe(false);
  });
  // @req FR:recurring-rows/detect.valid
  it('agrees with rollRecurring on invalid dates', () => {
    for (const r of ['Feb 31, 2026', 'Jan 0, 2026', 'Foo 5, 2026', 'Feb 29, 2026']) {
      const row = `- [ ] 📅 ${r}: 🔄 Monthly: X`;
      expect(rollRecurring(row, ref)).toBeNull();
      expect(isRecurring(row, ref)).toBe(false);
    }
  });
  // @req FR:recurring-rows/format.crlf
  it('accepts CRLF blocks', () => {
    expect(isRecurring('- [ ] 📅 Feb 15: 🔄 Monthly: X\r\n  - [ ] a\r\n', ref)).toBe(true);
  });
});

// @req FR:recurring-rows/roll.@function
describe('rollRecurring', () => {
  // @req FR:recurring-rows/format.row @req FR:recurring-rows/roll.step
  it('rolls monthly', () => {
    expect(rollRecurring('- [x] 📅 Feb 10, 2026: 🔄 Monthly: Pay bills 🔹', ref))
      .toBe('- [ ] 📅 Mar 10, 2026: 🔄 Monthly: Pay bills 🔹');
  });
  // @req FR:recurring-rows/format.row
  it('infers year from reference date when omitted', () => {
    expect(rollRecurring('- [ ] 📅 Feb 10: 🔄 Monthly: Pay bills', ref))
      .toBe('- [ ] 📅 Mar 10: 🔄 Monthly: Pay bills');
  });
  // @req FR:recurring-rows/roll.step @req FR:recurring-rows/format.cadence
  it('rolls weekly, daily, quarterly, yearly', () => {
    expect(rollRecurring('- [ ] 📅 Mar 2, 2026: 🔄 Weekly: X', ref)).toBe('- [ ] 📅 Mar 9, 2026: 🔄 Weekly: X');
    expect(rollRecurring('- [ ] 📅 Mar 2, 2026: 🔄 Daily: X', ref)).toBe('- [ ] 📅 Mar 3, 2026: 🔄 Daily: X');
    expect(rollRecurring('- [ ] 📅 Mar 2, 2026: 🔄 Quarterly: X', ref)).toBe('- [ ] 📅 Jun 2, 2026: 🔄 Quarterly: X');
    expect(rollRecurring('- [ ] 📅 Mar 2, 2026: 🔄 Yearly: X', ref)).toBe('- [ ] 📅 Mar 2, 2027: 🔄 Yearly: X');
  });
  // @req FR:recurring-rows/format.cadence
  it('accepts lower/upper cadence and lowercase month', () => {
    expect(rollRecurring('- [ ] 📅 mar 2, 2026: 🔄 weekly: X', ref)).toBe('- [ ] 📅 Mar 9, 2026: 🔄 weekly: X');
    expect(rollRecurring('- [ ] 📅 MAR 2, 2026: 🔄 WEEKLY: X', ref)).toBe('- [ ] 📅 Mar 9, 2026: 🔄 WEEKLY: X');
  });
  // @req FR:recurring-rows/roll.step @req FR:recurring-rows/roll.yearless
  it('rolls Dec to Jan with and without year', () => {
    expect(rollRecurring('- [ ] 📅 Dec 10, 2026: 🔄 Monthly: X', ref)).toBe('- [ ] 📅 Jan 11, 2027: 🔄 Monthly: X <!--nominal:2027-01-10-->');
    expect(rollRecurring('- [ ] 📅 Dec 10: 🔄 Monthly: X', new Date(Date.UTC(2026, 5, 1)))).toBe('- [ ] 📅 Jan 11: 🔄 Monthly: X <!--nominal:2027-01-10-->');
  });
  // @req FR:recurring-rows/roll.step @req FR:recurring-rows/roll.clamp
  it('handles Feb 29 yearly', () => {
    // Feb 28 2029 is Wed
    expect(rollRecurring('- [ ] 📅 Feb 29, 2028: 🔄 Yearly: X', ref)).toBe('- [ ] 📅 Feb 28, 2029: 🔄 Yearly: X <!--nominal:2029-02-28 day:29-->');
  });
  // @req FR:recurring-rows/roll.clamp
  it('clamps to month end', () => {
    expect(rollRecurring('- [ ] 📅 Jan 31, 2028: 🔄 Monthly: X', ref)).toBe('- [ ] 📅 Feb 29, 2028: 🔄 Monthly: X <!--nominal:2028-02-29 day:31-->');
    // Feb 28 2027 is Sun -> Mon Mar 1
    expect(rollRecurring('- [ ] 📅 Jan 31, 2027: 🔄 Monthly: X', ref)).toBe('- [ ] 📅 Mar 1, 2027: 🔄 Monthly: X <!--nominal:2027-02-28 day:31-->');
  });
  // @req FR:recurring-rows/roll.weekend
  it('shifts weekends to Monday', () => {
    // Aug 15 2026 is Sat -> Mon Aug 17
    expect(rollRecurring('- [ ] 📅 Jul 15, 2026: 🔄 Monthly: X', ref)).toBe('- [ ] 📅 Aug 17, 2026: 🔄 Monthly: X <!--nominal:2026-08-15-->');
    // Aug 16 2026 is Sun -> Mon Aug 17
    expect(rollRecurring('- [ ] 📅 Aug 9, 2026: 🔄 Weekly: X', ref)).toBe('- [ ] 📅 Aug 17, 2026: 🔄 Weekly: X <!--nominal:2026-08-16-->');
  });
  // @req FR:recurring-rows/roll.nominal
  it('weekly month wrap has no clamp marker', () => {
    expect(rollRecurring('- [x] 📅 Jan 26, 2026: 🔄 Weekly: a', ref)).toBe('- [ ] 📅 Feb 2, 2026: 🔄 Weekly: a');
    expect(rollRecurring('- [x] 📅 Jan 29, 2026: 🔄 Daily: a', ref)).not.toContain('day:');
  });
  // @req FR:recurring-rows/preserve.unchecked @req FR:recurring-rows/preserve.text @req FR:recurring-rows/preserve.subtasks
  it('resets subtasks and preserves other text', () => {
    const out = rollRecurring('- [x] 📅 Mar 2, 2026: 🔄 Weekly: X 🟢\n  - [x] sub', ref);
    expect(out).toBe('- [ ] 📅 Mar 9, 2026: 🔄 Weekly: X 🟢\n  - [ ] sub');
  });
  // @req FR:recurring-rows/preserve.unchecked
  it('unchecks [X]', () => {
    expect(rollRecurring('- [X] 📅 Mar 2, 2026: 🔄 Weekly: X', ref)).toBe('- [ ] 📅 Mar 9, 2026: 🔄 Weekly: X');
  });
  // @req FR:recurring-rows/preserve.subtasks
  it('resets mixed and deeper-indented subtasks', () => {
    const out = rollRecurring('- [x] 📅 Mar 2, 2026: 🔄 Weekly: X\n  - [x] a\n  - [ ] b\n    - [X] c', ref);
    expect(out).toBe('- [ ] 📅 Mar 9, 2026: 🔄 Weekly: X\n  - [ ] a\n  - [ ] b\n    - [ ] c');
  });
  // @req FR:recurring-rows/preserve.subtasks
  it('leaves non-checkbox continuation lines alone', () => {
    const out = rollRecurring('- [x] 📅 Mar 2, 2026: 🔄 Weekly: X\n  > note [x] here\n  - [x] a', ref);
    expect(out).toBe('- [ ] 📅 Mar 9, 2026: 🔄 Weekly: X\n  > note [x] here\n  - [ ] a');
  });
  // @req FR:recurring-rows/format.crlf
  it('preserves CRLF line endings', () => {
    const out = rollRecurring('- [x] 📅 Mar 2, 2026: 🔄 Weekly: X\r\n  - [x] a\r\n', ref);
    expect(out).toBe('- [ ] 📅 Mar 9, 2026: 🔄 Weekly: X\r\n  - [ ] a\r\n');
  });
  // @req FR:recurring-rows/detect.non-recurring
  it('returns null for non-recurring', () => {
    expect(rollRecurring('- [ ] Plain', ref)).toBeNull();
  });
  // @req FR:recurring-rows/detect.valid
  it('returns null for invalid dates', () => {
    expect(rollRecurring('- [ ] 📅 Feb 31, 2026: 🔄 Monthly: X', ref)).toBeNull();
    expect(rollRecurring('- [ ] 📅 Jan 0, 2026: 🔄 Monthly: X', ref)).toBeNull();
    expect(rollRecurring('- [ ] 📅 Foo 5, 2026: 🔄 Monthly: X', ref)).toBeNull();
  });
});

const S = (b: string, o?: { shiftWeekends?: boolean }) => rollRecurring(b, ref, o);

// @req FR:recurring-rows/format.legacy
describe('legacy row form', () => {
  it('rolls and keeps the form', () => {
    expect(S('- [x] 🔄 Monthly: 📅 Feb 10, 2026: Pay 🔹')).toBe('- [ ] 🔄 Monthly: 📅 Mar 10, 2026: Pay 🔹');
    expect(isRecurring('- [ ] 🔄 Weekly: 📅 Mondays: Check in 🔹', ref)).toBe(true);
  });
  it('rejects invalid dates', () => {
    expect(S('- [ ] 🔄 Monthly: 📅 Feb 31, 2026: X')).toBeNull();
  });
});

// @req FR:recurring-rows/format.weekday
describe('weekday names', () => {
  it('unchecks and resets subtasks, text unchanged', () => {
    expect(S('- [x] 🔄 Weekly: 📅 Mondays: Check in 🔹\n  - [x] a')).toBe('- [ ] 🔄 Weekly: 📅 Mondays: Check in 🔹\n  - [ ] a');
    expect(S('- [X] 📅 monday: 🔄 weekly: X')).toBe('- [ ] 📅 monday: 🔄 weekly: X');
    expect(S('- [x] 📅 Tue: 🔄 Weekly: X')).toBe('- [ ] 📅 Tue: 🔄 Weekly: X');
  });
  it('only valid on Weekly with a real weekday', () => {
    expect(S('- [x] 🔄 Monthly: 📅 Mondays: X')).toBeNull();
    expect(S('- [x] 🔄 Weekly: 📅 Fundays: X')).toBeNull();
    expect(isRecurring('- [ ] 🔄 Weekly: 📅 Mondays: X', ref)).toBe(true);
  });
});

// @req FR:recurring-rows/format.eom
describe('Quarterly-EOM+1', () => {
  it('rolls to month end 3 months later', () => {
    expect(S('- [x] 📅 Jan 31, 2026: 🔄 Quarterly-EOM+1: Taxes')).toBe('- [ ] 📅 Apr 30, 2026: 🔄 Quarterly-EOM+1: Taxes');
    expect(S('- [x] 📅 Apr 30, 2026: 🔄 quarterly-eom+1: Taxes')).toBe('- [ ] 📅 Jul 31, 2026: 🔄 quarterly-eom+1: Taxes');
  });
  // @req FR:recurring-rows/roll.nominal
  it('recovers the nominal month end from a weekend-shifted Monday', () => {
    // Jan 31 2027 is Sun, shown Mon Feb 1
    expect(S('- [x] 📅 Feb 1, 2027: 🔄 Quarterly-EOM+1: Taxes')).toBe('- [ ] 📅 Apr 30, 2027: 🔄 Quarterly-EOM+1: Taxes');
    // Jul 31 2027 is Sat -> Mon Aug 2
    expect(S('- [x] 📅 Apr 30, 2027: 🔄 Quarterly-EOM+1: T')).toBe('- [ ] 📅 Aug 2, 2027: 🔄 Quarterly-EOM+1: T <!--nominal:2027-07-31-->');
  });
  it('works in legacy form and parses to anchor', () => {
    expect(S('- [x] 🔄 Quarterly-EOM+1: 📅 Jan 31, 2026: T')).toBe('- [ ] 🔄 Quarterly-EOM+1: 📅 Apr 30, 2026: T');
    expect(parseRecurringRow('- [ ] 📅 Jan 31, 2026: 🔄 Quarterly-EOM+1: T', ref)?.recurrence)
      .toEqual({ cadence: 'quarterly', anchor: 'end-of-month', offsetMonths: 1 });
  });
  // @req FR:recurring-rows/detect.parse
  it('maps EOM+1 to offsetMonths, never offsetDays, in both forms', () => {
    for (const l of ['- [ ] 📅 Jan 31, 2026: 🔄 Quarterly-EOM+1: T', '- [ ] 🔄 quarterly-eom+1: 📅 Jan 31, 2026: T']) {
      const r = parseRecurringRow(l, ref)!.recurrence;
      expect(r.offsetMonths).toBe(1);
      expect(r.offsetDays).toBeUndefined();
    }
    expect(parseRecurringRow('- [ ] 📅 Jan 31, 2026: 🔄 Quarterly: T', ref)!.recurrence).toEqual({ cadence: 'quarterly' });
  });
});

// @req FR:recurring-rows/roll.nominal @req FR:recurring-rows/roll.weekend
describe('nominal day anti-drift', () => {
  it('weekend shift does not drift and marker clears', () => {
    const a = S('- [x] 📅 Jul 15, 2026: 🔄 Monthly: X')!;
    expect(a).toBe('- [ ] 📅 Aug 17, 2026: 🔄 Monthly: X <!--nominal:2026-08-15-->');
    expect(S(a)).toBe('- [ ] 📅 Sep 15, 2026: 🔄 Monthly: X');
  });
  it('weekly Sunday keeps rolling by 7 from nominal', () => {
    const a = S('- [x] 📅 Aug 9, 2026: 🔄 Weekly: X')!;
    expect(S(a)).toBe('- [ ] 📅 Aug 24, 2026: 🔄 Weekly: X <!--nominal:2026-08-23-->');
  });
  // @req FR:recurring-rows/roll.clamp
  it('clamp does not drift', () => {
    const a = S('- [x] 📅 Jan 31, 2028: 🔄 Monthly: X')!;
    expect(S(a)).toBe('- [ ] 📅 Mar 31, 2028: 🔄 Monthly: X');
  });
  it('Feb 29 returns after clamped years', () => {
    let r = '- [x] 📅 Feb 29, 2028: 🔄 Yearly: X';
    for (let i = 0; i < 4; i++) r = S(r)!;
    expect(r).toBe('- [ ] 📅 Mar 1, 2032: 🔄 Yearly: X <!--nominal:2032-02-29-->');
  });
  it('daily skips the weekend without a marker', () => {
    const a = S('- [x] 📅 Aug 14, 2026: 🔄 Daily: X')!;
    expect(a).toBe('- [ ] 📅 Aug 17, 2026: 🔄 Daily: X');
    expect(S(a)).toBe('- [ ] 📅 Aug 18, 2026: 🔄 Daily: X');
  });
  it('year-less rows keep the marker year', () => {
    expect(S('- [x] 📅 Jul 15: 🔄 Monthly: X')).toBe('- [ ] 📅 Aug 17: 🔄 Monthly: X <!--nominal:2026-08-15-->');
  });
  it('ignores a stale marker after a hand edit', () => {
    expect(S('- [x] 📅 Oct 1, 2026: 🔄 Monthly: X <!--nominal:2026-08-15-->')).toBe('- [ ] 📅 Nov 2, 2026: 🔄 Monthly: X <!--nominal:2026-11-01-->');
  });
  it('rejects an invalid marker', () => {
    expect(S('- [x] 📅 Aug 17, 2026: 🔄 Monthly: X <!--nominal:2026-02-31-->')).toBeNull();
  });
});

// @req FR:recurring-rows/roll.weekend
describe('shiftWeekends option', () => {
  it('off: weekend dates stay, no marker', () => {
    expect(S('- [x] 📅 Jul 15, 2026: 🔄 Monthly: X', { shiftWeekends: false })).toBe('- [ ] 📅 Aug 15, 2026: 🔄 Monthly: X');
  });
  it('off: clamp state is still kept', () => {
    expect(S('- [x] 📅 Jan 31, 2028: 🔄 Monthly: X', { shiftWeekends: false }))
      .toBe('- [ ] 📅 Feb 29, 2028: 🔄 Monthly: X <!--nominal:2028-02-29 day:31-->');
  });
  it('explicit true equals default', () => {
    expect(S('- [x] 📅 Jul 15, 2026: 🔄 Monthly: X', { shiftWeekends: true })).toBe(S('- [x] 📅 Jul 15, 2026: 🔄 Monthly: X'));
  });
});

// @req FR:recurring-rows/preserve.text @req FR:recurring-rows/format.crlf
describe('lossless edit', () => {
  it('keeps odd spacing, tabs, trailing space, and other lines byte-exact', () => {
    const b = '\t- [x] 📅 Mar 2, 2026: 🔄 Weekly:  X   🔹  \n\t\t- [x] a  \n\n  note  - [x] z\n   \n';
    expect(S(b)).toBe('\t- [ ] 📅 Mar 9, 2026: 🔄 Weekly:  X   🔹  \n\t\t- [ ] a  \n\n  note  - [x] z\n   \n');
  });
  it('CRLF with marker', () => {
    expect(S('- [x] 📅 Jul 15, 2026: 🔄 Monthly: X\r\n  - [x] a\r\n'))
      .toBe('- [ ] 📅 Aug 17, 2026: 🔄 Monthly: X <!--nominal:2026-08-15-->\r\n  - [ ] a\r\n');
    expect(S('- [x] 📅 Aug 17, 2026: 🔄 Monthly: X <!--nominal:2026-08-15-->\r\n'))
      .toBe('- [ ] 📅 Sep 15, 2026: 🔄 Monthly: X\r\n');
  });
  it('mixed line endings preserved', () => {
    expect(S('- [x] 📅 Mar 2, 2026: 🔄 Weekly: X\n  - [x] a\r\n  - [x] b\n')).toBe('- [ ] 📅 Mar 9, 2026: 🔄 Weekly: X\n  - [ ] a\r\n  - [ ] b\n');
  });
});

// @req FR:recurring-rows/detect.parse
describe('parseRecurringRow', () => {
  it('maps to task-model Recurrence', () => {
    const p = parseRecurringRow('- [ ] 📅 Aug 17, 2026: 🔄 Monthly: X <!--nominal:2026-08-15-->', ref)!;
    expect(p.form).toBe('canonical');
    expect(p.recurrence).toEqual({ cadence: 'monthly', nominalDay: '2026-08-15' });
    expect(p.dueDate).toBe('2026-08-17');
    const w = parseRecurringRow('- [ ] 🔄 Weekly: 📅 Mondays: X', ref)!;
    expect(w.form).toBe('legacy');
    expect(w.recurrence).toEqual({ cadence: 'weekly', weekdays: ['mon'] });
    expect(w.dueDate).toBeUndefined();
    expect(parseRecurringRow('- [ ] Plain', ref)).toBeNull();
  });
});
