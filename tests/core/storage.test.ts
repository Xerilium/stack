import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, cpSync } from 'fs';
import { tmpdir } from 'os';
import { StorageError } from '../../src/core/storage';
import { join } from 'path';
import {
  Storage, MemoryStorage, FsStorage, writeAll, NotFoundError, ConflictError, PathError, versionOf,
} from '../../src/core/storage';
import { GitStorage } from '../../src/core/storage-git';

jest.setTimeout(20000);
// Isolate spawned git (ours and the helper) from the developer's global/system config, hooks and signing.
const savedEnv = { g: process.env.GIT_CONFIG_GLOBAL, s: process.env.GIT_CONFIG_SYSTEM };
beforeAll(() => { process.env.GIT_CONFIG_GLOBAL = '/dev/null'; process.env.GIT_CONFIG_SYSTEM = '/dev/null'; });
afterAll(() => {
  for (const [k, v] of [['GIT_CONFIG_GLOBAL', savedEnv.g], ['GIT_CONFIG_SYSTEM', savedEnv.s]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});
const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'stack-st-')); dirs.push(d); return d; };
afterAll(() => dirs.forEach(d => rmSync(d, { recursive: true, force: true })));

const git = (cwd: string, ...a: string[]) =>
  execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
const initRepo = (dir: string) => {
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'T'); git(dir, 'config', 'user.email', 't@t.t');
  git(dir, 'config', 'commit.gpgsign', 'false');
};
// Fixtures are built once with git, then copied per test (a copy costs no git spawns).
let repoTpl: string;
let remoteTpl: string;
beforeAll(() => {
  repoTpl = tmp(); initRepo(repoTpl);
  remoteTpl = tmp();
  const bare = join(remoteTpl, 'remote.git');
  mkdirSync(bare); git(bare, 'init', '-q', '--bare', '-b', 'main');
  const seed = join(remoteTpl, 'seed'); mkdirSync(seed); initRepo(seed);
  writeFileSync(join(seed, 'README.md'), 'x'); git(seed, 'add', '.'); git(seed, 'commit', '-q', '-m', 'init');
  git(seed, 'remote', 'add', 'origin', bare); git(seed, 'push', '-q', 'origin', 'main');
  for (const n of ['a', 'b']) {
    git(remoteTpl, 'clone', '-q', bare, n);
    const d = join(remoteTpl, n);
    git(d, 'config', 'user.name', 'T'); git(d, 'config', 'user.email', 't@t.t'); git(d, 'config', 'commit.gpgsign', 'false');
  }
});
/** Fresh empty repo. */
const freshRepo = () => { const d = tmp(); cpSync(repoTpl, d, { recursive: true }); return d; };
/** Bare remote + two clones with an initial commit. */
const remoteSetup = () => {
  const root = tmp();
  cpSync(remoteTpl, root, { recursive: true });
  for (const n of ['a', 'b']) { // clones point at the template's bare repo; retarget to the copy
    const cfg = join(root, n, '.git', 'config');
    writeFileSync(cfg, readFileSync(cfg, 'utf8').split(remoteTpl).join(root));
  }
  return { bare: join(root, 'remote.git'), a: join(root, 'a'), b: join(root, 'b') };
};

const adapters: [string, () => Storage][] = [
  ['MemoryStorage', () => new MemoryStorage()],
  ['FsStorage', () => new FsStorage(tmp())],
  ['GitStorage', () => new GitStorage(freshRepo())],
];

