import { agentFor, agentsPath, claudeAgentsPath, formatAgent, listTeam, parseAgent, parseAgentsMeta, parseClaudeAgent, putAgent, reviewOf, slugOf, type AgentDef } from '../../src/core/agents';
import { MemoryStorage, PathError, validatePath } from '../../src/core/storage';
import { LifecycleError } from '../../src/core/lifecycle';
import { recordResult } from '../../src/core/triage';

const F4 = `# 🎧 Flantastic 4

- **Aliases:** f4, flantastic
- **Agents:**
  - \`🔄 Sweep Manager\` — PR management across all projects
  - \`🎧 Cid Manager\` — acts as label manager + F4 CoS
  - \`PR sweep worker: f4-music\`
- **Project value:** 😊😊 💰

## 🔄 Active

- [ ] 🤖 Release the single 🟡
- [ ] Ship labels

## 🏷️ Labels

- [ ] Fix the DistroKid price
`;
const ALLYTE = `# Allyte

- **Agents:** \`allyte-cos\` — Allyte chief of staff

## 🔄 Active

- [ ] Write the OIDC test
`;

const s2write = async (st: MemoryStorage, p: string, c: string) => { let v: string | undefined; try { v = (await st.read(p)).version; } catch { /* new */ } await st.write(p, c, v ? { expectedVersion: v } : {}); };
function mk() {
  const storage = new MemoryStorage();
  const ctx = { storage, now: () => new Date('2026-10-29T10:00:00Z') };
  return { storage, ctx };
}
const def = (o: Partial<AgentDef> = {}): AgentDef => ({ slug: 'cid-manager', name: '🎧 Cid Manager', scope: ['flantastic-4'], mode: 'ad-hoc', prompt: '', extra: [], ...o });

// @req FR:agent-team/agent.path
describe('agent path', () => {
  it('accepts tasks/agents/<slug>.md, lists the folder, never lists it as a project', async () => {
    expect(validatePath('tasks/agents/cid-manager.md')).toBe('tasks/agents/cid-manager.md');
    for (const bad of ['tasks/agents/../x.md', 'tasks/agents/.x.md', 'tasks/agents/README.md', 'tasks/agents/Upper.md', 'tasks/agents/a/b.md']) expect(() => validatePath(bad)).toThrow(PathError);
    expect(agentsPath('cos')).toBe('tasks/agents/cos.md');
    expect(() => agentsPath('Bad Slug')).toThrow(LifecycleError);
    const { storage, ctx } = mk();
    await putAgent(ctx, 'cos', { name: 'CoS', scope: ['*'] });
    expect(await storage.list()).toEqual([]);
    expect(await storage.listAgents()).toEqual(['tasks/agents/cos.md']);
  });
});

