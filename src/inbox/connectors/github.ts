/** GitHub notifications, read only, over the `gh` CLI. Mapper is pure; the connector injects the runner. @req FR:connector-github/sig.map @req FR:connector-github/item.shape @req FR:connector-github/conn.read @req FR:connector-github/conn.guard */
import { execFile } from 'child_process';
import { createHash } from 'crypto';
import { oneLine } from '../../core/asks';
import { redact } from '../../core/triage';
import type { ActionId, InboxItem } from '../types';

export type GhSignal = 'reply' | 'mention' | 'approval' | 'fyi';
export interface GhNotification {
  id: string; unread?: boolean; reason?: string; updated_at?: string;
  subject?: { title?: string; url?: string | null; type?: string };
  repository?: { full_name?: string; html_url?: string };
}
export interface GithubItem extends InboxItem { source: 'github'; signal: GhSignal }
/** Reads unread GitHub threads. Read only: no call can write. */
export interface GithubConnector { unread(): Promise<GithubItem[]> }
/** Runs `gh` with fixed args (no shell) and returns stdout. */
export type GhRun = (args: string[]) => Promise<string>;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 3).trimEnd()}...` : s);
const key = (id: string) => `gh-${createHash('sha1').update(`github:${id}`).digest('hex').slice(0, 12)}`;
const MENTION = new Set(['mention', 'team_mention']);

/** Reason to signal. Thread reasons change, so callers never cache this. @req FR:connector-github/sig.map @req FR:connector-github/sig.kind */
export function githubSignal(n: GhNotification): { signal: GhSignal; kind: string } {
  const r = n.reason ?? 'unknown';
  if (r === 'review_requested') return { signal: 'approval', kind: r };
  if (MENTION.has(r)) return { signal: 'mention', kind: r };
  if (r === 'assign') return { signal: 'reply', kind: r };
  if (r === 'ci_activity' && /\bfail/i.test(n.subject?.title ?? '')) return { signal: 'reply', kind: 'ci_failed' };
  return { signal: 'fyi', kind: r };
}

const LABEL: Record<string, string> = { review_requested: 'Review requested', mention: 'Mentioned', team_mention: 'Team mentioned', assign: 'Assigned', ci_failed: 'CI failed' };
const URGENCY = (signal: GhSignal, kind: string) => (signal === 'approval' || kind === 'ci_failed' ? 2 : signal === 'fyi' ? 0 : 1);
const SUGGEST: Record<GhSignal, ActionId> = { approval: 'ask-me-later', mention: 'ask-me-later', reply: 'create-task', fyi: 'mark-done' };
const OTHERS: ActionId[] = ['ask-me-later', 'create-task', 'mark-done', 'snooze', 'delegate'];

/** API URL to web URL. Only `https://github.com/` survives. @req FR:connector-github/item.link @req FR:connector-github/item.safe */
function webLink(n: GhNotification, kind: string): string | undefined {
  const repo = n.repository?.html_url ?? '';
  const m = /^https:\/\/api\.github\.com\/repos\/([\w.-]+\/[\w.-]+)\/(pulls|issues)\/(\d+)$/.exec(n.subject?.url ?? '');
  const url = m ? `https://github.com/${m[1]}/${m[2] === 'pulls' ? 'pull' : 'issues'}/${m[3]}` : repo && (kind === 'ci_failed' || kind === 'ci_activity') ? `${repo}/actions` : repo;
  return /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+(\/[\w./-]*)?$/.test(url) ? url : undefined;
}

/** Unread threads to items. Text is one line, redacted and clipped. @req FR:connector-github/item.shape */
export function githubItems(notes: GhNotification[], account = 'github'): GithubItem[] {
  const out: GithubItem[] = [];
  for (const n of notes) {
    if (!n?.id || n.unread === false) continue;
    const { signal, kind } = githubSignal(n);
    const repo = clip(oneLine(redact(n.repository?.full_name ?? 'GitHub')), 120);
    const title = clip(oneLine(redact(n.subject?.title ?? '(no title)')), 300);
    const link = webLink(n, kind);
    const suggested = SUGGEST[signal];
    out.push({
      id: key(String(n.id)), source: 'github', account, from: repo, subject: title, receivedAt: n.updated_at ?? '', unread: true, urgency: URGENCY(signal, kind),
      summary: clip(`${LABEL[kind] ?? 'Update'} in ${repo}: ${title}`, 400), suggested, actions: [suggested, ...OTHERS.filter((a) => a !== suggested)],
      ...(link ? { link } : {}), kind, signal,
    });
  }
  return out;
}

export class GhDenied extends Error { constructor(why: string) { super(`GitHub request denied: ${why}`); this.name = 'GhDenied'; } }
const FIELD = /^(-f|-F|--field|--raw-field|--input|-X)(=|$)/;
/** Allows only `gh api --method GET notifications[?query]`. @req FR:connector-github/conn.guard */
export function createGhGuard() {
  return {
    check(args: string[]): void {
      if (args.length !== 4 || args[0] !== 'api' || args[1] !== '--method' || args[2] !== 'GET') throw new GhDenied(args.slice(0, 3).join(' '));
      if (args.some((a) => FIELD.test(a))) throw new GhDenied('field flag');
      if (!/^notifications(\?[\w=&]*)?$/.test(args[3])) throw new GhDenied('path');
    },
  };
}

export const GH_MAX_PAGES = 5;
export const GH_PER_PAGE = 50;
const defaultRun: GhRun = (args) => new Promise((ok, no) => execFile('gh', args, { maxBuffer: 16 * 1024 * 1024 }, (e, out) => (e ? no(e) : ok(out))));
const guard = createGhGuard();

/** Needs `gh auth login` with a classic token (`notifications` or `repo` scope). `gh` holds the token. @req FR:connector-github/conn.read @req FR:connector-github/conn.error */
export function githubConnector(o: { account?: string; run?: GhRun } = {}): GithubConnector {
  const run = o.run ?? defaultRun;
  return {
    async unread() {
      const all: GhNotification[] = [];
      for (let page = 1; page <= GH_MAX_PAGES; page++) {
        const args = ['api', '--method', 'GET', `notifications?per_page=${GH_PER_PAGE}&page=${page}`];
        guard.check(args);
        let got: unknown;
        try { got = JSON.parse(await run(args)); } catch { throw new Error('GitHub request failed'); }
        if (!Array.isArray(got)) throw new Error('GitHub request failed');
        all.push(...(got as GhNotification[]));
        if (got.length < GH_PER_PAGE) break;
      }
      return githubItems(all, o.account);
    },
  };
}
