/** @req FR:ux-consolidation/nav.rail @req FR:ux-consolidation/nav.tabbar @req FR:ux-consolidation/nav.keys @req FR:ux-consolidation/nav.home @req FR:ux-consolidation/nav.brief */
import { describe, expect, it } from 'vitest';
import { CHORDS, LABEL, RAIL, TABBAR } from '../src/nav';

describe('nav model', () => {
  // @req FR:ux-consolidation/nav.rail
  it('rail: Now, My day, Needs you, Inbox, Agents, Projects, Full stack', () => {
    expect(RAIL.map((v) => LABEL[v])).toEqual(['Now', 'My day', 'Needs you', 'Inbox', 'Agents', 'Projects', 'Full stack']);
  });
  // @req FR:ux-consolidation/nav.tabbar
  it('tab bar: Now, My day, the new-task circle, Needs you, More', () => {
    expect(TABBAR).toEqual(['now', 'today', 'new', 'asks', 'more']);
  });
  // @req FR:ux-consolidation/nav.keys @req FR:ux-consolidation/nav.brief
  it('chords: g n, g h, g d (and g t), g k, g i, g s, g p, g a; no g b', () => {
    expect(CHORDS).toEqual({ n: 'now', h: 'home', d: 'today', t: 'today', k: 'asks', i: 'inbox', s: 'sessions', p: 'projects', a: 'list' });
  });
  // @req FR:ux-consolidation/nav.home
  it('Home is named Top asks and is not in the rail or the tab bar', () => {
    expect(LABEL.home).toBe('Top asks');
    expect(RAIL).not.toContain('home');
    expect(TABBAR).not.toContain('home');
  });
});
