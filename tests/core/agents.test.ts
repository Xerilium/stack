import { agentFor, agentsPath, formatAgent, listTeam, parseAgent, parseAgentsMeta, putAgent, reviewOf, slugOf, type AgentDef } from '../../src/core/agents';
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
  it('most specific scope first: project/section, project, then *; file order on ties', async () => {
    const { storage, ctx } = mk();
    await storage.write('tasks/flantastic-4.md', F4);
    await putAgent(ctx, 'labels', { name: 'Labels', scope: ['flantastic-4/Labels'] });
    await putAgent(ctx, 'cos', { name: 'CoS', scope: ['*'] });
    const team = await listTeam(ctx);
    // Files (cos, labels) come first in the team; within one specificity the team order holds.
    expect(agentFor(team, 'flantastic-4', '🏷️ Labels').map((a) => a.slug)).toEqual(['labels', 'sweep-manager', 'cid-manager', 'pr-sweep-worker-f4-music', 'cos']);
    expect(agentFor(team, 'flantastic-4', '🔄 Active').map((a) => a.slug)).toEqual(['sweep-manager', 'cid-manager', 'pr-sweep-worker-f4-music', 'cos']);
    expect(agentFor(team, 'other').map((a) => a.slug)).toEqual(['cos']);
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
