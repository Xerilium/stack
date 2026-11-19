/**
 * The goal model (`.xe/features/goal-model/spec.md`): ⭐️ Now, dated ⛔️ and ⏰, goal-file frontmatter, agents as session links.
 */
import { mkdtempSync, mkdirSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createRunManager, type AgentDriver, type Run, type Update } from '../../src/agents';
import { restartLead } from '../../src/agents/delivery';
import { agentFor, listTeam } from '../../src/core/agents';
import { getDefaults } from '../../src/core/config';
import {
  goalMeta, holdDates, isHeld, isNow, lintAgents, parseAgentLink, readFrontmatter, releaseBlocks, resolveAgent, setFrontmatterValue, taskAgent,
} from '../../src/core/goal-model';
import { rankStack, sweep } from '../../src/core/lifecycle';
import { parseProject } from '../../src/core/parser';
import { prioritiesView } from '../../src/core/priorities-view';
import { parseAliases, toScoringProject } from '../../src/core/scoring';
import { MemoryStorage, validatePath } from '../../src/core/storage';
import { generateSummaries } from '../../src/core/summaries';
import { isError, lintProject, WARN_RULES } from '../../src/core/task-lint';
import { projectFile, tieredTasks } from '../../src/core/tiered-tasks';
import { createApiHandler } from '../../src/api/handler';

const NOW = new Date('2026-11-19T18:00:00Z'); // Thu 10:00 in Los Angeles
const TODAY = '2026-11-19';

function mk(files: Record<string, string>) {
  const storage = new MemoryStorage();
  for (const [p, c] of Object.entries(files)) storage.seed(p, c);
  return { storage, ctx: { storage, config: getDefaults(), now: () => NOW, engine: 'stack' as const } };
}
const texts = (r: { text: string }[]) => r.map((x) => x.text);

const GOAL = [
  '---',
  'aliases: [stack, stack-app]',
  'agent: "[Stack architect](#local_5c1e0a)"',
  'agent-def: .claude/agents/stack-architect.md',
  'legend:',
  '  🧪: needs a live test',
  'owner-note: keep me',
  '---',
  '',
  '# Stack v2',
  '',
  '- **Aliases:** old-name',
  '',
  '## 🔄 Active',
  '',
  '- [ ] ⭐️ Ship v2',
  '  > id: ship-v2',
  '  - [ ] Write the release note',
  '    > agent: [Docs writer](#local_9f2b11)',
  '    - [ ] Proofread 🧪',
  '  - [ ] Tag the release',
  '',
].join('\n');