// @req FR:storage-git/interface.@type
describe.each(adapters)('%s contract', (_n, make) => {
  let s: Storage;
  beforeEach(() => { s = make(); });

  // @req FR:storage-git/interface.list
  it('lists only sorted tasks/*.md', async () => {
    await s.write('tasks/b.md', 'b'); await s.write('tasks/a.md', 'a');
    expect(await s.list()).toEqual(['tasks/a.md', 'tasks/b.md']);
  });
  it('lists empty when no tasks dir', async () => { expect(await s.list()).toEqual([]); });

  // @req FR:storage-git/interface.read
  it('throws NotFoundError for missing file', async () => {
    await expect(s.read('tasks/nope.md')).rejects.toBeInstanceOf(NotFoundError);
  });

  // @req FR:storage-git/interface.bytes @req FR:storage-git/$stored-file
  it('round-trips bytes exactly', async () => {
    const c = '﻿# T\r\n- [ ] 🔝 emoji  \r\n\r\n\ttab\n  trailing   ';
    const w = await s.write('tasks/x.md', c);
    const r = await s.read('tasks/x.md');
    expect(r.content).toBe(c);
    expect(r.version).toBe(w.version);
    expect(r.path).toBe('tasks/x.md');
  });

  // @req FR:storage-git/interface.version
  it('derives version from content', async () => {
    const w = await s.write('tasks/x.md', 'hello');
    expect(w.version).toBe(versionOf('hello'));
  });

  // @req FR:storage-git/interface.paths
  // dotfiles rejected consistently with list()
  it.each(['/etc/x.md', '../x.md', 'tasks/../x.md', 'tasks\\x.md', 'tasks/x.txt', 'other/x.md', 'tasks/a/b.md', 'tasks/\0.md', '.git/config', 'tasks/.x.md', 'tasks/.md'])(
    'rejects bad path %j', async p => {
      await expect(s.write(p, 'x')).rejects.toBeInstanceOf(PathError);
      await expect(s.read(p)).rejects.toBeInstanceOf(PathError);
    });

  // @req FR:storage-git/write.expected @req FR:storage-git/$write-opts
  it('enforces expectedVersion', async () => {
    const w1 = await s.write('tasks/x.md', 'one', { expectedVersion: null });
    await expect(s.write('tasks/x.md', 'dup', { expectedVersion: null })).rejects.toBeInstanceOf(ConflictError);
    await expect(s.write('tasks/x.md', 'two', { expectedVersion: 'stale' })).rejects.toBeInstanceOf(ConflictError);
    await expect(s.write('tasks/missing.md', 'two', { expectedVersion: 'v' })).rejects.toBeInstanceOf(ConflictError);
    const w2 = await s.write('tasks/x.md', 'two', { expectedVersion: w1.version });
    expect(w2.version).toBe(versionOf('two'));
    expect((await s.read('tasks/x.md')).content).toBe('two');
  });

  // @req FR:storage-git/write.serial
  it('serializes concurrent writes', async () => {
    const w = await s.write('tasks/x.md', '0');
    const res = await Promise.allSettled([
      s.write('tasks/x.md', 'a', { expectedVersion: w.version }),
      s.write('tasks/x.md', 'b', { expectedVersion: w.version }),
    ]);
    expect(res.map(r => r.status).sort()).toEqual(['fulfilled', 'rejected']);
  });
});

