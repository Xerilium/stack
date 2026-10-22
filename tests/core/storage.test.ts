import { execFileSync } from 'child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  Storage, MemoryStorage, FsStorage, NotFoundError, ConflictError, PathError, versionOf,
} from '../../src/core/storage';
import { GitStorage } from '../../src/core/storage-git';

jest.setTimeout(60000);
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
/** Bare remote + two clones with an initial commit. */
const remoteSetup = () => {
  const root = tmp();
  const bare = join(root, 'remote.git');
  mkdirSync(bare); git(bare, 'init', '-q', '--bare', '-b', 'main');
  const seed = join(root, 'seed'); mkdirSync(seed); initRepo(seed);
  writeFileSync(join(seed, 'README.md'), 'x'); git(seed, 'add', '.'); git(seed, 'commit', '-q', '-m', 'init');
  git(seed, 'remote', 'add', 'origin', bare); git(seed, 'push', '-q', 'origin', 'main');
  const clone = (n: string) => {
    const d = join(root, n);
    git(root, 'clone', '-q', bare, n);
    git(d, 'config', 'user.name', 'T'); git(d, 'config', 'user.email', 't@t.t'); git(d, 'config', 'commit.gpgsign', 'false');
    return d;
  };
  return { bare, a: clone('a'), b: clone('b') };
};

const adapters: [string, () => Storage][] = [
  ['MemoryStorage', () => new MemoryStorage()],
  ['FsStorage', () => new FsStorage(tmp())],
  ['GitStorage', () => { const d = tmp(); initRepo(d); return new GitStorage(d); }],
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
  it.each(['/etc/x.md', '../x.md', 'tasks/../x.md', 'tasks\\x.md', 'tasks/x.txt', 'other/x.md', 'tasks/a/b.md', 'tasks/\0.md', '.git/config'])(
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
    const d = tmp(); initRepo(d); const s = new GitStorage(d);
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
    const d = tmp(); initRepo(d); const s = new GitStorage(d);
    await s.write('tasks/a.md', 'a'); await s.write('tasks/a.md', 'a');
    expect(git(d, 'rev-list', '--count', 'HEAD').trim()).toBe('1');
  });

  // @req FR:storage-git/git.isolation
  it('does not commit or lose unrelated dirty and staged files', async () => {
    const d = tmp(); initRepo(d);
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
    const d = tmp(); initRepo(d); const s = new GitStorage(d);
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
});
