import { createGitHubPrs } from '../../src/api/github';

type Reply = { status?: number; body: unknown };
function fake(routes: Record<string, Reply>) {
  const seen: { url: string; auth: string | null }[] = [];
  let inFlight = 0, peak = 0;
  const fetch = (async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    seen.push({ url, auth: new Headers(init?.headers).get('authorization') });
    inFlight++; peak = Math.max(peak, inFlight);
    await new Promise((r) => setTimeout(r, 2));
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

// @req FR:agent-inbox/github.fetch
describe('GitHub PR status provider', () => {
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
    expect(f.peak()).toBeLessThanOrEqual(6);
  });
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
