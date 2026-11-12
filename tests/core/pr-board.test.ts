import { activeAgents, afterOf, bucketOf, buildRows, ciOf, countRows, excluded, footerOf, groupOf, isHuman, parseQueue, projectOfRepo, stateOf, type BoardCtx, type PrFacts } from '../../src/core/pr-board';

const NOW = new Date('2026-11-11T12:00:00Z');
const pr = (o: Partial<PrFacts> = {}): PrFacts => ({
  url: 'https://github.com/Xerilium/stack/pull/1', repo: 'Xerilium/stack', number: 1, title: 'A PR', author: 'flanakin', draft: false,
  createdAt: '2026-11-10T12:00:00Z', updatedAt: '2026-11-11T11:00:00Z', headOid: 'abc1234def', headAt: '2026-11-11T11:30:00Z', body: '',
  labels: ['Status: 🤖 Autopilot'], assignees: [], requested: [], reviews: [], mergeable: 'MERGEABLE', checks: [{ name: 'ci', state: 'pass' }], threads: [], comments: [], ...o,
});
const ctx = (o: Partial<BoardCtx> = {}): BoardCtx => ({ user: 'flanakin', now: NOW, agentPrs: new Set(), ...o });

// @req FR:pr-page/state.rule @req FR:pr-page/state.@function @req FR:pr-page/state.why
describe('stateOf: the BLOCKED rule (owner me only for Michael-only gates)', () => {
  it('1. a Needs attention label is a decision for me', () => {
    const s = stateOf(pr({ labels: ['Status: 🤖 Autopilot', 'Needs: Attention 👋'] }), ctx());
    expect(s).toMatchObject({ owner: 'me', bucket: 'decide', blocker: 'Needs attention label', source: 'rule' });
  });
  it('2. a 🧭 comment with no later human comment is a decision; a later human comment clears it', () => {
    const ask = { author: 'flanakin', body: '🤖 [AI] 🧭 Keep the old API or break it?\nmore', url: 'https://github.com/Xerilium/stack/pull/1#issuecomment-9' };
    expect(stateOf(pr({ comments: [ask] }), ctx())).toMatchObject({ owner: 'me', bucket: 'decide', blocker: '🧭 Keep the old API or break it?', link: ask.url });
    expect(stateOf(pr({ comments: [ask, { author: 'flanakin', body: 'Break it.' }] }), ctx()).owner).toBe('none');
    // An agent reply (prefixed) does not clear it.
    expect(stateOf(pr({ comments: [ask, { author: 'flanakin', body: '🤖 [AI] still waiting' }] }), ctx()).owner).toBe('me');
    // A quote reply repeats the ask; it is an answer, not a new ask.
    expect(stateOf(pr({ comments: [ask, { author: 'flanakin', body: '> 🧭 Keep the old API or break it?\n\nBreak it.' }] }), ctx()).owner).toBe('none');
  });
  it('2. a 🧭 reply on an open thread is a decision, with the thread to reply to', () => {
    const s = stateOf(pr({ threads: [{ resolved: false, lastAuthor: 'flanakin', lastBody: '🤖 [AI] 🧭 Which name?', url: 'https://github.com/x/y/pull/1#discussion_r5', id: 5 }] }), ctx());
    expect(s).toMatchObject({ owner: 'me', bucket: 'decide', replyTo: 5, link: 'https://github.com/x/y/pull/1#discussion_r5' });
  });
  it('2. a thread ask stays open after a later agent note; a later human reply clears it', () => {
    const ask = { author: 'flanakin', body: '🤖 [AI] 🧭 Which name?', url: 'https://github.com/x/y/pull/1#discussion_r6' };
    const note = { author: 'flanakin', body: '🤖 [AI] still waiting', url: 'https://github.com/x/y/pull/1#discussion_r7' };
    const t = (comments: { author: string; body: string; url?: string }[]) => pr({ threads: [{ resolved: false, lastAuthor: 'flanakin', lastBody: comments[comments.length - 1].body, url: comments[comments.length - 1].url, id: 5, comments }] });
    expect(stateOf(t([ask, note]), ctx())).toMatchObject({ owner: 'me', blocker: '🧭 Which name?', replyTo: 5, link: ask.url });
    expect(stateOf(t([ask, note, { author: 'flanakin', body: 'Use B' }]), ctx()).owner).not.toBe('me');
  });
  it('3. my own hold on an open thread blocks on me', () => {
    const s = stateOf(pr({ threads: [{ resolved: false, lastAuthor: 'flanakin', lastBody: 'Hold until I test it live', url: 'u' }] }), ctx());
    expect(s).toMatchObject({ owner: 'me', blocker: 'Hold: Hold until I test it live' });
  });
  it('4. a workflow run that needs approval is an unblock', () => {
    expect(stateOf(pr({ checks: [{ name: 'build', state: 'action' }] }), ctx())).toMatchObject({ owner: 'me', bucket: 'unblock', blocker: 'Approve the workflow run' });
  });
  it('5. a re-review by another human is the reviewer, never me', () => {
    expect(stateOf(pr({ reviews: [{ author: 'roland', state: 'CHANGES_REQUESTED' }] }), ctx())).toMatchObject({ owner: 'reviewer', login: 'roland', blocker: 'Waiting on roland' });
    expect(stateOf(pr({ requested: ['roland'] }), ctx())).toMatchObject({ owner: 'reviewer', login: 'roland' });
    expect(stateOf(pr({ requested: ['copilot[bot]'] }), ctx()).owner).toBe('none');
  });
  it('6. checks queued over an hour are the runner; under an hour, CI', () => {
    expect(stateOf(pr({ checks: [{ name: 'e2e', state: 'pending', startedAt: '2026-11-11T10:30:00Z' }] }), ctx())).toMatchObject({ owner: 'runner' });
    expect(stateOf(pr({ checks: [{ name: 'e2e', state: 'pending', startedAt: '2026-11-11T11:30:00Z' }] }), ctx())).toMatchObject({ owner: 'ci' });
    // A queued run has no start: the head commit time counts.
    expect(stateOf(pr({ headAt: '2026-11-11T09:00:00Z', checks: [{ name: 'e2e', state: 'pending' }] }), ctx())).toMatchObject({ owner: 'runner' });
  });
  it('7. failing required check, conflict, or a waiting thread: agent work, stalled with no agent', () => {
    const fail = pr({ checks: [{ name: 'lint', state: 'fail', required: true }, { name: 'opt', state: 'fail', required: false }] });
    expect(stateOf(fail, ctx())).toMatchObject({ owner: 'none', stalled: true, blocker: 'No agent: Failing check lint' });
    expect(stateOf(fail, ctx({ agentPrs: new Set([fail.url.toLowerCase()]) }))).toMatchObject({ owner: 'none', stalled: false });
    // A failing check that is not required is not a signal.
    expect(stateOf(pr({ checks: [{ name: 'opt', state: 'fail', required: false }] }), ctx()).stalled).toBe(false);
    expect(stateOf(pr({ mergeable: 'CONFLICTING' }), ctx())).toMatchObject({ stalled: true, blocker: 'No agent: Merge conflict' });
    expect(stateOf(pr({ threads: [{ resolved: false, lastAuthor: 'copilot[bot]', lastBody: 'nit', url: 'https://github.com/t' }] }), ctx())).toMatchObject({ stalled: true, link: 'https://github.com/t' });
    expect(stateOf(pr({ threads: [{ resolved: true, lastAuthor: 'roland', lastBody: 'nit' }] }), ctx()).stalled).toBe(false);
  });
  it('9. otherwise nobody', () => {
    expect(stateOf(pr(), ctx())).toEqual({ owner: 'none', blocker: '', link: pr().url, stalled: false, source: 'rule' });
  });
});