// @req FR:agent-team/agent.format
describe('agent format', () => {
  it('round-trips every field and the prompt; unknown lines are kept; bad values are dropped', () => {
    const a = def({ role: 'Label manager', scope: ['flantastic-4', 'flantastic-4/Labels'], model: 'sonnet', tools: ['Read', 'Bash'], mode: 'long-running', prompt: 'Read the charter first.\n\n## Not a section', extra: ['- custom: yes'] });
    const text = formatAgent(a);
    expect(text).toContain('- name: 🎧 Cid Manager');
    expect(text).toContain('- scope: flantastic-4, flantastic-4/Labels');
    expect(parseAgent('cid-manager', text)).toEqual(a);
    const p = parseAgent('x', '- name: \n- mode: weird\n- scope: ok, ../bad, *\n- model: a b\n');
    expect(p).toMatchObject({ name: 'x', mode: 'ad-hoc', scope: ['ok', '*'] });
    expect(p.model).toBeUndefined();
  });
  // @req FR:agent-team/agent.icon
  it('reads an optional icon: an emoji or a same-origin image path; anything else is dropped', () => {
    const a = def({ icon: '🎧' });
    expect(formatAgent(a)).toContain('- icon: 🎧');
    expect(parseAgent('cid-manager', formatAgent(a))).toEqual(a);
    expect(parseAgent('x', '- icon: /agents/cid.png\n').icon).toBe('/agents/cid.png');
    for (const bad of ['https://evil.test/x.png', '//evil.test/x.png', '/a/../b.png', 'cid', '/x.exe', '<img>']) expect(parseAgent('x', `- icon: ${bad}\n`).icon).toBeUndefined();
    expect(parseClaudeAgent('x', '---\nname: x\nicon: 🧭\n---\n# X\n').icon).toBe('🧭');
  });
  it('putAgent validates and updates in place', async () => {
    const { storage, ctx } = mk();
    await expect(putAgent(ctx, 'a', {})).rejects.toThrow(/name is required/);
    await expect(putAgent(ctx, 'a', { name: 'A', scope: ['bad/../x'] })).rejects.toThrow(/Bad scope/);
    expect(await putAgent(ctx, 'a', { name: 'A', scope: ['alpha'], prompt: 'hi' })).toEqual({ slug: 'a', created: true });
    expect(await putAgent(ctx, 'a', { mode: 'long-running' })).toEqual({ slug: 'a', created: false });
    expect(parseAgent('a', (await storage.read('tasks/agents/a.md')).content)).toMatchObject({ name: 'A', scope: ['alpha'], prompt: 'hi', mode: 'long-running' });
  });
});

// @req FR:agent-team/agent.team
describe('team', () => {
  it('reads Agents metadata as list items or inline, keeping hyphens in names', () => {
    expect(parseAgentsMeta('', ['  - `🔄 Sweep Manager` — PR management', '  - `PR sweep worker: f4-music`'])).toEqual([{ name: '🔄 Sweep Manager', role: 'PR management' }, { name: 'PR sweep worker: f4-music' }]);
    expect(parseAgentsMeta('`allyte-cos` — Allyte chief of staff', [])).toEqual([{ name: 'allyte-cos', role: 'Allyte chief of staff' }]);
    expect(parseAgentsMeta('', ['  - Subagent `allyte-cos` — prioritizes Allyte'])).toEqual([{ name: 'allyte-cos', role: 'prioritizes Allyte' }]);
    expect(slugOf('🎧 Cid Manager')).toBe('cid-manager');
    expect(slugOf('PR sweep worker: f4-music')).toBe('pr-sweep-worker-f4-music');
  });
  it('lists file agents first, then metadata-only agents with their project as scope', async () => {
    const { storage, ctx } = mk();
    await storage.write('tasks/flantastic-4.md', F4);
    await storage.write('tasks/allyte.md', ALLYTE);
    await putAgent(ctx, 'cos', { name: 'CoS', scope: ['*'], mode: 'long-running' });
    await putAgent(ctx, 'cid-manager', { name: '🎧 Cid Manager', role: 'Label manager', prompt: 'Own the label.' });
    const team = await listTeam(ctx);
    expect(team.map((a) => [a.slug, a.defined, a.scope, a.projects])).toEqual([
      ['cid-manager', true, ['flantastic-4'], ['flantastic-4']], // no scope line: the project that names it
      ['cos', true, ['*'], ['allyte', 'flantastic-4']],
      ['allyte-cos', false, ['allyte'], ['allyte']],
      ['sweep-manager', false, ['flantastic-4'], ['flantastic-4']],
      ['pr-sweep-worker-f4-music', false, ['flantastic-4'], ['flantastic-4']],
    ]);
    expect(team[0]).toMatchObject({ name: '🎧 Cid Manager', role: 'Label manager', prompt: 'Own the label.', mode: 'ad-hoc' });
    expect(team[3].role).toBe('PR management across all projects');
  });
});

