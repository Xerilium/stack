import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { isAbsolute, join } from 'path';
import { FsStorage, WriteOptions, WriteResult, ConflictError, StorageError, versionOf } from './storage';

export interface GitStorageOptions {
  /** Remote name; when set, writes sync before and push after. */
  remote?: string;
  branch?: string;
}

const MAX_PUSH_ATTEMPTS = 3;

/**
 * Work-tree adapter: every write is a direct commit (no PRs).
 * @req FR:storage-git/git.commit @req FR:storage-git/git.noop @req FR:storage-git/git.isolation
 * @req FR:storage-git/git.remote @req FR:storage-git/git.push-retry @req FR:storage-git/git.conflict
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
      await this.git('stash', 'push', '-q', '-m', 'stack-storage-sync');
      stash = (await this.git('rev-parse', '-q', '--verify', 'refs/stash')).trim();
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
      throw new StorageError(`Local uncommitted changes conflict with remote changes; they are kept in stash ${sha} (git stash apply --index ${sha})`);
    }
    const list = (await this.tryGit('stash', 'list', '--format=%H %gd')) ?? '';
    const line = list.split('\n').find(l => l.startsWith(sha));
    if (line) await this.tryGit('stash', 'drop', '-q', line.split(' ')[1]);
  }

  /** Reject writes when the checked-out branch is not the configured one. */
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
    await this.checkBranch();
    if (this.remote) await this.sync();
    const prior = await this.readRaw(path);
    if (opts.expectedVersion !== undefined && (prior === null ? null : versionOf(prior)) !== opts.expectedVersion) {
      return super.locked(path, content, opts); // throws ConflictError
    }
    // Remember the path's index entry so a failed commit restores the user's own staged edit.
    const entry = ((await this.tryGit('ls-files', '-s', '--', path)) ?? '').trim();
    let committed = false;
    try {
      await this.atomicWrite(path, content);
      await this.git('add', '--', path);
      const staged = await this.tryGit('diff', '--cached', '--quiet', '--', path);
      if (staged === null) {
        await this.git('commit', '-q', '-m', opts.message ?? `Update ${path}`, '--only', '--', path);
        committed = true;
      }
    } catch (e) {
      const m = /^(\d+) ([0-9a-f]+) \d\t/.exec(entry);
      if (m) await this.tryGit('update-index', '--add', '--cacheinfo', `${m[1]},${m[2]},${path}`);
      else await this.tryGit('rm', '-q', '--cached', '--ignore-unmatch', '--', path);
      await this.restore(path, prior);
      throw e;
    }
    if (committed && this.remote) await this.push(path, opts);
    return { version: versionOf(content) };
  }

  private async push(path: string, opts: WriteOptions): Promise<void> {
    // Our commit is HEAD now; re-read after every rebase because the SHA changes.
    let ours = (await this.git('rev-parse', 'HEAD')).trim();
    for (let attempt = 1; ; attempt++) {
      if (this.beforePush) await this.beforePush();
      try { await this.git('push', '-q', this.remote!, `HEAD:refs/heads/${this.branch}`); return; } catch (e) {
        const msg = (e as Error).message;
        if (!/\[rejected\]|non-fast-forward|fetch first/i.test(msg)) {
          // Auth, network, hook rejection: not a race. Roll back so a failed write leaves nothing behind.
          await this.dropCommit(path, ours);
          throw e instanceof StorageError ? e : new StorageError(msg);
        }
        if (attempt >= MAX_PUSH_ATTEMPTS) {
          await this.dropCommit(path, ours);
          throw new ConflictError(`Push rejected after ${attempt} attempts: ${msg}`);
        }
      }
      let ok = await this.fetch();
      if (ok && opts.expectedVersion !== undefined) {
        const theirs = await this.tryGit('show', `${this.ref}:${path}`);
        if ((theirs === null ? null : versionOf(theirs)) !== opts.expectedVersion) ok = false;
      }
      if (ok) ok = await this.rebase();
      if (ok) ours = (await this.git('rev-parse', 'HEAD')).trim();
      if (!ok) {
        await this.dropCommit(path, ours);
        throw new ConflictError(`Conflict on ${path}: remote changed it concurrently`);
      }
    }
  }

  /**
   * Remove our commit (the HEAD tip) without touching the index beyond `path`:
   * soft reset keeps unrelated staged files, then `path` alone is restored to the parent state.
   */
  private async dropCommit(path: string, ours: string): Promise<void> {
    const parent = (await this.tryGit('rev-parse', '--verify', '-q', `${ours}^`))?.trim() ?? null;
    if (parent) await this.git('reset', '-q', '--soft', parent);
    else await this.git('update-ref', '-d', 'HEAD');
    if (parent && (await this.tryGit('cat-file', '-e', `HEAD:${path}`)) !== null) {
      await this.git('restore', '-q', '--source=HEAD', '--staged', '--worktree', '--', path);
    } else {
      await this.tryGit('rm', '-q', '--cached', '--ignore-unmatch', '--', path);
      await this.restore(path, null);
    }
    // Best effort: a failure here must not mask the error that caused the rollback.
    try { if (await this.fetch()) await this.rebase(); } catch { /* surfaced on the next sync */ }
  }
}
