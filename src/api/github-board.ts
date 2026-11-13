/**
 * The owner's open PRs from the GitHub GraphQL api, normalized to `PrFacts`. Read only. The token goes only to api.github.com.
 * @req FR:github-pr-status/board.@function @req FR:github-pr-status/board.search @req FR:github-pr-status/board.detail
 * @req FR:github-pr-status/board.user @req FR:github-pr-status/board.etag @req FR:github-pr-status/board.rate @req FR:github-pr-status/board.scopes
 */
import type { PrCheck, PrComment, PrCommit, PrFacts, PrFile, PrPendingReview, PrThread } from '../core/pr-board';

const API = 'https://api.github.com';
const LOGIN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
const TIMEOUT_MS = 15_000;
const DETAIL_TTL_MS = 5 * 60_000;
const BATCH = 10;
const PARALLEL = 3;
const PER_SEARCH = 50;
/** Thread replies read per thread: enough to see a 🧭 ask and any later human answer. */
const THREAD_TAIL = 10;

/** GitHub said slow down. `until` is when to try again (ms since epoch). */
export class GitHubRateLimit extends Error {
  constructor(public until: number) { super('GitHub rate limit'); this.name = 'GitHubRateLimit'; }
}
export interface BoardRead { user: string; facts: PrFacts[]; /** My repos found from the owner and the orgs the owner admins (no explicit list). */ myRepos?: string[]; /** A search hit its 50-PR limit: some PRs may be missing. */ truncated?: boolean; rate?: { remaining: number; resetAt: string } }
export interface GitHubBoard { user(): Promise<string>; fetch(): Promise<BoardRead> }
export interface GitHubBoardOptions { token: string; fetch?: typeof fetch; user?: string; repos?: string[]; now?: () => number; /** With no repos: my repos are the owner plus admin orgs. @req FR:pr-page/auth.repos */ adminOrgs?: boolean }

type Obj = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const NODE_ID = /^[A-Za-z0-9_=-]{1,100}$/;
const comment = (c: Obj): PrComment => ({ author: login(c.author), body: String(c.body ?? '').slice(0, 2000), ...(c.url ? { url: String(c.url) } : {}), ...(c.createdAt ? { at: String(c.createdAt) } : {}) });
const login = (a: Obj | null | undefined): string => (a?.login ? (a.__typename === 'Bot' && !String(a.login).endsWith('[bot]') ? `${a.login}[bot]` : String(a.login)) : 'ghost');

/** A check run or status to one state. */
function check(n: Obj): PrCheck | null {
  if (n?.__typename === 'CheckRun') {
    const c = String(n.conclusion ?? '').toUpperCase();
    const state: PrCheck['state'] = String(n.status ?? '').toUpperCase() !== 'COMPLETED' ? 'pending'
      : c === 'ACTION_REQUIRED' ? 'action' : c === 'SUCCESS' ? 'pass' : c === 'SKIPPED' || c === 'NEUTRAL' ? 'skip' : 'fail';
    return { name: String(n.name ?? 'check'), state, ...(n.startedAt ? { startedAt: String(n.startedAt) } : {}) };
  }
  if (n?.__typename === 'StatusContext') {
    const s = String(n.state ?? '').toUpperCase();
    return { name: String(n.context ?? 'status'), state: s === 'SUCCESS' ? 'pass' : s === 'PENDING' || s === 'EXPECTED' ? 'pending' : 'fail', ...(n.createdAt ? { startedAt: String(n.createdAt) } : {}) };
  }
  return null;
}

