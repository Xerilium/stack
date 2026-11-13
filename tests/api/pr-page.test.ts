import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PrPriorityStore } from '../../src/core/pr-priority';
import { createApiHandler, ROUTES } from '../../src/api/handler';
import { createAuth, createTokenService, MemoryTokenStore, routeScope } from '../../src/api';
import { MemoryStorage } from '../../src/core/storage';
import { createGitHubBoard, detailQuery, factsOf, GitHubRateLimit, searches, type GitHubBoard } from '../../src/api/github-board';
import { AI_PREFIX, createGitHubWrites, GitHubWriteDenied } from '../../src/api/github-write';
import { clampInterval, createPrBoardService } from '../../src/api/pr-board-service';
import { cliPrQueue, storePrQueue, noQueue, QueueRefused, QueueUnavailable, type PrQueue } from '../../src/api/pr-queue';
import type { PrFacts } from '../../src/core/pr-board';
import { parseConfig } from '../../src/core/config';
import { createPrPage } from '../../src/api/pr-page';

const NOW = Date.parse('2026-11-11T12:00:00Z');
const OWNER = { 'x-ms-client-principal': Buffer.from(JSON.stringify({ userDetails: 'me', identityProvider: 'github', userRoles: ['authenticated'] })).toString('base64') };
const TOKEN = 'ghp_secretsecret';

type Call = { url: string; method: string; body?: string; headers: Headers };
function fakeFetch(answer: (c: Call) => { status?: number; body?: unknown; headers?: Record<string, string> }) {
  const calls: Call[] = [];
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const c = { url: String(input), method: init?.method ?? 'GET', body: init?.body as string | undefined, headers: new Headers(init?.headers) };
    calls.push(c);
    const a = answer(c);
    return new Response(a.body === undefined ? null : JSON.stringify(a.body), { status: a.status ?? 200, headers: a.headers });
  }) as typeof globalThis.fetch;
  return { fetch, calls };
}

const node = (n: number, o: Record<string, unknown> = {}) => ({
  url: `https://github.com/o/r/pull/${n}`, number: n, title: `PR ${n}`, isDraft: false, createdAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-11T00:00:00Z', body: 'Depends on #3', mergeable: 'MERGEABLE',
  repository: { nameWithOwner: 'o/r' }, author: { login: 'me', __typename: 'User' },
  labels: { nodes: [{ name: 'Status: 🤖 Autopilot' }] }, assignees: { nodes: [] },
  reviewRequests: { nodes: [{ requestedReviewer: { __typename: 'Bot', login: 'copilot' } }] },
  latestOpinionatedReviews: { nodes: [{ state: 'CHANGES_REQUESTED', author: { login: 'roland', __typename: 'User' } }] },
  commits: { nodes: [{ commit: { oid: `sha${n}`, committedDate: '2026-11-11T11:00:00Z', statusCheckRollup: { state: 'FAILURE', contexts: { nodes: [
    { __typename: 'CheckRun', name: 'build', status: 'COMPLETED', conclusion: 'FAILURE', startedAt: '2026-11-11T11:00:00Z' },
    { __typename: 'CheckRun', name: 'e2e', status: 'QUEUED', conclusion: null, startedAt: null },
    { __typename: 'StatusContext', context: 'ci/legacy', state: 'SUCCESS', createdAt: '2026-11-11T11:00:00Z' },
    { __typename: 'CheckRun', name: 'gate', status: 'COMPLETED', conclusion: 'ACTION_REQUIRED' },
    { __typename: 'CheckRun', name: 'skip', status: 'COMPLETED', conclusion: 'SKIPPED' },
  ] } } } }] },
  ...o,
});

