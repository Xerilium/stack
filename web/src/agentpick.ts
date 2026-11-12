/**
 * The Now agent picker: the whole team (recent first, then by name, searchable), and the agent picked for each task, kept in browser storage.
 * The pick never writes the task file and never adds 🪄.
 * @req FR:product-reset/ui.thread @req FR:product-reset/ui.agentchip
 */
import { nameKey, runnable, type TeamAgent } from './team';

type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export const PICK_KEY = 'stack.now.pick';
export const RECENT_KEY = 'stack.now.recent';
const MAX_TASKS = 200;
const MAX_RECENT = 8;

const read = <T,>(s: Store | undefined, key: string, ok: (v: unknown) => v is T, empty: T): T => {
  try { const v = JSON.parse(s?.getItem(key) ?? 'null') as unknown; return ok(v) ? v : empty; } catch { return empty; }
};
const isMap = (v: unknown): v is Record<string, string> => !!v && typeof v === 'object' && !Array.isArray(v);
const isList = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** The key a pick is kept under: project and title without marks, so it follows the row when lines move or 🪄 is added. */
export const pickKeyOf = (t: { project: string; text: string }): string => `${t.project}␟${t.text.replace(/[🤖🪄🙋🚧]\uFE0F?/gu, '').replace(/\s+/g, ' ').trim()}`;

/** The agent picked for this task, if any. */
export const loadPick = (s: Store | undefined, ref: string): string | undefined => {
  const v = read(s, PICK_KEY, isMap, {})[ref];
  return typeof v === 'string' ? v : undefined;
};
/** Agents picked lately, newest first. */
export const loadRecent = (s: Store | undefined): string[] => read(s, RECENT_KEY, isList, []);

/** Keeps the pick for the task (newest last, oldest dropped past 200); `undefined` clears it. A pick also moves the agent to the top of the recent list. */
export function savePick(s: Store | undefined, ref: string, slug: string | undefined): void {
  try {
    const map = read(s, PICK_KEY, isMap, {});
    delete map[ref];
    if (slug) map[ref] = slug;
    const keys = Object.keys(map);
    for (const k of keys.slice(0, Math.max(0, keys.length - MAX_TASKS))) delete map[k];
    s?.setItem(PICK_KEY, JSON.stringify(map));
    if (slug) s?.setItem(RECENT_KEY, JSON.stringify([slug, ...loadRecent(s).filter((x) => x !== slug)].slice(0, MAX_RECENT)));
  } catch { /* storage is a convenience */ }
}

/** The runnable team for the picker: recent first (in recent order), then by name; `query` matches name, slug or role words. */
export function pickerList(team: TeamAgent[], o: { recent: string[]; query: string }): TeamAgent[] {
  const q = nameKey(o.query);
  const all = team.filter((a) => runnable(a) && (!q || [a.name, a.slug, a.role ?? ''].some((x) => nameKey(x).includes(q))));
  const top = o.recent.map((slug) => all.find((a) => a.slug === slug)).filter((a): a is TeamAgent => !!a);
  const label = (a: TeamAgent) => nameKey(a.name) || a.slug;
  return [...top, ...all.filter((a) => !top.includes(a)).sort((a, b) => label(a).localeCompare(label(b)))];
}
