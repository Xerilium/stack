import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { GitStorage } from '../../src/core/storage-git';
import { BatchedGitStorage } from '../../src/core/storage-batch';
import { startStoreSync } from '../../src/core/store-sync';
import { cleanLiveRepos, cloneLive, commit, git, GIT_ENV, liveRepos as setup, LIVE_OPTS as OPTS, pushMain, put } from '../helpers/live-repo';

jest.setTimeout(30000);
afterAll(cleanLiveRepos);

const head = (d: string) => git(d, 'rev-parse', 'HEAD').trim();
const status = (d: string) => git(d, 'status', '--porcelain').replace(/\n$/, '');
const read = (d: string, f: string) => readFileSync(join(d, f), 'utf8');
const parents = (d: string, ref = 'HEAD') => git(d, 'rev-list', '--parents', '-n', '1', ref).trim().split(' ').length - 1;
const merging = (d: string) => existsSync(join(d, '.git', 'MERGE_HEAD'));

describe('GitStorage.mergeFrom', () => {
  // @req FR:store-sync/merge.run @req FR:store-sync/merge.push @req FR:store-sync/merge.behind @req FR:store-sync/$drift-state
  it('clean merge: brings main in with a merge commit, no rebase, and pushes the live branch', async () => {
    const r = setup();
    commit(r.live, 'tasks/a.md', 'A-live\n', 'Stack: done 1');
    git(r.live, 'push', '-q', 'origin', 'stack/live');
    const mine = head(r.live);
    pushMain(r, 'tasks/b.md', 'B-main\n'); pushMain(r, 'tasks/c.md', 'C\n');
    const s = new GitStorage(r.live, OPTS);
    expect(await s.drift('main')).toMatchObject({ base: 'origin/main', state: 'behind', behind: 2, files: [] });
    expect(head(r.live)).toBe(mine);
    const st = await s.mergeFrom('main');
    expect(st).toMatchObject({ base: 'origin/main', state: 'merged', behind: 0, files: [] });
    expect(typeof st!.at).toBe('string');
    expect(read(r.live, 'tasks/a.md')).toBe('A-live\n');
    expect(read(r.live, 'tasks/b.md')).toBe('B-main\n');
    expect(read(r.live, 'tasks/c.md')).toBe('C\n');
    expect(parents(r.live)).toBe(2);
    git(r.live, 'merge-base', '--is-ancestor', mine, 'HEAD'); // our commit kept, not rewritten
    expect(git(r.bare, 'rev-parse', 'stack/live').trim()).toBe(head(r.live));
    expect(status(r.live)).toBe('');
    expect(await s.drift('main')).toMatchObject({ state: 'ok', behind: 0 });
  });

  // @req FR:store-sync/merge.run.keep
  it('app-written files stay: uncommitted and untracked files main did not touch survive the merge', async () => {
    const r = setup();
    put(r.live, 'tasks/a.md', 'A-pending\n');
    put(r.live, 'tasks/.stack/inbox/x.md', 'ask\n');
    put(r.live, 'tasks/notes.md', 'note\n');
    pushMain(r, 'tasks/b.md', 'B-main\n');
    const before = status(r.live);
    const st = await new GitStorage(r.live, OPTS).mergeFrom('main');
    expect(st).toMatchObject({ state: 'merged', behind: 0 });
    expect(read(r.live, 'tasks/b.md')).toBe('B-main\n');
    expect(read(r.live, 'tasks/a.md')).toBe('A-pending\n');
    expect(read(r.live, 'tasks/.stack/inbox/x.md')).toBe('ask\n');
    expect(read(r.live, 'tasks/notes.md')).toBe('note\n');
    expect(status(r.live)).toBe(before);
  });

  // @req FR:store-sync/merge.dirty.staged
  it('blocked: a staged file stops the merge (git needs the index to match HEAD) and stays staged', async () => {
    const r = setup();
    put(r.live, 'tasks/a.md', 'A-staged\n');
    git(r.live, 'add', '--', 'tasks/a.md');
    pushMain(r, 'tasks/b.md', 'B-main\n');
    const was = head(r.live); const before = status(r.live);
    expect(await new GitStorage(r.live, OPTS).mergeFrom('main')).toMatchObject({ state: 'blocked', files: ['tasks/a.md'] });
    expect(head(r.live)).toBe(was);
    expect(status(r.live)).toBe(before);
  });

  // @req FR:store-sync/merge.run.keep @req FR:store-sync/merge.live
  it('a pending batch survives the merge and its flush keeps the merge commit', async () => {
    const r = setup();
    const s = new BatchedGitStorage(r.live, { ...OPTS, idleMs: 60_000 });
    await s.write('tasks/a.md', 'A-app\n', { message: 'Complete: A' });
    pushMain(r, 'tasks/b.md', 'B-main\n');
    // The cloud host pushes to stack/live too: the merge brings that in first, so its push lands.
    const other = cloneLive(r, 'other');
    commit(other, 'tasks/d.md', 'D\n'); git(other, 'push', '-q', 'origin', 'stack/live');
    const st = await s.mergeFrom('main');
    expect(st).toMatchObject({ state: 'merged' });
    expect(st!.message).toBeUndefined(); // the push after the merge is a fast-forward
    expect(read(r.live, 'tasks/a.md')).toBe('A-app\n');
    expect(s.pending().count).toBe(1);
    await s.flush();
    await s.close();
    expect(git(r.bare, 'show', 'stack/live:tasks/a.md')).toBe('A-app\n');
    expect(git(r.bare, 'show', 'stack/live:tasks/b.md')).toBe('B-main\n');
    expect(git(r.bare, 'show', 'stack/live:tasks/d.md')).toBe('D\n');
    expect(git(r.bare, 'rev-list', '--merges', '--count', 'stack/live').trim()).toBe('1');
    git(r.bare, 'merge-base', '--is-ancestor', 'main', 'stack/live');
  });

  // @req FR:store-sync/merge.check @req FR:store-sync/merge.check.conflict
  it('conflict: answers the files, starts no merge, and leaves the tree unchanged', async () => {
    const r = setup();
    commit(r.live, 'tasks/b.md', 'B-live\n');
    put(r.live, 'tasks/.stack/inbox/x.md', 'ask\n');
    pushMain(r, 'tasks/b.md', 'B-main\n'); pushMain(r, 'tasks/c.md', 'C\n');
    const was = head(r.live); const before = status(r.live);
    const s = new GitStorage(r.live, OPTS);
    expect(await s.mergeFrom('main')).toMatchObject({ state: 'conflict', behind: 2, files: ['tasks/b.md'] });
    expect(head(r.live)).toBe(was);
    expect(status(r.live)).toBe(before);
    expect(merging(r.live)).toBe(false);
    expect(read(r.live, 'tasks/b.md')).toBe('B-live\n');
    expect(read(r.live, 'tasks/.stack/inbox/x.md')).toBe('ask\n');
  });

  // @req FR:store-sync/merge.dirty
  it('blocked: an uncommitted file main also changed stops the merge and stays as it is', async () => {
    const r = setup();
    put(r.live, 'tasks/b.md', 'B-unsaved\n');
    pushMain(r, 'tasks/b.md', 'B-main\n');
    const was = head(r.live);
    expect(await new GitStorage(r.live, OPTS).mergeFrom('main')).toMatchObject({ state: 'blocked', behind: 1, files: ['tasks/b.md'] });
    expect(head(r.live)).toBe(was);
    expect(read(r.live, 'tasks/b.md')).toBe('B-unsaved\n');
  });

  // @req FR:store-sync/merge.dirty
  it('blocked: an untracked file main adds stops the merge and stays as it is', async () => {
    const r = setup();
    put(r.live, 'tasks/c.md', 'C-app\n');
    pushMain(r, 'tasks/c.md', 'C-main\n');
    expect(await new GitStorage(r.live, OPTS).mergeFrom('main')).toMatchObject({ state: 'blocked', files: ['tasks/c.md'] });
    expect(read(r.live, 'tasks/c.md')).toBe('C-app\n');
  });

  // @req FR:store-sync/merge.fetch.offline
  it('no network: changes nothing and answers offline with the last known count', async () => {
    const r = setup();
    pushMain(r, 'tasks/b.md', 'B-main\n');
    const s = new GitStorage(r.live, OPTS);
    expect(await s.drift('main')).toMatchObject({ state: 'behind', behind: 1 }); // fetched once
    git(r.live, 'remote', 'set-url', 'origin', join(r.root, 'gone.git'));
    const was = head(r.live);
    const st = await s.mergeFrom('main');
    expect(st).toMatchObject({ state: 'offline', behind: 1, files: [] });
    expect(head(r.live)).toBe(was);
    expect(status(r.live)).toBe('');
  });

  // @req FR:store-sync/merge.ok
  it('in sync: ok and nothing changes', async () => {
    const r = setup();
    const was = head(r.live);
    expect(await new GitStorage(r.live, OPTS).mergeFrom('main')).toMatchObject({ state: 'ok', behind: 0 });
    expect(head(r.live)).toBe(was);
  });

  // @req FR:store-sync/merge.skip
  it('no remote, or the live branch is the base: null', async () => {
    const r = setup();
    expect(await new GitStorage(r.live, { branch: 'stack/live', env: GIT_ENV }).mergeFrom('main')).toBeNull();
    expect(await new GitStorage(r.main, { remote: 'origin', branch: 'main', env: GIT_ENV }).drift('main')).toBeNull();
  });

  // @req FR:store-sync/merge.fetch
  it('drift without fetch reads the last fetched ref only', async () => {
    const r = setup();
    pushMain(r, 'tasks/b.md', 'B-main\n');
    expect(await new GitStorage(r.live, OPTS).drift('main', { fetch: false })).toMatchObject({ state: 'ok', behind: 0 });
  });
});

