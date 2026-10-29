/**
 * Requirement map for the shell (the pieces live in App.tsx and its helpers).
 * @req FR:web-app/list.nav @req FR:web-app/keys.global @req FR:web-app/reorder.drag
 * @req FR:web-app/bulk.bar @req FR:web-app/capture.box @req FR:web-app/capture.project
 * @req FR:web-app/edit.notes @req FR:web-app/host.auth @req FR:web-app/host.nosecrets
 * @req FR:web-app/ux.feedback @req FR:web-app/ux.responsive
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ApiFailure, createClient } from './api';
import { capacityRows } from './capacity';
import { applyFilters, buildHash, parseHash, type Filters } from './filters';
import { Dialog, GROUP_NAMES, GROUPS, Help, Picker, Toasts, type GroupName, type Toast } from './parts';
import { filterCommands } from './palette';
import { keyboardMove, moveTarget, type RowPos } from './reorder';
import type { Agent, CaptureSpec, InboxItem, NextTask, Project, SetProps, Task, View } from './types';
import { actionable, activeTasks, DEFER, progress, rankNow, startsOpen, topTask, visibleRows } from './now';
import { buildPlan, decisions as decisionsOf, DEFAULT_DAY, planCandidates, type Decision } from './plan';
import { budgetOf, clampBudget, dateKey, loadBudget, saveBudget, STEP, store } from './day';
import { AsksView } from './AsksView';
import { actionsFor } from './asks';
import { useAsks } from './useAsks';
import { loadNotify, noteFor, notifySupported, raise, saveNotify } from './notify';
import { planWeek } from './week';
import { FocusMode, ListView, NowView, ProjectsView, TodayView, type NowSection, type RowProps } from './views';

const reads = new Set<(savedAt: string | null) => void>();
const api = createClient(undefined, undefined, (s) => reads.forEach((f) => f(s)));

/** Deletes every Stack cache (page and service worker) before the session ends or changes hands. @req FR:pwa/offline.private */
async function clearCaches() {
  try { navigator.serviceWorker?.controller?.postMessage({ type: 'clear' }); } catch { /* no worker */ }
  try { if ('caches' in window) await Promise.all((await caches.keys()).filter((k) => k.startsWith('stack-')).map((k) => caches.delete(k))); } catch { /* best effort */ }
}
async function signOut() {
  await clearCaches();
  location.assign('/.auth/logout');
}
type Phase = 'loading' | 'ready' | 'denied' | 'error';
interface Command { id: string; label: string; hint?: string; run: () => void }

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
/** An expired session may be followed by another account: drop the cached copy first. */
const toLogin = () => { void clearCaches().then(() => location.assign(`/.auth/login/github?post_login_redirect_uri=${encodeURIComponent(location.pathname + location.search + location.hash)}`)); };
const projectOf = (ref: string) => ref.slice(0, ref.lastIndexOf(':'));

