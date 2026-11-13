/**
 * GitHub sign-in with zero setup: the token from the host, the in-app gh device sign-in, the lazy PR page, and the signed-out board.
 * @req FR:pr-page/auth.token @req FR:pr-page/auth.state @req FR:pr-page/auth.signin @req FR:pr-page/auth.repos @req FR:pr-page/api.get
 */
import { createApiHandler, ROUTES } from '../../src/api/handler';
import { createAuth, createTokenService, MemoryTokenStore, routeScope } from '../../src/api';
import { createGitHubAuth, GH_LOGIN_ARGS, parseGhLogin, type GhSpawn } from '../../src/api/github-auth';
import { createLazyPrPage, type PrPage } from '../../src/api/pr-page';
import { createGitHubBoard, searches } from '../../src/api/github-board';
import { noQueue } from '../../src/api/pr-queue';
import { parseConfig } from '../../src/core/config';
import { MemoryStorage } from '../../src/core/storage';

const TOKEN = 'gho_abcdefghijklmnopqrstuvwxyz0123';
const OWNER = { 'x-ms-client-principal': Buffer.from(JSON.stringify({ userDetails: 'me', identityProvider: 'github', userRoles: ['authenticated'] })).toString('base64') };

function fakeExec(answers: Record<string, string | Error>) {
  const calls: string[] = [];
  const exec = async (args: string[]) => {
    const k = args.join(' ');
    calls.push(k);
    const a = answers[k];
    if (a === undefined || a instanceof Error) throw a ?? new Error('no');
    return a;
  };
  return { exec, calls };
}

const until = async (f: () => boolean) => { for (let i = 0; i < 100 && !f(); i++) await new Promise((r) => setImmediate(r)); };

function fakeSpawn() {
  const runs: { args: string[]; text: (s: string) => void; exit: (code: number | null, err?: NodeJS.ErrnoException) => void; killed: boolean }[] = [];
  const spawn: GhSpawn = (args) => {
    const noop = () => undefined;
    const r: (typeof runs)[number] = { args, text: noop, exit: noop, killed: false };
    runs.push(r);
    return { onText: (fn) => { r.text = fn; }, onExit: (fn) => { r.exit = fn; }, kill: () => { r.killed = true; } };
  };
  return { spawn, runs };
}

describe('GitHub token from the host', () => {
  it('GITHUB_TOKEN first; else gh auth token; never both', async () => {
    const g = fakeExec({ 'auth token --hostname github.com': `${TOKEN}\n` });
    expect(await createGitHubAuth({ env: { GITHUB_TOKEN: ' env_token_value_1234567890 ' }, exec: g.exec }).token()).toBe('env_token_value_1234567890');
    expect(g.calls).toEqual([]);
    expect(await createGitHubAuth({ env: {}, exec: g.exec }).token()).toBe(TOKEN);
    expect(g.calls).toEqual(['auth token --hostname github.com']);
  });
  it('STACK_GH_AUTH=off skips gh; a bad or failed gh answer is no token', async () => {
    const g = fakeExec({ 'auth token --hostname github.com': TOKEN });
    expect(await createGitHubAuth({ env: { STACK_GH_AUTH: 'off' }, exec: g.exec }).token()).toBeNull();
    expect(g.calls).toEqual([]);
    expect(await createGitHubAuth({ env: {}, exec: fakeExec({ 'auth token --hostname github.com': 'not a token\nline' }).exec }).token()).toBeNull();
    expect(await createGitHubAuth({ env: {}, exec: fakeExec({}).exec }).token()).toBeNull();
  });
  it('a found token is read again after 10 min; no token after 15 s', async () => {
    let t = 0;
    let answer: string | Error = new Error('signed out');
    const calls: string[] = [];
    const a = createGitHubAuth({ env: {}, now: () => t, exec: async (args) => { calls.push(args.join(' ')); if (answer instanceof Error) throw answer; return answer; } });
    expect(await a.token()).toBeNull();
    t += 10_000; expect(await a.token()).toBeNull();
    expect(calls).toHaveLength(1);
    answer = TOKEN;
    t += 6_000; expect(await a.token()).toBe(TOKEN);
    t += 9 * 60_000; expect(await a.token()).toBe(TOKEN);
    expect(calls).toHaveLength(2);
    t += 2 * 60_000; await a.token();
    expect(calls).toHaveLength(3);
  });
});

