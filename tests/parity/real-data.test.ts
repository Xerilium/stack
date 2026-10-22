/**
 * Acceptance checks against a COPY of real legacy data. Skipped unless STACK_PARITY_CASE is set.
 * The folder holds `tasks/`, `golden.json` (from tests/fixtures/scoring/generate-golden.ps1), and optionally
 * `.xe/config/stack.json`. Read only. Output reports counts, never task text.
 * @req FR:cli/parity.script
 */
import * as fs from 'fs';
import * as path from 'path';
import { parseConfig } from '../../src/core/config';
import { emojiFormatter } from '../../src/core/formatter';
import { parseProject } from '../../src/core/parser';
import { activeTimeBlocks, byScore, legacyEngine, rankTasks, toScoringProject, weighProjects } from '../../src/core/scoring';

const CASE = process.env.STACK_PARITY_CASE;
const d = CASE ? describe : describe.skip;

d('real-data acceptance', () => {
  const tasksDir = path.join(CASE ?? '', 'tasks');
  const files = CASE ? fs.readdirSync(tasksDir).filter(f => f.endsWith('.md')).sort() : [];
  const cfgFile = path.join(CASE ?? '', '.xe/config/stack.json');
  const config = parseConfig(fs.existsSync(cfgFile) ? JSON.parse(fs.readFileSync(cfgFile, 'utf8')) : undefined);

  it('finds task files', () => expect(files.length).toBeGreaterThan(0));

  it.each(files.map((f, i) => [i, f]))('file #%s round-trips byte-exact', (_i, f) => {
    const src = fs.readFileSync(path.join(tasksDir, f as string), 'utf8');
    expect(emojiFormatter.serialize(emojiFormatter.parse(src)) === src).toBe(true);
    const p = parseProject(src);
    // Toggling every checkbox on and back must restore the bytes.
    const all = (ts: typeof p.sections[number]['tasks']): typeof ts => ts.flatMap(t => [t, ...all(t.children)]);
    const tasks = p.sections.flatMap(s => all(s.tasks));
    const orig = tasks.map(t => t.checked);
    tasks.forEach(t => p.setChecked(t, !t.checked));
    tasks.forEach((t, i) => p.setChecked(t, orig[i]));
    expect(p.lines.join('\n') === src).toBe(true);
  });

  describe('scoring golden', () => {
    const golden = JSON.parse(CASE ? fs.readFileSync(path.join(CASE, 'golden.json'), 'utf8') : '{}');
    const projects = files.map(f => toScoringProject(parseProject(fs.readFileSync(path.join(tasksDir, f), 'utf8')), path.basename(f, '.md')));
    const scored = legacyEngine.score(projects, config);
    const score = new Map<string, number>((golden.tasks ?? []).map((t: { id: string; score: number }) => [t.id, t.score]));
    // Legacy Sort-Object is not stable; compare equal-score groups as sets.
    const tieGroups = (ids: string[]): string[][] => {
      const out: string[][] = [];
      ids.forEach((id, i) => { if (i && score.get(ids[i - 1]) === score.get(id)) out[out.length - 1].push(id); else out.push([id]); });
      return out.map(g => g.sort());
    };

    it('project weights match', () => {
      expect(weighProjects(projects, config).sort((a, b) => b.weight - a.weight).map(w => [w.valueScore, w.calculatedPriority, w.weight]))
        .toEqual(golden.projects.map((w: { valueScore: number; calculatedPriority: number; weight: number }) => [w.valueScore, w.calculatedPriority, w.weight]));
    });

    it('every task score matches', () => {
      expect(scored.length).toBe(golden.tasks.length);
      const bad = golden.tasks.filter((g: { id: string; score: number; leaf: boolean; parked: boolean }) => {
        const s = scored.find(x => x.task.id === g.id);
        return !s || s.score !== g.score || s.leaf !== g.leaf || s.parked !== g.parked;
      });
      expect(bad.length).toBe(0);
    });

    it('ranking matches up to tie order', () => {
      expect(tieGroups(byScore(scored).map(s => s.task.id)) ).toEqual(tieGroups(golden.ranking));
    });

    it('time-filtered candidates match at every instant', () => {
      let n = 0;
      for (const f of golden.filtered) {
        const at = new Date(f.at);
        expect(activeTimeBlocks(config, at)).toEqual(f.activeBlocks);
        const same = JSON.stringify(tieGroups(rankTasks(legacyEngine, projects, config, at).map(s => s.task.id))) === JSON.stringify(tieGroups(f.ids));
        expect(same).toBe(true);
        n++;
      }
      expect(n).toBe(golden.filtered.length);
    });
  });
});
