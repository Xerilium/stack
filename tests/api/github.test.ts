import { readFileSync } from 'fs';
import { join } from 'path';
import { createGitHubPrs, githubRepos, GitHubReposError } from '../../src/api/github';
import { ENV, setup } from '../host/helpers';

type Reply = { status?: number; body: unknown };
function fake(routes: Record<string, Reply>) {
  const seen: { url: string; auth: string | null }[] = [];
  let inFlight = 0, peak = 0;
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, auth: new Headers(init?.headers).get('authorization') });
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise((r) => setImmediate(r)); // yield, so every request a worker pool starts overlaps; no timed sleep
    inFlight--;
    const hit = routes[url.replace('https://api.github.com', '')];
    return new Response(JSON.stringify(hit?.body ?? { message: 'Not Found' }), { status: hit ? hit.status ?? 200 : 404 });
  }) as typeof globalThis.fetch;
  return { fetch, seen, peak: () => peak };
}
const pull = (n: number, o: Partial<{ state: string; merged: boolean; draft: boolean }> = {}) => ({
  body: { number: n, title: `PR ${n}`, state: o.state ?? 'open', merged: o.merged ?? false, draft: o.draft ?? false, updated_at: '2026-10-28T12:00:00Z', head: { sha: `sha${n}` } },
});
const runs = (...r: [string, string | null][]) => ({ body: { total_count: r.length, check_runs: r.map(([status, conclusion]) => ({ status, conclusion })) } });
const ref = (n: number) => ({ url: `https://github.com/o/r/pull/${n}`, repo: 'o/r', number: n });

// @req FR:github-pr-status/status.fetch
describe('GitHub PR status provider', () => {
  // @req FR:github-pr-status/status.@function @req FR:github-pr-status/status.input @req FR:github-pr-status/status.output @req FR:github-pr-status/$pr-status @req FR:github-pr-status/wire.token.scope
  it('maps PR state and check runs, sends the token only to api.github.com', async () => {
    const f = fake({
      '/repos/o/r/pulls/1': pull(1), '/repos/o/r/commits/sha1/check-runs?per_page=100': runs(['completed', 'success'], ['completed', 'skipped']),
      '/repos/o/r/pulls/2': pull(2), '/repos/o/r/commits/sha2/check-runs?per_page=100': runs(['completed', 'success'], ['completed', 'timed_out']),
      '/repos/o/r/pulls/3': pull(3, { draft: true }), '/repos/o/r/commits/sha3/check-runs?per_page=100': runs(['in_progress', null]),
      '/repos/o/r/pulls/4': pull(4, { state: 'closed', merged: true }), '/repos/o/r/commits/sha4/check-runs?per_page=100': runs(),
      '/repos/o/r/pulls/5': pull(5, { state: 'closed' }), '/repos/o/r/commits/sha5/check-runs?per_page=100': runs(['completed', 'cancelled']),
    });
    const prs = createGitHubPrs({ token: 'ghs_secret', fetch: f.fetch });
    const m = await prs([1, 2, 3, 4, 5, 6].map(ref));
    expect(m.get(ref(1).url)).toEqual({ state: 'open', checks: 'passing', title: 'PR 1', updatedAt: '2026-10-28T12:00:00Z' });
    expect(m.get(ref(2).url)?.checks).toBe('failing');
    expect(m.get(ref(3).url)).toMatchObject({ state: 'draft', checks: 'pending' });
    expect(m.get(ref(4).url)).toMatchObject({ state: 'merged', checks: 'none' });
    expect(m.get(ref(5).url)).toMatchObject({ state: 'closed', checks: 'failing' });
    expect(m.has(ref(6).url)).toBe(false);
    expect(f.seen.every((s) => s.url.startsWith('https://api.github.com/') && s.auth === 'Bearer ghs_secret')).toBe(true);
  });
  // @req FR:github-pr-status/status.fetch.limit
  it('keeps at most 6 requests in flight, however many PRs are asked for', async () => {
    const ns = Array.from({ length: 13 }, (_, i) => i + 1);
    const f = fake(Object.fromEntries(ns.flatMap((n) => [[`/repos/o/r/pulls/${n}`, pull(n)], [`/repos/o/r/commits/sha${n}/check-runs?per_page=100`, runs()]])));
    expect((await createGitHubPrs({ token: 't', fetch: f.fetch })(ns.map(ref))).size).toBe(13);
    expect(f.peak()).toBe(6);
  });
  // @req FR:github-pr-status/status.failure
  it('leaves only the failed PR without status; the others still get theirs', async () => {
    const f = fake({ '/repos/o/r/pulls/1': pull(1), '/repos/o/r/commits/sha1/check-runs?per_page=100': runs(), '/repos/o/r/pulls/2': { status: 500, body: {} }, '/repos/o/r/pulls/3': pull(3), '/repos/o/r/commits/sha3/check-runs?per_page=100': { status: 502, body: {} } });
    const m = await createGitHubPrs({ token: 't', fetch: f.fetch })([1, 2, 3].map(ref));
    expect([...m.keys()]).toEqual([ref(1).url]);
  });
  it('gives every call a timeout signal, so a stalled GitHub becomes a missing status', async () => {
    const signals: (AbortSignal | null | undefined)[] = [];
    const stall = (async (_i: string | URL | Request, init?: RequestInit) => {
      signals.push(init?.signal);
      return new Promise<Response>((_r, reject) => init?.signal?.addEventListener('abort', () => reject(new Error('aborted'))));
    }) as typeof globalThis.fetch;
    const prs = createGitHubPrs({ token: 't', fetch: stall });
    const pending = prs([ref(1)]);
    expect(signals[0]).toBeInstanceOf(AbortSignal);
    (signals[0] as unknown as { dispatchEvent(e: Event): boolean }).dispatchEvent(new Event('abort'));
    expect((await pending).size).toBe(0);
  });
  // @req FR:github-pr-status/status.fetch.cache
  it('caches results for ttlMs', async () => {
    const f = fake({ '/repos/o/r/pulls/1': pull(1), '/repos/o/r/commits/sha1/check-runs?per_page=100': runs() });
    let t = 0;
    const prs = createGitHubPrs({ token: 't', fetch: f.fetch, ttlMs: 1000, now: () => t });
    await prs([ref(1)]); await prs([ref(1)]);
    expect(f.seen).toHaveLength(2);
    t = 2000;
    await prs([ref(1)]);
    expect(f.seen).toHaveLength(4);
  });
  it('ignores repos with odd names', async () => {
    const f = fake({});
    const prs = createGitHubPrs({ token: 't', fetch: f.fetch });
    expect((await prs([{ url: 'x', repo: '../evil', number: 1 }])).size).toBe(0);
    expect(f.seen).toHaveLength(0);
  });
});

