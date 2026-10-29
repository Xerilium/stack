import { createHash, randomBytes } from 'crypto';
import { promises as fs } from 'fs';
import { dirname, join } from 'path';

export class StorageError extends Error {}
export class NotFoundError extends StorageError {}
export class ConflictError extends StorageError {}
export class PathError extends StorageError {}

/** @req FR:storage-git/$stored-file */
export interface StoredFile { path: string; content: string; version: string; }
export interface WriteResult { version: string; }
/** @req FR:storage-git/$write-opts */
export interface WriteOptions {
  /** Current version the caller read; `null` means the file must not exist. Omit to overwrite blindly. */
  expectedVersion?: string | null;
  message?: string;
}

/** One file in a multi-file write. @req FR:storage-git/write.many */
export interface FileWrite { path: string; /** `null` deletes the file (multi-file writes only). @req FR:storage-git/write.delete */ content: string | null; expectedVersion?: string | null }

/** @req FR:storage-git/interface.@type */
export interface Storage {
  list(): Promise<string[]>;
  /** Paths of ask files (`tasks/asks/<key>.md`). @req FR:ask-queue/ask.path */
  listAsks?(): Promise<string[]>;
  read(path: string): Promise<StoredFile>;
  write(path: string, content: string, opts?: WriteOptions): Promise<WriteResult>;
  /** Write several files as one operation (one commit in git). @req FR:storage-git/write.many */
  writeMany?(writes: FileWrite[], opts?: { message?: string }): Promise<void>;
}

/** Multi-file write; adapters without `writeMany` fall back to one write per file. @req FR:storage-git/write.many */
export async function writeAll(storage: Storage, writes: FileWrite[], message?: string): Promise<void> {
  if (storage.writeMany) return storage.writeMany(writes, { message });
  assertDistinct(writes);
  for (const w of writes) {
    if (w.content === null) throw new StorageError(`Cannot delete ${w.path}: the adapter has no writeMany`);
    await storage.write(w.path, w.content, { expectedVersion: w.expectedVersion, message });
  }
}

/** @req FR:storage-git/write.many */
export function assertDistinct(writes: FileWrite[]): void {
  const seen = new Set<string>();
  for (const w of writes) {
    validatePath(w.path);
    if (seen.has(w.path)) throw new StorageError(`Duplicate path in multi-file write: ${w.path}`);
    seen.add(w.path);
  }
}

/** @req FR:storage-git/interface.version */
export const versionOf = (content: string): string =>
  createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex');

/** Dotfiles are rejected (list() hides them, so every adapter must agree). */
export const TASK_PATH = /^tasks\/[^/\\\0.][^/\\\0]*\.md$/;
const SUMMARY_PATH = /^(README|stack|projects|my-day)\.md$/;
/** Agent result logs live beside the tasks, in their own folder, and are never projects. */
const LOG_PATH = /^tasks\/logs\/(?![Rr][Ee][Aa][Dd][Mm][Ee]\.md$)[A-Za-z0-9][A-Za-z0-9._-]*\.md$/;
/** Owner-to-agent inboxes: same name rules as logs, never projects. @req FR:agent-inbox/inbox.path */
const INBOX_PATH = /^tasks\/inbox\/(?![Rr][Ee][Aa][Dd][Mm][Ee]\.md$)[A-Za-z0-9][A-Za-z0-9._-]*\.md$/;

/** Agent asks for the owner: one file per ask, never projects. @req FR:ask-queue/ask.path */
export const ASK_PATH = /^tasks\/asks\/(?![Rr][Ee][Aa][Dd][Mm][Ee]\.md$)[a-z0-9][a-z0-9._-]{0,79}\.md$/;
/** Archived (done) asks: same names, one folder down, never listed as open asks. @req FR:ask-queue/ask.archive */
const ARCHIVE_PATH = /^tasks\/asks\/archive\/[a-z0-9][a-z0-9._-]{0,79}\.md$/;

/** Non-task state files (for example the API token store); never listed as tasks. */
export const AUX_PATH = /^\.stack\/[a-z][a-z-]*\.json$/;
export function validateAuxPath(path: string): string {
  if (typeof path !== 'string' || !AUX_PATH.test(path)) throw new PathError(`Invalid state path: ${JSON.stringify(path)}`);
  return path;
}