export function App() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [loadError, setLoadError] = useState('');
  const [me, setMe] = useState('');
  const [local, setLocal] = useState(false);
  // The day plan is "from now": re-plan every minute and when the tab comes back.
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const bump = () => { if (document.visibilityState !== 'hidden') setTick((n) => n + 1); };
    const h = setInterval(bump, 60_000);
    document.addEventListener('visibilitychange', bump);
    return () => { clearInterval(h); document.removeEventListener('visibilitychange', bump); };
  }, []);
  const [info, setInfo] = useState<{ mode: string; repo: string; branch: string } | null>(null);
  const [allOpen, setAllOpen] = useState(false);
  const [focusRef, setFocusRef] = useState<string | null>(null);
  const [deferRefs, setDeferRefs] = useState<string[] | null>(null);
  const [captureOpen, setCaptureOpen] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [flipped, setFlipped] = useState<Set<string>>(new Set());
  const [{ view, filters }, setNav] = useState(() => parseHash(location.hash));
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [next, setNext] = useState<NextTask | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<string | null>(null);
  const [picker, setPicker] = useState<{ refs: string[]; groups: GroupName[] } | null>(null);
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const [working, setBusy] = useState(false);
  /** @req FR:pwa/offline.banner */
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine !== false);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const offline = !online || savedAt !== null;
  const busy = working || offline;
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [drag, setDrag] = useState<{ ref: string; over: string | null; half: 'top' | 'bottom' } | null>(null);
  const [captureText, setCaptureText] = useState('');
  const [preview, setPreview] = useState<{ spec?: CaptureSpec; error?: string } | null>(null);
  const [agentItems, setAgentItems] = useState<Agent[] | null>(null);
  const [agentsError, setAgentsError] = useState('');
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [saved, setSaved] = useState<{ date: string; minutes: number } | null>(() => { const now = new Date(); const m = loadBudget(store(), now); return m === null ? null : { date: dateKey(now), minutes: m }; });
  const lastProject = useRef<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const captureRef = useRef<HTMLInputElement | null>(null);
  const toastId = useRef(0);
  const chord = useRef<number>(0);

  // ---- derived
  const filtered = useMemo(() => applyFilters(tasks, filters), [tasks, filters]);
  const sectionKey = (t: Task) => `${t.project}/${t.section}`;
  const collapsed = useMemo(() => {
    const out = new Set<string>();
    for (const t of tasks) { const k = sectionKey(t); if (startsOpen(t.section) === flipped.has(k)) out.add(k); }
    return out;
  }, [tasks, flipped]);
  const searching = filters.q.trim() !== '' || filters.state !== 'open';
  const listRows = useMemo(() => visibleRows(filtered, tasks, expanded, collapsed, searching), [filtered, tasks, expanded, collapsed, searching]);
  const { sections, hidden } = useMemo(() => {
    const ranked = rankNow(activeTasks(tasks).filter((t) => t.ref !== next?.ref && actionable(t)), new Date(), tasks);
    const doing = ranked.filter((t) => /🚧/u.test(t.text));
    const rest = ranked.filter((t) => !doing.includes(t));
    const then = rest.slice(0, 5), more = rest.slice(5);
    const secs: NowSection[] = [{ id: 'doing', title: 'In progress', rows: doing }, { id: 'then', title: 'Then', rows: then }];
    if (allOpen) secs.push({ id: 'all', title: 'All active', rows: more });
    return { sections: secs, hidden: more.length };
  }, [tasks, next, allOpen]);
  const clockNow = useMemo(() => new Date(), [tasks, tick, saved]); // also refresh when the budget changes, so a value set after midnight counts for the new day
  const day = DEFAULT_DAY;
  // Kept with its date: a tab left open overnight must not keep yesterday's budget, and it works without storage.
  const budget = budgetOf(clockNow, day, saved && saved.date === dateKey(clockNow) ? saved.minutes : null);
  const plan = useMemo(() => buildPlan(planCandidates(tasks, clockNow, next?.ref), clockNow, day, budget.minutes), [tasks, next, clockNow, day, budget.minutes]);
  /** @req FR:web-app/today.capacity */
  const setBudget = useCallback((m: number | null) => { const v = m === null ? null : clampBudget(m); const now = new Date(); saveBudget(store(), now, v); setSaved(v === null ? null : { date: dateKey(now), minutes: v }); }, []);
  const decisions = useMemo(() => decisionsOf(tasks, clockNow), [tasks, clockNow]);
  const tops = useMemo(() => projects.map((p) => ({ project: p.name, title: p.title || p.name, task: topTask(tasks, p.name), open: p.open })), [projects, tasks]);
  const rows = view === 'asks' ? [] : view === 'today' ? plan.blocks.map((b) => b.task) : view === 'now' ? [...(next ? tasks.filter((t) => t.ref === next.ref) : []), ...sections.flatMap((s) => s.rows)] : listRows;
  const prog = useMemo(() => new Map(tasks.map((t, i) => [t.ref, progress(tasks, i)])), [tasks]);
  const positions: RowPos[] = useMemo(() => rows.map((t) => ({ ref: t.ref, project: t.project, depth: t.depth })), [rows]);
  const week = useMemo(() => planWeek(tasks, clockNow, budget.minutes, day), [tasks, clockNow, budget.minutes, day]);
  const capRows = useMemo(() => capacityRows(projects, tasks).map((r) => ({ ...r, top: topTask(tasks, r.project) })), [projects, tasks]);

  // ---- feedback
  const toast = useCallback((text: string, kind: Toast['kind'] = 'ok', undo?: () => void) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, text, kind, undo }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), undo ? 8000 : 4000);
  }, []);
  const dismiss = (id: number) => setToasts((t) => t.filter((x) => x.id !== id));

  // ---- data
  /** Agent activity and the inbox load on their own: a failure there never blocks the day plan. @req FR:web-app/today.agents */
  const loadSide = useCallback(async () => {
    const [a, i] = await Promise.allSettled([api.agents(), api.inbox()]);
    if (a.status === 'fulfilled') { setAgentItems(a.value); setAgentsError(''); } else setAgentsError(a.reason instanceof Error ? a.reason.message : 'Failed to load');
    if (i.status === 'fulfilled') setInbox(i.value);
  }, []);
  const refresh = useCallback(async () => {
    void loadSide();
    try {
      const [n, t, p] = await Promise.all([api.next(), api.tasks(), api.projects()]);
      setNext(n); setTasks(t); setProjects(p); setPhase('ready');
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 401) { toLogin(); return; }
      if (e instanceof ApiFailure && e.status === 403) { setPhase('denied'); return; }
      setLoadError(e instanceof Error ? e.message : 'Failed to load'); setPhase((p) => (p === 'ready' ? p : 'error'));
      if (phase === 'ready') toast(e instanceof Error ? e.message : 'Refresh failed', 'err');
    }
  }, [phase, toast]);

  /** @req FR:ask-queue/web.live (task files changing elsewhere refresh the rest of the app too) */
  const [stream, setStream] = useState<boolean | null>(null);
  /** @req FR:pwa/notify.optin @req FR:pwa/notify.new */
  const [notifyOn, setNotifyOn] = useState(() => loadNotify(store()));
  const [perm, setPerm] = useState(() => (notifySupported() ? Notification.permission : 'denied'));
  const notifyRef = useRef(false); notifyRef.current = notifyOn && perm === 'granted';
  const asks = useAsks(api, toast, () => void refresh(), stream, (items) => {
    if (!notifyRef.current || !document.hidden) return;
    const note = noteFor(items, new Date());
    if (note) void raise(note);
  });
  const toggleNotify = async () => {
    if (!notifySupported()) return;
    if (notifyOn) { saveNotify(store(), false); setNotifyOn(false); return; }
    const p = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    setPerm(p);
    if (p === 'granted') { saveNotify(store(), true); setNotifyOn(true); toast('Notifications on'); }
  };
  const notify = { supported: notifySupported(), on: notifyOn && perm === 'granted', blocked: perm === 'denied', toggle: () => void toggleNotify() };
  const refreshRef = useRef(refresh); refreshRef.current = refresh;
  useEffect(() => {
    const read = (s: string | null) => setSavedAt(s);
    reads.add(read);
    const up = () => { setOnline(true); setSavedAt(null); void refreshRef.current(); };
    const down = () => setOnline(false);
    window.addEventListener('online', up); window.addEventListener('offline', down);
    return () => { reads.delete(read); window.removeEventListener('online', up); window.removeEventListener('offline', down); };
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch('/.auth/me', { credentials: 'same-origin' });
        const j = (await r.json()) as { clientPrincipal?: { userDetails?: string; identityProvider?: string } | null; local?: { mode: string; repo: string; branch: string } | null; events?: boolean };
        setInfo(j.local ?? null);
        setStream(j.events === true);
        setMe(j.clientPrincipal?.userDetails ?? '');
        setLocal(j.clientPrincipal?.identityProvider === 'local');
      } catch { setStream(false); /* the api decides access */ }
      await refresh();
    })();
  }, []);

  // keep the cursor on a real row
  useEffect(() => {
    if (view === 'projects') return;
    if (cursor && rows.some((r) => r.ref === cursor)) return;
    setCursor(rows[0]?.ref ?? null);
  }, [rows, view, cursor]);
  useEffect(() => { if (focusRef && !tasks.some((t) => t.ref === focusRef)) setFocusRef(null); }, [tasks, focusRef]);
  useEffect(() => { setSelected((s) => { const live = new Set(tasks.map((t) => t.ref)); const n = new Set([...s].filter((r) => live.has(r))); return n.size === s.size ? s : n; }); }, [tasks]);

  // ---- navigation (hash)
  const go = useCallback((v: View, f: Filters = filters) => {
    setNav({ view: v, filters: f });
    window.scrollTo(0, 0);
    const h = buildHash(v, f);
    if (location.hash !== h) history.replaceState(null, '', h);
  }, [filters]);
  useEffect(() => { const on = () => setNav(parseHash(location.hash)); window.addEventListener('hashchange', on); return () => window.removeEventListener('hashchange', on); }, []);
  const setFilters = (patch: Partial<Filters>) => go('list', { ...filters, ...patch });

  // ---- writes
  const run = useCallback(async <T,>(fn: () => Promise<T>, okText?: (r: T) => string): Promise<T | undefined> => {
    setBusy(true);
    try {
      const r = await fn();
      const m = okText ? okText(r) : (r as { message?: string } | undefined)?.message;
      if (m) toast(m);
      await refresh();
      return r;
    } catch (e) {
      if (e instanceof ApiFailure && e.status === 401) { toLogin(); return; }
      if (e instanceof ApiFailure && e.status === 409) { toast('Changed elsewhere. Reloaded; try again.', 'err'); await refresh(); }
      else toast(e instanceof Error ? e.message : 'Failed', 'err');
    } finally { setBusy(false); }
  }, [refresh, toast]);

  const propsFor = (g: GroupName, e: string): SetProps => ({ [g]: e }) as SetProps;

  /** Find the row a stale ref meant: same ref with the same text, else the only row with that text in the project. */
  const resolve = (fresh: Task[], ref: string, text: string): string | null => {
    if (fresh.find((t) => t.ref === ref)?.text === text) return ref;
    const hits = fresh.filter((t) => t.text === text && t.project === projectOf(ref));
    return hits.length === 1 ? hits[0].ref : null;
  };

  /** Run one call per selected row, one at a time. Line numbers can shift after each write, so reload and re-resolve each ref by text first. */
  const sweep = async (refs: string[], fn: (ref: string) => Promise<unknown>) => {
    const texts = new Map(refs.map((r) => [r, tasks.find((t) => t.ref === r)?.text ?? '']));
    let ok = 0, why = '', stop = false;
    const left: string[] = [];
    setBusy(true);
    try {
      for (const ref of refs) {
        if (stop) { left.push(ref); continue; }
        try {
          const target = resolve(await api.tasks(), ref, texts.get(ref)!);
          if (!target) throw new ApiFailure(409, 'conflict', 'Changed elsewhere');
          await fn(target); ok++;
        } catch (err) {
          if (err instanceof ApiFailure && err.status === 401) { toLogin(); return null; }
          why ||= err instanceof Error ? err.message : 'Failed';
          left.push(ref);
          if (err instanceof ApiFailure && err.status === 409) { stop = true; why = 'Changed elsewhere. Reloaded; try again.'; }
        }
      }
    } finally { setBusy(false); }
    return { ok, why, left, failed: left.length };
  };

  const finishSweep = async (r: Awaited<ReturnType<typeof sweep>>, n: number, okWord: string) => {
    if (!r) return;
    toast(r.failed ? (n === 1 ? r.why : `${r.ok} ${okWord}, ${r.failed} failed. ${r.why}`) : n > 1 ? `${r.ok} ${okWord === 'done' ? 'done' : 'updated'}` : okWord === 'done' ? 'Done' : 'Updated', r.failed ? 'err' : 'ok');
    setSelected(new Set(r.left));
    await refresh();
  };

  const applyPick = async (refs: string[], g: GroupName, e: string) => {
    setPicker(null);
    await finishSweep(await sweep(refs, (ref) => api.set(ref, propsFor(g, e))), refs.length, 'updated');
  };

  const bulk = async (kind: 'complete' | 'skip') => {
    const refs = [...selected];
    await finishSweep(await sweep(refs, (ref) => api.action(kind, ref)), refs.length, 'done');
  };

  const refNow = (): string | undefined => focusRef ?? cursor ?? next?.ref;
  const doAct = async (a: 'start' | 'done' | 'skip', ref = refNow()) => {
    if (!ref) return;
    if (a === 'done') {
      if (await run(() => api.action('complete', ref), () => '')) toast('Done', 'ok', () => { void run(() => api.set(ref, { checkbox: 'Incomplete' }), () => 'Restored'); });
    } else await run(() => api.action(a, ref));
  };
  const applyDefer = async (refs: string[], d: (typeof DEFER)[number]) => {
    setDeferRefs(null);
    await run(() => api.action('suspend', refs[0], d.hours ? { hours: d.hours } : { days: d.days }), () => `Deferred: ${d.label.toLowerCase()}`);
  };
  /** Replies go to the project's agent inbox, never into the task file. @req FR:web-app/today.reply */
  const sendReply = async (task: Pick<Task, 'ref' | 'text'>, text: string, kind: 'reply' | 'decision', ok: string): Promise<boolean> =>
    (await run(() => api.send(task.ref, text, kind, task.text), () => ok)) !== undefined;
  const accept = (d: Decision) => sendReply(d.task, `Go with the recommendation: ${d.recommendation}`, 'decision', 'Sent to the agent');
  const openDefer = (ref = refNow()) => { if (ref) setDeferRefs([ref]); };

  const toggleDone = async (t: Task) => {
    if (t.done) { await run(() => api.set(t.ref, { checkbox: 'Incomplete' }), () => 'Reopened'); return; }
    if (await run(() => api.action('complete', t.ref), () => '')) toast('Done', 'ok', () => { void run(() => api.set(t.ref, { checkbox: 'Incomplete' }), () => 'Restored'); });
  };

  const save = async (ref: string, text: string) => {
    const cur = tasks.find((t) => t.ref === ref);
    setEditing(null);
    if (!cur || cur.text === text) return;
    await run(() => api.edit(ref, text, cur.text));
  };

  const doMove = async (ref: string, plan: { target: string; position: 'before' | 'after' } | null) => {
    if (!plan || busy) return;
    const expect = { ref: tasks.find((t) => t.ref === ref)?.text, target: tasks.find((t) => t.ref === plan.target)?.text };
    const r = await run(() => api.move(ref, plan.target, plan.position, expect), (x) => (x.changed ? 'Moved' : ''));
    if (r?.ref) setCursor(r.ref);
  };

  const dragOff = useRef<(() => void) | null>(null);
  useEffect(() => () => dragOff.current?.(), []);
  const onDragStart = (ref: string, e: PointerEvent) => {
    e.preventDefault();
    if (busy) return;
    dragOff.current?.();
    setDrag({ ref, over: null, half: 'bottom' });
    const find = (ev: PointerEvent) => {
      const el = (document.elementFromPoint(ev.clientX, ev.clientY) as HTMLElement | null)?.closest<HTMLElement>('[data-ref]');
      if (!el) return { over: null, half: 'bottom' as const };
      const b = el.getBoundingClientRect();
      return { over: el.dataset.ref!, half: ev.clientY < b.top + b.height / 2 ? ('top' as const) : ('bottom' as const) };
    };
    const move = (ev: PointerEvent) => setDrag({ ref, ...find(ev) });
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel);
      setDrag(null);
      const hit = find(ev);
      if (hit.over) void doMoveLatest.current(ref, moveTarget(latest.current.positions, ref, hit.over, hit.half));
    };
    const cancel = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); setDrag(null); };
    dragOff.current = cancel;
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', cancel);
  };

  // ---- capture
  const defaultProject = () => lastProject.current ?? (next ? next.project : projects[0]?.name);
  useEffect(() => { if (!captureOpen) { setCaptureText(''); setPreview(null); } }, [captureOpen]);
  useEffect(() => {
    const text = captureText.trim();
    if (!text) { setPreview(null); return; }
    let stale = false;
    const h = setTimeout(async () => {
      try { const r = await api.capture(text, { project: defaultProject(), dryRun: true }); if (!stale) setPreview({ spec: r.spec }); }
      catch (e) { if (!stale) setPreview({ error: e instanceof Error ? e.message : 'Cannot parse' }); }
    }, 250);
    return () => { stale = true; clearTimeout(h); };
  }, [captureText, next, projects]);

  const submitCapture = async () => {
    const text = captureText.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      const r = await api.capture(text, { project: defaultProject() });
      if (r.ref) lastProject.current = projectOf(r.ref);
      setCaptureText(''); setPreview(null); setCaptureOpen(false);
      toast(`Added: ${r.after ?? r.spec.title}`);
      await refresh();
    } catch (e) {
      setPreview({ error: e instanceof Error ? e.message : 'Capture failed' });
    } finally { setBusy(false); }
  };

  // ---- commands
  const targets = () => (selected.size ? [...selected] : (cursor ? [cursor] : []));
  const openPicker = (groups: GroupName[]) => { const refs = targets(); if (refs.length) setPicker({ refs, groups }); };
  const openCapture = () => setCaptureOpen(true);
  const commands: Command[] = [
    { id: 'go-asks', label: 'Go to Asks', hint: 'g k', run: () => go('asks') },
    ...(view === 'asks' && asks.current ? [
      ...actionsFor(asks.current).filter((x) => x.send || x.open).map((x) => ({ id: `ask-${x.id}`, label: `Ask: ${x.label}`, hint: x.key === 'Enter' ? '⏎' : x.key, run: () => { const a = asks.current!; if (x.open) { if (a.link) window.open(a.link, '_blank', 'noopener,noreferrer'); } else if (x.send) void asks.answer(a, x.send, `Sent to ${a.from}`); } })),
      { id: 'ask-defer', label: 'Ask: Defer', hint: 'z', run: () => asks.setPanel('defer') },
      { id: 'ask-reply', label: 'Ask: Reply to the agent', hint: 'r', run: () => asks.setPanel('reply') },
      { id: 'ask-undo', label: 'Ask: Undo last answer', hint: 'u', run: () => asks.undo() },
    ] : []),
    { id: 'go-today', label: 'Go to Today', hint: 'g t', run: () => go('today') },
    { id: 'go-now', label: 'Go to Focus', hint: 'g n', run: () => go('now', filters) },
    { id: 'go-projects', label: 'Go to Projects', hint: 'g p', run: () => go('projects') },
    { id: 'go-list', label: 'Go to all tasks', hint: 'g a', run: () => go('list') },
    { id: 'capture', label: 'Capture a task', hint: 'c', run: openCapture },
    { id: 'search', label: 'Search tasks', hint: '/', run: () => { go('list'); setTimeout(() => searchRef.current?.focus(), 0); } },
    ...(['open', 'done', 'all'] as const).map((s) => ({ id: `show-${s}`, label: `Show ${s} tasks`, run: () => go('list', { ...filters, state: s }) })),
    { id: 'clear', label: 'Clear filters', run: () => go('list', { q: '', project: '', state: 'open', status: '', priority: '', effort: '' }) },
    ...projects.map((p) => ({ id: `proj-${p.name}`, label: `Filter project: ${p.title || p.name}`, run: () => go('list', { ...filters, project: p.name }) })),
    ...GROUP_NAMES.map((g) => ({ id: `set-${g}`, label: `Set ${GROUPS[g].label.toLowerCase()} on ${selected.size ? 'selection' : 'row'}`, hint: GROUPS[g].key, run: () => openPicker([g]) })),
    { id: 'done', label: 'Mark done', hint: 'd', run: () => (selected.size ? void bulk('complete') : void doAct('done')) },
    { id: 'skip', label: 'Skip', hint: 'Shift+S', run: () => (selected.size ? void bulk('skip') : void doAct('skip')) },
    { id: 'start', label: 'Start', hint: 's', run: () => void doAct('start') },
    { id: 'defer', label: 'Defer', hint: 'z', run: openDefer },
    { id: 'focus', label: 'Focus mode', hint: 'Enter', run: () => { const r = refNow(); if (r) setFocusRef(r); } },
    { id: 'edit', label: 'Edit row text', hint: 'e', run: () => cursor && setEditing(cursor) },
    { id: 'more-time', label: 'More time today (+30m)', hint: ']', run: () => setBudget(budget.minutes + STEP) },
    { id: 'less-time', label: 'Less time today (-30m)', hint: '[', run: () => setBudget(budget.minutes - STEP) },
    { id: 'reset-time', label: 'Reset available time', run: () => setBudget(null) },
    { id: 'help', label: 'Show keyboard shortcuts', hint: '?', run: () => setHelp(true) },
    ...(notify.supported ? [{ id: 'notify', label: notify.on ? 'Turn off notifications' : 'Notify me about new asks', run: notify.toggle }] : []),
    { id: 'signout', label: 'Sign out', run: () => void signOut() },
  ];

  // ---- keyboard (reads latest state through a ref)
  const latest = useRef({ positions, rows, cursor, view, selected, editing, commands, picker, palette, help, focusRef, deferRefs, captureOpen, budget: budget.minutes });
  latest.current = { positions, rows, cursor, view, selected, editing, commands, picker, palette, help, focusRef, deferRefs, captureOpen, budget: budget.minutes };
  const doMoveLatest = useRef(doMove); doMoveLatest.current = doMove;
  const act = useRef({ doAct, openDefer, applyDefer, toggleDone, openPicker, applyPick, go, bulk, refNow, run, setBudget }); act.current = { doAct, openDefer, applyDefer, toggleDone, openPicker, applyPick, go, bulk, refNow, run, setBudget };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const L = latest.current, A = act.current;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); return; }
      if (e.key === 'Escape' && (L.palette || L.help || L.picker || L.deferRefs || L.captureOpen)) { e.preventDefault(); setPalette(false); setHelp(false); setPicker(null); setDeferRefs(null); setCaptureOpen(false); return; }
      if (e.key === 'Escape' && L.focusRef && !isTyping(e.target)) { e.preventDefault(); setFocusRef(null); return; }
      if (L.palette || L.help || L.captureOpen) return;
      if (L.deferRefs) {
        const d = DEFER.find((x) => x.key === e.key);
        if (d) { e.preventDefault(); void A.applyDefer(L.deferRefs, d); }
        return;
      }
      if (L.picker) {
        const g = L.picker.groups;
        if (g.length === 1 && /^[0-9]$/.test(e.key)) {
          const set = GROUPS[g[0]].set; const n = Number(e.key);
          const choice = n === 0 ? 'None' : set[n - 1]?.e;
          if (choice) { e.preventDefault(); void A.applyPick(L.picker.refs, g[0], choice); }
        }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (isTyping(e.target)) return;
      const k = e.key;
      if ((k === 'Enter' || k === ' ') && e.target instanceof HTMLElement && ['BUTTON', 'A'].includes(e.target.tagName)) return;
      const now = Date.now();
      if (chord.current && now - chord.current < 1000) {
        chord.current = 0;
        const v = { k: 'asks', t: 'today', n: 'now', p: 'projects', a: 'list' }[k] as View | undefined;
        if (v) { e.preventDefault(); setFocusRef(null); A.go(v); return; }
      }
      if (k === 'g') { chord.current = now; return; }
      if (k === ':') { e.preventDefault(); setPalette(true); return; }
      if (k === '?') { e.preventDefault(); setHelp(true); return; }
      if (k === 'c') { e.preventDefault(); setCaptureOpen(true); return; }
      if (k === '/') { e.preventDefault(); setFocusRef(null); A.go('list'); setTimeout(() => searchRef.current?.focus(), 0); return; }
      if (L.view === 'asks') return; // the Asks view owns its keys
      if (L.focusRef) {
        if (k === 's') void A.doAct('start'); else if (k === 'd') { const ft = L.rows.find((r) => r.ref === L.focusRef) ?? undefined; void A.doAct('done').then(() => { if (ft) setFocusRef(null); }); } else if (k === 'z') A.openDefer();
        return;
      }
      if (L.view === 'projects') return;
      if (L.view === 'today' && (k === '[' || k === ']')) { e.preventDefault(); A.setBudget(L.budget + (k === ']' ? STEP : -STEP)); return; }
      const i = L.rows.findIndex((r) => r.ref === L.cursor);
      const step = (d: number) => { const n = L.rows[Math.max(0, Math.min(L.rows.length - 1, i + d))]; if (n) setCursor(n.ref); };
      const inList = L.view === 'list';
      if (k === 'J' && L.cursor && inList) { e.preventDefault(); void doMoveLatest.current(L.cursor, keyboardMove(L.positions, L.cursor, 'down')); }
      else if (k === 'K' && L.cursor && inList) { e.preventDefault(); void doMoveLatest.current(L.cursor, keyboardMove(L.positions, L.cursor, 'up')); }
      else if (k === 'j' || k === 'ArrowDown') { e.preventDefault(); step(1); }
      else if (k === 'k' || k === 'ArrowUp') { e.preventDefault(); step(-1); }
      else if (k === 'Enter' && L.cursor) { e.preventDefault(); setFocusRef(L.cursor); }
      else if (k === 'e' && L.cursor) { e.preventDefault(); setEditing(L.cursor); }
      else if (k === 'ArrowRight' && L.cursor) { setExpanded((s) => new Set(s).add(L.cursor!)); }
      else if (k === 'ArrowLeft' && L.cursor) { setExpanded((s) => { const n = new Set(s); n.delete(L.cursor!); return n; }); }
      else if (k === 'x' && L.cursor) setSelected((s) => { const n = new Set(s); if (n.has(L.cursor!)) n.delete(L.cursor!); else n.add(L.cursor!); return n; });
      else if (k === 'Escape') { setSelected(new Set()); setCursor(null); }
      else if (k === 'd') { const t = L.rows.find((r) => r.ref === L.cursor); if (L.selected.size) void A.bulk('complete'); else if (t) void A.toggleDone(t); }
      else if (k === 's' && L.cursor) void A.doAct('start');
      else if (k === 'S') void A.doAct('skip');
      else if (k === 'z') A.openDefer();
      else if (k === 'p' || k === 't' || k === 'f' || k === 'i') A.openPicker([GROUP_NAMES.find((g) => GROUPS[g].key === k)!]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [run]);

  // ---- render
  if (phase === 'denied') {
    return (
      <main class="gate"><h1>Not on the allow-list</h1><p>You are signed in{me ? ` as ${me}` : ''}, but this Stack belongs to someone else.</p>
        <a class="btn" href="/.auth/logout" onClick={(e) => { e.preventDefault(); void signOut(); }}>Sign out</a></main>
    );
  }
  if (phase === 'error') {
    return <main class="gate"><h1>Cannot load tasks</h1><p>{loadError}</p><button type="button" class="btn primary" onClick={() => void refresh()}>Retry</button></main>;
  }
  const tabs: [View, string, string][] = [['asks', 'Asks', 'g k'], ['today', 'Today', 'g t'], ['now', 'Focus', 'g n'], ['projects', 'Projects', 'g p'], ['list', 'All tasks', 'g a']];
  const toggleSet = (set: 'expanded' | 'flipped') => (k: string) => (set === 'expanded' ? setExpanded : setFlipped)((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const rowProps: RowProps = {
    showProject: view === 'now' || view === 'today', titles: new Map(projects.map((x) => [x.name, x.title || x.name])), all: tasks, cursor, selected, editing, busy, expanded, handles: view === 'list', drag, prog,
    onSelect: (ref) => setSelected((s) => { const n = new Set(s); if (n.has(ref)) n.delete(ref); else n.add(ref); return n; }), onCursor: setCursor, onEdit: setEditing, onSave: (r, t) => void save(r, t), onToggle: (t) => void toggleDone(t),
    onPick: (refs, g) => setPicker({ refs: selected.size && selected.has(refs[0]) ? [...selected] : refs, groups: Array.isArray(g) ? g : [g] }),
    onMove: (ref, dir) => void doMove(ref, keyboardMove(positions, ref, dir)), onDragStart, onExpand: toggleSet('expanded'), onOpen: (r) => setFocusRef(r),
  };
  const focusTask = focusRef ? tasks.find((t) => t.ref === focusRef) : undefined;
  const nav = (cls: string, skip: View[] = []) => tabs.filter(([v]) => !skip.includes(v)).map(([v, label, hint]) => (
    <button type="button" key={v} class={`${cls}${view === v ? ' on' : ''}`} aria-current={view === v ? 'page' : undefined} onClick={() => go(v)}>{label}<kbd>{hint}</kbd></button>
  ));
  return (
    <div class="shell">
      <nav class="rail" aria-label="Views">
        <div class="brand">Stack</div>
        <button type="button" class="tab add" onClick={openCapture}>＋ New task <kbd>c</kbd></button>
        {nav('tab')}
        <div class="spacer" />
        <button type="button" class="tab" onClick={() => setPalette(true)} aria-label="Open command palette">Commands <kbd>⌘K</kbd></button>
        <button type="button" class="tab" onClick={() => setHelp(true)}>Shortcuts <kbd>?</kbd></button>
        <div class="who">{!local && me && <span>{me} · <a href="/.auth/logout" onClick={(e) => { e.preventDefault(); void signOut(); }}>Sign out</a></span>}</div>
      </nav>
      <main class="main" title={offline ? 'Offline' : undefined}>
        {offline && <div class="banner offline" role="status" data-testid="offline-banner">Offline · {savedAt ? `showing ${new Date(savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} copy` : 'showing the saved copy'}</div>}
        {local && <div class={`banner ${info?.mode ?? 'demo'}`} role="note" data-testid="repo-banner">{info ? <><strong>{info.mode === 'live' ? 'LIVE' : 'DEMO COPY'}</strong> · {info.repo} · {info.branch} · {info.mode === 'live' ? 'edits are committed' : 'edits stay in the copy'}</> : me}</div>}
        {phase === 'loading' && view !== 'asks' && <p class="loading">Loading…</p>}
        {view === 'asks' && <AsksView asks={asks} notify={notify} offline={offline} />}
        {phase === 'ready' && view === 'today' && (
          <TodayView now={clockNow} plan={plan} day={day} budget={budget} onBudget={setBudget} decisions={decisions} agents={agentItems} agentsError={agentsError} onRetryAgents={() => void loadSide()} inbox={inbox} p={rowProps} busy={busy} tops={tops} onProject={(p) => go('list', { ...filters, project: p, q: '', state: 'open' })}
            onAct={(act, ref) => (act === 'defer' ? openDefer(ref) : void doAct(act, ref))} onReply={(t, text, ok) => sendReply(t, text, 'reply', ok)} onAccept={(d) => void accept(d)} />
        )}
        {phase === 'ready' && view === 'now' && <NowView task={next} sections={sections} hidden={hidden} allOpen={allOpen} onToggleAll={() => setAllOpen((o) => !o)} p={rowProps} busy={busy} onAct={(a) => (a === 'defer' ? openDefer(next?.ref) : void doAct(a, next?.ref))} />}
        {phase === 'ready' && view === 'list' && (
          <ListView {...rowProps} rows={listRows} total={filtered.length} filters={filters} projects={projects} collapsed={collapsed} searchRef={searchRef}
            onFilters={setFilters} onSelect={(ref) => setSelected((s) => { const n = new Set(s); if (n.has(ref)) n.delete(ref); else n.add(ref); return n; })} onSection={toggleSet('flipped')} />
        )}
        {phase === 'ready' && view === 'projects' && <ProjectsView week={week} rows={capRows} onOpen={(p) => go('list', { ...filters, project: p, q: '', state: 'open' })} />}
      </main>
      {selected.size > 0 && view !== 'projects' && (
        <div class="bulk" role="toolbar" aria-label="Bulk edit">
          <strong>{selected.size} selected</strong>
          <button type="button" class="btn" disabled={busy} onClick={() => setPicker({ refs: [...selected], groups: GROUP_NAMES })}>Set…</button>
          {GROUP_NAMES.map((g) => <button type="button" class="btn desk" key={g} disabled={busy} onClick={() => setPicker({ refs: [...selected], groups: [g] })}>{GROUPS[g].label}</button>)}
          <button type="button" class="btn primary" disabled={busy} onClick={() => void bulk('complete')}>Done</button>
          <button type="button" class="btn" disabled={busy} onClick={() => void bulk('skip')}>Skip</button>
          <button type="button" class="btn" onClick={() => setSelected(new Set())}>Clear</button>
        </div>
      )}
      <nav class="tabbar" aria-label="Views (mobile)">
        {tabs.filter(([v]) => v !== 'list').map(([v, label]) => (
          <button type="button" key={v} class={`tab${view === v ? ' on' : ''}`} aria-current={view === v ? 'page' : undefined} onClick={() => go(v)}><TabIcon v={v} /><span>{label}</span></button>
        )).flatMap((b, i) => (i === 2 ? [<button type="button" key="add" class="tab add-fab" onClick={openCapture} aria-label="New task"><span class="fab" aria-hidden="true">+</span></button>, b] : [b]))}
        <button type="button" class="tab" onClick={() => setPalette(true)} aria-label="Open command palette"><TabIcon v="more" /><span>More</span></button>
      </nav>
      {focusTask && <FocusMode task={focusTask} all={tasks} busy={busy} onToggle={(t) => { void toggleDone(t); if (t.ref === focusRef && !t.done) setFocusRef(null); }} onAct={(a) => (a === 'defer' ? openDefer() : void doAct(a))} onBack={() => setFocusRef(null)} />}
      {picker && <Picker groups={picker.groups} count={picker.refs.length} onClose={() => setPicker(null)} onChoose={(g, e) => void applyPick(picker.refs, g, e)} />}
      {deferRefs && (
        <Dialog title="Defer until" onClose={() => setDeferRefs(null)}>
          <div class="picker-opts">{DEFER.map((d) => <button type="button" class="opt" key={d.key} onClick={() => void applyDefer(deferRefs, d)}><kbd>{d.key}</kbd> {d.label}</button>)}</div>
        </Dialog>
      )}
      {captureOpen && (
        <Dialog title="New task" onClose={() => setCaptureOpen(false)} sheet={false}>
          <input ref={captureRef} type="text" aria-label="Quick capture" placeholder="Call dentist tomorrow 30m #alpha" value={captureText} maxLength={2000} disabled={busy && !captureText}
            onInput={(e) => setCaptureText((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submitCapture(); } }} />
          <p class={`preview-line${preview?.error ? ' err' : ''}`} role="status" data-testid="capture-preview">
            {preview ? (preview.error ?? [preview.spec!.title, preview.spec!.due && `due ${preview.spec!.due}`, preview.spec!.effort && `${preview.spec!.effort.emoji} ${preview.spec!.effort.minutes}m`, preview.spec!.project && `#${preview.spec!.project}`].filter(Boolean).join(' · ')) : <>Natural language: due, effort, <code>#project</code>. <kbd>Enter</kbd> adds.</>}
          </p>
        </Dialog>
      )}
      {palette && <PaletteDialog commands={commands} onClose={() => setPalette(false)} />}
      {help && <Help onClose={() => setHelp(false)} />}
      <Toasts toasts={toasts} dismiss={dismiss} />
    </div>
  );
}

/** @req FR:web-app/palette.open */
function PaletteDialog({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [i, setI] = useState(0);
  const shown = filterCommands(commands, q);
  const choose = (c: Command | undefined) => { if (!c) return; onClose(); setTimeout(c.run, 0); };
  return (
    <Dialog title="Command palette" onClose={onClose} sheet={false}>
      <input type="text" role="combobox" aria-expanded="true" aria-controls="palette-list" aria-label="Command" placeholder="Type a command" value={q}
        onInput={(e) => { setQ((e.target as HTMLInputElement).value); setI(0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') { e.preventDefault(); setI((x) => Math.min(shown.length - 1, x + 1)); }
          else if (e.key === 'ArrowUp') { e.preventDefault(); setI((x) => Math.max(0, x - 1)); }
          else if (e.key === 'Enter') { e.preventDefault(); choose(shown[i]); }
        }} />
      <ul id="palette-list" class="cmds" role="listbox">
        {shown.map((c, n) => (
          <li key={c.id} role="option" aria-selected={n === i} class={n === i ? 'on' : ''} onMouseEnter={() => setI(n)} onClick={() => choose(c)}>
            <span>{c.label}</span>{c.hint && <kbd>{c.hint}</kbd>}
          </li>
        ))}
        {shown.length === 0 && <li class="none">No matching command</li>}
      </ul>
    </Dialog>
  );
}

/** Line icons for the phone tab bar. @req FR:pwa/install.standalone */
function TabIcon({ v }: { v: View | 'more' }) {
  const d: Record<string, string> = {
    asks: 'M12 3a6 6 0 0 0-6 6v3.6L4.3 15.4A1 1 0 0 0 5.2 17h13.6a1 1 0 0 0 .9-1.6L18 12.6V9a6 6 0 0 0-6-6Zm-2.2 15.5a2.3 2.3 0 0 0 4.4 0Z',
    today: 'M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm-1 5h16M8 3v4m8-4v4',
    now: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Zm0-5a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z',
    projects: 'M4 6h16M4 12h16M4 18h10',
    list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
  };
  return <svg class="tab-ic" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d={d[v]} fill="none" stroke="currentColor" stroke-width={v === 'more' ? 3 : 1.7} stroke-linecap="round" stroke-linejoin="round" /></svg>;
}
