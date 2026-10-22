import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { isAbsolute, join } from 'path';
import { FsStorage, FileWrite, WriteOptions, WriteResult, ConflictError, StorageError, checkExpected, versionOf } from './storage';

export interface GitStorageOptions {
  /** Remote name; when set, writes sync before and push after. */
  remote?: string;
  branch?: string;
}

const MAX_PUSH_ATTEMPTS = 3;

/**
 * Work-tree adapter: every write is a direct commit (no PRs).
 * @req FR:storage-git/git.commit @req FR:storage-git/git.noop @req FR:storage-git/git.isolation
 * @req FR:storage-git/git.remote @req FR:storage-git/git.push-retry @req FR:storage-git/git.conflict @req FR:storage-git/write.many
 */
export class GitStorage extends FsStorage {
  /** Test seam: awaited just before each push attempt. */
  beforePush?: () => Promise<void>;
  private remote?: string;
  private branch: string;
  private branchExplicit: boolean;

  constructor(root: string, opts: GitStorageOptions = {}) {
    super(root);
    this.remote = opts.remote;
    this.branch = opts.branch ?? 'main';
    this.branchExplicit = opts.branch !== undefined;
  }

  /** @req FR:storage-git/git.exec */
  private git(...args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile('git', args, {
        cwd: this.root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true' },
      }, (err, stdout, stderr) => {
        /** @req FR:storage-git/git.failure */
        if (err) reject(new StorageError(`git ${args[0]} failed: ${(stderr || err.message).trim()}`));
        else resolve(stdout);
      });
    });
  }

  private async tryGit(...args: string[]): Promise<string | null> {
    try { return await this.git(...args); } catch { return null; }
  }

  private get ref() { return `${this.remote}/${this.branch}`; }

  private async fetch(): Promise<boolean> {
    // Explicit destination so the tracking ref exists regardless of refspec config.
    try { await this.git('fetch', '-q', this.remote!, `+refs/heads/${this.branch}:refs/remotes/${this.ref}`); } catch (e) {
      if (/couldn't find remote ref/i.test((e as Error).message)) return false;
      throw e;
    }
    return true;
  }

  private async unmerged(): Promise<boolean> {
    return ((await this.tryGit('diff', '--name-only', '--diff-filter=U')) ?? '').trim() !== '';
  }

  private async rebaseInProgress(): Promise<boolean> {
    for (const d of ['rebase-merge', 'rebase-apply']) {
      const p = (await this.tryGit('rev-parse', '--git-path', d))?.trim();
      if (p && existsSync(isAbsolute(p) ? p : join(this.root, p))) return true;
    }
    return false;
  }

  /**
   * Rebase local state onto the remote; false when it conflicted (rebase aborted).
   * Tracked local changes (staged and unstaged) are stashed and re-applied with --index so the
   * index is preserved. Other failures (lock files, hooks) and stash re-apply conflicts throw StorageError.
   */
  private async rebase(): Promise<boolean> {
    if (((await this.tryGit('rev-list', '--count', `HEAD..${this.ref}`)) ?? '1').trim() === '0') return true;
    const dirty = (await this.git('status', '--porcelain', '-uno')).trim() !== '';
    let stash: string | null = null;
    if (dirty) {
      const before = (await this.tryGit('rev-parse', '-q', '--verify', 'refs/stash'))?.trim() ?? null;
      await this.git('stash', 'push', '-q', '-m', 'stack-storage-sync');
      const after = (await this.tryGit('rev-parse', '-q', '--verify', 'refs/stash'))?.trim() ?? null;
      stash = after !== before ? after : null; // never touch a pre-existing user stash
    }
    try {
      await this.git('rebase', '-q', this.ref);
    } catch (e) {
      const conflict = await this.rebaseInProgress() || await this.unmerged();
      if (conflict) await this.tryGit('rebase', '--abort');
      if (stash) await this.applyStash(stash);
      if (conflict) return false;
      throw e;
    }
    if (stash) await this.applyStash(stash);
    return true;
  }

  /** Re-apply a sync stash with its index; keep the stash entry and throw if it conflicts. */
  private async applyStash(sha: string): Promise<void> {
    try {
      await this.git('stash', 'apply', '-q', '--index', sha);
    } catch {
      await this.tryGit('reset', '-q', '--hard', 'HEAD'); // no conflict markers left behind
      throw new StorageError(`Local uncommitted changes conflict with remote changes; the work tree was reset to HEAD; your changes are kept in stash ${sha} (recover with: git stash apply --index ${sha})`);
    }
    const list = (await this.tryGit('stash', 'list', '--format=%H %gd')) ?? '';
    const line = list.split('\n').find(l => l.startsWith(sha));
    if (line) await this.tryGit('stash', 'drop', '-q', line.split(' ')[1]);
  }

  /** Reject writes when the checked-out branch is not the configured one. @req FR:storage-git/git.branch */
  private async checkBranch(): Promise<void> {
    if (!this.remote && !this.branchExplicit) return;
    const cur = (await this.tryGit('symbolic-ref', '--short', '-q', 'HEAD'))?.trim() ?? null;
    if (cur !== this.branch) throw new StorageError(`Configured branch ${this.branch} is not the current branch (${cur ?? 'detached HEAD'})`);
  }

  /** Fetch and rebase onto the remote (no-op without a remote). */
  async sync(): Promise<void> {
    if (!this.remote) return;
    await this.checkBranch();
    if (!(await this.fetch())) return;
    if (!(await this.rebase())) {
      const n = ((await this.tryGit('rev-list', '--count', `${this.ref}..HEAD`)) ?? '?').trim();
      throw new ConflictError(`${n} unpushed local commit(s) conflict with the remote; rebase aborted, resolve manually`);
    }
  }

  protected async locked(path: string, content: string, opts: WriteOptions): Promise<WriteResult> {
    await this.lockedMany([{ path, content, expectedVersion: opts.expectedVersion }], opts.message);
    return { version: versionOf(content) };
  }

  /** One commit (and one push) for all changed paths; serialized per adapter instance only. @req FR:storage-git/write.many @req FR:storage-git/git.concurrency */
  protected async lockedMany(writes: FileWrite[], message?: string): Promise<void> {
    await this.checkBranch();
    if (this.remote) await this.sync();
    const paths = writes.map(w => w.path);
    const priors: (string | null)[] = [];
    for (const w of writes) {
      const prior = await this.readRaw(w.path);
      checkExpected(w.path, prior === null ? null : versionOf(prior), { expectedVersion: w.expectedVersion });
      priors.push(prior);
    }
    // Remember each path's index entry so a failed commit restores the user's own staged edit.
    const entries: string[] = [];
    for (const p of paths) entries.push(((await this.tryGit('ls-files', '-s', '--', p)) ?? '').trim());
    let committed = false;
    try {
      for (const w of writes) await this.atomicWrite(w.path, w.content);
      await this.git('add', '--', ...paths);
      const staged = await this.tryGit('diff', '--cached', '--quiet', '--', ...paths);
      if (staged === null) {
        const msg = message ?? (paths.length === 1 ? `Update ${paths[0]}` : `Update ${paths.length} files`);
        await this.git('commit', '-q', '-m', msg, '--only', '--', ...paths);
        committed = true;
      }
    } catch (e) {
      for (let i = 0; i < paths.length; i++) {
        const m = /^(\d+) ([0-9a-f]+) \d\t/.exec(entries[i]);
        if (m) await this.tryGit('update-index', '--add', '--cacheinfo', `${m[1]},${m[2]},${paths[i]}`);
        else await this.tryGit('rm', '-q', '--cached', '--ignore-unmatch', '--', paths[i]);
        await this.restore(paths[i], priors[i]);
      }
      throw e;
    }
    if (committed && this.remote) await this.push(writes);
  }

  private async push(writes: FileWrite[]): Promise<void> {
    const paths = writes.map(w => w.path);
    // Our commit is HEAD now; re-read after every rebase because the SHA changes.
    let ours = (await this.git('rev-parse', 'HEAD')).trim();
    for (let attempt = 1; ; attempt++) {
      if (this.beforePush) await this.beforePush();
      try { await this.git('push', '-q', this.remote!, `HEAD:refs/heads/${this.branch}`); return; } catch (e) {
        const msg = (e as Error).message;
        if (!/\[rejected\]|non-fast-forward|fetch first/i.test(msg)) {
          // Auth, network, hook rejection: not a race. Roll back so a failed write leaves nothing behind.
          await this.dropQuietly(paths, ours);
          throw e instanceof StorageError ? e : new StorageError(msg);
        }
        if (attempt >= MAX_PUSH_ATTEMPTS) {
          await this.dropQuietly(paths, ours);
          throw new ConflictError(`Push rejected after ${attempt} attempts: ${msg}`);
        }
      }
      let ok = await this.fetch();
      if (ok) {
        for (const w of writes) {
          if (w.expectedVersion === undefined) continue;
          const theirs = await this.tryGit('show', `${this.ref}:${w.path}`);
          if ((theirs === null ? null : versionOf(theirs)) !== w.expectedVersion) ok = false;
        }
      }
      if (ok) ok = await this.rebase();
      if (ok) ours = (await this.git('rev-parse', 'HEAD')).trim();
      if (!ok) {
        await this.dropQuietly(paths, ours);
        throw new ConflictError(`Conflict on ${paths.join(', ')}: remote changed it concurrently`);
      }
    }
  }

  /** Roll back for a push failure; a rollback error must not mask the original error thrown by the caller. */
  private async dropQuietly(paths: string[], ours: string): Promise<void> {
    try { await this.dropCommit(paths, ours); } catch { /* original error wins */ }
  }

  /**
   * Remove our commit (the HEAD tip) without touching the index beyond `path`:
   * soft reset keeps unrelated staged files, then `path` alone is restored to the parent state.
   */
  private async dropCommit(paths: string[], ours: string): Promise<void> {
    const parent = (await this.tryGit('rev-parse', '--verify', '-q', `${ours}^`))?.trim() ?? null;
    if (parent) await this.git('reset', '-q', '--soft', parent);
    else await this.git('update-ref', '-d', 'HEAD');
    // Try every path; a failure on one must not leave the others at the failed commit's content.
    let first: unknown;
    let failed = false;
    for (const path of paths) {
      try {
        if (parent && (await this.tryGit('cat-file', '-e', `HEAD:${path}`)) !== null) {
          await this.git('restore', '-q', '--source=HEAD', '--staged', '--worktree', '--', path);
        } else {
          await this.tryGit('rm', '-q', '--cached', '--ignore-unmatch', '--', path);
          await this.restore(path, null);
        }
      } catch (e) {
        if (!failed) { failed = true; first = e; }
      }
    }
    // Best effort: a failure here must not mask the error that caused the rollback.
    try { if (await this.fetch()) await this.rebase(); } catch { /* surfaced on the next sync */ }
    if (failed) throw first;
  }
}