describe('FR:pri priority and dates', () => {
  // @req FR:goal-model/pri.now
  it('⭐️ ranks the row first in the Now list and in its project', async () => {
    const { ctx } = mk({
      'tasks/a.md': '# A\n\n## 🔄 Active\n\n- [ ] 🚨 Fix the outage 🟢\n- [ ] Tidy the notes 🔻 🔴\n- [ ] ⭐️ Plan the launch 🔻 🔴\n',
      'tasks/b.md': '# B\n\n## 🔄 Active\n\n- [ ] 🚨 Answer the auditor 🟢\n',
    });
    const r = await rankStack(ctx, NOW, undefined, { ignoreBlocks: true });
    expect(r[0].text).toContain('Plan the launch');
    expect(isNow('⭐ plain star')).toBe(true);
    expect(isNow('no star')).toBe(false);
  });

  // @req FR:goal-model/pri.now
  it('⭐️ on a parent leads with its subtasks', async () => {
    const { ctx } = mk({ 'tasks/a.md': '# A\n\n## 🔄 Active\n\n- [ ] 🚨 Fix the outage 🟢\n- [ ] ⭐️ Ship v2\n  - [ ] Write the note 🔴\n' });
    const r = await rankStack(ctx, NOW, undefined, { ignoreBlocks: true });
    expect(r[0].text).toContain('Write the note');
  });

  // @req FR:goal-model/pri.tiers
  it('still reads 1️⃣-3️⃣, counts ⭐️ as Now, and no gap text asks for a tier', () => {
    const t = tieredTasks('tasks/a.md', '# A\n\n- [ ] 2️⃣ Ship it (agent: ann)\n- [ ] ⭐️ Plan it (agent: bob)\n');
    expect(t.map((x) => [x.tier, x.text])).toEqual([[2, 'Ship it'], [1, 'Plan it']]);
    const v = prioritiesView({ pris: [{ id: 'x', title: 'X', status: 'active', items: [], backlog: [], weekly: [], projects: ['x'] }], tasks: [], now: NOW, timeZone: 'America/Los_Angeles', board: { at: NOW.toISOString(), rows: [] } });
    const gap = [...v.now.rows, ...v.today.rows].find((r) => r.gap)!;
    expect(gap.action).not.toMatch(/1️⃣|2️⃣|3️⃣/u);
    expect(gap.action).toContain('⭐️');
  });

  // @req FR:goal-model/pri.blocked-until
  it('⛔️ <date> is blocked until that date; bare ⛔️ keeps its meaning', async () => {
    expect(holdDates('⛔️ 2026-12-01 Ship it', TODAY)).toEqual(['2026-12-01']);
    expect(isHeld('⛔️ 2026-12-01 Ship it', TODAY)).toBe(true);
    expect(isHeld('⛔️ 2026-11-19 Ship it', TODAY)).toBe(false);
    expect(isHeld('⛔️ Ship it', TODAY)).toBe(false);
    expect(releaseBlocks('- [ ] ⛔️ 2026-11-18 Ship it', TODAY)).toEqual({ line: '- [ ] Ship it', count: 1 });
    expect(releaseBlocks('- [ ] ⛔️ 2026-12-18 Ship it', TODAY).count).toBe(0);
    // The sweep releases a due block; the bare one stays parked and out of the rank.
    const { ctx, storage } = mk({ 'tasks/a.md': '# A\n\n## 🔄 Active\n\n- [ ] ⛔️ 2026-11-18 Ship it\n- [ ] ⛔️ Wait for legal\n- [ ] Other\n' });
    await sweep(ctx);
    expect((await storage.read('tasks/a.md')).content).toContain('- [ ] Ship it\n- [ ] ⛔️ Wait for legal\n');
    expect(texts(await rankStack(ctx, NOW, undefined, { ignoreBlocks: true }))).toEqual(expect.not.arrayContaining(['⛔️ Wait for legal']));
    // A due date block is not lint status text.
    expect(lintProject('tasks/a.md', '# A\n\n## 🔄 Active\n\n- [ ] ⛔️ 2026-12-01 Ship it\n- [ ] ⏰ 2026-12-01 Plan it\n')).toEqual([]);
  });

  // @req FR:goal-model/pri.start
  it('⏰ <date> is the planned start; the sweep starts it on the day', async () => {
    expect(holdDates('⏰ 2026-12-01 Plan it', TODAY)).toEqual(['2026-12-01']);
    expect(holdDates('⏰ Dec 1: Plan it', TODAY)).toEqual(['2026-12-01']);
    const { ctx, storage } = mk({ 'tasks/a.md': '# A\n\n## 🔄 Active\n\n- [ ] ⏰ 2026-11-19 Plan it\n- [ ] ⏰ 2026-12-01 Later\n' });
    await sweep(ctx);
    expect((await storage.read('tasks/a.md')).content).toContain('- [ ] Plan it\n- [ ] ⏰ 2026-12-01 Later\n');
  });

  // @req FR:goal-model/pri.hide
  it('hides rows with a future ⛔️ or ⏰ date from Now, Today and Next', async () => {
    const src = '# A\n\n- **Work capacity:** 8h\n\n## 🔄 Active\n\n- [ ] ⏰ 2026-12-01 Plan it 🟢\n- [ ] ⛔️ 2026-12-01 Ship it 🟢\n- [ ] Write it 🟢\n';
    const { ctx } = mk({ 'tasks/a.md': src });
    expect(texts(await rankStack(ctx, NOW, undefined, { ignoreBlocks: true }))).toEqual(['Write it 🟢']);
    const day = generateSummaries({ projects: [{ fileName: 'a.md', content: src }], config: getDefaults(), now: NOW, engine: 'stack' }).myDay ?? '';
    expect(day).toContain('Write it');
    expect(day).not.toContain('Plan it');
    expect(day).not.toContain('Ship it');
    const t = tieredTasks('tasks/a.md', '# A\n\n- [ ] 1️⃣ ⏰ 2026-12-01 Plan it (agent: ann)\n- [ ] 1️⃣ Write it (agent: ann)\n');
    const v = prioritiesView({ pris: [{ id: 'a', title: 'A', status: 'active', items: [], backlog: [], weekly: [], projects: ['a'] }], tasks: t, now: NOW, timeZone: 'America/Los_Angeles', board: { at: NOW.toISOString(), rows: [] } });
    const shown = [...v.now.rows, ...v.today.rows, ...v.next.rows].map((r) => r.action).join('\n');
    expect(shown).toContain('Write it');
    expect(shown).not.toContain('Plan it');
  });
});