// @req FR:github-pr-status/repos.allow
describe('repo allow-list', () => {
  type Agents = { items: { prs: object[] }[] };
  const at = (repo: string, n: number) => ({ url: `https://github.com/${repo}/pull/${n}`, repo, number: n });
  const routes = (...rs: [string, number][]) => Object.fromEntries(rs.flatMap(([repo, n]) => [[`/repos/${repo}/pulls/${n}`, pull(n)], [`/repos/${repo}/commits/sha${n}/check-runs?per_page=100`, runs()]]));
  // @req FR:github-pr-status/repos.@env @req FR:github-pr-status/repos.unset
  it('parses a comma list of owner or owner/repo; unset or blank means every repo', () => {
    expect(githubRepos(undefined)).toBeUndefined();
    expect(githubRepos(' , ')).toBeUndefined();
    expect(githubRepos(' Xerilium, o/r.js ,')).toEqual(['Xerilium', 'o/r.js']);
    for (const bad of ['o/r/x', '-o', '../evil', 'https://github.com/o/r', 'o/']) expect(() => githubRepos(bad)).toThrow(GitHubReposError);
    expect(() => githubRepos('secret-ish/../x')).toThrow(expect.objectContaining({ message: expect.not.stringContaining('secret-ish') }));
  });
  it('gives status only to PRs in listed owners or repos, never asking GitHub about the rest', async () => {
    const f = fake(routes(['Xerilium/stack', 1], ['o/r', 2], ['o/other', 3], ['private/repo', 4]));
    const prs = createGitHubPrs({ token: 't', fetch: f.fetch, repos: ['xerilium', 'O/R'] });
    const m = await prs([at('Xerilium/stack', 1), at('o/r', 2), at('o/other', 3), at('private/repo', 4)]);
    expect([...m.keys()]).toEqual([at('Xerilium/stack', 1).url, at('o/r', 2).url]);
    expect(f.seen.some((x) => /other|private/.test(x.url))).toBe(false);
  });
  // @req FR:github-pr-status/repos.unset
  it('looks up every repo when no list is given', async () => {
    const f = fake(routes(['o/r', 1], ['private/repo', 2]));
    expect((await createGitHubPrs({ token: 't', fetch: f.fetch })([at('o/r', 1), at('private/repo', 2)])).size).toBe(2);
  });
  it('host: GET /agents shows status only for allowed repos; a bad list logs a value-free reason and turns PR status off', async () => {
    const doc = '# Alpha\n\n## Active\n\n- [ ] 🤖 Ship it https://github.com/o/r/pull/1 https://github.com/private/repo/pull/2\n';
    const f = fake(routes(['o/r', 1], ['private/repo', 2]));
    const spy = jest.spyOn(globalThis, 'fetch').mockImplementation(f.fetch);
    try {
      const ok = await setup({ ...ENV, GITHUB_TOKEN: 't', STACK_GITHUB_REPOS: 'o' });
      await ok.storage.write('tasks/alpha.md', doc);
      const { items } = (await (await ok.owner('/api/agents')).json()) as Agents;
      expect(items[0].prs).toEqual([expect.objectContaining({ repo: 'o/r', state: 'open' }), { url: 'https://github.com/private/repo/pull/2', repo: 'private/repo', number: 2, priority: null }]);
      expect(f.seen.some((x) => x.url.includes('private'))).toBe(false);
      const bad = await setup({ ...ENV, GITHUB_TOKEN: 't', STACK_GITHUB_REPOS: 'o, hidden/x/y' });
      await bad.storage.write('tasks/alpha.md', doc);
      const before = f.seen.length;
      expect(((await (await bad.owner('/api/agents')).json()) as Agents).items[0].prs.every((p) => !('state' in p))).toBe(true);
      expect(f.seen).toHaveLength(before);
      expect(bad.logs.join('\n')).toContain('STACK_GITHUB_REPOS');
      expect(bad.logs.join('\n')).not.toContain('hidden');
    } finally { spy.mockRestore(); }
  });
});

// @req FR:github-pr-status/wire.token
describe('wiring', () => {
  const read = (p: string) => readFileSync(join(__dirname, '../..', p), 'utf8');
  it.each(['src/host/runtime.ts', 'src/cli/web.ts'])('%s passes the provider only when GITHUB_TOKEN is set, never logs it', (p) => {
    const src = read(p);
    expect(src).toMatch(/GITHUB_TOKEN\?\.trim\(\)/);
    expect(src).toMatch(/ghToken \? createGitHubPrs\(\{ token: ghToken, repos: githubRepos\((env|process\.env)\.STACK_GITHUB_REPOS\) \}\) : undefined/);
    expect(src).not.toMatch(/log\([^)]*ghToken|console\.\w+\([^)]*ghToken/);
  });
});
