import { join } from 'path';

const root = join(__dirname, '..', '..');
/* eslint-disable @typescript-eslint/no-require-imports */
const ap = require(join(root, '.github/scripts/autopilot-core.cjs'));
const { run } = require(join(root, '.github/scripts/autopilot-run.cjs'));
/* eslint-enable @typescript-eslint/no-require-imports */

const SHA = 'c'.repeat(40);
const NEWER = 'd'.repeat(40);
const GOOD = [ap.AUTOPILOT, ap.FINALIZED];
const ok = [{ __typename: 'CheckRun', name: 'test', conclusion: 'SUCCESS' }];
const owner = (sha: string) => ({ body: ap.formatCertification(sha), user: { login: 'owner' } });

interface Opts {
  labels?: string[];
  comments?: unknown[] | Error;
  threads?: { isResolved: boolean }[];
  checks?: unknown[];
  rollupOid?: string;
  mergeStates?: string[]; // one per evaluation
  behindBy?: number;
  headRepo?: string;
  reviews?: unknown[];
  perm?: string | Error;
  mergeError?: { message: string; status: number } | null;
  mergeErrorOnce?: boolean;
  event?: string;
  payload?: Record<string, unknown>;
  baseRefName?: string;
  state?: string;
  isDraft?: boolean;
  defaultBranch?: string;
  sweep?: number[];
  labelMissing?: boolean;
  compareError?: boolean;
  dispatchError?: boolean;
  mergedAtEval?: number; // another actor merges it before this evaluation
}

async function scenario(o: Opts = {}) {
  const calls: unknown[][] = [];
  const logs: string[] = [];
  const st = { labels: [...(o.labels ?? GOOD)], state: o.state ?? 'OPEN', evals: 0, merged: false, mergeFails: 0 };
  const pr = () => {
    const mergeState = (o.mergeStates ?? ['CLEAN'])[Math.min(st.evals, (o.mergeStates ?? ['CLEAN']).length - 1)];
    st.evals += 1;
    return {
      state: st.merged || (o.mergedAtEval !== undefined && st.evals > o.mergedAtEval) ? 'MERGED' : st.state, isDraft: o.isDraft ?? false, mergeStateStatus: mergeState, headRefOid: SHA,
      baseRefName: o.baseRefName ?? 'main', headRepository: { nameWithOwner: o.headRepo ?? 'o/r' },
      author: { login: 'me' }, labels: { nodes: st.labels.map((name) => ({ name })) },
      reviewThreads: { pageInfo: { hasNextPage: false }, nodes: o.threads ?? [] },
      reviews: { nodes: o.reviews ?? [] },
      commits: { nodes: [{ commit: { oid: o.rollupOid ?? SHA, statusCheckRollup: { contexts: { pageInfo: { hasNextPage: false }, nodes: o.checks ?? ok } } } }] },
    };
  };
  const github = {
    graphql: async () => ({ repository: { pullRequest: pr() } }),
    paginate: async (fn: string) => {
      if (fn === 'listComments') {
        if (o.comments instanceof Error) throw o.comments;
        return o.comments ?? [owner(SHA)];
      }
      return (o.sweep ?? [7]).map((number) => ({ number, pull_request: {} }));
    },
    rest: {
      issues: {
        listComments: 'listComments', listForRepo: 'listForRepo',
        getLabel: async () => { if (o.labelMissing) throw Object.assign(new Error('nf'), { status: 404 }); return {}; },
        createLabel: async (a: { name: string }) => { calls.push(['createLabel', a.name]); },
        addLabels: async (a: { labels: string[] }) => { calls.push(['addLabels', ...a.labels]); st.labels.push(...a.labels); },
        removeLabel: async (a: { name: string }) => { calls.push(['removeLabel', a.name]); st.labels = st.labels.filter((l) => l !== a.name); },
      },
      repos: {
        getCollaboratorPermissionLevel: async () => {
          if (o.perm instanceof Error) throw o.perm;
          return { data: { permission: o.perm ?? 'write' } };
        },
        compareCommitsWithBasehead: async () => {
          if (o.compareError) throw Object.assign(new Error('boom'), { status: 500 });
          return { data: { behind_by: o.behindBy ?? 0 } };
        },
      },
      pulls: {
        merge: async (a: { merge_method: string; sha: string }) => {
          calls.push(['merge', a.merge_method, a.sha]);
          if (o.mergeError && (!o.mergeErrorOnce || st.mergeFails++ === 0)) throw Object.assign(new Error(o.mergeError.message), { status: o.mergeError.status });
          st.merged = true;
        },
      },
      actions: {
        createWorkflowDispatch: async (a: { workflow_id: string; ref: string }) => {
          if (o.dispatchError) throw Object.assign(new Error('x'), { status: 500 });
          calls.push(['dispatch', a.workflow_id, a.ref]);
        },
      },
    },
  };
  const summary = { addHeading() { return summary; }, addTable() { return summary; }, write: async () => summary };
  const core = {
    info: (m: string) => logs.push(m), warning: (m: string) => logs.push(`WARN ${m}`),
    setFailed: (m: string) => logs.push(`FAIL ${m}`), summary,
  };
  const context = {
    repo: { owner: 'o', repo: 'r' }, eventName: o.event ?? 'workflow_dispatch',
    payload: { repository: { default_branch: o.defaultBranch ?? 'main' }, ...(o.payload ?? { inputs: { pr: '7' } }) },
  };
  await run({ github, context, core, sleep: async () => {} });
  const names = calls.map((c) => c[0]);
  const result = logs.filter((l) => l.startsWith('{')).map((l) => JSON.parse(l))[0];
  return { calls, names, logs, result, labels: st.labels };
}