describe('FR:front frontmatter', () => {
  // @req FR:goal-model/front.parse
  it('reads aliases, agent, agent-def and legend, and keeps unknown keys', () => {
    const m = goalMeta(GOAL)!;
    expect(m.aliases).toEqual(['stack', 'stack-app']);
    expect(m.link).toEqual({ name: 'Stack architect', id: 'local_5c1e0a' });
    expect(m.agentDef).toBe('.claude/agents/stack-architect.md');
    expect(m.legend).toEqual({ '🧪': 'needs a live test' });
    expect(m.data['owner-note']).toBe('keep me');
    expect(readFrontmatter('# No frontmatter\n')).toBeNull();
    expect(readFrontmatter('---\naliases:\n  - a\n  - b\n---\n')!.data.aliases).toEqual(['a', 'b']);
  });

  // @req FR:goal-model/front.bullets
  it('frontmatter aliases win over the bullet; the bullet alone still works; the H1 follows the frontmatter', () => {
    const p = parseProject(GOAL);
    expect(p.title).toBe('Stack v2');
    expect(p.metadata['Aliases']).toBe('stack, stack-app');
    expect(parseAliases(p.lines)).toEqual(['stack', 'stack-app']);
    expect(toScoringProject(p, 'stack-v2').name).toBe('Stack v2');
    expect(projectFile('tasks/stack-v2.md', GOAL).aliases).toEqual(['stack', 'stack-app']);
    const bullets = parseProject('# Old\n\n- **Aliases:** a, b\n\n## 🔄 Active\n');
    expect(bullets.metadata['Aliases']).toBe('a, b');
    expect(parseAliases(bullets.lines)).toEqual(['a', 'b']);
  });

  // @req FR:goal-model/front.roundtrip
  it('reading frontmatter changes no byte', async () => {
    const src = `﻿${GOAL.replace(/\n/g, '\r\n')}`;
    expect(parseProject(src).lines.join('\n')).toBe(src);
    goalMeta(src);
    const { storage, ctx } = mk({ 'tasks/stack-v2.md': GOAL });
    await rankStack(ctx, NOW);
    expect((await storage.read('tasks/stack-v2.md')).content).toBe(GOAL);
    // Only the value changes when Stack rewrites a link.
    const next = setFrontmatterValue(GOAL, 'agent', '[Stack architect](#local_new1)');
    expect(next).toBe(GOAL.replace('#local_5c1e0a', '#local_new1'));
  });

  // @req FR:goal-model/front.legend
  it('the API project view carries the legend; it never changes the rank', async () => {
    const { storage, ctx } = mk({ 'tasks/stack-v2.md': GOAL });
    const api = createApiHandler({ storage, config: getDefaults(), authorize: () => true, now: () => NOW });
    const res = await api(new Request('https://x.test/api/projects/stack-v2?fields=name,legend'));
    expect(await res.json()).toEqual({ name: 'stack-v2', legend: { '🧪': 'needs a live test' } });
    const plain = mk({ 'tasks/stack-v2.md': GOAL.replace('🧪', '') });
    expect(texts(await rankStack(ctx, NOW, undefined, { ignoreBlocks: true })).map((t) => t.replace(/\s*🧪/u, ''))).toEqual(texts(await rankStack(plain.ctx, NOW, undefined, { ignoreBlocks: true })).map((t) => t.replace(/\s*🧪/u, '')));
  });
});