/** One search node to facts (no threads or comments yet). */
export function factsOf(n: Obj): PrFacts | null {
  if (!n?.url || !n.repository?.nameWithOwner || !Number.isInteger(n.number)) return null;
  const commit = n.commits?.nodes?.[0]?.commit ?? {};
  return {
    url: String(n.url), repo: String(n.repository.nameWithOwner), number: n.number, title: String(n.title ?? ''), author: login(n.author), draft: !!n.isDraft,
    createdAt: String(n.createdAt ?? ''), updatedAt: String(n.updatedAt ?? ''), headOid: String(commit.oid ?? ''), ...(commit.committedDate ? { headAt: String(commit.committedDate) } : {}),
    body: String(n.body ?? '').slice(0, 20_000),
    labels: (n.labels?.nodes ?? []).map((l: Obj) => String(l.name)),
    assignees: (n.assignees?.nodes ?? []).map((a: Obj) => String(a.login)),
    requested: (n.reviewRequests?.nodes ?? []).map((r: Obj) => r.requestedReviewer).filter((r: Obj) => r?.login).map(login),
    reviews: (n.latestOpinionatedReviews?.nodes ?? []).map((r: Obj) => ({ author: login(r.author), state: String(r.state) })),
    mergeable: String(n.mergeable ?? 'UNKNOWN'),
    checks: (commit.statusCheckRollup?.contexts?.nodes ?? []).map(check).filter((c: PrCheck | null): c is PrCheck => !!c),
  };
}

const FRAGMENT = `fragment P on PullRequest { url number title isDraft createdAt updatedAt body mergeable
 repository { nameWithOwner } author { login __typename }
 labels(first: 20) { nodes { name } } assignees(first: 10) { nodes { login } }
 reviewRequests(first: 10) { nodes { requestedReviewer { __typename ... on User { login } ... on Bot { login } } } }
 latestOpinionatedReviews(first: 20) { nodes { state author { login __typename } } }
 commits(last: 1) { nodes { commit { oid committedDate statusCheckRollup { state contexts(first: 50) { nodes { __typename
   ... on CheckRun { name status conclusion startedAt } ... on StatusContext { context state createdAt } } } } } } } }`;

/** The three searches. My-repos scope fits GitHub's 256-character query limit. @req FR:github-pr-status/board.search */
export function searches(user: string, repos?: string[]): [string, string, string] {
  const base = 'is:pr is:open archived:false';
  let scope = '';
  for (const r of repos?.length ? repos : [user]) {
    const q = r.includes('/') ? `repo:${r}` : `user:${r}`;
    if (`${base} draft:false -author:${user} ${scope} ${q}`.length > 256) break;
    scope = `${scope} ${q}`.trim();
  }
  return [`${base} involves:${user}`, `${base} review-requested:${user}`, `${base} draft:false -author:${user} ${scope}`];
}

/** The detail query for up to 10 PRs: threads, comments, commits, files, my pending review, and which checks are required. Names are checked before they go in. */
export function detailQuery(prs: { repo: string; number: number }[]): string {
  const parts = prs.map((p, i) => {
    const [owner, name] = p.repo.split('/');
    const n = Math.trunc(p.number);
    return `p${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { pullRequest(number: ${n}) {
  reviewThreads(first: 50) { nodes { id isResolved path root: comments(first: 1) { nodes { databaseId } } comments(last: ${THREAD_TAIL}) { nodes { url body createdAt author { login __typename } } } } }
  comments(last: 10) { nodes { url body createdAt author { login __typename } } }
  recent: commits(last: 10) { nodes { commit { oid messageHeadline url committedDate } } }
  files(first: 100) { nodes { path additions deletions } }
  reviews(states: [PENDING], first: 5) { nodes { url body author { login __typename } comments(first: 20) { nodes { path body } } } }
  commits(last: 1) { nodes { commit { statusCheckRollup { contexts(first: 50) { nodes { __typename
    ... on CheckRun { name isRequired(pullRequestNumber: ${n}) } ... on StatusContext { context isRequired(pullRequestNumber: ${n}) } } } } } } } } }`;
  });
  return `query { rateLimit { remaining resetAt } ${parts.join('\n')} }`;
}

