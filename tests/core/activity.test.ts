import { agentActivity, prLinks, type PrStatus, type PrStatusProvider } from '../../src/core/activity';
import { sendToInbox } from '../../src/core/inbox';
import { MemoryStorage } from '../../src/core/storage';

const NOW = new Date('2026-10-28T18:00:00Z');
const DOC = `# Alpha

## 🔄 Active

- [ ] Launch
  - [ ] 🪄 Draft notes https://github.com/o/r/pull/7
  - [ ] 🙋 Approve the notes
  - [ ] 🚧 🤖 Fix the build
  - [ ] 🤖 Write tests — https://github.com/o/r/pull/8
    > follow-up https://github.com/o/other/pull/2 and https://github.com/o/r/pull/8
  - [ ] 🤖 Queued thing
  - [x] 🤖 Done thing https://github.com/o/r/pull/1
- [ ] 🤖 💤 Oct 30 Snoozed agent job
- [x] Closed parent
  - [ ] 🤖 Under a closed parent

## 📋 Backlog

- [ ] 🤖 Someday job
- [ ] 🚧 🪄 Started from backlog https://github.com/o/r/pull/9
`;

const status = (m: Record<string, PrStatus>): PrStatusProvider => async (prs) => new Map(prs.filter((p) => m[p.url]).map((p) => [p.url, m[p.url]]));

async function mk(doc = DOC) {
  const storage = new MemoryStorage();
  await storage.write('tasks/alpha.md', doc);
  return { storage, ctx: { storage, now: () => NOW } };
}
const pr = (n: number, repo = 'o/r') => `https://github.com/${repo}/pull/${n}`;

// @req FR:agent-inbox/activity.prs
describe('pr links', () => {
  it('finds GitHub pull request links, deduplicated, at most 5', () => {
    expect(prLinks(['see https://github.com/o/r/pull/8.', 'and https://github.com/o/r/pull/8 again', '<https://github.com/a/b/pull/3>'])).toEqual([
      { url: pr(8), repo: 'o/r', number: 8 }, { url: pr(3, 'a/b'), repo: 'a/b', number: 3 },
    ]);
    expect(prLinks([Array.from({ length: 7 }, (_, i) => pr(i + 1)).join(' ')])).toHaveLength(5);
    expect(prLinks(['https://gitlab.com/o/r/pull/1 https://github.com/o/r/issues/2'])).toEqual([]);
  });
});

// @req FR:agent-inbox/activity.rows @req FR:agent-inbox/activity.state @req FR:agent-inbox/activity.waiting
describe('agent rows', () => {
  it('lists open agent rows in Active or in progress, with state from artifacts', async () => {
    const { ctx } = await mk();
    const items = await agentActivity(ctx);
    const by = Object.fromEntries(items.map((i) => [i.title, i]));
    expect(Object.keys(by).sort()).toEqual(['Draft notes https://github.com/o/r/pull/7', 'Fix the build', 'Queued thing', 'Started from backlog https://github.com/o/r/pull/9', 'Write tests — https://github.com/o/r/pull/8'].sort());
    expect(by['Draft notes https://github.com/o/r/pull/7']).toMatchObject({ state: 'waiting', project: 'alpha', ref: 'alpha:5', waitingOn: 'alpha:6' });
    expect(by['Fix the build'].state).toBe('waiting'); // sibling 🙋 is open
    expect(by['Write tests — https://github.com/o/r/pull/8'].prs.map((p) => p.url)).toEqual([pr(8), pr(2, 'o/other')]);
  });
  it('without a waiting sibling: working, queued', async () => {
    const { ctx } = await mk(DOC.replace('  - [ ] 🙋 Approve the notes\n', ''));
    const by = Object.fromEntries((await agentActivity(ctx)).map((i) => [i.title.split(' ')[0] + ' ' + i.title.split(' ')[1], i.state]));
    expect(by).toMatchObject({ 'Fix the': 'working', 'Queued thing': 'queued', 'Draft notes': 'queued', 'Started from': 'working' });
  });
});