describe('FR:agent agents', () => {
  // @req FR:goal-model/agent.link
  it('an agent is a session link; the id is the session', () => {
    expect(parseAgentLink('[Docs writer](#local_9f2b11)')).toEqual({ name: 'Docs writer', id: 'local_9f2b11' });
    expect(parseAgentLink('Docs writer')).toBeNull();
    expect(parseAgentLink('[Docs writer](https://x.y)')).toBeNull();
  });

  // @req FR:goal-model/agent.inherit
  it('resolves task, parent, goal, folder, then ancestor folder', async () => {
    const folders = new Map([
      ['tasks/xe/.stack/agent.md', '---\nagent: "[Xe lead](#local_xe1)"\n---\n'],
      ['tasks/.stack/agent.md', '---\nagent: "[CoS](#local_cos1)"\nagent-def: .claude/agents/cos.md\n---\n'],
    ]);
    const line = (s: string, t: string) => s.split('\n').findIndex((l) => l.includes(t));
    expect(resolveAgent('tasks/xe/stack.md', GOAL, line(GOAL, 'Proofread'), folders)).toMatchObject({ link: { id: 'local_9f2b11' }, level: 'parent' });
    expect(resolveAgent('tasks/xe/stack.md', GOAL, line(GOAL, 'Write the release'), folders)).toMatchObject({ link: { id: 'local_9f2b11' }, level: 'task' });
    expect(resolveAgent('tasks/xe/stack.md', GOAL, line(GOAL, 'Tag the release'), folders)).toMatchObject({ link: { id: 'local_5c1e0a' }, level: 'goal', agentDef: '.claude/agents/stack-architect.md' });
    const bare = '# Bare\n\n## 🔄 Active\n\n- [ ] Do it\n';
    expect(resolveAgent('tasks/xe/bare.md', bare, 4, folders)).toMatchObject({ link: { id: 'local_xe1' }, level: 'folder', path: 'tasks/xe/.stack/agent.md' });
    expect(resolveAgent('tasks/other/bare.md', bare, 4, folders)).toMatchObject({ link: { id: 'local_cos1' }, level: 'folder', path: 'tasks/.stack/agent.md', agentDef: '.claude/agents/cos.md' });
    // From storage, with the folder default as an allowed path.
    expect(validatePath('tasks/xe/.stack/agent.md')).toBe('tasks/xe/.stack/agent.md');
    const { storage } = mk({ 'tasks/xe/bare.md': bare, 'tasks/xe/.stack/agent.md': folders.get('tasks/xe/.stack/agent.md')! });
    expect((await taskAgent(storage, { path: 'tasks/xe/bare.md', line: 4 }))?.link.name).toBe('Xe lead');
  });

  // @req FR:goal-model/agent.inherit
  it('a resolved lead wins in the team and agent-of-task logic', async () => {
    const { ctx } = mk({
      'tasks/stack.md': GOAL,
      'tasks/.stack/agents/builder.md': '# Agent: builder\n\n- name: Builder\n- scope: stack\n',
    });
    const team = await listTeam(ctx);
    const lead = team.find((a) => a.name === 'Stack architect')!;
    expect(lead).toMatchObject({ session: 'local_5c1e0a', leads: ['stack'] });
    expect(agentFor(team, 'stack').find((a) => !a.scope.includes('*'))?.name).toBe('Stack architect');
  });

  // @req FR:goal-model/agent.none
  it('a task with no resolved agent is the owner’s; the team logic is unchanged', async () => {
    const bare = '# Bare\n\n## 🔄 Active\n\n- [ ] Do it\n';
    expect(resolveAgent('tasks/bare.md', bare, 4, new Map())).toBeNull();
    const { ctx } = mk({ 'tasks/bare.md': bare, 'tasks/.stack/agents/builder.md': '# Agent: builder\n\n- name: Builder\n- scope: bare\n' });
    const team = await listTeam(ctx);
    expect(team.every((a) => !a.leads?.length)).toBe(true);
    expect(agentFor(team, 'bare')[0].name).toBe('Builder');
  });

  // @req FR:goal-model/agent.restart
  it('restarts a gone lead from agent-def and rewrites only the link', async () => {
    const prompts: { text: string; title?: string; system?: string }[] = [];
    const driver: AgentDriver = {
      listSessions: async () => [], getMessages: async () => [], cancel: async () => false,
      async prompt(req): Promise<Run> {
        prompts.push({ text: req.text, title: req.options?.title, system: req.options?.systemPrompt });
        const ups: Update[] = [{ type: 'session', sessionId: 'abc-123' }, { type: 'done', stopReason: 'end_turn', cost: { usd: 0, tokens: 0 }, turns: 1, durationMs: 1 }];
        return { id: `run-${prompts.length}`, sessionId: null, updates: (async function* () { for (const u of ups) yield u; })() };
      },
    };
    const { storage, ctx } = mk({ 'tasks/stack.md': GOAL, 'tasks/plain.md': GOAL.replace(/agent-def:.*\n/, '') });
    const runs = createRunManager({ driver, ctx });
    const deps = { runs, inventory: () => ({ sessions: [] }), readDef: async (p: string) => (p === '.claude/agents/stack-architect.md' ? '# Stack architect\n\nYou lead Stack.' : null) };
    const line = GOAL.split('\n').findIndex((l) => l.includes('Tag the release'));
    const r = await restartLead(ctx, deps, { path: 'tasks/stack.md', line });
    expect(r).toEqual({ restarted: true, path: 'tasks/stack.md', id: 'local_abc-123' });
    expect(prompts[0]).toMatchObject({ title: 'Stack architect', system: expect.stringContaining('You lead Stack.') });
    expect((await storage.read('tasks/stack.md')).content).toBe(GOAL.replace('#local_5c1e0a', '#local_abc-123'));
    // A live session, or no agent-def: nothing starts.
    expect(await restartLead(ctx, { ...deps, inventory: () => ({ sessions: [{ id: 'x', cli: 'abc-123' }] }) }, { path: 'tasks/stack.md', line })).toEqual({ restarted: false });
    expect(await restartLead(ctx, deps, { path: 'tasks/plain.md', line })).toEqual({ restarted: false });
    expect(prompts).toHaveLength(1);
  });
});