// @req FR:github-pr-status/board.search @req FR:github-pr-status/board.@function @req FR:github-pr-status/board.scopes
describe('GitHub board read', () => {
  it('factsOf normalizes a search node', () => {
    const f = factsOf(node(1))!;
    expect(f).toMatchObject({ repo: 'o/r', number: 1, author: 'me', headOid: 'sha1', requested: ['copilot[bot]'], reviews: [{ author: 'roland', state: 'CHANGES_REQUESTED' }] });
    expect(f.checks.map((c) => c.state)).toEqual(['fail', 'pending', 'pass', 'action', 'skip']);
    expect(factsOf({})).toBeNull();
  });
  it('searches: involves, review-requested, and my repos within 256 characters', () => {
    const [a, b, c] = searches('me', ['Xerilium', 'o/r']);
    expect(a).toBe('is:pr is:open archived:false involves:me');
    expect(b).toBe('is:pr is:open archived:false review-requested:me');
    expect(c).toBe('is:pr is:open archived:false draft:false -author:me user:Xerilium repo:o/r');
    expect(searches('me')[2]).toContain('user:me');
    expect(searches('me', Array.from({ length: 40 }, (_, i) => `owner${i}/repo${i}`))[2].length).toBeLessThanOrEqual(256);
  });
  it('detailQuery names each PR literally and asks which checks are required', () => {
    const q = detailQuery([{ repo: 'o/r', number: 7 }]);
    expect(q).toContain('p0: repository(owner: "o", name: "r") { pullRequest(number: 7)');
    expect(q).toContain('isRequired(pullRequestNumber: 7)');
  });

  // @req FR:github-pr-status/board.detail @req FR:github-pr-status/board.user @req FR:github-pr-status/board.etag @req FR:github-pr-status/board.rate @req FR:github-pr-status/wire.token.scope
  it('one search call, one detail call, cached detail, ETag on /user, token only to api.github.com', async () => {
    let gql = 0;
    const f = fakeFetch((c) => {
      if (c.url.endsWith('/user')) return c.headers.get('if-none-match') === '"e1"' ? { status: 304 } : { body: { login: 'me' }, headers: { etag: '"e1"' } };
      gql++;
      const q = JSON.parse(c.body!).query as string;
      if (q.includes('search(')) return { body: { data: { rateLimit: { remaining: 4000, resetAt: '2026-11-11T13:00:00Z' }, a: { nodes: [node(1)] }, b: { nodes: [node(1)] }, c: { nodes: [node(2)] } } } };
      return { body: { data: {
        p0: { pullRequest: { reviewThreads: { nodes: [{ isResolved: false, root: { nodes: [{ databaseId: 9 }] }, comments: { nodes: [{ url: 'https://github.com/o/r/pull/1#discussion_r9', body: '🤖 [AI] 🧭 Pick one', author: { login: 'me', __typename: 'User' } }] } }] }, comments: { nodes: [] },
          commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { nodes: [{ __typename: 'CheckRun', name: 'build', isRequired: true }, { __typename: 'CheckRun', name: 'e2e', isRequired: false }] } } } }] } } },
        p1: { pullRequest: { reviewThreads: { nodes: [] }, comments: { nodes: [{ url: 'u', body: 'hi', author: { login: 'x', __typename: 'User' } }] }, commits: { nodes: [] } } },
      } } };
    });
    const g = createGitHubBoard({ token: TOKEN, fetch: f.fetch, now: () => NOW });
    const r = await g.fetch();
    expect(r.facts.map((x) => x.number)).toEqual([1, 2]);
    expect(r.facts[0].threads).toEqual([{ resolved: false, lastAuthor: 'me', lastBody: '🤖 [AI] 🧭 Pick one', url: 'https://github.com/o/r/pull/1#discussion_r9', id: 9, comments: [{ author: 'me', body: '🤖 [AI] 🧭 Pick one', url: 'https://github.com/o/r/pull/1#discussion_r9' }] }]);
    // No id, path, times, commits, files, or pending review in this answer: absent, not empty strings.
    expect(r.facts[0].files).toBeUndefined();
    expect(r.facts[0].pendingReview).toBeUndefined();
    expect(r.facts[0].checks.find((c) => c.name === 'build')?.required).toBe(true);
    expect(r.facts[1].comments).toEqual([{ author: 'x', body: 'hi', url: 'u' }]);
    expect(r.rate).toEqual({ remaining: 4000, resetAt: '2026-11-11T13:00:00Z' });
    expect(gql).toBe(2);
    await g.fetch();
    expect(gql).toBe(3); // detail is cached while nothing changed
    expect(f.calls.every((c) => c.url.startsWith('https://api.github.com/'))).toBe(true);
    expect(f.calls.every((c) => c.headers.get('authorization') === `Bearer ${TOKEN}`)).toBe(true);
    // The login is read each poll with If-None-Match; a 304 is free and keeps it.
    const users = f.calls.filter((c) => c.url.endsWith('/user'));
    expect(users).toHaveLength(2);
    expect(users[1].headers.get('if-none-match')).toBe('"e1"');
    expect(r.user).toBe('me');
  });
  it('a configured user skips /user; a 304 keeps the login', async () => {
    const f = fakeFetch(() => ({ body: { data: { a: { nodes: [] }, b: { nodes: [] }, c: { nodes: [] } } } }));
    await createGitHubBoard({ token: TOKEN, fetch: f.fetch, user: 'me' }).fetch();
    expect(f.calls.some((c) => c.url.endsWith('/user'))).toBe(false);
  });
  it('rate limits throw GitHubRateLimit with the reset time; other errors carry only the status', async () => {
    const hdr = fakeFetch(() => ({ status: 403, body: { message: `bad ${TOKEN}` }, headers: { 'x-ratelimit-remaining': '0', 'x-ratelimit-reset': String(NOW / 1000 + 600) } }));
    await expect(createGitHubBoard({ token: TOKEN, fetch: hdr.fetch, user: 'me' }).fetch()).rejects.toMatchObject({ name: 'GitHubRateLimit', until: NOW + 600_000 });
    const gq = fakeFetch(() => ({ body: { errors: [{ type: 'RATE_LIMITED' }], data: { rateLimit: { resetAt: '2026-11-11T12:30:00Z' } } } }));
    await expect(createGitHubBoard({ token: TOKEN, fetch: gq.fetch, user: 'me' }).fetch()).rejects.toBeInstanceOf(GitHubRateLimit);
    const boom = fakeFetch(() => ({ status: 502, body: { message: TOKEN } }));
    await expect(createGitHubBoard({ token: TOKEN, fetch: boom.fetch, user: 'me' }).fetch()).rejects.toThrow(/^GitHub 502$/);
  });
  // @req FR:github-pr-status/board.detail @req FR:pr-page/detail.data
  it('detail reads thread node ids, paths, times, commits, changed files, and my pending review', async () => {
    const q = detailQuery([{ repo: 'o/r', number: 7 }]);
    for (const part of ['id isResolved path', 'createdAt', 'files(first: 100)', 'reviews(states: [PENDING]', 'recent: commits(last: 10)', 'messageHeadline']) expect(q).toContain(part);
    const f = fakeFetch((c) => {
      const body = JSON.parse(c.body!).query as string;
      if (body.includes('search(')) return { body: { data: { a: { nodes: [node(1)] }, b: { nodes: [] }, c: { nodes: [] } } } };
      return { body: { data: { p0: { pullRequest: {
        reviewThreads: { nodes: [{ id: 'PRRT_kw1', isResolved: false, path: 'src/a.ts', root: { nodes: [{ databaseId: 9 }] }, comments: { nodes: [{ url: 'https://github.com/o/r/pull/1#discussion_r9', body: 'Hold', createdAt: '2026-11-11T09:00:00Z', author: { login: 'me', __typename: 'User' } }] } }] },
        comments: { nodes: [{ url: 'https://github.com/o/r/pull/1#issuecomment-1', body: 'Why not now?', createdAt: '2026-11-10T09:00:00Z', author: { login: 'me', __typename: 'User' } }] },
        commits: { nodes: [] },
        recent: { nodes: [{ commit: { oid: 'abcdef1234', messageHeadline: 'Fix it', url: 'https://github.com/o/r/commit/abcdef1234', committedDate: '2026-11-11T10:00:00Z' } }] },
        files: { nodes: [{ path: '.xe/features/a/spec.md', additions: 3, deletions: 1 }] },
        reviews: { nodes: [{ url: 'https://github.com/o/r/pull/1#pullrequestreview-5', body: 'Draft', author: { login: 'me', __typename: 'User' }, comments: { nodes: [{ path: 'src/a.ts', body: 'Nit' }] } }, { url: 'x', body: 'not mine', author: { login: 'roland', __typename: 'User' }, comments: { nodes: [] } }] },
      } } } } };
    });
    const r = await createGitHubBoard({ token: TOKEN, fetch: f.fetch, user: 'me' }).fetch();
    const p = r.facts[0];
    expect(p.threads![0]).toMatchObject({ nodeId: 'PRRT_kw1', path: 'src/a.ts', comments: [{ author: 'me', body: 'Hold', at: '2026-11-11T09:00:00Z' }] });
    expect(p.comments![0].at).toBe('2026-11-10T09:00:00Z');
    expect(p.commits).toEqual([{ sha: 'abcdef1234', title: 'Fix it', url: 'https://github.com/o/r/commit/abcdef1234', at: '2026-11-11T10:00:00Z' }]);
    expect(p.files).toEqual([{ path: '.xe/features/a/spec.md', additions: 3, deletions: 1 }]);
    expect(p.pendingReview).toEqual({ url: 'https://github.com/o/r/pull/1#pullrequestreview-5', body: 'Draft', comments: [{ path: 'src/a.ts', body: 'Nit' }] });
  });
  it('partial data with errors is a failed poll, not an empty board', async () => {
    const part = fakeFetch(() => ({ body: { errors: [{ type: 'NOT_FOUND', message: 'x' }], data: { a: { nodes: [] }, b: null, c: { nodes: [] } } } }));
    await expect(createGitHubBoard({ token: TOKEN, fetch: part.fetch, user: 'me' }).fetch()).rejects.toThrow('GitHub graphql error');
  });
});

