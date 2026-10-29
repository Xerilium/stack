/**
 * Pull request state and checks from the GitHub REST api, for agent activity. The token goes only to api.github.com.
 * @req FR:agent-inbox/github.fetch
 */
import type { PrRef, PrStatus, PrStatusProvider } from '../core/activity';

export interface GitHubPrsOptions { token: string; fetch?: typeof fetch; ttlMs?: number; now?: () => number }

const API = 'https://api.github.com';
const REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
const MAX_IN_FLIGHT = 6;
const BAD = new Set(['failure', 'cancelled', 'timed_out', 'action_required', 'startup_failure', 'stale']);

/** Aggregates check runs: any failure wins, then anything still running, then none, else passing. */
function checksOf(runs: { status?: string; conclusion?: string | null }[]): PrStatus['checks'] {
  if (runs.length === 0) return 'none';
  if (runs.some((r) => r.conclusion && BAD.has(r.conclusion))) return 'failing';
  if (runs.some((r) => r.status !== 'completed')) return 'pending';
  return 'passing';
}

export function createGitHubPrs(o: GitHubPrsOptions): PrStatusProvider {
  const get = o.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const ttl = o.ttlMs ?? 60_000;
  const now = o.now ?? (() => Date.now());
  const cache = new Map<string, { at: number; v: PrStatus | null }>();
  const headers = { authorization: `Bearer ${o.token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'stack' };
  const call = async (path: string): Promise<unknown> => {
    const res = await get(`${API}${path}`, { headers });
    if (!res.ok) throw new Error(`GitHub ${res.status}`);
    return res.json();
  };
  const one = async (p: PrRef): Promise<PrStatus | null> => {
    const [owner, repo] = p.repo.split('/').map(encodeURIComponent);
    const pr = (await call(`/repos/${owner}/${repo}/pulls/${p.number}`)) as { title: string; state: string; merged: boolean; draft: boolean; updated_at: string; head: { sha: string } };
    const runs = (await call(`/repos/${owner}/${repo}/commits/${encodeURIComponent(pr.head.sha)}/check-runs?per_page=100`)) as { check_runs?: { status?: string; conclusion?: string | null }[] };
    const state: PrStatus['state'] = pr.merged ? 'merged' : pr.state === 'closed' ? 'closed' : pr.draft ? 'draft' : 'open';
    return { state, checks: checksOf(runs.check_runs ?? []), title: String(pr.title ?? ''), updatedAt: String(pr.updated_at ?? '') };
  };
  return async (prs) => {
    const out = new Map<string, PrStatus>();
    const todo = prs.filter((p) => REPO.test(p.repo) && Number.isInteger(p.number) && p.number > 0);
    let next = 0;
    const worker = async () => {
      while (next < todo.length) {
        const p = todo[next++];
        const hit = cache.get(p.url);
        let v: PrStatus | null;
        if (hit && now() - hit.at < ttl) v = hit.v;
        else {
          try { v = await one(p); } catch { v = null; }
          cache.set(p.url, { at: now(), v });
        }
        if (v) out.set(p.url, v);
      }
    };
    await Promise.all(Array.from({ length: Math.min(MAX_IN_FLIGHT, todo.length) }, worker));
    return out;
  };
}
