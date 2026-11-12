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

const readJson = (path: string): unknown => { try { return JSON.parse(readFileSync(path, 'utf8')); } catch { return undefined; } };
/** The pr-priority files under `<home>`, read on each board build. */
export const queueFiles = (home: string) => () => ({ queue: readJson(join(home, 'pr-priority.json')), state: readJson(join(home, 'pr-priority-state.json')), config: readJson(join(home, 'pr-priority.config.json')) });

export interface PrPage { prBoard: PrBoardService; prWrites: GitHubWrites; prQueue: PrQueue }
export function createPrPage(o: {
  token: string; repos?: string[]; config?: StackConfig; home: string;
  inventory?: () => { sessions: { state: string; prs: { url: string; state: string }[] }[] };
  onChange?: () => void; fetch?: typeof fetch; queue?: PrQueue;
}): PrPage {
  const g = o.config?.github ?? {};
  const source = createGitHubBoard({ token: o.token, repos: o.repos, user: g.user, fetch: o.fetch });
  const prQueue = o.queue ?? cliPrQueue();
  return {
    prBoard: createPrBoardService({ source, inventory: o.inventory, files: queueFiles(o.home), myRepos: o.repos, exclude: g.exclude, queue: async () => (prQueue.available ? prQueue.available() : true), intervalMs: g.pollSeconds ? g.pollSeconds * 1000 : undefined, onChange: o.onChange }),
    prWrites: createGitHubWrites({ token: o.token, repos: o.repos, fetch: o.fetch }),
    prQueue,
  };
}
