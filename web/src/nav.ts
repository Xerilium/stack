/**
 * The one nav: which views go where, their words, and their chords.
 * @req FR:ux-consolidation/nav.rail @req FR:ux-consolidation/nav.tabbar @req FR:ux-consolidation/nav.keys @req FR:ux-consolidation/nav.home
 */
import type { View } from './types';

/** @req FR:agent-sessions/web.agents @req FR:ux-consolidation/nav.home */
export const LABEL: Record<View, string> = { now: 'Now', home: 'Top asks', today: 'My day', asks: 'Needs you', inbox: 'Inbox', sessions: 'Agents', projects: 'Projects', list: 'Full stack', settings: 'Settings' };
/** @req FR:web-shell/nav.keys.hint — the chord shown next to each view (the first letter after `g`). */
export const HINT: Record<View, string> = { now: 'g n', home: 'g h', today: 'g d', asks: 'g k', inbox: 'g i', sessions: 'g s', projects: 'g p', list: 'g a', settings: 'g ,' };
export const CHORDS: Record<string, View> = { n: 'now', h: 'home', d: 'today', t: 'today', k: 'asks', i: 'inbox', s: 'sessions', p: 'projects', a: 'list', ',': 'settings' }; // @req FR:settings/view.entry
/** Desktop rail, top to bottom. Now is the one place; Top asks (Home) is one chord away, not a tab. */
export const RAIL: View[] = ['now', 'today', 'asks', 'inbox', 'sessions', 'projects', 'list'];
/** Phone tab bar, left to right: five equal slots with the new-task circle in the middle (Agents lives behind More). */
export type TabSlot = View | 'new' | 'more';
export const TABBAR: TabSlot[] = ['now', 'today', 'new', 'asks', 'more'];
