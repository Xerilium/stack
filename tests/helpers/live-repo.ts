/**
 * Real temp git repos for the store sync (`FR:store-sync/*`): a bare remote with `main` and `stack/live`,
 * a `live` clone on stack/live (the app's checkout) and a `main` clone (where the CoS pushes).
 */
import { execFileSync } from 'child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

export const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
export const LIVE_OPTS = { remote: 'origin', branch: 'stack/live', env: GIT_ENV };

const dirs: string[] = [];
export const cleanLiveRepos = () => { dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })); };

export const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', env: GIT_ENV, stdio: ['ignore', 'pipe', 'pipe'] });
const ident = (d: string) => { git(d, 'config', 'user.name', 'T'); git(d, 'config', 'user.email', 't@t.t'); git(d, 'config', 'commit.gpgsign', 'false'); };
export const put = (d: string, f: string, c: string) => { mkdirSync(join(d, f, '..'), { recursive: true }); writeFileSync(join(d, f), c); };
export const commit = (d: string, f: string, c: string, m = `edit ${f}`) => { put(d, f, c); git(d, 'add', '--', f); git(d, 'commit', '-q', '-m', m); };

export interface LiveRepos { root: string; bare: string; main: string; live: string }

export function liveRepos(): LiveRepos {
  const root = mkdtempSync(join(tmpdir(), 'stack-sync-')); dirs.push(root);
  const bare = join(root, 'remote.git');
  mkdirSync(bare); git(bare, 'init', '-q', '--bare', '-b', 'main');
  const main = join(root, 'main');
  git(root, 'clone', '-q', bare, 'main'); ident(main);
  commit(main, 'tasks/a.md', 'A0\n'); commit(main, 'tasks/b.md', 'B0\n');
  git(main, 'push', '-q', 'origin', 'main');
  git(main, 'push', '-q', 'origin', 'main:stack/live');
  git(root, 'clone', '-q', '-b', 'stack/live', bare, 'live'); const live = join(root, 'live'); ident(live);
  return { root, bare, main, live };
}

/** Commit on the `main` clone and push it. */
export const pushMain = (r: LiveRepos, f: string, c: string) => { commit(r.main, f, c); git(r.main, 'push', '-q', 'origin', 'main'); };
/** Another clone of stack/live (the cloud host). */
export const cloneLive = (r: LiveRepos, name: string) => { git(r.root, 'clone', '-q', '-b', 'stack/live', r.bare, name); const d = join(r.root, name); ident(d); return d; };
