import { readFileSync } from 'fs';
import { join } from 'path';
import { parse } from 'yaml';

const root = join(__dirname, '..', '..');
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ap = require(join(root, '.github/scripts/autopilot-core.cjs'));

const SHA = 'a'.repeat(40);
const OTHER = 'b'.repeat(40);
const cert = (sha: string, login = 'owner') => ({ body: ap.formatCertification(sha), user: { login } });
const run = (name: string, conclusion: string | null) => ({ __typename: 'CheckRun', name, conclusion });
const green = ap.checksOf([run('test', 'SUCCESS'), run('e2e', 'SUCCESS')]);
const base = {
  labels: [ap.AUTOPILOT, ap.READY, ap.FINALIZED],
  ready: true,
  certified: true,
  threadsResolved: true,
  checks: green,
  mergeState: 'CLEAN',
  behindBy: 0,
};

// @req FR:autopilot/gates.all
describe('mergeBlockers', () => {
  it('merges when every gate holds', () => {
    expect(ap.mergeBlockers(base)).toEqual([]);
  });
  it.each([
    ['paused', { labels: [...base.labels, ap.PAUSED] }, 'paused'],
    ['wip', { labels: [...base.labels, ap.WIP] }, 'wip'],
    ['blocked', { labels: [...base.labels, ap.BLOCKED] }, 'blocked'],
    ['no autopilot', { labels: [ap.READY, ap.FINALIZED] }, 'no-autopilot'],
    ['not finalized', { labels: [ap.AUTOPILOT, ap.READY] }, 'not-finalized'],
    ['not ready', { ready: false }, 'not-ready'],
    ['no Ready label', { labels: [ap.AUTOPILOT, ap.FINALIZED] }, 'not-ready'],
    ['behind the base', { behindBy: 2 }, 'behind-base'],
    ['unreadable base comparison', { behindBy: null }, 'base-unreadable'],
    ['head moved past the certification', { certified: false }, 'head-not-certified'],
    ['unresolved thread', { threadsResolved: false }, 'threads-unresolved'],
    ['failing check', { checks: ap.checksOf([run('test', 'FAILURE')]) }, 'checks-failing'],
    ['pending check', { checks: ap.checksOf([run('test', null)]) }, 'checks-pending'],
    ['no checks yet', { checks: ap.checksOf([]) }, 'checks-pending'],
    ['unreadable checks', { checks: ap.checksOf([run('test', 'SUCCESS')], false) }, 'checks-unreadable'],
    ['behind', { mergeState: 'BEHIND' }, 'merge-state-behind'],
    ['dirty', { mergeState: 'DIRTY' }, 'merge-state-dirty'],
    ['unknown', { mergeState: 'UNKNOWN' }, 'merge-state-unknown'],
  ])('blocks on %s', (_n, patch, reason) => {
    const out = ap.mergeBlockers({ ...base, ...patch });
    expect(out).toContain(reason);
  });
});

// @req FR:autopilot/gates.all.checks
describe('checksOf', () => {
  it('counts success, neutral, and skipped as green', () => {
    const c = ap.checksOf([run('a', 'SUCCESS'), run('b', 'NEUTRAL'), run('c', 'SKIPPED'), { __typename: 'StatusContext', context: 'd', state: 'SUCCESS' }]);
    expect(c.green).toBe(true);
  });
  it('sorts failing from pending, for runs and statuses', () => {
    const c = ap.checksOf([
      run('a', 'FAILURE'), run('b', 'CANCELLED'), run('c', 'TIMED_OUT'), run('d', null),
      { __typename: 'StatusContext', context: 'e', state: 'ERROR' },
      { __typename: 'StatusContext', context: 'f', state: 'PENDING' },
    ]);
    expect(c.failing).toEqual(['a', 'b', 'c', 'e']);
    expect(c.pending).toEqual(['d', 'f']);
    expect(c.green).toBe(false);
  });
  it('is not green with no checks or an incomplete read', () => {
    expect(ap.checksOf([]).green).toBe(false);
    expect(ap.checksOf(undefined).green).toBe(false);
    expect(ap.checksOf([run('a', 'SUCCESS')], false).green).toBe(false);
  });
});

