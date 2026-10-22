import * as fs from 'fs';
import * as path from 'path';
import { parseConfig } from '../../src/core/config';
import { parseProject } from '../../src/core/parser';
import {
  ScoringError, ScoringProject, ScoringTask, ScoringEngine, ScoredTask,
  extractEmojis, legacyEngine, registerEngine, getEngine, listEngines, toScoringProject,
  weighProjects, isParked, activeTimeBlocks, filterByTimeBlock, rankTasks, byScore,
} from '../../src/core/scoring';

const config = parseConfig();

let seq = 0;
const task = (text: string, parent: string | null = null, project = 'P', id = `${project}_t${seq++}`): ScoringTask =>
  ({ id, parent, text, level: parent ? 1 : 0, project });
const proj = (name: string, tasks: ScoringTask[], extra: Partial<ScoringProject> = {}): ScoringProject =>
  ({ name, value: [], weeklyCapacity: 40, capacity: {}, tasks, ...extra });
const scoreOne = (text: string, extra: Partial<ScoringProject> = {}): ScoredTask =>
  legacyEngine.score([proj('P', [task(text)], extra)], config)[0];

// @req FR:scoring-engine/$task-emojis
describe('extractEmojis', () => {
  // @req FR:scoring-engine/emojis.@function @req FR:scoring-engine/emojis.input @req FR:scoring-engine/emojis.output
  // @req FR:scoring-engine/emojis.categories
  it('groups emojis by category', () => {
    const e = extractEmojis('‼️ Fix 🟢 ⬆️ 🚧 📅 ☀️', config);
    expect(e.Priority).toEqual(['‼️']);
    expect(e.Effort).toEqual(['🟢']);
    expect(e.Impact).toEqual(['⬆️']);
    expect(e.Status).toEqual(['🚧']);
    expect(e.Special).toEqual(['📅']);
    expect(e.TimeBlocks).toEqual(['☀️']);
    expect(e.Value).toEqual([]);
  });

  it('reports effort emojis in legacy category order, not text order', () => {
    expect(extractEmojis('🔴 x 🟢', config).Effort).toEqual(['🟢', '🔴']);
  });

  // @req FR:scoring-engine/emojis.value-repeat
  it('counts repeated value emojis', () => {
    expect(extractEmojis('💰💰🌱', config).Value).toEqual(['💰', '💰', '🌱']);
    expect(extractEmojis('‼️‼️', config).Priority).toEqual(['‼️']);
  });

  // @req FR:scoring-engine/emojis.timeblocks
  it('reads time-block emojis from config and repeats shared ones per block', () => {
    expect(extractEmojis('🏠 chores', config).TimeBlocks).toEqual(['🏠', '🏠']);
    const custom = parseConfig({ timeBlocks: [{ name: 'A', days: ['Mon'], startTime: '09:00', endTime: '10:00', emoji: '🧪' }] });
    expect(extractEmojis('🧪 ☀️', custom).TimeBlocks).toEqual(['🧪']);
  });
});

