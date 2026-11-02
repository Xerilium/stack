/**
 * Autopilot PR lifecycle: the decisions, with no network, filesystem, or token.
 * The workflow (.github/workflows/autopilot.yml) fetches state, calls these, and
 * applies the result. CommonJS because actions/github-script can only `require` CJS.
 *
 * @req FR:autopilot/gates.all
 */

const AUTOPILOT = 'Status: 🤖 Autopilot';
const READY = 'Status: ✅ Ready';
const FINALIZED = 'Status: ☑️ Finalized';
const PAUSED = 'Status: ⏸️ Paused';
const WIP = 'Status: 🚧 WIP';
const BLOCKED = 'Status: ⛔ Blocked';

// Inputs (set by people or agents): Autopilot, Finalized, Paused, WIP, Blocked. Ready is set and cleared by the workflow only.
// @req FR:autopilot/labels.owners
// @req FR:autopilot/labels.set
const AUTOPILOT_LABELS = [
  { name: AUTOPILOT, color: '000000', description: 'AI drives this PR to merge, escalating only decisions' },
  { name: READY, color: '006B75', description: 'Approved and ready to merge' },
  { name: FINALIZED, color: '000000', description: 'Checks pass and every thread is resolved, certified for one commit' },
  { name: PAUSED, color: '000000', description: 'On hold; automation skips it' },
  { name: WIP, color: '000000', description: 'Someone is working on this now; automation skips it' },
  { name: BLOCKED, color: '006B75', description: 'Blocked on another change or an outside factor' },
];

// Label events outside this set trigger no reconcile.
// @req FR:autopilot/triggers.labels
const TRIGGER_LABELS = AUTOPILOT_LABELS.map((l) => l.name);

const MERGE_RETRY_ATTEMPTS = 5;
const MERGE_RETRY_DELAY_MS = 4000;

const CERT_MARKER = '<!-- stack:finalized-head-sha -->';
const GOOD_CHECK = ['SUCCESS', 'NEUTRAL', 'SKIPPED'];
const GOOD_STATUS = ['SUCCESS'];
const PENDING_STATUS = ['PENDING', 'EXPECTED'];

/**
 * One state per reviewer from a `latestReviews` window.
 * @req FR:autopilot/ready.derive.latest
 */
function latestReviewStateOf(reviews) {
  const state = {};
  for (const r of reviews ?? []) {
    const login = r.author?.login;
    if (login) state[login] = r.state;
  }
  return state;
}

/**
 * Approved by a person other than the author: a bot's review is not a sign-off.
 * @req FR:autopilot/ready.derive.approved
 */
function humanApprovalOf(reviews, authorLogin) {
  return (reviews ?? []).some(
    (r) =>
      r.state === 'APPROVED' &&
      r.author?.login &&
      r.author.login !== authorLogin &&
      r.author.__typename !== 'Bot',
  );
}

/**
 * Ready is derived, never set by hand.
 * @req FR:autopilot/ready.derive
 */
function isReadyOf({ isDraft, authorLogin, reviews, labels }) {
  if (isDraft) return false;
  if (Object.values(latestReviewStateOf(reviews)).includes('CHANGES_REQUESTED')) return false;
  return labels.includes(AUTOPILOT) || humanApprovalOf(reviews, authorLogin);
}

/** @req FR:autopilot/gates.all.threads */
function unresolvedThreadsOf(threads) {
  return (threads ?? []).filter((t) => !t.isResolved).length;
}

/** `complete` is false when the thread list could not be read to its end. */
function allThreadsResolvedOf(threads, complete = true) {
  return complete && unresolvedThreadsOf(threads) === 0;
}

/**
 * Sort the head commit's check runs and statuses into failing and pending.
 * No contexts at all counts as pending: the checks have not started.
 * @req FR:autopilot/gates.all.checks
 */
function checksOf(contexts, complete = true) {
  const failing = [];
  const pending = [];
  for (const c of contexts ?? []) {
    if (c.__typename === 'CheckRun') {
      if (c.conclusion == null) pending.push(c.name);
      else if (!GOOD_CHECK.includes(c.conclusion)) failing.push(c.name);
    } else if (c.__typename === 'StatusContext') {
      if (PENDING_STATUS.includes(c.state)) pending.push(c.context);
      else if (!GOOD_STATUS.includes(c.state)) failing.push(c.context);
    }
  }
  const none = !contexts || contexts.length === 0;
  return { failing, pending, none, complete, green: complete && !none && failing.length === 0 && pending.length === 0 };
}

/**
 * The comment the certifying agent posts. Line 1 is the marker `parseCertification` reads.
 * @req FR:autopilot/cert.comment
 */
