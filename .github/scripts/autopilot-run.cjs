/**
 * Autopilot orchestration: fetch a PR's state, apply the label plan, merge when
 * every gate holds. Decisions come from autopilot-core.cjs. `github`, `context`,
 * and `core` are the actions/github-script objects, injected so tests can drive
 * this with mocks.
 *
 * @req FR:autopilot/triggers.events
 */
const ap = require('./autopilot-core.cjs');

const PR_QUERY = `query($owner: String!, $repo: String!, $pr: Int!) {
  repository(owner: $owner, name: $repo) {
    pullRequest(number: $pr) {
      state isDraft mergeStateStatus headRefOid baseRefName
      headRepository { nameWithOwner }
      author { login }
      labels(first: 100) { nodes { name } }
      reviewThreads(first: 100) { pageInfo { hasNextPage endCursor } nodes { isResolved } }
      reviews: latestOpinionatedReviews(first: 100) { nodes { state author { login __typename } } }
      commits(last: 1) { nodes { commit { oid statusCheckRollup { contexts(first: 100) {
        pageInfo { hasNextPage endCursor }
        nodes { __typename ... on CheckRun { name conclusion } ... on StatusContext { context state } }
      } } } } }
    }
  }
}`;
const THREADS_MORE = `query($owner: String!, $repo: String!, $pr: Int!, $after: String!) {
  repository(owner: $owner, name: $repo) { pullRequest(number: $pr) {
    reviewThreads(first: 100, after: $after) { pageInfo { hasNextPage endCursor } nodes { isResolved } }
  } }
}`;
const CONTEXTS_MORE = `query($owner: String!, $repo: String!, $oid: GitObjectID!, $after: String!) {
  repository(owner: $owner, name: $repo) { object(oid: $oid) { ... on Commit { statusCheckRollup { contexts(first: 100, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes { __typename ... on CheckRun { name conclusion } ... on StatusContext { context state } }
  } } } } }
}`;

// Names only: a status code and an error class, never a message that could echo a token or body.
const brief = (err) => `${err?.status ?? ''} ${err?.name ?? 'Error'}`.trim();