// @req FR:scoring-engine/$scoring-project @req FR:scoring-engine/$scoring-task @req FR:scoring-engine/$scored-task
describe('legacy engine scoring', () => {
  // @req FR:scoring-engine/score.@function @req FR:scoring-engine/score.input @req FR:scoring-engine/score.output
  // @req FR:scoring-engine/score.formula @req FR:scoring-engine/score.breakdown
  it('divides emoji + project + placement by effort and reports a breakdown', () => {
    const [s] = legacyEngine.score([proj('P', [task('‼️ x 🟢')])], config);
    expect(s.score).toBe((10 + 0 + 0.1) / 0.5);
    expect(s.breakdown).toEqual({
      emojiContributions: [{ category: 'Priority', emoji: '‼️', value: 10 }],
      projectBonus: 0, placementBonus: 0.1, baseScore: 10.1, effortHours: 0.5, calculatedTotal: s.score,
    });
    expect(s.leaf).toBe(true);
    expect(s.parked).toBe(false);
  });

  // @req FR:scoring-engine/score.aggregate
  it('aggregates emojis from ancestors', () => {
    const parent = task('🎯 Outcome ‼️', null, 'P', 'P_a');
    const child = task('step 🟢', 'P_a', 'P', 'P_b');
    const scored = legacyEngine.score([proj('P', [parent, child])], config);
    const c = scored.find(s => s.task.id === 'P_b')!;
    expect(c.breakdown.emojiContributions.map(e => e.emoji).sort()).toEqual(['‼️', '🎯'].sort());
  });

  // @req FR:scoring-engine/score.aggregate.single
  it('takes the highest status and impact only', () => {
    const s = scoreOne('🚧 ⏳ ⬆️ ⬇️ x');
    expect(s.breakdown.emojiContributions).toEqual([
      { category: 'Status', emoji: '🚧', value: 10 },
      { category: 'Impact', emoji: '⬆️', value: 10 },
    ]);
  });

  it('keeps a negative status when it is the only one', () => {
    expect(scoreOne('⏳ x').breakdown.emojiContributions).toEqual([{ category: 'Status', emoji: '⏳', value: -2 }]);
  });

  // @req FR:scoring-engine/score.aggregate.multi
  it('counts each unique priority and special emoji once', () => {
    const s = scoreOne('🔝 🚨 🎯 📅 x');
    const total = s.breakdown.emojiContributions.reduce((a, e) => a + e.value, 0);
    expect(total).toBe(1000 + 15 + 10 + 2);
  });

  // @req FR:scoring-engine/score.aggregate.value
  it('counts every value occurrence including ancestors', () => {
    const parent = task('💰 parent', null, 'P', 'P_a');
    const child = task('💰💰 child', 'P_a', 'P', 'P_b');
    const c = legacyEngine.score([proj('P', [parent, child])], config).find(s => s.task.id === 'P_b')!;
    expect(c.breakdown.emojiContributions.filter(e => e.emoji === '💰')).toHaveLength(3);
  });

  // @req FR:scoring-engine/score.aggregate.effort
  it('does not add effort emoji weights', () => {
    expect(scoreOne('🔹 x').breakdown.emojiContributions).toEqual([]);
  });

  // @req FR:scoring-engine/score.timeblock-weight
  it('defaults time-block weight to 8, applies timeBlocks.default, then per-emoji overrides', () => {
    const w = (cfg: unknown) => legacyEngine.score([proj('P', [task('☀️ 🌙 x')])], parseConfig(cfg))[0]
      .breakdown.emojiContributions.map(e => `${e.emoji}${e.value}`);
    expect(w(undefined)).toEqual(['☀️8', '🌙8']);
    expect(w({ taskScoring: { emojiWeights: { timeBlocks: { default: 3 } } } })).toEqual(['☀️3', '🌙3']);
    expect(w({ taskScoring: { emojiWeights: { timeBlocks: { default: 3, '🌙': 20 } } } })).toEqual(['☀️3', '🌙20']);
    expect(w({ taskScoring: { emojiWeights: { timeBlocks: { default: 0 } } } })).toEqual(['☀️8', '🌙8']);
  });

  // @req FR:scoring-engine/score.project-value
  it('sums project value emoji weights', () => {
    const [w] = weighProjects([proj('P', [], { value: ['💰', '💰', '⏱️'] })], config);
    expect(w.valueScore).toBe(25 + 25 + 8);
    expect(w.calculatedPriority).toBe(100 - 58);
  });

  // @req FR:scoring-engine/score.project-weight
  it('ranks projects by tier and gives reverse-rank weights, ties in input order', () => {
    const ps = [
      proj('cap', [], { weeklyCapacity: 10 }),
      proj('prio', [], { explicitPriority: 5 }),
      proj('val', [], { value: ['🌱'] }),
      proj('zero', [], { weeklyCapacity: 0 }),
      proj('val2', [], { value: ['🌱'] }),
    ];
    const w = Object.fromEntries(weighProjects(ps, config).map(p => [p.name, p.weight]));
    // calculated: cap 90, prio 5, val 95, zero 50, val2 95
    expect(w).toEqual({ prio: 4, zero: 3, cap: 2, val: 1, val2: 0 });
  });

  it('adds the project weight to task scores', () => {
    const ps = [proj('A', [task('x 🟡', null, 'A')]), proj('B', [task('x 🟡', null, 'B')], { value: ['💰'] })];
    const s = legacyEngine.score(ps, config);
    // legacy: a valueless project at default capacity (60) outranks a valued one (75)
    expect(s.find(t => t.task.project === 'A')!.breakdown.projectBonus).toBe(1);
    expect(s.find(t => t.task.project === 'B')!.breakdown.projectBonus).toBe(0);
  });

  // @req FR:scoring-engine/score.placement
  it('gives leaf tasks a descending placement bonus within the project', () => {
    const t = [task('a'), task('b'), task('c')];
    const s = legacyEngine.score([proj('P', t)], config);
    expect(s.map(x => x.breakdown.placementBonus)).toEqual([0.3, 0.2, 0.1]);
  });

  it('gives parents no placement bonus and does not count them', () => {
    const p = task('parent', null, 'P', 'P_a');
    const s = legacyEngine.score([proj('P', [p, task('kid', 'P_a'), task('kid2', 'P_a')])], config);
    expect(s.map(x => x.breakdown.placementBonus)).toEqual([0, 0.2, 0.1]);
    expect(s[0].leaf).toBe(false);
  });

  // @req FR:scoring-engine/score.effort @req FR:scoring-engine/score.effort.own
  it('uses own effort, defaulting to one hour', () => {
    expect(scoreOne('x 🟠').breakdown.effortHours).toBe(2);
    expect(scoreOne('x').breakdown.effortHours).toBe(1);
    expect(scoreOne('x 🔴 🟢').breakdown.effortHours).toBe(0.5);
  });

  it('sums incomplete leaf effort under the root for descendants when there is no outcome marker', () => {
    const r = task('root', null, 'P', 'P_r');
    const s = legacyEngine.score([proj('P', [r, task('a 🟡', 'P_r'), task('b 🟠', 'P_r')])], config);
    expect(s.map(x => x.breakdown.effortHours)).toEqual([1, 3, 3]);
  });

  it('skips complete leaves and falls back to own effort when none remain', () => {
    const r = task('root', null, 'P', 'P_r');
    const a: ScoringTask = { ...task('a 🟡', 'P_r', 'P', 'P_a'), complete: true };
    const b: ScoringTask = { ...task('b 🟠', 'P_r', 'P', 'P_b') };
    let s = legacyEngine.score([proj('P', [r, a, b])], config);
    expect(s.find(x => x.task.id === 'P_b')!.breakdown.effortHours).toBe(2);
    const b2: ScoringTask = { ...b, complete: true };
    s = legacyEngine.score([proj('P', [r, a, b2])], config);
    expect(s.find(x => x.task.id === 'P_b')!.breakdown.effortHours).toBe(2);
  });

  // @req FR:scoring-engine/score.effort.parent
  it('uses the highest outcome ancestor', () => {
    const outer = task('🎯 outer', null, 'P', 'P_o');
    const inner = task('🎯 inner', 'P_o', 'P', 'P_i');
    const leaf1 = task('l1 🟢', 'P_i', 'P', 'P_l1');
    const leaf2 = task('l2 🔴', 'P_o', 'P', 'P_l2');
    const s = legacyEngine.score([proj('P', [outer, inner, leaf1, leaf2])], config);
    expect(s.find(x => x.task.id === 'P_l1')!.breakdown.effortHours).toBe(4.5);
  });

  // @req FR:scoring-engine/score.validate
  it('rejects a non-positive effort divisor', () => {
    const bad = parseConfig({ taskScoring: { effortHours: { '🟢': 0 } } });
    expect(() => legacyEngine.score([proj('P', [task('x 🟢')])], bad)).toThrow(ScoringError);
  });
});

