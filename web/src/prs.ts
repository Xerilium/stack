/**
 * The PR page model on the page side: tabs, the Summary, card words and tones, the Pinned order, and the shared board store. No DOM.
 * @req FR:pr-page/flyout.tabs @req FR:pr-page/flyout.filter @req FR:pr-page/card.fields @req FR:pr-page/card.color @req FR:pr-page/live.age @req FR:pr-page/live.event
 * @req FR:pr-page/summary.layout @req FR:pr-page/pin.tab @req FR:pr-page/pin.drag
 */

export type PrGroup = 'processing' | 'waiting' | 'pending' | 'paused';
export type Bucket = 'approve' | 'review' | 'decide' | 'unblock';
export type NextAction = 'validate' | 'signoff' | 'publish' | 'approve' | 'autopilot';
export interface PrState { owner: 'me' | 'reviewer' | 'ci' | 'runner' | 'none'; login?: string; bucket?: Bucket; blocker: string; link: string; stalled: boolean; source: 'report' | 'rule'; key?: string; replyTo?: number; answered?: string }
export interface PrComment { author: string; body: string; url?: string; at?: string }
export interface SignoffDetail { id: string; url: string; path?: string; ask: PrComment; after: PrComment[]; commits: { sha: string; title: string; url: string; at: string }[] }
export type StepsDetail = { source: 'lane'; state: string; serverUrl?: string; items: { text: string; state: string }[] } | { source: 'body'; items: { text: string; state?: string }[] };
export interface PrDetail { signoff?: SignoffDetail[]; review?: { url: string; body: string; comments: { path: string; body: string }[] }; steps?: StepsDetail; notes?: { body: string; url: string; at?: string }[] }
export interface PrRow {
  url: string; repo: string; number: number; title: string; author: string; mine: boolean; project: string; group: PrGroup; draft: boolean;
  createdAt: string; updatedAt: string; ci: 'passing' | 'failing' | 'pending' | 'none'; unresolved: number; labels: string[]; state: PrState; bucket?: Bucket;
  healthy: boolean; agent: boolean; after: string[]; rank: number | null; pinned: boolean; rec?: { id: string; agent: string; reason: string; toRank?: number }; autopilot: boolean;
  nextAction: NextAction | null; specLines: number | null; detail: PrDetail;
}
export interface PrSummary { live: string[]; signoff: string[]; autopilot: string[]; missing: { url: string; reason: string }[] }
export interface PrBoard {
  at: string | null; user: string; agents: { count: number; source: 'sessions' | 'wip-label' }; counts: Record<PrGroup, number>;
  footer: { running: number; waiting: number; parked: number }; rows: PrRow[]; summary?: PrSummary;
  queue: boolean; rate?: { until: string }; error?: string; truncated?: boolean;
}
export type Tab = 'summary' | PrGroup | 'pinned';
/** The host has no GitHub token: one honest state. @req FR:pr-page/auth.state */
export interface SignInSession { state: 'waiting' | 'done' | 'error' | 'none'; userCode?: string; verificationUri?: string; error?: string }
export interface PrAuthState { state: 'signed-out'; method: 'gh' | 'none'; session?: SignInSession }

export const TAB_LABEL: Record<Tab, string> = { summary: 'Summary', processing: 'Processing', waiting: 'Waiting on me', pending: 'Pending', paused: 'Paused', pinned: 'Pinned' };
export const EMPTY: Record<Tab, string> = {
  summary: 'Nothing needs you now.', processing: 'No Autopilot PR.', waiting: 'No PR waits for your review.', pending: 'No PR of yours waits for Autopilot.', paused: 'No paused PR.',
  pinned: 'No pinned PR. Pin a card to set the order the Sweep Manager works.',
};
/** The one next action on a card. @req FR:pr-page/card.action */
export const ACTION_LABEL: Record<NextAction, string> = { validate: 'Validate', signoff: 'Sign off', approve: 'Approve', publish: 'Publish review', autopilot: 'Enable Autopilot' };
export const PROJECT_LABEL: Record<string, string> = { allyte: 'Allyte', ftk: 'FTK', focus: 'FOCUS', f4: 'F4', xerilium: 'Xerilium', other: 'Other' };
export const PROJECT_ORDER = ['allyte', 'ftk', 'focus', 'f4', 'xerilium', 'other'];
const TABS: Tab[] = ['summary', 'processing', 'waiting', 'pending', 'paused', 'pinned'];

/** Tabs in order: Summary first, Pinned last. @req FR:pr-page/flyout.tabs */
export const tabsOf = (): Tab[] => TABS;
const inProjects = (p: string, sel: string[]) => sel.length === 0 || sel.includes(p);
/** Projects present on the board, in project order. */
export const projectsOf = (b: PrBoard | null): string[] => PROJECT_ORDER.filter((p) => b?.rows.some((r) => r.project === p));