// @req FR:agent-team/agent.resolve
describe('agentFor', () => {
  it('the roll-up first, then the most specific scope: project/section, project; file order on ties', async () => {
    const { storage, ctx } = mk();
    await storage.write('tasks/flantastic-4.md', F4);
    await putAgent(ctx, 'labels', { name: 'Labels', scope: ['flantastic-4/Labels'] });
    await putAgent(ctx, 'cos', { name: 'CoS', scope: ['*'] });
    const team = await listTeam(ctx);
    // Files (cos, labels) come first in the team; within one specificity the team order holds.
    expect(agentFor(team, 'flantastic-4', '🏷️ Labels').map((a) => a.slug)).toEqual(['cos', 'labels', 'sweep-manager', 'cid-manager', 'pr-sweep-worker-f4-music']);
    expect(agentFor(team, 'flantastic-4', '🔄 Active').map((a) => a.slug)).toEqual(['cos', 'sweep-manager', 'cid-manager', 'pr-sweep-worker-f4-music']);
    expect(agentFor(team, 'other').map((a) => a.slug)).toEqual(['cos']);
    // A section scope is a prefix of the heading's words, never a substring (`Do` must not cover `Done`).
    await putAgent(ctx, 'doer', { name: 'Doer', scope: ['flantastic-4/Do'] });
    const t2 = await listTeam(ctx);
    expect(agentFor(t2, 'flantastic-4', '✅ Done').some((a) => a.slug === 'doer')).toBe(false);
    expect(agentFor(t2, 'flantastic-4', '🔄 Do it').some((a) => a.slug === 'doer')).toBe(true);
    expect(agentFor(team.filter((a) => a.slug !== 'cos'), 'other')).toEqual([]);
  });
});

// @req FR:agent-team/review.read
describe('reviewOf', () => {
  it('returns the newest review log entry for the row with its open need asks, or null', async () => {
    const { storage, ctx } = mk();
    await storage.write('tasks/allyte.md', ALLYTE);
    const ref = { path: 'tasks/allyte.md', line: 6 };
    expect(await reviewOf(ctx, ref)).toBeNull();
    let t = 0;
    const c = { ...ctx, now: () => new Date(Date.parse('2026-10-29T10:00:00Z') + 1000 * t++) };
    await recordResult(c, ref, { outcome: 'partial', summary: 'partial: Write the test after the OIDC client id is known (1h)', action: 'review' }, { actor: 'agent:allyte-cos', owner: true });
    await recordResult(c, ref, { outcome: 'done', summary: 'done: unrelated' }, { actor: 'agent:allyte-cos', owner: true });
    const r = await reviewOf(ctx, ref, ['rev-allyte-7-1', 'rev-allyte-7-2', 'rev-allyte-9-1', 'other']);
    expect(r).toMatchObject({ verdict: 'partial', plan: 'Write the test after the OIDC client id is known', estimate: '1h', agent: 'allyte-cos', needs: ['rev-allyte-7-1', 'rev-allyte-7-2'] });
  });
});

const COS_CLAUDE = `---
name: cos
description: Chief of Staff. Keeps Michael focused across all projects. Does NOT do project work.
tools: Read, Grep, Glob, Bash
model: sonnet
---

# CoS: Chief of Staff

You are Michael's Chief of Staff.
`;
const ALLYTE_CLAUDE = `---
name: allyte-cos
description: Allyte sub-CoS (solo). Reports to cos.
reports-to: cos
scope: allyte
mode: long-running
---

# Allyte CoS

Manage Allyte.
`;

