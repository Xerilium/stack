import { execFileSync } from 'child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { GitStorage } from '../../src/core/storage-git';
import { FsStorage, StorageError } from '../../src/core/storage';
import { execGit, gitEnv, openGitStorage, parseSettings, type GitRunner } from '../../src/host';
import { ENV } from './helpers';

const s = parseSettings(ENV);
type Call = { args: string[]; cwd?: string; env: NodeJS.ProcessEnv; timeoutMs?: number };
const fake = () => {
  const calls: Call[] = [];
  const run: GitRunner = async (args, o) => { calls.push({ args, ...o }); };
  return { calls, run };
};
const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'stack-ht-')); dirs.push(d); return d; };
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

describe('azure-host git bootstrap', () => {
  /** @req FR:azure-host/git.auth @req FR:azure-host/git.env */
  it('passes the token only via scoped env header, with hardened git env', () => {
    const e = gitEnv(s, {});
    expect(e.GIT_CONFIG_KEY_0).toBe('http.https://github.com/.extraheader');
    expect(e.GIT_CONFIG_VALUE_0).toBe(`Authorization: Basic ${Buffer.from('x-access-token:ghp_secret_repo_token').toString('base64')}`);
    expect(e.GIT_TERMINAL_PROMPT).toBe('0');
    expect(e.GIT_ALLOW_PROTOCOL).toBe('https');
    expect(e.GIT_CONFIG_NOSYSTEM).toBe('1');
    expect(e.GIT_CONFIG_GLOBAL).toBe('/dev/null');
    expect(e.GIT_CONFIG_SYSTEM).toBe('/dev/null');
    expect(e.GIT_ASKPASS).toBe('');
    expect(e.GIT_CONFIG_COUNT).toBe('2');
    expect(e.GIT_CONFIG_KEY_1).toBe('http.followRedirects');
    expect(e.GIT_CONFIG_VALUE_1).toBe('false');
  });

  /** @req FR:azure-host/git.env */
  it('git env is minimal: no app secrets, no process.env mutation', async () => {
    const base = { PATH: '/bin', HOME: '/h', TMPDIR: '/t', STACK_TOKEN_PEPPER: 'pep', STACK_SLACK_SIGNING_SECRET: 'x', GIT_CONFIG_COUNT: '9', AZURE_X: 'y' };
    const e = gitEnv(s, base);
    expect(Object.keys(e).filter((k) => !k.startsWith('GIT_')).sort()).toEqual(['HOME', 'PATH', 'TMPDIR']);
    expect(e.GIT_CONFIG_COUNT).toBe('2');
    const before = JSON.stringify(process.env);
    const { calls, run } = fake();
    await openGitStorage(s, { run, tmp: '/t', env: base, mkdir: async () => undefined });
    expect(JSON.stringify(process.env)).toBe(before);
    expect(process.env.GIT_CONFIG_COUNT).toBeUndefined();
    for (const c of calls) expect(Object.keys(c.env)).not.toContain('STACK_TOKEN_PEPPER');
  });

  /** @req FR:azure-host/git.clone @req FR:azure-host/git.auth @req FR:azure-host/git.identity @req FR:azure-host/git.symlinks */
  it('clones single branch without symlinks into a fresh tmp dir, token never in args', async () => {
    const { calls, run } = fake();
    const st = await openGitStorage(s, { run, tmp: '/tmp-test', env: {}, mkdir: async () => undefined });
    expect(st).toBeInstanceOf(GitStorage);
    const clone = calls[0];
    expect(clone.args.slice(0, 7)).toEqual(['clone', '-c', 'core.symlinks=false', '--single-branch', '--branch', 'main', '--']);
    expect(clone.args[7]).toBe('https://github.com/acme/tasks.git');
    expect(clone.args[8]).toMatch(/^\/tmp-test\/stack-/);
    for (const c of calls) expect(JSON.stringify(c.args)).not.toContain('ghp_secret_repo_token');
    const names = calls.filter((c) => c.args[0] === 'config').map((c) => c.args.join(' '));
    expect(names).toContain('config -- user.name Stack');
    expect(names).toContain('config -- user.email stack@users.noreply.github.com');
  });

  /** @req FR:azure-host/git.identity */
  it('honors identity settings', async () => {
    const { calls, run } = fake();
    await openGitStorage(parseSettings({ ...ENV, STACK_GIT_NAME: 'Bot', STACK_GIT_EMAIL: 'b@x.io' }), { run, tmp: '/t', env: {}, mkdir: async () => undefined });
    expect(calls.map((c) => c.args.join(' ')).join('\n')).toMatch(/user\.name Bot[\s\S]*user\.email b@x\.io/);
  });

  /** @req FR:azure-host/git.timeout */
  it('failed clone rejects, removes its dir, and passes a timeout', async () => {
    const seen: Call[] = [];
    const run: GitRunner = async (args, o) => { seen.push({ args, ...o }); throw new Error('boom'); };
    const removed: string[] = [];
    await expect(openGitStorage(s, { run, tmp: '/t', env: {}, timeoutMs: 5, mkdir: async () => undefined, rm: async (p) => { removed.push(p); } })).rejects.toThrow('boom');
    expect(seen[0].timeoutMs).toBe(5);
    expect(removed).toHaveLength(1);
    expect(removed[0]).toMatch(/^\/t\/stack-/);
  });

  /** @req FR:azure-host/git.timeout */
  it('a hung git is killed at the timeout', async () => {
    const bin = tmp();
    writeFileSync(join(bin, 'git'), '#!/bin/sh\nexec sleep 30\n');
    chmodSync(join(bin, 'git'), 0o755);
    const t0 = Date.now();
    await expect(execGit(['clone'], { env: { PATH: `${bin}:/bin:/usr/bin` }, timeoutMs: 300 })).rejects.toThrow('git clone failed');
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});

describe('azure-host symlinked repo content', () => {
  const root = () => {
    const d = tmp();
    mkdirSync(join(d, 'tasks'));
    const secret = join(tmp(), 'secret.txt');
    writeFileSync(secret, 'HOST-SECRET');
    return { d, secret };
  };

  /** @req FR:azure-host/git.symlinks @req FR:storage-git/fs.contain */
  it('refuses to read through a symlinked tasks file', async () => {
    const { d, secret } = root();
    symlinkSync(secret, join(d, 'tasks', 'evil.md'));
    const st = new FsStorage(d);
    await expect(st.read('tasks/evil.md')).rejects.toBeInstanceOf(StorageError);
    expect(await st.list()).toEqual([]);
  });

  /** @req FR:azure-host/git.symlinks @req FR:storage-git/fs.contain */
  it('refuses to write through a symlinked file or directory', async () => {
    const { d, secret } = root();
    symlinkSync(secret, join(d, 'tasks', 'evil.md'));
    const st = new FsStorage(d);
    await expect(st.write('tasks/evil.md', 'pwn')).rejects.toBeInstanceOf(StorageError);
    expect(readFileSync(secret, 'utf8')).toBe('HOST-SECRET');
    rmSync(join(d, 'tasks'), { recursive: true });
    const outside = tmp();
    symlinkSync(outside, join(d, 'tasks'));
    await expect(st.write('tasks/x.md', 'pwn')).rejects.toBeInstanceOf(StorageError);
    await expect(st.list()).rejects.toBeInstanceOf(StorageError);
    expect(existsSync(join(outside, 'x.md'))).toBe(false);
  });

  /** @req FR:azure-host/git.symlinks */
  it('a real clone with core.symlinks=false turns tracked links into plain files', () => {
    const env = { PATH: process.env.PATH, HOME: process.env.HOME, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' };
    const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, env, encoding: 'utf8' });
    const src = tmp();
    g(src, 'init', '-q', '-b', 'main');
    g(src, 'config', 'user.name', 'T'); g(src, 'config', 'user.email', 't@t.t');
    mkdirSync(join(src, 'tasks'));
    symlinkSync('/etc/hosts', join(src, 'tasks', 'evil.md'));
    g(src, 'add', '.'); g(src, 'commit', '-q', '-m', 'x');
    const dst = join(tmp(), 'c');
    g(src, 'clone', '-q', '-c', 'core.symlinks=false', '--single-branch', '--branch', 'main', '--', src, dst);
    expect(readFileSync(join(dst, 'tasks', 'evil.md'), 'utf8')).toBe('/etc/hosts');
    // Identity args with `--` set real config.
    g(dst, 'config', '--', 'user.name', 'Bot');
    expect(g(dst, 'config', 'user.name').trim()).toBe('Bot');
  });
});