/** Rows of one tab under the project filter. Pinned is by queue rank. @req FR:pr-page/flyout.filter @req FR:pr-page/pin.tab */
export function rowsOf(b: PrBoard | null, tab: Tab, sel: string[]): PrRow[] {
  if (!b || tab === 'summary') return [];
  if (tab === 'pinned') return b.rows.filter((r) => r.pinned && inProjects(r.project, sel)).sort((x, y) => (x.rank ?? Infinity) - (y.rank ?? Infinity));
  return b.rows.filter((r) => r.group === tab && inProjects(r.project, sel));
}

export interface SummaryView { live: PrRow[]; signoff: PrRow[]; autopilot: PrRow[]; missing: { row: PrRow; reason: string }[] }
/** The Summary sections as rows, under the project filter. @req FR:pr-page/summary.layout */
export function summaryView(b: PrBoard | null, sel: string[]): SummaryView {
  const by = new Map((b?.rows ?? []).map((r) => [r.url, r]));
  const rows = (urls: string[] = []) => urls.map((u) => by.get(u)).filter((r): r is PrRow => !!r && inProjects(r.project, sel));
  const s = b?.summary;
  return {
    live: rows(s?.live), signoff: rows(s?.signoff), autopilot: rows(s?.autopilot),
    missing: (s?.missing ?? []).flatMap((m) => { const row = by.get(m.url); return row && inProjects(row.project, sel) ? [{ row, reason: m.reason }] : []; }),
  };
}

/** Counts that follow the filter; Summary counts the distinct PRs it lists. */
export function countOf(b: PrBoard | null, tab: Tab, sel: string[]): number {
  if (!b) return 0;
  if (tab !== 'summary') return rowsOf(b, tab, sel).length;
  const v = summaryView(b, sel);
  return new Set([...v.live, ...v.signoff, ...v.autopilot, ...v.missing.map((m) => m.row)].map((r) => r.url)).size;
}

/** `My Autopilot`, `You`, or the login. @req FR:pr-page/card.fields */
export const authorText = (r: PrRow) => (r.mine ? (r.autopilot ? 'My Autopilot' : 'You') : r.author);
/** The card tone: owner kind, strong when it has a next action. @req FR:pr-page/card.color */
export const toneOf = (r: PrRow) => `${r.mine ? (r.autopilot ? 'auto' : 'mine') : 'other'}${r.nextAction ? ' strong' : ''}`;
/** Small muted text, only when known. */
export const specText = (r: PrRow) => (r.specLines === null || r.specLines === undefined ? '' : `${r.specLines} spec ${r.specLines === 1 ? 'line' : 'lines'}`);

/** Moves `id` to place `to` (0 first). Null when nothing moves. The rank is the new place, 1 first. @req FR:pr-page/pin.drag */
export function moveTo(order: string[], id: string, to: number): { order: string[]; rank: number } | null {
  const from = order.indexOf(id);
  if (from < 0) return null;
  const t = Math.max(0, Math.min(order.length - 1, to));
  if (t === from) return null;
  const next = order.filter((x) => x !== id);
  next.splice(t, 0, id);
  return { order: next, rank: t + 1 };
}

/** `Updated 12 s ago`, or `Paused until 2:15` while the host backs off. @req FR:pr-page/live.age */
export function updatedText(b: PrBoard | null, now: Date): string {
  if (!b) return '';
  if (b.rate && Date.parse(b.rate.until) > now.getTime()) return `Paused until ${new Date(b.rate.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  if (!b.at) return b.error ?? 'Not loaded yet';
  const s = Math.max(0, Math.round((now.getTime() - Date.parse(b.at)) / 1000));
  return `Updated ${s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 3600)} h`} ago`;
}
/** Cut to `n` characters at a word. */
export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : s);
export const refOf = (x: { repo: string; number: number }) => `${x.repo}#${x.number}`;
/** Short local date and time. */
export const whenText = (iso?: string) => { const t = Date.parse(iso ?? ''); return Number.isFinite(t) ? new Date(t).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; };
/** A live checklist state as a word. */
export const ITEM_WORD: Record<string, string> = { open: 'Open', passed: 'Passed', failed: 'Failed', 'needs-fix': 'Needs a fix', 'fixed-pending-revalidation': 'Fixed, check again', blocked: 'Needs you' };
export const LANE_WORD: Record<string, string> = { preparing: 'The agent is preparing the server.', working: 'The agent is working on a fix.', 'ready-for-michael': 'Ready for you.', revalidating: 'Ready for you to check the fixes.' };