// @req FR:agent-team/agent.path.claude
describe('claude agent path', () => {
  it('lists and reads .claude/agents/<slug>.md, never writes there, never lists it as a project', async () => {
    const { storage } = mk();
    storage.seed('.claude/agents/cos.md', COS_CLAUDE);
    storage.seed('.claude/agents/README.md', '# not an agent');
    expect(await storage.listClaudeAgents()).toEqual(['.claude/agents/cos.md']);
    expect((await storage.read('.claude/agents/cos.md')).content).toBe(COS_CLAUDE);
    expect(await storage.list()).toEqual([]);
    await expect(storage.write('.claude/agents/cos.md', 'x')).rejects.toThrow(PathError);
    await expect(storage.writeMany([{ path: '.claude/agents/cos.md', content: 'x', expectedVersion: undefined }])).rejects.toThrow(PathError);
    expect(claudeAgentsPath('cos')).toBe('.claude/agents/cos.md');
    for (const bad of ['.claude/agents/../x.md', '.claude/agents/Upper.md', '.claude/agents/a/b.md', '.claude/x.md']) expect(() => validatePath(bad)).toThrow(PathError);
  });
  it('FsStorage lists the folder from disk and refuses to write it', async () => {
    const { mkdtempSync, mkdirSync, writeFileSync } = await import('fs');
    const { tmpdir } = await import('os');
    const { join } = await import('path');
    const { FsStorage } = await import('../../src/core/storage');
    const d = mkdtempSync(join(tmpdir(), 'stack-claude-'));
    mkdirSync(join(d, '.claude/agents'), { recursive: true });
    writeFileSync(join(d, '.claude/agents/cos.md'), COS_CLAUDE);
    writeFileSync(join(d, '.claude/agents/notes.txt'), 'no');
    const s = new FsStorage(d);
    expect(await s.listClaudeAgents()).toEqual(['.claude/agents/cos.md']);
    expect((await s.read('.claude/agents/cos.md')).content).toBe(COS_CLAUDE);
    await expect(s.write('.claude/agents/cos.md', 'x')).rejects.toThrow(PathError);
    expect(await new FsStorage(join(d, 'nope')).listClaudeAgents()).toEqual([]);
  });
});

// @req FR:agent-team/agent.format.claude
describe('parseClaudeAgent', () => {
  it('reads frontmatter and the H1 as the name, the description as the role, the body as the prompt', () => {
    const a = parseClaudeAgent('cos', COS_CLAUDE);
    expect(a).toMatchObject({ slug: 'cos', name: 'CoS', role: 'Chief of Staff', model: 'sonnet', tools: ['Read', 'Grep', 'Glob', 'Bash'], scope: [], mode: 'ad-hoc' });
    expect(a.prompt).toBe("# CoS: Chief of Staff\n\nYou are Michael's Chief of Staff.");
    const b = parseClaudeAgent('allyte-cos', ALLYTE_CLAUDE);
    expect(b).toMatchObject({ name: 'Allyte CoS', role: 'Allyte sub-CoS (solo)', reportsTo: 'cos', scope: ['allyte'], mode: 'long-running' });
    const c = parseClaudeAgent('plain', 'Just a prompt.\n');
    expect(c).toMatchObject({ name: 'plain', prompt: 'Just a prompt.', scope: [] });
    const d = parseClaudeAgent('x', '---\nname: x\ndescription: ' + 'word '.repeat(40) + '\n---\n');
    expect(d.role!.length).toBeLessThanOrEqual(80);
    expect(parseClaudeAgent('y', '---\nname: y\n---\n# Y\n').name).toBe('Y');
    expect(parseClaudeAgent('z', '---\nname: z\n---\nRun this:\n\n```sh\n# a comment\n```\n').name).toBe('z'); // a `#` inside the body is not the title
    // YAML block scalars, wrapped strings and `- item` lists fold onto their key.
    const e = parseClaudeAgent('x', '---\nname: x\ndescription: >\n  Stack lead.\n  Spec first.\ntools:\n  - Read\n  - Grep\nmodel: "opus"\n---\n');
    expect(e).toMatchObject({ role: 'Stack lead', tools: ['Read', 'Grep'], model: 'opus' });
    expect(parseClaudeAgent('w', '---\ndescription: "Keeps the owner\n  focused."\n---\n').role).toBe('Keeps the owner focused');
    expect(parseClaudeAgent('v', '---\nscope:\n- stack\n- catalyst\ntools:\n- Read\nmodel: opus\n---\n')).toMatchObject({ scope: ['stack', 'catalyst'], tools: ['Read'], model: 'opus' }); // an unindented list
  });
});