describe('startStoreSync', () => {
  // @req FR:store-sync/host.start @req FR:store-sync/host.event @req FR:store-sync/host.@function
  it('ticks at start, keeps the last state, and tells onState', async () => {
    const r = setup();
    pushMain(r, 'tasks/b.md', 'B-main\n');
    const seen: string[] = [];
    const loop = startStoreSync(new GitStorage(r.live, OPTS), { intervalMs: 60_000, onState: (s) => seen.push(s.state) });
    try {
      const st = await loop.tick();
      expect(st).toMatchObject({ state: expect.stringMatching(/merged|ok/) });
      expect(read(r.live, 'tasks/b.md')).toBe('B-main\n');
      expect(loop.state()).toMatchObject({ behind: 0 });
      expect(seen.length).toBeGreaterThan(0);
    } finally { await loop.stop(); }
  });

  // @req FR:store-sync/host.flush
  it('blocked by a pending batch: flushes, then merges', async () => {
    const r = setup();
    const s = new BatchedGitStorage(r.live, { ...OPTS, idleMs: 60_000 });
    await s.write('tasks/b.md', 'B-app\n', { message: 'Complete: B' });
    pushMain(r, 'tasks/c.md', 'C\n');
    commit(r.main, 'tasks/a.md', 'A-main\n'); git(r.main, 'push', '-q', 'origin', 'main');
    // main also edits b.md: blocked while pending, a real conflict once the batch is committed.
    commit(r.main, 'tasks/b.md', 'B0\nmain line\n'); git(r.main, 'push', '-q', 'origin', 'main');
    const loop = startStoreSync(s, { intervalMs: 60_000 });
    try {
      const st = await loop.tick();
      expect(s.pending().count).toBe(0); // flushed
      expect(st).toMatchObject({ state: 'conflict', files: ['tasks/b.md'] });
      expect(read(r.live, 'tasks/b.md')).toContain('B-app');
    } finally { await loop.stop(); await s.close(); }
  });

  // @req FR:store-sync/host.errors
  it('a throwing tick answers error and the loop keeps going', async () => {
    let n = 0;
    const fake = { mergeFrom: async () => { n++; if (n === 1) throw new Error('lock busy'); return { base: 'origin/main', state: 'ok' as const, behind: 0, files: [], at: new Date().toISOString() }; } };
    const loop = startStoreSync(fake, { intervalMs: 60_000 });
    try {
      expect(await loop.tick()).toMatchObject({ state: 'error', message: 'lock busy' });
      expect(await loop.tick()).toMatchObject({ state: 'ok' });
    } finally { await loop.stop(); }
  });
});
