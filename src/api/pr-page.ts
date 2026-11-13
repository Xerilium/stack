/**
 * Wires the PR page from the host's GitHub config: the board, the writes, and the queue client. Never logs the token.
 * @req FR:github-pr-status/wire.token @req FR:pr-page/live.poll @req FR:pr-page/data.report @req FR:pr-page/data.recs
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import type { StackConfig } from '../core/config';
import { createGitHubBoard } from './github-board';
import { createGitHubWrites, type GitHubWrites } from './github-write';
import { createPrBoardService, type PrBoardService } from './pr-board-service';
import { cliPrQueue, type PrQueue } from './pr-queue';
import { ApiError } from './errors';
import type { GitHubAuth, GitHubAuthStatus, GitHubSignIn } from './github-auth';

const readJson = (path: string): unknown => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return undefined; } };
/** The pr-priority files under `<home>`, read on each board build. */
export const queueFiles = (home: string) => () => ({ queue: readJson(join(home, 'pr-priority.json')), state: readJson(join(home, 'pr-priority-state.json')), config: readJson(join(home, 'pr-priority.config.json')) });

export interface PrPage { prBoard: PrBoardService; prWrites: GitHubWrites; prQueue: PrQueue }
export function createPrPage(o: {
  token: string; repos?: string[]; config?: StackConfig; home: string;
  /** With no repo list, my repos are the owner plus the orgs the owner admins. @req FR:pr-page/auth.repos */
  adminOrgs?: boolean;
  inventory?: () => { sessions: { state: string; prs: { url: string; state: string }[] }[] };
  onChange?: () => void; fetch?: typeof fetch; queue?: PrQueue;
}): PrPage {
  const g = o.config?.github ?? {};
  // My repos: the explicit list (env, then config), else the owner plus admin orgs. Writes check only an explicit list. @req FR:pr-page/auth.repos
  // An empty list means no list: reads, grouping, and writes must agree.
  const list = o.repos ?? g.repos;
  const repos = list?.length ? list : undefined;
  const source = createGitHubBoard({ token: o.token, repos, user: g.user, fetch: o.fetch, adminOrgs: !repos?.length && !!o.adminOrgs });
  const prQueue = o.queue ?? cliPrQueue();
  return {
    prBoard: createPrBoardService({ source, inventory: o.inventory, files: queueFiles(o.home), myRepos: repos, exclude: g.exclude, queue: async () => (prQueue.available ? prQueue.available() : true), intervalMs: g.pollSeconds ? g.pollSeconds * 1000 : undefined, onChange: o.onChange }),
    prWrites: createGitHubWrites({ token: o.token, repos, fetch: o.fetch }),
    prQueue,
  };
}

/** The sign-in side of a local host's PR page. @req FR:pr-page/auth.state @req FR:pr-page/auth.signin */
export interface PrAuth { ready(): Promise<boolean>; status(): Promise<GitHubAuthStatus>; start(): Promise<GitHubSignIn>; session(): GitHubSignIn | null }

/**
 * The PR page for a host whose token can come and go: built on the first read that finds a token, rebuilt when the token changes.
 * With no token, the board and writes say "Sign in to GitHub first"; GET /prs answers the sign-in state instead.
 * @req FR:pr-page/auth.token @req FR:pr-page/auth.state
 */
export function createLazyPrPage(o: { auth: GitHubAuth; make: (token: string) => PrPage; queue: PrQueue }): PrPage & { prAuth: PrAuth } {
  let cur: { token: string; page: PrPage } | null = null;
  const ready = async () => {
    const t = await o.auth.token();
    if (!t) { cur?.page.prBoard.stop(); cur = null; return false; }
    if (cur?.token !== t) { cur?.page.prBoard.stop(); cur = { token: t, page: o.make(t) }; }
    return true;
  };
  const page = async (): Promise<PrPage> => { if (!(await ready()) || !cur) throw new ApiError('conflict', 'Sign in to GitHub first'); return cur.page; };
  return {
    prBoard: { get: async () => (await page()).prBoard.get(), refresh: async () => { if (cur) await cur.page.prBoard.refresh(); }, stop: () => cur?.page.prBoard.stop() },
    prWrites: {
      addLabel: async (pr, l) => (await page()).prWrites.addLabel(pr, l), removeLabel: async (pr, l) => (await page()).prWrites.removeLabel(pr, l),
      comment: async (pr, b) => (await page()).prWrites.comment(pr, b), reply: async (pr, id, b) => (await page()).prWrites.reply(pr, id, b),
    },
    prQueue: o.queue,
    prAuth: { ready, status: () => o.auth.status(), start: () => o.auth.start(), session: () => o.auth.session() },
  };
}
