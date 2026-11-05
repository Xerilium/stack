import { parseMeetings } from '../../src/core/meetings';

// @req FR:cos-view/meet.config
describe('parseMeetings', () => {
  const md = [
    '# Meetings', '', 'Notes here.',
    '- Mon 8:30-9 (biweekly): FTK GB; owner: `🧰 CoS`',
    '- Mon/Wed 9-10: Alloy personal training',
    '- Mon-Fri 12-1p: Xerilium sync with Brett; topic: Printer; owner: `🖨️ Prototype`; join: https://teams.microsoft.com/l/x',
    '- Mon 1-2:30: FOCUS maintainers',
    '- Sun/Mon/Wed 11p-1a: Allyte sync with Roland',
    '- Fri 13:00-14:30: Twenty-four',
    '- Someday 9-10: bad day',
    '- Mon 9: no end',
    '- Tue 8-9:30: Bad link; join: javascript:alert(1)',
  ].join('\n');
  const items = parseMeetings(md);
  it('parses days, ranges, biweekly, topic, owner, join', () => {
    expect(items[0]).toEqual({ title: 'FTK GB', days: [1], start: '08:30', end: '09:00', biweekly: true, owner: '🧰 CoS' });
    expect(items[1]).toMatchObject({ title: 'Alloy personal training', days: [1, 3], start: '09:00', end: '10:00' });
    expect(items[2]).toEqual({ title: 'Xerilium sync with Brett', days: [1, 2, 3, 4, 5], start: '12:00', end: '13:00', topic: 'Printer', owner: '🖨️ Prototype', join: 'https://teams.microsoft.com/l/x' });
  });
  it('reads am/pm by the rule, 24 h, and midnight crossing', () => {
    expect(items[3]).toMatchObject({ start: '13:00', end: '14:30' });
    expect(items[4]).toMatchObject({ days: [0, 1, 3], start: '23:00', end: '01:00' });
    expect(items[5]).toMatchObject({ start: '13:00', end: '14:30' });
  });
  it('skips bad lines and unsafe links', () => {
    expect(items.map((i) => i.title)).toEqual(['FTK GB', 'Alloy personal training', 'Xerilium sync with Brett', 'FOCUS maintainers', 'Allyte sync with Roland', 'Twenty-four', 'Bad link']);
    expect(items[6].join).toBeUndefined();
  });
});
