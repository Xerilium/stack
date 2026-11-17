/**
 * The one nav: which views go where, their words, and their chords.
 * @req FR:ux-consolidation/nav.rail @req FR:ux-consolidation/nav.tabbar @req FR:ux-consolidation/nav.keys @req FR:ux-consolidation/nav.home
 * @req FR:pr-page/nav.rail @req FR:pr-page/nav.phone
 */
import type { View } from './types';

/** @req FR:agent-sessions/web.agents @req FR:ux-consolidation/nav.home */
export const LABEL: Record<View, string> = { now: 'Now', home: 'Top asks', today: 'My day', asks: 'Needs you', prs: 'Pull requests', inbox: 'Inbox', sessions: 'Agents', projects: 'Projects', list: 'Full stack', settings: 'Settings' };
/** @req FR:web-shell/nav.keys.hint — the chord shown next to each view (the first letter after `g`). */
export const HINT: Record<View, string> = { now: 'g n', home: 'g h', today: 'g d', asks: 'g k', prs: 'g r', inbox: 'g i', sessions: 'g s', projects: 'g p', list: 'g a', settings: 'g ,' };
export const CHORDS: Record<string, View> = { n: 'now', h: 'home', d: 'today', t: 'today', k: 'asks', r: 'prs', i: 'inbox', s: 'sessions', p: 'projects', a: 'list', ',': 'settings' }; // @req FR:settings/view.entry
/** Desktop rail, top to bottom. Now is the one place; Top asks (Home) is one chord away, not a tab. Pull requests sits after Needs you. */
export const RAIL: View[] = ['now', 'today', 'asks', 'prs', 'inbox', 'sessions', 'projects', 'list'];
/** Phone tab bar, left to right: five equal slots with the new-task circle in the middle (Agents and Pull requests live behind More). */
export type TabSlot = View | 'new' | 'more';
export const TABBAR: TabSlot[] = ['now', 'today', 'new', 'asks', 'more'];
