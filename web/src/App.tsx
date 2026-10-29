/**
 * Requirement map for the shell (the pieces live in App.tsx and its helpers).
 * @req FR:web-app/list.nav @req FR:web-app/keys.global @req FR:web-app/reorder.drag
 * @req FR:web-app/bulk.bar @req FR:web-app/capture.box @req FR:web-app/capture.project
 * @req FR:web-app/edit.notes @req FR:web-app/host.auth @req FR:web-app/host.nosecrets
 * @req FR:web-app/ux.feedback @req FR:web-app/ux.responsive
 */
import { Fragment } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ApiFailure, createClient } from './api';
import { capacityRows } from './capacity';
import { applyFilters, buildHash, NO_FILTERS, parseHash, type Filters } from './filters';
import { Dialog, GROUP_NAMES, GROUPS, Help, Picker, Toasts, type GroupName, type Toast } from './parts';
import { filterCommands } from './palette';
import { keyboardMove, moveTarget, type RowPos } from './reorder';
import type { Agent, CaptureSpec, InboxItem, NextTask, Project, SetProps, Task, View } from './types';
import { DEFER, progress, startsOpen, topTask, visibleRows } from './now';
import { buildPlan, decisions as decisionsOf, DEFAULT_DAY, nowMinutes, planCandidates, span, type Decision } from './plan';
import { parseRow } from './row';
import { calendarRange, dayFrame, needsRefresh, withProjects, type DaySched } from './schedule';
import { allDay, busyIntervals, joinable, type CalEvent } from './meetings';
import { budgetOf, clampBudget, dateKey, loadSaved, saveBudget, STEP, store } from './day';
import { AsksView } from './AsksView';
import { actionsFor, type AskItem, type Send } from './asks';
import { useAsks } from './useAsks';
import { Drawer, SessionsView } from './SessionsView';
import { useSessions } from './useSessions';
import { blockedHelp, loadNotify, noteFor, notifySupported, raise, saveNotify } from './notify';
import { fromDecisions } from './needs';
import { repliesFor } from './agents';
import { CHORDS, HINT, LABEL, RAIL, TABBAR } from './nav';
import { useTeam } from './useTeam';
import { AgentChip, AgentTalk } from './AgentTalk';
import { agentForAsk } from './team';
import { planWeek } from './week';
import { FocusMode, HomeView, ListView, ProjectsView, TodayView, type RowProps } from './views';
import { HAVE, homeOf, windowNow } from './home';
import './myday.css';

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
type Group = 'Actions' | 'Go to' | 'Projects';
interface Command { id: string; label: string; hint?: string; group?: Group; run: () => void }

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
/** An expired session may be followed by another account: drop the cached copy first. */
const toLogin = () => { void clearCaches().then(() => location.assign(`/.auth/login/github?post_login_redirect_uri=${encodeURIComponent(location.pathname + location.search + location.hash)}`)); };
const projectOf = (ref: string) => ref.slice(0, ref.lastIndexOf(':'));
/** `2026-10-23` as `Fri, Oct 23`. */
const niceDate = (iso: string) => { const d = new Date(`${iso}T00:00`); return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); };

