/**
 * The PR page: a top bar icon with the active agent count, and a flyout (full screen on a phone) with tabs per group,
 * project chips, live age, and one-tap owner actions. No merge, un-draft, close, or approve control exists here.
 * @req FR:pr-page/icon.place @req FR:pr-page/icon.absent @req FR:pr-page/icon.open @req FR:pr-page/flyout.shape @req FR:pr-page/flyout.tabs
 * @req FR:pr-page/flyout.row @req FR:pr-page/flyout.filter @req FR:pr-page/flyout.empty @req FR:pr-page/act.queue @req FR:pr-page/act.autopilot
 * @req FR:pr-page/act.accept @req FR:pr-page/act.thread @req FR:pr-page/act.rec @req FR:pr-page/act.set @req FR:pr-page/act.never @req FR:pr-page/state.view
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ApiFailure, type createClient } from './api';
import { prsTab } from './cos';
import {
  threadOf, ageText, replyToOf, BUCKET, CI, clip, countOf, createPrStore, EMPTY, escFor, escIn, healthyCount, loadPrefs, ownerOf, PROJECT_LABEL, projectsOf, refOf, replyText, rowsOf,
  savePrefs, shortLabels, TAB_LABEL, tabsOf, updatedText, type EscEntry, type Phase, type PrBoard, type Prefs, type PrRow, type PrStore, type Tab,
} from './prs';
import type { Toast } from './parts';
import { store } from './day';
import './prs.css';

type Client = ReturnType<typeof createClient>;
type ToastFn = (text: string, kind?: Toast['kind'], undo?: () => void) => void;

let shared: PrStore | null = null;
let opener: HTMLElement | null = null;
const storeFor = (api: Client) => (shared ??= createPrStore(() => api.prs(), { status: (e) => (e instanceof ApiFailure ? e.status : 0) }));
function useStore(api: Client) {
  const s = storeFor(api);
  const [, tick] = useState(0);
  useEffect(() => s.subscribe(() => tick((n) => n + 1)), [s]);
  return s;
}
const local = () => store() ?? null;
const errText = (e: unknown, fallback: string) => (e instanceof ApiFailure ? e.message : fallback);

function PrIcon() {
  return <svg class="prs-ic" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 3a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm0 4v10m0 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm12 0a2 2 0 1 0 0 4 2 2 0 0 0 0-4Zm0 0V9a3 3 0 0 0-3-3h-4m0 0 2.5-2.5M11 6l2.5 2.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>;
}

/** The one PR store, for other views that summarize it (the CoS view). @req FR:cos-base-of-ops/compose.prs */
export function usePrBoard(api: Client): { board: PrBoard | null; phase: Phase } {
  const { board, phase } = useStore(api).get();
  return { board, phase };
}

/** The icon. Absent until the host answers, and on a host with no GitHub token. @req FR:pr-page/icon.place @req FR:pr-page/icon.absent */
export function PrsButton({ api, compact = false }: { api: Client; compact?: boolean }) {
  const s = useStore(api);
  const { board, phase, open } = s.get();
  if (phase === 'off' || !board) return null;
  const n = board.agents.count;
  return (
    <button type="button" class={`prs-btn${compact ? ' compact' : ' tab'}`} data-testid={compact ? 'prs-btn-phone' : 'prs-btn'} aria-haspopup="dialog" aria-expanded={open}
      aria-label={`Pull requests: ${n} ${n === 1 ? 'agent' : 'agents'} active`} title={`Pull requests (g r) · ${n} active ${n === 1 ? 'agent' : 'agents'}`}
      onClick={(e) => { opener = e.currentTarget as HTMLElement; s.setOpen(true); }}>
      {compact ? <><PrIcon />{n > 0 && <span class="badge" aria-hidden="true">{n}</span>}</> : <><span class="tab-label"><PrIcon />Pull requests{n > 0 && <span class="badge" aria-hidden="true">{n}</span>}</span><kbd>g r</kbd></>}
    </button>
  );
}

