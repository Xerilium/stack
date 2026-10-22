import { execFile } from 'child_process';
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

  constructor(root: string, opts: GitStorageOptions = {}) {
    super(root);
    this.remote = opts.remote;
    this.branch = opts.branch ?? 'main';
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

  /** Rebase local state onto the remote; false when it conflicted (rebase aborted). */
  private async rebase(): Promise<boolean> {
    try { await this.git('rebase', '--autostash', '-q', this.ref); return true; } catch {
      await this.tryGit('rebase', '--abort');
      return false;
    }
  }

  /** Fetch and rebase onto the remote (no-op without a remote). */
  async sync(): Promise<void> {
    if (!this.remote) return;
    if (!(await this.fetch())) return;
    if (!(await this.rebase())) throw new ConflictError('Local commits conflict with the remote; rebase aborted');
  }

  protected async locked(path: string, content: string, opts: WriteOptions): Promise<WriteResult> {
    if (this.remote) await this.sync();
    const prior = await this.readRaw(path);
    if (opts.expectedVersion !== undefined && (prior === null ? null : versionOf(prior)) !== opts.expectedVersion) {
      return super.locked(path, content, opts); // throws ConflictError
    }
    const headBefore = (await this.tryGit('rev-parse', '--verify', '-q', 'HEAD'))?.trim() ?? null;
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
    if (committed && this.remote) await this.push(path, opts, headBefore);
    return { version: versionOf(content) };
  }

  private async push(path: string, opts: WriteOptions, headBefore: string | null): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      if (this.beforePush) await this.beforePush();
      try { await this.git('push', '-q', this.remote!, `HEAD:refs/heads/${this.branch}`); return; } catch (e) {
        if (attempt >= MAX_PUSH_ATTEMPTS) {
          await this.dropCommit(path, headBefore);
          throw new ConflictError(`Push rejected after ${attempt} attempts: ${(e as Error).message}`);
        }
      }
      let ok = await this.fetch();
      if (ok && opts.expectedVersion !== undefined) {
        const theirs = await this.tryGit('show', `${this.ref}:${path}`);
        if ((theirs === null ? null : versionOf(theirs)) !== opts.expectedVersion) ok = false;
      }
      if (ok) ok = await this.rebase();
      if (!ok) {
        await this.dropCommit(path, headBefore);
        throw new ConflictError(`Conflict on ${path}: remote changed it concurrently`);
      }
    }
  }

  /** Remove our commit, restore the path to the remote state, keep unrelated work-tree changes. */
  private async dropCommit(path: string, headBefore: string | null): Promise<void> {
    if (headBefore) {
      await this.tryGit('reset', '-q', '--mixed', headBefore);
      await this.tryGit('checkout', '-q', 'HEAD', '--', path);
    } else {
      await this.tryGit('update-ref', '-d', 'HEAD');
      await this.restore(path, null);
    }
    if (await this.tryGit('fetch', '-q', this.remote!, this.branch) !== null) {
      await this.tryGit('update-ref', `refs/remotes/${this.ref}`, 'FETCH_HEAD');
      await this.rebase();
    }
  }
}