// @req FR:autopilot/ready.derive
describe('isReadyOf', () => {
  const approve = (login: string, extra = {}) => ({ state: 'APPROVED', author: { login, __typename: 'User' }, ...extra });
  const input = { isDraft: false, authorLogin: 'me', reviews: [], labels: [] as string[] };
  it('counts Autopilot as the owner sign-off', () => {
    expect(ap.isReadyOf({ ...input, labels: [ap.AUTOPILOT] })).toBe(true);
  });
  it('counts a person other than the author, not a bot or the author', () => {
    expect(ap.isReadyOf({ ...input, reviews: [approve('you')] })).toBe(true);
    expect(ap.isReadyOf({ ...input, reviews: [approve('me')] })).toBe(false);
    expect(ap.isReadyOf({ ...input, reviews: [approve('bot', { author: { login: 'bot', __typename: 'Bot' } })] })).toBe(false);
  });
  it('is never ready as a draft or with changes requested', () => {
    expect(ap.isReadyOf({ ...input, isDraft: true, labels: [ap.AUTOPILOT] })).toBe(false);
    const cr = { state: 'CHANGES_REQUESTED', author: { login: 'you', __typename: 'User' } };
    expect(ap.isReadyOf({ ...input, labels: [ap.AUTOPILOT], reviews: [cr] })).toBe(false);
  });
  it('is not ready with neither a sign-off nor an approval', () => {
    expect(ap.isReadyOf(input)).toBe(false);
  });
  it('reads only each reviewer latest review', () => {
    expect(ap.latestReviewStateOf([{ state: 'APPROVED', author: { login: 'a' } }, { state: 'COMMENTED', author: null }])).toEqual({ a: 'APPROVED' });
  });
});

// @req FR:autopilot/gates.all.threads
describe('threads', () => {
  it('counts unresolved ones and blocks on an unreadable list', () => {
    expect(ap.unresolvedThreadsOf([{ isResolved: true }, { isResolved: false }])).toBe(1);
    expect(ap.allThreadsResolvedOf([{ isResolved: true }])).toBe(true);
    expect(ap.allThreadsResolvedOf([{ isResolved: true }], false)).toBe(false);
    expect(ap.allThreadsResolvedOf([{ isResolved: false }])).toBe(false);
    expect(ap.allThreadsResolvedOf(undefined)).toBe(true);
  });
});

// @req FR:autopilot/cert.comment @req FR:autopilot/cert.match
describe('certification', () => {
  it('round-trips the head SHA', () => {
    expect(ap.parseCertification(ap.formatCertification(SHA))).toBe(SHA);
  });
  it.each([[''], [null], ['head SHA `' + SHA + '`'], [ap.CERT_MARKER + '\nno sha here'], [ap.CERT_MARKER + '\nhead SHA `abc`']])(
    'reads %p as no certification',
    (body) => expect(ap.parseCertification(body)).toBeNull(),
  );
  it('lists who certified the head, once each, in any order', () => {
    expect(ap.certifiersOf([cert(OTHER, 'x'), { body: 'hi', user: { login: 'y' } }, cert(SHA, 'a'), cert(SHA, 'a'), cert(SHA, 'b')], SHA)).toEqual(['a', 'b']);
  });
  it('matches the current head when a trusted login certified it', () => {
    expect(ap.isCertifiedOf([cert(OTHER), cert(SHA)], SHA, ['owner'])).toBe(true);
  });
  it('does not match a different head, no comments, or no head', () => {
    expect(ap.isCertifiedOf([cert(OTHER)], SHA, ['owner'])).toBe(false);
    expect(ap.isCertifiedOf([], SHA, ['owner'])).toBe(false);
    expect(ap.isCertifiedOf(undefined, SHA, ['owner'])).toBe(false);
    expect(ap.isCertifiedOf([cert(SHA)], null, ['owner'])).toBe(false);
  });
  it('ignores a certification from a login without write access', () => {
    expect(ap.isCertifiedOf([cert(SHA, 'stranger')], SHA, ['owner'])).toBe(false);
    expect(ap.isCertifiedOf([cert(SHA, 'stranger')], SHA, [])).toBe(false);
    expect(ap.isCertifiedOf([cert(SHA, 'stranger')], SHA, undefined)).toBe(false);
  });
  it('ignores a comment with no author', () => {
    expect(ap.certifiersOf([{ body: ap.formatCertification(SHA), user: null }], SHA)).toEqual([]);
  });
});

// @req FR:autopilot/cert.stale @req FR:autopilot/ready.derive
describe('labelPlanOf', () => {
  it('adds Ready when derived and removes it when not', () => {
    expect(ap.labelPlanOf({ labels: [], ready: true, certified: false })).toEqual({ toAdd: [ap.READY], toRemove: [] });
    expect(ap.labelPlanOf({ labels: [ap.READY], ready: false, certified: false })).toEqual({ toAdd: [], toRemove: [ap.READY] });
    expect(ap.labelPlanOf({ labels: [ap.READY], ready: true, certified: false })).toEqual({ toAdd: [], toRemove: [] });
  });
  it('removes a stale Finalized and keeps a certified one', () => {
    expect(ap.labelPlanOf({ labels: [ap.FINALIZED], ready: false, certified: false }).toRemove).toEqual([ap.FINALIZED]);
    expect(ap.labelPlanOf({ labels: [ap.FINALIZED], ready: false, certified: true }).toRemove).toEqual([]);
    expect(ap.staleFinalizedOf([], false)).toBe(false);
  });
  it('leaves Finalized alone when the comments could not be read', () => {
    expect(ap.labelPlanOf({ labels: [ap.FINALIZED], ready: false, certified: false, certKnown: false }).toRemove).toEqual([]);
  });
  it('touches no other label', () => {
    const p = ap.labelPlanOf({ labels: [ap.PAUSED, ap.WIP, ap.AUTOPILOT, 'bug'], ready: false, certified: false });
    expect(p).toEqual({ toAdd: [], toRemove: [] });
  });
});

