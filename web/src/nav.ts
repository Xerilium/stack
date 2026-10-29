/**
 * The one nav: which views go where, their words, and their chords.
 * @req FR:web-shell/nav.views @req FR:web-shell/nav.rail @req FR:web-shell/nav.tabbar @req FR:web-shell/nav.keys
 */
import type { View } from './types';

export const LABEL: Record<View, string> = { home: 'Home', today: 'My day', asks: 'Needs you', projects: 'Projects', list: 'Full stack' };
/** The chord shown next to each view (the first letter after `g`). */
export const HINT: Record<View, string> = { home: 'g h', today: 'g d', asks: 'g k', projects: 'g p', list: 'g a' };
export const CHORDS: Record<string, View> = { h: 'home', d: 'today', t: 'today', k: 'asks', p: 'projects', a: 'list' };
/** Desktop rail, top to bottom. */
export const RAIL: View[] = ['home', 'today', 'asks', 'projects', 'list'];
/** Phone tab bar, left to right: five equal slots with the new-task circle in the middle. */
export type TabSlot = View | 'new' | 'more';
export const TABBAR: TabSlot[] = ['home', 'today', 'new', 'asks', 'more'];
