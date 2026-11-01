/**
 * State and effects for the Sessions view: the list and cost report (polled while visible), the open drawer with its history
 * and live run stream, sending a prompt, stopping a run.
 * @req FR:agent-sessions/web.view @req FR:agent-sessions/web.drawer @req FR:agent-sessions/web.message @req FR:agent-sessions/web.usage @req FR:agent-sessions/web.new @req FR:agent-sessions/web.states @req FR:agent-sessions/web.scope.all @req FR:agent-team/compose.after
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
  const [composing, setComposingState] = useState(false);
  /** The agent the composer opens with (a slug), when one was chosen from a row. */
  const [composeAgent, setComposeAgent] = useState<string | null>(null);
  const [now, setNow] = useState(() => new Date());
  const es = useRef<EventSource | null>(null);
  const seq = useRef(0);
  const itemsRef = useRef<SessionItem[]>([]);
  const toastRef = useRef(toast); toastRef.current = toast;
  /** The first list read happened (by the poll, or the one-off read below). */
  const loadedOnce = useRef(false);

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
    loadedOnce.current = true;
    void load();
    const t = setInterval(() => { if (document.visibilityState === 'visible') void load(); }, POLL_MS);
    return () => clearInterval(t);
  }, [load, active, enabled]);

  useEffect(() => {
    // An agent row (`agent:<slug>`) is a cursor too; the view owns those keys and picks the first painted row when the cursor is lost.
    setCursor((c) => (c && (c.startsWith('agent:') || items.some((i) => i.id === c)) ? c : null));
  }, [items]);
  // One read when the host says it runs agents and the view is not polling, so rows elsewhere know which agents have recent sessions.
  useEffect(() => { if (enabled === true && !active && !loadedOnce.current) { loadedOnce.current = true; void load(); } }, [enabled, active, load]);

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

  const setComposing = useCallback((on: boolean, agent?: string) => { setComposingState(on); setComposeAgent(on ? (agent ?? null) : null); setSendError(''); }, []);
  const closeDrawer = useCallback(() => { closeStream(); setOpen(null); setComposingState(false); setComposeAgent(null); }, [closeStream]);

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

  /** Starts a session: plain in a folder, or for an agent (its persona, its project, an optional folder). @req FR:agent-team/compose.after */
  const start = useCallback(async (cwd: string | undefined, text: string, extra?: { agent?: string; project?: string }) => {
    setSendError('');
    try {
      const r = await api.newSession(cwd, text.trim(), extra ?? {});
      setComposingState(false); setComposeAgent(null);
      setOpen(r.sessionId ?? r.runId); setTurns([{ at: new Date().toISOString(), role: 'user', text: text.trim() }]); setTranscript(emptyTranscript());
      listen(r.sessionId ?? r.runId);
      void load();
      return true;
    } catch (e) { setSendError(e instanceof Error ? e.message : 'Failed to start'); return false; }
  }, [api, listen, load]);

  const stop = useCallback(async (id = open) => {
    if (!id) return;
    if (id.startsWith('run-')) { toastRef.current('Starting; stop it once it has a session'); return; }
    try { const r = await api.cancelSession(id); toastRef.current(r.changed ? 'Stopping' : 'Nothing to stop'); } catch (e) { toastRef.current(e instanceof Error ? e.message : 'Failed to stop', 'err'); }
  }, [api, open]);

  useEffect(() => () => closeStream(), [closeStream]);

  return {
    items, total, cost, phase, error, cursor, setCursor, open, openDrawer, closeDrawer, turns, turnsError, turnsLoading, transcript, streaming, sendError, send, start, stop,
    showCosts, setShowCosts, showAll, setShowAll, composing, setComposing, composeAgent, now, reload: load, note: (text: string) => toastRef.current(text),
  };
}
export type Sessions = ReturnType<typeof useSessions>;