describe('filtering', () => {
  // @req FR:scoring-engine/filter.parked
  it('detects parked tasks directly and through ancestors', () => {
    const p = task('⏰ later', null, 'P', 'P_p');
    const kid = task('kid', 'P_p', 'P', 'P_k');
    const blocked = task('⛔️ stuck');
    const parked = legacyEngine.score([proj('P', [p, kid, blocked, task('🅿️ idea'), task('💤 Jan 5: nap'), task('fine')])], config);
    expect(parked.map(s => s.parked)).toEqual([true, true, true, true, true, false]);
    expect(isParked(kid, [p, kid])).toBe(true);
  });

  // @req FR:scoring-engine/filter.parked
  it('inherits ⛔️ parking through an ancestor', () => {
    const top = task('⛔️ blocked', null, 'P', 'P_t');
    const mid = task('mid', 'P_t', 'P', 'P_m');
    const leaf = task('leaf', 'P_m', 'P', 'P_l');
    expect(legacyEngine.score([proj('P', [top, mid, leaf])], config).map(s => s.parked)).toEqual([true, true, true]);
    expect(isParked(leaf, [top, mid, leaf])).toBe(true);
  });

  const at = (iso: string) => new Date(iso);

  // @req FR:scoring-engine/filter.blocks
  it('resolves active blocks in the configured timezone', () => {
    expect(activeTimeBlocks(config, at('2026-10-21T17:00:00Z'))).toEqual(['Work']);
    expect(activeTimeBlocks(config, at('2026-10-22T07:00:00Z'))).toEqual(['Project']);
    expect(activeTimeBlocks(config, at('2026-10-24T17:00:00Z'))).toEqual(['Family weekend']);
  });

  it('treats the block end as inclusive and overlapping blocks as simultaneously active', () => {
    expect(activeTimeBlocks(config, at('2026-10-21T23:00:00Z'))).toEqual(['Work', 'Family evening']);
    expect(activeTimeBlocks(config, at('2026-10-21T23:00:01Z'))).toEqual(['Family evening']);
  });

  it('uses only the current day for overnight blocks', () => {
    const c = parseConfig({ timeBlocks: [{ name: 'Late', days: ['Fri'], startTime: '23:00', endTime: '02:00', emoji: '🌙' }] });
    expect(activeTimeBlocks(c, at('2026-10-24T06:30:00Z'))).toEqual(['Late']); // Fri 23:30 PDT
    expect(activeTimeBlocks(c, at('2026-10-24T08:30:00Z'))).toEqual([]); // Sat 01:30 PDT
  });

  const cands = (projects: ScoringProject[]) => legacyEngine.score(projects, config);
  const kept = (projects: ScoringProject[], when: string) =>
    legacyEngine.filter(cands(projects), projects, config, at(when)).map(s => s.task.text);
  const WORK = '2026-10-21T17:00:00Z';
  const EVENING = '2026-10-21T23:30:00Z';

  // @req FR:scoring-engine/filter.time @req FR:scoring-engine/filter.time.critical
  it('always keeps critical tasks', () => {
    const p = proj('P', [task('🚨 ☀️ a'), task('🚨 🌙 b')]);
    expect(kept([p], EVENING)).toEqual(['🚨 ☀️ a', '🚨 🌙 b']);
  });

  // @req FR:scoring-engine/filter.time.emoji-active
  it('keeps an active-block emoji task when the project has no capacity lines or lists the block', () => {
    const t = task('☀️ day');
    expect(kept([proj('P', [t])], WORK)).toEqual(['☀️ day']);
    expect(kept([proj('P', [t], { capacity: { Work: 1 } })], WORK)).toEqual(['☀️ day']);
    expect(kept([proj('P', [t], { capacity: { Sleep: 1 } })], WORK)).toEqual([]);
  });

  // @req FR:scoring-engine/filter.time.emoji-inactive
  it('drops tasks whose time-block emoji is not active', () => {
    expect(kept([proj('P', [task('☀️ day')])], EVENING)).toEqual([]);
  });

  it('maps a shared emoji to its first configured block', () => {
    expect(kept([proj('P', [task('🏠 chore')])], EVENING)).toEqual(['🏠 chore']);
    expect(kept([proj('P', [task('🏠 chore')])], '2026-10-24T17:00:00Z')).toEqual([]);
  });

  // @req FR:scoring-engine/filter.time.capacity
  it('filters emoji-less tasks by project capacity', () => {
    const t = task('plain');
    expect(kept([proj('P', [t])], WORK)).toEqual(['plain']);
    expect(kept([proj('P', [t], { capacity: { Work: 2 } })], WORK)).toEqual(['plain']);
    expect(kept([proj('P', [t], { capacity: { Sleep: 2 } })], WORK)).toEqual([]);
  });

  // @req FR:scoring-engine/filter.capacity
  it('ignores capacity for blocks missing from the config', () => {
    const t = task('plain');
    expect(kept([proj('P', [t], { capacity: { Bogus: 2 } })], WORK)).toEqual(['plain']);
  });

  // @req FR:scoring-engine/filter.time.unknown-project
  it('keeps tasks of unknown projects', () => {
    const scored = cands([proj('P', [task('plain'), task('☀️ day')])]);
    expect(legacyEngine.filter(scored, [], config, at(WORK)).map(s => s.task.text)).toEqual(['plain', '☀️ day']);
  });
});