// @req FR:agent-inbox/activity.status @req FR:agent-inbox/activity.state @req FR:agent-inbox/activity.order
describe('pull request status', () => {
  it('derives merged, failing, review, ci, working from PR state and checks; sorts by attention', async () => {
    const { ctx } = await mk(DOC.replace('  - [ ] 🙋 Approve the notes\n', ''));
    const prs = status({
      [pr(7)]: { state: 'merged', checks: 'passing', title: 'Notes', updatedAt: '2026-10-28T10:00:00Z' },
      [pr(8)]: { state: 'open', checks: 'failing', title: 'Tests', updatedAt: '2026-10-28T12:00:00Z' },
      [pr(2, 'o/other')]: { state: 'open', checks: 'passing', title: 'Other', updatedAt: '2026-10-28T11:00:00Z' },
      [pr(9)]: { state: 'draft', checks: 'pending', title: 'Draft', updatedAt: '2026-10-28T09:00:00Z' },
    });
    const items = await agentActivity({ ...ctx, prs });
    expect(items.map((i) => [i.title.slice(0, 12), i.state])).toEqual([
      ['Write tests ', 'failing'], ['Draft notes ', 'merged'], ['Started from', 'working'], ['Fix the buil', 'working'], ['Queued thing', 'queued'],
    ]);
    expect(items[0].prs[0]).toMatchObject({ state: 'open', checks: 'failing', title: 'Tests' });
    expect(items[0].since).toBe('2026-10-28T12:00:00Z');
  });
  it('review when an open PR passes; ci when pending', async () => {
    const one = (checks: PrStatus['checks']) => status({ [pr(7)]: { state: 'open', checks, title: 't', updatedAt: '2026-10-28T10:00:00Z' } });
    const doc = DOC.replace('  - [ ] 🙋 Approve the notes\n', '');
    const { ctx } = await mk(doc);
    const st = async (p: PrStatusProvider) => (await agentActivity({ ...ctx, prs: p })).find((i) => i.ref === 'alpha:5')!.state;
    expect(await st(one('passing'))).toBe('review');
    expect(await st(one('none'))).toBe('review');
    expect(await st(one('pending'))).toBe('ci');
  });
  it('a failing provider leaves PRs without status', async () => {
    const { ctx } = await mk();
    const items = await agentActivity({ ...ctx, prs: async () => { throw new Error('rate limited'); } });
    expect(items.find((i) => i.ref === 'alpha:5')!.prs[0]).toEqual({ url: pr(7), repo: 'o/r', number: 7 });
  });
});

// @req FR:agent-inbox/activity.log @req FR:agent-inbox/activity.replies
describe('log and replies', () => {
  it('uses the newest result log entry for the row and counts open replies', async () => {
    const { ctx, storage } = await mk(DOC.replace('  - [ ] 🙋 Approve the notes\n', ''));
    await storage.write('tasks/logs/alpha.md', [
      '# Alpha agent log', '',
      '## 2026-10-27T10:00:00.000Z', '', '- actor: token:a', '- ref: tasks/alpha.md:8', '- level: assist', '- action: claimed', '',
      '## 2026-10-28T09:00:00.000Z', '', '- actor: token:a', '- ref: tasks/alpha.md:8', '- level: assist', '- action: result', '- outcome: blocked', '- summary: Needs a secret', '',
      '## 2026-10-28T17:00:00.000Z', '', '- actor: token:a', '- ref: tasks/alpha.md:10', '- level: assist', '- action: claimed', '',
    ].join('\n'));
    await sendToInbox(ctx, { path: 'tasks/alpha.md', line: 9 }, 'Do the easy one first', 'reply');
    const items = await agentActivity(ctx);
    const write = items.find((i) => i.ref === 'alpha:7')!;
    expect(write).toMatchObject({ state: 'waiting', last: { at: '2026-10-28T09:00:00.000Z', action: 'result', outcome: 'blocked', summary: 'Needs a secret' } });
    const queued = items.find((i) => i.ref === 'alpha:9')!;
    expect(queued).toMatchObject({ state: 'working', replies: 1, last: { action: 'claimed' } });
  });
});
