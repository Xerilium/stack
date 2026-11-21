/**
 * The host loop that keeps the live branch up with main: a merge at start and every few minutes, one at a time.
 * @req FR:store-sync/host.@function @req FR:store-sync/host.input
 */
import type { DriftState } from './storage-git';

export interface StoreSyncOpts {
  /** Base branch on the remote. Default `main`. */
  base?: string;
  /** Milliseconds between ticks. Default 180000. */
  intervalMs?: number;
  onState?: (s: DriftState) => void;
}
/** `stop` waits for a tick in flight. */
export interface StoreSync { state(): DriftState | null; tick(): Promise<DriftState | null>; stop(): Promise<void> }

/** What the loop needs: `GitStorage.mergeFrom`, and a batch to flush when present. */
interface Mergeable { mergeFrom(base: string): Promise<DriftState | null>; pending?: () => { count: number }; flush?: () => Promise<unknown> }

export const STORE_SYNC_MS = 180_000;

/** @req FR:store-sync/host.start @req FR:store-sync/host.flush @req FR:store-sync/host.errors @req FR:store-sync/host.event */
export function startStoreSync(storage: Mergeable, o: StoreSyncOpts = {}): StoreSync {
  const base = o.base ?? 'main';
  let last: DriftState | null = null;
  let running: Promise<DriftState | null> | null = null;
  const once = async (): Promise<DriftState | null> => {
    let s: DriftState | null;
    try {
      s = await storage.mergeFrom(base);
      if (s?.state === 'blocked' && storage.flush && (storage.pending?.().count ?? 0) > 0) {
        await storage.flush();
        s = await storage.mergeFrom(base);
      }
    } catch (e) {
      s = { base: last?.base ?? base, state: 'error', behind: last?.behind ?? 0, files: [], at: new Date().toISOString(), message: e instanceof Error ? e.message : String(e) };
    }
    last = s;
    if (s) o.onState?.(s);
    return s;
  };
  const tick = () => (running ??= once().finally(() => { running = null; }));
  void tick();
  const timer = setInterval(() => { void tick(); }, o.intervalMs ?? STORE_SYNC_MS);
  timer.unref?.();
  return { state: () => last, tick, stop: async () => { clearInterval(timer); await running?.catch(() => undefined); } };
}