describe('FR:lint agent lint', () => {
  const live = [{ id: 'local_5c1e0a' }, { id: 'local_9f2b11' }];

  // @req FR:goal-model/lint.lead
  it('warns on a goal file with no lead; a folder default is a lead', () => {
    const bare = { path: 'tasks/xe/bare.md', content: '# Bare\n\n## 🔄 Active\n\n- [ ] Do it\n' };
    const issues = lintAgents([bare]);
    expect(issues.map((i) => [i.path, i.rule])).toEqual([['tasks/xe/bare.md', 'agent-lead']]);
    expect(issues.every((i) => !isError(i))).toBe(true);
    expect(lintAgents([bare, { path: 'tasks/.stack/agent.md', content: '---\nagent: "[CoS](#local_cos1)"\n---\n' }])).toEqual([]);
  });

  // @req FR:goal-model/lint.duplicate
  it('fails on one name with two ids, or one id with two names', () => {
    const two = lintAgents([{ path: 'tasks/stack.md', content: GOAL }, { path: 'tasks/b.md', content: '---\nagent: "[Stack architect](#local_other)"\n---\n# B\n' }]);
    expect(two.filter((i) => i.rule === 'agent-duplicate')).toHaveLength(2);
    expect(two.some(isError)).toBe(true);
    const names = lintAgents([{ path: 'tasks/stack.md', content: GOAL }, { path: 'tasks/b.md', content: '---\nagent: "[Architect](#local_5c1e0a)"\n---\n# B\n' }]);
    expect(names.filter((i) => i.rule === 'agent-duplicate').map((i) => i.message)).toEqual(expect.arrayContaining([expect.stringContaining('local_5c1e0a has 2 names')]));
    expect(lintAgents([{ path: 'tasks/stack.md', content: GOAL }])).toEqual([]);
  });

  // @req FR:goal-model/lint.dead
  it('warns on a dead link with the file and the fix; skipped without a session list', () => {
    const dead = lintAgents([{ path: 'tasks/stack.md', content: GOAL }], { sessions: [{ id: 'local_9f2b11' }] });
    expect(dead).toEqual([expect.objectContaining({ path: 'tasks/stack.md', line: 3, rule: 'agent-dead', message: expect.stringMatching(/Relink.*agent-def/) })]);
    expect(WARN_RULES).toEqual(expect.arrayContaining(['agent-dead', 'agent-lead', 'agent-def']));
    expect(lintAgents([{ path: 'tasks/stack.md', content: GOAL }], { sessions: live })).toEqual([]);
    expect(lintAgents([{ path: 'tasks/stack.md', content: GOAL }], { sessions: null })).toEqual([]);
    // A session Stack started links by its Claude Code id.
    expect(lintAgents([{ path: 'tasks/b.md', content: '---\nagent: "[B](#local_abc-1)"\n---\n# B\n' }], { sessions: [{ id: 'local_zzz', cli: 'abc-1' }] })).toEqual([]);
  });

  // @req FR:goal-model/lint.agent-def
  it('warns when agent-def names a missing file', () => {
    const r = lintAgents([{ path: 'tasks/stack.md', content: GOAL }], { exists: () => false });
    expect(r).toEqual([expect.objectContaining({ rule: 'agent-def', line: 4, message: expect.stringContaining('.claude/agents/stack-architect.md') })]);
    expect(lintAgents([{ path: 'tasks/stack.md', content: GOAL }], { exists: () => true })).toEqual([]);
  });

  // @req FR:goal-model/lint.dead @req FR:goal-model/lint.lead
  it('stack lint runs the agent rules from local files only and warnings never fail it', async () => {
    const { run } = await import('../../src/cli/run');
    const d = mkdtempSync(join(tmpdir(), 'stack-goal-lint-'));
    mkdirSync(join(d, 'tasks'), { recursive: true });
    const sessions = mkdtempSync(join(tmpdir(), 'stack-goal-sessions-'));
    writeFileSync(join(d, 'tasks/stack.md'), GOAL);
    const prev = process.env.STACK_SESSIONS_DIR;
    process.env.STACK_SESSIONS_DIR = sessions;
    let out = '';
    try {
      const code = await run(['lint', '--dir', d, '--no-commit', '--json'], { out: (s) => { out += s; }, err: () => undefined });
      const j = JSON.parse(out) as { ok: boolean; issues: { rule: string }[] };
      expect(code).toBe(0);
      expect(j.issues.map((i) => i.rule).sort()).toEqual(['agent-dead', 'agent-dead', 'agent-def']);
    } finally { if (prev === undefined) delete process.env.STACK_SESSIONS_DIR; else process.env.STACK_SESSIONS_DIR = prev; }
  });
});

