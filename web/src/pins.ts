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
/** One group per project in first-seen order; pinned rows form a `Pinned` group first. */
export function groupByProject<T extends { id: string; project: string }>(items: T[], pins: string[]): Group<T>[] {
  const pinned = orderWithPins(items, pins).filter((i) => pins.includes(i.id));
  const rest = items.filter((i) => !pins.includes(i.id));
  const out: Group<T>[] = pinned.length ? [{ title: 'Pinned', items: pinned }] : [];
  for (const i of rest) {
    const g = out.find((x) => x.title === i.project && x.title !== 'Pinned');
    if (g) g.items.push(i); else out.push({ title: i.project, items: [i] });
  }
  return out;
}
export const loadGroup = (s: Store | undefined): boolean => { try { return s?.getItem(GROUP_KEY) === 'project'; } catch { return false; } };
export function saveGroup(s: Store | undefined, on: boolean): void {
  try { if (on) s?.setItem(GROUP_KEY, 'project'); else s?.removeItem(GROUP_KEY); } catch { /* storage is a convenience */ }
}
