import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { parseConfig } from '../../src/core/config';
import { parseProject } from '../../src/core/parser';
import { autopriEngine, autopriParts } from '../../src/core/autopri';
import { applyTags, matchTruth, parseTruth } from '../../src/core/autopri-tags';
import { toScoringProject } from '../../src/core/scoring';

const FIX = join(__dirname, '../fixtures/auto-priority');
const TRUTH = readFileSync(join(FIX, 'truth.md'), 'utf8');

describe('applyTags', () => {
  // @req FR:auto-priority/tag.unblocker
  it('adds 🔓 once and removes it', () => {
    const on = applyTags('- [ ] Ship it 🟡', { unblocker: true });
    expect(on).toBe('- [ ] Ship it 🟡 🔓');
    expect(applyTags(on, { unblocker: true })).toBe(on);
    expect(applyTags(on, { unblocker: false })).toBe('- [ ] Ship it 🟡');
  });
  // @req FR:auto-priority/tag.due
  it('sets, replaces, and clears the due marker; rejects bad formats', () => {
    const a = applyTags('- [ ] Ship it', { due: 'Nov 12' });
    expect(a).toBe('- [ ] 📅 Nov 12: Ship it');
    expect(applyTags(a, { due: 'Dec 1' })).toBe('- [ ] 📅 Dec 1: Ship it');
    expect(applyTags(a, { due: null })).toBe('- [ ] Ship it');
    expect(() => applyTags(a, { due: 'next week' })).toThrow(/MMM d/);
  });
});

describe('truth', () => {
  // @req FR:auto-priority/truth.parse
  it('parses table rows with numeric or dash rank', () => {
    const t = parseTruth(TRUTH);
    expect(t.map((r) => [r.rank, r.project])).toEqual([[1, 'catalyst'], [4, 'ftk'], [6, 'focus'], [null, 'todo'], [2, 'atlas'], [3, 'birch'], [5, 'quill'], [8, 'hz']]);
    expect(t[0].why).toMatch(/unblocks/);
  });
  // @req FR:auto-priority/truth.match @req FR:auto-priority/truth.report
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
  // @req FR:autopri-tagging/truth.match @req FR:autopri-tagging/truth.report
  it('names the Hard date, flags a speeds row, and matches a words anchor and an alias', () => {
    const rows = [
      { project: 'Quill', aliases: [], text: 'Quill v2.0 editor polish', context: '', ref: 'tasks/quill.md:3' },
      { project: 'Birch', aliases: [], text: 'Harden the nightly importer retries', context: '' },
      { project: 'Horizon', aliases: ['hz'], text: 'Trim the build cache', context: '' },
    ];
    const r = matchTruth(parseTruth(TRUTH), rows);
    const item = (project: string) => r.find((x) => x.item.project === project)!;

    const dated = item('atlas');
    expect(dated).toMatchObject({ status: 'missing' });
    expect(dated.suggest).toContain('stack add');
    expect(dated.suggest).toContain('Nov 12');

    const speeds = item('quill');
    expect(speeds).toMatchObject({ status: 'untagged', actual: 1 });
    expect(speeds.suggest).toContain('stack tag');

    expect(item('birch')).toMatchObject({ status: 'ranked', actual: 2 });
    expect(item('hz')).toMatchObject({ status: 'ranked', actual: 3 });
  });
});

describe('autopriParts', () => {
  // @req FR:auto-priority/explain.parts
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
