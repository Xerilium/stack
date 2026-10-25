import { parseConfig } from '../../src/core/config';
import { blockedOn, getEngine, legacyEngine, rankTasks, resolveBlockers, type ScoringProject } from '../../src/core/scoring';

const config = parseConfig();
const at = new Date('2026-10-23T17:00:00Z');
let n = 0;
const mk = (text: string, level = 0, project = 'P') => ({ id: `${project}_${n++}`, parent: null as string | null, text, level, project });
const project = (texts: string[], name = 'P'): ScoringProject => ({ name, value: [], weeklyCapacity: 40, capacity: {}, tasks: texts.map((t) => mk(t, 0, name)) });
const stack = getEngine('stack');
const ranked = (...ps: ScoringProject[]) => rankTasks(stack, ps, config, at);
const byText = (r: ReturnType<typeof ranked>, frag: string) => r.find((s) => s.task.text.includes(frag))!;
/** Score of a row once its own ⛔️ penalty is taken back out. */
const unpenalized = (p: ScoringProject, frag: string) => {
  const s = legacyEngine.score([p], config).find((x) => x.task.text.includes(frag))!;
  const pen = s.breakdown.emojiContributions.filter((c) => c.category === 'Status' && c.emoji === '⛔️').reduce((a, c) => a + c.value, 0);
  return s.score - pen / s.breakdown.effortHours;
};

// @req FR:scoring-engine/blockers.parse
describe('blockedOn', () => {
  it('reads the reason after --', () => {
    expect(blockedOn('⛔️ Phase 2 🟡 -- Pending phase 1')).toEqual(['phase 1']);
    expect(blockedOn('⛔️ Stack: Next steps 🟢 -- After set-engineering-tasks')).toEqual(['set-engineering-tasks']);
    expect(blockedOn('⛔️ Review -- Blocked on the Stack architectural review process')).toEqual(['the stack architectural review process']);
    expect(blockedOn('⛔ Email -- After FH release; draft ready; need 3 time windows')).toEqual(['fh release']);
  });
  it('splits several names and ignores other reasons', () => {
    expect(blockedOn('⛔️ X -- After A, B and C')).toEqual(['a', 'b', 'c']);
    expect(blockedOn('⛔️ X -- Pending automation & setup')).toEqual(['automation', 'setup']);
    expect(blockedOn('⛔️ X -- need licences')).toEqual([]);
    expect(blockedOn('Plain task')).toEqual([]);
  });
});

// @req FR:scoring-engine/blockers.resolve
describe('resolveBlockers', () => {
  it('points at a same-project task, exact title first, then whole word', () => {
    const p = project(['⛔️ Phase 2 🟡 -- Pending phase 1', 'Phase 1 🟡', 'Phase 10 later', 'Do automation first', '⛔️ Z -- After automation']);
    const e = resolveBlockers([p]);
    expect(e.get(p.tasks[0].id)).toEqual([p.tasks[1].id]);
    expect(e.get(p.tasks[4].id)).toEqual([p.tasks[3].id]);
  });
  it('adds no edge for ambiguous, unmatched, or self names; cross-project only on exact title', () => {
    const p = project(['⛔️ A -- After thing', 'The thing one', 'The thing two', '⛔️ B -- After nothing here', '⛔️ Loop -- After loop']);
    const q = project(['Release'], 'Q');
    const r = project(['⛔️ C -- After release', '⛔️ D -- After rel'], 'R');
    const e = resolveBlockers([p, q, r]);
    expect(e.get(p.tasks[0].id)).toBeUndefined();
    expect(e.get(p.tasks[3].id)).toBeUndefined();
    expect(e.get(p.tasks[4].id)).toBeUndefined();
    expect(e.get(r.tasks[0].id)).toEqual([q.tasks[0].id]);
    expect(e.get(r.tasks[1].id)).toBeUndefined();
  });
});

// @req FR:scoring-engine/blockers.inherit @req FR:scoring-engine/blockers.unchanged
describe('inheritance', () => {
  it('ranks a blocker at least as high as the task it blocks, without the blocked penalty', () => {
    const p = project(['Release gate 🟢', '🚨 ⛔️ Ship v2 🟢 -- After release gate', '🔺 Unrelated 🟢']);
    const r = ranked(p);
    expect(r.map((s) => s.task.text)).toEqual(['Release gate 🟢', '🔺 Unrelated 🟢']);
    expect(byText(r, 'Release gate').score).toBeCloseTo(unpenalized(p, 'Ship v2'), 10);
  });
  it('keeps a task that blocks nothing unchanged', () => {
    const p = project(['Alone 🟢', '🔺 Other 🟢']);
    const own = legacyEngine.score([p], config);
    const r = ranked(p);
    expect(byText(r, 'Alone').score).toBe(own[0].score);
  });
  it('legacy ignores blockers', () => {
    const p = project(['Release gate 🟢', '🚨 ⛔️ Ship v2 🟢 -- After release gate']);
    const r = rankTasks(legacyEngine, [p], config, at);
    expect(r[0].score).toBe(legacyEngine.score([p], config)[0].score);
  });
  it('is transitive and takes the max, never the sum (chain and diamond)', () => {
    const p = project(['A 🟢', '⛔️ B 🟢 -- After A', '🚨 ⛔️ C 🟢 -- After B', '⛔️ D 🟢 -- After A', '🔻 E 🟢']);
    const r = ranked(p);
    const a = byText(r, 'A 🟢').score;
    expect(a).toBeCloseTo(Math.max(unpenalized(p, 'C 🟢'), unpenalized(p, 'D 🟢')), 10);
    const sum = unpenalized(p, 'B 🟢') + unpenalized(p, 'C 🟢') + unpenalized(p, 'D 🟢');
    expect(a).toBeLessThan(sum);
  });
});

// @req FR:scoring-engine/blockers.eligible
describe('eligibility', () => {
  it('lends nothing from a parked, far-future, or later-start blocked task', () => {
    for (const lender of ['🚨 ⛔️ 🅿️ X 🟢 -- After gate', '🚨 ⛔️ 💤 Oct 30: X 🟢 -- After gate', '🚨 ⛔️ ⏰ Dec 1: X 🟢 -- After gate', '🚨 ⛔️ 📅 Mar 1, 2027: X 🟢 -- After gate']) {
      const p = project(['gate 🟢', lender]);
      expect(byText(ranked(p), 'gate').score).toBe(legacyEngine.score([p], config)[0].score);
    }
  });
  it('takes the due-soon tier of the blocked task', () => {
    const p = project(['gate 🟢', '⛔️ 📅 Oct 23: X 🟢 -- After gate', '🚨 Plain 🟢']);
    expect(ranked(p)[0].task.text).toBe('gate 🟢');
  });
});

// @req FR:scoring-engine/blockers.cycle
describe('cycles', () => {
  it('does not loop on cycles or self references', () => {
    const p = project(['⛔️ A 🟢 -- After B', '⛔️ B 🟢 -- After A', '⛔️ S 🟢 -- After S', 'Free 🟢']);
    expect(() => ranked(p)).not.toThrow();
  });
  it('still gives a blocker in front of a cycle the max over what it reaches', () => {
    const p = project(['Root 🟢', '🚨 ⛔️ A 🟢 -- After Root and B', '⛔️ B 🟢 -- After A']);
    const r = ranked(p);
    expect(byText(r, 'Root').score).toBeGreaterThanOrEqual(unpenalized(p, 'A 🟢') - 1e-9);
  });
});