describe('in-app sign-in through gh', () => {
  it('parses the one-time code and the device link from gh output', () => {
    expect(parseGhLogin('! First copy your one-time code: AB12-CD34\nOpen this URL to continue in your web browser: https://github.com/login/device\n')).toEqual({ userCode: 'AB12-CD34', verificationUri: 'https://github.com/login/device' });
    expect(parseGhLogin('Open https://evil.example/login/device code: AB12-CD34')).toEqual({ userCode: 'AB12-CD34' });
  });
  it('status: gh when the CLI runs, else none; never a token', async () => {
    expect(await createGitHubAuth({ env: {}, exec: fakeExec({ '--version': 'gh version 2.83.0' }).exec }).status()).toEqual({ state: 'signed-out', method: 'gh' });
    expect(await createGitHubAuth({ env: {}, exec: fakeExec({}).exec }).status()).toEqual({ state: 'signed-out', method: 'none' });
  });
  it('start runs gh auth login --web with fixed args, returns the code, and is done on exit 0', async () => {
    const s = fakeSpawn();
    let tokenNow: string | Error = new Error('signed out');
    const a = createGitHubAuth({ env: {}, spawn: s.spawn, exec: async (args) => { if (args[0] === '--version') return 'gh'; if (tokenNow instanceof Error) throw tokenNow; return tokenNow; } });
    expect(await a.token()).toBeNull();
    const p = a.start();
    await until(() => s.runs.length > 0);
    s.runs[0].text('! First copy your one-time code: AB12-CD34\n');
    s.runs[0].text('Open this URL to continue in your web browser: https://github.com/login/device\n');
    expect(await p).toEqual({ state: 'waiting', userCode: 'AB12-CD34', verificationUri: 'https://github.com/login/device' });
    expect(s.runs[0].args).toEqual(GH_LOGIN_ARGS);
    expect(GH_LOGIN_ARGS).toEqual(['auth', 'login', '--web', '--hostname', 'github.com', '--git-protocol', 'https', '--skip-ssh-key']);
    // One sign-in at a time.
    expect(await a.start()).toMatchObject({ state: 'waiting', userCode: 'AB12-CD34' });
    expect(s.runs).toHaveLength(1);
    expect((await a.status()).session).toMatchObject({ state: 'waiting' });
    tokenNow = TOKEN;
    s.runs[0].exit(0);
    expect(a.session()).toEqual({ state: 'done' });
    // Done drops the cached miss: the next read finds the token at once.
    expect(await a.token()).toBe(TOKEN);
  });
  it('a failed gh exit, a missing gh, and a 15 min wait end the session with a code only', async () => {
    const s = fakeSpawn();
    const a = createGitHubAuth({ env: {}, spawn: s.spawn, exec: fakeExec({ '--version': 'gh' }).exec });
    const p = a.start();
    await until(() => s.runs.length > 0);
    s.runs[0].exit(1);
    expect(await p).toEqual({ state: 'error', error: 'failed' });
    const p2 = a.start();
    await until(() => s.runs.length > 1);
    s.runs[1].exit(null, Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' }));
    expect(await p2).toEqual({ state: 'error', error: 'gh-missing' });
    const timers: (() => void)[] = [];
    const s3 = fakeSpawn();
    const b = createGitHubAuth({ env: {}, spawn: s3.spawn, exec: fakeExec({ '--version': 'gh' }).exec, codeWaitMs: 0, timers: { set: (fn) => { timers.push(fn); return timers.length; }, clear: () => undefined } });
    const p3 = b.start();
    await until(() => s3.runs.length > 0);
    s3.runs[0].text('one-time code: ZZ99-YY88');
    await p3;
    timers.forEach((f) => f());
    expect(s3.runs[0].killed).toBe(true);
    expect(b.session()).toEqual({ state: 'error', error: 'expired' });
  });
  it('two fast starts run one gh; a missing gh is checked again after a minute', async () => {
    const s = fakeSpawn();
    let t = 0;
    let has = false;
    const a = createGitHubAuth({ env: {}, spawn: s.spawn, now: () => t, codeWaitMs: 0, exec: async (args) => { if (args[0] === '--version' && has) return 'gh'; throw new Error('no'); } });
    expect((await a.status()).method).toBe('none');
    has = true;
    t += 30_000; expect((await a.status()).method).toBe('none');
    t += 31_000; expect((await a.status()).method).toBe('gh');
    const [x, y] = await Promise.all([a.start(), a.start()]);
    expect(x).toEqual(y);
    expect(s.runs).toHaveLength(1);
  });
  it('no gh CLI: start says gh-missing and runs nothing', async () => {
    const s = fakeSpawn();
    const a = createGitHubAuth({ env: {}, spawn: s.spawn, exec: fakeExec({}).exec });
    expect(await a.start()).toEqual({ state: 'error', error: 'gh-missing' });
    expect(s.runs).toHaveLength(0);
  });
});

describe('lazy PR page and the signed-out board', () => {
  const page = (token: string, made: string[]): PrPage => {
    made.push(token);
    let stopped = false;
    return {
      prBoard: { get: async () => ({ at: '2026-11-12T00:00:00Z', user: 'me', agents: { count: 1, source: 'sessions' }, counts: { waiting: 0, processing: 0, pending: 0, paused: 0 }, footer: { running: 1, waiting: 0, parked: 0 }, rows: [], summary: { live: [], signoff: [], autopilot: [], missing: [] }, queue: false, ...(stopped ? { error: 'stopped' } : {}) }), refresh: async () => undefined, stop: () => { stopped = true; } },
      prWrites: { addLabel: async () => undefined, removeLabel: async () => undefined, comment: async () => undefined, reply: async () => undefined, resolveThread: async () => undefined },
      prQueue: noQueue(),
    };
  };
  function mk(tokenOf: () => string | null, spawn = fakeSpawn()) {
    const made: string[] = [];
    let ver = 0;
    const auth = { token: async () => tokenOf(), status: async () => ({ state: 'signed-out' as const, method: 'gh' as const }), start: async () => { ver++; return { state: 'waiting' as const, userCode: 'AB12-CD34', verificationUri: 'https://github.com/login/device' }; }, session: () => (ver ? { state: 'waiting' as const, userCode: 'AB12-CD34' } : null) };
    const lazy = createLazyPrPage({ auth, make: (t) => page(t, made), queue: noQueue() });
    const tokens = createTokenService({ store: new MemoryTokenStore() });
    const a = createAuth({ owners: [], tokens });
    const deps = { storage: new MemoryStorage(), ...lazy };
    const owner = createApiHandler({ ...deps, authorize: () => true });
    const viaToken = a.wrap(createApiHandler({ ...deps, authorize: a.authorize }));
    const call = async (method: string, path: string, who: 'owner' | string = 'owner', body: unknown = {}) => {
      const res = await (who === 'owner' ? owner : viaToken)(new Request(`https://x.test/api${path}`, { method, headers: { 'content-type': 'application/json', ...(who === 'owner' ? OWNER : { authorization: `Bearer ${who}` }) }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) }));
      const t = await res.text();
      return { status: res.status, json: t ? JSON.parse(t) : undefined, text: t };
    };
    return { call, made, tokens, spawn };
  }
  it('signed out: GET /prs is one honest state, never an empty board; writes say sign in first', async () => {
    const m = mk(() => null);
    expect(await m.call('GET', '/prs')).toMatchObject({ status: 200, json: { auth: { state: 'signed-out', method: 'gh' } } });
    expect((await m.call('GET', '/prs')).json.rows).toBeUndefined();
    const w = await m.call('POST', '/prs/label');
    expect(w.status).toBe(422); // validation runs first
    expect(await m.call('POST', '/prs/label', 'owner', { repo: 'o/r', number: 1, op: 'add' })).toMatchObject({ status: 409, json: { error: { message: 'Sign in to GitHub first' } } });
    expect(m.made).toEqual([]);
  });
  it('a token that shows up later builds the board; a new token rebuilds it; no token in any answer', async () => {
    let tok: string | null = null;
    const m = mk(() => tok);
    expect((await m.call('GET', '/prs')).json.auth).toBeDefined();
    tok = TOKEN;
    const r = await m.call('GET', '/prs');
    expect(r.json).toMatchObject({ user: 'me', agents: { count: 1 } });
    expect(r.text).not.toContain(TOKEN);
    await m.call('GET', '/prs');
    expect(m.made).toEqual([TOKEN]);
    tok = `${TOKEN}x`;
    await m.call('GET', '/prs');
    expect(m.made).toEqual([TOKEN, `${TOKEN}x`]);
  });
  it('POST /prs/sign-in starts the gh sign-in; GET returns the session; owner only', async () => {
    const m = mk(() => null);
    expect(await m.call('POST', '/prs/sign-in')).toMatchObject({ status: 200, json: { state: 'waiting', userCode: 'AB12-CD34', verificationUri: 'https://github.com/login/device' } });
    expect(await m.call('GET', '/prs/sign-in')).toMatchObject({ status: 200, json: { state: 'waiting' } });
    const t = (await m.tokens.create({ name: 'cos', scopes: ['tasks:read', 'tasks:write'] as never })).token;
    expect((await m.call('POST', '/prs/sign-in', t)).status).toBe(403);
    expect((await m.call('GET', '/prs/sign-in', t)).status).toBe(403);
    expect(routeScope('prs.signin')).toBe('tasks:write');
    expect(routeScope('prs.signin.get')).toBe('tasks:read');
    expect(ROUTES.filter((r) => r.name.startsWith('prs.signin')).map((r) => `${r.method} ${r.doc}`)).toEqual(['GET /prs/sign-in', 'POST /prs/sign-in']);
  });
  it('a host with no sign-in answers 404 on the sign-in routes', async () => {
    const owner = createApiHandler({ storage: new MemoryStorage(), authorize: () => true });
    const r = await owner(new Request('https://x.test/api/prs/sign-in', { method: 'POST', headers: { 'content-type': 'application/json', ...OWNER }, body: '{}' }));
    expect(r.status).toBe(404);
  });
});