/** The nav count: rows with a next action. @req FR:pr-page/nav.badge */
export const needCount = (b: PrBoard | null): number => (b ? b.rows.filter((r) => r.nextAction).length : 0);
/** The one signed-out state. @req FR:pr-page/auth.state */
export function signInText(a: PrAuthState): { title: string; action?: string; detail?: string; note?: string } {
  if (a.method === 'none') return { title: 'Install the GitHub CLI, or set GITHUB_TOKEN.', detail: 'Then reopen this page. Stack reads the gh sign-in; it never stores a token.' };
  const e = a.session?.state === 'error' ? a.session.error : undefined;
  return { title: 'Sign in to GitHub to see your PRs.', action: 'Sign in to GitHub', ...(e ? { note: e === 'expired' ? 'The code expired. Try again.' : e === 'gh-missing' ? 'The GitHub CLI is not installed.' : 'GitHub sign-in did not finish. Try again.' } : {}) };
}

// ---- prefs (per viewer; storage may be missing)
const PREFS = 'stack.prs.v1';
export interface Prefs { tab: Tab; projects: string[] }
export function loadPrefs(s: Pick<Storage, 'getItem'> | null): Prefs {
  try {
    const v = JSON.parse(s?.getItem(PREFS) ?? 'null') as Partial<Prefs> | null;
    return { tab: v?.tab && TABS.includes(v.tab) ? v.tab : 'summary', projects: Array.isArray(v?.projects) ? v!.projects.filter((p) => typeof p === 'string') : [] };
  } catch { return { tab: 'summary', projects: [] }; }
}
export function savePrefs(s: Pick<Storage, 'setItem'> | null, p: Prefs): void { try { s?.setItem(PREFS, JSON.stringify(p)); } catch { /* private mode */ } }

// ---- the shared board store: one fetch for every icon and the flyout
export type Phase = 'loading' | 'ready' | 'off' | 'error' | 'signin';
interface StoreState { board: PrBoard | null; phase: Phase; open: boolean; auth: PrAuthState | null; busy: boolean }
export interface PrStore {
  get(): StoreState; subscribe(fn: () => void): () => void;
  /** Loads the board; `fresh` asks the host to poll GitHub first (the Refresh button). */
  reload(fresh?: boolean): Promise<void>; setOpen(v: boolean): void;
}
/**
 * Loads on first subscribe, then only on request: after an owner action and on Refresh. No timer, no event reload, no reload on show.
 * Signed out, it checks every 15 s so a terminal sign-in shows. @req FR:pr-page/live.event @req FR:pr-page/auth.state
 */
export function createPrStore(load: (fresh: boolean) => Promise<PrBoard | { off: true } | { auth: PrAuthState }>, o: { visible?: () => boolean; /** The reload cadence while signed out. */ signinEvery?: number; status?: (e: unknown) => number; /** The host says it has a board; false means off with no request (no 404 in the console). */ enabled?: () => Promise<boolean> } = {}): PrStore {
  let st: StoreState = { board: null, phase: 'loading', open: false, auth: null, busy: false };
  const subs = new Set<() => void>();
  const set = (p: Partial<StoreState>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
  const visible = o.visible ?? (() => typeof document === 'undefined' || document.visibilityState === 'visible');
  let busy = false;
  // A reload asked for while one runs runs once after it: an action's result is never lost.
  let again: { fresh: boolean } | null = null;
  let stop: (() => void) | null = null;
  let gate: Promise<boolean> | null = null;
  const reload = async (fresh = false): Promise<void> => {
    if (gate && !(await gate)) return;
    // Check after the gate: two reloads that wait on it together must not both load.
    if (st.phase === 'off') return;
    if (busy) { if (st.board) again = { fresh: fresh || !!again?.fresh }; return; }
    busy = true;
    set({ busy: true });
    try {
      const b = await load(fresh);
      if ('off' in b && b.off) set({ phase: 'off' });
      else if ('auth' in b && b.auth) set({ phase: 'signin', auth: b.auth, board: null });
      // A first load that failed has no snapshot: the failed state, never a zero board. @req FR:pr-page/nav.load
      else if (!(b as PrBoard).at && (b as PrBoard).error) set({ phase: 'error', board: null, auth: null });
      else set({ board: b as PrBoard, phase: 'ready', auth: null });
    } catch (e) {
      const status = o.status?.(e) ?? (e as { status?: number })?.status;
      set({ phase: status === 404 ? 'off' : st.board ? 'ready' : 'error' });
    } finally { busy = false; set({ busy: false }); }
    if (again) { const a = again; again = null; await reload(a.fresh); }
  };
  const start = () => {
    gate ??= o.enabled ? o.enabled().catch(() => false) : Promise.resolve(true);
    void gate.then((on) => { if (on) void reload(); else set({ phase: 'off' }); });
    const t = setInterval(() => { if (visible() && st.phase === 'signin') void reload(); }, o.signinEvery ?? 15_000);
    stop = () => clearInterval(t);
  };
  return {
    get: () => st,
    subscribe(fn) { subs.add(fn); if (subs.size === 1 && !stop) start(); return () => { subs.delete(fn); if (subs.size === 0) { stop?.(); stop = null; } }; },
    reload,
    setOpen: (v) => set({ open: v }),
  };
}
