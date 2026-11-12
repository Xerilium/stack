/**
 * The one nav: which views go where, their words, and their chords.
 * @req FR:ux-consolidation/nav.rail @req FR:ux-consolidation/nav.tabbar @req FR:ux-consolidation/nav.keys @req FR:ux-consolidation/nav.home
 * @req FR:notifications/nav.rail @req FR:notifications/nav.tabbar @req FR:notifications/sessions.more
 */
import type { View } from './types';

/** @req FR:agent-sessions/web.agents @req FR:ux-consolidation/nav.home @req FR:notifications/list.route */
export const LABEL: Record<View, string> = { now: 'Now', home: 'Top asks', today: 'My day', priorities: 'Priorities', asks: 'Notifications', inbox: 'Inbox', sessions: 'Agents', inventory: 'Sessions', projects: 'Projects', list: 'Full stack' };
/** The chord for each view (the first letter after `g`), for tooltips, help, and the palette. */
export const HINT: Record<View, string> = { now: 'g n', home: 'g h', today: 'g d', priorities: 'g o', asks: 'g k', inbox: 'g i', sessions: 'g s', inventory: '', projects: 'g p', list: 'g a' };
export const CHORDS: Record<string, View> = { n: 'now', h: 'home', d: 'today', t: 'today', o: 'priorities', k: 'asks', i: 'inbox', s: 'sessions', p: 'projects', a: 'list' };
/** Desktop rail, top to bottom. Notifications is the bell at the top; Top asks (Home) is one chord away, not a tab. */
export const RAIL: View[] = ['now', 'today', 'priorities', 'inbox', 'sessions', 'projects', 'list'];
/** The rail's More menu (before Commands). */
export const MORE_RAIL: View[] = ['inventory'];
/** Phone tab bar, left to right: five equal slots with the new-task circle in the middle. */
export type TabSlot = View | 'new' | 'more';
export const TABBAR: TabSlot[] = ['now', 'today', 'new', 'priorities', 'more'];
/** The phone More menu (before Commands): the rail views that have no tab, then Sessions. */
export const MORE_PHONE: View[] = ['inbox', 'sessions', 'projects', 'list', 'inventory'];

/** A control's tooltip with its key: `Done (D)`. Keys never render as badges. @req FR:notifications/keys.tip */
export function tip(label: string, key?: string): string {
  if (!key) return label;
  return `${label} (${key.length === 1 || /^[a-z ]+$/.test(key) ? key.toUpperCase() : key})`;
}