// @req FR:pr-page/state.report
describe('stateOf: a Sweep Manager report wins when it matches the head', () => {
  const url = pr().url.toLowerCase();
  it('maps owner words and keeps the blocker', () => {
    const reports = new Map([[url, { owner: 'Michael', blocker: 'Prod deploy go needed', headSha: 'abc1234' }]]);
    expect(stateOf(pr(), ctx({ reports }))).toMatchObject({ owner: 'me', bucket: 'unblock', blocker: 'Prod deploy go needed', source: 'report' });
    expect(stateOf(pr(), ctx({ reports: new Map([[url, { owner: 'roland', nextAction: 'Re-review' }]]) }))).toMatchObject({ owner: 'reviewer', login: 'roland', blocker: 'Re-review' });
    expect(stateOf(pr(), ctx({ reports: new Map([[url, { owner: 'runner' }]]) })).owner).toBe('runner');
  });
  it('an unknown head never matches a report sha', () => {
    expect(stateOf(pr({ headOid: '' }), ctx({ reports: new Map([[url, { owner: 'michael', headSha: 'abc1234' }]]) })).source).toBe('rule');
  });
  it('an old head falls back to the rule', () => {
    expect(stateOf(pr(), ctx({ reports: new Map([[url, { owner: 'michael', headSha: 'fff0000' }]]) })).source).toBe('rule');
  });
});

