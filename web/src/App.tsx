import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ApiFailure, createClient } from './api';
import { capacityRows } from './capacity';
import { applyFilters, buildHash, parseHash, type Filters } from './filters';
import { Dialog, GROUP_NAMES, GROUPS, Help, Picker, Toasts, type GroupName, type Toast } from './parts';
import { filterCommands } from './palette';
import { keyboardMove, moveTarget, type RowPos } from './reorder';
import type { CaptureSpec, NextTask, Project, SetProps, Task, View } from './types';
import { CapacityView, ListView, NextView } from './views';

const api = createClient();
type Phase = 'loading' | 'ready' | 'denied' | 'error';
interface Command { id: string; label: string; hint?: string; run: () => void }

const isTyping = (t: EventTarget | null) => t instanceof HTMLElement && (t.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName));
const toLogin = () => location.assign(`/.auth/login/github?post_login_redirect_uri=${encodeURIComponent(location.pathname + location.search + location.hash)}`);
const projectOf = (ref: string) => ref.slice(0, ref.lastIndexOf(':'));

export function App() {
  const [phase, setPhase] = useState<Phase>('loading');
  const [loadError, setLoadError] = useState('');
  const [me, setMe] = useState('');
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
  const [busy, setBusy] = useState(false);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [drag, setDrag] = useState<{ ref: string; over: string | null; half: 'top' | 'bottom' } | null>(null);
  const [captureText, setCaptureText] = useState('');
  const [preview, setPreview] = useState<{ spec?: CaptureSpec; error?: string } | null>(null);
  const lastProject = useRef<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);
  const captureRef = useRef<HTMLInputElement | null>(null);
  const toastId = useRef(0);
  const chord = useRef<number>(0);

  // ---- derived
  const rows = useMemo(() => applyFilters(tasks, filters), [tasks, filters]);
  const positions: RowPos[] = useMemo(() => rows.map((t) => ({ ref: t.ref, project: t.project, depth: t.depth })), [rows]);
  const capRows = useMemo(() => capacityRows(projects, tasks), [projects, tasks]);

  // ---- feedback
  const toast = useCallback((text: string, kind: Toast['kind'] = 'ok', undo?: () => void) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, text, kind, undo }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), undo ? 8000 : 4000);
  }, []);
  const dismiss = (id: number) => setToasts((t) => t.filter((x) => x.id !== id));

  // ---- data
  const refresh = useCallback(async () => {
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

  useEffect(() => {
    void (async () => {
      try {
        const r = await fetch('/.auth/me', { credentials: 'same-origin' });
        const j = (await r.json()) as { clientPrincipal?: { userDetails?: string } | null };
        setMe(j.clientPrincipal?.userDetails ?? '');
      } catch { /* the api decides access */ }
      await refresh();
    })();
  }, []);

  // keep the cursor on a real row
  useEffect(() => {
    if (view !== 'list') return;
    if (cursor && rows.some((r) => r.ref === cursor)) return;
    setCursor(rows[0]?.ref ?? null);
  }, [rows, view, cursor]);
  useEffect(() => { setSelected((s) => { const live = new Set(tasks.map((t) => t.ref)); const n = new Set([...s].filter((r) => live.has(r))); return n.size === s.size ? s : n; }); }, [tasks]);

  // ---- navigation (hash)
  const go = useCallback((v: View, f: Filters = filters) => {
    setNav({ view: v, filters: f });
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

  const nextAct = async (a: 'start' | 'done' | 'skip' | 'suspend', days?: number) => {
    if (!next) return;
    const ref = next.ref;
    if (a === 'done') {
      if (await run(() => api.action('complete', ref), () => '')) toast('Done', 'ok', () => { void run(() => api.set(ref, { checkbox: 'Incomplete' }), () => 'Restored'); });
    } else if (a === 'suspend') await run(() => api.action('suspend', ref, { days: days ?? 1 }));
    else await run(() => api.action(a, ref));
  };

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
    if (!text) return;
    setBusy(true);
    try {
      const r = await api.capture(text, { project: defaultProject() });
      if (r.ref) lastProject.current = projectOf(r.ref);
      setCaptureText(''); setPreview(null);
      toast(`Added: ${r.after ?? r.spec.title}`);
      await refresh();
    } catch (e) {
      setPreview({ error: e instanceof Error ? e.message : 'Capture failed' });
    } finally { setBusy(false); }
  };

  // ---- commands
  const cursorTask = tasks.find((t) => t.ref === cursor);
  const targets = () => (selected.size ? [...selected] : cursor && view === 'list' ? [cursor] : next && view === 'next' ? [next.ref] : []);
  const openPicker = (groups: GroupName[]) => { const refs = targets(); if (refs.length) setPicker({ refs, groups }); };
  const commands: Command[] = [
    { id: 'go-next', label: 'Go to next task', hint: 'g n', run: () => go('next', filters) },
    { id: 'go-list', label: 'Go to list', hint: 'g l', run: () => go('list') },
    { id: 'go-cap', label: 'Go to capacity', hint: 'g c', run: () => go('capacity') },
    { id: 'capture', label: 'Capture a task', hint: 'c', run: () => setTimeout(() => captureRef.current?.focus(), 0) },
    { id: 'search', label: 'Search tasks', hint: '/', run: () => { go('list'); setTimeout(() => searchRef.current?.focus(), 0); } },
    ...(['open', 'done', 'all'] as const).map((s) => ({ id: `show-${s}`, label: `Show ${s} tasks`, run: () => go('list', { ...filters, state: s }) })),
    { id: 'clear', label: 'Clear filters', run: () => go('list', { q: '', project: '', state: 'open', status: '', priority: '', effort: '' }) },
    ...projects.map((p) => ({ id: `proj-${p.name}`, label: `Filter project: ${p.title || p.name}`, run: () => go('list', { ...filters, project: p.name }) })),
    ...GROUP_NAMES.map((g) => ({ id: `set-${g}`, label: `Set ${GROUPS[g].label.toLowerCase()} on ${selected.size ? 'selection' : 'row'}`, hint: GROUPS[g].key, run: () => openPicker([g]) })),
    { id: 'done', label: 'Mark done', hint: 'd', run: () => (selected.size ? void bulk('complete') : view === 'next' ? void nextAct('done') : cursorTask && void toggleDone(cursorTask)) },
    { id: 'skip', label: 'Skip', run: () => (selected.size ? void bulk('skip') : view === 'next' ? void nextAct('skip') : cursor && void run(() => api.action('skip', cursor))) },
    { id: 'start', label: 'Start', hint: 's', run: () => (view === 'next' ? void nextAct('start') : cursor && void run(() => api.action('start', cursor))) },
    { id: 'edit', label: 'Edit row text', hint: 'e', run: () => cursor && setEditing(cursor) },
    { id: 'help', label: 'Show keyboard shortcuts', hint: '?', run: () => setHelp(true) },
    { id: 'signout', label: 'Sign out', run: () => location.assign('/.auth/logout') },
  ];

  // ---- keyboard (reads latest state through a ref)
  const latest = useRef({ positions, rows, cursor, view, selected, editing, commands, picker, palette, help });
  latest.current = { positions, rows, cursor, view, selected, editing, commands, picker, palette, help };
  const doMoveLatest = useRef(doMove); doMoveLatest.current = doMove;
  const act = useRef({ nextAct, toggleDone, openPicker, applyPick, go, bulk }); act.current = { nextAct, toggleDone, openPicker, applyPick, go, bulk };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const L = latest.current, A = act.current;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setPalette((p) => !p); return; }
      if (e.key === 'Escape' && (L.palette || L.help || L.picker)) { e.preventDefault(); setPalette(false); setHelp(false); setPicker(null); return; }
      if (L.palette || L.help) return;
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
        const v = { n: 'next', l: 'list', c: 'capacity' }[k] as View | undefined;
        if (v) { e.preventDefault(); A.go(v); return; }
      }
      if (k === 'g') { chord.current = now; return; }
      if (k === ':') { e.preventDefault(); setPalette(true); return; }
      if (k === '?') { e.preventDefault(); setHelp(true); return; }
      if (k === 'c') { e.preventDefault(); captureRef.current?.focus(); return; }
      if (k === '/') { e.preventDefault(); A.go('list'); setTimeout(() => searchRef.current?.focus(), 0); return; }
      if (L.view === 'next') {
        if (k === 's') void A.nextAct('start'); else if (k === 'd') void A.nextAct('done'); else if (k === 'k') void A.nextAct('skip');
        else if (k === 'z') void A.nextAct('suspend', 1);
        else if (k === 'p' || k === 't' || k === 'f' || k === 'i') A.openPicker([GROUP_NAMES.find((g) => GROUPS[g].key === k)!]);
        return;
      }
      if (L.view !== 'list') return;
      const i = L.rows.findIndex((r) => r.ref === L.cursor);
      const step = (d: number) => { const n = L.rows[Math.max(0, Math.min(L.rows.length - 1, i + d))]; if (n) setCursor(n.ref); };
      if (k === 'J' && L.cursor) { e.preventDefault(); void doMoveLatest.current(L.cursor, keyboardMove(L.positions, L.cursor, 'down')); }
      else if (k === 'K' && L.cursor) { e.preventDefault(); void doMoveLatest.current(L.cursor, keyboardMove(L.positions, L.cursor, 'up')); }
      else if (k === 'j' || k === 'ArrowDown') { e.preventDefault(); step(1); }
      else if (k === 'k' || k === 'ArrowUp') { e.preventDefault(); step(-1); }
      else if ((k === 'Enter' || k === 'e') && L.cursor) { e.preventDefault(); setEditing(L.cursor); }
      else if (k === 'x' && L.cursor) setSelected((s) => { const n = new Set(s); if (n.has(L.cursor!)) n.delete(L.cursor!); else n.add(L.cursor!); return n; });
      else if (k === 'Escape') { setSelected(new Set()); setCursor(null); }
      else if (k === 'd') { const t = L.rows.find((r) => r.ref === L.cursor); if (L.selected.size) void A.bulk('complete'); else if (t) void A.toggleDone(t); }
      else if (k === 's' && L.cursor) void run(() => api.action('start', L.cursor!));
      else if (k === 'p' || k === 't' || k === 'f' || k === 'i') A.openPicker([GROUP_NAMES.find((g) => GROUPS[g].key === k)!]);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [run]);

  // ---- render
  if (phase === 'denied') {
    return (
      <main class="gate"><h1>Not on the allow-list</h1><p>You are signed in{me ? ` as ${me}` : ''}, but this Stack belongs to someone else.</p>
        <a class="btn" href="/.auth/logout">Sign out</a></main>
    );
  }
  if (phase === 'error') {
    return <main class="gate"><h1>Cannot load tasks</h1><p>{loadError}</p><button type="button" class="btn primary" onClick={() => void refresh()}>Retry</button></main>;
  }
  const tabs: [View, string][] = [['next', 'Next'], ['list', 'List'], ['capacity', 'Capacity']];
  return (
    <div class="shell">
      <nav class="rail" aria-label="Views">
        <div class="brand">Stack</div>
        {tabs.map(([v, label]) => (
          <button type="button" key={v} class={`tab${view === v ? ' on' : ''}`} aria-current={view === v ? 'page' : undefined} onClick={() => go(v)}>{label}</button>
        ))}
        <div class="spacer" />
        <button type="button" class="tab" onClick={() => setPalette(true)} aria-label="Open command palette">Commands <kbd>⌘K</kbd></button>
        <button type="button" class="tab" onClick={() => setHelp(true)}>Shortcuts <kbd>?</kbd></button>
        <div class="who">{me && <span>{me}</span>} <a href="/.auth/logout">Sign out</a></div>
      </nav>
      <main class="main">
        <div class="capture">
          <input ref={captureRef} type="text" aria-label="Quick capture" placeholder="Capture: call dentist tomorrow 30m #alpha" value={captureText} maxLength={2000} disabled={busy && !captureText}
            onInput={(e) => setCaptureText((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void submitCapture(); } if (e.key === 'Escape') (e.target as HTMLInputElement).blur(); }} />
          <button type="button" class="btn primary" disabled={busy || !captureText.trim()} onClick={() => void submitCapture()}>Add</button>
          {preview && (
            <p class={`preview-line${preview.error ? ' err' : ''}`} role="status" data-testid="capture-preview">
              {preview.error ?? [preview.spec!.title, preview.spec!.due && `due ${preview.spec!.due}`, preview.spec!.effort && `${preview.spec!.effort.emoji} ${preview.spec!.effort.minutes}m`, preview.spec!.project && `#${preview.spec!.project}`].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
        {phase === 'loading' && <p class="loading">Loading…</p>}
        {phase === 'ready' && view === 'next' && <NextView task={next} busy={busy} onAct={(a, d) => void nextAct(a, d)} onPick={(refs, g) => setPicker({ refs, groups: Array.isArray(g) ? g : [g] })} />}
        {phase === 'ready' && view === 'list' && (
          <ListView rows={rows} projects={projects} filters={filters} cursor={cursor} selected={selected} editing={editing} busy={busy} drag={drag} searchRef={searchRef}
            onFilters={setFilters} onCursor={setCursor} onSelect={(ref) => setSelected((s) => { const n = new Set(s); if (n.has(ref)) n.delete(ref); else n.add(ref); return n; })}
            onEdit={setEditing} onSave={(r, t) => void save(r, t)} onToggle={(t) => void toggleDone(t)} onPick={(refs, g) => setPicker({ refs: selected.size && selected.has(refs[0]) ? [...selected] : refs, groups: Array.isArray(g) ? g : [g] })}
            onMove={(ref, dir) => void doMove(ref, keyboardMove(positions, ref, dir))} onDragStart={onDragStart} />
        )}
        {phase === 'ready' && view === 'capacity' && <CapacityView rows={capRows} />}
      </main>
      {selected.size > 0 && view === 'list' && (
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
        {tabs.map(([v, label]) => <button type="button" key={v} class={`tab${view === v ? ' on' : ''}`} aria-current={view === v ? 'page' : undefined} onClick={() => go(v)}>{label}</button>)}
        <button type="button" class="tab" onClick={() => setPalette(true)} aria-label="Open command palette">More</button>
      </nav>
      {picker && <Picker groups={picker.groups} count={picker.refs.length} onClose={() => setPicker(null)} onChoose={(g, e) => void applyPick(picker.refs, g, e)} />}
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
