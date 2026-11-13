/**
 * The PR page: a top bar icon with the active agent count, and a flyout (full screen on a phone) and a `#/prs` page with a Summary tab,
 * one PR card shape, a details pane, and a Pinned tab sorted by drag. No merge, un-draft, close, or approve control exists here.
 * @req FR:pr-page/icon.place @req FR:pr-page/icon.absent @req FR:pr-page/icon.open @req FR:pr-page/flyout.shape @req FR:pr-page/flyout.tabs @req FR:pr-page/flyout.header
 * @req FR:pr-page/flyout.filter @req FR:pr-page/flyout.empty @req FR:pr-page/act.list @req FR:pr-page/act.never @req FR:pr-page/auth.state @req FR:pr-page/auth.signin
 * @req FR:pr-page/nav.badge @req FR:pr-page/nav.page @req FR:pr-page/nav.load @req FR:pr-page/summary.layout @req FR:pr-page/card.fields @req FR:pr-page/card.select
 * @req FR:pr-page/detail.layout @req FR:pr-page/pin.toggle @req FR:pr-page/pin.drag @req FR:pr-page/pin.keys @req FR:pr-page/live.age
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { ApiFailure, type createClient } from './api';
import {
  ACTION_LABEL, authorText, clip, countOf, createPrStore, EMPTY, ITEM_WORD, LANE_WORD, loadPrefs, moveTo, needCount, PROJECT_LABEL, projectsOf, refOf, rowsOf, savePrefs, signInText, specText,
  summaryView, TAB_LABEL, tabsOf, toneOf, updatedText, whenText, type PrAuthState, type PrBoard, type Prefs, type PrRow, type PrStore, type SignInSession, type Tab,
} from './prs';
import type { Toast } from './parts';
import { store } from './day';
import './prs.css';

type Client = ReturnType<typeof createClient>;
type ToastFn = (text: string, kind?: Toast['kind'], undo?: () => void) => void;

let shared: PrStore | null = null;
let opener: HTMLElement | null = null;
const storeFor = (api: Client) => (shared ??= createPrStore((fresh) => api.prs(fresh), { status: (e) => (e instanceof ApiFailure ? e.status : 0) }));
export function useStore(api: Client) {
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
function RefreshIcon() {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" /></svg>;
}
function PinIcon({ on }: { on: boolean }) {
  return <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M9 3h6l-1 6 3 3v2H7v-2l3-3-1-6Zm3 11v7" fill={on ? 'currentColor' : 'none'} stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round" /></svg>;
}

/** The board phase for the nav: the PR entry is absent only where the host has no board. @req FR:pr-page/icon.absent @req FR:pr-page/nav.badge */
export function usePrsNav(api: Client): { on: boolean; need: number; signIn: boolean } {
  const s = storeFor(api);
  const pick = () => { const { board, phase } = s.get(); return { on: phase !== 'off', need: needCount(board), signIn: phase === 'signin' }; };
  const [v, setV] = useState(pick);
  // The app shell re-renders only when the nav words change, not on every board load.
  useEffect(() => s.subscribe(() => setV((old) => { const n = pick(); return n.on === old.on && n.need === old.need && n.signIn === old.signIn ? old : n; })), [s]);
  return v;
}

/** The nav words now, without a subscription: the palette reads it when it opens. @req FR:pr-page/nav.phone */
export function prsNavNow(api: Client): { on: boolean; need: number; signIn: boolean } {
  const { board, phase } = storeFor(api).get();
  return { on: phase !== 'off', need: needCount(board), signIn: phase === 'signin' };
}

/** The rail entry. It owns its subscription, so a board change re-renders this button, not the app shell. @req FR:pr-page/nav.rail @req FR:pr-page/nav.badge */
export function PrsNavItem({ api, active, label, hint, onGo }: { api: Client; active: boolean; label: string; hint: string; onGo: () => void }) {
  const nav = usePrsNav(api);
  if (!nav.on) return null;
  return <button type="button" class={`tab${active ? ' on' : ''}`} aria-current={active ? 'page' : undefined} title={`${label} (${hint})`} onClick={onGo}><span class="tab-label">{label}<PrsNavBadge nav={nav} /></span></button>;
}