describe('rankTasks', () => {
  // @req FR:scoring-engine/rank.@function @req FR:scoring-engine/rank.order
  it('returns unparked leaves sorted by score, ties in input order, time-filtered when given an instant', () => {
    const p = proj('P', [
      task('a 🟡'), task('b 🟡'), task('🅿️ parked ‼️'), task('☀️ day 🟡'), task('🎯 parent', null, 'P', 'P_par'), task('kid ‼️', 'P_par'),
    ]);
    const all = rankTasks(legacyEngine, [p], config).map(s => s.task.text);
    expect(all).toEqual(['kid ‼️', '☀️ day 🟡', 'a 🟡', 'b 🟡']);
    const evening = rankTasks(legacyEngine, [p], config, new Date('2026-10-21T23:30:00Z')).map(s => s.task.text);
    expect(evening).toEqual(['kid ‼️', 'a 🟡', 'b 🟡']);
    expect(byScore([{ score: 1 }, { score: 2 }] as ScoredTask[]).map(s => s.score)).toEqual([2, 1]);
  });
});

describe('engine registry', () => {
  // @req FR:scoring-engine/engine.interface @req FR:scoring-engine/engine.registry
  it('defaults to legacy and accepts new engines', () => {
    expect(getEngine().id).toBe('legacy');
    expect(getEngine('legacy')).toBe(legacyEngine);
    const e: ScoringEngine = {
      id: 'flat',
      score: ps => ps.flatMap(p => p.tasks.map(t => ({
        task: t, leaf: true, parked: false, score: 1,
        breakdown: { emojiContributions: [], projectBonus: 0, placementBonus: 0, baseScore: 1, effortHours: 1, calculatedTotal: 1 },
      }))),
      filter: s => s,
    };
    registerEngine(e);
    expect(getEngine('flat')).toBe(e);
    expect(listEngines()).toEqual(expect.arrayContaining(['legacy', 'flat']));
    expect(rankTasks(getEngine('flat'), [proj('P', [task('x')])], config)).toHaveLength(1);
  });

  // @req FR:scoring-engine/engine.unknown
  it('throws for unknown engines', () => {
    expect(() => getEngine('nope')).toThrow(ScoringError);
  });
});