// @req FR:storage-git/write.many
describe.each(adapters)('%s writeMany', (_n, make) => {
  let s: Storage;
  beforeEach(() => { s = make(); });

  it('writes all files and returns versions', async () => {
    await writeAll(s, [{ path: 'tasks/a.md', content: 'A' }, { path: 'README.md', content: 'R' }], 'both');
    expect((await s.read('tasks/a.md')).content).toBe('A');
    expect((await s.read('README.md')).content).toBe('R');
  });

  it('checks every expectedVersion first and writes nothing on a mismatch', async () => {
    await s.write('tasks/a.md', 'A1');
    await expect(writeAll(s, [
      { path: 'tasks/b.md', content: 'B', expectedVersion: null },
      { path: 'tasks/a.md', content: 'A2', expectedVersion: 'stale' },
    ])).rejects.toBeInstanceOf(ConflictError);
    expect((await s.read('tasks/a.md')).content).toBe('A1');
    await expect(s.read('tasks/b.md')).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects duplicate and bad paths without writing', async () => {
    await expect(writeAll(s, [{ path: 'tasks/a.md', content: '1' }, { path: 'tasks/a.md', content: '2' }])).rejects.toBeInstanceOf(StorageError);
    await expect(writeAll(s, [{ path: 'tasks/a.md', content: '1' }, { path: '../x.md', content: '2' }])).rejects.toBeInstanceOf(PathError);
    await expect(s.read('tasks/a.md')).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('writeAll fallback', () => {
  it('writes one by one for adapters without writeMany', async () => {
    const inner = new MemoryStorage();
    const plain: Storage = { list: () => inner.list(), read: (p) => inner.read(p), write: (p, c, o) => inner.write(p, c, o) };
    await writeAll(plain, [{ path: 'tasks/a.md', content: 'A' }, { path: 'tasks/b.md', content: 'B' }]);
    expect(await inner.list()).toEqual(['tasks/a.md', 'tasks/b.md']);
  });
});

describe('GitStorage writeMany', () => {
  const count = (d: string) => Number(git(d, 'rev-list', '--count', 'HEAD').trim());
  it('makes ONE commit for all changed paths and skips unchanged ones', async () => {
    const d = freshRepo();
    const s = new GitStorage(d);
    await s.write('tasks/a.md', 'A');
    const before = count(d);
    await writeAll(s, [{ path: 'tasks/a.md', content: 'A' }, { path: 'tasks/b.md', content: 'B' }, { path: 'README.md', content: 'R' }], 'Update summaries');
    expect(count(d)).toBe(before + 1);
    expect(git(d, 'log', '-1', '--format=%s').trim()).toBe('Update summaries');
    expect(git(d, 'show', '--name-only', '--format=', 'HEAD').trim().split('\n').sort()).toEqual(['README.md', 'tasks/b.md']);
    await writeAll(s, [{ path: 'tasks/b.md', content: 'B' }]);
    expect(count(d)).toBe(before + 1);
    expect(git(d, 'status', '--porcelain').trim()).toBe('');
  });

  it('leaves unrelated staged files alone and rolls back on conflict', async () => {
    const d = freshRepo();
    const s = new GitStorage(d);
    await s.write('tasks/a.md', 'A');
    writeFileSync(join(d, 'tasks/other.md'), 'staged'); git(d, 'add', 'tasks/other.md');
    await expect(writeAll(s, [{ path: 'tasks/new.md', content: 'N' }, { path: 'tasks/a.md', content: 'A2', expectedVersion: 'stale' }])).rejects.toBeInstanceOf(ConflictError);
    expect(existsSync(join(d, 'tasks/new.md'))).toBe(false);
    expect(git(d, 'diff', '--cached', '--name-only').trim()).toBe('tasks/other.md');
    await writeAll(s, [{ path: 'tasks/new.md', content: 'N' }, { path: 'tasks/a.md', content: 'A2' }]);
    expect(git(d, 'show', '--name-only', '--format=', 'HEAD').trim().split('\n').sort()).toEqual(['tasks/a.md', 'tasks/new.md']);
    expect(git(d, 'diff', '--cached', '--name-only').trim()).toBe('tasks/other.md');
  });

  it('pushes once and rolls everything back when the remote moved', async () => {
    const { a, b } = remoteSetup();
    const sa = new GitStorage(a, { remote: 'origin' });
    const sb = new GitStorage(b, { remote: 'origin' });
    await sa.write('tasks/x.md', 'X0');
    await writeAll(sb, [{ path: 'tasks/y.md', content: 'Y' }, { path: 'tasks/x.md', content: 'X1' }], 'both');
    expect(git(a, 'fetch', '-q', 'origin') + git(a, 'log', '-1', '--format=%s', 'origin/main').trim()).toBe('both');
    // a is stale: its expected version of x.md is X0 but remote has X1
    await expect(writeAll(sa, [{ path: 'tasks/z.md', content: 'Z' }, { path: 'tasks/x.md', content: 'X2', expectedVersion: versionOf('X0') }])).rejects.toBeInstanceOf(ConflictError);
    expect(git(a, 'status', '--porcelain').trim()).toBe('');
    expect(existsSync(join(a, 'tasks/z.md'))).toBe(false);
  });
});

// @req FR:storage-git/git.isolation @req FR:storage-git/git.commit
describe('GitStorage rollback', () => {
  // @req FR:storage-git/git.failure
  it('rolls back a failed commit (pre-commit hook) and keeps unrelated staged files', async () => {
    const d = freshRepo();
    const s = new GitStorage(d);
    await s.write('tasks/x.md', 'old');
    writeFileSync(join(d, 'other.txt'), 'o'); git(d, 'add', 'other.txt');
    const hook = join(d, '.git', 'hooks', 'pre-commit');
    writeFileSync(hook, '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const head = git(d, 'rev-parse', 'HEAD');
    await expect(s.write('tasks/x.md', 'new')).rejects.toBeInstanceOf(StorageError);
    await expect(s.write('tasks/n.md', 'new')).rejects.toBeInstanceOf(StorageError);
    expect(readFileSync(join(d, 'tasks', 'x.md'), 'utf8')).toBe('old');
    expect(existsSync(join(d, 'tasks', 'n.md'))).toBe(false);
    expect(git(d, 'rev-parse', 'HEAD')).toBe(head);
    expect(git(d, 'status', '--porcelain')).toBe('A  other.txt\n');
  });

  // @req FR:storage-git/git.failure
  it("keeps the user's own staged edit of the same path when the commit fails", async () => {
    const d = freshRepo();
    const s = new GitStorage(d);
    await s.write('tasks/x.md', 'old');
    writeFileSync(join(d, 'tasks', 'x.md'), 'mine'); git(d, 'add', 'tasks/x.md');
    writeFileSync(join(d, '.git', 'hooks', 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    await expect(s.write('tasks/x.md', 'new')).rejects.toBeInstanceOf(StorageError);
    expect(git(d, 'show', ':tasks/x.md')).toBe('mine');
    expect(git(d, 'status', '--porcelain')).toBe('M  tasks/x.md\n');
  });

  // @req FR:storage-git/git.branch
  it('rejects when the configured branch is not checked out', async () => {
    const { a } = remoteSetup();
    git(a, 'checkout', '-q', '-b', 'other');
    const s = new GitStorage(a, { remote: 'origin', branch: 'main' });
    await expect(s.write('tasks/x.md', 'x')).rejects.toBeInstanceOf(StorageError);
    expect(existsSync(join(a, 'tasks', 'x.md'))).toBe(false);
  });
});

// @req FR:storage-git/write.atomic
describe('FsStorage atomicity', () => {
  it('leaves no temp files and keeps prior content when write fails', async () => {
    const d = tmp(); const s = new FsStorage(d);
    await s.write('tasks/x.md', 'old');
    // Make the target a directory-conflict: rename onto a directory fails.
    mkdirSync(join(d, 'tasks', 'y.md'));
    await expect(s.write('tasks/y.md', 'new')).rejects.toBeDefined();
    expect(readdirSync(join(d, 'tasks')).sort()).toEqual(['x.md', 'y.md']);
    expect(readFileSync(join(d, 'tasks', 'x.md'), 'utf8')).toBe('old');
  });
  // @req FR:storage-git/fs.fs
  it('writes through to disk', async () => {
    const d = tmp(); await new FsStorage(d).write('tasks/x.md', 'hi');
    expect(readFileSync(join(d, 'tasks', 'x.md'), 'utf8')).toBe('hi');
  });
  // @req FR:storage-git/fs.memory
  it('memory adapter is isolated per instance', async () => {
    await new MemoryStorage().write('tasks/x.md', '1');
    expect(await new MemoryStorage().list()).toEqual([]);
  });
});

describe('GitStorage local', () => {
  // @req FR:storage-git/git.commit
  it('makes one commit with only the written path and message', async () => {
    const d = freshRepo(); const s = new GitStorage(d);
    await s.write('tasks/a.md', 'a', { message: 'Add a' });
    await s.write('tasks/b.md', 'b');
    const log = git(d, 'log', '--format=%s').trim().split('\n');
    expect(log).toHaveLength(2);
    expect(log[1]).toBe('Add a');
    expect(log[0]).toMatch(/tasks\/b\.md/);
    expect(git(d, 'show', '--name-only', '--format=', 'HEAD').trim()).toBe('tasks/b.md');
    expect(git(d, 'status', '--porcelain')).toBe('');
  });

  // @req FR:storage-git/git.noop
  it('does not commit identical content', async () => {
    const d = freshRepo(); const s = new GitStorage(d);
    await s.write('tasks/a.md', 'a'); await s.write('tasks/a.md', 'a');
    expect(git(d, 'rev-list', '--count', 'HEAD').trim()).toBe('1');
  });

  // @req FR:storage-git/git.isolation
  it('does not commit or lose unrelated dirty and staged files', async () => {
    const d = freshRepo();
    writeFileSync(join(d, 'README.md'), 'r'); git(d, 'add', '.'); git(d, 'commit', '-q', '-m', 'init');
    writeFileSync(join(d, 'README.md'), 'dirty');
    writeFileSync(join(d, 'staged.txt'), 's'); git(d, 'add', 'staged.txt');
    writeFileSync(join(d, 'untracked.txt'), 'u');
    await new GitStorage(d).write('tasks/a.md', 'a');
    expect(git(d, 'show', '--name-only', '--format=', 'HEAD').trim()).toBe('tasks/a.md');
    expect(readFileSync(join(d, 'README.md'), 'utf8')).toBe('dirty');
    expect(git(d, 'status', '--porcelain')).toContain('A  staged.txt');
    expect(existsSync(join(d, 'untracked.txt'))).toBe(true);
  });

  // @req FR:storage-git/git.exec
  it('handles shell metacharacters in commit messages literally', async () => {
    const d = freshRepo(); const s = new GitStorage(d);
    await s.write('tasks/a.md', 'a', { message: 'x"; touch pwned; "$(id)' });
    expect(existsSync(join(d, 'pwned'))).toBe(false);
    expect(git(d, 'log', '-1', '--format=%s').trim()).toBe('x"; touch pwned; "$(id)');
  });
});

describe('GitStorage with remote', () => {
  // @req FR:storage-git/git.remote
  it('pushes the commit to the remote', async () => {
    const { bare, a } = remoteSetup();
    await new GitStorage(a, { remote: 'origin', branch: 'main' }).write('tasks/a.md', 'a');
    expect(git(bare, 'show', 'main:tasks/a.md')).toBe('a');
  });

  it('syncs remote changes to other files before writing', async () => {
    const { bare, a, b } = remoteSetup();
    await new GitStorage(a, { remote: 'origin', branch: 'main' }).write('tasks/a.md', 'a');
    await new GitStorage(b, { remote: 'origin', branch: 'main' }).write('tasks/b.md', 'b');
    expect(git(bare, 'show', 'main:tasks/a.md')).toBe('a');
    expect(git(bare, 'show', 'main:tasks/b.md')).toBe('b');
    expect(git(b, 'status', '--porcelain')).toBe('');
  });

  // @req FR:storage-git/git.push-retry
  it('retries push when the remote moved after the sync', async () => {
    const { bare, a, b } = remoteSetup();
    const sa = new GitStorage(a, { remote: 'origin', branch: 'main' });
    const sb = new GitStorage(b, { remote: 'origin', branch: 'main' });
    await sa.write('tasks/seed.md', 's');
    await sb.sync();
    // a pushes between b's sync and b's push via hook point
    sb.beforePush = async () => { sb.beforePush = undefined; await sa.write('tasks/a2.md', 'a2'); };
    await sb.write('tasks/b2.md', 'b2');
    expect(git(bare, 'show', 'main:tasks/a2.md')).toBe('a2');
    expect(git(bare, 'show', 'main:tasks/b2.md')).toBe('b2');
  });

  // @req FR:storage-git/git.conflict
  it('throws ConflictError when remote changed the same file since read', async () => {
    const { bare, a, b } = remoteSetup();
    const sa = new GitStorage(a, { remote: 'origin', branch: 'main' });
    const sb = new GitStorage(b, { remote: 'origin', branch: 'main' });
    const w = await sa.write('tasks/x.md', 'v1');
    await sb.sync(); const r = await sb.read('tasks/x.md');
    expect(r.version).toBe(w.version);
    await sa.write('tasks/x.md', 'v2-from-a', { expectedVersion: w.version });
    await expect(sb.write('tasks/x.md', 'v2-from-b', { expectedVersion: r.version })).rejects.toBeInstanceOf(ConflictError);
    expect(git(bare, 'show', 'main:tasks/x.md')).toBe('v2-from-a');
    expect(git(b, 'status', '--porcelain')).toBe('');
    expect(readFileSync(join(b, 'tasks', 'x.md'), 'utf8')).toBe('v2-from-a');
  });

  it('aborts rebase, drops own commit and stays clean on a true rebase conflict', async () => {
    const { bare, a, b } = remoteSetup();
    const sa = new GitStorage(a, { remote: 'origin', branch: 'main' });
    const sb = new GitStorage(b, { remote: 'origin', branch: 'main' });
    await sa.write('tasks/x.md', 'base');
    await sb.sync();
    // no expectedVersion: b blindly writes; a changes the file between b's sync and push
    sb.beforePush = async () => { sb.beforePush = undefined; await sa.write('tasks/x.md', 'from-a'); };
    await expect(sb.write('tasks/x.md', 'from-b')).rejects.toBeInstanceOf(ConflictError);
    expect(git(bare, 'show', 'main:tasks/x.md')).toBe('from-a');
    expect(git(b, 'status', '--porcelain')).toBe('');
    expect(existsSync(join(b, '.git', 'rebase-merge'))).toBe(false);
    expect(git(b, 'rev-parse', 'HEAD')).toBe(git(b, 'rev-parse', 'origin/main'));
  });

  // @req FR:storage-git/git.push-retry @req FR:storage-git/git.isolation
  it('gives up after 3 push attempts, drops its commit, keeps staged files', async () => {
    const { bare, a, b } = remoteSetup();
    const sa = new GitStorage(a, { remote: 'origin', branch: 'main' });
    const sb = new GitStorage(b, { remote: 'origin', branch: 'main' });
    await sa.write('tasks/seed.md', 's'); await sb.sync();
    writeFileSync(join(b, 'staged.txt'), 'st'); git(b, 'add', 'staged.txt');
    let n = 0;
    sb.beforePush = async () => { await sa.write(`tasks/r${++n}.md`, 'r'); };
    await expect(sb.write('tasks/mine.md', 'm')).rejects.toBeInstanceOf(ConflictError);
    expect(n).toBe(3);
    expect(() => git(bare, 'show', 'main:tasks/mine.md')).toThrow();
    expect(existsSync(join(b, 'tasks', 'mine.md'))).toBe(false);
    expect(git(b, 'status', '--porcelain')).toBe('A  staged.txt\n');
    expect(git(b, 'rev-parse', 'HEAD')).toBe(git(b, 'rev-parse', 'origin/main'));
  });

  // @req FR:storage-git/git.conflict @req FR:storage-git/git.isolation
  it('keeps staged files and leaves no dirty diffs when dropping after a retry rebase moved HEAD', async () => {
    const { bare, a, b } = remoteSetup();
    const sa = new GitStorage(a, { remote: 'origin', branch: 'main' });
    const sb = new GitStorage(b, { remote: 'origin', branch: 'main' });
    await sa.write('tasks/x.md', 'base'); await sb.sync();
    writeFileSync(join(b, 'staged.txt'), 'st'); git(b, 'add', 'staged.txt');
    let n = 0;
    sb.beforePush = async () => {
      if (++n === 1) await sa.write('tasks/other.md', 'o'); // retry rebase succeeds, HEAD moves
      else { sb.beforePush = undefined; await sa.write('tasks/x.md', 'from-a'); } // then true conflict
    };
    await expect(sb.write('tasks/x.md', 'from-b')).rejects.toBeInstanceOf(ConflictError);
    expect(git(bare, 'show', 'main:tasks/x.md')).toBe('from-a');
    expect(git(b, 'status', '--porcelain')).toBe('A  staged.txt\n');
    expect(git(b, 'rev-parse', 'HEAD')).toBe(git(b, 'rev-parse', 'origin/main'));
    expect(readFileSync(join(b, 'tasks', 'x.md'), 'utf8')).toBe('from-a');
  });

  // @req FR:storage-git/git.failure
  it('reports an autostash pop conflict instead of success', async () => {
    const { a, b } = remoteSetup();
    const sa = new GitStorage(a, { remote: 'origin', branch: 'main' });
    const sb = new GitStorage(b, { remote: 'origin', branch: 'main' });
    await sa.write('tasks/d.md', 'base\n'); await sb.sync();
    writeFileSync(join(b, 'tasks', 'd.md'), 'dirty\n');
    await sa.write('tasks/d.md', 'remote\n');
    await expect(sb.write('tasks/o.md', 'o')).rejects.toBeInstanceOf(StorageError);
    expect(readFileSync(join(b, 'tasks', 'd.md'), 'utf8')).toBe('remote\n'); // no conflict markers
    expect(git(b, 'stash', 'list')).toContain('stack-storage-sync'); // user's change kept
  });

  // @req FR:storage-git/git.isolation
  it('keeps staged and unstaged changes across a remote sync', async () => {
    const { a, b } = remoteSetup();
    const sa = new GitStorage(a, { remote: 'origin', branch: 'main' });
    const sb = new GitStorage(b, { remote: 'origin', branch: 'main' });
    await sb.sync();
    writeFileSync(join(b, 'staged.txt'), 'st'); git(b, 'add', 'staged.txt');
    writeFileSync(join(b, 'README.md'), 'dirty');
    writeFileSync(join(b, 'both.txt'), '1'); git(b, 'add', 'both.txt'); writeFileSync(join(b, 'both.txt'), '2');
    await sa.write('tasks/r.md', 'r');
    await sb.sync();
    expect(existsSync(join(b, 'tasks', 'r.md'))).toBe(true);
    expect(git(b, 'status', '--porcelain').split('\n').sort().join('|')).toBe('| M README.md|A  staged.txt|AM both.txt');
    expect(git(b, 'stash', 'list')).toBe('');
  });

  // @req FR:storage-git/git.failure
  it('throws StorageError (not ConflictError) for non-rejection push failures and drops the commit', async () => {
    const { bare, b } = remoteSetup();
    writeFileSync(join(bare, 'hooks', 'pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
    const sb = new GitStorage(b, { remote: 'origin', branch: 'main' });
    let pushes = 0;
    sb.beforePush = async () => { pushes++; };
    const err = await sb.write('tasks/m.md', 'm').catch(e => e);
    expect(err).toBeInstanceOf(StorageError);
    expect(err).not.toBeInstanceOf(ConflictError);
    expect(pushes).toBe(1); // no retries
    expect(git(b, 'rev-parse', 'HEAD')).toBe(git(b, 'rev-parse', 'origin/main'));
    expect(existsSync(join(b, 'tasks', 'm.md'))).toBe(false);
    expect(git(b, 'status', '--porcelain')).toBe('');
  });

  // @req FR:storage-git/git.conflict
  it('reports the ConflictError even when the post-drop resync cannot restore local changes', async () => {
    const { a, b } = remoteSetup();
    const sa = new GitStorage(a, { remote: 'origin', branch: 'main' });
    const sb = new GitStorage(b, { remote: 'origin', branch: 'main' });
    await sa.write('tasks/x.md', 'base'); await sa.write('tasks/d.md', 'base\n'); await sb.sync();
    writeFileSync(join(b, 'tasks', 'd.md'), 'dirty\n');
    sb.beforePush = async () => { sb.beforePush = undefined; await sa.write('tasks/x.md', 'from-a'); await sa.write('tasks/d.md', 'remote\n'); };
    await expect(sb.write('tasks/x.md', 'from-b')).rejects.toBeInstanceOf(ConflictError);
  });

  // @req FR:storage-git/git.failure
  it('does not treat non-conflict rebase failures as conflicts', async () => {
    const { a, b } = remoteSetup();
    const sa = new GitStorage(a, { remote: 'origin', branch: 'main' });
    const sb = new GitStorage(b, { remote: 'origin', branch: 'main' });
    await sa.write('tasks/x.md', 'x');
    writeFileSync(join(b, '.git', 'index.lock'), '');
    const err = await sb.write('tasks/y.md', 'y').catch(e => e);
    expect(err).toBeInstanceOf(StorageError);
    expect(err).not.toBeInstanceOf(ConflictError);
  });
});
