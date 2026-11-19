import { tieredTasks } from '../../src/core/tiered-tasks';

const FILE = [
  '﻿# 👓 FOCUS',
  '',
  '- **Aliases:** foc, focus',
  '',
  '## 1️⃣ Today (heading, not a task)',
  '',
  '- [ ] 1️⃣ 🔄 Publish [2826](https://github.com/o/r/pull/2826) (agent: focus-cos, +2 PR agents: focus-pr-2826, focus-scenarios-pr) as of Nov 18',
  '- [x] 1️⃣ Done one (agent: focus-cos)',
  '- [ ] 📅 Nov 25: due later, no tier',
  '  - [ ] 2️⃣ Child task 🤝 pairing live (agent: 👓 SKU price dataset; use subagents)',
  '1️⃣ Approve the QM 5: 251, 244 https://github.com/o/r/issues/251',
  '* 3️⃣ ⏸️ Park it (agent: qm-planner)',
  '- [ ] 2️⃣ 🚫 Stuck (agent: a) 🔴',
  '- [ ] 3️⃣ text 1️⃣ later in the line (agent: b) 🕓',
  '- [ ] 3️⃣ ✅ Shipped (agent: c)',
].join('\n');

describe('tieredTasks', () => {
  const t = tieredTasks('tasks/focus.md', FILE);

  // @req FR:priorities-tables/tasks.@function @req FR:priorities-tables/tasks.tier @req FR:priorities-tables/tasks.tier.skip @req FR:priorities-tables/tasks.tier.goal @req FR:priorities-tables/$tiered
  it('reads only lines that start with a tier; skips checked lines, headings and untiered lines', () => {
    expect(t.map((x) => [x.line, x.tier])).toEqual([[6, 1], [9, 2], [10, 1], [11, 3], [12, 2], [13, 3], [14, 3]]);
  });
  // @req FR:priorities-tables/tasks.project
  it('names the project by its title without emoji and keeps the aliases', () => {
    expect(t[0]).toMatchObject({ path: 'tasks/focus.md', project: 'FOCUS', aliases: ['foc', 'focus'] });
  });
  // @req FR:priorities-tables/tasks.agent
  it('takes the first agent and counts the others', () => {
    expect(t.map((x) => [x.agent, x.more])).toEqual([['focus-cos', 2], ['👓 SKU price dataset', 0], [null, 0], ['qm-planner', 0], ['a', 0], ['b', 0], ['c', 0]]);
  });
  // @req FR:priorities-tables/tasks.status
  it('reads the agent status from the glyphs, Unknown by default, none with no agent', () => {
    expect(t.map((x) => x.status)).toEqual(['working', 'pairing', null, 'idle', 'blocked', 'queued', 'done']);
    expect(tieredTasks('tasks/x.md', '# X\n## A\n- [ ] 1️⃣ Plain (agent: z)')[0].status).toBe('unknown');
    expect(tieredTasks('tasks/x.md', '1️⃣ Pair (agent: a + b, c)')[0]).toMatchObject({ agent: 'a', more: 2 });
  });
  // @req FR:priorities-tables/tasks.text
  it('strips the tier, status glyphs and agent text from the action', () => {
    expect(t[0].text).toBe('Publish [2826](https://github.com/o/r/pull/2826) as of Nov 18');
    expect(t[1].text).toBe('Child task pairing live');
    expect(t[2].text).toBe('Approve the QM 5: 251, 244 https://github.com/o/r/issues/251');
    expect(t[4].text).toBe('Stuck');
  });
  // @req FR:priorities-tables/tasks.project
  it('falls back to the file name with no title', () => {
    expect(tieredTasks('tasks/my-proj.md', '1️⃣ X')[0]).toMatchObject({ project: 'my-proj', aliases: [] });
  });
});