// @req FR:pr-page/state.bucket
it('bucketOf: access, approval, secrets, billing, deploy, prod, runner admin are Unblock', () => {
  for (const t of ['Grant repo access', 'Approve the workflow run', 'Set the secret', 'Billing limit hit', 'Prod deploy go', 'Runner admin needed']) expect(bucketOf(t)).toBe('unblock');
  expect(bucketOf('Pick a name for the flag')).toBe('decide');
  for (const t of ['Pick the product name', 'Use the admin page layout', 'Production-ready copy?']) expect(bucketOf(t)).toBe(t.startsWith('Production') ? 'unblock' : 'decide');
  const ask = { author: 'flanakin', body: '🤖 [AI] 🧭 Grant repo access to the bot?' };
  expect(stateOf(pr({ comments: [ask] }), ctx()).bucket).toBe('unblock');
  // An agent prefix without the variation selector is still an agent.
  expect(stateOf(pr({ comments: [{ author: 'flanakin', body: '🤖 [AI] 🧭 Pick one' }, { author: 'flanakin', body: '⚛ [Catalyst] noted' }] }), ctx()).owner).toBe('me');
});

// @req FR:pr-page/group.@function
describe('groupOf', () => {
  it('paused, blocked, processing, waiting, pending, null', () => {
    expect(groupOf(pr({ labels: ['Status: ⏸️ Paused', 'Status: 🤖 Autopilot'] }), ctx())).toBe('paused');
    expect(groupOf(pr({ labels: ['Status: 🤖 Autopilot', 'Needs: Attention 👋'] }), ctx())).toBe('blocked');
    expect(groupOf(pr(), ctx())).toBe('processing');
    expect(groupOf(pr({ author: 'roland', assignees: ['FLANAKIN'] }), ctx())).toBe('processing');
    expect(groupOf(pr({ author: 'roland', labels: [], requested: ['flanakin'] }), ctx())).toBe('waiting');
    expect(groupOf(pr({ author: 'roland', labels: [], requested: ['flanakin'], reviews: [{ author: 'flanakin', state: 'APPROVED' }] }), ctx())).toBeNull();
    expect(groupOf(pr({ author: 'roland', labels: [], draft: true, requested: ['flanakin'] }), ctx())).toBeNull();
    expect(groupOf(pr({ labels: [] }), ctx())).toBe('pending');
    expect(groupOf(pr({ labels: [], draft: true }), ctx())).toBe('pending');
    expect(groupOf(pr({ author: 'roland', labels: [] }), ctx({ myRepos: ['Xerilium'] }))).toBe('waiting');
    expect(groupOf(pr({ author: 'roland', labels: [] }), ctx())).toBeNull(); // Xerilium is not owned by the user and no list is set
    expect(groupOf(pr({ author: 'roland', labels: [], repo: 'flanakin/x', url: 'https://github.com/flanakin/x/pull/1' }), ctx())).toBe('waiting');
  });
  it('exclude drops a PR by ref, url, or bare number', () => {
    expect(excluded(pr({ number: 918 }), ['#918'])).toBe(true);
    expect(excluded(pr(), ['xerilium/stack#1'])).toBe(true);
    expect(excluded(pr(), [pr().url])).toBe(true);
    expect(groupOf(pr({ number: 918 }), ctx({ exclude: ['918'] }))).toBeNull();
    expect(excluded(pr(), ['#2'])).toBe(false);
  });
  it('isHuman: agent prefixes are not the owner', () => {
    expect(isHuman('Flanakin', 'Yes', 'flanakin')).toBe(true);
    expect(isHuman('flanakin', '🤖 [AI] Yes', 'flanakin')).toBe(false);
    expect(isHuman('flanakin', '⚛️ [Catalyst] Yes', 'flanakin')).toBe(false);
    expect(isHuman('roland', 'Yes', 'flanakin')).toBe(false);
  });
});

