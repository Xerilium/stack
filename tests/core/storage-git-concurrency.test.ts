import { execFileSync, spawn, spawnSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as ts from 'typescript';
import { StorageError } from '../../src/core/storage';
import { GitStorage } from '../../src/core/storage-git';

// Cross-process writes on one repo. Temp repos only; children run a CommonJS build of the storage modules.
const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'stack-git-xproc-')); dirs.push(d); return d; };
afterAll(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const GIT_ENV = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1' };
const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', env: GIT_ENV });
const freshRepo = () => {
  const d = tmp();
  git(d, 'init', '-q', '-b', 'main');
  // A repo-local identity: CI has no global one, and GitStorage runs git with the process env.
  git(d, 'config', 'user.name', 't'); git(d, 'config', 'user.email', 't@t');
  writeFileSync(join(d, 'README.md'), 'r\n');
  git(d, 'add', '.'); git(d, 'commit', '-q', '-m', 'init');
  return d;
};

/** Compiles the storage modules to CommonJS in a temp dir; returns the path of the compiled storage-git module. */
const build = (): string => {
  const out = tmp();
  for (const f of ['storage', 'storage-git', 'file-lock']) {
    const src = readFileSync(join(__dirname, '../../src/core', `${f}.ts`), 'utf8');
    const js = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText;
    writeFileSync(join(out, `${f}.js`), js);
  }
  return join(out, 'storage-git.js');
};

const WRITER = `
const { GitStorage } = require(process.argv[1]);
const [dir, file, n] = process.argv.slice(2);
(async () => {
  const s = new GitStorage(dir);
  let failed = 0, body = '';
  for (let i = 0; i < Number(n); i++) {
    body += file + '-' + i + '\\n';
    try { await s.write(file, body); } catch (e) { failed++; process.stderr.write(String(e && e.message) + '\\n'); }
  }
  process.stdout.write(String(failed));
})();
`;

const run = (mod: string, dir: string, file: string, n: number) => new Promise<{ failed: number; err: string }>((resolve, reject) => {
  const c = spawn(process.execPath, ['-e', WRITER, mod, dir, file, String(n)], { env: GIT_ENV });
  let out = ''; let err = '';
  c.stdout.on('data', (b) => { out += b; });
  c.stderr.on('data', (b) => { err += b; });
  c.on('error', reject);
  c.on('close', () => resolve({ failed: Number(out || 'NaN'), err }));
});

describe('GitStorage across processes', () => {
  // @req FR:storage-git/git.concurrency @req FR:storage-git/git.concurrency.lock @req FR:storage-git/git.concurrency.turn
  it('serializes writes from two processes on one repo: no failures, one commit per write, every line kept', async () => {
    const mod = build();
    const d = freshRepo();
    const before = Number(git(d, 'rev-list', '--count', 'HEAD').trim());
    const [a, b] = await Promise.all([run(mod, d, 'tasks/a.md', 25), run(mod, d, 'tasks/b.md', 25)]);
    expect(a.err + b.err).toBe('');
    expect([a.failed, b.failed]).toEqual([0, 0]);
    expect(Number(git(d, 'rev-list', '--count', 'HEAD').trim()) - before).toBe(50);
    for (const f of ['a', 'b']) {
      const lines = readFileSync(join(d, 'tasks', `${f}.md`), 'utf8').trim().split('\n');
      expect(lines).toEqual(Array.from({ length: 25 }, (_, i) => `tasks/${f}.md-${i}`));
      expect(git(d, 'show', `HEAD:tasks/${f}.md`)).toBe(`${lines.join('\n')}\n`);
    }
    expect(git(d, 'status', '--porcelain')).toBe('');
  }, 120_000);

  // @req FR:storage-git/git.concurrency.stale
  it('takes over a stale lock left by a dead process', async () => {
    const d = freshRepo();
    // the pid of a process that has exited (a fixed number could be a live process)
    const dead = spawnSync(process.execPath, ['-e', '']).pid;
    writeFileSync(join(d, '.git', 'stack-write.lock'), String(dead));
    await new GitStorage(d).write('tasks/x.md', 'x');
    expect(git(d, 'show', 'HEAD:tasks/x.md')).toBe('x');
  }, 60_000);

  // @req FR:storage-git/git.concurrency.busy @req FR:storage-git/git.concurrency.busy.clean
  it('fails with StorageError when another live writer holds the lock past the wait', async () => {
    const d = freshRepo();
    writeFileSync(join(d, '.git', 'stack-write.lock'), String(process.ppid));
    const s = new GitStorage(d, { lockWaitMs: 100 });
    await expect(s.write('tasks/x.md', 'x')).rejects.toThrow(new StorageError('Another Stack process is writing; try again'));
    expect(git(d, 'rev-list', '--count', 'HEAD').trim()).toBe('1');
    expect(git(d, 'status', '--porcelain')).toBe('');
  }, 60_000);
});
