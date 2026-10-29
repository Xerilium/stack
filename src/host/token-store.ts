/**
 * API token store persisted in the private data repo through the storage adapter (hashes only).
 * Managed Functions only keep temp storage, so a file store would lose every token on restart.
 * @req FR:azure-host/tokens.git
 */
import { ConflictError, StorageError, type AuxFiles, type Storage } from '../core/storage';
import { StoreConflict, type TokenStore } from '../api';

/** Storage as the host uses it: tasks, state files, and an optional remote sync. */
export type HostStorage = Storage & AuxFiles & { sync?(): Promise<void>; /** Head revision, or null when the storage has none. */ rev?(): Promise<string | null> };

export const TOKEN_PATH = '.stack/tokens.json';

export interface GitTokenStoreOptions {
  /** Minimum milliseconds between remote syncs on read (revocations made elsewhere show up after this). Default 60000. */
  syncMs?: number;
  now?: () => number;
  /** Receives error class names only. */
  onError?: (className: string) => void;
}

export class GitTokenStore implements TokenStore {
  private lastSync = -Infinity;
  constructor(private readonly get: () => Promise<HostStorage>, private readonly opts: GitTokenStoreOptions = {}) {}

  async read() {
    const s = await this.get();
    const now = (this.opts.now ?? Date.now)();
    if (s.sync && now - this.lastSync >= (this.opts.syncMs ?? 60_000)) {
      this.lastSync = now;
      // A failed sync keeps serving the local copy; the next read retries after the interval.
      try { await s.sync(); } catch (e) { this.opts.onError?.(e instanceof Error ? e.constructor.name : 'Error'); }
    }
    return s.readAux(TOKEN_PATH);
  }

  async write(content: string, expectedVersion: string | null) {
    const s = await this.get();
    try {
      await s.writeAux(TOKEN_PATH, content, { expectedVersion });
    } catch (e) {
      if (e instanceof ConflictError) throw new StoreConflict();
      throw e;
    }
  }
}

export const needAux = (s: Storage): HostStorage => {
  const a = s as Partial<HostStorage>;
  if (typeof a.readAux !== 'function' || typeof a.writeAux !== 'function') throw new StorageError('Storage does not support state files');
  return s as HostStorage;
};
