import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { parseConfig } from '../../src/core/config';
import { parseProject } from '../../src/core/parser';
import { autopriEngine, autopriParts } from '../../src/core/autopri';
import { applyTags, matchTruth, parseTruth } from '../../src/core/autopri-tags';
import { toScoringProject } from '../../src/core/scoring';

const FIX = join(__dirname, '../fixtures/auto-priority');
const TRUTH = `| Rank | Project  | Work | Hard date | Why |
| ---- | -------- | ---- | --------- | --- |
| 1    | catalyst | 0.3.4 release: automated PR sweeps via Catalyst | next | Sweep fails slow everything; unblocks FH.com |
| 4    | ftk      | Update authored v16 PRs; review non-authored v16 PRs | - | Pipeline |
| 6    | focus    | v1.6 ramp-up (see task file) | - | Commitment |
| -    | todo     | Anything that keeps PR sweeps running until Cat 0.3.4 | - | Enabler for rank 1 |
`;

describe('applyTags', () => {
  // @req FR:autopri-tagging/tag.unblocker
  it('adds 🔓 once and removes it', () => {
    const on = applyTags('- [ ] Ship it 🟡', { unblocker: true });
    expect(on).toBe('- [ ] Ship it 🟡 🔓');
    expect(applyTags(on, { unblocker: true })).toBe(on);
    expect(applyTags(on, { unblocker: false })).toBe('- [ ] Ship it 🟡');
  });
  // @req FR:autopri-tagging/tag.due
  it('sets, replaces, and clears the due marker; rejects bad formats', () => {
    const a = applyTags('- [ ] Ship it', { due: 'Nov 12' });
    expect(a).toBe('- [ ] 📅 Nov 12: Ship it');
    expect(applyTags(a, { due: 'Dec 1' })).toBe('- [ ] 📅 Dec 1: Ship it');
    expect(applyTags(a, { due: null })).toBe('- [ ] Ship it');
    expect(() => applyTags(a, { due: 'next week' })).toThrow(/MMM d/);
  });
});

describe('truth', () => {
  // @req FR:autopri-tagging/truth.parse
  it('parses table rows with numeric or dash rank', () => {
    const t = parseTruth(TRUTH);
    expect(t.map((r) => [r.rank, r.project])).toEqual([[1, 'catalyst'], [4, 'ftk'], [6, 'focus'], [null, 'todo']]);
    expect(t[0].why).toMatch(/unblocks/);
  });
  // @req FR:autopri-tagging/truth.match @req FR:autopri-tagging/truth.report
  it('reports ranked, untagged, and missing items', () => {
    const rows = [
      { project: 'Catalyst', aliases: ['cat'], text: 'Catalyst 0.3.4 release 🟡', context: '' },
      { project: 'FOCUS', aliases: [], text: 'FOCUS v1.6 ramp-up 🟡', context: '' },
    ];
    const r = matchTruth(parseTruth(TRUTH), rows);
    const by = (rank: number | null, p: string) => r.find((x) => x.item.rank === rank && x.item.project === p)!;
    expect(by(1, 'catalyst')).toMatchObject({ status: 'untagged', actual: 1, row: 0 });
    expect(by(6, 'focus')).toMatchObject({ status: 'ranked', actual: 2 });
    expect(by(4, 'ftk')).toMatchObject({ status: 'missing' });
    expect(by(4, 'ftk').suggest).toContain('stack add ftk');
    expect(by(1, 'catalyst').suggest).toContain('stack tag');
  });
  it('does not match a v1.6 anchor to v16', () => {
    const r = matchTruth(parseTruth(TRUTH), [{ project: 'FOCUS', aliases: [], text: 'FOCUS v16 thing', context: '' }]);
    expect(r.find((x) => x.item.project === 'focus')!.status).toBe('missing');
  });
});

describe('autopriParts', () => {
  // @req FR:autopri-tagging/explain.parts
  it('sums to the engine score before blockers lift', () => {
    const config = parseConfig();
    const at = new Date('2026-11-05T12:00:00Z');
    const dir = join(FIX, 'tasks');
    const projects = readdirSync(dir).filter((n) => n.endsWith('.md')).sort().map((n) => toScoringProject(parseProject(readFileSync(join(dir, n), 'utf8')), n.replace(/\.md$/, '')));
    const all = autopriEngine.score(projects, config);
    const parts = autopriParts(all, projects, config, at);
    const ranked = autopriEngine.rank!(all, projects, config, at, { ignoreBlocks: true });
    expect(ranked.length).toBeGreaterThan(0);
    for (const s of ranked) {
      const p = parts.get(s.task.id)!;
      expect(p.unblock + p.urgency + p.value).toBeLessThanOrEqual(s.score + 1e-9);
    }
    const cat = ranked.find((s) => s.task.text.includes('0.3.4'))!;
    expect(parts.get(cat.task.id)!.unblock).toBeGreaterThan(0);
  });
});
