/** @req FR:agent-sessions/sessions.owner @req FR:agent-sessions/sessions.owner.repos @req FR:agent-sessions/sessions.owner.worktree */
import { ownerOf, projectRepos, repoOf, type RepoMap } from '../../src/core/repos';
import { MemoryStorage } from '../../src/core/storage';

const ALLYTE = `# Allyte

- **Aliases:** allyte
- **Repos:** finops-hubs, allytehq/allyte-web
- **Agents:** \`allyte-cos\` — Allyte chief of staff

## Active

- [ ] Ship
`;
const FTK = `# FinOps toolkit

- **Repository:** [microsoft/finops-toolkit](https://github.com/microsoft/finops-toolkit)
- **Aliases:** ftk

## Active

- [ ] Release
`;
const F4 = `# 🎧 Flantastic 4

- **Aliases:** f4, flantastic
- **Repos:**
  - f4-music
  - flanakin/f4-site

## Active

- [ ] Sing
`;
const STACK = `# Stack

- **Aliases:** stack

## Active

- [ ] Build
`;

// @req FR:agent-sessions/sessions.owner.worktree
describe('repoOf', () => {
  it('names the repo folder, resolving every worktree form', () => {
    expect(repoOf('/Users/me/dev/stack')).toBe('stack');
    expect(repoOf('/Users/me/dev/stack/.claude/worktrees/zany-fox-1a2b3c')).toBe('stack');
    expect(repoOf('/Users/me/dev/FOCUS_Spec.worktrees/1-5-naming')).toBe('FOCUS_Spec');
    expect(repoOf('/Users/me/dev/catalyst-wt-release')).toBe('catalyst');
    expect(repoOf('/Users/me/dev/finops-hubs-wt-sync')).toBe('finops-hubs');
    expect(repoOf('/Users/me/dev/catalyst-wt-release/web')).toBe('catalyst'); // a subfolder of a -wt- checkout
    expect(repoOf('/Users/me/dev/stack/.claude/worktrees/a-b-c1d2e3/web')).toBe('stack');
    expect(repoOf('')).toBe('');
  });
});

// @req FR:agent-sessions/sessions.owner.repos
describe('ownerOf', () => {
  const map: RepoMap = [
    { project: 'allyte', names: ['allyte', 'finops-hubs', 'allyte-web'] },
    { project: 'finops-toolkit', names: ['finops-toolkit', 'ftk'] },
    { project: 'flantastic-4', names: ['flantastic-4', 'f4', 'flantastic', 'f4-music', 'f4-site'] },
    { project: 'stack', names: ['stack'] },
  ];
  it('matches a folder by name, alias, repo, or `<name>-` prefix; case and _ do not matter', () => {
    expect(ownerOf('stack', map)).toBe('stack');
    expect(ownerOf('finops-hubs', map)).toBe('allyte');
    expect(ownerOf('allyte-marketplace', map)).toBe('allyte');
    expect(ownerOf('f4-music', map)).toBe('flantastic-4');
    expect(ownerOf('F4_Site', map)).toBe('flantastic-4');
    expect(ownerOf('finops-toolkit', map)).toBe('finops-toolkit');
    expect(ownerOf('ftk-fork', map)).toBe('finops-toolkit');
    expect(ownerOf('maenifold-rs', map)).toBeNull();
    expect(ownerOf('', map)).toBeNull();
  });
  it('a folder two projects claim goes to the longer name, then the first project', () => {
    const m: RepoMap = [{ project: 'a', names: ['fin'] }, { project: 'b', names: ['finops'] }, { project: 'c', names: ['finops'] }];
    expect(ownerOf('finops-hubs', m)).toBe('b');
    expect(ownerOf('fin-x', m)).toBe('a');
  });
  it('projectRepos reads Repos (inline or nested), Repository, the name, and Aliases from every project file', async () => {
    const storage = new MemoryStorage();
    await storage.write('tasks/allyte.md', ALLYTE);
    await storage.write('tasks/finops-toolkit.md', FTK);
    await storage.write('tasks/flantastic-4.md', F4);
    await storage.write('tasks/stack.md', STACK);
    const m = await projectRepos({ storage });
    expect(m).toEqual([
      { project: 'allyte', names: ['allyte', 'finops-hubs', 'allyte-web'] },
      { project: 'finops-toolkit', names: ['finops-toolkit', 'ftk'] },
      { project: 'flantastic-4', names: ['flantastic-4', 'f4', 'flantastic', 'f4-music', 'f4-site'] },
      { project: 'stack', names: ['stack'] },
    ]);
    expect(ownerOf(repoOf('/x/dev/allyte-web/.claude/worktrees/a-b-c1d2e3'), m)).toBe('allyte');
  });
});