function formatCertification(headSha) {
  return (
    `${CERT_MARKER}\n` +
    `Finalized certification: head SHA \`${headSha}\`.\n\n` +
    'The commit the agent last confirmed nothing was outstanding on. A later push is not covered; ' +
    'the Autopilot merge compares this to the live head. Do not edit or delete it by hand.'
  );
}

function parseCertification(body) {
  if (!body || !body.startsWith(CERT_MARKER)) return null;
  const m = /head SHA `([0-9a-f]{40})`/.exec(body);
  return m ? m[1] : null;
}

/**
 * Logins of everyone who posted a certification for this head. The host checks
 * which of them have write access; anyone can comment on a PR.
 * @req FR:autopilot/cert.match
 */
function certifiersOf(comments, headSha) {
  if (!headSha) return [];
  const logins = (comments ?? [])
    .filter((c) => c.user?.login && parseCertification(c.body) === headSha)
    .map((c) => c.user.login);
  return [...new Set(logins)];
}

/**
 * Is the current head certified by a trusted commenter? Membership, not "pick one",
 * so two racing agents or a reordered list cannot shadow a valid certification.
 * @param {string[]} trusted — logins the host confirmed have write access.
 * @req FR:autopilot/cert.match
 */
function isCertifiedOf(comments, headSha, trusted) {
  return certifiersOf(comments, headSha).some((login) => (trusted ?? []).includes(login));
}

/**
 * Finalized without a certification for this head is stale and comes off.
 * @req FR:autopilot/cert.stale
 */
function staleFinalizedOf(labels, certified) {
  return labels.includes(FINALIZED) && !certified;
}

/**
 * Every gate that blocks the merge, by name. Empty means merge.
 * @req FR:autopilot/gates.all
 */
function mergeBlockers({ labels, ready, certified, threadsResolved, checks, mergeState, behindBy }) {
  const blockers = [];
  if (labels.includes(PAUSED)) blockers.push('paused');
  if (labels.includes(WIP)) blockers.push('wip');
  if (labels.includes(BLOCKED)) blockers.push('blocked');
  if (!labels.includes(AUTOPILOT)) blockers.push('no-autopilot');
  if (!labels.includes(FINALIZED)) blockers.push('not-finalized');
  if (!ready || !labels.includes(READY)) blockers.push('not-ready');
  if (!certified) blockers.push('head-not-certified');
  if (!threadsResolved) blockers.push('threads-unresolved');
  if (!checks.green) {
    blockers.push(
      checks.failing.length
        ? 'checks-failing'
        : checks.pending.length || checks.none
          ? 'checks-pending'
          : 'checks-unreadable',
    );
  }
  // Without branch protection nothing else keeps a PR from landing on a base its checks never saw.
  // @req FR:autopilot/gates.all.base
  if (behindBy !== 0) blockers.push(behindBy == null ? 'base-unreadable' : 'behind-base');
  if (mergeState !== 'CLEAN') blockers.push(`merge-state-${String(mergeState).toLowerCase()}`);
  return blockers;
}

/**
 * Transient: the merge may succeed a moment later. 405 "not mergeable" lands
 * while GitHub recomputes mergeability right after a push or label change.
 * @req FR:autopilot/gates.retry
 */
function isRetryableMergeError(message, status) {
  if (status === 405 || status === 429 || (typeof status === 'number' && status >= 500)) return true;
  return /not mergeable|try again|rate limit|temporarily|timed out/i.test(String(message ?? ''));
}

/**
 * Label writes to reach the target: Ready follows `ready`, stale Finalized comes off.
 * Nothing else is touched. `certKnown` false (comments unreadable) leaves Finalized alone.
 * @req FR:autopilot/ready.derive
 * @req FR:autopilot/cert.stale
 */
function labelPlanOf({ labels, ready, certified, certKnown = true }) {
  const toAdd = [];
  const toRemove = [];
  if (ready && !labels.includes(READY)) toAdd.push(READY);
  if (!ready && labels.includes(READY)) toRemove.push(READY);
  if (certKnown && staleFinalizedOf(labels, certified)) toRemove.push(FINALIZED);
  return { toAdd, toRemove };
}

module.exports = {
  AUTOPILOT,
  READY,
  FINALIZED,
  PAUSED,
  WIP,
  BLOCKED,
  AUTOPILOT_LABELS,
  TRIGGER_LABELS,
  MERGE_RETRY_ATTEMPTS,
  MERGE_RETRY_DELAY_MS,
  CERT_MARKER,
  latestReviewStateOf,
  humanApprovalOf,
  isReadyOf,
  unresolvedThreadsOf,
  allThreadsResolvedOf,
  checksOf,
  formatCertification,
  parseCertification,
  certifiersOf,
  isCertifiedOf,
  staleFinalizedOf,
  mergeBlockers,
  isRetryableMergeError,
  labelPlanOf,
};
