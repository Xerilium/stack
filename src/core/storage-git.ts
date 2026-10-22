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
    try { await this.git('fetch', '-q', this.remote!, this.branch); } catch (e) {
      if (/couldn't find remote ref/i.test((e as Error).message)) return false;
      throw e;
    }
    // Make the remote-tracking ref explicit regardless of refspec config.
    await this.git('update-ref', `refs/remotes/${this.ref}`, 'FETCH_HEAD');
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
   * Other failures (lock files, hooks) and autostash pop conflicts throw StorageError.
   */
  private async rebase(): Promise<boolean> {
    try {
      await this.git('rebase', '--autostash', '-q', this.ref);
    } catch (e) {
      if (await this.rebaseInProgress() || await this.unmerged()) {
        await this.tryGit('rebase', '--abort');
        return false;
      }
      throw e;
    }
    // git exits 0 when the autostash pop conflicts; surface it instead of reporting success.
    if (await this.unmerged()) {
      throw new StorageError('Local uncommitted changes conflict with remote changes (autostash pop failed); resolve unmerged paths and `git stash list` entry manually');
    }
    return true;
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
      await this.tryGit('reset', '-q', '--', path);
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
        if (attempt >= MAX_PUSH_ATTEMPTS) {
          await this.dropCommit(path, ours);
          throw new ConflictError(`Push rejected after ${attempt} attempts: ${(e as Error).message}`);
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
    if (await this.tryGit('fetch', '-q', this.remote!, this.branch) !== null) {
      await this.tryGit('update-ref', `refs/remotes/${this.ref}`, 'FETCH_HEAD');
      await this.rebase();
    }
  }
}
