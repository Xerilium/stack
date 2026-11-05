/** @req FR:web-shell/nav.rail @req FR:web-shell/nav.tabbar @req FR:web-shell/nav.keys */
import { describe, expect, it } from 'vitest';
import { CHORDS, LABEL, RAIL, TABBAR } from '../src/nav';

describe('nav model', () => {
  // @req FR:web-shell/nav.rail
  it('rail: Now, Home, Brief, My day, Needs you, Inbox, Agents, Projects, Full stack', () => {
    expect(RAIL.map((v) => LABEL[v])).toEqual(['Now', 'Home', 'Brief', 'My day', 'Needs you', 'Inbox', 'Agents', 'Projects', 'Full stack']);
  });
  // @req FR:web-shell/nav.tabbar
  it('tab bar: five slots, the new-task circle in the middle, Projects and Full stack behind More', () => {
    expect(TABBAR).toEqual(['home', 'today', 'new', 'asks', 'more']);
  });
  // @req FR:web-shell/nav.keys
  it('chords: g n, g h, g d (and g t), g k, g p, g a', () => {
    expect(CHORDS).toEqual({ n: 'now', h: 'home', b: 'brief', d: 'today', t: 'today', k: 'asks', i: 'inbox', s: 'sessions', p: 'projects', a: 'list' });
  });
});