// @req FR:autopilot/gates.all @req FR:autopilot/gates.pin @req FR:autopilot/deploy.dispatch
describe('autopilot run', () => {
  it('adds Ready, squash-merges pinned to the head, then dispatches deploy', async () => {
    const r = await scenario();
    expect(r.calls).toEqual([['addLabels', ap.READY], ['merge', 'squash', SHA], ['dispatch', 'deploy.yml', 'main']]);
    expect(r.result).toMatchObject({ action: 'merged', deploy: 'dispatched', labelsAdded: [ap.READY] });
  });
  it('creates a missing label before adding it', async () => {
    // @req FR:autopilot/labels.ensure
    const r = await scenario({ labelMissing: true });
    expect(r.names.slice(0, 2)).toEqual(['createLabel', 'addLabels']);
  });
  it('does not touch a Ready label that is already right', async () => {
    const r = await scenario({ labels: [...GOOD, ap.READY] });
    expect(r.names).toEqual(['merge', 'dispatch']);
  });
  it('does not dispatch deploy for a base that is not the default branch', async () => {
    const r = await scenario({ baseRefName: 'feature' });
    expect(r.names).toEqual(['addLabels', 'merge']);
  });
  it('follows the repo default branch name for the deploy dispatch', async () => {
    const r = await scenario({ baseRefName: 'trunk', defaultBranch: 'trunk' });
    expect(r.calls).toContainEqual(['dispatch', 'deploy.yml', 'trunk']);
  });
  it('records a failed deploy dispatch and keeps the merge', async () => {
    // @req FR:autopilot/deploy.dispatch.fail
    const r = await scenario({ dispatchError: true });
    expect(r.result).toMatchObject({ action: 'merged', deploy: 'dispatch failed 500' });
    expect(r.logs.some((l) => l.startsWith('WARN deploy dispatch failed'))).toBe(true);
  });

  describe.each([
    ['an unresolved thread', { threads: [{ isResolved: false }] }, 'threads-unresolved'],
    ['a failing check', { checks: [{ __typename: 'CheckRun', name: 'e2e', conclusion: 'FAILURE' }] }, 'checks-failing'],
    ['checks reported for another commit', { rollupOid: NEWER }, 'checks-unreadable'],
    ['a head behind its base', { behindBy: 3 }, 'behind-base'],
    ['an unreadable base comparison', { compareError: true }, 'base-unreadable'],
    ['a certification for an older head', { comments: [owner(NEWER)] }, 'head-not-certified'],
    ['a certification from someone without write access', { perm: 'read' }, 'head-not-certified'],
    ['a permission lookup that fails', { perm: new Error('x') }, 'head-not-certified'],
    ['a changes-requested review', { reviews: [{ state: 'CHANGES_REQUESTED', author: { login: 'you', __typename: 'User' } }] }, 'not-ready'],
    ['a draft', { isDraft: true }, 'not-ready'],
    ['a WIP label', { labels: [...GOOD, ap.WIP] }, 'wip'],
    ['a Blocked label', { labels: [...GOOD, ap.BLOCKED] }, 'blocked'],
    ['a dirty merge state', { mergeStates: ['DIRTY'] }, 'merge-state-dirty'],
  ])('with %s', (_n, patch, reason) => {
    it(`does not merge: ${reason}`, async () => {
      const r = await scenario(patch as Opts);
      expect(r.names).not.toContain('merge');
      expect(r.names).not.toContain('dispatch');
      expect(r.result.reason).toContain(reason);
    });
  });

  it('removes Finalized when the certification is for an older head', async () => {
    // @req FR:autopilot/cert.stale
    const r = await scenario({ comments: [owner(NEWER)] });
    expect(r.calls).toContainEqual(['removeLabel', ap.FINALIZED]);
  });
  it('leaves Finalized when the comments cannot be read, and still does not merge', async () => {
    // @req FR:autopilot/cert.stale.unknown
    const r = await scenario({ comments: new Error('down') });
    expect(r.names).not.toContain('removeLabel');
    expect(r.names).not.toContain('merge');
  });
  it('removes Ready when the PR stops being ready', async () => {
    const r = await scenario({ labels: [...GOOD, ap.READY], isDraft: true });
    expect(r.calls).toContainEqual(['removeLabel', ap.READY]);
  });
  it('counts a non-author approval as ready without Autopilot, but does not merge without it', async () => {
    const r = await scenario({ labels: [ap.FINALIZED], reviews: [{ state: 'APPROVED', author: { login: 'you', __typename: 'User' } }] });
    expect(r.calls).toContainEqual(['addLabels', ap.READY]);
    expect(r.names).not.toContain('merge');
  });

  // @req FR:autopilot/ready.paused
  it('leaves a paused PR completely alone', async () => {
    const r = await scenario({ labels: [...GOOD, ap.PAUSED] });
    expect(r.calls).toEqual([]);
    expect(r.result).toMatchObject({ action: 'skipped', reason: 'paused' });
  });
  // @req FR:autopilot/safety.forks
  it.each([['workflow_dispatch', undefined], ['schedule', {}], ['issue_comment', { issue: { number: 7 } }], ['workflow_run', { workflow_run: { pull_requests: [{ number: 7 }] } }]])(
    'ignores a fork PR on the %s trigger',
    async (event, payload) => {
      const r = await scenario({ headRepo: 'evil/r', event, payload: payload as Record<string, unknown> | undefined });
      expect(r.calls).toEqual([]);
      expect(r.result.reason).toBe('fork');
    },
  );
  it('does nothing for a closed PR', async () => {
    const r = await scenario({ state: 'CLOSED' });
    expect(r.calls).toEqual([]);
    expect(r.result.reason).toBe('closed');
  });

  // @req FR:autopilot/gates.retry
  describe('retries', () => {
    it('waits out an UNKNOWN merge state and merges once it is CLEAN', async () => {
      const r = await scenario({ mergeStates: ['CLEAN', 'UNKNOWN', 'CLEAN'] });
      expect(r.result).toMatchObject({ action: 'merged', attempts: 2 });
    });
    it('retries a 405 not-mergeable-yet once and merges', async () => {
      const r = await scenario({ mergeError: { message: 'not mergeable', status: 405 }, mergeErrorOnce: true });
      expect(r.names.filter((n) => n === 'merge')).toHaveLength(2);
      expect(r.result).toMatchObject({ action: 'merged', attempts: 2 });
    });
    it('does not retry a 403 and records only the status and class', async () => {
      const r = await scenario({ mergeError: { message: 'secret-token-ghp_x', status: 403 } });
      expect(r.names.filter((n) => n === 'merge')).toHaveLength(1);
      expect(r.result.action).toBe('failed');
      expect(JSON.stringify(r.logs)).not.toContain('secret-token');
    });
    it('does not retry a 409 head mismatch', async () => {
      const r = await scenario({ mergeError: { message: 'Head branch was modified', status: 409 } });
      expect(r.names.filter((n) => n === 'merge')).toHaveLength(1);
    });
    it('gives up after the attempt budget', async () => {
      const r = await scenario({ mergeError: { message: 'try again', status: 502 } });
      expect(r.names.filter((n) => n === 'merge')).toHaveLength(ap.MERGE_RETRY_ATTEMPTS);
      expect(r.result.action).toBe('failed');
    });
  });
  // @req FR:autopilot/gates.closed
  it('reports a PR merged by someone else as merged and dispatches nothing', async () => {
    const r = await scenario({ mergedAtEval: 1 });
    expect(r.result).toMatchObject({ action: 'merged', byUs: false });
    expect(r.names).not.toContain('merge');
    expect(r.names).not.toContain('dispatch');
    const r2 = await scenario({ state: 'MERGED' });
    expect(r2.result.reason).toBe('merged');
    expect(r2.names).toEqual([]);
  });

  // @req FR:autopilot/triggers.labels
  it('ends a label event for an unrelated label before any call', async () => {
    const r = await scenario({ event: 'pull_request_target', payload: { action: 'labeled', label: { name: 'bug' }, pull_request: { number: 7 } } });
    expect(r.calls).toEqual([]);
    expect(r.result).toBeUndefined();
  });
  it('reconciles a label event for a set label', async () => {
    const r = await scenario({ event: 'pull_request_target', payload: { action: 'labeled', label: { name: ap.AUTOPILOT }, pull_request: { number: 7 } } });
    expect(r.result.action).toBe('merged');
  });
  // @req FR:autopilot/triggers.sweep
  it('sweeps every open Autopilot PR when run without a PR', async () => {
    const r = await scenario({ event: 'schedule', payload: {}, sweep: [7] });
    expect(r.result.pr).toBe(7);
  });
  it('rejects a non-numeric dispatch input', async () => {
    const r = await scenario({ payload: { inputs: { pr: '7; rm -rf' } } });
    expect(r.logs).toContain('FAIL pr must be a number');
    expect(r.calls).toEqual([]);
  });

  // @req FR:autopilot/safety.noleak
  it('logs only names, never comment bodies or thread text', async () => {
    const r = await scenario({ comments: [owner(SHA), { body: 'ghp_SECRET body text', user: { login: 'x' } }] });
    expect(JSON.stringify(r.logs)).not.toMatch(/ghp_SECRET|body text/);
  });
});
