import { escapeRe, wordsRe } from '../../src/core/regex';

describe('regex helpers', () => {
  it('escapes every regex metacharacter', () => {
    const s = 'a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o';
    expect(new RegExp(`^${escapeRe(s)}$`).test(s)).toBe(true);
  });
  it('matches whole words only, case-insensitively', () => {
    const re = wordsRe('FH 0.10');
    expect(re.test('ship fh 0.10 tonight')).toBe(true);
    expect(re.test('FH 0.101')).toBe(false);
    expect(re.test('xFH 0.10')).toBe(false);
  });
});
