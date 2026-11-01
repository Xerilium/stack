/** @req FR:agent-sessions/web.pins @req FR:agent-sessions/web.groups */
import { describe, expect, it } from 'vitest';
import { groupByProject, loadGroup, loadPins, orderWithPins, saveGroup, togglePin } from '../src/pins';

const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }; };
const S = (id: string, project: string, owner: string | null = project) => ({ id, project, owner });

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
  it('groups by owning project in priority order, unowned repos last under Other repos; pinned rows form their own group first', () => {
    const items = [S('x', 'alpha'), S('a', 'beta'), S('b', 'alpha'), S('c', 'gamma'), S('m', 'maenifold-rs', null)];
    const rank = new Map([['gamma', 0], ['alpha', 1], ['beta', 2]]);
    expect(groupByProject(items, ['a'], rank).map((g) => [g.title, g.items.map((i) => i.id)])).toEqual([['Pinned', ['a']], ['gamma', ['c']], ['alpha', ['x', 'b']], ['Other repos', ['m']]]);
    expect(groupByProject(items, [], rank).map((g) => g.title)).toEqual(['gamma', 'alpha', 'beta', 'Other repos']);
    expect(groupByProject(items, [], new Map()).map((g) => g.title)).toEqual(['alpha', 'beta', 'gamma', 'Other repos']);
  });
  it('remembers the grouping choice: team by default, project, or flat', () => {
    const s = mem();
    expect(loadGroup(s)).toBe('team');
    saveGroup(s, 'project');
    expect(loadGroup(s)).toBe('project');
    saveGroup(s, '');
    expect(loadGroup(s)).toBe('');
    saveGroup(s, 'team');
    expect(loadGroup(s)).toBe('team');
    expect([...s.m.keys()]).toEqual(['stack.agents.group']);
    expect(loadGroup(undefined)).toBe('team');
  });
});
