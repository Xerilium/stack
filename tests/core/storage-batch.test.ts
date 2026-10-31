import { execFileSync } from 'child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ConflictError, StorageError, versionOf } from '../../src/core/storage';
import { BatchedGitStorage, batchSummary } from '../../src/core/storage-batch';

jest.setTimeout(30000);
const savedEnv = { g: process.env.GIT_CONFIG_GLOBAL, s: process.env.GIT_CONFIG_SYSTEM };
beforeAll(() => { process.env.GIT_CONFIG_GLOBAL = '/dev/null'; process.env.GIT_CONFIG_SYSTEM = '/dev/null'; });
afterAll(() => {
  for (const [k, v] of [['GIT_CONFIG_GLOBAL', savedEnv.g], ['GIT_CONFIG_SYSTEM', savedEnv.s]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});
const dirs: string[] = [];
const tmp = () => { const d = mkdtempSync(join(tmpdir(), 'stack-batch-')); dirs.push(d); return d; };
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const git = (cwd: string, ...a: string[]) =>
  execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' } });
const initRepo = (dir: string) => {
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.name', 'T'); git(dir, 'config', 'user.email', 't@t.t'); git(dir, 'config', 'commit.gpgsign', 'false');
};
let repoTpl: string;
let remoteTpl: string;
beforeAll(() => {
  repoTpl = tmp(); initRepo(repoTpl);
  mkdirSync(join(repoTpl, 'tasks')); writeFileSync(join(repoTpl, 'tasks/a.md'), 'A0'); writeFileSync(join(repoTpl, 'README.md'), 'r');
  git(repoTpl, 'add', '.'); git(repoTpl, 'commit', '-q', '-m', 'init');
  remoteTpl = tmp();
  const bare = join(remoteTpl, 'remote.git');
  mkdirSync(bare); git(bare, 'init', '-q', '--bare', '-b', 'main');
  const seed = join(remoteTpl, 'seed'); mkdirSync(seed); initRepo(seed);
  mkdirSync(join(seed, 'tasks')); writeFileSync(join(seed, 'tasks/a.md'), 'A0'); git(seed, 'add', '.'); git(seed, 'commit', '-q', '-m', 'init');
  git(seed, 'remote', 'add', 'origin', bare); git(seed, 'push', '-q', 'origin', 'main');
  for (const n of ['a', 'b']) {
    git(remoteTpl, 'clone', '-q', bare, n);
    const d = join(remoteTpl, n);
    git(d, 'config', 'user.name', 'T'); git(d, 'config', 'user.email', 't@t.t'); git(d, 'config', 'commit.gpgsign', 'false');
  }
});
const freshRepo = () => { const d = tmp(); cpSync(repoTpl, d, { recursive: true }); return d; };
const remoteSetup = () => {
  const root = tmp();
  cpSync(remoteTpl, root, { recursive: true });
  for (const n of ['a', 'b']) {
    const cfg = join(root, n, '.git', 'config');
    writeFileSync(cfg, readFileSync(cfg, 'utf8').split(remoteTpl).join(root));
  }
  return { bare: join(root, 'remote.git'), a: join(root, 'a'), b: join(root, 'b') };
};
const commits = (d: string, ref = 'HEAD') => git(d, 'log', '--format=%s', ref).trim().split('\n');
const status = (d: string) => git(d, 'status', '--porcelain').replace(/\n$/, '');
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const IDLE = 60_000;

describe('batchSummary', () => {
  // @req FR:storage-git/batch.flush.subject @req FR:storage-git/batch.flush.body
  it('turns the pending messages into one subject (verbs in first-seen order) and a body', () => {
    const m = batchSummary(['Complete: Ship it', 'Suspended until Nov 3: Call mom', 'Complete: Write docs', 'Add task: New row']);
    expect(m.split('\n')[0]).toBe('Stack: done 2, deferred 1, added 1');
    expect(m.split('\n')[1]).toBe('');
    expect(m.split('\n').slice(2)).toEqual(['Complete: Ship it', 'Suspended until Nov 3: Call mom', 'Complete: Write docs', 'Add task: New row']);
  });
  // @req FR:storage-git/batch.flush.subject
  it('knows every core verb and counts the rest as other', () => {
    expect(batchSummary(['Edit: z', 'Move: w', 'Note: n', 'Start: s', 'Park: p', 'Resume: r', 'Update: u', 'Remove: x', 'Roll: y', 'Due Nov 3: d', 'Ask answered: k', 'Add project: beta', 'Session run: x']).split('\n')[0])
      .toBe('Stack: edited 1, moved 1, noted 1, started 1, parked 1, resumed 1, updated 1, removed 1, rolled 1, due 1, asked 1, added 1, other 1');
  });
  // @req FR:storage-git/batch.flush.subject
  it('falls back to a plain count when no verb is recognized', () => {
    expect(batchSummary(['Weird message', 'Another']).split('\n')[0]).toBe('Stack: 2 changes');
    expect(batchSummary(['Update tasks/a.md']).split('\n')[0]).toBe('Stack: 1 change');
  });
});

describe('BatchedGitStorage writes', () => {
  // @req FR:storage-git/batch.@function @req FR:storage-git/batch.write @req FR:storage-git/batch.reads
  it('writes the file at once, commits nothing, and reads see the pending content', async () => {
    const d = freshRepo();
    const s = new BatchedGitStorage(d, { idleMs: IDLE });
    try {
      const before = commits(d);
      const r = await s.write('tasks/a.md', 'A1', { message: 'Complete: a' });
      expect(r.version).toBe(versionOf('A1'));
      expect(readFileSync(join(d, 'tasks/a.md'), 'utf8')).toBe('A1');
      expect(commits(d)).toEqual(before);
      expect((await s.read('tasks/a.md')).content).toBe('A1');
    } finally { await s.close(); }
  });

  // @req FR:storage-git/batch.pending @req FR:storage-git/$pending @req FR:storage-git/batch.write.pending @req FR:storage-git/batch.input
  it('reports what is pending: count, first time, distinct paths in order', async () => {
    const d = freshRepo();
    const s = new BatchedGitStorage(d, { idleMs: IDLE });
    try {
      expect(s.pending()).toEqual({ count: 0, since: null, paths: [] });
      const t0 = Date.now();
      await s.write('tasks/a.md', 'A1', { message: 'Complete: a' });
      await s.write('tasks/b.md', 'B', { message: 'Add task: b' });
      await s.write('tasks/a.md', 'A2', { message: 'Edit: a' });
      const p = s.pending();
      expect(p.count).toBe(3);
      expect(p.paths).toEqual(['tasks/a.md', 'tasks/b.md']);
      expect(p.since!.getTime()).toBeGreaterThanOrEqual(t0 - 5);
      expect(p.since!.getTime()).toBeLessThanOrEqual(Date.now());
    } finally { await s.close(); }
  });

  // @req FR:storage-git/batch.write.expected
  it('checks the expected version against the work tree, pending writes included, and writes nothing on a mismatch', async () => {
    const d = freshRepo();
    const s = new BatchedGitStorage(d, { idleMs: IDLE });
    try {
      await expect(s.write('tasks/a.md', 'A1', { expectedVersion: versionOf('stale') })).rejects.toBeInstanceOf(ConflictError);
      expect(readFileSync(join(d, 'tasks/a.md'), 'utf8')).toBe('A0');
      expect(s.pending().count).toBe(0);
      await expect(s.write('tasks/new.md', 'N', { expectedVersion: versionOf('x') })).rejects.toBeInstanceOf(ConflictError);
      await s.write('tasks/new.md', 'N', { expectedVersion: null }); // must not exist: ok
      await s.write('tasks/a.md', 'A1', { expectedVersion: versionOf('A0') });
      await expect(s.write('tasks/a.md', 'A2', { expectedVersion: versionOf('A0') })).rejects.toBeInstanceOf(ConflictError);
      await s.write('tasks/a.md', 'A2', { expectedVersion: versionOf('A1') });
      expect(s.pending().count).toBe(3);
    } finally { await s.close(); }
  });

  // @req FR:storage-git/batch.write.noop
  it('leaves a write that changes nothing out of the batch', async () => {
    const d = freshRepo();
    const s = new BatchedGitStorage(d, { idleMs: IDLE });
    try {
      await s.write('tasks/a.md', 'A0', { message: 'Complete: same' });
      expect(s.pending().count).toBe(0);
    } finally { await s.close(); }
  });

  // @req FR:storage-git/batch.write.many
  it('writeMany joins the batch as one write covering all of its paths, deletes included', async () => {
    const d = freshRepo();
    const s = new BatchedGitStorage(d, { idleMs: IDLE });
    try {
      await s.writeMany([{ path: 'tasks/a.md', content: null }, { path: 'tasks/c.md', content: 'C' }], { message: 'Move: a' });
      expect(s.pending()).toMatchObject({ count: 1, paths: ['tasks/a.md', 'tasks/c.md'] });
      expect(existsSync(join(d, 'tasks/a.md'))).toBe(false);
      await s.flush();
      expect(commits(d)[0]).toBe('Stack: moved 1');
      expect(git(d, 'show', '--stat', '--format=', 'HEAD')).toMatch(/tasks\/a\.md/);
      expect(git(d, 'show', '--stat', '--format=', 'HEAD')).toMatch(/tasks\/c\.md/);
    } finally { await s.close(); }
  });

  // @req FR:storage-git/batch.events
  it('tells listeners each time the pending count changes, until they unsubscribe', async () => {
    const d = freshRepo();
    const s = new BatchedGitStorage(d, { idleMs: IDLE });
    try {
      const seen: number[] = [];
      const off = s.onPending((n) => seen.push(n));
      await s.write('tasks/a.md', 'A1', { message: 'Complete: a' });
      await s.write('tasks/b.md', 'B', { message: 'Add task: b' });
      await s.flush();
      off();
      await s.write('tasks/a.md', 'A3', { message: 'Edit: a' });
      expect(seen).toEqual([1, 2, 0]);
    } finally { await s.close(); }
  });
});

describe('BatchedGitStorage flush', () => {
  // @req FR:storage-git/batch.flush @req FR:storage-git/batch.flush.output @req FR:storage-git/batch.flush.body
  it('makes one commit of the pending paths only, with the summary message, and leaves other dirty files alone', async () => {
    const d = freshRepo();
    const s = new BatchedGitStorage(d, { idleMs: IDLE });
    try {
      writeFileSync(join(d, 'README.md'), 'hand edit'); // the owner's own uncommitted change
      await s.write('tasks/a.md', 'A1', { message: 'Complete: Ship it' });
      await s.write('tasks/b.md', 'B', { message: 'Add task: New row' });
      await s.write('tasks/a.md', 'A2', { message: 'Suspended until Nov 3: Ship it' });
      const sha = await s.flush();
      expect(sha).toMatch(/^[0-9a-f]{40}$/);
      expect(git(d, 'rev-parse', 'HEAD').trim()).toBe(sha);
      expect(commits(d)[0]).toBe('Stack: done 1, added 1, deferred 1');
      expect(git(d, 'log', '-1', '--format=%b').trim().split('\n')).toEqual(['Complete: Ship it', 'Add task: New row', 'Suspended until Nov 3: Ship it']);
      const stat = git(d, 'show', '--stat', '--format=', 'HEAD');
      expect(stat).toMatch(/tasks\/a\.md/); expect(stat).toMatch(/tasks\/b\.md/); expect(stat).not.toContain('README');
      expect(status(d)).toBe(' M README.md');
      expect(s.pending()).toEqual({ count: 0, since: null, paths: [] });
    } finally { await s.close(); }
  });

  // @req FR:storage-git/batch.flush.empty
  it('is a no-op when nothing is pending or the pending content equals HEAD', async () => {
    const d = freshRepo();
    const s = new BatchedGitStorage(d, { idleMs: IDLE });
    try {
      expect(await s.flush()).toBeNull();
      await s.write('tasks/a.md', 'A1', { message: 'Complete: a' });
      await s.write('tasks/a.md', 'A0', { message: 'Update: a' }); // back to HEAD content
      const n = commits(d).length;
      expect(await s.flush()).toBeNull();
      expect(commits(d).length).toBe(n);
      expect(s.pending().count).toBe(0);
    } finally { await s.close(); }
  });

  // @req FR:storage-git/batch.idle @req FR:storage-git/batch.idle.close
  it('flushes on its own after the idle time since the last write, and on close', async () => {
    const d = freshRepo();
    const s = new BatchedGitStorage(d, { idleMs: 1200 });
    await s.write('tasks/a.md', 'A1', { message: 'Complete: a' });
    await sleep(700);
    await s.write('tasks/b.md', 'B', { message: 'Add task: b' }); // restarts the timer
    await sleep(700);
    expect(s.pending().count).toBe(2); // 1.4 s after the first write, 0.7 after the last: not yet
    await sleep(1500);
    expect(s.pending().count).toBe(0);
    expect(commits(d)[0]).toBe('Stack: done 1, added 1');
    await s.write('tasks/a.md', 'A2', { message: 'Complete: a2' });
    await s.close(); // close flushes what is left and stops the timer
    expect(commits(d)[0]).toBe('Stack: done 1');
    await sleep(1400);
    expect(commits(d).length).toBe(3);
  });

  // @req FR:storage-git/batch.idle.zero
  it('idleMs 0 commits every write on its own', async () => {
    const d = freshRepo();
    const s = new BatchedGitStorage(d, { idleMs: 0 });
    try {
      await s.write('tasks/a.md', 'A1', { message: 'Complete: a' });
      expect(commits(d)[0]).toBe('Stack: done 1');
      expect(s.pending().count).toBe(0);
      await s.write('tasks/b.md', 'B', { message: 'Add task: b' });
      expect(commits(d).slice(0, 2)).toEqual(['Stack: added 1', 'Stack: done 1']);
    } finally { await s.close(); }
  });

  // @req FR:storage-git/batch.idle.error
  it('reports a failed timer flush to onError and keeps the batch', async () => {
    const { a, b } = remoteSetup();
    const errors: unknown[] = [];
    const s = new BatchedGitStorage(a, { idleMs: 300, remote: 'origin', onError: (e) => errors.push(e) });
    try {
      await s.write('tasks/a.md', 'A-desk', { message: 'Complete: a' });
      writeFileSync(join(b, 'tasks/a.md'), 'A-phone'); git(b, 'commit', '-qam', 'phone'); git(b, 'push', '-q', 'origin', 'main');
      await sleep(1000);
      expect(errors.length).toBeGreaterThanOrEqual(1);
      for (const e of errors) expect(e).toBeInstanceOf(ConflictError);
      expect(s.pending().count).toBe(1);
    } finally { await s.close().catch(() => undefined); }
  });
});

describe('BatchedGitStorage with remote', () => {
  // @req FR:storage-git/batch.flush.remote
  it('commits, rebases onto what the phone pushed, and pushes the batch', async () => {
    const { a, b } = remoteSetup();
    const s = new BatchedGitStorage(a, { idleMs: IDLE, remote: 'origin' });
    try {
      await s.write('tasks/a.md', 'A1', { message: 'Complete: a' });
      writeFileSync(join(b, 'tasks/z.md'), 'Z'); git(b, 'add', '.'); git(b, 'commit', '-q', '-m', 'phone'); git(b, 'push', '-q', 'origin', 'main');
      const sha = await s.flush();
      expect(commits(a).slice(0, 2)).toEqual(['Stack: done 1', 'phone']);
      expect(git(a, 'rev-parse', 'HEAD').trim()).toBe(sha);
      expect(commits(a, 'origin/main')[0]).toBe('Stack: done 1');
      expect(readFileSync(join(a, 'tasks/z.md'), 'utf8')).toBe('Z');
      expect(status(a)).toBe('');
    } finally { await s.close(); }
  });

  // @req FR:storage-git/batch.flush.remote
  it('retries the push when the remote moves between the rebase and the push', async () => {
    const { a, b } = remoteSetup();
    const s = new BatchedGitStorage(a, { idleMs: IDLE, remote: 'origin' });
    try {
      let raced = false;
      s.beforePush = async () => {
        if (raced) return; raced = true;
        writeFileSync(join(b, 'tasks/y.md'), 'Y'); git(b, 'add', '.'); git(b, 'commit', '-q', '-m', 'phone'); git(b, 'push', '-q', 'origin', 'main');
      };
      await s.write('tasks/a.md', 'A1', { message: 'Complete: a' });
      await s.flush();
      expect(commits(a, 'origin/main').slice(0, 2)).toEqual(['Stack: done 1', 'phone']);
      expect(s.pending().count).toBe(0);
    } finally { await s.close(); }
  });

  // @req FR:storage-git/batch.failure
  it('a conflicting remote change keeps the files and the batch, leaves no commit or rebase behind, and throws ConflictError', async () => {
    const { a, b } = remoteSetup();
    const s = new BatchedGitStorage(a, { idleMs: IDLE, remote: 'origin' });
    try {
      writeFileSync(join(a, 'README.md'), 'mine'); // the owner's own (untracked) file must survive too
      await s.write('tasks/a.md', 'A-desk', { message: 'Complete: a' });
      writeFileSync(join(b, 'tasks/a.md'), 'A-phone'); git(b, 'commit', '-qam', 'phone'); git(b, 'push', '-q', 'origin', 'main');
      await expect(s.flush()).rejects.toBeInstanceOf(ConflictError);
      expect(readFileSync(join(a, 'tasks/a.md'), 'utf8')).toBe('A-desk');
      expect(readFileSync(join(a, 'README.md'), 'utf8')).toBe('mine');
      expect(s.pending().count).toBe(1);
      expect(commits(a)[0]).toBe('init');
      expect(status(a).split('\n').sort()).toEqual([' M tasks/a.md', '?? README.md']);
      expect(existsSync(join(a, '.git/rebase-merge'))).toBe(false);
    } finally { await s.close().catch(() => undefined); }
  });

  // @req FR:storage-git/batch.failure
  it('a non-rejection push failure keeps the files and the batch and throws StorageError', async () => {
    const { a } = remoteSetup();
    const s = new BatchedGitStorage(a, { idleMs: IDLE, remote: 'origin' });
    try {
      await s.write('tasks/a.md', 'A1', { message: 'Complete: a' });
      git(a, 'remote', 'set-url', '--push', 'origin', join(tmp(), 'nowhere.git'));
      const err = await s.flush().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(StorageError);
      expect(err).not.toBeInstanceOf(ConflictError);
      expect(readFileSync(join(a, 'tasks/a.md'), 'utf8')).toBe('A1');
      expect(s.pending().count).toBe(1);
      expect(commits(a)[0]).toBe('init');
    } finally { await s.close().catch(() => undefined); }
  });

  // @req FR:storage-git/batch.failure @req FR:storage-git/batch.failure.retry
  it('a fetch that throws (remote unreachable) undoes the commit, keeps the batch, and the next flush pushes once the remote is back', async () => {
    const { a, bare } = remoteSetup();
    const s = new BatchedGitStorage(a, { idleMs: IDLE, remote: 'origin' });
    try {
      await s.write('tasks/a.md', 'A1', { message: 'Complete: a' });
      git(a, 'remote', 'set-url', 'origin', join(tmp(), 'gone.git'));
      const err = await s.flush().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(StorageError);
      expect(commits(a)[0]).toBe('init'); // no commit left on HEAD
      expect(readFileSync(join(a, 'tasks/a.md'), 'utf8')).toBe('A1');
      expect(s.pending().count).toBe(1);
      git(a, 'remote', 'set-url', 'origin', bare);
      expect(await s.flush()).toMatch(/^[0-9a-f]{40}$/);
      expect(commits(a, 'origin/main')[0]).toBe('Stack: done 1');
      expect(s.pending().count).toBe(0);
    } finally { await s.close().catch(() => undefined); }
  });

  // @req FR:storage-git/batch.flush.remote.dirty
  it("never stashes the owner's own edits: remote ahead + dirty tracked file → ConflictError, commit undone, edit intact", async () => {
    const { a, b } = remoteSetup();
    const s = new BatchedGitStorage(a, { idleMs: IDLE, remote: 'origin' });
    try {
      writeFileSync(join(a, 'tasks/a.md'), 'hand edit'); // the owner's own uncommitted change to a tracked file
      await s.write('tasks/b.md', 'B', { message: 'Add task: b' });
      writeFileSync(join(b, 'tasks/z.md'), 'Z'); git(b, 'add', '.'); git(b, 'commit', '-q', '-m', 'phone'); git(b, 'push', '-q', 'origin', 'main');
      const err = await s.flush().catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ConflictError);
      expect((err as Error).message).toMatch(/uncommitted edits of its own/);
      expect(commits(a)[0]).toBe('init');
      expect(readFileSync(join(a, 'tasks/a.md'), 'utf8')).toBe('hand edit');
      expect(readFileSync(join(a, 'tasks/b.md'), 'utf8')).toBe('B');
      expect(s.pending().count).toBe(1);
      expect(git(a, 'stash', 'list').trim()).toBe('');
      // the owner commits their edit; the next flush rebases and pushes
      git(a, 'commit', '-qam', 'mine');
      expect(await s.flush()).toMatch(/^[0-9a-f]{40}$/);
      expect(commits(a, 'origin/main').slice(0, 3)).toEqual(['Stack: added 1', 'mine', 'phone']);
    } finally { await s.close().catch(() => undefined); }
  });

  // @req FR:storage-git/batch.failure.retry
  it('the next flush succeeds once the conflict is resolved', async () => {
    const { a, b } = remoteSetup();
    const s = new BatchedGitStorage(a, { idleMs: IDLE, remote: 'origin' });
    try {
      await s.write('tasks/a.md', 'A-desk', { message: 'Complete: a' });
      writeFileSync(join(b, 'tasks/a.md'), 'A-phone'); git(b, 'commit', '-qam', 'phone'); git(b, 'push', '-q', 'origin', 'main');
      await expect(s.flush()).rejects.toBeInstanceOf(ConflictError);
      // the owner takes the phone's version for that file; the next write re-checks and the flush goes through
      git(a, 'checkout', '-q', 'origin/main', '--', 'tasks/a.md');
      await s.write('tasks/b.md', 'B', { message: 'Add task: b' });
      expect(await s.flush()).toMatch(/^[0-9a-f]{40}$/);
      expect(commits(a, 'origin/main').slice(0, 2)).toEqual(['Stack: done 1, added 1', 'phone']);
      expect(s.pending().count).toBe(0);
    } finally { await s.close().catch(() => undefined); }
  });
});
