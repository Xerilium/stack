/**
 * The one nav: which views go where, their words, and their chords.
 * @req FR:ux-consolidation/nav.rail @req FR:ux-consolidation/nav.tabbar @req FR:ux-consolidation/nav.keys @req FR:ux-consolidation/nav.home
 * @req FR:pr-page/nav.rail @req FR:pr-page/nav.phone @req FR:notifications/nav.rail @req FR:notifications/nav.tabbar @req FR:notifications/sessions.more
 */
import type { View } from './types';

/** @req FR:agent-sessions/web.agents @req FR:ux-consolidation/nav.home @req FR:notifications/list.route @req FR:notifications/pris.route @req FR:notifications/sessions.route */
export const LABEL: Record<View, string> = { now: 'Now', home: 'Top asks', today: 'My day', asks: 'Notifications', prs: 'Pull requests', inbox: 'Inbox', sessions: 'Agents', inventory: 'Sessions', projects: 'Projects', list: 'Full stack', settings: 'Settings' };
/** @req FR:web-shell/nav.keys.hint — the chord shown next to each view (the first letter after `g`). */
export const HINT: Record<View, string> = { now: 'g n', home: 'g h', today: 'g d', asks: 'g k', prs: 'g r', inbox: 'g i', sessions: 'g s', inventory: '', projects: 'g p', list: 'g a', settings: 'g ,' };
export const CHORDS: Record<string, View> = { n: 'now', h: 'home', d: 'today', t: 'today', k: 'asks', r: 'prs', i: 'inbox', s: 'sessions', p: 'projects', a: 'list', ',': 'settings' }; // @req FR:settings/view.entry
/** Desktop rail, top to bottom. Now is the one place; Top asks (Home) is one chord away, not a tab. Notifications (bell, count) follows My day; Sessions is in More (the palette); Priorities is a Settings section. */
export const RAIL: View[] = ['now', 'today', 'asks', 'prs', 'inbox', 'sessions', 'projects', 'list'];
/** Phone tab bar, left to right: five equal slots with the new-task circle in the middle (Pull requests, Agents, and Sessions live behind More). */
export type TabSlot = View | 'new' | 'more';
export const TABBAR: TabSlot[] = ['now', 'today', 'new', 'asks', 'more'];