/** The nav badge: rows with a next action; a dot when signed out. @req FR:pr-page/nav.badge */
export function PrsNavBadge({ nav: { need, signIn } }: { nav: { need: number; signIn: boolean } }) {
  if (signIn) return <span class="nav-dot" role="img" aria-label="Sign in to GitHub" data-testid="prs-nav-dot" />;
  return need > 0 ? <span class="badge" aria-label={`${need} need you`} data-testid="prs-nav-badge">{need}</span> : null;
}

/** The top bar icon: the active agent count; it opens the flyout. @req FR:pr-page/icon.place @req FR:pr-page/icon.absent */
export function PrsButton({ api, where }: { api: Client; where: 'rail' | 'phone' }) {
  const s = useStore(api);
  const { board, phase, open } = s.get();
  if (phase === 'off') return null;
  const n = board?.agents.count ?? 0;
  const label = phase === 'loading' ? 'Pull requests: loading' : phase === 'signin' ? 'Pull requests: sign in to GitHub' : `Pull requests: ${n} ${n === 1 ? 'agent' : 'agents'} active`;
  return (
    <button type="button" class="prs-btn compact" data-testid={where === 'rail' ? 'prs-btn' : 'prs-btn-phone'} aria-haspopup="dialog" aria-expanded={open} aria-label={label} title={label}
      onClick={(e) => { opener = e.currentTarget as HTMLElement; s.setOpen(true); }}>
      <PrIcon />{n > 0 && <span class="badge" aria-hidden="true">{n}</span>}
    </button>
  );
}

