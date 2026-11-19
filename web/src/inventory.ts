/**
 * The Claude app session inventory on the page: groups, row text, safe links.
 * The inventory itself is `FR:session-inventory/*`; the server ranks projects; the page keeps that order and puts the oldest wait first in each.
 * @req FR:pris-sessions-ui/sessions.list @req FR:pris-sessions-ui/sessions.row @req FR:pris-sessions-ui/sessions.line @req FR:pris-sessions-ui/sessions.name @req FR:pris-sessions-ui/sessions.link @req FR:pris-sessions-ui/sessions.reason
 */
import { parseInline, type Node } from './markdown';
import type { ChipTone } from './ui/StatusChip';

export type SessionState = 'running' | 'waiting' | 'stuck' | 'done' | 'pinned' | 'idle';
export type SessionReason = 'question' | 'permission' | 'needs-user' | 'blocked' | 'error' | 'cut-short' | 'api-error' | 'dead-turn' | 'pr-merged' | 'superseded' | 'turn-open' | 'idle';
export type SessionProject = 'allyte' | 'ftk' | 'focus' | 'f4' | 'xerilium' | 'other';
export interface SessionItem {
  id: string; title: string; project: SessionProject; state: SessionState; reason: SessionReason; pinned: boolean;
  lastActivityAt: string; link: string; prs: { url: string; state: string }[]; ask?: string; scheduled?: { id: string; name: string };
}
export interface Inventory { at: string; total: number; counts: Partial<Record<SessionState, number>>; needsYou: SessionItem[]; archive: SessionItem[]; sessions: SessionItem[] }

export const PROJECT_LABEL: Record<SessionProject, string> = { allyte: 'Allyte', ftk: 'FTK', focus: 'FOCUS', f4: 'F4', xerilium: 'Xerilium', other: 'Other' };
const sentence = (id: string): string => { const s = id.replace(/[-_]+/g, ' ').trim(); return s.charAt(0).toUpperCase() + s.slice(1); };
/** The state chip: a sentence-case word; only stuck uses the warn tone. @req FR:pris-sessions-ui/sessions.row @req FR:pris-sessions-ui/pris.status */
export const stateChip = (state: SessionState): { word: string; tone: ChipTone } => ({ word: sentence(state), tone: state === 'stuck' ? 'warn' : 'neutral' });
const REASON: Partial<Record<SessionReason, string>> = {
  question: 'Asked a question', permission: 'Waiting for permission', 'needs-user': 'Needs you', blocked: 'Blocked', error: 'Error',
  'cut-short': 'Cut short', 'api-error': 'API error', 'dead-turn': 'No activity for 30 min', 'pr-merged': 'PR merged', superseded: 'Newer run exists',
};

/** @req FR:pris-sessions-ui/sessions.reason */
export const reasonText = (r: SessionReason): string => REASON[r] ?? r;
/** The ask when the app has one, else the reason. @req FR:pris-sessions-ui/sessions.line */
export const rowLine = (s: SessionItem): string => s.ask || reasonText(s.reason);

const textOf = (n: Node): string => (typeof n === 'string' ? n : typeof n.c === 'string' ? n.c : n.c.map(textOf).join(''));
/** The row line as plain text (markdown marks dropped), for the accessible name. @req FR:pris-sessions-ui/sessions.name */
export const rowText = (s: SessionItem): string => parseInline(rowLine(s)).map(textOf).join('');

/** One heading per project, in the order the server ranked them; inside a project the oldest wait first. @req FR:pris-sessions-ui/sessions.list */
export function groupNeeds(items: SessionItem[]): { project: SessionProject; label: string; items: SessionItem[] }[] {
  const out = new Map<SessionProject, SessionItem[]>();
  for (const s of items) out.set(s.project, [...(out.get(s.project) ?? []), s]);
  // An unknown time sorts last; the sort is stable, so ties keep server order.
  const t = (s: SessionItem) => { const v = Date.parse(s.lastActivityAt); return Number.isFinite(v) ? v : Infinity; };
  return [...out].map(([project, list]) => ({ project, label: PROJECT_LABEL[project] ?? project, items: [...list].sort((a, b) => t(a) - t(b)) }));
}

/** Short time since `iso`: `now`, `5m`, `3h`, `2d`; empty when unknown. */
export function ago(iso: string, now: Date): string {
  const ms = now.getTime() - Date.parse(iso);
  if (!Number.isFinite(ms)) return '';
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
}

/** Title, state, reason, then time. @req FR:pris-sessions-ui/sessions.name */
export function sessionLabel(s: SessionItem, now: Date): string {
  const t = ago(s.lastActivityAt, now);
  return [s.title, stateChip(s.state).word, rowText(s), t && (t === 'now' ? 'just now' : `${t} ago`)].filter(Boolean).join(', ');
}

/** The link only when it is a Claude session link; anything else is shown as text. Same pattern as `isSessionLink` in desktop/src/policy.ts: change both. @req FR:pris-sessions-ui/sessions.link */
export const safeLink = (link: string): string | undefined => (/^claude:\/\/claude\.ai\/epitaxy\/[A-Za-z0-9_-]{1,128}$/.test(link) ? link : undefined);

/** @req FR:pris-sessions-ui/sessions.archive */
export const idsText = (items: SessionItem[]): string => items.map((s) => s.id).join('\n');