/** Versioned raw files outside `tasks/`; same serial queue, atomicity, and (in git) commit semantics as task writes. */
export interface AuxFiles {
  readAux(path: string): Promise<{ content: string; version: string } | null>;
  /** `expectedVersion` null means the file must not exist yet. */
  writeAux(path: string, content: string, opts: { expectedVersion: string | null }): Promise<WriteResult>;
}

/** @req FR:storage-git/interface.paths @req FR:ai-triage-assist/result.path */
export function validatePath(path: string): string {
  if (typeof path !== 'string' || !(TASK_PATH.test(path) || SUMMARY_PATH.test(path) || LOG_PATH.test(path) || INBOX_PATH.test(path) || ASK_PATH.test(path) || ARCHIVE_PATH.test(path)) || path.split('/').includes('..')) {
    throw new PathError(`Invalid task path: ${JSON.stringify(path)}`);
  }
  return path;
}

const TASKS_DIR = 'tasks';
const isTaskFile = (name: string) => name.endsWith('.md') && !name.startsWith('.');

/** @req FR:storage-git/fs.memory */
export class MemoryStorage implements Storage {
  private files = new Map<string, string>();
  private queue: Promise<unknown> = Promise.resolve();

  async list(): Promise<string[]> { return [...this.files.keys()].filter(p => TASK_PATH.test(p)).sort(); }
  async listAsks(): Promise<string[]> { return [...this.files.keys()].filter(p => ASK_PATH.test(p)).sort(); }

  /** @req FR:storage-git/interface.read @req FR:storage-git/interface.bytes */
  async read(path: string): Promise<StoredFile> {
    validatePath(path);
    const content = this.files.get(path);
    if (content === undefined) throw new NotFoundError(`Not found: ${path}`);
    return { path, content, version: versionOf(content) };
  }

