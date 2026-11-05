import { execFileSync } from 'child_process';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createTokenService } from '../../src/api';
import { MemoryStorage, FsStorage } from '../../src/core/storage';
import { GitStorage } from '../../src/core/storage-git';
import { GitTokenStore, TOKEN_PATH } from '../../src/host';

// Real git subprocesses: cost scales with machine load, so the budget matches storage-batch.test.ts.
jest.setTimeout(30000);
const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8', env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' } });

/** A bare origin holding one commit on main; two git calls, no clone-and-push dance. */
function originWithCommit(dir: string): string {
  const seed = join(dir, 'seed');
  g(dir, 'init', '-q', '-b', 'main', seed);
  g(seed, 'commit', '-q', '--allow-empty', '-m', 'init');
  const bare = join(dir, 'origin.git');
  g(dir, 'clone', '-q', '--bare', seed, bare);
  return bare;
}

describe('azure-host git token store', () => {
  /** @req FR:azure-host/tokens.git */
  it('works over any storage with state files (memory)', async () => {
    const mem = new MemoryStorage();
    const svc = createTokenService({ store: new GitTokenStore(async () => mem) });
    const { token } = await svc.create({ name: 'a', scopes: ['read'] });
    const again = createTokenService({ store: new GitTokenStore(async () => mem) });
    expect(await again.verify(token)).not.toBeNull();
  });

  /** @req FR:azure-host/tokens.git */
  it('persists hashes (never secrets) as a commit in the data repo and survives a new clone', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stack-tok-'));
    try {
      const bare = originWithCommit(dir);

      const clone = async (n: string) => {
        const c = join(dir, n);
        g(dir, 'clone', '-q', '-c', 'user.name=Stack', '-c', 'user.email=s@x', bare, c);
        return new GitStorage(c, { remote: 'origin', branch: 'main' });
      };
      const a = await clone('a');
      const svc = createTokenService({ store: new GitTokenStore(async () => a), pepper: 'p' });
      const made = await svc.create({ name: "a", scopes: ["read"] });
      const { token } = made; const id = made.record.id;

      const stored = g(bare, 'show', `main:${TOKEN_PATH}`);
      expect(stored).not.toContain(token.split('.')[1]);
      expect(g(bare, 'log', '--format=%s', '-1')).toContain(TOKEN_PATH);

      const b = await clone('b'); // cold start
      const svc2 = createTokenService({ store: new GitTokenStore(async () => b), pepper: 'p' });
      expect(await svc2.verify(token)).not.toBeNull();
      let t = 0;
      const svc3 = createTokenService({ store: new GitTokenStore(async () => a, { syncMs: 1000, now: () => t }), pepper: "p" });
      expect(await svc3.verify(token)).not.toBeNull();
      expect(await svc2.revoke(id)).toBe("revoked");
      t = 500;
      expect(await svc3.verify(token)).not.toBeNull(); // no sync yet: stale by design
      t = 1500;
      expect(await svc3.verify(token)).toBeNull(); // synced: revocation seen
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  /** @req FR:azure-host/tokens.git */
  it('rejects bad state paths and keeps them out of the task list', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stack-fs-'));
    try {
      const fs = new FsStorage(dir);
      await expect(fs.writeAux('tasks/x.md', 'x', { expectedVersion: null })).rejects.toThrow();
      await expect(fs.writeAux('../x.json', 'x', { expectedVersion: null })).rejects.toThrow();
      await expect(new MemoryStorage().readAux('.stack/../a.json')).rejects.toThrow();
      await fs.writeAux('.stack/tokens.json', '{}', { expectedVersion: null });
      expect(await fs.list()).toEqual([]);
      await expect(fs.writeAux('.stack/tokens.json', '{}', { expectedVersion: null })).rejects.toThrow();
      expect((await fs.readAux('.stack/tokens.json'))?.content).toBe('{}');
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  /** @req FR:azure-host/tokens.git */
  it('a failed sync keeps serving local data and reports the class name only', async () => {
    const mem = Object.assign(new MemoryStorage(), { sync: async () => { throw new TypeError('secret detail'); } });
    const seen: string[] = [];
    const store = new GitTokenStore(async () => mem, { onError: (n) => seen.push(n) });
    expect(await store.read()).toBeNull();
    expect(seen).toEqual(['TypeError']);
  });
});

describe('azure-host sync is serialized with writes', () => {
  /** @req FR:azure-host/tokens.git */
  it('sync waits for an in-flight write instead of interleaving', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'stack-q-'));
    try {
      const bare = originWithCommit(dir);
      const w = join(dir, 'w');
      g(dir, 'clone', '-q', '-c', 'user.name=S', '-c', 'user.email=s@x', bare, w);
      const st = new GitStorage(w, { remote: 'origin', branch: 'main' });
      // Count the git commands the storage starts, so "sync did not run" is observed, not guessed with a sleep.
      const gitCalls: string[] = [];
      const host = st as unknown as { git: (...a: string[]) => Promise<string> };
      const realGit = host.git.bind(st);
      host.git = (...a) => { gitCalls.push(a[0]); return realGit(...a); };
      const order: string[] = [];
      let release!: () => void;
      let midPush!: () => void;
      const reachedPush = new Promise<void>((r) => { midPush = r; });
      st.beforePush = () => new Promise<void>((r) => { order.push('push-wait'); release = r; midPush(); });
      const write = st.writeAux(TOKEN_PATH, '{}', { expectedVersion: null }).then(() => order.push('write-done'));
      await reachedPush;
      const before = gitCalls.length;
      const sync = st.sync().then(() => order.push('sync-done'));
      await new Promise((r) => setImmediate(r)); // every microtask a non-queued sync would use has run
      expect(gitCalls.length).toBe(before); // sync has not started any git work while the write is mid-push
      expect(order).toEqual(['push-wait']);
      release();
      await Promise.all([write, sync]);
      expect(order).toEqual(['push-wait', 'write-done', 'sync-done']);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
