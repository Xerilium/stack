import { isRecurring, rollRecurring } from '../../src/core/recurring';

const ref = new Date(Date.UTC(2026, 0, 1));

describe('isRecurring', () => {
  it('detects 🔄 rows with a cadence', () => {
    expect(isRecurring('- [ ] 📅 Feb 15: 🔄 Monthly: Pay bills 🔹')).toBe(true);
    expect(isRecurring('- [ ] 📅 Feb 15: Pay bills')).toBe(false);
  });
});

describe('rollRecurring', () => {
  it('rolls monthly', () => {
    expect(rollRecurring('- [x] 📅 Feb 10, 2026: 🔄 Monthly: Pay bills 🔹', ref))
      .toBe('- [ ] 📅 Mar 10, 2026: 🔄 Monthly: Pay bills 🔹');
  });
  it('infers year from reference date when omitted', () => {
    expect(rollRecurring('- [ ] 📅 Feb 10: 🔄 Monthly: Pay bills', ref))
      .toBe('- [ ] 📅 Mar 10: 🔄 Monthly: Pay bills');
  });
  it('rolls weekly, daily, quarterly, yearly', () => {
    expect(rollRecurring('- [ ] 📅 Mar 2, 2026: 🔄 Weekly: X', ref)).toContain('Mar 9, 2026');
    expect(rollRecurring('- [ ] 📅 Mar 2, 2026: 🔄 Daily: X', ref)).toContain('Mar 3, 2026');
    expect(rollRecurring('- [ ] 📅 Mar 2, 2026: 🔄 Quarterly: X', ref)).toContain('Jun 2, 2026');
    expect(rollRecurring('- [ ] 📅 Mar 2, 2026: 🔄 Yearly: X', ref)).toContain('Mar 2, 2027');
  });
  it('clamps to month end', () => {
    expect(rollRecurring('- [ ] 📅 Jan 31, 2026: 🔄 Monthly: X', ref)).toContain('Feb 28, 2026');
  });
  it('shifts weekends to Monday', () => {
    // Jul 15 2026 is Wed; Aug 15 2026 is Sat -> Mon Aug 17
    expect(rollRecurring('- [ ] 📅 Jul 15, 2026: 🔄 Monthly: X', ref)).toContain('Aug 17, 2026');
  });
  it('resets subtasks and preserves other text', () => {
    const out = rollRecurring('- [x] 📅 Mar 2, 2026: 🔄 Weekly: X 🟢\n  - [x] sub', ref);
    expect(out).toBe('- [ ] 📅 Mar 9, 2026: 🔄 Weekly: X 🟢\n  - [ ] sub');
  });
  it('returns null for non-recurring', () => {
    expect(rollRecurring('- [ ] Plain', ref)).toBeNull();
  });
});
