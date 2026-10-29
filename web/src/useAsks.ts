/**
 * State and effects for the Asks view: loading, live updates, optimistic answers with undo.
 * @req FR:ask-queue/web.live @req FR:ask-queue/web.optimistic @req FR:ask-queue/live.quiet @req FR:ask-queue/web.home
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ApiFailure, type Client } from './api';
import { deferChoices, keepCursor, newKeys, pageTitle, replyKind, type AskItem, type Send } from './asks';
import { connectLive, type LiveHandle, type LiveStatus } from './live';
import { mergeNeeds } from './needs';
import type { Toast } from './parts';

export type Panel = 'none' | 'reply' | 'defer';
type ToastFn = (text: string, kind?: Toast['kind'], undo?: () => void) => void;
const HOLD_MS = 2500;
const FRESH_MS = 6000;
const LEAVE_MS = 200;

export interface AskExtras {
  /** Open 🙋 rows as asks; they rank with the agent asks. @req FR:web-shell/state.needs */
  tasks?: AskItem[];
  /** Answers a task ask through the agent inbox; rejects to put the ask back. */
  onTask?: (a: AskItem, s: Send) => Promise<void>;
  onOpenTask?: (ref: string) => void;
}
/** `stream`: true when the host serves `/events`, false to poll, null while that is not known yet. */
export function useAsks(api: Client, toast: ToastFn, onTasksChange: () => void, stream: boolean | null, onNew?: (items: AskItem[]) => void, extras: AskExtras = {}) {
  const onNewRef = useRef(onNew); onNewRef.current = onNew;
  const extrasRef = useRef(extras); extrasRef.current = extras;
  const [items, setItems] = useState<AskItem[]>([]);
  const [sent, setSent] = useState<AskItem[]>([]);
  const [snoozed, setSnoozed] = useState<AskItem[]>([]);
  const [serverTotal, setTotal] = useState(0);
  const [latest, setLatest] = useState<string | undefined>();
  const [phase, setPhase] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [status, setStatus] = useState<LiveStatus | 'connecting'>('connecting');
  const live = useRef<LiveHandle | null>(null);
  const [cursor, setCursorState] = useState<string | null>(null);
  const cursorRef = useRef<string | null>(null);
  /** Synchronous, so quick key presses read the cursor they just moved. */
  const setCursor = useCallback((k: string | null) => { cursorRef.current = k; setCursorState(k); }, []);
  const [panel, setPanelState] = useState<Panel>('none');
  const panelRef = useRef<Panel>('none');
  const setPanel = useCallback((p: Panel) => { panelRef.current = p; setPanelState(p); }, []);
  const [detail, setDetail] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const [leaving, setLeaving] = useState<AskItem[]>([]);
  const [now, setNow] = useState(() => new Date());
  const itemsRef = useRef<AskItem[]>([]);
  const serverRef = useRef<AskItem[]>([]);
  const prevKeys = useRef<string[] | null>(null);
  const hold = useRef(new Map<string, number>());
  const seq = useRef(0);
  const undoRef = useRef<(() => void) | null>(null);
  const tasksCb = useRef(onTasksChange); tasksCb.current = onTasksChange;
  const toastRef = useRef(toast); toastRef.current = toast;

  const held = (key: string) => (hold.current.get(key) ?? 0) > Date.now();

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const [o, a, s] = await Promise.all([api.asks('open'), api.asks('answered'), api.asks('snoozed')]);
      if (mine !== seq.current) return;
      const next = o.items.filter((i) => !held(i.key));
      const prev = serverRef.current;
      const gone = prev.filter((p) => !next.some((i) => i.key === p.key) && !held(p.key));
      const added = newKeys(prevKeys.current, next, new Set([...hold.current.keys()].filter(held)));
      prevKeys.current = next.map((i) => i.key);
      serverRef.current = next;
      setItems(next); setTotal(o.total - (o.items.length - next.length)); setSent(a.items); setSnoozed(s.items); setLatest(o.latest ?? a.latest); setNow(new Date());
      setPhase('ready'); setError('');
      if (gone.length) { setLeaving((l) => [...l, ...gone]); setTimeout(() => setLeaving((l) => l.filter((x) => !gone.includes(x))), LEAVE_MS); }
      if (added.length) onNewRef.current?.(next.filter((i) => added.includes(i.key)));
      if (added.length) { setFresh((f) => new Set([...f, ...added])); setTimeout(() => setFresh((f) => { const n = new Set(f); added.forEach((k) => n.delete(k)); return n; }), FRESH_MS); }
    } catch (e) {
      if (mine !== seq.current) return;
      setError(e instanceof Error ? e.message : 'Failed to load');
      setPhase((p) => (p === 'ready' ? p : 'error'));
    }
  }, [api]);

  // live stream (or polling) plus a minute tick that re-ranks by the clock
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (stream === null) return;
    const stop = connectLive({
      make: stream ? undefined : null,
      onStatus: setStatus,
      onChange: (kinds) => {
        if (kinds.some((k) => k === 'asks' || k === 'state' || k === 'poll')) void load();
        if (kinds.some((k) => k === 'tasks' || k === 'poll')) tasksCb.current();
      },
    });
    live.current = stop;
    const tick = setInterval(() => { if (document.visibilityState === 'visible') { setNow(new Date()); void load(); } }, 60_000);
    return () => { stop(); live.current = null; clearInterval(tick); };
  }, [load, stream]);
  /** Retry reopens a dropped stream and loads again. @req FR:web-shell/state.live */
  const retry = useCallback(async () => { live.current?.retry(); await load(); tasksCb.current(); }, [load]);

  // task asks join the list; the ones just answered stay out until the inbox knows
  const [, bump] = useState(0);
  const taskItems = (extras.tasks ?? []).filter((t) => !held(t.key));
  const ranked = useMemo(() => mergeNeeds(items, taskItems), [items, taskItems.map((t) => t.key).join('|')]);
  itemsRef.current = ranked;
  const total = serverTotal + taskItems.length;

  useEffect(() => { document.title = pageTitle(total); }, [total]);

  // keep the cursor on the same ask when the order changes
  useEffect(() => {
    const c = cursorRef.current;
    const i = c ? lastIndex.current : 0;
    setCursor(keepCursor(c, ranked, i));
  }, [ranked, setCursor]);
  const lastIndex = useRef(0);
  lastIndex.current = Math.max(0, ranked.findIndex((x) => x.key === cursor));

  const current = ranked.find((i) => i.key === cursor) ?? null;

  const release = (key: string) => { hold.current.delete(key); bump((n) => n + 1); };

  /** A 🙋 row: the answer goes to the project's agent inbox (or the row is deferred); the row leaves at once. */
  const answerTask = useCallback(async (a: AskItem, s: Send, sentText: string) => {
    const list = itemsRef.current;
    const at = list.findIndex((i) => i.key === a.key);
    hold.current.set(a.key, Date.now() + HOLD_MS);
    bump((n) => n + 1);
    setPanel('none'); setDetail(false);
    const after = list.filter((i) => i.key !== a.key);
    if (cursorRef.current === a.key) setCursor(after[Math.min(Math.max(at, 0), after.length - 1)]?.key ?? null);
    try {
      await extrasRef.current.onTask?.(a, s);
      toastRef.current(sentText, 'ok');
    } catch (e) {
      setCursor(a.key);
      toastRef.current(e instanceof Error ? e.message : 'Failed', 'err');
    } finally { release(a.key); }
  }, [setCursor, setPanel]);

  /** Answers an ask: it leaves the list at once; a failure puts it back. @req FR:ask-queue/web.optimistic */
  const answer = useCallback(async (a: AskItem, s: Send, sentText: string, undoable = true) => {
    if (a.source === 'task') return answerTask(a, s, sentText);
    const at = itemsRef.current.findIndex((i) => i.key === a.key);
    hold.current.set(a.key, Date.now() + HOLD_MS);
    const after = itemsRef.current.filter((i) => i.key !== a.key);
    setItems((x) => x.filter((i) => i.key !== a.key)); setTotal((n) => Math.max(0, n - 1)); setPanel('none'); setDetail(false);
    setLeaving((l) => [...l, a]); setTimeout(() => setLeaving((l) => l.filter((x) => x !== a)), LEAVE_MS);
    if (s.answer !== 'defer') setSent((x) => [{ ...a, state: 'answered', answer: s.answer, text: s.text }, ...x]);
    if (cursorRef.current === a.key) setCursor(after[Math.min(Math.max(at, 0), after.length - 1)]?.key ?? null);
    const call = api.answerAsk(a.key, s);
    call.catch(() => undefined);
    // Undo is ready at once; it waits for the write that is still in flight.
    const undo = undoable && s.answer !== 'defer' ? () => {
      undoRef.current = null;
      void (async () => {
        try { await call; await api.answerAsk(a.key, { answer: 'retract' }); release(a.key); await load(); setCursor(a.key); toastRef.current('Restored'); } catch (e) { toastRef.current(e instanceof Error ? e.message : 'Undo failed', 'err'); }
      })();
    } : undefined;
    undoRef.current = undo ?? null;
    try {
      await call;
      toastRef.current(sentText, 'ok', undo);
      setTimeout(() => { release(a.key); void load(); }, 400);
    } catch (e) {
      release(a.key);
      setCursor(a.key);
      toastRef.current(e instanceof ApiFailure && e.status === 409 ? 'Changed elsewhere. Reloaded.' : e instanceof Error ? e.message : 'Failed', 'err');
      await load();
    }
  }, [api, load, answerTask]);

  const reply = useCallback((a: AskItem, text: string) => {
    const t = text.trim();
    if (!t) return;
    const kind = replyKind(t);
    return answer(a, { answer: kind, text: t }, kind === 'ask' ? `Question sent to ${a.from}` : `Sent to ${a.from}`);
  }, [answer]);

  const defer = useCallback((a: AskItem, at: Date, label: string) => answer(a, { answer: 'defer', until: at.toISOString() }, `Deferred until ${label.toLowerCase()}`, false), [answer]);

  const retract = useCallback(async (a: AskItem) => {
    try { await api.answerAsk(a.key, { answer: 'retract' }); release(a.key); await load(); setCursor(a.key); toastRef.current('Restored'); }
    catch (e) { toastRef.current(e instanceof Error ? e.message : 'Undo failed', 'err'); }
  }, [api, load]);

  return {
    items: ranked, itemsRef, cursorRef, panelRef, leaving, sent, snoozed, total, latest, phase, error, status, cursor, setCursor, current, panel, setPanel, detail, setDetail, showAll, setShowAll, fresh, now,
    reload: load, retry, answer, reply, defer, retract, undo: () => undoRef.current?.(), deferChoices: () => deferChoices(new Date()),
    openTask: (ref: string) => extrasRef.current.onOpenTask?.(ref),
  };
}
export type Asks = ReturnType<typeof useAsks>;
