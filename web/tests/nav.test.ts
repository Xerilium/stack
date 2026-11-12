/** @req FR:ux-consolidation/nav.rail @req FR:ux-consolidation/nav.tabbar @req FR:ux-consolidation/nav.keys @req FR:ux-consolidation/nav.home @req FR:ux-consolidation/nav.brief */
import { describe, expect, it } from 'vitest';
import { CHORDS, LABEL, MORE_PHONE, MORE_RAIL, RAIL, TABBAR, tip } from '../src/nav';

describe('nav model', () => {
  // @req FR:notifications/nav.rail
  it('rail: Now, My day, Priorities, Inbox, Agents, Projects, Full stack; More holds Sessions', () => {
    expect(RAIL.map((v) => LABEL[v])).toEqual(['Now', 'My day', 'Priorities', 'Inbox', 'Agents', 'Projects', 'Full stack']);
    expect(MORE_RAIL).toEqual(['inventory']);
    expect(RAIL).not.toContain('asks');
    expect(RAIL).not.toContain('inventory');
  });
  // @req FR:notifications/nav.tabbar
  it('tab bar: Now, My day, the new-task circle, Priorities, More; More holds the rest and Sessions', () => {
    expect(TABBAR).toEqual(['now', 'today', 'new', 'priorities', 'more']);
    expect(MORE_PHONE).toEqual(['inbox', 'sessions', 'projects', 'list', 'inventory']);
  });
  // @req FR:notifications/list.route @req FR:notifications/pris.route
  it('names: Notifications, Priorities, Sessions', () => {
    expect(LABEL.asks).toBe('Notifications');
    expect(LABEL.priorities).toBe('Priorities');
    expect(LABEL.inventory).toBe('Sessions');
  });
  // @req FR:ux-consolidation/nav.keys @req FR:ux-consolidation/nav.brief
  it('chords: g n, g h, g d (and g t), g o, g k, g i, g s, g p, g a; no g b', () => {
    expect(CHORDS).toEqual({ n: 'now', h: 'home', d: 'today', t: 'today', o: 'priorities', k: 'asks', i: 'inbox', s: 'sessions', p: 'projects', a: 'list' });
  });
  // @req FR:ux-consolidation/nav.home
  it('Home is named Top asks and is not in the rail or the tab bar', () => {
    expect(LABEL.home).toBe('Top asks');
    expect(RAIL).not.toContain('home');
    expect(TABBAR).not.toContain('home');
  });
  // @req FR:notifications/keys.tip
  it('a key shows only in the tooltip, as Done (D)', () => {
    expect(tip('Done', 'd')).toBe('Done (D)');
    expect(tip('Now', 'g n')).toBe('Now (G N)');
    expect(tip('Send', '⏎')).toBe('Send (⏎)');
  });
});
