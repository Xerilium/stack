import { ConflictError, FileWrite, checkExpected, versionOf } from './storage';
import { GitStorage, GitStorageOptions } from './storage-git';

/** What a batched adapter has not committed yet. @req FR:storage-git/$pending */
export interface Pending {
  /** Pending writes (a `writeMany` counts once). */
  count: number;
  /** Time of the first pending write. */
  since: Date | null;
  /** Distinct pending paths in first-write order. */
  paths: string[];
}

/** @req FR:storage-git/batch.input */
export interface BatchedGitStorageOptions extends GitStorageOptions {
  /** Quiet milliseconds before a commit; 0 commits after every write. Default 300000. */
  idleMs?: number;
  /** Hears a failed timer flush (the batch stays pending). */
  onError?: (e: unknown) => void;
}

const DEFAULT_IDLE_MS = 300_000;

/** Core commit-message verbs → past tense for the batch subject. */
const VERBS: [RegExp, string][] = [
  [/^Complete\b/, 'done'], [/^Suspended until\b/, 'deferred'], [/^Add (task|project)\b/, 'added'],
  [/^Edit\b/, 'edited'], [/^Move\b/, 'moved'], [/^Note\b/, 'noted'], [/^Start\b/, 'started'],
  [/^Park\b/, 'parked'], [/^Resume\b/, 'resumed'], [/^Update$/, 'updated'], [/^Remove\b/, 'removed'],
  [/^Roll\b/, 'rolled'], [/^Due\b/, 'due'], [/^Ask\b/, 'asked'],
];

/**
 * One commit message for a batch: `Stack: done 2, deferred 1, …` (verbs in first-seen order, unknown verbs
 * under `other`; `Stack: n changes` when none is recognized), then the messages as body lines.
 * @req FR:storage-git/batch.flush.subject @req FR:storage-git/batch.flush.body
 */
export function batchSummary(messages: string[]): string {
  const counts = new Map<string, number>();
  for (const m of messages) {
    const colon = m.indexOf(':');
    const head = colon < 0 ? '' : m.slice(0, colon).trim();
    const verb = VERBS.find(([re]) => re.test(head))?.[1] ?? 'other';
    counts.set(verb, (counts.get(verb) ?? 0) + 1);
  }
  const known = [...counts.keys()].some((v) => v !== 'other');
  const subject = known
    ? `Stack: ${[...counts].map(([v, n]) => `${v} ${n}`).join(', ')}`
    : `Stack: ${messages.length} change${messages.length === 1 ? '' : 's'}`;
  return messages.length ? `${subject}\n\n${messages.join('\n')}` : subject;
}

/**
 * Git adapter for the owner's own checkout: a write lands in the file at once and is committed later,
 * as one commit per quiet stretch, so the files stay the source of truth and history reads as sessions.
 * @req FR:storage-git/batch.@function @req FR:storage-git/batch.reads
 */
export class BatchedGitStorage extends GitStorage {
  private readonly idleMs: number;
  private readonly onError?: (e: unknown) => void;
  private timer: NodeJS.Timeout | null = null;
  private batch: { paths: string[]; message: string }[] = [];
  private since: Date | null = null;
  private listeners = new Set<(count: number) => void>();
  private closed = false;

  constructor(root: string, opts: BatchedGitStorageOptions = {}) {
    super(root, opts);
    this.idleMs = opts.idleMs ?? DEFAULT_IDLE_MS;
    this.onError = opts.onError;
  }

  /** @req FR:storage-git/batch.pending */
  pending(): Pending {
    const paths: string[] = [];
    const seen = new Set<string>();
    for (const b of this.batch) for (const p of b.paths) if (!seen.has(p)) { seen.add(p); paths.push(p); }
    return { count: this.batch.length, since: this.since, paths };
  }

