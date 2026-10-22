import { isRecurring, rollRecurring } from '../../src/core/recurring';

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
  // @req FR:recurring-rows/roll.step
  it('rolls Dec to Jan with and without year', () => {
    expect(rollRecurring('- [ ] 📅 Dec 10, 2026: 🔄 Monthly: X', ref)).toBe('- [ ] 📅 Jan 11, 2027: 🔄 Monthly: X');
    expect(rollRecurring('- [ ] 📅 Dec 10: 🔄 Monthly: X', new Date(Date.UTC(2026, 5, 1)))).toBe('- [ ] 📅 Jan 11: 🔄 Monthly: X');
  });
  // @req FR:recurring-rows/roll.step @req FR:recurring-rows/roll.clamp
  it('handles Feb 29 yearly', () => {
    // Feb 28 2029 is Wed
    expect(rollRecurring('- [ ] 📅 Feb 29, 2028: 🔄 Yearly: X', ref)).toBe('- [ ] 📅 Feb 28, 2029: 🔄 Yearly: X');
  });
  // @req FR:recurring-rows/roll.clamp
  it('clamps to month end', () => {
    expect(rollRecurring('- [ ] 📅 Jan 31, 2028: 🔄 Monthly: X', ref)).toBe('- [ ] 📅 Feb 29, 2028: 🔄 Monthly: X');
    // Feb 28 2027 is Sun -> Mon Mar 1
    expect(rollRecurring('- [ ] 📅 Jan 31, 2027: 🔄 Monthly: X', ref)).toBe('- [ ] 📅 Mar 1, 2027: 🔄 Monthly: X');
  });
  // @req FR:recurring-rows/roll.weekend
  it('shifts weekends to Monday', () => {
    // Aug 15 2026 is Sat -> Mon Aug 17
    expect(rollRecurring('- [ ] 📅 Jul 15, 2026: 🔄 Monthly: X', ref)).toBe('- [ ] 📅 Aug 17, 2026: 🔄 Monthly: X');
    // Aug 16 2026 is Sun -> Mon Aug 17
    expect(rollRecurring('- [ ] 📅 Aug 9, 2026: 🔄 Weekly: X', ref)).toBe('- [ ] 📅 Aug 17, 2026: 🔄 Weekly: X');
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