describe('toScoringProject', () => {
  const src = [
    '# 🧪 Name', '', '- **Project value:** 💰💰 🌱', '- **Weekly capacity:** 12', '- **Project priority:** 3',
    '- **Work capacity:** 2h', '- **Sleep capacity:** 1.5h', '', '## 🔄 Active', '',
    '- [ ] top 🟡', '  - [ ] child', '    - [ ] grandchild', '- [x] done', '  - [ ] orphan', '- [ ] after', '',
    '## ⏭️ Up next', '', '- [ ] ignored', '',
  ].join('\n');

  // @req FR:scoring-engine/load.@function @req FR:scoring-engine/load.name
  it('names the project from the title or the fallback', () => {
    expect(toScoringProject(parseProject(src)).name).toBe('🧪 Name');
    expect(toScoringProject(parseProject('## 🔄 Active\n- [ ] a\n'), 'my file').name).toBe('my file');
  });

  // @req FR:scoring-engine/load.name
  it('replaces hyphens in the fallback name and ignores an H1 that is not on line 1', () => {
    expect(toScoringProject(parseProject('## 🔄 Active\n- [ ] a\n'), 'my-hyphen-file').name).toBe('my hyphen file');
    expect(toScoringProject(parseProject('\n# Late\n## 🔄 Active\n- [ ] a\n'), 'some-file').name).toBe('some file');
  });

  // @req FR:scoring-engine/load.tasks @req FR:scoring-engine/load.name
  it('handles CRLF and a BOM', () => {
    const p = toScoringProject(parseProject('\uFEFF# Crlf\r\n\r\n- **Weekly capacity:** 5\r\n\r\n## 🔄 Active\r\n- [ ] a\r\n  - [ ] b\r\n'));
    expect(p.name).toBe('Crlf');
    expect(p.weeklyCapacity).toBe(5);
    expect(p.tasks.map(x => x.text)).toEqual(['a', 'b']);
  });

  // @req FR:scoring-engine/load.metadata @req FR:scoring-engine/filter.capacity
  it('reads value, capacity, priority, and capacity lines', () => {
    const p = toScoringProject(parseProject(src));
    expect(p.value).toEqual(['💰', '💰', '🌱']);
    expect(p.weeklyCapacity).toBe(12);
    expect(p.explicitPriority).toBe(3);
    expect(p.capacity).toEqual({ Work: 2, Sleep: 1.5 });
  });

  it('defaults weekly capacity to 40', () => {
    const p = toScoringProject(parseProject('# X\n\n## 🔄 Active\n'));
    expect(p.weeklyCapacity).toBe(40);
    expect(p.explicitPriority).toBeUndefined();
    expect(p.tasks).toEqual([]);
  });

  // @req FR:scoring-engine/load.tasks
  it('takes unchecked Active tasks in document order with legacy ids, levels, and parents', () => {
    const p = toScoringProject(parseProject(src));
    expect(p.tasks.map(t => [t.id, t.text, t.level, t.parent])).toEqual([
      ['🧪 Name_task_0', 'top 🟡', 0, null],
      ['🧪 Name_task_1', 'child', 1, '🧪 Name_task_0'],
      ['🧪 Name_task_2', 'grandchild', 2, '🧪 Name_task_1'],
      // legacy: checked parent is skipped, so the orphan attaches to the last open task
      ['🧪 Name_task_3', 'orphan', 1, '🧪 Name_task_0'],
      ['🧪 Name_task_4', 'after', 0, null],
    ]);
    expect(p.tasks.every(t => t.project === '🧪 Name')).toBe(true);
  });

  it('halves raw indentation and counts a tab as one character', () => {
    const p = toScoringProject(parseProject('# X\n\n## 🔄 Active\n- [ ] a\n\t- [ ] tab\n    - [ ] four\n'));
    expect(p.tasks.map(t => [t.text, t.level, t.parent])).toEqual([['a', 0, null], ['tab', 0, null], ['four', 2, 'X_task_1']]);
  });

  it('skips lines the legacy pattern rejects', () => {
    const p = toScoringProject(parseProject('# X\n\n## 🔄 Active\n- [ ]nospace\n- [ ] ok\n'));
    expect(p.tasks.map(t => t.text)).toEqual(['ok']);
  });
});

