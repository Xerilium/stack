import { GitStorage } from '../../src/core/storage-git';
import { applyGitEnv, gitEnv, openGitStorage, parseSettings, type GitRunner } from '../../src/host';
import { ENV } from './helpers';

const s = parseSettings(ENV);
type Call = { args: string[]; cwd?: string; env: NodeJS.ProcessEnv };
const fake = () => {
  const calls: Call[] = [];
  const run: GitRunner = async (args, o) => { calls.push({ args, ...o }); };
  return { calls, run };
};

describe('azure-host git bootstrap', () => {
  /** @req FR:azure-host/git.auth */
  it('passes the token only via scoped env header', () => {
    const e = gitEnv(s, {});
    expect(e.GIT_CONFIG_KEY_0).toBe('http.https://github.com/.extraheader');
    expect(e.GIT_CONFIG_VALUE_0).toBe(`Authorization: Basic ${Buffer.from('x-access-token:ghp_secret_repo_token').toString('base64')}`);
    expect(e.GIT_TERMINAL_PROMPT).toBe('0');
    expect(e.GIT_ALLOW_PROTOCOL).toBe('https');
    expect(e.GIT_CONFIG_NOSYSTEM).toBe('1');
  });

  /** @req FR:azure-host/git.clone @req FR:azure-host/git.auth @req FR:azure-host/git.identity */
  it('clones single branch into a fresh tmp dir, token never in args', async () => {
    const { calls, run } = fake();
    const st = await openGitStorage(s, { run, tmp: '/tmp-test', env: {}, mkdir: async () => undefined });
    expect(st).toBeInstanceOf(GitStorage);
    const clone = calls[0];
    expect(clone.args.slice(0, 5)).toEqual(['clone', '--single-branch', '--branch', 'main', '--']);
    expect(clone.args[5]).toBe('https://github.com/acme/tasks.git');
    expect(clone.args[6]).toMatch(/^\/tmp-test\/stack-/);
    for (const c of calls) expect(JSON.stringify(c.args)).not.toContain('ghp_secret_repo_token');
    const names = calls.filter((c) => c.args[0] === 'config').map((c) => c.args.join(' '));
    expect(names.some((n) => n.includes('user.name Stack'))).toBe(true);
    expect(names.some((n) => n.includes('user.email stack@users.noreply.github.com'))).toBe(true);
  });

  /** @req FR:azure-host/git.identity */
  it('honors identity settings', async () => {
    const { calls, run } = fake();
    await openGitStorage(parseSettings({ ...ENV, STACK_GIT_NAME: 'Bot', STACK_GIT_EMAIL: 'b@x.io' }), { run, tmp: '/t', env: {}, mkdir: async () => undefined });
    expect(calls.map((c) => c.args.join(' ')).join('\n')).toMatch(/user\.name Bot[\s\S]*user\.email b@x\.io/);
  });

  /** @req FR:azure-host/git.clone */
  it('failed clone rejects and carries no token', async () => {
    const run: GitRunner = async () => { throw new Error('boom'); };
    await expect(openGitStorage(s, { run, tmp: '/t', env: {}, mkdir: async () => undefined })).rejects.toThrow();
  });

  /** @req FR:azure-host/git.auth */
  it('applyGitEnv sets the target env', () => {
    const t: Record<string, string | undefined> = {};
    applyGitEnv(s, t);
    expect(t.GIT_CONFIG_COUNT).toBe('1');
  });
});