export function createGitHubBoard(o: GitHubBoardOptions): GitHubBoard {
  const get = o.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const now = o.now ?? (() => Date.now());
  const headers = { authorization: `Bearer ${o.token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'stack' };
  let me = o.user && LOGIN.test(o.user) ? o.user : '';
  let etag = '';
  const detail = new Map<string, { key: string; at: number; threads: PrThread[]; comments: PrComment[]; required: Map<string, boolean>; commits?: PrCommit[]; files?: PrFile[]; pending?: PrPendingReview }>();

  /** Rate-limit answers to `GitHubRateLimit`; other failures to `GitHub <status>`, no body. @req FR:github-pr-status/board.rate */
  const limited = (res: Response): never | void => {
    const remaining = res.headers.get('x-ratelimit-remaining');
    const retry = Number(res.headers.get('retry-after'));
    if ((res.status === 403 || res.status === 429) && (remaining === '0' || Number.isFinite(retry) && retry > 0 || res.status === 429)) {
      const reset = Number(res.headers.get('x-ratelimit-reset'));
      throw new GitHubRateLimit(retry > 0 ? now() + retry * 1000 : reset > 0 ? reset * 1000 : now() + 60_000);
    }
  };
  const gql = async (query: string, variables: Obj = {}): Promise<Obj> => {
    const res = await get(`${API}/graphql`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(TIMEOUT_MS) });
    limited(res);
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const body = (await res.json()) as { data?: Obj; errors?: { type?: string }[] };
    if (body.errors?.some((e) => e.type === 'RATE_LIMITED')) throw new GitHubRateLimit(Date.parse(body.data?.rateLimit?.resetAt ?? '') || now() + 60_000);
    // Partial data is not a good board: a failed alias would read as no PRs or no threads.
    if (!body.data || body.errors?.length) throw new Error('GitHub graphql error');
    return body.data;
  };

  /** @req FR:github-pr-status/board.user @req FR:github-pr-status/board.etag */
  const user = async (): Promise<string> => {
    if (o.user && me) return me;
    const res = await get(`${API}/user`, { headers: etag ? { ...headers, 'if-none-match': etag } : headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 304 && me) return me;
    limited(res);
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    const l = String(((await res.json()) as { login?: string }).login ?? '');
    if (!LOGIN.test(l)) throw new Error('GitHub user unknown');
    etag = res.headers.get('etag') ?? '';
    me = l;
    return me;
  };

  /** The orgs the owner admins, read once an hour; a failed read is none and is tried again after 5 minutes. @req FR:pr-page/auth.repos */
  let orgs: { at: number; list: string[] } | null = null;
  const adminOrgs = async (): Promise<string[]> => {
    if (orgs && now() - orgs.at < 3600_000) return orgs.list;
    let list: string[] = [];
    let ok = false;
    try {
      const res = await get(`${API}/user/memberships/orgs?state=active&per_page=100`, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (res.ok) { ok = true; list = ((await res.json()) as { role?: string; organization?: { login?: string } }[]).filter((m) => m?.role === 'admin').map((m) => String(m.organization?.login ?? '')).filter((l) => LOGIN.test(l)); }
    } catch { list = []; }
    orgs = { at: ok ? now() : now() - 55 * 60_000, list };
    return list;
  };

  return {
    user,
    async fetch() {
      const u = await user();
      const mine = !o.repos?.length && o.adminOrgs ? [u, ...(await adminOrgs()).filter((x) => x.toLowerCase() !== u.toLowerCase())] : undefined;
      const [a, b, c] = searches(u, mine ?? o.repos);
      const data = await gql(`query($a: String!, $b: String!, $c: String!) { rateLimit { remaining resetAt }
 a: search(type: ISSUE, query: $a, first: ${PER_SEARCH}) { nodes { ...P } }
 b: search(type: ISSUE, query: $b, first: ${PER_SEARCH}) { nodes { ...P } }
 c: search(type: ISSUE, query: $c, first: ${PER_SEARCH}) { nodes { ...P } } }
${FRAGMENT}`, { a, b, c });
      let rate = data.rateLimit ? { remaining: Number(data.rateLimit.remaining), resetAt: String(data.rateLimit.resetAt) } : undefined;
      const seen = new Map<string, PrFacts>();
      for (const k of ['a', 'b', 'c']) for (const n of data[k]?.nodes ?? []) { const f = factsOf(n); if (f && REPO.test(f.repo) && !seen.has(f.url.toLowerCase())) seen.set(f.url.toLowerCase(), f); }
      const facts = [...seen.values()];
      const truncated = ['a', 'b', 'c'].some((k) => (data[k]?.nodes ?? []).length >= PER_SEARCH);
      // Closed PRs leave the search; drop their detail.
      for (const k of [...detail.keys()]) if (!seen.has(k)) detail.delete(k);
      // Detail: only what changed or aged out. @req FR:github-pr-status/board.detail
      const keyOf = (f: PrFacts) => `${f.updatedAt}|${f.headOid}|${f.checks.map((x) => x.state).join('')}`;
      const stale = facts.filter((f) => { const d = detail.get(f.url.toLowerCase()); return !d || d.key !== keyOf(f) || now() - d.at > DETAIL_TTL_MS; });
      // Up to 3 detail calls at once: the first open of a 60-PR board takes seconds, not half a minute. @req FR:pr-page/nav.load
      const parts: PrFacts[][] = [];
      for (let i = 0; i < stale.length; i += BATCH) parts.push(stale.slice(i, i + BATCH));
      const answers: Obj[] = [];
      for (let i = 0; i < parts.length; i += PARALLEL) answers.push(...(await Promise.all(parts.slice(i, i + PARALLEL).map((p) => gql(detailQuery(p))))));
      parts.forEach((part, k) => {
        const d = answers[k];
        if (d.rateLimit && (!rate || Number(d.rateLimit.remaining) < rate.remaining)) rate = { remaining: Number(d.rateLimit.remaining), resetAt: String(d.rateLimit.resetAt) };
        part.forEach((f, j) => {
          const p = d[`p${j}`]?.pullRequest;
          if (!p) return;
          const threads: PrThread[] = (p.reviewThreads?.nodes ?? []).map((t: Obj) => {
            const tail: PrComment[] = (t.comments?.nodes ?? []).map(comment);
            const last = tail[tail.length - 1];
            return {
              resolved: !!t.isResolved, lastAuthor: last?.author ?? 'ghost', lastBody: last?.body ?? '', ...(last?.url ? { url: last.url } : {}), ...(Number.isInteger(t.root?.nodes?.[0]?.databaseId) ? { id: t.root.nodes[0].databaseId } : {}),
              ...(typeof t.id === 'string' && NODE_ID.test(t.id) ? { nodeId: t.id } : {}), ...(t.path ? { path: String(t.path) } : {}), comments: tail,
            };
          });
          const comments: PrComment[] = (p.comments?.nodes ?? []).map(comment);
          const commits: PrCommit[] | undefined = p.recent ? (p.recent.nodes ?? []).map((n: Obj) => n?.commit).filter((c: Obj) => c?.oid).map((c: Obj) => ({ sha: String(c.oid), title: String(c.messageHeadline ?? '').slice(0, 200), url: String(c.url ?? ''), at: String(c.committedDate ?? '') })) : undefined;
          const files: PrFile[] | undefined = p.files ? (p.files.nodes ?? []).filter((x: Obj) => x?.path).map((x: Obj) => ({ path: String(x.path), additions: Number(x.additions) || 0, deletions: Number(x.deletions) || 0 })) : undefined;
          // Only my own pending review: GitHub shows a pending review to its author only, but check anyway.
          const rv = (p.reviews?.nodes ?? []).find((r: Obj) => r?.url && login(r.author).toLowerCase() === u.toLowerCase());
          const pending: PrPendingReview | undefined = rv ? { url: String(rv.url), body: String(rv.body ?? '').slice(0, 2000), comments: (rv.comments?.nodes ?? []).map((c: Obj) => ({ path: String(c.path ?? ''), body: String(c.body ?? '').slice(0, 2000) })) } : undefined;
          const required = new Map<string, boolean>();
          for (const n of p.commits?.nodes?.[0]?.commit?.statusCheckRollup?.contexts?.nodes ?? []) required.set(String(n.name ?? n.context), !!n.isRequired);
          detail.set(f.url.toLowerCase(), { key: keyOf(f), at: now(), threads, comments, required, ...(commits ? { commits } : {}), ...(files ? { files } : {}), ...(pending ? { pending } : {}) });
        });
      });
      for (const f of facts) {
        const d = detail.get(f.url.toLowerCase());
        if (!d) continue;
        f.threads = d.threads; f.comments = d.comments;
        if (d.commits) f.commits = d.commits;
        if (d.files) f.files = d.files;
        if (d.pending) f.pendingReview = d.pending;
        f.checks = f.checks.map((c) => (d.required.has(c.name) ? { ...c, required: d.required.get(c.name) } : c));
      }
      return { user: u, facts, ...(mine ? { myRepos: mine } : {}), ...(truncated ? { truncated } : {}), ...(rate ? { rate } : {}) };
    },
  };
}