/** One sheet over the flyout: confirm or cancel. Focus stays inside. */
function Sheet({ title, onClose, onConfirm, confirm, busy, children, ok = true }: { title: string; onClose: () => void; onConfirm: () => void; confirm: string; busy: boolean; children: ComponentChildren; ok?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const from = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>('textarea, input, button')?.focus();
    // On close, focus goes back to the control that opened the sheet, else the flyout's tab, so the flyout trap still holds.
    return () => setTimeout(() => {
      const ok = from && from.isConnected && !(from as HTMLButtonElement).disabled && from.offsetParent !== null;
      (ok ? from : document.querySelector<HTMLElement>('.prs-fly [role="tab"][aria-selected="true"]'))?.focus();
    }, 0);
  }, []);
  return (
    <div class="prs-sheet-scrim" onClick={onClose}>
      <div ref={ref} class="prs-sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation();
          if (e.key === 'Escape') { e.preventDefault(); onClose(); return; }
          if (e.key === 'Tab') {
            const els = [...ref.current!.querySelectorAll<HTMLElement>('a[href], button, input, textarea, select')].filter((x) => !(x as HTMLButtonElement).disabled);
            const i = els.indexOf(document.activeElement as HTMLElement);
            e.preventDefault();
            els[e.shiftKey ? (i <= 0 ? els.length - 1 : i - 1) : (i + 1) % els.length]?.focus();
          }
        }}>
        <h3 class="prs-sheet-title">{title}</h3>
        {children}
        <div class="prs-sheet-actions">
          <button type="button" class="btn primary" disabled={busy || !ok} onClick={onConfirm}>{confirm}</button>
          <button type="button" class="btn" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}

type SheetSpec =
  | { kind: 'label'; row: { repo: string; number: number; url: string; title?: string }; op: 'add' | 'remove' }
  | { kind: 'reply'; e: { repo: string; number: number; url: string; thread: string; replyTo?: number }; answer: string; post: boolean }
  | { kind: 'rec'; row: PrRow; decision: 'accept' | 'edit' | 'reject'; rank: string; note: string; reason: string }
  | { kind: 'bulk'; items: EscEntry[] };