// @req FR:autopilot/gates.retry
describe('isRetryableMergeError', () => {
  it('retries not-mergeable-yet, rate limits, and server errors', () => {
    expect(ap.isRetryableMergeError('Base branch was modified', 405)).toBe(true);
    expect(ap.isRetryableMergeError('x', 429)).toBe(true);
    expect(ap.isRetryableMergeError('x', 502)).toBe(true);
    expect(ap.isRetryableMergeError('Pull request is not mergeable', undefined)).toBe(true);
  });
  it('gives up on a head mismatch, conflict, or missing permission', () => {
    expect(ap.isRetryableMergeError('Head branch was modified. Review and try the merge again.', 409)).toBe(false);
    expect(ap.isRetryableMergeError('Resource not accessible by integration', 403)).toBe(false);
    expect(ap.isRetryableMergeError('Not Found', 404)).toBe(false);
    expect(ap.isRetryableMergeError(undefined, undefined)).toBe(false);
  });
});

// @req FR:autopilot/labels.set @req FR:autopilot/labels.owners @req FR:autopilot/triggers.self
describe('labels', () => {
  it('defines the six labels with a color and description', () => {
    expect(ap.AUTOPILOT_LABELS.map((l: { name: string }) => l.name)).toEqual([
      ap.AUTOPILOT, ap.READY, ap.FINALIZED, ap.PAUSED, ap.WIP, ap.BLOCKED,
    ]);
    for (const l of ap.AUTOPILOT_LABELS) {
      expect(l.color).toMatch(/^[0-9A-Fa-f]{6}$/);
      expect(l.description.length).toBeGreaterThan(0);
    }
    expect(ap.TRIGGER_LABELS).toHaveLength(6);
  });
  it('writes labels only with GITHUB_TOKEN, so its own writes start no run', () => {
    const text = readFileSync(join(root, '.github/workflows/autopilot.yml'), 'utf8');
    expect(text).not.toMatch(/secrets\.|github-token/);
  });
});

// @req FR:autopilot/safety.base @req FR:autopilot/safety.perms @req FR:autopilot/safety.pinned @req FR:autopilot/triggers.events @req FR:autopilot/triggers.sweep @req FR:autopilot/triggers.serial @req FR:autopilot/deploy.dispatch
describe('autopilot workflow', () => {
  const text = readFileSync(join(root, '.github/workflows/autopilot.yml'), 'utf8');
  const wf = parse(text);
  const job = wf.jobs.reconcile;
  it('runs from the default branch on the events, a sweep, and manual dispatch', () => {
    expect(Object.keys(wf.on).sort()).toEqual(['issue_comment', 'pull_request_target', 'schedule', 'workflow_dispatch', 'workflow_run']);
    expect(wf.on.workflow_run.workflows).toEqual(['CI', 'E2E']);
    expect(wf.on.schedule[0].cron).toBe('*/10 * * * *');
    expect(wf.on.pull_request).toBeUndefined();
  });
  it('checks out only the default branch and never PR code', () => {
    const co = job.steps.find((s: { uses?: string }) => s.uses?.startsWith('actions/checkout'));
    expect(co.with.ref).toBe('${{ github.event.repository.default_branch }}');
    expect(co.with['persist-credentials']).toBe(false);
    expect(text).not.toMatch(/head\.sha|head\.ref|pull\/\$\{\{/);
  });
  it('keeps top-level read and gives the one job its write scopes', () => {
    expect(wf.permissions).toEqual({ contents: 'read' });
    expect(job.permissions).toEqual({ contents: 'write', 'pull-requests': 'write', issues: 'write', actions: 'write', checks: 'read', statuses: 'read' });
  });
  it('ignores forks and certification-looking comments from strangers', () => {
    expect(job.if).toContain('head.repo.full_name == github.repository');
    expect(job.if).toContain('<!-- stack:finalized-head-sha -->');
    expect(job.if).toContain('author_association');
  });
  it('hands the whole job to the tested module and interpolates nothing into the script', () => {
    const script = job.steps.find((s: { uses?: string }) => s.uses?.startsWith('actions/github-script')).with.script as string;
    expect(script).toContain('autopilot-run.cjs');
    expect(script).not.toContain('${{');
  });
  it('serializes per PR without cancelling a merge', () => {
    expect(wf.concurrency['cancel-in-progress']).toBe(false);
    expect(wf.concurrency.group).toContain("'sweep'");
  });
  it('uses the workflow_run names CI and E2E', () => {
    expect(parse(readFileSync(join(root, '.github/workflows/ci.yml'), 'utf8')).name).toBe('CI');
    expect(parse(readFileSync(join(root, '.github/workflows/e2e.yml'), 'utf8')).name).toBe('E2E');
  });
});
