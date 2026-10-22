/**
 * Clone the task repo into temp storage and wrap it with the git adapter (direct commits + push).
 * @req FR:azure-host/git.clone @req FR:azure-host/git.auth @req FR:azure-host/git.identity
 * @req FR:azure-host/git.timeout @req FR:azure-host/git.symlinks @req FR:azure-host/git.env
 */
import { execFile } from 'child_process';
import { randomBytes } from 'crypto';
import { mkdir as fsMkdir, rm as fsRm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Storage } from '../core/storage';
import { GitStorage } from '../core/storage-git';
import type { Env, HostSettings } from './settings';

export interface GitRunOpts { cwd?: string; env: NodeJS.ProcessEnv; timeoutMs?: number }
export type GitRunner = (args: string[], opts: GitRunOpts) => Promise<void>;

export interface GitDeps {
  run?: GitRunner;
  tmp?: string;
  env?: NodeJS.ProcessEnv;
  mkdir?: (path: string, opts: { recursive: boolean; mode?: number }) => Promise<unknown>;
  rm?: (path: string, opts: { recursive: boolean; force: boolean }) => Promise<unknown>;
  /** Per git command; default 120000. */
  timeoutMs?: number;
}

export const GIT_TIMEOUT_MS = 120_000;

/** Fixed message: never relays git output (it can echo remote URLs). Killed on timeout. @req FR:azure-host/git.timeout */
export const execGit: GitRunner = (args, { cwd, env, timeoutMs }) => new Promise((resolve, reject) => {
  execFile('git', args, { cwd, env, maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs ?? GIT_TIMEOUT_MS, killSignal: 'SIGKILL' },
    (err) => err ? reject(new Error(`git ${args[0]} failed`)) : resolve());
});

const KEEP = ['PATH', 'HOME', 'TMPDIR', 'TMP', 'TEMP', 'SYSTEMROOT', 'LANG', 'LC_ALL'];

/**
 * Minimal env for git (no app secrets), credential scoped to the repo's origin only.
 * @req FR:azure-host/git.auth @req FR:azure-host/git.env
 */
export function gitEnv(s: HostSettings, base: Env): Record<string, string | undefined> {
  const origin = `${new URL(s.repoUrl).origin}/`;
  const e: Record<string, string | undefined> = {};
  for (const k of KEEP) if (base[k] !== undefined) e[k] = base[k];
  return {
    ...e,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ALLOW_PROTOCOL: 'https',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_ASKPASS: '',
    GIT_CONFIG_COUNT: '2',
    GIT_CONFIG_KEY_0: `http.${origin}.extraheader`,
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x-access-token:${s.repoToken}`).toString('base64')}`,
    GIT_CONFIG_KEY_1: 'http.followRedirects',
    GIT_CONFIG_VALUE_1: 'false',
  };
}

export async function openGitStorage(s: HostSettings, deps: GitDeps = {}): Promise<Storage> {
  const run = deps.run ?? execGit;
  const mkdir = deps.mkdir ?? fsMkdir;
  const rm = deps.rm ?? fsRm;
  const timeoutMs = deps.timeoutMs ?? GIT_TIMEOUT_MS;
  const env = gitEnv(s, deps.env ?? process.env) as NodeJS.ProcessEnv;
  const dir = join(deps.tmp ?? tmpdir(), `stack-${randomBytes(8).toString('hex')}`);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  try {
    // core.symlinks=false: tracked links check out as plain files. @req FR:azure-host/git.symlinks
    await run(['clone', '-c', 'core.symlinks=false', '--single-branch', '--branch', s.branch, '--', s.repoUrl, dir], { env, timeoutMs });
    await run(['config', '--', 'user.name', s.gitName], { cwd: dir, env, timeoutMs });
    await run(['config', '--', 'user.email', s.gitEmail], { cwd: dir, env, timeoutMs });
    const root = s.path ? join(dir, s.path) : dir;
    if (s.path) await mkdir(root, { recursive: true });
    return new GitStorage(root, { remote: 'origin', branch: s.branch, env });
  } catch (e) {
    await Promise.resolve(rm(dir, { recursive: true, force: true })).catch(() => undefined);
    throw e;
  }
}