// @req FR:pr-page/group.bucket @req FR:pr-page/group.healthy @req FR:pr-page/group.order @req FR:pr-page/data.row @req FR:pr-page/group.footer @req FR:pr-page/$row
describe('buildRows', () => {
  const at = (repo: string, n: number, o: Partial<PrFacts> = {}) => pr({ repo, number: n, url: `https://github.com/${repo}/pull/${n}`, ...o });
  it('badges, healthy flag, project order with FinOps hubs and Catalyst first, rank, then oldest', () => {
    const rows = buildRows([
      at('Xerilium/stack', 1, { createdAt: '2026-11-01T00:00:00Z' }),
      at('Xerilium/catalyst', 2),
      at('microsoft/finops-toolkit', 3, { author: 'roland', labels: [], requested: ['flanakin'] }),
      at('allytehq/allyte-web', 4, { labels: [] }),
      at('microsoft/finops-hubs', 5, { labels: ['Status: 🤖 Autopilot', 'Needs: Attention'] }),
      at('Xerilium/stack', 6, { createdAt: '2026-10-01T00:00:00Z', labels: [], draft: true }),
      at('Xerilium/stack', 7, { createdAt: '2026-11-05T00:00:00Z' }),
      at('Xerilium/stack', 1),
    ], ctx({ ranks: new Map([['https://github.com/xerilium/stack/pull/7', 1]]) }));
    expect(rows.map((r) => r.number)).toEqual([5, 4, 3, 2, 7, 6, 1]);
    const by = new Map(rows.map((r) => [r.number, r]));
    expect(by.get(5)).toMatchObject({ group: 'blocked', bucket: 'decide', project: 'allyte' });
    expect(by.get(4)).toMatchObject({ group: 'pending', bucket: 'review' });
    expect(by.get(6)).toMatchObject({ group: 'pending', draft: true });
    expect(by.get(6)!.bucket).toBeUndefined();
    expect(by.get(3)).toMatchObject({ group: 'waiting', bucket: 'approve', project: 'ftk' });
    expect(by.get(2)).toMatchObject({ group: 'processing', healthy: true, rank: null, ci: 'passing', autopilot: true });
    expect(by.get(7)!.rank).toBe(1);
    expect(countRows(rows)).toEqual({ blocked: 1, waiting: 1, processing: 3, pending: 2, paused: 0 });
    expect(footerOf(rows, 2)).toEqual({ running: 2, waiting: 3, parked: 1 });
  });
  it('projectOfRepo', () => {
    expect(['microsoft/finops-hubs', 'microsoft/finops-toolkit', 'FinOps-Open-Cost-and-Usage-Spec/FOCUS_Spec', 'flanakin/f4-music', 'Xerilium/stack', 'Xerilium/web', 'allytehq/site', 'o/r'].map(projectOfRepo))
      .toEqual(['allyte', 'ftk', 'focus', 'f4', 'xerilium', 'xerilium', 'allyte', 'other']);
  });
  it('ciOf', () => {
    expect(ciOf([])).toBe('none');
    expect(ciOf([{ name: 'a', state: 'skip' }])).toBe('none');
    expect(ciOf([{ name: 'a', state: 'pass' }, { name: 'b', state: 'pending' }])).toBe('pending');
    expect(ciOf([{ name: 'a', state: 'fail' }, { name: 'b', state: 'pending' }])).toBe('failing');
    expect(ciOf([{ name: 'a', state: 'pass' }])).toBe('passing');
  });
});

// @req FR:pr-page/data.after
it('afterOf: depends on, after, blocked by; at most 3; same repo as #n', () => {
  expect(afterOf('Depends on #12. After Xerilium/catalyst#3 and blocked by xerilium/stack#9. after #1', 'Xerilium/stack')).toEqual(['#12', 'Xerilium/catalyst#3', '#9']);
  expect(afterOf('no edges here', 'o/r')).toEqual([]);
});

// @req FR:pr-page/group.@function
it('activeAgents: running sessions with an open PR', () => {
  const a = activeAgents({ sessions: [
    { state: 'running', prs: [{ url: 'https://github.com/O/R/pull/1', state: 'OPEN' }] },
    { state: 'running', prs: [{ url: 'https://github.com/o/r/pull/2', state: 'MERGED' }] },
    { state: 'waiting', prs: [{ url: 'https://github.com/o/r/pull/3', state: 'OPEN' }] },
    { state: 'running', prs: [] },
  ] });
  expect(a.count).toBe(1);
  expect([...a.prs]).toEqual(['https://github.com/o/r/pull/1']);
});

