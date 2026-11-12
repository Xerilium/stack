/**
 * State for the Priorities block and the Sessions list: load, 15 s re-read, live re-read, and queued optimistic saves.
 * @req FR:pris-sessions-ui/live.inventory @req FR:pris-sessions-ui/live.pris @req FR:pris-sessions-ui/pris.save @req FR:pris-sessions-ui/pris.conflict
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ApiFailure, type Client } from './api';
import type { Inventory } from './inventory';
import { PrisQueue, type Edit, type Pri } from './pris';
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

  // --- priorities: the queue holds the rules; the hook only draws ---
  const [prisPhase, setPrisPhase] = useState<Phase>('loading');
  const [view, setView] = useState<Pri[]>([]);
  const q = useMemo(() => new PrisQueue(api, { view: setView, phase: setPrisPhase, toast: (t) => toastRef.current(t, 'err') }), [api]);
  const loadPris = useCallback(() => q.load(), [q]);
  const apply = useCallback((e: Edit) => q.apply(e), [q]);
  const setEditing = useCallback((on: boolean) => q.setEditing(on), [q]);

  // --- sessions ---
  const [invPhase, setInvPhase] = useState<Phase>('loading');
  const [inv, setInv] = useState<Inventory | null>(null);
  const [announce, setAnnounce] = useState('');
  const lastCount = useRef<number | null>(null);
  // Reads can overlap (tick, live change, page shown): only the newest one lands.
  const invSeq = useRef(0);
  const loadInv = useCallback(async () => {
    const mine = ++invSeq.current;
    try {
      const i = await api.inventory();
      if (mine !== invSeq.current) return;
      setInv(i); setInvPhase('ready');
      const n = i.needsYou.length;
      // @req FR:pris-sessions-ui/live.inventory: announce a changed count, never the first load
      if (lastCount.current !== null && lastCount.current !== n) setAnnounce(`${n} ${n === 1 ? 'session needs' : 'sessions need'} you`);
      lastCount.current = n;
    } catch (e) {
      if (mine !== invSeq.current) return;
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
