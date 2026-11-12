/**
 * State for the Priorities block and the Sessions list: load, 15 s re-read, live re-read, and queued optimistic saves.
 * @req FR:pris-sessions-ui/live.inventory @req FR:pris-sessions-ui/live.pris @req FR:pris-sessions-ui/pris.save @req FR:pris-sessions-ui/pris.conflict
 */
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { ApiFailure, type Client } from './api';
import type { Inventory } from './inventory';
import { commitPris, type Edit, type Pri, type PrisFile } from './pris';
import type { Toast } from './parts';

type ToastFn = (text: string, kind?: Toast['kind']) => void;
/** `absent`: the host has no store (404); the section is not drawn. */
export type Phase = 'loading' | 'ready' | 'absent' | 'error';
const TICK_MS = 15_000;

export interface PrisCtl {
  phase: Phase;
  pris: Pri[];
  /** Shows the edit at once and queues the save. */
  apply: (e: Edit) => void;
  /** A text field opened or closed: while open, a re-read never replaces the list. */
  setEditing: (on: boolean) => void;
}
export interface InventoryCtl { phase: Phase; inv: Inventory | null; announce: string }

const isAbsent = (e: unknown) => e instanceof ApiFailure && e.status === 404;

/** `active`: Needs you is on screen; nothing is read while it is not. */
export function usePrisSessions(api: Client, toast: ToastFn, liveTick: number, active = true): { pris: PrisCtl; sessions: InventoryCtl } {
  const toastRef = useRef(toast); toastRef.current = toast;

  // --- priorities ---
  const [prisPhase, setPrisPhase] = useState<Phase>('loading');
  const [view, setViewState] = useState<Pri[]>([]);
  const viewRef = useRef<Pri[]>([]);
  const setView = useCallback((l: Pri[]) => { viewRef.current = l; setViewState(l); }, []);
  const server = useRef<PrisFile | null>(null);
  const queue = useRef<Edit[]>([]);
  const running = useRef(false);
  const editing = useRef(false);

  const loadPris = useCallback(async () => {
    if (running.current || editing.current) return;
    try {
      const f = await api.pris();
      if (running.current || editing.current) return;
      server.current = f; setView(f.pris); setPrisPhase('ready');
    } catch (e) {
      if (isAbsent(e)) setPrisPhase('absent');
      else setPrisPhase((p) => (p === 'ready' ? p : 'error'));
    }
  }, [api, setView]);

  /** One save at a time, each on the latest server file. @req FR:pris-sessions-ui/pris.save */
  const drain = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    try {
      while (queue.current.length && server.current) {
        const edit = queue.current.shift()!;
        const r = await commitPris(api, server.current, edit);
        server.current = r.file;
        if (r.outcome === 'conflict') toastRef.current('Priorities changed elsewhere. Reloaded.', 'err');
        else if (r.outcome === 'invalid') toastRef.current(r.message ?? 'Not saved', 'err');
        else if (r.outcome === 'error') toastRef.current(`Not saved: ${r.message ?? 'unknown error'}`, 'err');
        if (r.outcome !== 'saved' && r.outcome !== 'rebased') {
          // The server list wins; edits still queued are shown again on top of it.
          setView(queue.current.reduce((l, e) => e(l) ?? l, r.file.pris));
        }
      }
      if (server.current) setView(server.current.pris);
    } finally { running.current = false; }
  }, [api, setView]);

  const apply = useCallback((e: Edit) => {
    const n = e(viewRef.current);
    if (!n) return;
    setView(n);
    queue.current.push(e);
    void drain();
  }, [drain]);
  const setEditing = useCallback((on: boolean) => { editing.current = on; }, []);

  // --- sessions ---
  const [invPhase, setInvPhase] = useState<Phase>('loading');
  const [inv, setInv] = useState<Inventory | null>(null);
  const [announce, setAnnounce] = useState('');
  const lastCount = useRef<number | null>(null);
  const loadInv = useCallback(async () => {
    try {
      const i = await api.inventory();
      setInv(i); setInvPhase('ready');
      const n = i.needsYou.length;
      // @req FR:pris-sessions-ui/live.inventory: announce a changed count, never the first load
      if (lastCount.current !== null && lastCount.current !== n) setAnnounce(`${n} ${n === 1 ? 'session needs' : 'sessions need'} you`);
      lastCount.current = n;
    } catch (e) {
      if (isAbsent(e)) setInvPhase('absent');
      else setInvPhase((p) => (p === 'ready' ? p : 'error'));
    }
  }, [api]);

  // A host without a store (404) is not asked again.
  const absent = useRef({ inv: false, pris: false });
  absent.current = { inv: invPhase === 'absent', pris: prisPhase === 'absent' };
  const both = useCallback(() => { if (!absent.current.inv) void loadInv(); if (!absent.current.pris) void loadPris(); }, [loadInv, loadPris]);
  // every live change, and each time Needs you opens
  useEffect(() => { if (active) both(); }, [liveTick, both, active]);
  // the session store has no watcher: re-read every 15 s while visible, and when the page is shown again
  useEffect(() => {
    if (!active) return;
    const visible = () => typeof document === 'undefined' || document.visibilityState === 'visible';
    const t = setInterval(() => { if (visible()) both(); }, TICK_MS);
    const onVis = () => { if (visible()) both(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [both, active]);

  return { pris: { phase: prisPhase, pris: view, apply, setEditing }, sessions: { phase: invPhase, inv, announce } };
}