// @req FR:pr-page/data.report @req FR:pr-page/data.escalations @req FR:pr-page/data.recs
describe('the pr-priority store files', () => {
  const U = (n: number) => `https://github.com/o/r/pull/${n}`;
  it('reads ranks, pins, records, escalations, acks, open recommendations, and excludes; drops bad parts', () => {
    const q = parseQueue({
      queue: { version: 1, rev: 3, items: [{ rank: 1, repo: 'o/r', number: 1, url: U(1), pinned: true }, { rank: 2, repo: 'o/r', number: 2, url: U(2), pinned: false }, { rank: 3, url: 'javascript:alert(1)' }] },
      state: {
        version: 1,
        records: {
          'o/r#1': { state: 'blocked-on-me', ts: '2026-11-11T00:00:00Z', owner: 'Michael', blocker: { text: 'Decide X', threadUrl: `${U(1)}#discussion_r5` }, headSha: 'ABC1234', bucket: 'unblock' },
          'o/r#2': { state: 'processing', ts: 'x', headSha: 'not-a-sha' },
          'o/r#3': { state: 'processing', ts: 'x', owner: 'Roland', nextAction: 'Re-review' },
        },
        acks: { 'o/r#1': [{ thread: `${U(1)}#discussion_r5`, note: 'Keep it', at: 't' }, { thread: 'ftp://x', note: 'n' }] },
        recs: [
          { id: 'pp-0000000a', repo: 'o/r', number: 1, url: U(1), agent: 'xe-cos', reason: 'Blocks release', toRank: 1, state: 'open', at: 'x' },
          { id: 'pp-0000000b', repo: 'o/r', number: 2, url: U(2), agent: 'xe-cos', reason: 'r', state: 'rejected', at: 'x' },
        ],
        escalations: {
          at: '2026-11-11',
          blockedAutopilot: [{ pr: U(1), status: 'decide', exactBlocker: 'Keep or break?', context: 'Two callers', recommendedAnswer: 'Keep\nignored' }, { pr: 'https://evil.test/x', status: 'decide', exactBlocker: 'b', context: 'c', recommendedAnswer: 'r' }],
          enableAutopilot: [1, 2, 3, 4].map((n) => ({ pr: U(n), whyEasy: 'Small' })), liveValidation: [],
        },
      },
      config: { exclude: ['o/r#918', 7] },
    });
    expect([...q.ranks.entries()]).toEqual([[U(1), 1], [U(2), 2]]);
    expect([...q.pinned]).toEqual([U(1)]);
    expect(q.reports.get(U(1))).toMatchObject({ owner: 'Michael', blocker: 'Decide X', link: `${U(1)}#discussion_r5`, headSha: 'abc1234', bucket: 'unblock' });
    expect(q.reports.has(U(2))).toBe(false);
    expect(q.reports.get(U(3))).toMatchObject({ owner: 'Roland', nextAction: 'Re-review' });
    expect(q.acks.get(U(1))).toEqual([{ thread: `${U(1)}#discussion_r5`, note: 'Keep it', at: 't' }]);
    expect([...q.recs.values()]).toEqual([{ id: 'pp-0000000a', agent: 'xe-cos', reason: 'Blocks release', toRank: 1 }]);
    expect(q.escalations!.blocked).toEqual([{ repo: 'o/r', number: 1, url: U(1), blocker: 'Keep or break?', context: 'Two callers', recommend: 'Keep', link: `${U(1)}#discussion_r5`, project: 'other' }]);
    expect(q.escalations!.enable).toHaveLength(3);
    expect(q.escalations!.enable[0].context).toBe('Small');
    expect(q.exclude).toEqual(['o/r#918']);
    expect(parseQueue({ queue: 'nope' }).ranks.size).toBe(0);
    expect(parseQueue({ state: { escalations: { blockedAutopilot: [], enableAutopilot: [], liveValidation: [] } } }).escalations).toBeUndefined();
  });
  it('an answered rule gate waits on the agent, not on the owner', () => {
    const p = pr({ threads: [{ resolved: false, lastAuthor: 'flanakin', lastBody: '🤖 [AI] 🧭 Which name?', url: 'https://github.com/x/y/pull/1#discussion_r5', id: 5 }] });
    const acks = new Map([[p.url.toLowerCase(), [{ thread: 'https://github.com/x/y/pull/1#discussion_r5', note: 'Use B', at: 't' }]]]);
    expect(stateOf(p, ctx({ acks }))).toMatchObject({ owner: 'none', blocker: 'Answered: Use B', answered: 'Use B' });
    expect(groupOf(p, ctx({ acks }))).toBe('processing');
  });
});
