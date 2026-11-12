/**
 * A single-writer lock file for the local live store (~/.stack). Shared by the report store and the priorities store.
 * @req FR:status-ingest/store.lock @req FR:session-inventory/pris.write
 */
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, writeSync } from 'fs';
import { join } from 'path';

export interface LockOptions { lockWaitMs?: number; staleMs?: number }

/** A process with this id is running (EPERM still means it exists). */
export const pidAlive = (pid: number): boolean => { if (!Number.isInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch (e) { return (e as NodeJS.ErrnoException).code === 'EPERM'; } };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Runs `fn` while holding `<dir>/<name>` (created exclusively, holding the writer's pid). Waits up to `lockWaitMs` (5 s),
 * then throws `busy()`. A stale lock is taken over (see `takeOver`).
 */
export async function withFileLock<T>(dir: string, name: string, fn: () => T, busy: () => Error, o: LockOptions = {}): Promise<T> {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const lockFile = join(dir, name);
  const deadline = Date.now() + (o.lockWaitMs ?? 5000);
  for (;;) {
    try { const fd = openSync(lockFile, 'wx'); try { writeSync(fd, String(process.pid)); } finally { closeSync(fd); } break; } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
      try {
        if (takeOver(lockFile, o.staleMs ?? 30_000)) continue;
      } catch (err) { if ((err as NodeJS.ErrnoException).code === 'ENOENT') continue; throw err; }
      if (Date.now() > deadline) throw busy();
      await sleep(25);
    }
  }
  try { return fn(); } finally { try { unlinkSync(lockFile); } catch { /* already gone */ } }
}

/**
 * Removes a stale lock; true when it did. A live writer's lock is never taken. A named writer that is gone frees it at once;
 * a lock with no pid yet (being written) only after staleMs. One remover at a time holds `<lock>.takeover`, and it
 * checks the lock again inside, so two waiters that both saw the same stale lock never remove a fresh lock.
 */
function takeOver(lockFile: string, staleMs: number): boolean {
  const guard = `${lockFile}.takeover`;
  try { closeSync(openSync(guard, 'wx')); } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    // The guard is held for microseconds; one left by a crash is cleared after a second.
    try { if (Date.now() - statSync(guard).mtimeMs > 1000) unlinkSync(guard); } catch (g) { if ((g as NodeJS.ErrnoException).code !== 'ENOENT') throw g; }
    return false;
  }
  try {
    const pid = Number(readFileSync(lockFile, 'utf8'));
    const old = Date.now() - statSync(lockFile).mtimeMs > staleMs;
    if (pid > 0 ? pidAlive(pid) : !old) return false;
    unlinkSync(lockFile);
    return true;
  } finally { try { unlinkSync(guard); } catch { /* already gone */ } }
}

/** Writes `text` to `file` atomically: a temp file in the same folder, then a rename. Mode 0600. */
export function writeAtomic(file: string, text: string): void {
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, file);
}