/** The signed-out state: one line, one button, then the code and the device link. @req FR:pr-page/auth.state @req FR:pr-page/auth.signin */
function SignIn({ api, auth, onDone }: { api: Client; auth: PrAuthState; onDone: () => void }) {
  const [sess, setSess] = useState<SignInSession | null>(auth.session?.state === 'waiting' ? auth.session : null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState('');
  const t = signInText({ ...auth, ...(sess ? { session: sess } : {}) });
  useEffect(() => {
    if (sess?.state !== 'waiting') return;
    const iv = setInterval(() => {
      void api.prSignInState().then((x) => { if (x.state === 'done') { clearInterval(iv); onDone(); } else setSess(x); }).catch(() => undefined);
    }, 3000);
    return () => clearInterval(iv);
  }, [sess?.state]);
  const start = async () => {
    setBusy(true); setErr('');
    try { const x = await api.prSignIn(); if (x.state === 'done') onDone(); else setSess(x); } catch (e) { setErr(errText(e, 'Could not start the sign-in')); } finally { setBusy(false); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(sess?.userCode ?? ''); setCopied(true); } catch { setCopied(false); } };
  return (
    <div class="prs-signin" data-testid="prs-signin">
      <p class="prs-signin-title">{t.title}</p>
      {t.detail && <p class="prs-note">{t.detail}</p>}
      {(t.note || err) && <p class="prs-note" role="alert">{err || t.note}</p>}
      {sess?.state === 'waiting' && sess.userCode ? (
        <div class="prs-code-box" role="status">
          <span>Enter this code on GitHub:</span>
          <code class="prs-code" data-testid="prs-code">{sess.userCode}</code>
          <div class="prs-row-actions">
            <button type="button" class="fl-btn" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy code'}</button>
            <a class="fl-btn primary" href={sess.verificationUri ?? 'https://github.com/login/device'} target="_blank" rel="noopener noreferrer">Open github.com/login/device</a>
          </div>
          <span class="prs-note">Waiting for GitHub…</span>
        </div>
      ) : t.action && <button type="button" class="fl-btn primary" disabled={busy} onClick={() => void start()} data-testid="prs-signin-btn">{busy ? 'Starting…' : t.action}</button>}
    </div>
  );
}

/** The `#/prs` page: the flyout content in the page. @req FR:pr-page/nav.page */
export function PrsPage({ api, toast }: { api: Client; toast: ToastFn }) {
  const s = useStore(api);
  return <Board api={api} s={s} toast={toast} page onClose={() => undefined} />;
}

/** The flyout, once per page; the top bar icon opens it. @req FR:pr-page/icon.open @req FR:pr-page/flyout.shape */
export function PrsFlyoutHost({ api, toast }: { api: Client; toast: ToastFn }) {
  const s = useStore(api);
  const { open } = s.get();
  if (!open) return null;
  return <Board api={api} s={s} toast={toast} onClose={() => { s.setOpen(false); const o = opener && opener.isConnected && opener.offsetParent !== null ? opener : document.querySelector<HTMLElement>('[data-testid="prs-btn"], [data-testid="prs-btn-phone"]'); setTimeout(() => o?.focus(), 0); }} />;
}

/** The details pane beside the list at 1100 px and up, on the page only. @req FR:pr-page/detail.layout */
const WIDE = '(min-width: 1100px)';
function useWide(page: boolean): boolean {
  const q = () => page && typeof window !== 'undefined' && !!window.matchMedia?.(WIDE).matches;
  const [wide, setWide] = useState(q);
  useEffect(() => {
    if (!page || !window.matchMedia) return;
    const m = window.matchMedia(WIDE);
    const on = () => setWide(m.matches);
    m.addEventListener('change', on);
    return () => m.removeEventListener('change', on);
  }, [page]);
  return wide;
}

interface Ctx { board: PrBoard; selected: string | null; select: (r: PrRow) => void; pin: (r: PrRow) => void; busy: boolean }

/** One card everywhere: repo, # link, title, author, one next action, spec lines, Pin. @req FR:pr-page/card.fields @req FR:pr-page/card.color @req FR:pr-page/card.select */
function Card({ r, c, sort }: { r: PrRow; c: Ctx; sort?: { onDown: (e: PointerEvent) => void; onKey: (e: KeyboardEvent) => void; dragging: boolean } }) {
  const spec = specText(r);
  return (
    <li class={`pr-card tone-${toneOf(r)}${sort?.dragging ? ' dragging' : ''}`} data-number={r.number} data-url={r.url} data-selected={c.selected === r.url ? 'true' : undefined}>
      <div class="pr-card-top">
        <span class="pr-repo">{r.repo}</span>
        <a class="pr-num" href={r.url} target="_blank" rel="noopener noreferrer">#{r.number}</a>
        {r.nextAction && <span class="pr-act">{ACTION_LABEL[r.nextAction]}</span>}
      </div>
      <button type="button" class="pr-open" aria-current={c.selected === r.url ? 'true' : undefined} onClick={() => c.select(r)}>
        <span class="pr-title">{clip(r.title, 120)}</span>
        {r.nextAction && <span class="sr-only">, next: {ACTION_LABEL[r.nextAction]}</span>}
        <span class="pr-sub"><span class="pr-author">{authorText(r)}</span>{spec && <span class="pr-spec">{spec}</span>}</span>
        <span class="pr-chev" aria-hidden="true">›</span>
      </button>
      <div class="pr-card-tools">
        {c.board.queue && (
          <button type="button" class="pr-pin" aria-pressed={r.pinned} aria-label={`${r.pinned ? 'Unpin' : 'Pin'} ${refOf(r)}`} title={r.pinned ? 'Unpin: drop it from the Pinned order' : 'Pin: the Sweep Manager works pinned PRs first'} disabled={c.busy} onClick={() => c.pin(r)}>
            <PinIcon on={r.pinned} />
          </button>
        )}
        {sort && (
          <button type="button" class="pr-grip" aria-label={`Reorder ${refOf(r)}`} aria-describedby="prs-sort-help" title="Drag to reorder, or press Space then the arrow keys"
            onPointerDown={(e) => sort.onDown(e as unknown as PointerEvent)} onKeyDown={(e) => sort.onKey(e as unknown as KeyboardEvent)}>
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" stroke="currentColor" stroke-width="3" stroke-linecap="round" /></svg>
          </button>
        )}
      </div>
    </li>
  );
}

/** The Pinned tab: the only list with an order. Drag the handle, or Space, arrows, Space. @req FR:pr-page/pin.tab @req FR:pr-page/pin.drag @req FR:pr-page/pin.keys */
function Pinned({ rows, c, onMove }: { rows: PrRow[]; c: Ctx; onMove: (r: PrRow, rank: number) => void }) {
  const ids = rows.map((r) => r.url);
  const [order, setOrder] = useState<string[] | null>(null);
  const [held, setHeld] = useState<string | null>(null);
  const [say, setSay] = useState('');
  const listRef = useRef<HTMLUListElement>(null);
  const shown = order ?? ids;
  const by = new Map(rows.map((r) => [r.url, r]));
  // A new board drops the local order, but never under a keyboard pick-up.
  const heldRef = useRef(held);
  heldRef.current = held;
  useEffect(() => { if (!heldRef.current) setOrder(null); }, [rows]);
  const commit = (id: string, next: string[]) => {
    const r = by.get(id);
    const to = next.indexOf(id);
    const res = moveTo(ids, id, to);
    // The queue rank of the card now at that place: a project filter or a pinned PR off the board leaves gaps in the visible list.
    const rank = by.get(ids[to])?.rank ?? (res ? res.rank : null);
    if (r && res && rank) onMove(r, rank); else setOrder(null);
  };
  // A moved card loses focus when the list reorders: give it back to the held handle.
  useLayoutEffect(() => {
    if (!held) return;
    const g = listRef.current?.querySelector<HTMLElement>(`.pr-card[data-url="${CSS.escape(held)}"] .pr-grip`);
    if (g && document.activeElement !== g && (!document.activeElement || document.activeElement === document.body || listRef.current?.contains(document.activeElement))) g.focus();
  }, [shown.join(), held]);
  const place = (id: string, list: string[]) => setSay(`${refOf(by.get(id)!)}, place ${list.indexOf(id) + 1} of ${list.length}`);
  const onDown = (r: PrRow) => (e: PointerEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();
    let cur = ids;
    const move = (ev: PointerEvent) => {
      const cards = [...(listRef.current?.querySelectorAll<HTMLElement>('.pr-card') ?? [])].filter((el) => el.dataset.url !== r.url);
      const to = cards.filter((el) => { const b = el.getBoundingClientRect(); return b.top + b.height / 2 < ev.clientY; }).length;
      const m = moveTo(ids, r.url, to);
      cur = m ? m.order : ids;
      setOrder(cur);
      setHeld(r.url);
    };
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      move(ev);
      setHeld(null);
      if (cur !== ids) { commit(r.url, cur); place(r.url, cur); }
    };
    const cancel = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', cancel); setHeld(null); setOrder(null); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  };
  const onKey = (r: PrRow) => (e: KeyboardEvent) => {
    const k = e.key;
    if (k === ' ' || k === 'Enter') {
      e.preventDefault(); e.stopPropagation();
      if (held !== r.url) { setHeld(r.url); setSay(`Picked up ${refOf(r)}. Use the arrow keys, then Space to drop.`); return; }
      setHeld(null);
      if (order && order.indexOf(r.url) !== ids.indexOf(r.url)) { commit(r.url, order); place(r.url, order); } else { setOrder(null); setSay(`Dropped ${refOf(r)}. No change.`); }
      return;
    }
    if (held !== r.url) return;
    if (k === 'Escape') { e.preventDefault(); e.stopPropagation(); setHeld(null); setOrder(null); setSay(`Cancelled. ${refOf(r)} did not move.`); return; }
    if (k === 'ArrowUp' || k === 'ArrowDown') {
      e.preventDefault(); e.stopPropagation();
      const m = moveTo(shown, r.url, shown.indexOf(r.url) + (k === 'ArrowDown' ? 1 : -1));
      if (m) { setOrder(m.order); place(r.url, m.order); }
    }
  };
  return (
    <>
      <p id="prs-sort-help" class="prs-hint">Drag a handle to set the order. Keyboard: Space to pick up, arrow keys to move, Space to drop, Escape to cancel.</p>
      <p class="sr-only" role="status" aria-live="polite" data-testid="prs-sort-status">{say}</p>
      <ul ref={listRef} class="pr-cards" aria-label="Pinned, in order">{shown.map((u) => by.get(u)).filter((r): r is PrRow => !!r).map((r) => <Card key={r.url} r={r} c={c} sort={{ onDown: onDown(r), onKey: onKey(r), dragging: held === r.url }} />)}</ul>
    </>
  );
}

/** The details for the selected card: only what its next action needs. No AI call. @req FR:pr-page/detail.validate @req FR:pr-page/detail.signoff @req FR:pr-page/detail.approve @req FR:pr-page/detail.publish @req FR:pr-page/detail.autopilot @req FR:pr-page/detail.none */
function Detail({ r, back, busy, onResolve }: { r: PrRow; back?: () => void; busy: boolean; onResolve: (r: PrRow, id: string) => void }) {
  const [i, setI] = useState(0);
  const h = useRef<HTMLHeadingElement>(null);
  useEffect(() => { setI(0); }, [r.url]);
  useLayoutEffect(() => { if (back) h.current?.focus(); }, [r.url]);
  const a = r.nextAction;
  const ext = { target: '_blank', rel: 'noopener noreferrer' } as const;
  const head = (
    <>
      {back && <button type="button" class="fl-btn subtle prs-back" onClick={back}>‹ Back</button>}
      <h3 ref={h} tabIndex={-1} class="pr-d-h">{a ? ACTION_LABEL[a] : 'No action'}</h3>
      <p class="pr-d-pr"><a href={r.url} {...ext}>{refOf(r)}</a> {r.title}</p>
    </>
  );
  if (a === 'validate') {
    const s = r.detail.steps;
    return (
      <div class="pr-d">
        {head}
        <p class="pr-d-what">Check that this PR works in the running app before it merges.{s?.source === 'lane' && ` ${LANE_WORD[s.state] ?? ''}`}</p>
        {s?.source === 'lane' && s.serverUrl && <p><a class="fl-btn primary" href={s.serverUrl} {...ext}>Open the app: {s.serverUrl.replace(/^https?:\/\//, '')}</a></p>}
        {s && s.items.length > 0
          ? <><h4 class="pr-d-sub">Steps</h4><ol class="pr-d-steps">{s.items.map((x, k) => <li key={k}>{x.text}{'state' in x && x.state && <span class={`pr-d-state s-${x.state}`}> · {ITEM_WORD[x.state] ?? x.state}</span>}</li>)}</ol></>
          : <p>No steps listed. <a href={r.url} {...ext}>Open PR</a></p>}
        {s?.source === 'lane' && <p><a href="#/live">Open the checklist to tick items</a></p>}
      </div>
    );
  }
  if (a === 'signoff') {
    const list = r.detail.signoff ?? [];
    const k = Math.min(i, Math.max(0, list.length - 1));
    const t = list[k];
    return (
      <div class="pr-d">
        {head}
        {list.length > 1 && (
          <div class="pr-d-nav">
            <button type="button" class="fl-btn" aria-label="Previous thread" disabled={k === 0} onClick={() => setI(k - 1)}>‹ Previous</button>
            <span>Thread {k + 1} of {list.length}</span>
            <button type="button" class="fl-btn" aria-label="Next thread" disabled={k >= list.length - 1} onClick={() => setI(k + 1)}>Next ›</button>
          </div>
        )}
        {!t ? <p>No open sign-off thread. <a href={r.url} {...ext}>Open PR</a></p> : <>
          {t.path && <p class="pr-d-path"><code>{t.path}</code></p>}
          <h4 class="pr-d-sub">You asked {t.ask.at && <span class="pr-d-when">{whenText(t.ask.at)}</span>}</h4>
          <blockquote class="pr-d-quote">{t.ask.body}</blockquote>
          <p><a href={t.ask.url ?? t.url} {...ext}>Open thread</a></p>
          <h4 class="pr-d-sub">How it was addressed</h4>
          {t.after.length === 0 && t.commits.length === 0 ? <p class="pr-d-none">No reply or commit since your ask.</p> : (
            <ul class="pr-d-log">
              {t.after.map((x, n) => <li key={`c${n}`}><span class="pr-d-who">{x.author}</span> <a href={x.url ?? t.url} {...ext}>{clip(x.body.replace(/\s+/g, ' '), 300)}</a></li>)}
              {t.commits.map((x) => <li key={x.sha}><span class="pr-d-who">Commit {x.sha.slice(0, 7)}</span> <a href={x.url} {...ext}>{x.title}</a></li>)}
            </ul>
          )}
          <div class="prs-row-actions">
            <button type="button" class="fl-btn primary" disabled={busy || !t.id} onClick={() => onResolve(r, t.id)}>Resolve thread</button>
            <a class="fl-btn" href={`${r.url}/files`} {...ext}>Re-review</a>
          </div>
        </>}
      </div>
    );
  }
  if (a === 'approve') {
    return <div class="pr-d">{head}<p>Review the changes on GitHub, then approve there.</p><p><a class="fl-btn primary" href={`${r.url}/files`} {...ext}>Open PR files</a></p></div>;
  }
  if (a === 'publish') {
    const rv = r.detail.review;
    const simple = rv && rv.comments.length <= 5 && rv.comments.every((x) => x.body.length <= 300);
    return (
      <div class="pr-d">
        {head}
        <p>Your review is a draft. Publish it on GitHub.</p>
        <p><a class="fl-btn primary" href={rv?.url ?? `${r.url}/files`} {...ext}>Open your draft review</a></p>
        {simple && rv!.comments.length > 0 && <><h4 class="pr-d-sub">Your findings</h4><ul class="pr-d-log">{rv!.comments.map((x, n) => <li key={n}>{x.path && <code>{x.path}</code>} {x.body}</li>)}</ul></>}
      </div>
    );
  }
  if (a === 'autopilot') {
    const notes = r.detail.notes ?? [];
    return (
      <div class="pr-d">
        {head}
        <p>Every thread is resolved, or only one waits for your reply. Add the Autopilot label on GitHub when it is ready.</p>
        <p><a class="fl-btn primary" href={r.url} {...ext}>Open PR</a></p>
        <h4 class="pr-d-sub">Your earlier comments</h4>
        {notes.length === 0 ? <p class="pr-d-none">No earlier comments from you.</p>
          : <ul class="pr-d-log">{notes.map((x, n) => <li key={n}>{x.at && <span class="pr-d-when">{whenText(x.at)}</span>} <a href={x.url} {...ext}>{clip(x.body.replace(/\s+/g, ' '), 300)}</a></li>)}</ul>}
      </div>
    );
  }
  return <div class="pr-d">{head}<p class="pr-d-none">Nothing for you now.</p><p><a class="fl-btn" href={r.url} {...ext}>Open PR</a></p></div>;
}

/** "Am I missing anything?" stays short. @req FR:pr-page/summary.missing */
const MISS_MAX = 10;
const moreText = (rest: PrRow[]) => {
  const where = (['processing', 'waiting', 'pending', 'paused'] as const).filter((g) => rest.some((r) => r.group === g)).map((g) => TAB_LABEL[g]);
  return `${rest.length} more in ${where.length > 1 ? `${where.slice(0, -1).join(', ')} and ${where[where.length - 1]}` : where[0] ?? 'the tabs'}.`;
};

function Board({ api, s, toast, onClose, page = false }: { api: Client; s: PrStore; toast: ToastFn; onClose: () => void; page?: boolean }) {
  const { board, phase, auth, busy: loading } = s.get();
  const [prefs, setPrefsState] = useState<Prefs>(() => loadPrefs(local()));
  const setPrefs = (p: Prefs) => { setPrefsState(p); savePrefs(local(), p); };
  const [now, setNow] = useState(() => new Date());
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const wide = useWide(page);
  const ref = useRef<HTMLDivElement>(null);
  // The page and the flyout can both be open: every id is page- or flyout-specific.
  const px = page ? 'prs-page' : 'prs';
  const tabs = tabsOf();
  const tab: Tab = tabs.includes(prefs.tab) ? prefs.tab : 'summary';
  const projects = projectsOf(board);
  const sel = prefs.projects.filter((p) => projects.includes(p));
  const rows = useMemo(() => rowsOf(board, tab, sel), [board, tab, sel.join()]);
  const sum = useMemo(() => summaryView(board, sel), [board, sel.join()]);
  const row = selected ? board?.rows.find((r) => r.url === selected) ?? null : null;

  // The age ticks; the board does not reload by itself. @req FR:pr-page/live.age @req FR:pr-page/live.event
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 1000); return () => clearInterval(t); }, []);
  // Opening the page or flyout again shows the current board (not on first load: the store loads then).
  useEffect(() => { if (s.get().board) void s.reload(); }, []);
  useLayoutEffect(() => { if (!page) (ref.current?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ?? ref.current?.querySelector<HTMLElement>('button'))?.focus(); }, []);
  useEffect(() => { if (selected && board && !row) setSelected(null); }, [board]);

  /** The focus trap: the flyout plus the toasts, whose Undo must stay in reach by keyboard. */
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (page) return;
    const key = (e: KeyboardEvent) => {
      const fly = ref.current;
      if (!fly) return;
      const a = document.activeElement as HTMLElement | null;
      const inToasts = !!a?.closest('.toasts');
      if (a && a !== document.body && !inToasts && !fly.contains(a)) return;
      if (inToasts) e.stopPropagation();
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
  const run = async (fn: () => Promise<void>) => { setBusy(true); try { await fn(); } finally { setBusy(false); } };

  /** Pin adds the PR to the queue when needed; Unpin keeps it queued. @req FR:pr-page/pin.toggle */
  const pin = (r: PrRow) => void run(async () => {
    try { await api.prQueue(r.repo, r.number, r.pinned ? 'unpin' : 'pin'); toast(r.pinned ? `Unpinned ${refOf(r)}` : `Pinned ${refOf(r)}`); reload(); }
    catch (e) { toast(errText(e, 'Pin failed'), 'err'); }
  });
  /** A drop in Pinned: the new rank (pinned items lead the queue). @req FR:pr-page/pin.drag */
  const moveRow = (r: PrRow, rank: number) => void run(async () => {
    try { await api.prQueue(r.repo, r.number, 'move', rank); reload(); }
    catch (e) { toast(errText(e, 'Move failed'), 'err'); reload(); }
  });
  /** Resolve with Undo, which reopens the thread. @req FR:pr-page/detail.signoff @req FR:pr-page/api.resolve */
  const resolve = (r: PrRow, id: string) => void run(async () => {
    try {
      await api.prResolve(r.repo, r.number, id, 'resolve');
      toast(`Resolved a thread on ${refOf(r)}`, 'ok', () => { void api.prResolve(r.repo, r.number, id, 'unresolve').then(reload, (e) => toast(errText(e, 'Undo failed'), 'err')); });
      reload();
    } catch (e) { toast(errText(e, 'Could not resolve the thread'), 'err'); }
  });

  const select = (r: PrRow) => setSelected(r.url);
  const back = () => {
    const u = selected;
    setSelected(null);
    setTimeout(() => { const q = CSS.escape(u ?? ''); (ref.current?.querySelector<HTMLElement>(`.pr-card[data-url="${q}"] .pr-open`) ?? ref.current?.querySelector<HTMLElement>(`.pr-miss-open[data-url="${q}"]`))?.focus(); }, 0);
  };
  const c: Ctx | null = board ? { board, selected, select, pin, busy } : null;

  const tabKeys = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const i = tabs.indexOf(tab);
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : tabs.length - 1)) % tabs.length];
    setPrefs({ ...prefs, tab: next });
    setTimeout(() => ref.current?.querySelector<HTMLElement>(`#${px}-tab-${next}`)?.focus(), 0);
  };

  const cards = (list: PrRow[], label: string) => <ul class="pr-cards" aria-label={label}>{list.map((r) => <Card key={r.url} r={r} c={c!} />)}</ul>;
  const section = (title: string, list: PrRow[]) => (
    <section class="pr-sec" aria-label={title}>
      <h3 class="pr-sec-h">{title}</h3>
      {list.length ? cards(list, title) : <p class="prs-empty">None now.</p>}
    </section>
  );
  const summary = (
    <>
      {section('Needs live validation', sum.live)}
      {section('Needs your sign-off', sum.signoff)}
      {section('Ready for Autopilot', sum.autopilot)}
      <section class="pr-sec" aria-label="Am I missing anything?">
        <h3 class="pr-sec-h">Am I missing anything?</h3>
        {sum.missing.length === 0 ? <p class="prs-empty">Nothing else.</p> : (
          <ul class="pr-miss">
            {sum.missing.slice(0, MISS_MAX).map((m, k) => (
              <li key={`${m.row.url}-${k}`}>
                <a class="pr-num" href={m.row.url} target="_blank" rel="noopener noreferrer">{refOf(m.row)}</a>
                <button type="button" class="pr-miss-open" data-url={m.row.url} onClick={() => select(m.row)}>{clip(m.row.title, 80)}</button>
                <span class="pr-miss-why">{m.reason}</span>
              </li>
            ))}
          </ul>
        )}
        {sum.missing.length > MISS_MAX && <p class="prs-hint" data-testid="prs-miss-more">{moreText(sum.missing.slice(MISS_MAX).map((m) => m.row))}</p>}
      </section>
    </>
  );

  const showDetail = !!row && !wide;
  const hid = page ? 'prs-page-h' : 'prs-h';
  const body = (
    <div ref={ref} class={`prs-fly fl${page ? ' page' : ''}${wide ? ' wide' : ''}`} {...(page ? { 'data-testid': 'prs-page' } : { role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'prs-h', 'data-testid': 'prs-flyout' })} onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        // The app shortcuts stay out while the flyout is open; on the page, only the keys a control used.
        if (page) { if (e.defaultPrevented) e.stopPropagation(); return; }
        e.stopPropagation();
        if (e.key === 'Escape') { e.preventDefault(); onClose(); }
      }}>
      <header class="prs-head">
        <h2 id={hid}>Pull requests</h2>
        <span class="prs-age" role="status" aria-live="off" data-testid="prs-age">{updatedText(board, now)}</span>
        {board && <button type="button" class={`prs-refresh${loading ? ' spin' : ''}`} aria-label="Refresh pull requests" title="Refresh pull requests" disabled={loading} onClick={() => void s.reload(true)}><RefreshIcon /></button>}
        {!page && <button type="button" class="fl-btn prs-close" onClick={onClose} aria-label="Close pull requests">Close</button>}
      </header>
      {/* Signed out, loading, or a failed first load: one state, never a zero board. @req FR:pr-page/auth.state @req FR:pr-page/nav.load */}
      {!board || !c ? (phase === 'signin' && auth ? <SignIn api={api} auth={auth} onDone={reload} />
        : phase === 'off' ? <div class="prs-signin" data-testid="prs-off"><p class="prs-signin-title">This host has no PR board.</p><p class="prs-note">Set GITHUB_TOKEN on the host, and check STACK_GITHUB_REPOS is a valid list.</p></div>
        : phase === 'error' ? <div class="prs-signin" role="alert"><p class="prs-signin-title">Could not load your PRs.</p><button type="button" class="fl-btn primary" onClick={reload}>Retry</button></div>
        : <div class="skeleton prs-sk" role="status" aria-busy="true" aria-label="Loading pull requests" data-testid="prs-skeleton"><div class="sk" /><div class="sk" /><div class="sk" /><div class="sk" /></div>) : <>
        {board.error && board.at && <p class="prs-note" role="status">{board.error}. Showing the last good copy.</p>}
        {board.truncated && <p class="prs-note">Some PRs may be missing: a search hit its 50-PR limit.</p>}
        {projects.length > 1 && (
          <div class="prs-chips" role="group" aria-label="Filter by project">
            {projects.map((p) => <button type="button" key={p} class="fl-chip prs-chip" aria-pressed={sel.includes(p)} onClick={() => setPrefs({ ...prefs, projects: sel.includes(p) ? sel.filter((x) => x !== p) : [...sel, p] })}>{PROJECT_LABEL[p] ?? p}</button>)}
          </div>
        )}
        <div class="prs-tabs" role="tablist" aria-label="PR groups" onKeyDown={tabKeys}>
          {tabs.map((t) => (
            <button type="button" role="tab" key={t} id={`${px}-tab-${t}`} aria-controls={`${px}-panel`} aria-selected={t === tab} tabIndex={t === tab ? 0 : -1} class={`prs-tab${t === tab ? ' on' : ''}`} onClick={() => { setPrefs({ ...prefs, tab: t }); }}>
              {TAB_LABEL[t]} <span class="prs-count">{countOf(board, t, sel)}</span>
            </button>
          ))}
        </div>
        <div class={`prs-body${wide ? ' split' : ''}`}>
          <div class="pr-list-col" hidden={showDetail}>
            <div class="prs-panel" id={`${px}-panel`} role="tabpanel" aria-labelledby={`${px}-tab-${tab}`}>
              {tab === 'summary' ? summary
                : rows.length === 0 ? <p class="prs-empty" data-testid="prs-empty">{EMPTY[tab]}</p>
                : tab === 'pinned' && board.queue ? <Pinned rows={rows} c={c} onMove={moveRow} />
                : cards(rows, TAB_LABEL[tab])}
            </div>
          </div>
          {(wide || showDetail) && (
            <aside class="pr-detail-col" data-testid="prs-detail" aria-label="PR details">
              {row ? <Detail r={row} busy={busy} onResolve={resolve} {...(wide ? {} : { back })} /> : <p class="prs-empty">Select a PR to see its next step.</p>}
            </aside>
          )}
        </div>
        <footer class="prs-foot" data-testid="prs-foot">running {board.footer.running} · waiting {board.footer.waiting} · parked {board.footer.parked}</footer>
      </>}
    </div>
  );
  return page ? <section class={`prs-pagewrap${wide ? ' wide' : ''}`} aria-labelledby={hid}>{body}</section> : <div class="prs-scrim" onClick={onClose}>{body}</div>;
}