/** The flyout, once per page. `g r` opens it. @req FR:pr-page/icon.open @req FR:pr-page/flyout.shape */
export function PrsFlyoutHost({ api, toast }: { api: Client; toast: ToastFn }) {
  const s = useStore(api);
  const { open, phase } = s.get();
  useEffect(() => {
    if (phase === 'off') return;
    let g = 0;
    const key = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.metaKey || e.ctrlKey || e.altKey || (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable))) return;
      if (e.key === 'g') { g = Date.now(); return; }
      if (e.key === 'r' && Date.now() - g < 1500) { e.preventDefault(); e.stopPropagation(); g = 0; opener = document.activeElement as HTMLElement; s.setOpen(true); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [s, phase]);
  // `#/prs?tab=…` opens the flyout on that tab, over the CoS view. @req FR:cos-base-of-ops/route.view
  useEffect(() => {
    if (phase === 'off') return;
    const on = () => {
      const t = prsTab(location.hash);
      if (!t) return;
      if (t !== 'default') savePrefs(local(), { ...loadPrefs(local()), tab: t });
      opener = document.activeElement as HTMLElement;
      s.setOpen(true);
    };
    on();
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, [s, phase]);
  if (!open) return null;
  return <Flyout api={api} s={s} toast={toast} onClose={() => { s.setOpen(false); if (prsTab(location.hash)) location.hash = '#/cos'; const o = opener && opener.isConnected && opener.offsetParent !== null ? opener : document.querySelector<HTMLElement>('[data-testid="prs-btn"], [data-testid="prs-btn-phone"]'); setTimeout(() => o?.focus(), 0); }} />;
}

function Flyout({ api, s, toast, onClose }: { api: Client; s: PrStore; toast: ToastFn; onClose: () => void }) {
  const { board } = s.get();
  const [prefs, setPrefsState] = useState<Prefs>(() => loadPrefs(local()));
  const setPrefs = (p: Prefs) => { setPrefsState(p); savePrefs(local(), p); };
  const [now, setNow] = useState(() => new Date());
  const [healthy, setHealthy] = useState(false);
  const [sheet, setSheet] = useState<SheetSpec | null>(null);
  const [busy, setBusy] = useState(false);
  const [bulk, setBulk] = useState<Set<string> | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const ref = useRef<HTMLDivElement>(null);
  const tabs = tabsOf(board);
  const tab: Tab = tabs.includes(prefs.tab) ? prefs.tab : tabs.includes('blocked') ? 'blocked' : tabs[0];
  const projects = projectsOf(board);
  const sel = prefs.projects.filter((p) => projects.includes(p));
  const rows = useMemo(() => rowsOf(board, tab, sel, healthy), [board, tab, sel.join(), healthy]);

  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  useLayoutEffect(() => { ref.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')?.focus(); }, []);
  /** The focus trap: the flyout plus the toasts, whose Undo must stay in reach by keyboard. A sheet runs its own trap. */
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const fly = ref.current;
      if (!fly || fly.querySelector('.prs-sheet-scrim')) return;
      const a = document.activeElement as HTMLElement | null;
      const inToasts = !!a?.closest('.toasts');
      if (a && a !== document.body && !inToasts && !fly.contains(a)) return;
      if (inToasts) e.stopPropagation(); // the app shortcuts stay out, as in the flyout
      if (e.key === 'Escape' && inToasts) { e.preventDefault(); closeRef.current(); return; }
      if (e.key !== 'Tab') return;
      const els = [
        ...fly.querySelectorAll<HTMLElement>('a[href]:not([tabindex="-1"]), button, input, textarea, select, [tabindex="0"]'),
        ...document.querySelectorAll<HTMLElement>('.toasts button'),
      ].filter((x) => !(x as HTMLButtonElement).disabled && x.offsetParent !== null);
      if (!els.length) return;
      const i = els.indexOf(a as HTMLElement);
      e.preventDefault();
      e.stopPropagation();
      els[e.shiftKey ? (i <= 0 ? els.length - 1 : i - 1) : (i + 1) % els.length].focus();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, []);

  const reload = () => void s.reload();
  /** Bulk runs by url: a reload between select and run gives new objects. */
  const isEnable = (e: EscEntry) => !!board?.escalations?.enable.some((x) => x.url === e.url);
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };

  /** Queue moves with Undo back to the old rank. @req FR:pr-page/act.queue */
  const queue = (r: PrRow, op: 'top' | 'up' | 'down' | 'add' | 'pin' | 'unpin' | 'remove') => run(async () => {
    try {
      const res = await api.prQueue(r.repo, r.number, op);
      // Undo is `stack pr-pri undo`: the order before this edit.
      const undo = async () => { try { await api.prQueue(r.repo, r.number, 'undo'); } catch (e) { toast(errText(e, 'Undo failed'), 'err'); } reload(); };
      const said = { add: `Queued ${refOf(r)} at the top`, pin: `Pinned ${refOf(r)}`, unpin: `Unpinned ${refOf(r)}`, remove: `Removed ${refOf(r)} from the queue` } as Record<string, string>;
      toast(said[op] ?? `${refOf(r)} now rank ${res.rank ?? '-'}`, 'ok', () => void undo());
      reload();
    } catch (e) { toast(errText(e, 'Queue change failed'), 'err'); }
  });
  /** One tap: record the answer; Undo takes it back. @req FR:pr-page/act.accept */
  const accept = (e: { repo: string; number: number; thread: string }, answer: string) => run(async () => {
    try {
      await api.prAck({ repo: e.repo, number: e.number, thread: e.thread, note: answer });
      // No Undo: the store keeps the newest answer per thread; answer again to change it.
      toast(`Answered ${refOf(e)}`);
      reload();
    } catch (x) { toast(errText(x, 'Could not record the answer'), 'err'); }
  });

  const confirmSheet = () => sheet && run(async () => {
    try {
      if (sheet.kind === 'label') { await api.prLabel(sheet.row.repo, sheet.row.number, sheet.op); toast(sheet.op === 'add' ? `Autopilot on ${refOf(sheet.row)}` : `Autopilot off ${refOf(sheet.row)}`); }
      if (sheet.kind === 'reply') {
        const answer = sheet.answer.trim();
        const r = await api.prAck({ repo: sheet.e.repo, number: sheet.e.number, thread: sheet.e.thread, note: answer, ...(sheet.post ? { post: true, text: replyText(answer) } : {}), ...(sheet.post && sheet.e.replyTo ? { replyTo: sheet.e.replyTo } : {}) });
        // A posted reply whose answer was not recorded still closes the sheet: a second tap would post twice.
        if (r.posted && !r.recorded) toast(`Replied on ${refOf(sheet.e)}; answer not recorded: ${r.message ?? 'queue unavailable'}`, 'err');
        else toast(r.posted ? `Replied on ${refOf(sheet.e)}` : `Answered ${refOf(sheet.e)}`, );
      }
      if (sheet.kind === 'rec') {
        await api.prRec(sheet.row.rec!.id, { decision: sheet.decision, ...(sheet.decision === 'edit' && sheet.rank ? { rank: Number(sheet.rank) } : {}), ...(sheet.decision === 'edit' && sheet.note ? { note: sheet.note } : {}), ...(sheet.decision !== 'accept' ? { reason: sheet.reason } : {}) });
        toast(`${sheet.decision === 'accept' ? 'Accepted' : sheet.decision === 'edit' ? 'Edited' : 'Rejected'}: ${refOf(sheet.row)}`);
      }
      if (sheet.kind === 'bulk') {
        let done = 0;
        for (const e of sheet.items) {
          try {
            if (isEnable(e)) await api.prLabel(e.repo, e.number, 'add');
            else await api.prAck({ repo: e.repo, number: e.number, thread: threadOf(e), note: answers[e.url] ?? e.recommend ?? '' });
            done++;
          } catch (x) { toast(`${refOf(e)}: ${errText(x, 'failed')}`, 'err'); }
        }
        toast(`Ran ${done} of ${sheet.items.length}`);
        setBulk(null);
      }
      setSheet(null);
      reload();
    } catch (e) { toast(errText(e, 'Action failed'), 'err'); }
  });

  /** Keys on the focused row. @req FR:pr-page/act.queue @req FR:pr-page/act.accept */
  const rowKeys = (e: KeyboardEvent, r: PrRow) => {
    if (e.target !== e.currentTarget || e.metaKey || e.ctrlKey || e.altKey) return;
    const k = e.key;
    if (board?.queue && (k === 't' || k === 'u' || k === 'd') && r.rank !== null) { e.preventDefault(); void queue(r, k === 't' ? 'top' : k === 'u' ? 'up' : 'down'); }
    else if (board?.queue && k === 'p') { e.preventDefault(); void queue(r, r.rank === null ? 'add' : r.pinned ? 'unpin' : 'pin'); }
    else if (k === 'a' && board?.queue) { const esc = escFor(board, r.url); if (esc?.recommend) { e.preventDefault(); void accept({ ...esc, thread: threadOf(esc) }, esc.recommend); } }
    else if (k === 'o' || k === 'Enter') { e.preventDefault(); window.open(r.url, '_blank', 'noopener'); }
    else if (k === 'ArrowDown' || k === 'ArrowUp' || k === 'j' || k === 'k') {
      e.preventDefault();
      const items = [...(ref.current?.querySelectorAll<HTMLElement>('.pr-row') ?? [])];
      items[items.indexOf(e.currentTarget as HTMLElement) + (k === 'ArrowDown' || k === 'j' ? 1 : -1)]?.focus();
    }
  };

  const tabKeys = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = tabs.indexOf(tab);
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    setPrefs({ ...prefs, tab: next });
    setTimeout(() => ref.current?.querySelector<HTMLElement>(`#prs-tab-${next}`)?.focus(), 0);
  };

  const row = (r: PrRow) => {
    const owner = ownerOf(r);
    const esc = escFor(board, r.url);
    const thread = r.state.link && r.state.link !== r.url;
    return (
      <li key={r.url} class={`pr-row${r.state.owner === 'me' ? ' mine' : ''}`} tabIndex={0} data-url={r.url} onKeyDown={(e) => rowKeys(e as unknown as KeyboardEvent, r)}
        aria-label={`${r.title}, ${refOf(r)}${r.bucket ? `, ${BUCKET[r.bucket]}` : ''}${owner ? `, owner ${owner.text}` : ''}`}>
        <div class="pr-top">
          <span class="pr-rank" data-slot="priority" aria-label={r.rank === null ? undefined : `Rank ${r.rank}`}>{r.rank === null ? '' : `${r.pinned ? '📌' : ''}#${r.rank}`}</span>
          {r.bucket && <span class={`pr-bucket ${r.bucket}`}>{BUCKET[r.bucket]}</span>}
          <a class="pr-title" href={r.url} target="_blank" rel="noopener noreferrer" tabIndex={-1} title={r.title}>{clip(r.title, 80)}</a>
        </div>
        <div class="pr-meta">
          <span>{refOf(r)}</span><span>{ageText(r.createdAt, now)}</span>
          <span class={`pr-ci ${r.ci}`}>{CI[r.ci]}</span>
          {r.unresolved > 0 && <span>{r.unresolved} {r.unresolved === 1 ? 'thread' : 'threads'}</span>}
          {r.draft && <span class="pr-lbl">Draft</span>}
          {shortLabels(r.labels).map((l) => <span class="pr-lbl" key={l}>{l}</span>)}
          {r.agent && <span class="pr-lbl agent">Agent on it</span>}
        </div>
        {(owner || r.state.blocker || r.after.length > 0) && (
          <div class="pr-state">
            {owner && <span class={`pr-owner ${owner.kind}`}>{owner.text}</span>}
            {r.state.owner === 'runner' && <span class="pr-lbl warn">CI/runner</span>}
            {r.state.blocker && <a class="pr-blocker" href={r.state.link} target="_blank" rel="noopener noreferrer" aria-label={`${thread ? 'Open thread' : 'Open PR'}: ${r.state.blocker}`}>{clip(r.state.blocker, 90)}</a>}
            {r.after.map((a) => <span class="pr-lbl" key={a}>after {a}</span>)}
          </div>
        )}
        {r.rec && <div class="pr-rec">Raise to {r.rec.toRank ?? 'next'}: {clip(r.rec.reason, 80)} <span class="muted">({r.rec.agent})</span></div>}
        <div class="pr-actions">
          {board?.queue && esc?.recommend && <button type="button" class="btn primary" disabled={busy} onClick={() => void accept({ ...esc, thread: threadOf(esc) }, esc.recommend!)}>Accept</button>}
          {!esc && r.state.owner === 'me' && r.state.key && r.state.key !== 'action-required' && <button type="button" class="btn" disabled={busy} onClick={() => setSheet({ kind: 'reply', e: { repo: r.repo, number: r.number, url: r.url, thread: r.state.link, ...(r.state.replyTo ? { replyTo: r.state.replyTo } : {}) }, answer: '', post: !board?.queue })}>Answer…</button>}
          {r.group === 'pending' && !r.draft && !r.autopilot && <button type="button" class="btn primary" disabled={busy} onClick={() => setSheet({ kind: 'label', row: r, op: 'add' })}>Apply Autopilot</button>}
          {board?.queue && r.rec && <>
            <button type="button" class="btn" disabled={busy} onClick={() => setSheet({ kind: 'rec', row: r, decision: 'accept', rank: '', note: '', reason: '' })}>Accept rank</button>
            <button type="button" class="btn" disabled={busy} onClick={() => setSheet({ kind: 'rec', row: r, decision: 'edit', rank: String(r.rec!.toRank ?? ''), note: '', reason: '' })}>Edit</button>
            <button type="button" class="btn" disabled={busy} onClick={() => setSheet({ kind: 'rec', row: r, decision: 'reject', rank: '', note: '', reason: '' })}>Reject</button>
          </>}
          {board?.queue && (r.rank === null
            ? <button type="button" class="btn" disabled={busy} onClick={() => void queue(r, 'add')} aria-keyshortcuts="p">Queue</button>
            : <>
              <button type="button" class="btn" disabled={busy || r.rank === 1} onClick={() => void queue(r, 'top')} aria-keyshortcuts="t">Top</button>
              <button type="button" class="btn" disabled={busy || r.rank === 1} onClick={() => void queue(r, 'up')} aria-keyshortcuts="u" aria-label={`Move ${refOf(r)} up`}>Up</button>
              <button type="button" class="btn" disabled={busy} onClick={() => void queue(r, 'down')} aria-keyshortcuts="d" aria-label={`Move ${refOf(r)} down`}>Down</button>
              <button type="button" class="btn" disabled={busy} onClick={() => void queue(r, r.pinned ? 'unpin' : 'pin')} aria-keyshortcuts="p">{r.pinned ? 'Unpin' : 'Pin'}</button>
              <button type="button" class="btn quiet" disabled={busy} onClick={() => void queue(r, 'remove')} aria-label={`Remove ${refOf(r)} from the queue`}>Remove</button>
            </>)}
          {r.autopilot && <button type="button" class="btn quiet" disabled={busy} onClick={() => setSheet({ kind: 'label', row: r, op: 'remove' })}>Remove Autopilot</button>}
        </div>
      </li>
    );
  };

  const entry = (e: EscEntry, kind: 'blocked' | 'enable' | 'live') => {
    const id = `esc-${kind}-${e.url}`;
    const answer = answers[e.url] ?? e.recommend ?? '';
    const thread = threadOf(e);
    return (
      <li key={e.url} class="pr-row esc" data-url={e.url}>
        <div class="pr-top">
          {bulk && (kind === 'enable' || (kind === 'blocked' && board?.queue)) && <label class="pr-check-l"><input type="checkbox" class="pr-check" aria-label={`Select ${refOf(e)}`} checked={bulk.has(e.url)} onChange={() => setBulk((b) => { const n = new Set(b); if (n.has(e.url)) n.delete(e.url); else n.add(e.url); return n; })} /></label>}
          <a class="pr-title" href={e.url} target="_blank" rel="noopener noreferrer">{clip(e.title ?? refOf(e), 80)}</a>
        </div>
        <div class="pr-meta"><span>{refOf(e)}</span></div>
        {e.blocker && <div class="pr-state"><span class="pr-owner me">You</span>{e.link ? <a class="pr-blocker" href={e.link} target="_blank" rel="noopener noreferrer" aria-label={`Open thread: ${e.blocker}`}>{clip(e.blocker, 90)}</a> : <span class="pr-blocker">{clip(e.blocker, 90)}</span>}</div>}
        {e.context && <p class="pr-context">{clip(e.context, 160)}</p>}
        {kind === 'blocked' && (
          <label class="pr-answer" for={id}><span class="sr-only">Answer for {refOf(e)}</span>
            <input id={id} type="text" value={answer} placeholder="Your answer" onInput={(x) => setAnswers((a) => ({ ...a, [e.url]: (x.target as HTMLInputElement).value }))} />
          </label>
        )}
        <div class="pr-actions">
          {kind === 'blocked' && <>
            {board?.queue && <button type="button" class="btn primary" disabled={busy || !answer.trim()} onClick={() => void accept({ ...e, thread }, answer)}>Accept</button>}
            <button type="button" class={`btn${board?.queue ? '' : ' primary'}`} disabled={busy || !answer.trim()} onClick={() => setSheet({ kind: 'reply', e: { ...e, thread, ...(replyToOf(e.link) ? { replyTo: replyToOf(e.link) } : {}) }, answer, post: true })}>{board?.queue ? 'Accept and reply…' : 'Reply on GitHub…'}</button>
          </>}
          {kind === 'enable' && <button type="button" class="btn primary" disabled={busy} onClick={() => setSheet({ kind: 'label', row: e, op: 'add' })}>Apply Autopilot</button>}
          {kind === 'live' && <a class="btn primary" href={e.url} target="_blank" rel="noopener noreferrer">Open PR</a>}
        </div>
      </li>
    );
  };

  const esc = board?.escalations;
  const section = (title: string, all: EscEntry[], kind: 'blocked' | 'enable' | 'live') => { const list = escIn(all, sel); return list.length > 0 && (
    <section class="pr-esc-sec" aria-label={title}><h3 class="pr-sec-h">{title}</h3><ul class="pr-list">{list.map((e) => entry(e, kind))}</ul></section>
  ); };
  // Bulk runs only what the project filter shows.
  const bulkItems = esc ? escIn([...esc.blocked.filter((e) => board?.queue && (answers[e.url] ?? e.recommend ?? '').trim()), ...esc.enable], sel).filter((e) => bulk?.has(e.url)) : [];

  return (
    <div class="prs-scrim" onClick={onClose}>
      <div ref={ref} class="prs-fly" role="dialog" aria-modal="true" aria-labelledby="prs-h" data-testid="prs-flyout" onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          // The app shortcuts stay out while the flyout is open.
          e.stopPropagation();
          if (e.key === 'Escape') { e.preventDefault(); onClose(); }
        }}>
        <header class="prs-head">
          <h2 id="prs-h">Pull requests</h2>
          {/* The live validation checklist. @req FR:pr-review-lane/panel.view */}
          <a class="btn prs-live" href="#/live">Live check</a>
          <span class="prs-age" role="status" aria-live="off" data-testid="prs-age">{updatedText(board, now)}</span>
          <button type="button" class="btn prs-close" onClick={onClose} aria-label="Close pull requests">Close</button>
        </header>
        {board?.error && board.at && <p class="prs-note" role="status">{board.error}. Showing the last good copy.</p>}
        {board?.truncated && <p class="prs-note">Some PRs may be missing: a search hit its 50-PR limit.</p>}
        {projects.length > 1 && (
          <div class="prs-chips" role="group" aria-label="Filter by project">
            {projects.map((p) => <button type="button" key={p} class={`prs-chip${sel.includes(p) ? ' on' : ''}`} aria-pressed={sel.includes(p)} onClick={() => setPrefs({ ...prefs, projects: sel.includes(p) ? sel.filter((x) => x !== p) : [...sel, p] })}>{PROJECT_LABEL[p] ?? p}</button>)}
          </div>
        )}
        <div class="prs-tabs" role="tablist" aria-label="PR groups" onKeyDown={tabKeys}>
          {tabs.map((t) => (
            <button type="button" role="tab" key={t} id={`prs-tab-${t}`} aria-controls="prs-panel" aria-selected={t === tab} tabIndex={t === tab ? 0 : -1} class={`prs-tab${t === tab ? ' on' : ''}`} onClick={() => setPrefs({ ...prefs, tab: t })}>
              {TAB_LABEL[t]} <span class="prs-count">{countOf(board, t, sel)}</span>
            </button>
          ))}
        </div>
        <div class="prs-panel" id="prs-panel" role="tabpanel" aria-labelledby={`prs-tab-${tab}`}>
          {tab === 'processing' && healthyCount(board, sel) > 0 && (
            <label class="prs-toggle"><input type="checkbox" checked={healthy} onChange={() => setHealthy(!healthy)} /> Show healthy ({healthyCount(board, sel)})</label>
          )}
          {tab === 'escalations' && esc && (
            <>
              <div class="prs-bulk">
                {bulk ? <>
                  <button type="button" class="btn primary" disabled={busy || bulkItems.length === 0} onClick={() => setSheet({ kind: 'bulk', items: bulkItems })}>Run {bulkItems.length}</button>
                  <button type="button" class="btn" onClick={() => setBulk(null)}>Done selecting</button>
                </> : <button type="button" class="btn" onClick={() => setBulk(new Set())}>Select</button>}
              </div>
              {section('Decide', esc.blocked, 'blocked')}
              {section('Enable Autopilot', esc.enable, 'enable')}
              {section('Validate live', esc.live, 'live')}
            </>
          )}
          {tab !== 'escalations' && (rows.length === 0
            ? <p class="prs-empty" data-testid="prs-empty">{EMPTY[tab]}</p>
            : <ul class="pr-list" aria-label={TAB_LABEL[tab]}>{rows.map(row)}</ul>)}
        </div>
        <footer class="prs-foot" data-testid="prs-foot">running {board?.footer.running ?? 0} · waiting {board?.footer.waiting ?? 0} · parked {board?.footer.parked ?? 0}</footer>
        {sheet && (
          <Sheet busy={busy} onClose={() => setSheet(null)} onConfirm={() => void confirmSheet()}
            title={sheet.kind === 'label' ? (sheet.op === 'add' ? 'Apply Autopilot?' : 'Remove Autopilot?') : sheet.kind === 'reply' ? (sheet.post ? 'Reply on GitHub?' : 'Record your answer?') : sheet.kind === 'rec' ? `${sheet.decision === 'accept' ? 'Accept' : sheet.decision === 'edit' ? 'Edit' : 'Reject'} the recommendation?` : `Run ${sheet.items.length} actions?`}
            confirm={sheet.kind === 'label' ? (sheet.op === 'add' ? 'Apply' : 'Remove') : sheet.kind === 'reply' ? (sheet.post ? 'Post reply' : 'Save answer') : sheet.kind === 'rec' ? (sheet.decision === 'accept' ? 'Accept' : sheet.decision === 'edit' ? 'Save' : 'Reject') : 'Run all'}
            ok={sheet.kind === 'rec' ? sheet.decision === 'accept' || !!sheet.reason.trim() : sheet.kind === 'reply' ? !!sheet.answer.trim() && (sheet.post || !!board?.queue) : true}>
            {sheet.kind === 'label' && <p class="prs-sheet-body"><a href={sheet.row.url} target="_blank" rel="noopener noreferrer">{refOf(sheet.row)}</a> · label <strong>Status: 🤖 Autopilot</strong></p>}
            {sheet.kind === 'reply' && <>
              <label class="prs-field">Your answer<textarea rows={3} value={sheet.answer} onInput={(x) => setSheet({ ...sheet, answer: (x.target as HTMLTextAreaElement).value })} /></label>
              {board?.queue && <label class="prs-toggle"><input type="checkbox" checked={sheet.post} onChange={() => setSheet({ ...sheet, post: !sheet.post })} /> Also post on GitHub</label>}
              {sheet.post && <>
                <p class="prs-sheet-body">Posts this exact text on <a href={sheet.e.url} target="_blank" rel="noopener noreferrer">{refOf(sheet.e)}</a>{sheet.e.replyTo ? ' as a thread reply' : ' as a comment'}:</p>
                <p class="prs-preview" data-testid="prs-preview">{replyText(sheet.answer)}</p>
              </>}
            </>}
            {sheet.kind === 'rec' && <>
              <p class="prs-sheet-body"><a href={sheet.row.url} target="_blank" rel="noopener noreferrer">{refOf(sheet.row)}</a> · {sheet.row.rec!.agent}: {sheet.row.rec!.reason}</p>
              {sheet.decision === 'edit' && <>
                <label class="prs-field">Rank<input type="number" min={1} max={100} value={sheet.rank} onInput={(x) => setSheet({ ...sheet, rank: (x.target as HTMLInputElement).value })} /></label>
                <label class="prs-field">Note<input type="text" maxLength={300} value={sheet.note} onInput={(x) => setSheet({ ...sheet, note: (x.target as HTMLInputElement).value })} /></label>
              </>}
              {sheet.decision !== 'accept' && <label class="prs-field">Reason (needed)<input type="text" maxLength={300} value={sheet.reason} onInput={(x) => setSheet({ ...sheet, reason: (x.target as HTMLInputElement).value })} /></label>}
            </>}
            {sheet.kind === 'bulk' && <ul class="prs-sheet-list">{sheet.items.map((e) => <li key={e.url}>{isEnable(e) ? 'Apply Autopilot' : `Answer "${clip(answers[e.url] ?? e.recommend ?? '', 60)}"`} · <a href={e.url} target="_blank" rel="noopener noreferrer">{refOf(e)}</a></li>)}</ul>}
          </Sheet>
        )}
      </div>
    </div>
  );
}
