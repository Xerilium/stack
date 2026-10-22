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

/** @req FR:storage-git/interface.@type */
export interface Storage {
  list(): Promise<string[]>;
  read(path: string): Promise<StoredFile>;
  write(path: string, content: string, opts?: WriteOptions): Promise<WriteResult>;
}

/** @req FR:storage-git/interface.version */
export const versionOf = (content: string): string =>
  createHash('sha256').update(Buffer.from(content, 'utf8')).digest('hex');

/** Dotfiles are rejected (list() hides them, so every adapter must agree). */
const TASK_PATH = /^tasks\/[^/\\\0.][^/\\\0]*\.md$/;

/** @req FR:storage-git/interface.paths */
export function validatePath(path: string): string {
  if (typeof path !== 'string' || !TASK_PATH.test(path) || path.split('/').includes('..')) {
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

  async list(): Promise<string[]> { return [...this.files.keys()].sort(); }

  async read(path: string): Promise<StoredFile> {
    validatePath(path);
    const content = this.files.get(path);
    if (content === undefined) throw new NotFoundError(`Not found: ${path}`);
    return { path, content, version: versionOf(content) };
  }

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
}

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

  async list(): Promise<string[]> {
    try {
      const entries = await fs.readdir(join(this.root, TASKS_DIR), { withFileTypes: true });
      return entries.filter(e => e.isFile() && isTaskFile(e.name)).map(e => `${TASKS_DIR}/${e.name}`).sort();
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return [];
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

  /** Runs inside the serial queue. */
  protected async locked(path: string, content: string, opts: WriteOptions): Promise<WriteResult> {
    const cur = await this.readRaw(path);
    checkExpected(path, cur === null ? null : versionOf(cur), opts);
    await this.atomicWrite(path, content);
    return { version: versionOf(content) };
  }

  protected async readRaw(path: string): Promise<string | null> {
    try {
      return await fs.readFile(join(this.root, path), 'utf8');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw e;
    }
  }

  protected async atomicWrite(path: string, content: string): Promise<void> {
    const target = join(this.root, path);
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
    if (prior === null) await fs.rm(join(this.root, path), { force: true });
    else await this.atomicWrite(path, prior);
  }
}