// @req FR:github-pr-status/write.@function @req FR:github-pr-status/write.label @req FR:github-pr-status/write.comment @req FR:github-pr-status/write.never @req FR:github-pr-status/write.errors @req FR:github-pr-status/write.scopes
describe('GitHub writes', () => {
  const ok = () => fakeFetch(() => ({ status: 200, body: {} }));
  const pr = { repo: 'o/r', number: 4 };
  it('only the Autopilot label, only AI-prefixed comments, no other method', async () => {
    const f = ok();
    const w = createGitHubWrites({ token: TOKEN, fetch: f.fetch });
    await w.addLabel(pr, 'Status: 🤖 Autopilot');
    await w.removeLabel(pr, 'Status: 🤖 Autopilot');
    await w.comment(pr, `${AI_PREFIX}Yes`);
    await w.reply(pr, 77, `${AI_PREFIX}Yes`);
    expect(f.calls.map((c) => `${c.method} ${c.url.replace('https://api.github.com', '')}`)).toEqual([
      'GET /repos/o/r/labels?per_page=100', 'POST /repos/o/r/issues/4/labels', `DELETE /repos/o/r/issues/4/labels/${encodeURIComponent('Status: 🤖 Autopilot')}`,
      'POST /repos/o/r/issues/4/comments', 'GET /repos/o/r/pulls/comments/77', 'POST /repos/o/r/pulls/4/comments/77/replies',
    ]);
    expect(JSON.parse(f.calls[1].body!)).toEqual({ labels: ['Status: 🤖 Autopilot'] });
    await expect(w.addLabel(pr, 'Status: ✅ Ready')).rejects.toBeInstanceOf(GitHubWriteDenied);
    await expect(w.comment(pr, 'Yes')).rejects.toBeInstanceOf(GitHubWriteDenied);
    await expect(w.comment(pr, `${AI_PREFIX}${'x'.repeat(4000)}`)).rejects.toBeInstanceOf(GitHubWriteDenied);
    await expect(w.addLabel({ repo: 'bad', number: 1 }, 'Status: 🤖 Autopilot')).rejects.toBeInstanceOf(GitHubWriteDenied);
    expect(Object.keys(w).sort()).toEqual(['addLabel', 'comment', 'removeLabel', 'reply', 'resolveThread']);
    expect(f.calls).toHaveLength(6);
  });
  // @req FR:github-pr-status/write.resolve
  it('resolveThread runs the resolve or unresolve mutation with a checked node id and repo', async () => {
    const f = fakeFetch(() => ({ status: 200, body: { data: {} } }));
    const w = createGitHubWrites({ token: TOKEN, fetch: f.fetch, repos: ['o'] });
    await w.resolveThread(pr, 'PRRT_kw1', true);
    await w.resolveThread(pr, 'PRRT_kw1', false);
    expect(f.calls.map((c) => `${c.method} ${c.url}`)).toEqual(['POST https://api.github.com/graphql', 'POST https://api.github.com/graphql']);
    expect(JSON.parse(f.calls[0].body!)).toEqual({ query: 'mutation($id: ID!) { resolveReviewThread(input: {threadId: $id}) { thread { isResolved } } }', variables: { id: 'PRRT_kw1' } });
    expect(JSON.parse(f.calls[1].body!).query).toContain('unresolveReviewThread');
    await expect(w.resolveThread(pr, 'bad id!', true)).rejects.toBeInstanceOf(GitHubWriteDenied);
    await expect(w.resolveThread({ repo: 'x/y', number: 1 }, 'PRRT_kw1', true)).rejects.toBeInstanceOf(GitHubWriteDenied);
    const errs = createGitHubWrites({ token: TOKEN, fetch: fakeFetch(() => ({ status: 200, body: { errors: [{ message: TOKEN }] } })).fetch });
    await expect(errs.resolveThread(pr, 'PRRT_kw1', true)).rejects.toThrow(/^GitHub graphql error$/);
    expect(f.calls).toHaveLength(2);
  });
  it('add uses the repo spelling of the label', async () => {
    const f = fakeFetch((c) => (c.url.endsWith('/labels?per_page=100') ? { body: [{ name: 'Status: 🤖️ Autopilot' }] } : { status: 200, body: {} }));
    const w = createGitHubWrites({ token: TOKEN, fetch: f.fetch });
    await w.addLabel(pr, 'Status: 🤖 Autopilot');
    await w.addLabel(pr, 'Status: 🤖 Autopilot');
    expect(f.calls.filter((c) => c.method === 'GET')).toHaveLength(1);
    expect(JSON.parse(f.calls[1].body!)).toEqual({ labels: ['Status: 🤖️ Autopilot'] });
  });
  it('repos allow-list, 404 on remove is done, failures carry only the status', async () => {
    const w = createGitHubWrites({ token: TOKEN, fetch: ok().fetch, repos: ['x'] });
    await expect(w.addLabel(pr, 'Status: 🤖 Autopilot')).rejects.toThrow('STACK_GITHUB_REPOS');
    // A link to a later reply still posts on the thread's root comment.
    const deep = fakeFetch((c) => ({ body: c.method === 'GET' ? { id: 78, in_reply_to_id: 70 } : {} }));
    await createGitHubWrites({ token: TOKEN, fetch: deep.fetch }).reply(pr, 78, `${AI_PREFIX}Yes`);
    expect(deep.calls.map((c) => `${c.method} ${c.url.replace('https://api.github.com', '')}`)).toEqual(['GET /repos/o/r/pulls/comments/78', 'POST /repos/o/r/pulls/4/comments/70/replies']);
    const gone = createGitHubWrites({ token: TOKEN, fetch: fakeFetch(() => ({ status: 404 })).fetch });
    await expect(gone.removeLabel(pr, 'Status: 🤖 Autopilot')).resolves.toBeUndefined();
    const bad = createGitHubWrites({ token: TOKEN, fetch: fakeFetch(() => ({ status: 403, body: { message: TOKEN } })).fetch });
    await expect(bad.addLabel(pr, 'Status: 🤖 Autopilot')).rejects.toThrow(/^GitHub 403$/);
  });
});

