/** @req FR:agent-sessions/web.pins @req FR:agent-sessions/web.groups */
import { describe, expect, it } from 'vitest';
import { groupByProject, loadGroup, loadPins, orderWithPins, saveGroup, togglePin } from '../src/pins';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }; };
const S = (id: string, project: string) => ({ id, project });

describe('pins', () => {
  it('toggle pins in order and persists only stack.pins', () => {
    const s = mem();
    expect(loadPins(s)).toEqual([]);
    expect(togglePin(s, 'b')).toEqual(['b']);
    expect(togglePin(s, 'a')).toEqual(['b', 'a']);
    expect(togglePin(s, 'b')).toEqual(['a']);
    expect([...s.m.keys()]).toEqual(['stack.pins']);
    expect(loadPins(undefined)).toEqual([]);
  });
  it('pinned rows come first in pin order, the rest keep their order', () => {
    const items = [S('x', 'alpha'), S('a', 'beta'), S('b', 'alpha'), S('c', 'gamma')];
    expect(orderWithPins(items, ['b', 'a']).map((i) => i.id)).toEqual(['b', 'a', 'x', 'c']);
    expect(orderWithPins(items, ['nope']).map((i) => i.id)).toEqual(['x', 'a', 'b', 'c']);
  });
  it('groups by project in first-seen order; pinned rows form their own group first', () => {
    const items = [S('x', 'alpha'), S('a', 'beta'), S('b', 'alpha'), S('c', 'gamma')];
    expect(groupByProject(items, ['a']).map((g) => [g.title, g.items.map((i) => i.id)])).toEqual([['Pinned', ['a']], ['alpha', ['x', 'b']], ['gamma', ['c']]]);
    expect(groupByProject(items, []).map((g) => g.title)).toEqual(['alpha', 'beta', 'gamma']);
  });
  it('remembers the grouping choice', () => {
    const s = mem();
    expect(loadGroup(s)).toBe(false);
    saveGroup(s, true);
    expect(loadGroup(s)).toBe(true);
    expect([...s.m.keys()]).toEqual(['stack.agents.group']);
  });
});
