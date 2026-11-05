import { readFileSync } from 'fs';
import { join } from 'path';
import { applyOverrides, parsePriorities } from '../../src/core/priorities';
import { checkMisses, parseMisses, pickMatch, untaggedTasks } from '../../src/core/autopri';
import type { ScoredTask } from '../../src/core/scoring';

const FIX = join(__dirname, '../fixtures/auto-priority');
const text = readFileSync(join(FIX, 'priorities.json'), 'utf8');
const rules = parsePriorities(text);
const row = (project: string, t: string, context?: string) => ({ project, text: t, ...(context ? { context } : {}) });
const NOV2 = new Date('2026-11-02T12:00:00Z');
const NOV4 = new Date('2026-11-04T12:00:00Z');

describe('real priorities.json', () => {
  // @req FR:auto-priority/rules.fixture
  it('parses with no rule skipped', () => {
    expect(rules).toHaveLength((JSON.parse(text) as { rules: unknown[] }).rules.length);
    expect(rules.length).toBeGreaterThan(10);
  });
  // @req FR:auto-priority/rules.effects
  it('hides, downs, and tops rows as the owner said', () => {
    const rows = [
      row('FOCUS', 'FOCUS issues triage'),
      row('Printer', 'Daily trade review'),
      row('Allyte', 'Fix FH 406 bug'),
      row('Allyte', 'Review FH 4060 notes'),
      row('Finance', 'Pay USAA'),
      row('Finance', 'Pay BECU'),
      row('Allyte', 'Send FH preview signup emails'),
      row('Allyte', 'Azure MVP onboarding'),
      row('Home', 'Plain task'),
    ];
    const out = applyOverrides(rows, rules, NOV2).map((r) => r.text);
    expect(out).toEqual(['Send FH preview signup emails', 'Review FH 4060 notes', 'Plain task', 'FOCUS issues triage', 'Pay BECU', 'Azure MVP onboarding']);
  });
  // @req FR:auto-priority/rules.expired
  it('stops a top rule on its until date', () => {
    const rows = [row('Home', 'Plain task'), row('Allyte', 'Send FH preview signup emails'), row('Allyte', 'FTK v15 announcement')];
    expect(applyOverrides(rows, rules, NOV2).map((r) => r.text)[0]).toBe('Send FH preview signup emails');
    expect(applyOverrides(rows, rules, NOV4).map((r) => r.text)).toEqual(['Plain task', 'Send FH preview signup emails', 'FTK v15 announcement']);
  });
});

const scored = (t: string, contribs: string[], parked = false, leaf = true): ScoredTask => ({
  task: { id: t, parent: null, text: t, level: 0, project: 'P' }, leaf, parked, score: 1,
  breakdown: { emojiContributions: contribs.map((category) => ({ category, emoji: 'x', value: 1 })), projectBonus: 0, placementBonus: 0, baseScore: 0, effortHours: 1, calculatedTotal: 1 },
});

describe('untaggedTasks', () => {
  // @req FR:auto-priority/tags.untagged @req FR:auto-priority/tags.@function
  it('returns leaves with no Value, Impact, or Priority', () => {
    const a = scored('a', []); const b = scored('b', ['Value']); const c = scored('c', ['Effort']); const d = scored('d', ['Priority']);
    expect(untaggedTasks([a, b, c, d, scored('e', [], false, false)]).map((s) => s.task.text)).toEqual(['a', 'c']);
  });
  // @req FR:auto-priority/tags.parked
  it('skips parked leaves', () => {
    expect(untaggedTasks([scored('p', [], true)])).toEqual([]);
  });
});

describe('pickMatch', () => {
  const ranked = [row('A', 'Pay bills'), row('A', 'Leaf', 'FH 0.10 goals'), row('A', 'Other')];
  // @req FR:auto-priority/picks.match @req FR:auto-priority/picks.@function
  it('counts picks in the top n by text or context, whole words', () => {
    expect(pickMatch(ranked, ['pay bills', 'FH 0.10', 'Other', 'bill'], 2)).toEqual({ hits: ['pay bills', 'FH 0.10'], misses: ['Other', 'bill'], n: 2 });
    expect(pickMatch(ranked, ['Other']).hits).toEqual(['Other']);
  });
});

describe('misses', () => {
  const misses = parseMisses(readFileSync(join(FIX, 'cos-state.md'), 'utf8'));
  // @req FR:auto-priority/misses.parse @req FR:auto-priority/misses.@function
  it('parses only miss lines under the heading', () => {
    expect(misses).toEqual([
      { date: '2026-11-02', above: 'Pay bills', below: 'FOCUS issues' },
      { date: '2026-11-02', above: 'FH open announcement', below: 'Weekly review' },
    ]);
    expect(parseMisses('- 2026-11-02: "a" over "b"')).toEqual([]);
  });
  // @req FR:auto-priority/misses.check
  it('returns the misses still wrong', () => {
    const ok = [row('F', 'Pay bills'), row('FOCUS', 'FOCUS issues triage'), row('A', 'FH open announcement')];
    expect(checkMisses(ok, misses)).toEqual([]); // second: below row absent = correct
    const bad = [row('FOCUS', 'FOCUS issues triage'), row('F', 'Pay bills'), row('A', 'Weekly review'), row('A', 'FH open announcement')];
    expect(checkMisses(bad, misses)).toEqual(misses);
    expect(checkMisses([row('F', 'Pay bills')], [misses[1]])).toEqual([misses[1]]); // above absent
  });
});

describe('ground truth 2026-11-05', () => {
  const gt = parseMisses(readFileSync(join(FIX, 'ground-truth.md'), 'utf8'));
  const order = ['Catalyst 0.3.4 release', 'finops-hubs 0.10 and allyte-web', 'v15 blog co-author ack', 'Update v16 PRs', 'Christmas After Dark album', 'FOCUS v1.6 ramp-up'].map((t) => row('P', t));
  // @req FR:auto-priority/picks.match @req FR:auto-priority/misses.check
  it("ranks 1-6 in the owner's order pass; a swapped order fails the pair", () => {
    expect(gt).toHaveLength(5);
    expect(checkMisses(order, gt)).toEqual([]);
    const swapped = [order[1], order[0], ...order.slice(2)];
    expect(checkMisses(swapped, gt)).toEqual([gt[0], gt[1]]);
    expect(pickMatch(order, ['Catalyst 0.3.4', 'finops-hubs 0.10', 'v15 blog', 'v16 PRs', 'Christmas After Dark', 'FOCUS v1.6'], 6).misses).toEqual([]);
  });
});