const facts = (n: number, o: Partial<PrFacts> = {}): PrFacts => ({
  url: `https://github.com/o/r/pull/${n}`, repo: 'o/r', number: n, title: `PR ${n}`, author: 'me', draft: false, createdAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-11T00:00:00Z',
  headOid: 'abc1234', body: '', labels: ['Status: 🤖 Autopilot'], assignees: [], requested: [], reviews: [], mergeable: 'MERGEABLE', checks: [], threads: [], comments: [], ...o,
});
function fakeSource(list: () => PrFacts[] | Error): GitHubBoard & { n: number } {
  const s = { n: 0, user: async () => 'me', fetch: async () => { s.n++; const r = list(); if (r instanceof Error) throw r; return { user: 'me', facts: r }; } };
  return s;
}
function clock() {
  let t = NOW;
  const due: { at: number; fn: () => void }[] = [];
  return {
    now: () => t,
    timers: { set: (fn: () => void, ms: number) => { const h = { at: t + ms, fn }; due.push(h); return h; }, clear: (h: unknown) => { const i = due.indexOf(h as never); if (i >= 0) due.splice(i, 1); } },
    async advance(ms: number) { t += ms; for (const h of due.filter((d) => d.at <= t)) { due.splice(due.indexOf(h), 1); h.fn(); } await new Promise((r) => setImmediate(r)); await new Promise((r) => setImmediate(r)); },
    pending: () => due.length,
  };
}

