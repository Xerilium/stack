/**
 * Unsaved edits in live mode: the local server batches commits, so the page shows what is pending,
 * saves on click, and saves (keepalive) when the page is hidden or unloaded so nothing is left on the desk.
 * @req FR:live-deploy/web.unsaved
 */
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { Client } from './api';

export interface UnsavedState { pending: number; since: string | null; saving: boolean }

interface Listening { addEventListener(type: string, fn: () => void): void; removeEventListener(type: string, fn: () => void): void }
export interface UnsavedOpts {
  /** `GET /api/sync`: `pending`/`since` are absent when the storage does not batch. */
  get: () => Promise<{ pending?: number; since?: string | null }>;
  /** `POST /api/sync`; `keepalive` when the page is going away. */
  post: (keepalive: boolean) => Promise<unknown>;
  onState: (s: UnsavedState) => void;
  /** A failed save, in the server's words. */
  onError?: (message: string) => void;
  doc?: Listening & { visibilityState: string };
  win?: Listening;
}

export interface Unsaved { check(): Promise<void>; flush(): Promise<void>; stop(): void; state(): UnsavedState }

export function createUnsaved(o: UnsavedOpts): Unsaved {
  const doc = o.doc ?? (typeof document === 'undefined' ? null : document);
  const win = o.win ?? (typeof window === 'undefined' ? null : window);
  let s: UnsavedState = { pending: 0, since: null, saving: false };
  const set = (next: Partial<UnsavedState>) => { s = { ...s, ...next }; o.onState(s); };

  /** @req FR:live-deploy/web.unsaved.none @req FR:live-deploy/web.unsaved.refresh */
  const check = async () => {
    try {
      const r = await o.get();
      set({ pending: r.pending ?? 0, since: r.pending ? r.since ?? null : null });
    } catch { /* keep what we know; the next check tries again */ }
  };
  /** @req FR:live-deploy/web.unsaved.click @req FR:live-deploy/web.unsaved.error */
  const flush = async () => {
    if (s.saving) return;
    set({ saving: true });
    try { await o.post(false); } catch (e) { o.onError?.(e instanceof Error ? e.message : 'Save failed'); }
    finally { s = { ...s, saving: false }; await check(); }
  };
  /** @req FR:live-deploy/web.unsaved.hide */
  const leaving = () => { if (s.pending > 0 && !s.saving) o.post(true).then(() => check(), () => undefined); };
  const onVisibility = () => { if (doc?.visibilityState === 'hidden') leaving(); else void check(); };
  doc?.addEventListener('visibilitychange', onVisibility);
  win?.addEventListener('pagehide', leaving);
  return {
    check, flush, state: () => s,
    stop: () => { doc?.removeEventListener('visibilitychange', onVisibility); win?.removeEventListener('pagehide', leaving); },
  };
}

/** `Unsaved · n`, `Saving…` while a save is in flight, null when nothing is pending. @req FR:live-deploy/web.unsaved */
export const unsavedLabel = (s: UnsavedState): string | null => (s.saving ? 'Saving…' : s.pending > 0 ? `Unsaved · ${s.pending}` : null);

/** Tooltip: when the first unsaved edit was made, and that a click saves. */
export function unsavedTitle(s: UnsavedState): string {
  const at = s.since ? new Date(s.since) : null;
  const time = at && !Number.isNaN(at.getTime()) ? at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null;
  return time ? `First unsaved edit ${time} · click to save now` : 'Click to save now';
}

/**
 * The controller as state: `check()` after each own write and change event, `flush()` on click.
 * `enabled` is false where no server batches (the hosted app over GitHub storage), so that page never asks twice.
 */
export function useUnsaved(api: Client, onError: (message: string) => void, enabled = true) {
  const [state, setState] = useState<UnsavedState>({ pending: 0, since: null, saving: false });
  const errRef = useRef(onError); errRef.current = onError;
  const ctl = useRef<Unsaved | null>(null);
  useEffect(() => {
    if (!enabled) { setState({ pending: 0, since: null, saving: false }); return; }
    const u = createUnsaved({ get: () => api.syncState(), post: (k) => api.flush(k), onState: setState, onError: (m) => errRef.current(m) });
    ctl.current = u;
    return () => { u.stop(); ctl.current = null; };
  }, [api, enabled]);
  const check = useCallback(() => ctl.current?.check() ?? Promise.resolve(), []);
  const flush = useCallback(() => ctl.current?.flush() ?? Promise.resolve(), []);
  return { state, check, flush, label: unsavedLabel(state), title: unsavedTitle(state) };
}
