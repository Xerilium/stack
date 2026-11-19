import { linkRefs, projectFile, tieredTasks } from '../../src/core/tiered-tasks';

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

describe('PR and issue links', () => {
  const R = 'o/r';
  const u = (n: number) => `https://github.com/o/r/issues/${n}`;
  // @req FR:priorities-tables/tasks.refs
  it('links every #N, PR N, PRs N, M and issue N to its full URL; keeps links and URLs', () => {
    expect(linkRefs('Review #12 and PR 13, PRs 14, #15 and 16; issue 17', R)).toBe(`Review [12](${u(12)}) and PR [13](${u(13)}), PRs [14](${u(14)}), [15](${u(15)}) and [16](${u(16)}); issue [17](${u(17)})`);
    expect(linkRefs('See [2826](https://github.com/x/y/pull/2826) and https://github.com/x/y/pull/9#issuecomment-1', R)).toBe('See [2826](https://github.com/x/y/pull/2826) and https://github.com/x/y/pull/9#issuecomment-1');
    const t = tieredTasks('tasks/f.md', '# F\n- **Repository:** [o/r](https://github.com/o/r)\n## A\n- [ ] 1️⃣ Ship PR 119 (agent: a)')[0];
    expect(t).toMatchObject({ repo: 'o/r', text: `Ship PR [119](${u(119)})` });
    // no bare refs are left
    expect(t.text.replace(/\[[^\]]*\]\([^)]*\)/g, '')).not.toMatch(/#\d+|\bPR \d+/);
  });
  // @req FR:priorities-tables/tasks.refs.gap
  it('marks each mention with no repo as a link gap', () => {
    expect(linkRefs('Ship PR 119 and #12', null)).toBe('Ship PR 119 ⚠ no link and 12 ⚠ no link');
  });
  // @req FR:priorities-tables/tasks.project
  it('reads the project file name, aliases and repo', () => {
    expect(projectFile('tasks/f.md', '# 👓 F\n- **Aliases:** f1, f2\n- **Repository:** [o/r](https://github.com/o/r)\n')).toEqual({ path: 'tasks/f.md', project: 'F', aliases: ['f1', 'f2'], repo: 'o/r' });
  });
});