// @req FR:pr-page/live.poll @req FR:pr-page/live.event @req FR:pr-page/live.backoff @req FR:pr-page/data.board @req FR:pr-page/$board
describe('board service', () => {
  it('polls while a lease is held, tells pages on change, stops with no lease', async () => {
    let list = [facts(1)];
    const src = fakeSource(() => list);
    const c = clock();
    let changes = 0;
    const svc = createPrBoardService({ source: src, now: c.now, timers: c.timers, onChange: () => changes++, inventory: () => ({ sessions: [{ state: 'running', prs: [{ url: 'https://github.com/o/r/pull/1', state: 'OPEN' }] }] }) });
    const b = await svc.get();
    expect(b).toMatchObject({ at: new Date(NOW).toISOString(), user: 'me', agents: { count: 1, source: 'sessions' }, counts: { processing: 1 }, queue: false });
    expect(b.rows[0].agent).toBe(true);
    await c.advance(45_000);
    expect(src.n).toBe(2);
    expect(changes).toBe(0);
    list = [facts(1), facts(2, { labels: ['Status: 🤖 Autopilot', 'Needs attention'] })];
    await c.advance(45_000);
    expect(changes).toBe(1);
    expect((await svc.get()).counts.processing).toBe(2);
    await c.advance(45_000 * 5); // lease (3 min) runs out
    const n = src.n;
    await c.advance(45_000 * 3);
    expect(src.n).toBe(n);
    expect(c.pending()).toBe(0);
    svc.stop();
  });
  it('rate limit pauses until reset and keeps the last board; errors back off 2x', async () => {
    let next: PrFacts[] | Error = [facts(1)];
    const src = fakeSource(() => next);
    const c = clock();
    const svc = createPrBoardService({ source: src, now: c.now, timers: c.timers, leaseMs: 3_600_000 });
    await svc.get();
    next = new GitHubRateLimit(NOW + 600_000);
    await c.advance(45_000);
    const b = await svc.get();
    expect(b.rows).toHaveLength(1);
    expect(b.rate?.until).toBe(new Date(NOW + 600_000).toISOString());
    expect(b.error).toBe('GitHub rate limit');
    const n = src.n;
    await c.advance(300_000);
    expect(src.n).toBe(n); // still paused
    next = new Error('boom');
    await c.advance(300_000);
    expect((await svc.get()).error).toBe('GitHub unavailable');
    svc.stop();
  });
  it('a timer set before a refresh hit the rate limit waits out the backoff', async () => {
    let next: PrFacts[] | Error = [facts(1)];
    const src = fakeSource(() => next);
    const c = clock();
    const svc = createPrBoardService({ source: src, now: c.now, timers: c.timers, leaseMs: 3_600_000 });
    await svc.get(); // the timer is set for +45 s
    next = new GitHubRateLimit(NOW + 600_000);
    await svc.refresh();
    const n = src.n;
    await c.advance(45_000);
    expect(src.n).toBe(n); // the old timer did not poll during the pause
    next = [facts(1)];
    await c.advance(600_000);
    expect(src.n).toBe(n + 1);
    svc.stop();
  });
  it('a board older than two intervals (lapsed lease) polls before answering', async () => {
    const src = fakeSource(() => [facts(1)]);
    const c = clock();
    const svc = createPrBoardService({ source: src, now: c.now, timers: c.timers });
    await svc.get();
    await c.advance(45_000 * 20); // the lease lapsed long ago; the timer stopped
    const n = src.n;
    const b = await svc.get();
    expect(src.n).toBe(n + 1);
    expect(b.at).toBe(new Date(c.now()).toISOString());
    svc.stop();
  });
  it('queue is true only when the queue commands exist', async () => {
    const on = createPrBoardService({ source: fakeSource(() => []), now: () => NOW, timers: clock().timers, queue: async () => true });
    const off = createPrBoardService({ source: fakeSource(() => []), now: () => NOW, timers: clock().timers, queue: async () => false });
    expect((await on.get()).queue).toBe(true);
    expect((await off.get()).queue).toBe(false);
  });
  it('WIP label stands in for agents without an inventory; interval clamps to 30-60 s', async () => {
    const svc = createPrBoardService({ source: fakeSource(() => [facts(1, { labels: ['Status: 🚧 WIP', 'Status: 🤖 Autopilot'], mergeable: 'CONFLICTING' })]), now: () => NOW, timers: clock().timers });
    const b = await svc.get();
    expect(b.agents).toEqual({ count: 1, source: 'wip-label' });
    expect(b.rows[0]).toMatchObject({ agent: true, state: { blocker: 'Agent on it: Merge conflict', stalled: false } });
    expect([clampInterval(), clampInterval(5_000), clampInterval(90_000)]).toEqual([45_000, 30_000, 60_000]);
  });
});

// @req FR:pr-page/api.queue-client
describe('queue client', () => {
  it('maps each op to one stack pr-pri call with argv values', async () => {
    const seen: string[][] = [];
    const q = cliPrQueue(async (a) => { seen.push(a); return ''; });
    await q.move('o/r#1', 'top'); await q.move('o/r#1', 3); await q.add('o/r#1'); await q.pin('o/r#1'); await q.unpin('o/r#1'); await q.remove('o/r#1'); await q.undo();
    await q.ack('o/r#1', 'https://github.com/o/r/pull/1#discussion_r9', 'Yes; rm -rf');
    await q.accept('pp-0000000a'); await q.edit('pp-0000000a', { reason: 'why', rank: 3, note: 'n' }); await q.reject('pp-0000000a', 'no');
    expect(seen).toEqual([
      ['pr-pri', 'move', 'o/r#1', '--to=top'], ['pr-pri', 'move', 'o/r#1', '--to=3'], ['pr-pri', 'add', 'o/r#1'], ['pr-pri', 'pin', 'o/r#1'], ['pr-pri', 'unpin', 'o/r#1'], ['pr-pri', 'remove', 'o/r#1'], ['pr-pri', 'undo'],
      ['pr-pri', 'ack', 'o/r#1', '--thread=https://github.com/o/r/pull/1#discussion_r9', '--note=Yes; rm -rf'],
      ['pr-pri', 'accept', 'pp-0000000a'], ['pr-pri', 'edit', 'pp-0000000a', '--reason=why', '--rank=3', '--note=n'], ['pr-pri', 'reject', 'pp-0000000a', '--reason=no'],
    ]);
  });
  it('an answer that starts with -- stays one value; available() probes pr-pri list once', async () => {
    const seen: string[][] = [];
    const q = cliPrQueue(async (a) => { seen.push(a); if (a[1] === 'list') throw new Error('Unknown command'); return ''; });
    await q.ack('o/r#1', 'https://github.com/o/r/pull/1', '--force');
    expect(seen[0]).toContain('--note=--force');
    expect(await q.available!()).toBe(false);
    expect(await q.available!()).toBe(false);
    expect(seen.filter((a) => a[1] === 'list')).toHaveLength(1);
  });
  it('storePrQueue runs the same ops on the host store in-process; refusals carry the reason', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'prq-'));
    const store = new PrPriorityStore(dir);
    const q = storePrQueue(store);
    await q.add('o/r#1'); await q.add('o/r#2');
    await q.move('o/r#1', 'top'); await q.pin('o/r#2');
    expect(store.read().items.map((i) => [i.number, i.pinned])).toEqual([[2, true], [1, false]]);
    await q.ack('o/r#1', 'https://github.com/o/r/pull/1#discussion_r1', 'Keep it');
    expect(store.state().acks['o/r#1']?.[0]?.note).toBe('Keep it');
    await expect(q.accept('pp-0000000f')).rejects.toBeInstanceOf(QueueRefused);
    expect(await q.available!()).toBe(true);
  });
  it('noQueue: every change is not installed; never available', async () => {
    await expect(noQueue().add('o/r#1')).rejects.toBeInstanceOf(QueueUnavailable);
    expect(await noQueue().available!()).toBe(false);
  });
  it('a missing command is QueueUnavailable; a refusal carries the reason', async () => {
    await expect(cliPrQueue(async () => { throw Object.assign(new Error('x'), { stderr: 'error: Unknown command: pr-pri' }); }).add('o/r#1')).rejects.toBeInstanceOf(QueueUnavailable);
    await expect(cliPrQueue(async () => { throw Object.assign(new Error('x'), { stderr: 'error: stale rev\n' }); }).add('o/r#1')).rejects.toEqual(new QueueRefused('stale rev'));
  });
});

