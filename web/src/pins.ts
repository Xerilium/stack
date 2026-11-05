/**
 * Pinned agents and the by-project grouping of the Agents view, kept in browser storage.
 * @req FR:agent-sessions/web.pins @req FR:agent-sessions/web.groups
 */
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const PINS_KEY = 'stack.pins';
export const GROUP_KEY = 'stack.agents.group';

export function loadPins(s: Store | undefined): string[] {
  try { const v = JSON.parse(s?.getItem(PINS_KEY) ?? '[]') as unknown; return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []; } catch { return []; }
}
/** Pins or unpins one id; returns the new order (pinned in the order they were pinned). */
export function togglePin(s: Store | undefined, id: string): string[] {
  const cur = loadPins(s);
  const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
  try { if (next.length) s?.setItem(PINS_KEY, JSON.stringify(next)); else s?.removeItem(PINS_KEY); } catch { /* storage is a convenience */ }
  return next;
}
/** Pinned rows first, in pin order; the rest keep their order. */
export function orderWithPins<T extends { id: string }>(items: T[], pins: string[]): T[] {
  const top = pins.map((id) => items.find((i) => i.id === id)).filter((i): i is T => !!i);
  return [...top, ...items.filter((i) => !pins.includes(i.id))];
}
export interface Group<T> { title: string; items: T[] }
export const OTHER_REPOS = 'Other repos';
/** One group per owning project in priority order (then name), unowned repos last under `Other repos`; pinned rows form a `Pinned` group first. @req FR:agent-sessions/web.groups */
export function groupByProject<T extends { id: string; project: string; owner?: string | null }>(items: T[], pins: string[], rank: Map<string, number> = new Map()): Group<T>[] {
  const pinned = orderWithPins(items, pins).filter((i) => pins.includes(i.id));
  const rest = items.filter((i) => !pins.includes(i.id));
  const groups = new Map<string, T[]>();
  for (const i of rest) { const k = i.owner ?? OTHER_REPOS; groups.set(k, [...(groups.get(k) ?? []), i]); }
  const r = (k: string) => (k === OTHER_REPOS ? Infinity : (rank.get(k) ?? rank.size));
  const titles = [...groups.keys()].sort((a, b) => r(a) - r(b) || a.localeCompare(b));
  return [...(pinned.length ? [{ title: 'Pinned', items: pinned }] : []), ...titles.map((title) => ({ title, items: groups.get(title)! }))];
}
/** `team` (the org tree, the default), `project`, or `` (flat). @req FR:agent-sessions/web.groups */
export type GroupMode = 'team' | 'project' | '';
export const loadGroup = (s: Store | undefined): GroupMode => { try { const v = s?.getItem(GROUP_KEY); return v === 'project' ? 'project' : v === 'flat' ? '' : 'team'; } catch { return 'team'; } };
export function saveGroup(s: Store | undefined, mode: GroupMode): void {
  try { s?.setItem(GROUP_KEY, mode === '' ? 'flat' : mode); } catch { /* storage is a convenience */ }
}

import { useCallback, useState } from 'preact/hooks';
/** Pins and the grouping choice as state, shared by the Agents view and the palette. */
export type Pins = { pins: string[]; pin: (id: string) => void; mode: GroupMode; /** Sets a mode; the active one again returns to the flat list. */ setMode: (m: GroupMode) => void };
export function usePins(s: Store | undefined): Pins {
  const [pins, setPins] = useState(() => loadPins(s));
  const [mode, setModeState] = useState<GroupMode>(() => loadGroup(s));
  const pin = useCallback((id: string) => setPins(togglePin(s, id)), [s]);
  const setMode = useCallback((m: GroupMode) => setModeState((cur) => { const next = cur === m ? '' : m; saveGroup(s, next); return next; }), [s]);
  return { pins, pin, mode, setMode };
}
