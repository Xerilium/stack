/**
 * Clone the task repo into temp storage and wrap it with the git adapter (direct commits + push).
 * @req FR:azure-host/git.clone @req FR:azure-host/git.auth @req FR:azure-host/git.identity
 */
import { execFile } from 'child_process';
import { randomBytes } from 'crypto';
import { mkdir as fsMkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import type { Storage } from '../core/storage';
import { GitStorage } from '../core/storage-git';
import type { Env, HostSettings } from './settings';

export type GitRunner = (args: string[], opts: { cwd?: string; env: NodeJS.ProcessEnv }) => Promise<void>;

export interface GitDeps {
  run?: GitRunner;
  tmp?: string;
  env?: NodeJS.ProcessEnv;
  mkdir?: (path: string, opts: { recursive: boolean; mode?: number }) => Promise<unknown>;
}

/** Fixed message: never relays git output (it can echo remote URLs). */
const defaultRun: GitRunner = (args, { cwd, env }) => new Promise((resolve, reject) => {
  execFile('git', args, { cwd, env, maxBuffer: 64 * 1024 * 1024 }, (err) => err ? reject(new Error(`git ${args[0]} failed`)) : resolve());
});

/** Env that scopes the credential to the repo's origin only. @req FR:azure-host/git.auth */
export function gitEnv(s: HostSettings, base: Env): Record<string, string | undefined> {
  const origin = `${new URL(s.repoUrl).origin}/`;
  return {
    ...base,
    GIT_TERMINAL_PROMPT: '0',
    GIT_ALLOW_PROTOCOL: 'https',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `http.${origin}.extraheader`,
    GIT_CONFIG_VALUE_0: `Authorization: Basic ${Buffer.from(`x-access-token:${s.repoToken}`).toString('base64')}`,
  };
}

/** The git adapter spawns git with process.env, so the credential env is applied there. */
export function applyGitEnv(s: HostSettings, target: Env = process.env): void {
  const e = gitEnv(s, {});
  for (const k of Object.keys(e)) target[k] = e[k];
}

export async function openGitStorage(s: HostSettings, deps: GitDeps = {}): Promise<Storage> {
  const run = deps.run ?? defaultRun;
  const base = deps.env ?? process.env;
  const mkdir = deps.mkdir ?? fsMkdir;
  const env = gitEnv(s, base) as NodeJS.ProcessEnv;
  const dir = join(deps.tmp ?? tmpdir(), `stack-${randomBytes(8).toString('hex')}`);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await run(['clone', '--single-branch', '--branch', s.branch, '--', s.repoUrl, dir], { env });
  await run(['config', 'user.name', s.gitName], { cwd: dir, env });
  await run(['config', 'user.email', s.gitEmail], { cwd: dir, env });
  const root = s.path ? join(dir, s.path) : dir;
  if (s.path) await mkdir(root, { recursive: true });
  applyGitEnv(s, base);
  return new GitStorage(root, { remote: 'origin', branch: s.branch });
}
