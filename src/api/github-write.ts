/**
 * The only GitHub writes for the PR page: the Autopilot label and an AI-prefixed comment or thread reply.
 * No merge, close, un-draft, or review: there is no method for them.
 * @req FR:github-pr-status/write.@function @req FR:github-pr-status/write.label @req FR:github-pr-status/write.comment
 * @req FR:github-pr-status/write.never @req FR:github-pr-status/write.errors @req FR:github-pr-status/write.scopes
 */
import { LABELS, sameLabel } from '../core/pr-board';

export interface PrRef { repo: string; number: number }
export interface GitHubWrites {
  addLabel(pr: PrRef, label: string): Promise<void>;
  removeLabel(pr: PrRef, label: string): Promise<void>;
  comment(pr: PrRef, body: string): Promise<void>;
  reply(pr: PrRef, commentId: number, body: string): Promise<void>;
}
/** A write the module refuses before any call. */
export class GitHubWriteDenied extends Error { constructor(why: string) { super(why); this.name = 'GitHubWriteDenied'; } }

const API = 'https://api.github.com';
const REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
export const AI_PREFIX = '🤖 [AI] ';
const MAX_BODY = 4000;

export function createGitHubWrites(o: { token: string; fetch?: typeof fetch; repos?: string[] }): GitHubWrites {
  const get = o.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const allow = o.repos && new Set(o.repos.map((x) => x.toLowerCase()));
  const headers = { authorization: `Bearer ${o.token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'stack', 'content-type': 'application/json' };
  const path = (pr: PrRef) => {
    if (!REPO.test(pr.repo) || !Number.isInteger(pr.number) || pr.number < 1) throw new GitHubWriteDenied('Bad PR reference');
    if (allow && !allow.has(pr.repo.toLowerCase()) && !allow.has(pr.repo.split('/')[0].toLowerCase())) throw new GitHubWriteDenied('Repo is not in STACK_GITHUB_REPOS');
    const [owner, name] = pr.repo.split('/').map(encodeURIComponent);
    return `/repos/${owner}/${name}`;
  };
  const autopilot = (label: string) => { if (!sameLabel(label, LABELS.autopilot)) throw new GitHubWriteDenied('Only the Autopilot label can be set'); };
  const text = (body: string) => { if (!body.startsWith(AI_PREFIX) || body.length > MAX_BODY || body.trim() === AI_PREFIX.trim()) throw new GitHubWriteDenied(`Comment must start with "${AI_PREFIX.trim()}" and be at most ${MAX_BODY} characters`); };
  const send = async (method: 'POST' | 'DELETE', p: string, body?: unknown) => {
    const res = await get(`${API}${p}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15_000) });
    // Removing a label that is not there is already done.
    if (!res.ok && !(method === 'DELETE' && res.status === 404)) throw new Error(`GitHub ${res.status}`);
  };
  const spelled = new Map<string, string[]>();
  /** The repo's label names (first 100), read once per repo. */
  const repoLabels = async (pr: PrRef): Promise<string[]> => {
    const key = pr.repo.toLowerCase();
    if (!spelled.has(key)) {
      const res = await get(`${API}${path(pr)}/labels?per_page=100`, { headers, signal: AbortSignal.timeout(15_000) });
      const list: unknown = res.ok ? await res.json().catch(() => null) : null;
      spelled.set(key, Array.isArray(list) ? list.map((l: { name?: unknown }) => String(l?.name ?? '')) : []);
    }
    return spelled.get(key)!;
  };
  return {
    async addLabel(pr, label) {
      autopilot(label);
      // Use the repo's own spelling so a variant never makes a second label.
      const names = await repoLabels(pr);
      await send('POST', `${path(pr)}/issues/${pr.number}/labels`, { labels: [names.find((n) => sameLabel(n, label)) ?? label] });
    },
    async removeLabel(pr, label) { autopilot(label); await send('DELETE', `${path(pr)}/issues/${pr.number}/labels/${encodeURIComponent(label)}`); },
    async comment(pr, body) { text(body); await send('POST', `${path(pr)}/issues/${pr.number}/comments`, { body }); },
    async reply(pr, commentId, body) {
      text(body);
      if (!Number.isInteger(commentId) || commentId < 1) throw new GitHubWriteDenied('Bad comment id');
      await send('POST', `${path(pr)}/pulls/${pr.number}/comments/${commentId}/replies`, { body });
    },
  };
}
