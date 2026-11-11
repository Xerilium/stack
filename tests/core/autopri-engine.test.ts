import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { parseConfig } from '../../src/core/config';
import { parseProject } from '../../src/core/parser';
import { getEngine, listEngines, rankTasks, toScoringProject } from '../../src/core/scoring';
import { autopriEngine, checkMisses, parseMisses, registerAutopriEngine } from '../../src/core/autopri';

const FIX = join(__dirname, '../fixtures/auto-priority');
const AT = new Date('2026-11-05T12:00:00Z');
const config = parseConfig();
const load = (dir: string) => readdirSync(dir).filter((n) => n.endsWith('.md')).sort()
  .map((n) => toScoringProject(parseProject(readFileSync(join(dir, n), 'utf8')), n.replace(/\.md$/, '')));
const mk = (name: string, lines: string[], value = '💰') => toScoringProject(parseProject(`# ${name}\n\n- **Project value:** ${value}\n\n## 🔄 Active\n\n${lines.map((l) => `- [ ] ${l}`).join('\n')}\n`), name);
const order = (projects = load(join(FIX, 'tasks'))) => rankTasks(autopriEngine, projects, config, AT, { ignoreBlocks: true }).map((s) => s.task.text);

describe('autopri engine', () => {
  // @req FR:auto-priority/engine.@function
  it('registers once and is not the default', () => {
    registerAutopriEngine(); registerAutopriEngine();
    expect(listEngines().filter((i) => i === 'autopri')).toHaveLength(1);
    expect(getEngine('autopri')).toBe(autopriEngine);
    expect(listEngines()[0]).not.toBe('autopri');
  });
  // @req FR:auto-priority/engine.ground-truth
  it('ranks the owner ground truth 1-6', () => {
    const gt = parseMisses(readFileSync(join(FIX, 'ground-truth.md'), 'utf8'));
    const rows = order().map((text) => ({ text }));
    const aliases = [['Catalyst 0.3.4', 'Catalyst 0.3.4 release'], ['finops-hubs 0.10', 'finops-hubs 0.10'], ['v15 blog', 'v15 blog'], ['v16 PRs', 'v16 PRs'], ['Christmas After Dark', 'Christmas After Dark album'], ['FOCUS v1.6', 'FOCUS v1.6']];
    expect(aliases.map(([a]) => rows.findIndex((r) => r.text.includes(a)))).toEqual([0, 1, 2, 3, 4, 5]);
    expect(checkMisses(rows, gt)).toEqual([]);
  });
  // @req FR:auto-priority/engine.unblock
  it('puts an unblocker above a due-today task', () => {
    expect(order([mk('A', ['🚨 📅 Nov 5: due today 🟢', 'Enabler 🔓 ⚫️'])])[0]).toContain('Enabler');
  });
  // @req FR:auto-priority/engine.project-value
  it('ranks a task in a high-value project above the same task in a low-value one', () => {
    const o = order([mk('Low', ['Low task 🟡'], ''), mk('High', ['High task 🟡'], '💰 🌟')]);
    expect(o).toEqual(['High task 🟡', 'Low task 🟡']);
  });
  // @req FR:auto-priority/engine.blockers
  it('lifts a blocker to the score of the task it blocks', () => {
    const o = order([mk('A', ['Do the thing 🟡', 'Hot task 🚨 📅 Nov 5: -- after Do the thing', 'Cold task ‼️ ⬆️ 🟢'])]);
    expect(o).toEqual(['Do the thing 🟡', 'Hot task 🚨 📅 Nov 5: -- after Do the thing', 'Cold task ‼️ ⬆️ 🟢']);
  });
  // @req FR:auto-priority/engine.urgency @req FR:auto-priority/engine.horizon
  it('keeps a far date ranked but below a tagged pipeline task; nearer date wins', () => {
    const o = order([mk('A', ['Far 📅 Nov 20: 🟡', 'Pipeline ‼️ ⬆️ 🟡', 'Soon 📅 Nov 7: 🟡'])]);
    expect(o).toEqual(['Soon 📅 Nov 7: 🟡', 'Pipeline ‼️ ⬆️ 🟡', 'Far 📅 Nov 20: 🟡']);
  });
  // @req FR:auto-priority/engine.urgency
  it('treats a stale overdue date as undated-weak', () => {
    const o = order([mk('A', ['Stale 📅 Aug 5: 🟡', 'Plain ‼️ ⬆️ 🟡'])]);
    expect(o[0]).toContain('Plain');
  });
  // @req FR:auto-priority/engine.rows
  it('drops parked leaves and messages', () => {
    expect(order([mk('A', ['💬 reply', 'Parked 🅿️', 'Real'])])).toEqual(['Real']);
  });
});
