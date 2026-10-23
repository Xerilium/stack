/**
 * Finds the task repo so commands need no `--dir`: walk up from cwd, then $STACK_DIR, then ~/.config/stack/config.json `dir`.
 * @req FR:cli/run.discover
 */
import { existsSync, readdirSync, readFileSync } from 'fs';
import { dirname, join, resolve } from 'path';

export interface DiscoverOpts { cwd: string; env: NodeJS.ProcessEnv; home: string }

const isStackDir = (d: string): boolean => {
  if (existsSync(join(d, '.xe/config/stack.json'))) return true;
  try { return readdirSync(join(d, 'tasks')).some((f) => f.endsWith('.md')); } catch { return false; }
};

export function userConfig(home: string): { dir?: string; demoFrom?: string } {
  try { return JSON.parse(readFileSync(join(home, '.config/stack/config.json'), 'utf8')); } catch { return {}; }
}

export function findStackDir({ cwd, env, home }: DiscoverOpts): string | null {
  for (let d = resolve(cwd); ; d = dirname(d)) {
    if (isStackDir(d)) return d;
    if (dirname(d) === d) break;
  }
  if (env.STACK_DIR) return resolve(env.STACK_DIR);
  const c = userConfig(home).dir;
  return c ? resolve(c) : null;
}