// @req FR:pr-page/api.get @req FR:pr-page/api.queue @req FR:pr-page/api.label @req FR:pr-page/api.ack @req FR:pr-page/api.rec @req FR:pr-page/act.owner @req FR:pr-page/api.repos @req FR:pr-page/act.never
describe('PR routes', () => {
  function mk(o: { board?: boolean; queue?: PrQueue | null; ranks?: Record<string, number>; ghStatus?: number; labels?: string[]; threads?: PrFacts['threads'] } = {}) {
    const ghCalls: string[] = [];
    const qCalls: string[] = [];
    const push = (s: string) => async () => { qCalls.push(s); };
    const prQueue: PrQueue = { move: async (r, to) => { qCalls.push(`move ${r} ${to}`); }, add: async (r) => { qCalls.push(`add ${r}`); }, pin: async (r) => { qCalls.push(`pin ${r}`); }, unpin: async (r) => { qCalls.push(`unpin ${r}`); }, remove: async (r) => { qCalls.push(`remove ${r}`); }, undo: push('undo'), ack: async (r, t, n) => { qCalls.push(`ack ${r} ${t} ${n}`); }, accept: async (id) => { qCalls.push(`accept ${id}`); }, edit: async (id, d) => { qCalls.push(`edit ${id} ${d.reason}`); }, reject: async (id, why) => { qCalls.push(`reject ${id} ${why}`); } };
    const src = fakeSource(() => [facts(1, { ...(o.labels ? { labels: o.labels } : {}), ...(o.threads ? { threads: o.threads } : {}) }), facts(2)]);
    const prBoard = createPrBoardService({ source: src, now: () => NOW, timers: clock().timers, queue: async () => true, files: () => ({ queue: { items: Object.entries(o.ranks ?? {}).map(([u, rank]) => ({ url: u, rank })) } }) });
    const prWrites = createGitHubWrites({ token: TOKEN, fetch: fakeFetch((c) => { ghCalls.push(`${c.method} ${c.url}`); return { status: o.ghStatus ?? 200, body: {} }; }).fetch, repos: ['o'] });
    const deps = { storage: new MemoryStorage(), ...(o.board === false ? {} : { prBoard, prWrites, ...(o.queue === null ? {} : { prQueue: o.queue ?? prQueue }) }) };
    const tokens = createTokenService({ store: new MemoryTokenStore(), now: () => new Date(NOW) });
    const auth = createAuth({ owners: [], tokens });
    const token = auth.wrap(createApiHandler({ ...deps, authorize: auth.authorize }));
    const owner = createApiHandler({ ...deps, authorize: () => true });
    const call = async (who: string, method: string, path: string, body?: unknown) => {
      const headers: Record<string, string> = { 'content-type': 'application/json', ...(who === 'owner' ? OWNER : { authorization: `Bearer ${who}` }) };
      const res = await (who === 'owner' ? owner : token)(new Request(`https://x.test/api${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }));
      const t = await res.text();
      return { status: res.status, json: t ? JSON.parse(t) : undefined, text: t };
    };
    return { call, tokens, ghCalls, qCalls, src };
  }
  it('routes are registered with scopes and documented', () => {
    for (const n of ['prs.get']) expect(routeScope(n)).toBe('tasks:read');
    for (const n of ['prs.queue', 'prs.label', 'prs.ack', 'prs.rec', 'prs.resolve']) expect(routeScope(n)).toBe('tasks:write');
    expect(ROUTES.filter((r) => r.name.startsWith('prs.')).map((r) => `${r.method} ${r.doc}`)).toEqual(['GET /prs', 'POST /prs/queue', 'POST /prs/label', 'POST /prs/ack', 'POST /prs/recs/{id}', 'POST /prs/resolve', 'GET /prs/sign-in', 'POST /prs/sign-in']);
    const y = readFileSync(join(__dirname, '../../docs/api/openapi.yaml'), 'utf8');
    expect(y).toContain('/prs:');
    expect(y).toContain('/prs/recs/{id}:');
    expect(y).toContain('/prs/resolve:');
    // Never a merge, close, draft, or review route.
    expect(ROUTES.some((r) => /merge|close|draft|approve|review/i.test(r.name) && r.name.startsWith('prs.'))).toBe(false);
  });
  it('GET /prs: owner gets the board without the token; {off: true} with no board; 403 for a token', async () => {
    const m = mk();
    const r = await m.call('owner', 'GET', '/prs');
    expect(r.status).toBe(200);
    expect(r.json.rows.map((x: { number: number }) => x.number)).toEqual([1, 2]);
    expect(r.text).not.toContain(TOKEN);
    expect(await mk({ board: false }).call('owner', 'GET', '/prs')).toMatchObject({ status: 200, json: { off: true } });
    const t = (await m.tokens.create({ name: 'cos', scopes: ['tasks:read', 'tasks:write'] as never })).token;
    for (const [method, path, body] of [['GET', '/prs'], ['POST', '/prs/queue', { repo: 'o/r', number: 1, op: 'pin' }], ['POST', '/prs/label', { repo: 'o/r', number: 1, op: 'add' }], ['POST', '/prs/ack', { repo: 'o/r', number: 1, thread: 'https://github.com/o/r/pull/1', note: 'a' }], ['POST', '/prs/recs/pp-0000000a', { decision: 'accept' }]] as const) expect((await m.call(t, method, path, body)).status).toBe(403);
  });
  it('POST /prs/queue: the stack pr-pri ops through the queue client', async () => {
    const m = mk({ ranks: { 'https://github.com/o/r/pull/1': 3 } });
    for (const op of ['add', 'top', 'up', 'down', 'pin', 'unpin', 'remove', 'undo']) expect((await m.call('owner', 'POST', '/prs/queue', { repo: 'o/r', number: 1, op })).status).toBe(200);
    expect((await m.call('owner', 'POST', '/prs/queue', { repo: 'o/r', number: 1, op: 'move', rank: 2 })).json).toEqual({ rank: 3, was: 3, pinned: false });
    expect(m.qCalls).toEqual(['add o/r#1', 'move o/r#1 top', 'move o/r#1 up', 'move o/r#1 down', 'pin o/r#1', 'unpin o/r#1', 'remove o/r#1', 'undo', 'move o/r#1 2']);
    expect((await m.call('owner', 'POST', '/prs/queue', { repo: 'o/r', number: 2, op: 'merge' })).status).toBe(422);
    const none = mk({ queue: null });
    expect(await none.call('owner', 'POST', '/prs/queue', { repo: 'o/r', number: 1, op: 'add' })).toMatchObject({ status: 409, json: { error: { message: 'PR priority queue is not installed' } } });
  });
  it('POST /prs/label: Autopilot only, repo allow-list', async () => {
    const m = mk();
    expect((await m.call('owner', 'POST', '/prs/label', { repo: 'o/r', number: 1, op: 'add' })).json).toEqual({ ok: true, label: 'Status: 🤖 Autopilot', op: 'add' });
    expect((await m.call('owner', 'POST', '/prs/label', { repo: 'x/y', number: 1, op: 'add' })).status).toBe(403);
    expect((await m.call('owner', 'POST', '/prs/label', { repo: 'o/r', number: 1, op: 'add', label: 'Status: ✅ Ready' })).status).toBe(422);
    expect(m.ghCalls).toEqual(['GET https://api.github.com/repos/o/r/labels?per_page=100', 'POST https://api.github.com/repos/o/r/issues/1/labels']);
  });
  it('POST /prs/ack records the ack; posting is opt-in and must carry the AI prefix', async () => {
    const m = mk();
    expect((await m.call('owner', 'POST', '/prs/ack', { repo: 'o/r', number: 1, thread: 'https://github.com/o/r/pull/1#discussion_r9', note: 'Use A' })).json).toEqual({ ok: true, posted: false, recorded: true });
    expect(m.ghCalls).toEqual([]);
    expect((await m.call('owner', 'POST', '/prs/ack', { repo: 'o/r', number: 1, thread: 'https://github.com/o/r/pull/1#discussion_r9', note: 'Use A', post: true, text: 'Use A' })).status).toBe(422);
    expect((await m.call('owner', 'POST', '/prs/ack', { repo: 'o/r', number: 1, thread: 'https://github.com/o/r/pull/1#discussion_r9', note: 'Use A', post: true, text: '🤖 [AI] Use A', replyTo: 9 })).json).toEqual({ ok: true, posted: true, recorded: true });
    expect(m.ghCalls).toEqual(['GET https://api.github.com/repos/o/r/pulls/comments/9', 'POST https://api.github.com/repos/o/r/pulls/1/comments/9/replies']);
    expect(m.qCalls).toEqual(['ack o/r#1 https://github.com/o/r/pull/1#discussion_r9 Use A', 'ack o/r#1 https://github.com/o/r/pull/1#discussion_r9 Use A']);
    expect((await m.call('owner', 'POST', '/prs/ack', { repo: 'o/r', number: 1, thread: 'not-a-url', note: 'A' })).status).toBe(422);
  });
  it('a failed post records nothing; a PR not on the board cannot be written', async () => {
    const m = mk({ ghStatus: 502 });
    expect(await m.call('owner', 'POST', '/prs/ack', { repo: 'o/r', number: 1, thread: 'https://github.com/o/r/pull/1#discussion_r9', note: 'A', post: true, text: '🤖 [AI] A' })).toMatchObject({ status: 409, json: { error: { message: 'GitHub 502' } } });
    expect(m.qCalls).toEqual([]);
    const ok = mk();
    expect((await ok.call('owner', 'POST', '/prs/label', { repo: 'o/r', number: 99, op: 'add' })).status).toBe(403);
    expect((await ok.call('owner', 'POST', '/prs/ack', { repo: 'o/r', number: 99, thread: 'https://github.com/o/r/pull/99', note: 'A', post: true, text: '🤖 [AI] A' })).status).toBe(403);
    expect(ok.ghCalls).toEqual([]);
    // Posted, then the queue is missing: 200 with recorded false, so the page never posts twice.
    const noQ = mk({ queue: null });
    expect((await noQ.call('owner', 'POST', '/prs/ack', { repo: 'o/r', number: 1, thread: 'https://github.com/o/r/pull/1#discussion_r9', note: 'A', post: true, text: '🤖 [AI] A' })).json).toEqual({ ok: true, posted: true, recorded: false, message: 'PR priority queue is not installed' });
    expect((await noQ.call('owner', 'POST', '/prs/ack', { repo: 'o/r', number: 1, thread: 'https://github.com/o/r/pull/1#discussion_r9', note: 'A' })).status).toBe(409);
    // Remove uses the label as the PR spells it.
    const variant = mk({ labels: ['status: 🤖 autopilot'] });
    expect((await variant.call('owner', 'POST', '/prs/label', { repo: 'o/r', number: 1, op: 'remove' })).status).toBe(200);
    expect(variant.ghCalls).toEqual([`DELETE https://api.github.com/repos/o/r/issues/1/labels/${encodeURIComponent('status: 🤖 autopilot')}`]);
  });
  // @req FR:pr-page/api.get @req FR:pr-page/live.poll
  it('GET /prs?refresh=1 polls GitHub first; other queries are refused', async () => {
    const m = mk();
    await m.call('owner', 'GET', '/prs');
    const before = m.src.n;
    expect((await m.call('owner', 'GET', '/prs')).status).toBe(200);
    expect(m.src.n).toBe(before);
    expect((await m.call('owner', 'GET', '/prs?refresh=1')).status).toBe(200);
    expect(m.src.n).toBe(before + 1);
    expect((await m.call('owner', 'GET', '/prs?x=1')).status).toBe(422);
  });
  // @req FR:pr-page/data.board @req FR:pr-page/summary.@function
  it('GET /prs carries nextAction, specLines, pinned, and the summary', async () => {
    const r = await mk().call('owner', 'GET', '/prs');
    expect(r.json.summary).toEqual({ live: [], signoff: [], autopilot: [], missing: [] });
    expect(r.json.rows[0]).toMatchObject({ nextAction: null, specLines: null, pinned: false, mine: true, detail: {} });
  });
  // @req FR:pr-page/api.queue @req FR:pr-page/pin.toggle
  it('POST /prs/queue pin adds a PR that is not queued, then pins it', async () => {
    const m = mk({ ranks: { 'https://github.com/o/r/pull/1': 1 } });
    await m.call('owner', 'POST', '/prs/queue', { repo: 'o/r', number: 2, op: 'pin' });
    await m.call('owner', 'POST', '/prs/queue', { repo: 'o/r', number: 1, op: 'pin' });
    expect(m.qCalls).toEqual(['add o/r#2', 'pin o/r#2', 'pin o/r#1']);
  });
  // @req FR:pr-page/api.resolve @req FR:pr-page/detail.signoff
  it('POST /prs/resolve resolves or reopens a sign-off thread on the row only', async () => {
    const hold = { resolved: false, lastAuthor: 'me', lastBody: 'Hold', url: 'https://github.com/o/r/pull/1#discussion_r9', id: 9, nodeId: 'PRRT_kw1', comments: [{ author: 'me', body: 'Hold', url: 'https://github.com/o/r/pull/1#discussion_r9' }] };
    const m = mk({ threads: [hold] });
    expect((await m.call('owner', 'POST', '/prs/resolve', { repo: 'o/r', number: 1, thread: 'PRRT_kw1', op: 'resolve' })).json).toEqual({ ok: true, op: 'resolve' });
    expect((await m.call('owner', 'POST', '/prs/resolve', { repo: 'o/r', number: 1, thread: 'PRRT_kw1', op: 'unresolve' })).status).toBe(200);
    expect(m.ghCalls).toEqual(['POST https://api.github.com/graphql', 'POST https://api.github.com/graphql']);
    expect((await m.call('owner', 'POST', '/prs/resolve', { repo: 'o/r', number: 1, thread: 'PRRT_other', op: 'resolve' })).status).toBe(404);
    expect((await m.call('owner', 'POST', '/prs/resolve', { repo: 'o/r', number: 2, thread: 'PRRT_kw1', op: 'resolve' })).status).toBe(404);
    expect((await m.call('owner', 'POST', '/prs/resolve', { repo: 'o/r', number: 1, thread: 'PRRT_kw1', op: 'merge' })).status).toBe(422);
    const t = (await m.tokens.create({ name: 'cos', scopes: ['tasks:read', 'tasks:write'] as never })).token;
    expect((await m.call(t, 'POST', '/prs/resolve', { repo: 'o/r', number: 1, thread: 'PRRT_kw1', op: 'resolve' })).status).toBe(403);
  });
  it('POST /prs/recs/{id}: edit and reject need a reason', async () => {
    const m = mk();
    expect((await m.call('owner', 'POST', '/prs/recs/pp-0000000a', { decision: 'accept' })).status).toBe(200);
    expect((await m.call('owner', 'POST', '/prs/recs/pp-0000000a', { decision: 'reject' })).status).toBe(422);
    expect((await m.call('owner', 'POST', '/prs/recs/pp-0000000a', { decision: 'reject', reason: 'Not now' })).status).toBe(200);
    expect((await m.call('owner', 'POST', '/prs/recs/nope', { decision: 'accept' })).status).toBe(422);
    expect(m.qCalls).toEqual(['accept pp-0000000a', 'reject pp-0000000a Not now']);
  });
});

// @req FR:pr-page/group.@function @req FR:pr-page/live.poll
it('config github: user, exclude, pollSeconds', () => {
  expect(parseConfig({ github: { user: 'flanakin', exclude: ['#918'], pollSeconds: 30 } }).github).toEqual({ user: 'flanakin', exclude: ['#918'], pollSeconds: 30 });
  expect(() => parseConfig({ github: { user: 'bad user' } })).toThrow('github.user');
  expect(() => parseConfig({ github: { pollSeconds: 5 } })).toThrow('30-60');
  expect(parseConfig({}).github).toBeUndefined();
});

// @req FR:pr-page/auth.repos
it('an empty repo list means no list: writes do not reject every PR', async () => {
  const f = fakeFetch(() => ({ status: 200, body: {} }));
  const page = createPrPage({ token: TOKEN, repos: [], home: mkdtempSync(join(tmpdir(), 'prp-')), fetch: f.fetch, queue: noQueue() });
  await expect(page.prWrites.addLabel({ repo: 'o/r', number: 4 }, 'Status: 🤖 Autopilot')).resolves.not.toThrow();
  page.prBoard.stop();
});
