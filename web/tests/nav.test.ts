/** @req FR:ux-consolidation/nav.rail @req FR:ux-consolidation/nav.tabbar @req FR:ux-consolidation/nav.keys @req FR:ux-consolidation/nav.home @req FR:ux-consolidation/nav.brief @req FR:pr-page/nav.rail @req FR:pr-page/nav.phone */
import { describe, expect, it } from 'vitest';
import { CHORDS, HINT, LABEL, RAIL, TABBAR } from '../src/nav';

describe('nav model', () => {
  // @req FR:notifications/nav.rail @req FR:ux-consolidation/nav.rail @req FR:pr-page/nav.rail @req FR:notifications/sessions.more
  it('rail: Now, My day, Notifications, Priorities, Pull requests, Inbox, Agents, Projects, Full stack; no Sessions', () => {
    expect(RAIL.map((v) => LABEL[v])).toEqual(['Now', 'My day', 'Notifications', 'Priorities', 'Pull requests', 'Inbox', 'Agents', 'Projects', 'Full stack']);
    expect(RAIL).not.toContain('inventory');
  });
  // @req FR:notifications/nav.tabbar @req FR:ux-consolidation/nav.tabbar @req FR:pr-page/nav.phone: five slots kept; the rest is in More.
  it('tab bar: Now, My day, the new-task circle, Notifications, More', () => {
    expect(TABBAR).toEqual(['now', 'today', 'new', 'asks', 'more']);
  });
  // @req FR:notifications/list.route @req FR:notifications/pris.route @req FR:notifications/sessions.route
  it('names: Notifications, Priorities, Sessions', () => {
    expect(LABEL.asks).toBe('Notifications');
    expect(LABEL.priorities).toBe('Priorities');
    expect(LABEL.inventory).toBe('Sessions');
  });
  // @req FR:ux-consolidation/nav.keys @req FR:ux-consolidation/nav.brief
  it('chords: g n, g h, g d (and g t), g k, g r, g i, g s, g p, g a, g ,; no g b', () => {
    expect(CHORDS).toEqual({ n: 'now', h: 'home', d: 'today', t: 'today', k: 'asks', r: 'prs', i: 'inbox', s: 'sessions', p: 'projects', a: 'list', ',': 'settings' });
    expect(HINT.prs).toBe('g r');
  });
  // @req FR:ux-consolidation/nav.home
  it('Home is named Top asks and is not in the rail or the tab bar', () => {
    expect(LABEL.home).toBe('Top asks');
    expect(RAIL).not.toContain('home');
    expect(TABBAR).not.toContain('home');
  });
});