export function App() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [loadError, setLoadError] = useState('');
  const [me, setMe] = useState('');
  /** `provider:userId` as STACK_OWNERS wants it (SWA's per-app id). */
  const [ownerId, setOwnerId] = useState('');
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
  const [preview, setPreview] = useState<{ spec?: CaptureSpec; error?: string; retry?: 'preview' | 'submit' } | null>(null);
  const [previewTry, setPreviewTry] = useState(0);
  const [agentItems, setAgentItems] = useState<Agent[] | null>(null);
  const [agentsError, setAgentsError] = useState('');
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const [saved, setSaved] = useState<{ date: string; minutes: number } | null>(() => loadSaved(store()));
  /** @req FR:home/day.frame */
  const [sched, setSched] = useState<DaySched | null>(null);
  const [events, setEvents] = useState<CalEvent[]>([]);
  const [calError, setCalError] = useState('');
  const [calOn, setCalOn] = useState(true);
  /** Tomorrow's plan in My day: its schedule and meetings. @req FR:home/day.tomorrow */
  const [ahead, setAhead] = useState<{ sched: DaySched; events: CalEvent[] } | null>(null);
  /** "I have N min" from Home: memory only, runs out after N minutes. @req FR:home/home.have */
  const [have, setHaveRaw] = useState<{ minutes: number; at: number } | null>(null);
  const haveChord = useRef(0);
  const [emailAsks, setEmailAsks] = useState(0);
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
  const clockNow = useMemo(() => new Date(), [tasks, tick, saved]); // also refresh when the budget changes, so a value set after midnight counts for the new day
  // @req FR:home/day.blocks: blocks know their projects from "<Block> capacity" metadata
  const day = useMemo(() => withProjects(dayFrame(sched), projects), [sched, projects]);
  // Kept with its day (the waking day, which can run past midnight): a tab left open overnight must not keep yesterday's budget.
  const dayKey = sched?.date ?? dateKey(clockNow);
  const busyTime = useMemo(() => busyIntervals(events, day.origin ?? clockNow, day.origin ? 2 : 1), [events, clockNow, day]);
  const budget = budgetOf(clockNow, day, saved && saved.date === dayKey ? saved.minutes : null, busyTime);
  const plan = useMemo(() => buildPlan(planCandidates(tasks, clockNow, next?.ref), clockNow, day, budget.minutes, { busy: busyTime, email: emailAsks }), [tasks, next, clockNow, day, budget.minutes, busyTime, emailAsks]);
  // Tomorrow: the next waking day planned from its wake. @req FR:home/day.tomorrow
  const tmr = useMemo(() => {
    if (!ahead) return null;
    const d = withProjects(dayFrame({ ...ahead.sched, asleep: false }), projects);
    const at = new Date(ahead.sched.wake);
    const b = busyIntervals(ahead.events, d.origin!, 2);
    const bud = budgetOf(at, d, null, b);
    return { day: d, now: at, budget: bud, plan: buildPlan(planCandidates(tasks, at), at, d, bud.minutes, { busy: b }), events: ahead.events };
  }, [ahead, projects, tasks]);
  const offerTomorrow = !!sched && !sched.asleep && nowMinutes(clockNow, day) >= day.end - 180;
  const toggleTomorrow = useCallback(async () => {
    if (ahead) { setAhead(null); return; }
    if (!sched) return;
    const at = new Date(Date.parse(sched.bed) + 60_000);
    try {
      const s = await api.schedule(at.toISOString());
      if (!s) return;
      const r = calendarRange(s, at);
      const c = await api.calendar(r.from, r.to).catch(() => ({ items: [] as CalEvent[] }));
      setAhead({ sched: s, events: c.items });
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not load tomorrow', 'err'); }
  }, [ahead, sched]);
  /** Change wake/bed for the shown day or its weekday; the plan reloads. @req FR:home/day.override */
  const saveTimes = useCallback(async (c: { wake?: string; bed?: string; every?: boolean; reset?: boolean }): Promise<boolean> => {
    const shown = ahead?.sched ?? sched;
    if (!shown) return false;
    try {
      const s = await api.scheduleDay({ date: shown.date, ...c });
      if (ahead) setAhead({ ...ahead, sched: { ...s, asleep: false } }); else setSched(s);
      toast(c.reset ? 'Back to your usual hours' : c.every ? `Saved for every ${new Date(`${shown.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' })}` : 'Saved for this day');
      return true;
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not save', 'err'); return false; }
  }, [ahead, sched]);
  /** @req FR:web-app/today.capacity */
  const setBudget = useCallback((m: number | null) => { const v = m === null ? null : clampBudget(m); const now = new Date(); saveBudget(store(), now, v, dayKey); setSaved(v === null ? null : { date: dayKey, minutes: v }); }, [dayKey]);
  const decisions = useMemo(() => decisionsOf(tasks, clockNow), [tasks, clockNow]);
  const tops = useMemo(() => projects.map((p) => ({ project: p.name, title: p.title || p.name, task: topTask(tasks, p.name), open: p.open })), [projects, tasks]);
  const titles = useMemo(() => new Map(projects.map((x) => [x.name, x.title || x.name])), [projects]);
  /** @req FR:web-app/home.one @req FR:web-app/home.fit */
  const haveLeft = have ? have.minutes - Math.max(0, Math.floor((clockNow.getTime() - have.at) / 6e4)) : null;
  const setHave = useCallback((m: number | null) => setHaveRaw(m === null ? null : { minutes: m, at: Date.now() }), []);
  /** The time you have now: until the next meeting, personal block, or bed; "I have" overrides. @req FR:home/home.window */
  const win = useMemo(() => windowNow(day, busyTime, clockNow, haveLeft !== null && haveLeft > 0 ? haveLeft : null), [day, busyTime, clockNow, haveLeft]);
  // In personal time, tasks tagged for it may use the rest of the block. @req FR:home/home.window
  const minutesLeft = win.allow && !win.have ? win.allow.minutes : win.inside && !win.have ? 0 : win.minutes;
  const allow = win.allow && !win.have ? win.allow : undefined;
  const home = useMemo(() => homeOf({ tasks, projects, next, now: clockNow, minutesLeft, ...(allow ? { allow } : {}) }), [tasks, projects, next, clockNow, minutesLeft, allow]);
  const rows = view === 'asks' || view === 'sessions' ? [] : view === 'today' ? plan.blocks.map((b) => b.task) : view === 'home' ? (home.instead ? [home.instead.task, home.one?.task] : [home.one?.task]).concat(home.next.map((n) => n.task)).filter((t): t is Task => !!t) : listRows; // the task shown as NOW is first
  const prog = useMemo(() => new Map(tasks.map((t, i) => [t.ref, progress(tasks, i)])), [tasks]);
  const positions: RowPos[] = useMemo(() => rows.map((t) => ({ ref: t.ref, project: t.project, depth: t.depth })), [rows]);
  const week = useMemo(() => planWeek(tasks, clockNow, budget.minutes, DEFAULT_DAY), [tasks, clockNow, budget.minutes]);
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
    const d = new Date();
    // The waking day first: it sets the calendar range. @req FR:home/day.calendar
    const s = await api.schedule(d.toISOString()).catch(() => null);
    setSched(s);
    const range = calendarRange(s, d);
    const [a, i, c] = await Promise.allSettled([api.agents(), api.inbox(), api.calendar(range.from, range.to)]);
    /** @req FR:web-app/today.meetings */
    if (c.status === 'fulfilled') { setEvents(c.value.items); setCalError(c.value.error ?? ''); setCalOn(c.value.configured); } else setCalError('Calendar unavailable');
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
  const [agentsOn, setAgentsOn] = useState<boolean | null>(null);
  // Sessions also poll while a row has a live session or a composer open; the flag is state, so the hook sees it on the next render (a plain variable read here would always be false).
  const [teamActive, setTeamActive] = useState(false);
  /** @req FR:agent-sessions/web.view */
  const sessions = useSessions(api, toast, agentsOn, view === 'sessions' || teamActive);
  /** @req FR:agent-team/web.chip @req FR:agent-team/web.talk */
  const team = useTeam(api, toast, sessions, agentsOn, phase === 'ready', projects.map((p) => p.name));
  const wantActive = team.active || team.talk !== null;
  useEffect(() => { setTeamActive(wantActive); }, [wantActive]);
  /** @req FR:pwa/notify.optin @req FR:pwa/notify.new */
  const [notifyOn, setNotifyOn] = useState(() => loadNotify(store()));
  const [perm, setPerm] = useState(() => (notifySupported() ? Notification.permission : 'denied'));
  const notifyRef = useRef(false); notifyRef.current = notifyOn && perm === 'granted';
  /** Open 🙋 rows that have no reply yet, as asks. @req FR:web-shell/state.needs */
  const taskAsks = useMemo(() => fromDecisions(decisions.filter((d) => repliesFor(inbox, d.task).length === 0), titles, clockNow), [decisions, inbox, titles, clockNow]);
  const asks = useAsks(api, toast, () => void refresh(), stream, (items) => {
    if (!notifyRef.current || !document.hidden) return;
    const note = noteFor(items, new Date());
    if (note) void raise(note);
  }, {
    tasks: taskAsks,
    onTask: (a, s) => answerTask(a, s),
    onOpenTask: (ref) => { setFocusRef(ref); },
  });
  const toggleNotify = async () => {
    if (!notifySupported()) return;
    if (notifyOn) { saveNotify(store(), false); setNotifyOn(false); return; }
    if (Notification.permission === 'denied') { setPerm('denied'); toast(blockedHelp(), 'err'); return; }
    const p = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    setPerm(p);
    if (p === 'granted') { saveNotify(store(), true); setNotifyOn(true); toast('Notifications on'); }
    else if (p === 'denied') toast(blockedHelp(), 'err');
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
  /** A tab left open past bed moves to the next day. @req FR:home/day.refresh */
  useEffect(() => { if (needsRefresh(sched, new Date())) void loadSide(); }, [clockNow, sched, loadSide]); // a fresh clock: a new answer is never judged by a stale minute
  /** Open asks the email module wrote reserve the Email block. @req FR:web-app/today.mail */
  useEffect(() => { setEmailAsks(asks.items.filter((a) => a.state === 'open' && a.from === 'email-triage').length); }, [asks.items]);

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch('/.auth/me', { credentials: 'same-origin' });
        const j = (await r.json()) as { clientPrincipal?: { userDetails?: string; identityProvider?: string; userId?: string } | null; local?: { mode: string; repo: string; branch: string } | null; events?: boolean; agents?: boolean };
        setInfo(j.local ?? null);
        setStream(j.events === true);
        setAgentsOn(j.agents === true);
        setMe(j.clientPrincipal?.userDetails ?? '');
        setOwnerId(j.clientPrincipal?.identityProvider && j.clientPrincipal.userId ? `${j.clientPrincipal.identityProvider}:${j.clientPrincipal.userId}` : '');
        setLocal(j.clientPrincipal?.identityProvider === 'local');
      } catch { setStream(false); setAgentsOn(false); /* the api decides access */ }
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
    document.querySelector('.main')?.scrollTo(0, 0); // the content region scrolls, never the document
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
  const taskAt = (ref?: string) => (ref ? tasks.find((t) => t.ref === ref) : undefined);
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
  /** A 🙋 row answered from Needs you: decision or reply to the inbox, or the row deferred. @req FR:web-shell/state.needs */
  const answerTask = async (a: AskItem, s: Send) => {
    const t = tasks.find((x) => x.ref === a.ref);
    if (!t) throw new Error('Row changed elsewhere');
    let ok: unknown;
    if (s.answer === 'go') ok = await sendReply(t, `Go with the recommendation: ${a.recommend}`, 'decision', '');
    else if (s.answer === 'defer' && s.until) ok = await run(() => api.action('suspend', t.ref, { hours: Math.max(1, Math.round((new Date(s.until!).getTime() - Date.now()) / 3600_000)) }), () => '');
    else ok = await sendReply(t, s.text ?? '', 'reply', '');
    if (!ok) throw Object.assign(new Error('Not sent'), { shown: true }); // `run` already toasted the reason
    // The row leaves Needs you only once the inbox shows the reply: wait for it, so it never pops back.
    try { setInbox(await api.inbox()); } catch { /* the next refresh catches up */ }
  };
  const openDefer = (ref = refNow()) => { if (ref) setDeferRefs([ref]); };
  /** Not now: back in 2 hours, one key. Delegate: 🪄 on the row, so an agent takes it (undo restores). @req FR:home/home.delegate */
  const notNow = async (ref = refNow()) => {
    if (!ref) return;
    const back = new Date(Date.now() + 2 * 3600_000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    await run(() => api.action('suspend', ref, { hours: 2 }), () => `Not now: back at ${back}`);
  };
  const delegate = async (ref = refNow()) => {
    const t = ref ? tasks.find((x) => x.ref === ref) : undefined;
    if (!t) return;
    if (parseRow(t.text).who === 'agent') { toast('Already with an agent'); return; }
    const text = `🪄 ${t.text}`;
    if (await run(() => api.edit(t.ref, text, t.text), () => '')) toast(`🪄 Delegated to the ${titles.get(t.project) ?? t.project} agent`, 'ok', () => { void run(() => api.edit(t.ref, t.text, text), () => 'Restored'); });
  };
  type RowAct = 'start' | 'done' | 'defer' | 'notnow' | 'delegate';
  const rowAct = (a: RowAct, ref?: string) => (a === 'defer' ? openDefer(ref) : a === 'notnow' ? void notNow(ref) : a === 'delegate' ? void delegate(ref) : void doAct(a, ref));

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
      catch (e) { if (!stale) setPreview({ error: e instanceof Error ? e.message : 'Cannot parse', retry: e instanceof ApiFailure && e.status === 0 ? 'preview' : undefined }); }
    }, 250);
    return () => { stale = true; clearTimeout(h); };
  }, [captureText, next, projects, previewTry]);

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
      // @req FR:web-shell/state.capture
      setPreview({ error: e instanceof Error ? e.message : 'Capture failed', retry: e instanceof ApiFailure && e.status === 0 ? 'submit' : undefined });
    } finally { setBusy(false); }
  };

  // ---- commands
  const targets = () => (selected.size ? [...selected] : (cursor ? [cursor] : []));
  const openPicker = (groups: GroupName[]) => { const refs = targets(); if (refs.length) setPicker({ refs, groups }); };
  const openCapture = () => setCaptureOpen(true);
  const hasRows = view === 'home' || view === 'today' || view === 'list';
  const commands: Command[] = [
    ...(view === 'asks' && asks.current ? [
      ...actionsFor(asks.current).filter((x) => x.send || x.open).map((x) => ({ id: `ask-${x.id}`, label: `Ask: ${x.label}`, hint: x.key === 'Enter' ? '⏎' : x.key, run: () => { const a = asks.current!; if (x.open) { if (a.link) window.open(a.link, '_blank', 'noopener,noreferrer'); } else if (x.send) void asks.answer(a, x.send, `Sent to ${a.from}`); } })),
      { id: 'ask-defer', label: 'Ask: Defer', hint: 'z', run: () => asks.setPanel('defer') },
      { id: 'ask-reply', label: 'Ask: Reply to the agent', hint: 'r', run: () => asks.setPanel('reply') },
      { id: 'ask-undo', label: 'Ask: Undo last answer', hint: 'u', run: () => asks.undo() },
    ] : []),
    ...(view === 'sessions' ? [
      { id: 'sess-open', label: 'Session: open', hint: '⏎', run: () => { if (sessions.cursor) void sessions.openDrawer(sessions.cursor); } },
      { id: 'sess-new', label: 'Session: new', hint: 'n', run: () => sessions.setComposing(true) },
      { id: 'sess-stop', label: 'Session: stop the run', hint: 's', run: () => void sessions.stop(sessions.open ?? sessions.cursor ?? undefined) },
      { id: 'sess-costs', label: 'Session: toggle costs', hint: 'c', run: () => sessions.setShowCosts(!sessions.showCosts) },
    ] : []),
    { id: 'capture', label: 'New task', hint: 'c', run: openCapture },
    { id: 'search', label: 'Search tasks', hint: '/', run: () => { go('list'); setTimeout(() => searchRef.current?.focus(), 0); } },
    ...(['open', 'done', 'all'] as const).map((s) => ({ id: `show-${s}`, label: `Show ${s} tasks`, run: () => go('list', { ...filters, state: s }) })),
    { id: 'clear', label: 'Clear filters', run: () => go('list', NO_FILTERS) },
    // @req FR:web-shell/palette.scope
    ...(hasRows ? [
      ...GROUP_NAMES.map((g) => ({ id: `set-${g}`, label: `Set ${GROUPS[g].label.toLowerCase()} on ${selected.size ? 'selection' : 'row'}`, hint: GROUPS[g].key, run: () => openPicker([g]) })),
      { id: 'done', label: 'Mark done', hint: 'd', run: () => (selected.size ? void bulk('complete') : void doAct('done')) },
      { id: 'skip', label: 'Skip', hint: 'Shift+S', run: () => (selected.size ? void bulk('skip') : void doAct('skip')) },
      { id: 'start', label: 'Start', hint: 's', run: () => void doAct('start') },
      { id: 'defer', label: 'Defer', hint: 'z', run: openDefer },
      { id: 'notnow', label: 'Not now (2 hours)', hint: 'n', run: () => void notNow() },
      { id: 'delegate', label: 'Delegate to an agent (🪄)', hint: 'Shift+A', run: () => void delegate() },
      { id: 'focus', label: 'Focus mode', hint: 'Enter', run: () => { const r = refNow(); if (r) setFocusRef(r); } },
      { id: 'edit', label: 'Edit row text', hint: 'e', run: () => cursor && setEditing(cursor) },
      // @req FR:agent-team/web.keys
      { id: 'talk', label: 'Talk to the task agent', hint: 'a', run: () => { const t = taskAt(refNow()); if (t) team.toggleTalk({ ref: t.ref, project: t.project, about: t.text }); } },
      { id: 'review', label: 'Review: can the agent do this task?', hint: 'R', run: () => { const r = refNow(); if (r) void team.review(r); } },
    ] : []),
    ...(view === 'home' ? HAVE.map((m, i) => ({ id: `have-${m}`, label: `I have ${span(m)}`, hint: `h ${i + 1}`, run: () => setHave(m) })) : []),
    ...(view === 'today' ? [
      { id: 'more-time', label: 'More time today (+30m)', hint: ']', run: () => setBudget(budget.minutes + STEP) },
      { id: 'less-time', label: 'Less time today (-30m)', hint: '[', run: () => setBudget(budget.minutes - STEP) },
      { id: 'reset-time', label: 'Reset available time', run: () => setBudget(null) },
    ] : []),
    { id: 'help', label: 'Show keyboard shortcuts', hint: '?', run: () => setHelp(true) },
    ...(notify.supported ? [{ id: 'notify', label: notify.on ? 'Turn off notifications' : 'Notify me about new asks', run: notify.toggle }] : []),
    { id: 'signout', label: 'Sign out', run: () => void signOut() },
  ].map((c) => ({ group: 'Actions' as Group, ...c }));
  // grouped: actions first, then places, then every project by name (typing a name ranks it first). @req FR:web-shell/palette.jump
  const goTo: Command[] = [
    { id: 'go-home', label: 'Go to Home', hint: HINT.home, group: 'Go to', run: () => go('home') },
    { id: 'go-today', label: 'Go to My day', hint: HINT.today, group: 'Go to', run: () => go('today') },
    ...(sched ? [{ id: 'tomorrow', label: tmr ? 'My day: back to today' : 'Plan tomorrow', group: 'Go to' as Group, run: () => { go('today'); void toggleTomorrow(); } }] : []), // @req FR:home/day.tomorrow
    { id: 'go-asks', label: `Go to Needs you${asks.total ? ` (${asks.total})` : ''}`, hint: HINT.asks, group: 'Go to', run: () => go('asks') },
    { id: 'go-projects', label: 'Go to Projects', hint: HINT.projects, group: 'Go to', run: () => go('projects') },
    { id: 'go-list', label: 'Go to Full stack', hint: HINT.list, group: 'Go to', run: () => go('list') },
  ];
  const projectCmds: Command[] = projects.map((p) => ({ id: `proj-${p.name}`, label: p.title || p.name, group: 'Projects' as Group, run: () => go('list', { ...NO_FILTERS, project: p.name }) }));
  const allCommands = [...commands, ...goTo, ...projectCmds];

  // ---- keyboard (reads latest state through a ref)
  const latest = useRef({ positions, rows, cursor, view, selected, editing, commands: allCommands, picker, palette, help, focusRef, deferRefs, captureOpen, budget: budget.minutes, busyTime, events, minutesLeft });
  latest.current = { positions, rows, cursor, view, selected, editing, commands: allCommands, picker, palette, help, focusRef, deferRefs, captureOpen, budget: budget.minutes, busyTime, events, minutesLeft };
  const doMoveLatest = useRef(doMove); doMoveLatest.current = doMove;
  const teamRef = useRef(team); teamRef.current = team;
  const act = useRef({ doAct, openDefer, applyDefer, toggleDone, openPicker, applyPick, go, bulk, refNow, run, setBudget, notNow, delegate, setHave }); act.current = { doAct, openDefer, applyDefer, toggleDone, openPicker, applyPick, go, bulk, refNow, run, setBudget, notNow, delegate, setHave };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (haveChord.current && !/^[0-4h]$/.test(e.key)) haveChord.current = 0; // any other key disarms h
      const L = latest.current, A = act.current;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); return; }
      if (e.key === 'Escape' && (L.palette || L.help || L.picker || L.deferRefs || L.captureOpen)) { e.preventDefault(); setPalette(false); setHelp(false); setPicker(null); setDeferRefs(null); setCaptureOpen(false); return; }
      if (e.key === 'Escape' && teamRef.current.talk && !isTyping(e.target)) { e.preventDefault(); teamRef.current.setTalk(null); return; }
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
        const v = CHORDS[k];
        if (v) { e.preventDefault(); setFocusRef(null); A.go(v); return; }
      }
      if (k === 'g') { chord.current = now; return; }
      if (k === ':') { e.preventDefault(); setPalette(true); return; }
      if (k === '?') { e.preventDefault(); setHelp(true); return; }
      if (k === 'c' && L.view !== 'sessions') { e.preventDefault(); setCaptureOpen(true); return; } // Sessions uses c for costs
      if (k === '/') { e.preventDefault(); setFocusRef(null); A.go('list'); setTimeout(() => searchRef.current?.focus(), 0); return; }
      if (L.view === 'asks' || L.view === 'sessions') return; // these views own their keys
      if (L.focusRef) {
        if (k === 's') void A.doAct('start'); else if (k === 'd') { const ft = L.rows.find((r) => r.ref === L.focusRef) ?? undefined; void A.doAct('done').then(() => { if (ft) setFocusRef(null); }); } else if (k === 'z') A.openDefer();
        return;
      }
      if (L.view === 'projects') return;
      // @req FR:home/home.have: h then 1-4 picks 15m/30m/1h/2h, 0 clears
      if (L.view === 'home' && haveChord.current && now - haveChord.current < 1500 && /^[0-4]$/.test(k)) { e.preventDefault(); haveChord.current = 0; A.setHave(k === '0' ? null : HAVE[Number(k) - 1]); return; }
      if (L.view === 'home' && k === 'h') { haveChord.current = now; return; }
      // On My day these act only on the row you are on (never on a hidden parent).
      if ((L.view === 'home' || (L.view === 'today' && L.cursor)) && k === 'n') { e.preventDefault(); void A.notNow(); return; }
      if ((L.view === 'home' || (L.view === 'today' && L.cursor)) && k === 'A') { e.preventDefault(); void A.delegate(); return; }
      // @req FR:web-app/today.meetings: J joins the meeting on now or starting within 10 minutes
      if (L.view === 'today' && k === 'J') { const url = joinable(L.events, new Date()); if (url) { e.preventDefault(); window.open(url, '_blank', 'noopener,noreferrer'); } return; }
      if (L.view === 'today' && (k === '[' || k === ']')) { e.preventDefault(); A.setBudget(L.budget + (k === ']' ? STEP : -STEP)); return; }
      // On Home, [ ] change the time you have now. @req FR:home/home.have
      if (L.view === 'home' && (k === '[' || k === ']')) { e.preventDefault(); A.setHave(Math.max(0, L.minutesLeft + (k === ']' ? STEP : -STEP))); return; }
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
      // @req FR:agent-team/web.keys
      else if (k === 'a' && L.cursor) { e.preventDefault(); const t = L.rows.find((r) => r.ref === L.cursor); if (t) teamRef.current.toggleTalk({ ref: t.ref, project: t.project, about: t.text }); }
      else if (k === 'R' && L.cursor) { e.preventDefault(); void teamRef.current.review(L.cursor); }
      else if (k === 'p' || k === 't' || k === 'f' || k === 'i') A.openPicker([GROUP_NAMES.find((g) => GROUPS[g].key === k)!]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [run]);

  // ---- render
  if (phase === 'denied') {
    return (
      <main class="gate"><h1>Not on the allow-list</h1><p>You are signed in{me ? ` as ${me}` : ''}, but this Stack belongs to someone else.</p>
        {/* SWA's user id is per app, so the owner learns it here on first sign-in. @req FR:live-deploy/setup.owner */}
        {ownerId && <p>If this is your Stack, add yourself as the owner, then reload: <code data-testid="owner-cmd">scripts/setup-azure.sh --owner {ownerId}</code></p>}
        <a class="btn" href="/.auth/logout" onClick={(e) => { e.preventDefault(); void signOut(); }}>Sign out</a></main>
    );
  }
  if (phase === 'error') {
    return <main class="gate"><h1>Cannot load tasks</h1><p>{loadError}</p><button type="button" class="btn primary" onClick={() => void refresh()}>Retry</button></main>;
  }
  const toggleSet = (set: 'expanded' | 'flipped') => (k: string) => (set === 'expanded' ? setExpanded : setFlipped)((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const rowProps: RowProps = {
    showProject: view === 'home' || view === 'today', titles, all: tasks, cursor, selected, editing, busy, expanded, handles: view === 'list', drag, prog,
    onSelect: (ref) => setSelected((s) => { const n = new Set(s); if (n.has(ref)) n.delete(ref); else n.add(ref); return n; }), onCursor: setCursor, onEdit: setEditing, onSave: (r, t) => void save(r, t), onToggle: (t) => void toggleDone(t),
    onPick: (refs, g) => setPicker({ refs: selected.size && selected.has(refs[0]) ? [...selected] : refs, groups: Array.isArray(g) ? g : [g] }),
    onMove: (ref, dir) => void doMove(ref, keyboardMove(positions, ref, dir)), onDragStart, onExpand: toggleSet('expanded'), onOpen: (r) => setFocusRef(r),
    agent: {
      chip: (t) => { const v = team.chipOf(t); return <AgentChip view={v} onClick={() => { if (v.tone === 'accent' || v.tone === 'warn' || v.text.startsWith('Done')) team.openSession(t.ref); else team.toggleTalk({ ref: t.ref, project: t.project, about: t.text }); }} onNeeds={() => go('asks')} />; },
      talk: (t) => (team.talk?.ref === t.ref ? <AgentTalk key={t.ref} team={team} talk={team.talk} agents={team.agentsOf(t)} /> : null),
    },
  };
  /** The composer for an ask card: the ask's agent, the ask as the context. @req FR:agent-team/web.anything */
  const askTalk = {
    chip: (a: { key: string; from: string; project?: string }) => { const ag = agentForAsk(team.team, a); return ag ? <AgentChip view={{ text: ag.slug === a.from || ag.name === a.from ? 'Talk' : ag.name, tone: 'plain', title: `Talk to ${ag.name} (a)` }} onClick={() => team.toggleTalk({ askKey: a.key, project: a.project ?? ag.projects[0] ?? '', about: a.key })} /> : null; },
    render: (a: { key: string; ask: string; from: string; project?: string }) => (team.talk?.askKey === a.key ? <AgentTalk key={a.key} team={team} talk={{ ...team.talk, about: a.ask }} agents={[...new Set([agentForAsk(team.team, a), ...(a.project ? team.agentsOf({ project: a.project, section: '' }) : [])].filter((x): x is NonNullable<typeof x> => !!x))]} /> : null),
    open: (a: { key: string; ask: string; from: string; project?: string }) => { const ag = agentForAsk(team.team, a); team.toggleTalk({ askKey: a.key, project: a.project ?? ag?.projects[0] ?? '', about: a.ask }); },
    isOpen: () => team.talk?.askKey !== undefined, close: () => team.setTalk(null),
  };
  const tileAgent = {
    chip: (project: string, title: string) => { const ag = team.agentsOf({ project, section: '' })[0]; return <AgentChip view={ag ? { text: ag.name, tone: 'plain', title: `Talk to ${ag.name} about ${title}` } : { text: 'No agent', tone: 'muted', title: 'No agent covers this project' }} onClick={() => team.toggleTalk({ project, about: title })} />; },
    talk: (project: string, title: string) => (team.talk && !team.talk.ref && !team.talk.askKey && team.talk.project === project ? <AgentTalk key={project} team={team} talk={{ project, about: title }} agents={team.agentsOf({ project, section: '' })} /> : null),
  };
  const focusTask = focusRef ? tasks.find((t) => t.ref === focusRef) : undefined;
  // @req FR:web-shell/nav.rail
  const badge = (v: View) => (v === 'asks' && asks.total > 0 ? <span class="badge" aria-label={`${asks.total} open`}>{asks.total}</span> : null);
  const nav = () => RAIL.map((v) => (
    <button type="button" key={v} class={`tab${view === v ? ' on' : ''}`} aria-current={view === v ? 'page' : undefined} onClick={() => go(v)}><span class="tab-label">{LABEL[v]}{badge(v)}</span><kbd>{HINT[v]}</kbd></button>
  ));
  return (
    <div class="shell">
      <nav class="rail" aria-label="Views">
        <div class="brand">Stack</div>
        <button type="button" class="tab add" onClick={openCapture}>＋ New task <kbd>c</kbd></button>
        {nav()}
        <div class="spacer" />
        <button type="button" class="tab" onClick={() => setPalette(true)} aria-label="Open command palette">Commands <kbd>⌘K</kbd></button>
        <button type="button" class="tab" onClick={() => setHelp(true)}>Shortcuts <kbd>?</kbd></button>
        <div class="who">
          {local && <span class={`repo-pill ${info?.mode ?? 'demo'}`} role="note" data-testid="repo-banner" title={info ? `${info.repo} · ${info.branch} · ${info.mode === 'live' ? 'edits are committed' : 'edits stay in the copy'}` : undefined}>{info ? <><strong>{info.mode === 'live' ? 'Live' : 'Demo copy'}</strong> · {info.branch}</> : me}</span>}
          {!local && me && <span>{me} · <a href="/.auth/logout" onClick={(e) => { e.preventDefault(); void signOut(); }}>Sign out</a></span>}
        </div>
      </nav>
      <main class="main" title={offline ? 'Offline' : undefined}>
        {offline && <div class="banner offline" role="status" data-testid="offline-banner">Offline · {savedAt ? `showing ${new Date(savedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} copy` : 'showing the saved copy'}</div>}
        {local && <div class={`banner mobile-only ${info?.mode ?? 'demo'}`} role="note" data-testid="repo-pill" title={info ? `${info.repo} · ${info.branch}` : undefined}>{info ? <strong>{info.mode === 'live' ? 'Live' : 'Demo copy'}</strong> : me}</div>}
        {phase === 'loading' && view !== 'asks' && view !== 'sessions' && <div class="skeleton" role="status" aria-busy="true" aria-label="Loading"><div class="sk big" /><div class="sk" /><div class="sk" /><div class="sk" /></div>}
        {view === 'asks' && <AsksView asks={asks} notify={notify} offline={offline} onSignIn={toLogin} talk={askTalk} />}
        {view === 'sessions' && <SessionsView s={sessions} enabled={agentsOn} />}
        {phase === 'ready' && view === 'today' && (
          <TodayView allDay={allDay(tmr?.events ?? events)} calError={calError} onEmail={() => go('asks')} now={tmr?.now ?? clockNow} plan={tmr?.plan ?? plan} day={tmr?.day ?? day} budget={tmr?.budget ?? budget} onBudget={setBudget}
            onTimes={sched ? saveTimes : undefined} calendar={calOn} tomorrow={{ offer: offerTomorrow, on: !!tmr, toggle: () => void toggleTomorrow() }} decisions={decisions} agents={agentItems} agentsError={agentsError} onRetryAgents={() => void loadSide()} inbox={inbox} p={rowProps} busy={busy} tops={tops} tileAgent={tileAgent} onProject={(p) => go('list', { ...filters, project: p, q: '', state: 'open' })}
            onAct={rowAct} onReply={(t, text, ok) => sendReply(t, text, 'reply', ok)} onAccept={(d) => void accept(d)} />
        )}
        {phase === 'ready' && view === 'home' && <HomeView h={home} now={clockNow} minutesLeft={minutesLeft} win={win} have={haveLeft !== null && haveLeft > 0 ? have!.minutes : null} onHave={setHave} p={rowProps} busy={busy} onAct={(a, ref) => rowAct(a, ref ?? next?.ref)} onProject={(p) => go('list', { ...NO_FILTERS, project: p })} onMoreTime={() => setHave(minutesLeft + STEP)} />}
        {phase === 'ready' && view === 'list' && (
          <ListView {...rowProps} rows={listRows} total={filtered.length} filters={filters} projects={projects} collapsed={collapsed} searchRef={searchRef}
            onFilters={setFilters} onSelect={(ref) => setSelected((s) => { const n = new Set(s); if (n.has(ref)) n.delete(ref); else n.add(ref); return n; })} onSection={toggleSet('flipped')} />
        )}
        {phase === 'ready' && view === 'projects' && <ProjectsView week={week} rows={capRows} onOpen={(p) => go('list', { ...filters, project: p, q: '', state: 'open' })} />}
      </main>
      {/* The session drawer from a row, outside the Sessions view. @req FR:agent-team/web.talk */}
      {view !== 'sessions' && sessions.open && <div class="sess-scrim" onClick={sessions.closeDrawer} />}
      {view !== 'sessions' && sessions.open && <Drawer key={sessions.open} s={sessions} item={sessions.items.find((i) => i.id === sessions.open) ?? null} cursorItem={null} onClose={sessions.closeDrawer} />}
      {team.talk && (view === 'today' || view === 'projects') && team.talk.ref && <AgentTalk key={team.talk.ref} team={team} talk={team.talk} agents={team.agentsOf(taskAt(team.talk.ref) ?? { project: team.talk.project, section: '' })} float />}
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
      {/* @req FR:web-shell/nav.tabbar */}
      <nav class="tabbar" aria-label="Views (mobile)">
        {TABBAR.map((slot) => slot === 'new'
          ? <button type="button" key="new" class="tab add-fab" onClick={openCapture} aria-label="New task"><span class="fab" aria-hidden="true"><svg viewBox="0 0 24 24" width="22" height="22"><path d="M12 5v14M5 12h14" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" /></svg></span></button>
          : slot === 'more'
            ? <button type="button" key="more" class="tab" onClick={() => setPalette(true)} aria-label="Open command palette"><TabIcon v="more" /><span>More</span></button>
            : <button type="button" key={slot} class={`tab${view === slot ? ' on' : ''}`} aria-current={view === slot ? 'page' : undefined} onClick={() => go(slot)}><TabIcon v={slot} /><span>{LABEL[slot]}</span>{badge(slot)}</button>)}
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
            {preview ? (preview.error ?? [preview.spec!.title, preview.spec!.due && niceDate(preview.spec!.due), preview.spec!.effort && span(preview.spec!.effort.minutes), preview.spec!.project && (titles.get(preview.spec!.project) ?? `#${preview.spec!.project}`)].filter(Boolean).join(' · ')) : <>Natural language: due, effort, <code>#project</code>. <kbd>Enter</kbd> adds.</>}
            {preview?.retry && <button type="button" class="link" disabled={busy} onClick={() => (preview.retry === 'submit' ? void submitCapture() : setPreviewTry((n) => n + 1))}>Retry</button>}
          </p>
        </Dialog>
      )}
      {palette && <PaletteDialog commands={allCommands} onClose={() => setPalette(false)} />}
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
  // the list scrolls: keep the selected option in view when the arrows move it
  useEffect(() => { document.querySelector('#palette-list [aria-selected="true"]')?.scrollIntoView?.({ block: 'nearest' }); }, [i, q]);
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
          <Fragment key={c.id}>
            {q === '' && c.group && c.group !== shown[n - 1]?.group && <li class="cmd-group" role="presentation">{c.group}</li>}
            <li role="option" aria-selected={n === i} class={n === i ? 'on' : ''} onMouseEnter={() => setI(n)} onClick={() => choose(c)}>
              <span>{c.label}</span>{c.hint && <kbd>{c.hint}</kbd>}
            </li>
          </Fragment>
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
    home: 'M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1Z',
    sessions: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Zm4 13h8M8 8l2.5 2.5L8 13m4 0h4',
    projects: 'M4 6h16M4 12h16M4 18h10',
    list: 'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
    more: 'M5 12h.01M12 12h.01M19 12h.01',
  };
  return <svg class="tab-ic" viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d={d[v]} fill="none" stroke="currentColor" stroke-width={v === 'more' ? 3 : 1.7} stroke-linecap="round" stroke-linejoin="round" /></svg>;
}
