/**
 * The PR page model on the page side: tabs, filters, words, and the shared board store. No DOM.
 * @req FR:pr-page/flyout.tabs @req FR:pr-page/flyout.filter @req FR:pr-page/flyout.row @req FR:pr-page/live.age @req FR:pr-page/live.event
 */
import { onLiveChange } from './live';

export type PrGroup = 'blocked' | 'waiting' | 'processing' | 'pending' | 'paused';
export type Bucket = 'approve' | 'review' | 'decide' | 'unblock';
export interface PrState { owner: 'me' | 'reviewer' | 'ci' | 'runner' | 'none'; login?: string; bucket?: Bucket; blocker: string; link: string; stalled: boolean; source: 'report' | 'rule'; key?: string; replyTo?: number; answered?: string }
export interface PrRow {
  url: string; repo: string; number: number; title: string; author: string; project: string; group: PrGroup; draft: boolean;
  createdAt: string; updatedAt: string; ci: 'passing' | 'failing' | 'pending' | 'none'; unresolved: number; labels: string[]; state: PrState; bucket?: Bucket;
  healthy: boolean; agent: boolean; after: string[]; rank: number | null; pinned: boolean; rec?: { id: string; agent: string; reason: string; toRank?: number }; autopilot: boolean;
}
export interface EscEntry { repo: string; number: number; url: string; title?: string; blocker?: string; context?: string; recommend?: string; link?: string; project?: string; /** @req FR:ask-briefs/brief.pr */ brief?: import('./AskBrief').Brief }
export interface PrBoard {
  at: string | null; user: string; agents: { count: number; source: 'sessions' | 'wip-label' }; counts: Record<PrGroup, number>;
  footer: { running: number; waiting: number; parked: number }; rows: PrRow[]; escalations?: { at?: string; blocked: EscEntry[]; enable: EscEntry[]; live: EscEntry[] };
  queue: boolean; rate?: { until: string }; error?: string; truncated?: boolean;
}
export type Tab = 'escalations' | PrGroup;

export const TAB_LABEL: Record<Tab, string> = { escalations: 'Escalation set', blocked: 'Blocked on me', waiting: 'Waiting on me', processing: 'Processing', pending: 'Pending', paused: 'Paused' };
export const EMPTY: Record<Tab, string> = {
  escalations: 'No escalation set. The Sweep Manager writes the next one.', blocked: 'Nothing blocked on you.', waiting: 'No PR waits for your review.',
  processing: 'No Autopilot PR is stuck.', pending: 'No PR of yours waits for Autopilot.', paused: 'No paused PR.',
};
/** Glyph plus word, never color alone. @req FR:pr-page/group.bucket */
export const BUCKET: Record<Bucket, string> = { approve: '👍 Approve', review: '👀 Review', decide: '🧭 Decide', unblock: '⛔ Unblock' };
export const CI: Record<PrRow['ci'], string> = { passing: '✓ CI', failing: '✕ CI', pending: '◷ CI', none: '– CI' };
export const PROJECT_LABEL: Record<string, string> = { allyte: 'Allyte', ftk: 'FTK', focus: 'FOCUS', f4: 'F4', xerilium: 'Xerilium', other: 'Other' };
export const PROJECT_ORDER = ['allyte', 'ftk', 'focus', 'f4', 'xerilium', 'other'];
export const AI_PREFIX = '🤖 [AI] ';

/** Tabs in order; the Escalation set only when present. @req FR:pr-page/flyout.tabs */
export function tabsOf(b: PrBoard | null): Tab[] {
  const groups: Tab[] = ['blocked', 'waiting', 'processing', 'pending', 'paused'];
  return b?.escalations ? ['escalations', ...groups] : groups;
}
const inProjects = (p: string, sel: string[]) => sel.length === 0 || sel.includes(p);
const escAll = (b: PrBoard | null): EscEntry[] => (b?.escalations ? [...b.escalations.blocked, ...b.escalations.enable, ...b.escalations.live] : []);
/** Projects present on the board or the Escalation set, in project order. */
export const projectsOf = (b: PrBoard | null): string[] => PROJECT_ORDER.filter((p) => b?.rows.some((r) => r.project === p) || escAll(b).some((e) => (e.project ?? 'other') === p));
/** Escalation entries under the project filter. @req FR:pr-page/flyout.filter */
export const escIn = (list: EscEntry[], sel: string[]) => list.filter((e) => inProjects(e.project ?? 'other', sel));