describe('review gaps', () => {
  const restartDriver = (listed: string[] = []) => {
    const prompts: string[] = [];
    const driver: AgentDriver = {
      listSessions: async () => listed.map((id) => ({ id, title: '', project: '', cwd: '', lastActive: NOW.toISOString(), active: false, cost: { usd: 0, tokens: 0 }, prs: [] })),
      getMessages: async () => [], cancel: async () => false,
      async prompt(req): Promise<Run> {
        prompts.push(req.text);
        const ups: Update[] = [{ type: 'session', sessionId: `new-${prompts.length}` }, { type: 'done', stopReason: 'end_turn', cost: { usd: 0, tokens: 0 }, turns: 1, durationMs: 1 }];
        return { id: `run-${prompts.length}`, sessionId: null, updates: (async function* () { for (const u of ups) yield u; })() };
      },
    };
    return { driver, prompts };
  };
  const def = async () => '# Lead';
  const tagLine = GOAL.split('\n').findIndex((l) => l.includes('Tag the release'));

  // @req FR:goal-model/agent.restart.live
  it('a session in the driver list is live; one link restarts at most once a process', async () => {
    const live = restartDriver(['5c1e0a']);
    const a = mk({ 'tasks/stack.md': GOAL });
    expect(await restartLead(a.ctx, { runs: createRunManager({ driver: live.driver, ctx: a.ctx }), inventory: () => ({ sessions: [] }), readDef: def }, { path: 'tasks/stack.md', line: tagLine })).toEqual({ restarted: false });
    expect(live.prompts).toHaveLength(0);
    const gone = restartDriver();
    const b = mk({ 'tasks/stack.md': GOAL });
    const deps = { runs: createRunManager({ driver: gone.driver, ctx: b.ctx }), inventory: () => ({ sessions: [] }), readDef: def };
    expect((await restartLead(b.ctx, deps, { path: 'tasks/stack.md', line: tagLine })).restarted).toBe(true);
    expect((await restartLead(b.ctx, deps, { path: 'tasks/stack.md', line: tagLine })).restarted).toBe(false);
    expect(gone.prompts).toHaveLength(1);
  });

  // @req FR:goal-model/agent.restart.level
  it('two goal files under one folder default start one session', async () => {
    const folder = '---\nagent: "[Xe lead](#local_xe1)"\nagent-def: .claude/agents/xe.md\n---\n';
    const bare = '# Bare\n\n## 🔄 Active\n\n- [ ] Do it\n';
    const gone = restartDriver();
    const { storage, ctx } = mk({ 'tasks/xe/.stack/agent.md': folder, 'tasks/xe/a.md': bare, 'tasks/xe/b.md': bare });
    const runs = createRunManager({ driver: gone.driver, ctx });
    const seen = new Set<string>();
    // Two deps objects: only the pass guard (keyed on the level file) stops the second start.
    await restartLead(ctx, { runs, inventory: () => ({ sessions: [] }), readDef: def }, { path: 'tasks/xe/a.md', line: 4 }, { seen });
    await restartLead(ctx, { runs, inventory: () => ({ sessions: [] }), readDef: def }, { path: 'tasks/xe/b.md', line: 4 }, { seen });
    expect(gone.prompts).toHaveLength(1);
    expect((await storage.read('tasks/xe/.stack/agent.md')).content).toBe(folder.replace('local_xe1', 'local_new-1'));
  });

  // @req FR:goal-model/agent.restart.to
  it('restarts only when the work goes to the lead', async () => {
    const gone = restartDriver();
    const { ctx } = mk({ 'tasks/stack.md': GOAL });
    const deps = { runs: createRunManager({ driver: gone.driver, ctx }), inventory: () => ({ sessions: [] }), readDef: def };
    expect(await restartLead(ctx, deps, { path: 'tasks/stack.md', line: tagLine }, { to: { name: 'CoS' } })).toEqual({ restarted: false });
    expect(gone.prompts).toHaveLength(0);
    expect((await restartLead(ctx, deps, { path: 'tasks/stack.md', line: tagLine }, { to: { name: 'Stack architect', session: 'local_5c1e0a' } })).restarted).toBe(true);
  });

  // @req FR:goal-model/pri.tiers
  it('frontmatter lines are never tiered rows', () => {
    const src = '---\nlegend:\n  ⭐️: Now\n  1️⃣: today\n---\n# A\n\n- [ ] ⭐️ Plan it (agent: bob)\n';
    expect(tieredTasks('tasks/a.md', src).map((t) => t.text)).toEqual(['Plan it']);
  });

  // @req FR:goal-model/front.strict
  it('a leading --- block with a non-key line is not frontmatter', () => {
    expect(readFrontmatter('---\nJust a note\n---\n')).toBeNull();
    const p = parseProject('---\n# A\n\n## 🔄 Active\n\n- [ ] Do it\n---\n');
    expect(p.sections.flatMap((s) => s.tasks).map((t) => t.text)).toEqual(['Do it']);
    expect(readFrontmatter('---\nagent: x\nlegend:\n  🧪: test\n---\n')).not.toBeNull();
  });

  // @req FR:goal-model/pri.sweep-rows
  it('the date sweep touches only open task rows', async () => {
    const src = '---\nnote: "⛔️ 2026-11-01 keep"\n---\n# A\n\n## 🔄 Active\n\n- [x] ⛔️ 2026-11-18 Done it\n- [ ] Open it\n  ⏰ 2026-11-18 a note\n- [ ] ⏰ 2026-11-18 Start it\n';
    const { ctx, storage } = mk({ 'tasks/a.md': src });
    await sweep(ctx);
    expect((await storage.read('tasks/a.md')).content).toBe(src.replace('- [ ] ⏰ 2026-11-18 Start it', '- [ ] Start it'));
  });
});