// @req FR:agent-team/agent.format
describe('reports-to', () => {
  it('round-trips in the Stack format and through putAgent', async () => {
    const a = def({ reportsTo: 'cos' });
    expect(formatAgent(a)).toContain('- reports-to: cos');
    expect(parseAgent('cid-manager', formatAgent(a))).toEqual(a);
    expect(parseAgent('x', '- name: X\n- reports-to: Bad Slug\n').reportsTo).toBeUndefined();
    const { storage, ctx } = mk();
    await putAgent(ctx, 'a', { name: 'A', reportsTo: 'cos' });
    expect(parseAgent('a', (await storage.read('tasks/agents/a.md')).content).reportsTo).toBe('cos');
    await expect(putAgent(ctx, 'b', { name: 'B', reportsTo: 'Bad Slug' })).rejects.toThrow(/reports-to/);
  });
});

// @req FR:agent-team/agent.team.order @req FR:agent-team/agent.team.rollup @req FR:agent-team/agent.team.reports @req FR:agent-team/$team-agent
describe('team with claude files', () => {
  it('orders stack files, claude files, then metadata; cos is the roll-up; the reporting line defaults by containment', async () => {
    const { storage, ctx } = mk();
    await storage.write('tasks/flantastic-4.md', F4);
    await storage.write('tasks/allyte.md', ALLYTE);
    storage.seed('.claude/agents/cos.md', COS_CLAUDE);
    storage.seed('.claude/agents/allyte-cos.md', ALLYTE_CLAUDE);
    await putAgent(ctx, 'cid-manager', { name: '🎧 Cid Manager', role: 'Label manager' });
    const team = await listTeam(ctx);
    expect(team.map((a) => [a.slug, a.source, a.scope, a.reportsTo ?? null])).toEqual([
      ['cid-manager', 'stack', ['flantastic-4'], 'cos'],
      ['allyte-cos', 'claude', ['allyte'], 'cos'],
      ['cos', 'claude', ['*'], null],
      ['sweep-manager', 'metadata', ['flantastic-4'], 'cos'],
      ['pr-sweep-worker-f4-music', 'metadata', ['flantastic-4'], 'cos'],
    ]);
    expect(team[2]).toMatchObject({ name: 'CoS', defined: true, projects: ['allyte', 'flantastic-4'], model: 'sonnet' });
    expect(team[1].defined).toBe(true);
    // A project line naming its own `🧰 CoS` merges into the roll-up and never narrows it.
    await s2write(storage, 'tasks/finops-toolkit.md', '# FTK\n\n- **Agents:**\n  - `🧰 CoS` — prioritizes FTK\n\n## Active\n\n- [ ] z\n');
    const t2 = await listTeam(ctx);
    expect(t2.filter((a) => a.slug === 'cos')).toHaveLength(1);
    expect(t2.find((a) => a.slug === 'cos')).toMatchObject({ scope: ['*'], projects: ['allyte', 'finops-toolkit', 'flantastic-4'] });
    expect(t2.find((a) => a.slug === 'cos')?.reportsTo).toBeUndefined();
  });
  it('a stack file wins over a claude file with the same slug; a metadata agent under a workspace CoS reports to it', async () => {
    const { storage, ctx } = mk();
    await storage.write('tasks/allyte.md', ALLYTE);
    await storage.write('tasks/finops-hubs.md', '# FinOps hubs\n\n- **Agents:**\n  - `PR sweep worker: finops-hubs`\n\n## Active\n\n- [ ] x\n');
    storage.seed('.claude/agents/cos.md', COS_CLAUDE);
    storage.seed('.claude/agents/allyte-cos.md', ALLYTE_CLAUDE);
    await putAgent(ctx, 'allyte-cos', { name: 'Allyte CoS (stack)', scope: ['allyte', 'finops-hubs'] });
    const team = await listTeam(ctx);
    expect(team.filter((a) => a.slug === 'allyte-cos')).toHaveLength(1);
    expect(team.find((a) => a.slug === 'allyte-cos')).toMatchObject({ source: 'stack', name: 'Allyte CoS (stack)', reportsTo: 'cos' });
    // `PR sweep worker: finops-hubs` covers finops-hubs only; allyte-cos covers allyte + finops-hubs (strictly wider) and is narrower than cos (*).
    expect(team.find((a) => a.slug === 'pr-sweep-worker-finops-hubs')?.reportsTo).toBe('allyte-cos');
    // A metadata-only agent, however broad, never manages by default.
    await s2write(storage, 'tasks/focus.md', '# Focus\n\n- **Agents:**\n  - `🔄 Sweep Manager` — PR management across all projects\n  - `👓 Preview`\n\n## Active\n\n- [ ] y\n');
    await s2write(storage, 'tasks/allyte.md', ALLYTE.replace('- **Agents:**', '- **Agents:**\n  - `🔄 Sweep Manager` — PR management across all projects\n  - `PR sweep worker: allyte`'));
    const t3 = await listTeam(ctx);
    expect(t3.find((a) => a.slug === 'preview')?.reportsTo).toBe('cos');
    expect(t3.find((a) => a.slug === 'pr-sweep-worker-allyte')?.reportsTo).toBe('allyte-cos');
  });
  it('an explicit reports-to that names no one falls back; a cycle breaks at the first agent in team order', async () => {
    const { storage, ctx } = mk();
    await storage.write('tasks/allyte.md', ALLYTE);
    await putAgent(ctx, 'a', { name: 'A', scope: ['allyte'], reportsTo: 'b' });
    await putAgent(ctx, 'b', { name: 'B', scope: ['allyte'], reportsTo: 'a' });
    await putAgent(ctx, 'c', { name: 'C', scope: ['allyte'], reportsTo: 'ghost' });
    await putAgent(ctx, 'cos', { name: 'CoS' });
    const team = await listTeam(ctx);
    const by = Object.fromEntries(team.map((t) => [t.slug, t.reportsTo ?? null]));
    expect(by).toEqual({ a: 'cos', b: 'a', c: 'cos', cos: null, 'allyte-cos': 'cos' });
    // No roll-up at all: nobody reports to anyone.
    const { storage: s2, ctx: c2 } = mk();
    await s2.write('tasks/allyte.md', ALLYTE);
    await putAgent(c2, 'solo', { name: 'Solo', scope: ['allyte'] });
    expect((await listTeam(c2)).map((t) => t.reportsTo)).toEqual([undefined, undefined]);
  });
});

