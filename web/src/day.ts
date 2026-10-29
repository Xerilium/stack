import { closedTo, planStart, type Day } from './plan';
import { busyWithin, mergeSpans, type Busy } from './meetings';

/** Available time today: a per-day budget kept in browser storage. @req FR:web-app/today.capacity */
export const STEP = 30;
const MAX = 16 * 60;
const KEY = 'stack.available';
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Browser storage, or undefined where it is blocked. The only key the app ever stores is `stack.available`. @req FR:web-app/host.nosecrets */
export const store = (): Store | undefined => { try { return window.localStorage; } catch { return undefined; } };

export const dateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Whole minutes between 0 and 16 h. Steps add or remove STEP from the current value, so an odd default still moves by 30. */
export const clampBudget = (m: number) => Math.max(0, Math.min(MAX, Math.round(m)));

/** Your budget, or the focus time left: the day left minus meetings and personal blocks (overlaps once). @req FR:web-app/today.meetings @req FR:home/day.available */
export function budgetOf(now: Date, day: Day, saved: number | null, busy: Busy[] = []): { minutes: number; isDefault: boolean } {
  const start = planStart(now, day);
  const off = mergeSpans([...busy, ...closedTo(day).map(([s, e]) => ({ start: s, end: e }))]);
  return saved === null ? { minutes: Math.max(0, day.end - start - busyWithin(off, start, day.end)), isDefault: true } : { minutes: saved, isDefault: false };
}

/** The budget saved for today, or null (none, another day, or storage unavailable). */
export function loadBudget(store: Store | undefined, now: Date, key = dateKey(now)): number | null {
  const v = loadSaved(store);
  return v && v.date === key ? v.minutes : null;
}

/** Whatever budget is saved, with the day it was set for; the caller checks the day. @req FR:home/day.available */
export function loadSaved(store: Store | undefined): { date: string; minutes: number } | null {
  try {
    const raw = store?.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { date?: string; minutes?: number };
    return typeof v.date === 'string' && typeof v.minutes === 'number' ? { date: v.date, minutes: clampBudget(v.minutes) } : null;
  } catch { return null; }
}

/** Saves for today (or the waking day `key`) only; null clears. Never throws. */
export function saveBudget(store: Store | undefined, now: Date, minutes: number | null, key = dateKey(now)): void {
  try {
    if (minutes === null) store?.removeItem(KEY);
    else store?.setItem(KEY, JSON.stringify({ date: key, minutes: clampBudget(minutes) }));
  } catch { /* storage is a convenience */ }
}
