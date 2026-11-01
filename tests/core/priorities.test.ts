import { applyOverrides, parsePriorities, type PriorityRule } from '../../src/core/priorities';

const row = (project: string, text: string) => ({ project, text });
const A = row('Finance', 'Pay bills 💰💰💰💰');
const B = row('Allyte', 'Azure MVP onboarding');
const C = row('FOCUS', 'FOCUS issues triage');
const D = row('Flantastic 4', 'Rewrite Cid copy');
const at = new Date('2026-11-01T12:00:00Z');
const rules = (r: PriorityRule[]) => r;

describe('parsePriorities', () => {
  // @req FR:scoring-engine/overrides.@json @req FR:scoring-engine/overrides.invalid @req FR:scoring-engine/$priority-rule
  it('reads valid rules and skips unknown effects, empty matches, and bad dates; an unreadable file has none', () => {
    const t = JSON.stringify({ rules: [
      { match: 'FOCUS', effect: 'down', why: 'not now', by: 'owner' },
      { match: 'x', effect: 'sideways' }, { match: '  ', effect: 'top' }, { match: 'y', effect: 'hide', until: 'soon' },
      { match: 'z', effect: 'top', until: '2026-12-01' }, 'junk', null,
    ] });
    expect(parsePriorities(t).map((r) => r.match)).toEqual(['FOCUS', 'z']);
    expect(parsePriorities('{not json')).toEqual([]);
    expect(parsePriorities(JSON.stringify({ rules: 'no' }))).toEqual([]);
    expect(parsePriorities('')).toEqual([]);
  });
});

describe('applyOverrides', () => {
  // @req FR:scoring-engine/overrides.tiers @req FR:scoring-engine/overrides.@function
  it('top rows first, unmatched next, down last; engine order inside a tier', () => {
    const out = applyOverrides([C, D, A, B], rules([{ match: 'FOCUS', effect: 'down' }, { match: 'Pay bills', effect: 'top' }, { match: 'MVP onboarding', effect: 'top' }]), at);
    expect(out).toEqual([A, B, D, C]);
  });
  // @req FR:scoring-engine/overrides.match
  it('matches a project name or title, or a whole word or phrase of the text, case-insensitively', () => {
    const r = (m: string) => applyOverrides([D, A], [{ match: m, effect: 'top' }], at)[0];
    expect(r('finance')).toBe(A);
    expect(r('PAY BILLS')).toBe(A);
    expect(r('bill')).toBe(D); // not a whole word
    expect(r('Cid copy')).toBe(D);
  });
  // @req FR:scoring-engine/overrides.match
  it('also matches the text of the rows above (a leaf under "Pay bills")', () => {
    const leaf = { project: 'Finance', text: 'Mortgage $3,114', context: 'Pay bills 💰' };
    expect(applyOverrides([D, leaf], [{ match: 'Pay bills', effect: 'top' }], at)[0]).toBe(leaf);
  });
  // @req FR:scoring-engine/overrides.tiers
  it('top rows follow the order of their rules in the file', () => {
    expect(applyOverrides([A, B, D], [{ match: 'MVP onboarding', effect: 'top' }, { match: 'Pay bills', effect: 'top' }], at)).toEqual([B, A, D]);
  });
  // @req FR:scoring-engine/overrides.match.project
  it('a rule that names a project applies to that project only, not to rows that mention the word', () => {
    const ftk = row('FinOps toolkit', 'Sweep all FTK FOCUS 1.4 features');
    expect(applyOverrides([ftk, C, A], [{ match: 'FOCUS', effect: 'down' }], at)).toEqual([ftk, A, C]); // only the FOCUS project goes down
    expect(applyOverrides([ftk, A], [{ match: 'FOCUS 1.4', effect: 'down' }], at)).toEqual([A, ftk]); // not a project: a phrase in the text
  });
  // @req FR:scoring-engine/overrides.tiers
  it('inside a top rule, rows that match on their own come before rows that match only through a parent', () => {
    const goalLeaf = { project: 'Allyte', text: 'Draft the post', context: 'FinOps hubs FH 0.10 goals' };
    const release = { project: 'Allyte', text: 'FH 0.10 released', context: '' };
    expect(applyOverrides([goalLeaf, release], [{ match: 'FH 0.10', effect: 'top' }], at)).toEqual([release, goalLeaf]);
  });
  // @req FR:scoring-engine/overrides.match.first
  it('the first matching rule in file order decides', () => {
    expect(applyOverrides([C, A], [{ match: 'FOCUS', effect: 'top' }, { match: 'FOCUS', effect: 'down' }], at)[0]).toBe(C);
    expect(applyOverrides([C, A], [{ match: 'FOCUS', effect: 'down' }, { match: 'FOCUS', effect: 'top' }], at)[0]).toBe(A);
  });
  // @req FR:scoring-engine/overrides.hide
  it('hide removes the row', () => {
    expect(applyOverrides([C, A], [{ match: 'FOCUS', effect: 'hide' }], at)).toEqual([A]);
  });
  // @req FR:scoring-engine/overrides.until
  it('until is the owner day, not UTC: a rule until Nov 2 still applies at 8 pm Nov 1 in Los Angeles', () => {
    const rule: PriorityRule = { match: 'FOCUS', effect: 'down', until: '2026-11-02' };
    const evening = new Date('2026-11-02T04:00:00Z'); // 8 pm Nov 1 (PDT/PST)
    expect(applyOverrides([C, A], [rule], evening, undefined, 'America/Los_Angeles')).toEqual([A, C]);
    expect(applyOverrides([C, A], [rule], evening)).toEqual([C, A]); // UTC says Nov 2: expired
    expect(applyOverrides([C, A], [rule], new Date('2026-11-02T09:00:00Z'), undefined, 'America/Los_Angeles')).toEqual([C, A]); // midnight local has passed
  });
  // @req FR:scoring-engine/overrides.invalid
  it('skips a date that is not a calendar day and a match that is absurdly long', () => {
    expect(parsePriorities(JSON.stringify({ rules: [{ match: 'a', effect: 'top', until: '2026-02-31' }, { match: 'x'.repeat(101), effect: 'top' }, { match: 'ok', effect: 'top', until: '2026-02-28' }] })).map((r) => r.match)).toEqual(['ok']);
  });
  // @req FR:scoring-engine/overrides.until
  it('a rule stops applying on its until date', () => {
    const rule: PriorityRule = { match: 'FOCUS', effect: 'down', until: '2026-11-01' };
    expect(applyOverrides([C, A], [rule], new Date('2026-10-30T12:00:00Z'))).toEqual([A, C]);
    expect(applyOverrides([C, A], [rule], new Date('2026-11-02T12:00:00Z'))).toEqual([C, A]);
  });
});