  /** @req FR:storage-git/write.result @req FR:storage-git/interface.bytes */
  async write(path: string, content: string, opts: WriteOptions = {}): Promise<WriteResult> {
    validatePath(path);
    const run = async () => {
      const cur = this.files.get(path);
      checkExpected(path, cur === undefined ? null : versionOf(cur), opts);
      this.files.set(path, content);
      return { version: versionOf(content) };
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  async readAux(path: string) {
    validateAuxPath(path);
    const content = this.files.get(path);
    return content === undefined ? null : { content, version: versionOf(content) };
  }

  async writeAux(path: string, content: string, opts: { expectedVersion: string | null }): Promise<WriteResult> {
    validateAuxPath(path);
    const run = async () => {
      const cur = this.files.get(path);
      checkExpected(path, cur === undefined ? null : versionOf(cur), opts);
      this.files.set(path, content);
      return { version: versionOf(content) };
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  /** All versions checked first; `null` content deletes. @req FR:storage-git/write.many @req FR:storage-git/write.delete */
  async writeMany(writes: FileWrite[]): Promise<void> {
    assertDistinct(writes);
    const run = async () => {
      for (const w of writes) {
        const cur = this.files.get(w.path);
        checkExpected(w.path, cur === undefined ? null : versionOf(cur), { expectedVersion: w.expectedVersion });
      }
      for (const w of writes) { if (w.content === null) this.files.delete(w.path); else this.files.set(w.path, w.content); }
    };
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }
}

/** @req FR:storage-git/write.expected */
export function checkExpected(path: string, current: string | null, opts: WriteOptions): void {
  if (opts.expectedVersion !== undefined && opts.expectedVersion !== current) {
    throw new ConflictError(`Conflict on ${path}: expected version ${opts.expectedVersion ?? '(absent)'}, found ${current ?? '(absent)'}`);
  }
}

/**
 * Directory-backed storage; writes go to a temp file then rename.
 * @req FR:storage-git/fs.fs @req FR:storage-git/write.atomic @req FR:storage-git/write.serial
 */
export class FsStorage implements Storage {
  private queue: Promise<unknown> = Promise.resolve();
  constructor(readonly root: string) {}

  /** Run `fn` in the same serial queue as writes. */
  protected enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn, fn);
    this.queue = p.catch(() => undefined);
    return p;
  }

  /**
   * Resolve a relative path under root, refusing any symlink on the way (a tracked link must never
   * read or write outside the work tree). Missing components are fine.
   * @req FR:storage-git/fs.contain
   */
  protected async safe(path: string): Promise<string> {
    let cur = this.root;
    for (const part of path.split('/')) {
      cur = join(cur, part);
      try {
        if ((await fs.lstat(cur)).isSymbolicLink()) throw new StorageError(`Refusing symlink in storage path: ${path}`);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'ENOENT' || (e as NodeJS.ErrnoException).code === 'ENOTDIR') break;
        throw e;
      }
    }
    return join(this.root, path);
  }

  /** @req FR:storage-git/interface.list */
  async list(): Promise<string[]> {
    try {
      const entries = await fs.readdir(await this.safe(TASKS_DIR), { withFileTypes: true });
      return entries.filter(e => e.isFile() && isTaskFile(e.name)).map(e => `${TASKS_DIR}/${e.name}`).sort();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw e;
    }
  }

  async listAsks(): Promise<string[]> {
    try {
      const entries = await fs.readdir(await this.safe(`${TASKS_DIR}/asks`), { withFileTypes: true });
      return entries.filter(e => e.isFile() && ASK_PATH.test(`${TASKS_DIR}/asks/${e.name}`)).map(e => `${TASKS_DIR}/asks/${e.name}`).sort();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT' || (e as NodeJS.ErrnoException).code === 'ENOTDIR') return [];
      throw e;
    }
  }

  async read(path: string): Promise<StoredFile> {
    validatePath(path);
    const content = await this.readRaw(path);
    if (content === null) throw new NotFoundError(`Not found: ${path}`);
    return { path, content, version: versionOf(content) };
  }

  async write(path: string, content: string, opts: WriteOptions = {}): Promise<WriteResult> {
    validatePath(path);
    const run = () => this.locked(path, content, opts);
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  async readAux(path: string) {
    validateAuxPath(path);
    const content = await this.readRaw(path);
    return content === null ? null : { content, version: versionOf(content) };
  }

  async writeAux(path: string, content: string, opts: { expectedVersion: string | null }): Promise<WriteResult> {
    validateAuxPath(path);
    const run = () => this.locked(path, content, opts);
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  async writeMany(writes: FileWrite[], opts: { message?: string } = {}): Promise<void> {
    assertDistinct(writes);
    const run = () => this.lockedMany(writes, opts.message);
    const p = this.queue.then(run, run);
    this.queue = p.catch(() => undefined);
    return p;
  }

  /** Runs inside the serial queue: check every version, write all, restore all on failure. */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  protected async lockedMany(writes: FileWrite[], _message?: string): Promise<void> {
    const priors: (string | null)[] = [];
    for (const w of writes) {
      const cur = await this.readRaw(w.path);
      checkExpected(w.path, cur === null ? null : versionOf(cur), { expectedVersion: w.expectedVersion });
      priors.push(cur);
    }
    const done: number[] = [];
    try {
      for (let i = 0; i < writes.length; i++) { await this.put(writes[i].path, writes[i].content); done.push(i); }
    } catch (e) {
      for (const i of done) await this.restore(writes[i].path, priors[i]).catch(() => undefined);
      throw e;
    }
  }

  /** Runs inside the serial queue. */
  protected async locked(path: string, content: string, opts: WriteOptions): Promise<WriteResult> {
    const cur = await this.readRaw(path);
    checkExpected(path, cur === null ? null : versionOf(cur), opts);
    await this.atomicWrite(path, content);
    return { version: versionOf(content) };
  }

  /** Write, or delete when `content` is null. */
  protected async put(path: string, content: string | null): Promise<void> {
    if (content === null) await this.restore(path, null); else await this.atomicWrite(path, content);
  }

  protected async readRaw(path: string): Promise<string | null> {
    try {
      return await fs.readFile(await this.safe(path), 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  protected async atomicWrite(path: string, content: string): Promise<void> {
    const target = await this.safe(path);
    await fs.mkdir(dirname(target), { recursive: true });
    const tmp = join(dirname(target), `.${randomBytes(6).toString('hex')}.tmp`);
    try {
      const fh = await fs.open(tmp, 'wx');
      try { await fh.writeFile(Buffer.from(content, 'utf8')); await fh.sync(); } finally { await fh.close(); }
      await fs.rename(tmp, target);
    } catch (e) {
      await fs.rm(tmp, { force: true });
      throw e;
    }
  }

  /** Restore a path to prior content (null = delete). */
  protected async restore(path: string, prior: string | null): Promise<void> {
    if (prior === null) await fs.rm(await this.safe(path), { force: true });
    else await this.atomicWrite(path, prior);
  }
}