function parity(tasksDir: string, goldenFile: string): void {
  const golden = JSON.parse(fs.readFileSync(goldenFile, 'utf8'));
  const files = fs.readdirSync(tasksDir).filter(f => f.endsWith('.md')).sort();
  const projects = files.map(f =>
    toScoringProject(parseProject(fs.readFileSync(path.join(tasksDir, f), 'utf8')), path.basename(f, '.md')));
  const scored = legacyEngine.score(projects, config);

  it('matches project weights in legacy rank order', () => {
    const w = weighProjects(projects, config).sort((a, b) => b.weight - a.weight);
    expect(w).toEqual(golden.projects);
  });

  it('matches every task score and breakdown', () => {
    expect(scored.map(s => s.task.id).sort()).toEqual(golden.tasks.map((t: { id: string }) => t.id).sort());
    for (const g of golden.tasks) {
      const s = scored.find(x => x.task.id === g.id)!;
      expect([g.id, s.task.text, s.task.parent, s.leaf, s.parked]).toEqual([g.id, g.text, g.parent, g.leaf, g.parked]);
      expect([g.id, s.score]).toEqual([g.id, g.score]);
      const b = g.breakdown;
      expect(s.breakdown.projectBonus).toBe(b.projectBonus);
      expect(s.breakdown.placementBonus).toBeCloseTo(b.placementBonus, 12);
      expect(s.breakdown.effortHours).toBeCloseTo(b.effortHours, 12);
      expect(s.breakdown.baseScore).toBeCloseTo(b.baseScore, 12);
      expect(s.breakdown.calculatedTotal).toBeCloseTo(b.calculatedTotal, 12); // legacy computes this in decimal
      const key = (e: { category: string; emoji: string; value: number }) => `${e.category}|${e.emoji}|${e.value}`;
      expect(s.breakdown.emojiContributions.map(key).sort()).toEqual(b.emojiContributions.map(key).sort());
    }
  });

  // Legacy Sort-Object is not stable, so equal scores come out in arbitrary order; compare tie groups as sets.
  const score = new Map<string, number>(golden.tasks.map((t: { id: string; score: number }) => [t.id, t.score]));
  const tieGroups = (ids: string[]): string[][] => {
    const out: string[][] = [];
    ids.forEach((id, i) => { if (i && score.get(ids[i - 1]) === score.get(id)) out[out.length - 1].push(id); else out.push([id]); });
    return out.map(g => g.sort());
  };

  it('matches the ranking up to tie order', () => {
    expect(tieGroups(byScore(scored).map(s => s.task.id))).toEqual(tieGroups(golden.ranking));
  });

  it('matches time-filtered candidates at every instant', () => {
    for (const f of golden.filtered) {
      const at = new Date(f.at);
      expect([f.at, activeTimeBlocks(config, at)]).toEqual([f.at, f.activeBlocks]);
      expect([f.at, tieGroups(rankTasks(legacyEngine, projects, config, at).map(s => s.task.id))]).toEqual([f.at, tieGroups(f.ids)]);
    }
  });
}

const fixtures = path.join(__dirname, '..', 'fixtures', 'scoring');
// @req FR:scoring-engine/parity.golden @req FR:scoring-engine/parity.quirks
describe('legacy golden parity (fixtures)', () => parity(path.join(fixtures, 'tasks'), path.join(fixtures, 'golden.json')));

// Real-data parity: private task files and a golden from generate-golden.ps1; never committed.
const realDir = process.env.STACK_SCORING_REAL_DIR;
const realGolden = process.env.STACK_SCORING_REAL_GOLDEN;
if (realDir && realGolden && fs.existsSync(realDir) && fs.existsSync(realGolden)) {
  describe('legacy golden parity (real data)', () => parity(realDir, realGolden));
} else {
  console.warn('SKIPPED real-data scoring parity: set STACK_SCORING_REAL_DIR and STACK_SCORING_REAL_GOLDEN');
}