/** Rows of one tab under the project filter; Processing hides healthy rows unless asked. @req FR:pr-page/flyout.filter @req FR:pr-page/group.healthy */
export function rowsOf(b: PrBoard | null, tab: Tab, sel: string[], showHealthy = false): PrRow[] {
  if (!b || tab === 'escalations') return [];
  return b.rows.filter((r) => r.group === tab && inProjects(r.project, sel) && (tab !== 'processing' || showHealthy || !r.healthy));
}
/** Counts that follow the filter. Processing counts what it shows by default (stuck rows). */
export function countOf(b: PrBoard | null, tab: Tab, sel: string[]): number {
  if (!b) return 0;
  if (tab === 'escalations') return escIn(escAll(b), sel).length;
  return rowsOf(b, tab, sel).length;
}
export const healthyCount = (b: PrBoard | null, sel: string[]) => (b ? b.rows.filter((r) => r.group === 'processing' && r.healthy && inProjects(r.project, sel)).length : 0);

/** `3d`, `5h`, `12m`. */
export function ageText(iso: string, now: Date): string {
  const ms = now.getTime() - Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const m = Math.max(0, Math.floor(ms / 60_000));
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
}
/** `Updated 12 s ago`, or `Paused until 2:15` while the host backs off. @req FR:pr-page/live.age */
export function updatedText(b: PrBoard | null, now: Date): string {
  if (!b) return '';
  if (b.rate && Date.parse(b.rate.until) > now.getTime()) return `Paused until ${new Date(b.rate.until).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  if (!b.at) return b.error ?? 'Not loaded yet';
  const s = Math.max(0, Math.round((now.getTime() - Date.parse(b.at)) / 1000));
  return `Updated ${s < 60 ? `${s} s` : s < 3600 ? `${Math.floor(s / 60)} min` : `${Math.floor(s / 3600)} h`} ago`;
}
/** The owner chip: you (accent), a reviewer login (outline), CI, runner. @req FR:pr-page/state.view */
export function ownerOf(r: PrRow): { text: string; kind: 'me' | 'reviewer' | 'ci' | 'runner' } | null {
  const s = r.state;
  if (s.owner === 'me') return { text: 'You', kind: 'me' };
  if (s.owner === 'reviewer') return { text: s.login ?? 'Reviewer', kind: 'reviewer' };
  if (s.owner === 'ci') return { text: 'CI', kind: 'ci' };
  if (s.owner === 'runner') return { text: 'Runner', kind: 'runner' };
  return null;
}
/** Cut to `n` characters at a word. */
export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).replace(/\s+\S*$/, '')}…` : s);
/** Labels worth a chip: up to 3, without the Status prefix. */
export const shortLabels = (labels: string[]) => labels.slice(0, 3).map((l) => l.replace(/^Status:\s*/i, ''));
/** The exact text a GitHub reply carries. @req FR:pr-page/act.accept */
export const replyText = (answer: string) => `${AI_PREFIX}${answer.trim()}`;
export const refOf = (x: { repo: string; number: number }) => `${x.repo}#${x.number}`;
/** The escalation entry for a row, by url. */
export const escFor = (b: PrBoard | null, url: string): EscEntry | undefined => (b?.escalations ? [...b.escalations.blocked].find((e) => e.url.toLowerCase() === url.toLowerCase()) : undefined);
/** A review comment id from a thread link (`#discussion_r123`), for a threaded reply. */
export const replyToOf = (link?: string): number | undefined => { const m = /#discussion_r(\d+)$/.exec(link ?? ''); return m ? Number(m[1]) : undefined; };
/** The thread an answer is for (`stack pr-pri ack --thread`): the blocker's thread, else the PR. */
export const threadOf = (x: { url: string; link?: string }) => x.link ?? x.url;

// ---- prefs (per viewer; storage may be missing)
const PREFS = 'stack.prs.v1';
export interface Prefs { tab: Tab; projects: string[] }
export function loadPrefs(s: Pick<Storage, 'getItem'> | null): Prefs {
  try {
    const v = JSON.parse(s?.getItem(PREFS) ?? 'null') as Partial<Prefs> | null;
    return { tab: v?.tab && v.tab in TAB_LABEL ? v.tab : 'blocked', projects: Array.isArray(v?.projects) ? v!.projects.filter((p) => typeof p === 'string') : [] };
  } catch { return { tab: 'blocked', projects: [] }; }
}
export function savePrefs(s: Pick<Storage, 'setItem'> | null, p: Prefs): void { try { s?.setItem(PREFS, JSON.stringify(p)); } catch { /* private mode */ } }

// ---- the shared board store: one fetch for every icon and the flyout
export type Phase = 'loading' | 'ready' | 'off' | 'error';
interface StoreState { board: PrBoard | null; phase: Phase; open: boolean }
export interface PrStore {
  get(): StoreState; subscribe(fn: () => void): () => void; reload(): Promise<void>; setOpen(v: boolean): void;
}
/** Loads on first subscribe; reloads on `prs`/`poll`/reconnect, on show, and each minute while visible (that renews the host lease). @req FR:pr-page/live.event */
export function createPrStore(load: () => Promise<PrBoard>, o: { visible?: () => boolean; every?: number; listen?: typeof onLiveChange; status?: (e: unknown) => number; /** The host says it has a board; false means off with no request (no 404 in the console). */ enabled?: () => Promise<boolean> } = {}): PrStore {
  let st: StoreState = { board: null, phase: 'loading', open: false };
  const subs = new Set<() => void>();
  const set = (p: Partial<StoreState>) => { st = { ...st, ...p }; subs.forEach((f) => f()); };
  const visible = o.visible ?? (() => typeof document === 'undefined' || document.visibilityState === 'visible');
  let busy = false;
  let stop: (() => void) | null = null;
  const reload = async () => {
    if (gate && !(await gate)) return;
    // Check after the gate: two reloads that wait on it together must not both load.
    if (busy || st.phase === 'off') return;
    busy = true;
    try { const b = await load(); if ((b as { off?: boolean }).off) set({ phase: 'off' }); else set({ board: b, phase: 'ready' }); } catch (e) {
      const status = o.status?.(e) ?? (e as { status?: number })?.status;
      set({ phase: status === 404 ? 'off' : st.board ? 'ready' : 'error' });
    } finally { busy = false; }
  };
  let gate: Promise<boolean> | null = null;
  const start = () => {
    gate ??= o.enabled ? o.enabled().catch(() => false) : Promise.resolve(true);
    void gate.then((on) => { if (on) void reload(); else set({ phase: 'off' }); });
    const off = (o.listen ?? onLiveChange)((kinds) => { if (kinds.some((k) => k === 'prs' || k === 'pr-priority' || k === 'poll') || ['asks', 'tasks', 'state'].every((k) => kinds.includes(k))) void reload(); });
    const t = setInterval(() => { if (visible()) void reload(); }, o.every ?? 60_000);
    const vis = () => { if (visible()) void reload(); };
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', vis);
    stop = () => { off(); clearInterval(t); if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', vis); };
  };
  return {
    get: () => st,
    subscribe(fn) { subs.add(fn); if (subs.size === 1 && !stop) start(); return () => { subs.delete(fn); if (subs.size === 0) { stop?.(); stop = null; } }; },
    reload,
    setOpen: (v) => set({ open: v }),
  };
}