  /** Hear the pending count each time it changes; returns the unsubscribe. @req FR:storage-git/batch.events */
  onPending(fn: (count: number) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /** Commit (and push) what is pending now; `null` when there was nothing to commit. @req FR:storage-git/batch.flush */
  flush(): Promise<string | null> {
    return this.enqueue(() => this.flushNow());
  }

  /** Flush what is pending and stop the timer. @req FR:storage-git/batch.idle.close */
  async close(): Promise<void> {
    this.closed = true;
    this.clearTimer();
    await this.flush();
  }

  /**
   * Write now, commit later: version check against the work tree, files written, batch recorded, timer armed.
   * @req FR:storage-git/batch.write @req FR:storage-git/batch.write.expected @req FR:storage-git/batch.write.pending
   * @req FR:storage-git/batch.write.noop @req FR:storage-git/batch.write.many
   */
  protected async lockedMany(writes: FileWrite[], message?: string): Promise<void> {
    await this.checkBranch();
    const changed: FileWrite[] = [];
    for (const w of writes) {
      const cur = await this.readRaw(w.path);
      checkExpected(w.path, cur === null ? null : versionOf(cur), { expectedVersion: w.expectedVersion });
      if (cur !== w.content) changed.push(w);
    }
    if (!changed.length) return;
    await this.putAll(changed);
    const paths = changed.map((w) => w.path);
    this.batch.push({ paths, message: message ?? (paths.length === 1 ? `Update ${paths[0]}` : `Update ${paths.length} files`) });
    this.since ??= new Date();
    this.notify();
    // @req FR:storage-git/batch.idle.zero
    if (this.idleMs === 0) await this.flushNow(); else this.arm();
  }

  /** Unqueued flush: only for callers already inside the write queue. */
  private async flushNow(): Promise<string | null> {
    if (!this.batch.length) return null;
    this.clearTimer();
    const p = this.pending();
    try {
      await this.checkBranch();
      // @req FR:storage-git/batch.flush.empty
      const only = await this.stage(p.paths);
      if (!only.length) { this.reset(); return null; }
      const [subject, , ...body] = batchSummary(this.batch.map((b) => b.message)).split('\n');
      await this.git('commit', '-q', '-m', subject, ...(body.length ? ['-m', body.join('\n')] : []), '--only', '--', ...only);
      let ours = (await this.git('rev-parse', 'HEAD')).trim();
      // @req FR:storage-git/batch.flush.remote (commit first, then fetch + rebase, then push)
      if (this.remote) ours = await this.syncAndPush(ours, subject, p.paths);
      this.reset();
      // @req FR:storage-git/batch.flush.output
      return ours;
    } catch (e) {
      // @req FR:storage-git/batch.failure @req FR:storage-git/batch.failure.retry
      if (!this.closed && this.idleMs > 0) this.arm(); // with idleMs 0 the next write retries; no tight loop against a broken remote
      throw e;
    }
  }

  /**
   * Fetch, rebase onto the remote, push with retry. Whatever fails, our commit never stays on HEAD: the batch is
   * kept pending and the error thrown. The owner's own uncommitted edits are never stashed: when the remote is ahead
   * and tracked files are dirty, the flush gives up with ConflictError instead of rebasing over them. Returns the pushed sha.
   * @req FR:storage-git/batch.flush.remote @req FR:storage-git/batch.flush.remote.dirty @req FR:storage-git/batch.failure
   */
  private async syncAndPush(ours: string, subject: string, paths: string[]): Promise<string> {
    let undone = false;
    const undo = async (sha: string) => { if (undone) return; undone = true; await this.undoQuietly(sha, subject, paths); };
    try {
      if (await this.fetch() && !(await this.rebase())) {
        await undo(ours);
        throw new ConflictError(`Conflict on ${paths.join(', ')}: remote changed it concurrently`);
      }
      await this.pushRetry((await this.git('rev-parse', 'HEAD')).trim(), undo);
      return (await this.git('rev-parse', 'HEAD')).trim(); // the tip after any rebase
    } catch (e) {
      // A throw from fetch/rebase/push machinery (offline, lock, stash re-apply): our commit may still be the tip.
      if (!undone) {
        const head = (await this.tryGit('rev-parse', 'HEAD'))?.trim();
        const tip = (await this.tryGit('log', '-1', '--format=%s'))?.trim();
        if (head && tip === subject) await undo(head); // not undone by pushRetry and still the tip
      }
      throw e;
    }
  }

  /**
   * Never stash the owner's own edits: when the remote is ahead and tracked files are dirty, refuse instead of
   * rebasing over them (`GitStorage.rebase` would stash and, on a re-apply conflict, hard-reset the work tree).
   * Applies to the first rebase and to the ones `pushRetry` makes after a rejected push.
   * @req FR:storage-git/batch.flush.remote.dirty
   */
  protected async rebase(): Promise<boolean> {
    const behind = ((await this.tryGit('rev-list', '--count', `HEAD..${this.ref}`)) ?? '1').trim() !== '0';
    if (behind && (await this.git('status', '--porcelain', '-uno')).trim() !== '') {
      throw new ConflictError(`${this.ref} has new commits and the work tree has uncommitted edits of its own; commit or stash them, then save again`);
    }
    return super.rebase();
  }

  /** Undo for a failure path: an undo error must not mask the error being thrown. */
  private async undoQuietly(sha: string, subject: string, paths: string[]): Promise<void> {
    try { await this.undo(sha, subject, paths); } catch { /* original error wins */ }
  }

  /** Remove our commit (only if `sha` is it: a rebase may have dropped it as empty, and a commit the remote already has is never ours), keeping the files as written and unstaged; nothing else in the index moves. */
  private async undo(sha: string, subject: string, paths: string[]): Promise<void> {
    if ((await this.tryGit('log', '-1', '--format=%s', sha))?.trim() !== subject) return;
    if (this.remote && (await this.tryGit('merge-base', '--is-ancestor', sha, this.ref)) !== null) return; // the remote already has it: never ours to undo
    const parent = (await this.tryGit('rev-parse', '--verify', '-q', `${sha}^`))?.trim() ?? null;
    if (parent) await this.git('reset', '-q', '--soft', parent);
    else await this.git('update-ref', '-d', 'HEAD');
    if ((await this.tryGit('reset', '-q', '--', ...paths)) === null) await this.tryGit('rm', '-q', '--cached', '--ignore-unmatch', '--', ...paths);
  }

  /** @req FR:storage-git/batch.idle @req FR:storage-git/batch.idle.error */
  private arm(): void {
    this.clearTimer();
    this.timer = setTimeout(() => { this.timer = null; this.flush().catch((e) => this.onError?.(e)); }, this.idleMs);
    this.timer.unref?.();
  }

  private clearTimer(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }

  private reset(): void {
    this.batch = [];
    this.since = null;
    this.notify();
  }

  private notify(): void {
    const n = this.batch.length;
    for (const l of this.listeners) l(n);
  }
}
