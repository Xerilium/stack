/**
 * State and effects for the Sessions view: the list and cost report (polled while visible), the open drawer with its history
 * and live run stream, sending a prompt, stopping a run.
 * @req FR:agent-sessions/web.view @req FR:agent-sessions/web.drawer @req FR:agent-sessions/web.message @req FR:agent-sessions/web.cost @req FR:agent-sessions/web.new @req FR:agent-sessions/web.states
 */
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { ApiFailure, type Client } from './api';
import { applyUpdate, type CostReport, type SessionItem, type Transcript, type Turn, type Update } from './sessions';
import type { Toast } from './parts';

type ToastFn = (text: string, kind?: Toast['kind'], undo?: () => void) => void;
const POLL_MS = 15_000;
export const emptyTranscript = (): Transcript => ({ lines: [], tools: new Map(), waiting: null, done: null });

/** `enabled`: true when the host runs agents, false when not, null while unknown. */
export function useSessions(api: Client, toast: ToastFn, enabled: boolean | null, active: boolean) {
  const [items, setItems] = useState<SessionItem[]>([]);
  const [total, setTotal] = useState(0);
  const [cost, setCost] = useState<CostReport | null>(null);
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [turnsError, setTurnsError] = useState('');
  const [turnsLoading, setTurnsLoading] = useState(false);
  const [transcript, setTranscript] = useState<Transcript>(emptyTranscript());
  const [streaming, setStreaming] = useState(false);
  const [sendError, setSendError] = useState('');
  const [showCosts, setShowCosts] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [composing, setComposing] = useState(false);
  const [now, setNow] = useState(() => new Date());
  const es = useRef<EventSource | null>(null);
  const seq = useRef(0);
  const itemsRef = useRef<SessionItem[]>([]);
  const toastRef = useRef(toast); toastRef.current = toast;

  const load = useCallback(async () => {
    if (enabled !== true) return;
    const mine = ++seq.current;
    try {
      const [l, c] = await Promise.all([api.sessions(), api.sessionCost(7)]);
      if (mine !== seq.current) return;
      itemsRef.current = l.items;
      setItems(l.items); setTotal(l.total); setCost(c); setNow(new Date()); setPhase('ready'); setError('');
    } catch (e) {
      if (mine !== seq.current) return;
      setError(e instanceof Error ? e.message : 'Failed to load');
      setPhase((p) => (p === 'ready' ? p : 'error'));
    }
  }, [api, enabled]);

  useEffect(() => {
    if (!active || enabled !== true) return;
    void load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, POLL_MS);
    return () => clearInterval(t);
  }, [load, active, enabled]);

  useEffect(() => {
    setCursor((c) => (c && items.some((i) => i.id === c) ? c : (items[0]?.id ?? null)));
  }, [items]);

  const closeStream = useCallback(() => { es.current?.close(); es.current = null; setStreaming(false); }, []);

  /** Opens the run stream for a session (or a run id for a session not yet known). */
  const listen = useCallback((key: string) => {
    closeStream();
    if (typeof EventSource === 'undefined') return;
    const src = new EventSource(`/sessions/${encodeURIComponent(key)}/events`);
    es.current = src;
    setStreaming(true);
    src.addEventListener('update', (e) => {
      let u: Update;
      try { u = JSON.parse((e as MessageEvent).data) as Update; } catch { return; }
      if (u.type === 'session') { setOpen(u.sessionId); setCursor(u.sessionId); }
      setTranscript((t) => applyUpdate(t, u));
      if (u.type === 'done') { closeStream(); void load(); }
    });
    src.onerror = () => { if (src.readyState === 2) { es.current = null; setStreaming(false); } };
  }, [closeStream, load]);

  const openDrawer = useCallback(async (id: string) => {
    setOpen(id); setCursor(id); setSendError(''); setTranscript(emptyTranscript()); setTurns([]); setTurnsError('');
    // Always listen: a finished run replays for 10 minutes, a running one streams, a session with no run answers 204 and the source closes.
    listen(id);
    setTurnsLoading(true);
    try { setTurns(await api.sessionMessages(id)); } catch (e) { setTurnsError(e instanceof Error ? e.message : 'Cannot load the history'); } finally { setTurnsLoading(false); }
  }, [api, listen]);

  const closeDrawer = useCallback(() => { closeStream(); setOpen(null); setComposing(false); }, [closeStream]);

  const send = useCallback(async (text: string) => {
    const t = text.trim();
    if (!open || !t) return false;
    setSendError('');
    try {
      await api.promptSession(open, t);
      setTurns((x) => [...x, { at: new Date().toISOString(), role: 'user', text: t }]);
      setTranscript(emptyTranscript());
      listen(open);
      setItems((l) => l.map((s) => (s.id === open ? { ...s, state: 'running' } : s)));
      return true;
    } catch (e) {
      setSendError(e instanceof ApiFailure && e.status === 409 ? 'This session is active in another window; message it there or through its inbox' : e instanceof Error ? e.message : 'Failed to send');
      return false;
    }
  }, [api, open, listen]);

  const start = useCallback(async (cwd: string, text: string) => {
    setSendError('');
    try {
      const r = await api.newSession(cwd, text.trim());
      setComposing(false);
      setOpen(r.sessionId ?? r.runId); setTurns([{ at: new Date().toISOString(), role: 'user', text: text.trim() }]); setTranscript(emptyTranscript());
      listen(r.sessionId ?? r.runId);
      return true;
    } catch (e) { setSendError(e instanceof Error ? e.message : 'Failed to start'); return false; }
  }, [api, listen]);

  const stop = useCallback(async (id = open) => {
    if (!id) return;
    if (id.startsWith('run-')) { toastRef.current('Starting; stop it once it has a session'); return; }
    try { const r = await api.cancelSession(id); toastRef.current(r.changed ? 'Stopping' : 'Nothing to stop'); } catch (e) { toastRef.current(e instanceof Error ? e.message : 'Failed to stop', 'err'); }
  }, [api, open]);

  useEffect(() => () => closeStream(), [closeStream]);

  return {
    items, total, cost, phase, error, cursor, setCursor, open, openDrawer, closeDrawer, turns, turnsError, turnsLoading, transcript, streaming, sendError, send, start, stop,
    showCosts, setShowCosts, showAll, setShowAll, composing, setComposing, now, reload: load, note: (text: string) => toastRef.current(text),
  };
}
export type Sessions = ReturnType<typeof useSessions>;