describe('my repos with zero setup', () => {
  it('config github.repos: owners or owner/repo', () => {
    expect(parseConfig({ github: { repos: ['Xerilium', 'microsoft/finops-toolkit'] } }).github).toEqual({ repos: ['Xerilium', 'microsoft/finops-toolkit'] });
    expect(() => parseConfig({ github: { repos: ['bad repo!'] } })).toThrow('github.repos');
  });
  it('no list: the owner plus the orgs where the owner is an admin, read once an hour', async () => {
    let t = 0;
    const urls: string[] = [];
    const queries: string[] = [];
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      const u = String(input);
      urls.push(u);
      if (u.endsWith('/user')) return new Response(JSON.stringify({ login: 'flanakin' }), { status: 200 });
      if (u.includes('/user/memberships/orgs')) return new Response(JSON.stringify([{ role: 'admin', organization: { login: 'Xerilium' } }, { role: 'member', organization: { login: 'microsoft' } }, { role: 'admin', organization: { login: 'allytehq' } }, { role: 'admin', organization: { login: 'bad name!' } }]), { status: 200 });
      const b = JSON.parse(String(init?.body));
      queries.push(b.variables?.c ?? '');
      return new Response(JSON.stringify({ data: { rateLimit: { remaining: 4000, resetAt: '2026-11-12T13:00:00Z' }, a: { nodes: [] }, b: { nodes: [] }, c: { nodes: [] } } }), { status: 200 });
    }) as typeof globalThis.fetch;
    const g = createGitHubBoard({ token: TOKEN, fetch, adminOrgs: true, now: () => t });
    const r = await g.fetch();
    expect(r.myRepos).toEqual(['flanakin', 'Xerilium', 'allytehq']);
    expect(queries[0]).toBe(searches('flanakin', ['flanakin', 'Xerilium', 'allytehq'])[2]);
    expect(queries[0]).not.toContain('microsoft');
    await g.fetch();
    expect(urls.filter((u) => u.includes('memberships'))).toHaveLength(1);
    t += 61 * 60_000;
    await g.fetch();
    expect(urls.filter((u) => u.includes('memberships'))).toHaveLength(2);
  });
  it('the board service groups by the derived repos when no list is set', async () => {
    const { createPrBoardService } = await import('../../src/api/pr-board-service');
    const fact = { url: 'https://github.com/Xerilium/stack/pull/7', repo: 'Xerilium/stack', number: 7, title: 'T', author: 'roland', draft: false, createdAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-11T00:00:00Z', headOid: 's', body: '', labels: [], assignees: [], requested: [], reviews: [], mergeable: 'MERGEABLE', checks: [] };
    const svc = createPrBoardService({ source: { user: async () => 'flanakin', fetch: async () => ({ user: 'flanakin', facts: [fact], myRepos: ['flanakin', 'Xerilium'] }) }, timers: { set: () => 0, clear: () => undefined } });
    expect((await svc.get()).rows.map((r) => r.group)).toEqual(['waiting']);
    const none = createPrBoardService({ source: { user: async () => 'flanakin', fetch: async () => ({ user: 'flanakin', facts: [fact] }) }, timers: { set: () => 0, clear: () => undefined } });
    expect((await none.get()).rows).toEqual([]);
  });
  it('detail reads run at most 3 at a time, keep answer order, and keep the lowest rate', async () => {
    const pr = (n: number) => ({ url: `https://github.com/o/r/pull/${n}`, number: n, title: `PR ${n}`, isDraft: false, createdAt: '2026-11-10T00:00:00Z', updatedAt: '2026-11-11T00:00:00Z', body: '', mergeable: 'MERGEABLE', repository: { nameWithOwner: 'o/r' }, author: { login: 'me', __typename: 'User' }, labels: { nodes: [] }, assignees: { nodes: [] }, reviewRequests: { nodes: [] }, latestOpinionatedReviews: { nodes: [] }, commits: { nodes: [] } });
    let live = 0; let peak = 0; let calls = 0;
    const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
      if (String(input).endsWith('/user')) return new Response(JSON.stringify({ login: 'me' }), { status: 200 });
      const q = JSON.parse(String(init?.body)).query as string;
      if (q.includes('search(')) return new Response(JSON.stringify({ data: { rateLimit: { remaining: 4000, resetAt: 'r0' }, a: { nodes: Array.from({ length: 45 }, (_, i) => pr(i + 1)) }, b: { nodes: [] }, c: { nodes: [] } } }), { status: 200 });
      const k = ++calls;
      live++; peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 30 - k * 5));
      live--;
      const n = (q.match(/pullRequest\(number: (\d+)\)/g) ?? []).map((m) => Number(/\d+/.exec(m)![0]));
      const data: Record<string, unknown> = { rateLimit: { remaining: 4000 - k * 10, resetAt: `r${k}` } };
      n.forEach((num, j) => { data[`p${j}`] = { pullRequest: { reviewThreads: { nodes: [] }, comments: { nodes: [{ url: `c${num}`, body: String(num), author: { login: 'x', __typename: 'User' } }] }, commits: { nodes: [] } } }; });
      return new Response(JSON.stringify({ data }), { status: 200 });
    }) as typeof globalThis.fetch;
    const r = await createGitHubBoard({ token: TOKEN, fetch }).fetch();
    expect(calls).toBe(5);
    expect(peak).toBe(3);
    expect(r.facts.every((f) => f.comments?.[0]?.body === String(f.number))).toBe(true);
    expect(r.rate).toEqual({ remaining: 3950, resetAt: 'r5' });
  });
  it('a failed org read uses the owner only and is read again after 5 minutes', async () => {
    let t = 0;
    let n = 0;
    const fetch = (async (input: string | URL | Request) => {
      const u = String(input);
      if (u.endsWith('/user')) return new Response(JSON.stringify({ login: 'me' }), { status: 200 });
      if (u.includes('memberships')) { n++; return new Response('{}', { status: 403 }); }
      return new Response(JSON.stringify({ data: { a: { nodes: [] }, b: { nodes: [] }, c: { nodes: [] } } }), { status: 200 });
    }) as typeof globalThis.fetch;
    const g = createGitHubBoard({ token: TOKEN, fetch, adminOrgs: true, now: () => t });
    expect((await g.fetch()).myRepos).toEqual(['me']);
    t += 4 * 60_000; await g.fetch();
    expect(n).toBe(1);
    t += 2 * 60_000; await g.fetch();
    expect(n).toBe(2);
  });
});