// @req FR:agent-team/agent.resolve
describe('agentFor with a roll-up', () => {
  it('puts the roll-up first, then the most specific agents', async () => {
    const { storage, ctx } = mk();
    await storage.write('tasks/flantastic-4.md', F4);
    await putAgent(ctx, 'labels', { name: 'Labels', scope: ['flantastic-4/Labels'] });
    await putAgent(ctx, 'cos', { name: 'CoS', scope: ['*'] });
    await putAgent(ctx, 'watcher', { name: 'Watcher', scope: ['*'] });
    const team = await listTeam(ctx);
    expect(agentFor(team, 'flantastic-4', '🏷️ Labels').map((a) => a.slug)).toEqual(['cos', 'labels', 'sweep-manager', 'cid-manager', 'pr-sweep-worker-f4-music', 'watcher']);
    expect(agentFor(team, 'other').map((a) => a.slug)).toEqual(['cos', 'watcher']);
    expect(team.find((a) => a.slug === 'labels')?.reportsTo).toBe('cos'); // a second `*` agent never manages by default
  });
});

// @req FR:agent-team/agent.team.reports
describe('agents with no project', () => {
  it('report to the roll-up, never to the narrowest agent by accident', async () => {
    const { storage, ctx } = mk();
    await storage.write('tasks/allyte.md', ALLYTE);
    storage.seed('.claude/agents/cos.md', COS_CLAUDE);
    storage.seed('.claude/agents/allyte-cos.md', ALLYTE_CLAUDE);
    storage.seed('.claude/agents/stack-architect.md', '---\nname: stack-architect\ndescription: Stack engineering lead.\n---\n# Stack architect\n');
    const team = await listTeam(ctx);
    expect(team.find((a) => a.slug === 'stack-architect')).toMatchObject({ projects: [], reportsTo: 'cos' });
  });
});