async function run({ github, context, core, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const { owner, repo } = context.repo;
  const event = context.eventName;
  const payload = context.payload;
  const defaultBranch = payload.repository?.default_branch ?? 'main';

  // @req FR:autopilot/triggers.labels
  if (['labeled', 'unlabeled'].includes(payload.action) && !ap.TRIGGER_LABELS.includes(payload.label?.name)) {
    core.info('Label outside the Autopilot set; nothing to do.');
    return;
  }

  let prs = [];
  if (event === 'pull_request_target') prs = [payload.pull_request.number];
  else if (event === 'issue_comment') prs = [payload.issue.number];
  else if (event === 'workflow_run') prs = payload.workflow_run.pull_requests.map((p) => p.number);
  else if (payload.inputs?.pr) {
    if (!/^\d+$/.test(payload.inputs.pr)) {
      core.setFailed('pr must be a number');
      return;
    }
    prs = [Number(payload.inputs.pr)];
  } else {
    // @req FR:autopilot/triggers.sweep
    const issues = await github.paginate(github.rest.issues.listForRepo, {
      owner, repo, state: 'open', labels: ap.AUTOPILOT, per_page: 100,
    });
    prs = issues.filter((i) => i.pull_request).map((i) => i.number);
  }
  core.info(`Reconciling ${prs.length} PR(s)`);

  // Drain a paged window; `complete` is false when a page could not be read (the gate then blocks).
  async function drain(first, query, vars, pick) {
    const nodes = [...(first?.nodes ?? [])];
    let info = first?.pageInfo;
    try {
      while (info?.hasNextPage) {
        const more = pick(await github.graphql(query, { ...vars, after: info.endCursor }));
        nodes.push(...(more?.nodes ?? []));
        info = more?.pageInfo;
      }
      return { nodes, complete: true };
    } catch (err) {
      core.warning(`Could not read every page: ${brief(err)}`);
      return { nodes, complete: false };
    }
  }

  // @req FR:autopilot/labels.ensure
  async function ensureLabel(name) {
    try {
      await github.rest.issues.getLabel({ owner, repo, name });
    } catch (err) {
      if (err.status !== 404) throw err;
      const def = ap.AUTOPILOT_LABELS.find((l) => l.name === name);
      await github.rest.issues.createLabel({ owner, repo, ...def });
    }
  }

  // Who can vouch for a head commit: write access or above, read fresh from the permission API.
  // @req FR:autopilot/cert.match
  async function canCertify(login) {
    try {
      const { data } = await github.rest.repos.getCollaboratorPermissionLevel({ owner, repo, username: login });
      return ['admin', 'maintain', 'write'].includes(data.permission);
    } catch (err) {
      core.warning(`Could not read permission: ${brief(err)}`);
      return false;
    }
  }

  // `known` is false when the comments could not be read: Finalized is then left alone, not stripped.
  // @req FR:autopilot/cert.match.missing @req FR:autopilot/cert.stale.unknown
  async function certificationFor(prNumber, headSha) {
    try {
      const comments = await github.paginate(github.rest.issues.listComments, {
        owner, repo, issue_number: prNumber, per_page: 100,
      });
      const trusted = [];
      for (const login of ap.certifiersOf(comments, headSha)) {
        if (await canCertify(login)) trusted.push(login);
      }
      return { certified: ap.isCertifiedOf(comments, headSha, trusted), known: true };
    } catch (err) {
      core.warning(`Could not read comments: ${brief(err)}`);
      return { certified: false, known: false };
    }
  }

  // Everything a gate reads, fetched fresh. Null when the PR is not mergeable ground (closed, fork).
  async function evaluate(prNumber) {
    const { repository } = await github.graphql(PR_QUERY, { owner, repo, pr: prNumber });
    const pr = repository.pullRequest;
    const snap = { state: pr.state, head: pr.headRefOid, base: pr.baseRefName, labels: pr.labels.nodes.map((l) => l.name) };
    if (pr.state !== 'OPEN') return snap;
    // @req FR:autopilot/safety.forks
    if (pr.headRepository?.nameWithOwner !== `${owner}/${repo}`) return { ...snap, fork: true };
    // @req FR:autopilot/ready.paused
    if (snap.labels.includes(ap.PAUSED)) return snap;

    const threads = await drain(pr.reviewThreads, THREADS_MORE, { owner, repo, pr: prNumber },
      (d) => d.repository.pullRequest.reviewThreads);
    // Checks count only when they were reported for this exact head commit.
    const rolled = pr.commits.nodes[0]?.commit;
    const contexts = await drain(rolled?.statusCheckRollup?.contexts, CONTEXTS_MORE, { owner, repo, oid: pr.headRefOid },
      (d) => d.repository.object?.statusCheckRollup?.contexts);
    if (rolled?.oid !== pr.headRefOid) contexts.complete = false;

    const cert = snap.labels.includes(ap.FINALIZED)
      ? await certificationFor(prNumber, pr.headRefOid)
      : { certified: false, known: true };

    // @req FR:autopilot/gates.all.base
    let behindBy = null;
    try {
      const { data } = await github.rest.repos.compareCommitsWithBasehead({
        owner, repo, basehead: `${pr.baseRefName}...${pr.headRefOid}`, per_page: 1,
      });
      behindBy = data.behind_by;
    } catch (err) {
      core.warning(`Could not compare with base: ${brief(err)}`);
    }

    return {
      ...snap,
      mergeState: pr.mergeStateStatus,
      ready: ap.isReadyOf({ isDraft: pr.isDraft, authorLogin: pr.author?.login, reviews: pr.reviews.nodes, labels: snap.labels }),
      certified: cert.certified,
      certKnown: cert.known,
      threadsResolved: ap.allThreadsResolvedOf(threads.nodes, threads.complete),
      checks: ap.checksOf(contexts.nodes, contexts.complete),
      behindBy,
    };
  }

  // Each attempt re-reads every gate, so a thread opened or a push landed during the retry delay still blocks.
  // @req FR:autopilot/gates.retry @req FR:autopilot/gates.pin @req FR:autopilot/gates.closed
  async function mergeWhenClean(prNumber, headSha) {
    for (let attempt = 1; attempt <= ap.MERGE_RETRY_ATTEMPTS; attempt += 1) {
      const snap = await evaluate(prNumber);
      if (snap.state === 'MERGED') return { action: 'merged', byUs: false, attempts: attempt };
      if (snap.state !== 'OPEN' || snap.fork) return { action: 'skipped', reason: 'closed', attempts: attempt };
      if (snap.head !== headSha) return { action: 'skipped', reason: 'head-moved', attempts: attempt };
      if (snap.labels.includes(ap.PAUSED)) return { action: 'skipped', reason: 'paused', attempts: attempt };
      const blockers = ap.mergeBlockers(snap);
      if (blockers.length === 1 && blockers[0] === 'merge-state-unknown' && attempt < ap.MERGE_RETRY_ATTEMPTS) {
        await sleep(ap.MERGE_RETRY_DELAY_MS);
        continue;
      }
      if (blockers.length) return { action: 'skipped', reason: blockers.join(','), attempts: attempt };
      try {
        await github.rest.pulls.merge({ owner, repo, pull_number: prNumber, merge_method: 'squash', sha: headSha });
        return { action: 'merged', byUs: true, attempts: attempt };
      } catch (err) {
        const message = String(err.message ?? err);
        if (ap.isRetryableMergeError(message, err.status) && attempt < ap.MERGE_RETRY_ATTEMPTS) {
          await sleep(ap.MERGE_RETRY_DELAY_MS);
          continue;
        }
        return { action: 'failed', error: `${err.status ?? ''} ${err.name}`.trim(), attempts: attempt };
      }
    }
    return { action: 'skipped', reason: 'retries-exhausted', attempts: ap.MERGE_RETRY_ATTEMPTS };
  }

  async function reconcile(prNumber) {
    const snap = await evaluate(prNumber);
    if (snap.state !== 'OPEN') return { pr: prNumber, action: 'skipped', reason: snap.state.toLowerCase() };
    if (snap.fork) return { pr: prNumber, action: 'skipped', reason: 'fork' };
    if (snap.labels.includes(ap.PAUSED)) return { pr: prNumber, action: 'skipped', reason: 'paused' };

    const plan = ap.labelPlanOf(snap);
    for (const name of plan.toAdd) {
      await ensureLabel(name);
      await github.rest.issues.addLabels({ owner, repo, issue_number: prNumber, labels: [name] });
    }
    for (const name of plan.toRemove) {
      try {
        await github.rest.issues.removeLabel({ owner, repo, issue_number: prNumber, name });
      } catch (err) {
        if (err.status !== 404) throw err;
      }
    }
    const labels = snap.labels.filter((l) => !plan.toRemove.includes(l)).concat(plan.toAdd);

    const result = { pr: prNumber, head: snap.head.slice(0, 7), labelsAdded: plan.toAdd, labelsRemoved: plan.toRemove };
    // The merge state read above predates the label writes; the merge loop re-reads it.
    const blockers = ap.mergeBlockers({ ...snap, labels, mergeState: 'CLEAN' });
    if (blockers.length) return { ...result, action: 'skipped', reason: blockers.join(',') };

    const merge = await mergeWhenClean(prNumber, snap.head);
    // Only the run that merged dispatches: a sweep and an event run can both see the same PR.
    // @req FR:autopilot/deploy.dispatch
    if (merge.action === 'merged' && merge.byUs && snap.base === defaultBranch) {
      try {
        await github.rest.actions.createWorkflowDispatch({ owner, repo, workflow_id: 'deploy.yml', ref: defaultBranch });
        merge.deploy = 'dispatched';
      } catch (err) {
        // @req FR:autopilot/deploy.dispatch.fail
        merge.deploy = `dispatch failed ${err.status ?? ''}`.trim();
        core.warning(`deploy dispatch failed: ${brief(err)}`);
      }
    }
    return { ...result, ...merge };
  }

  // @req FR:autopilot/safety.noleak
  const rows = [];
  let failed = 0;
  for (const n of prs) {
    try {
      const r = await reconcile(n);
      core.info(JSON.stringify(r));
      rows.push([`#${n}`, r.action, r.reason ?? r.error ?? r.deploy ?? '']);
    } catch (err) {
      failed += 1;
      core.warning(`#${n}: ${brief(err)}`);
      rows.push([`#${n}`, 'error', brief(err)]);
    }
  }
  await core.summary
    .addHeading('Autopilot', 3)
    .addTable([[{ data: 'PR', header: true }, { data: 'Result', header: true }, { data: 'Detail', header: true }], ...rows])
    .write();
  if (failed) core.setFailed(`${failed} PR(s) failed to reconcile`);
}

module.exports = { run };
