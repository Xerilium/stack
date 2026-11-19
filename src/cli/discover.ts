/**
 * Finds the task repo so commands need no `--dir`: walk up from cwd, then $STACK_DIR, then ~/.config/stack/config.json `dir`.
 * @req FR:cli/run.discover
 */
import { existsSync, readdirSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { readJsonFile } from '../core/file-lock';

export interface DiscoverOpts { cwd: string; env: NodeJS.ProcessEnv; home: string }

const isStackDir = (d: string): boolean => {
  if (existsSync(join(d, '.xe/config/stack.json'))) return true;
  // A bare tasks/ folder only counts inside a git repo, so ~ or an unrelated project is never picked up.
  // A task file at any depth counts. @req FR:task-structure/tree.discover
  try { return existsSync(join(d, '.git')) && readdirSync(join(d, 'tasks'), { recursive: true }).some((f) => String(f).endsWith('.md')); } catch { return false; }
};

/** `~/.config/stack/config.json`: `repo`/`dir` (discovery), `mode: live`, `branch`, `remote`, `batch` (minutes), `bind` (`loopback` or `tailnet`) for `stack web`. @req FR:cli/web.live @req FR:cli/web.batch.idle @req FR:tailnet-access/bind.@cli */
export function userConfig(home: string): { repo?: string; dir?: string; mode?: string; branch?: string; remote?: string; batch?: number; bind?: unknown } {
  try { return readJsonFile(join(home, '.config/stack/config.json')) as ReturnType<typeof userConfig>; } catch { return {}; }
}

/** The first Stack repo at or above `cwd` (the walk-up part of discovery only). */
export function walkStackDir(cwd: string): string | null {
  for (let d = resolve(cwd); ; d = dirname(d)) {
    if (isStackDir(d)) return d;
    if (dirname(d) === d) return null;
  }
}

export function findStackDir({ cwd, env, home }: DiscoverOpts): string | null {
  const up = walkStackDir(cwd);
  if (up) return up;
  const c = env.STACK_REPO || env.STACK_DIR || userConfig(home).repo || userConfig(home).dir;
  return c && existsSync(resolve(c)) ? resolve(c) : null;
}
