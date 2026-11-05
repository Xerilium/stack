/**
 * The one nav: which views go where, their words, and their chords.
 * @req FR:web-shell/nav.views @req FR:web-shell/nav.rail @req FR:web-shell/nav.tabbar @req FR:web-shell/nav.keys
 */
import type { View } from './types';

/** @req FR:agent-sessions/web.agents */
export const LABEL: Record<View, string> = { now: 'Now', home: 'Home', brief: 'Brief', today: 'My day', asks: 'Needs you', inbox: 'Inbox', sessions: 'Agents', projects: 'Projects', list: 'Full stack' };
/** @req FR:web-shell/nav.keys.hint — the chord shown next to each view (the first letter after `g`). */
export const HINT: Record<View, string> = { now: 'g n', home: 'g h', brief: 'g b', today: 'g d', asks: 'g k', inbox: 'g i', sessions: 'g s', projects: 'g p', list: 'g a' };
export const CHORDS: Record<string, View> = { n: 'now', h: 'home', b: 'brief', d: 'today', t: 'today', k: 'asks', i: 'inbox', s: 'sessions', p: 'projects', a: 'list' };
/** Desktop rail, top to bottom. */
export const RAIL: View[] = ['now', 'home', 'brief', 'today', 'asks', 'inbox', 'sessions', 'projects', 'list'];
/** Phone tab bar, left to right: five equal slots with the new-task circle in the middle (Agents lives behind More). */
export type TabSlot = View | 'new' | 'more';
export const TABBAR: TabSlot[] = ['home', 'today', 'new', 'asks', 'more'];
/** Views still on trial: tagged `Experimental` in the rail and the palette. @req FR:cos-view/brief.nav */
export const EXPERIMENTAL = new Set<View>(['brief']);
