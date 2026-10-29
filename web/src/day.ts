import { planStart, type Day } from './plan';

/** Available time today: a per-day budget kept in browser storage. @req FR:web-app/today.capacity */
export const STEP = 30;
const MAX = 16 * 60;
const KEY = 'stack.available';
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

/** Browser storage, or undefined where it is blocked. The only key the app ever stores is `stack.available`. @req FR:web-app/host.nosecrets */
export const store = (): Store | undefined => { try { return window.localStorage; } catch { return undefined; } };

const dateKey = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Whole steps between 0 and 16 h. */
export const clampBudget = (m: number) => Math.max(0, Math.min(MAX, Math.floor(m / STEP) * STEP));

/** Your budget, or the time left in the work day when you have not set one. */
export function budgetOf(now: Date, day: Day, saved: number | null): { minutes: number; isDefault: boolean } {
  return saved === null ? { minutes: Math.max(0, day.end - planStart(now, day)), isDefault: true } : { minutes: saved, isDefault: false };
}

/** The budget saved for today, or null (none, another day, or storage unavailable). */
export function loadBudget(store: Store | undefined, now: Date): number | null {
  try {
    const raw = store?.getItem(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as { date?: string; minutes?: number };
    return v.date === dateKey(now) && typeof v.minutes === 'number' ? clampBudget(v.minutes) : null;
  } catch { return null; }
}

/** Saves for today only; null clears. Never throws. */
export function saveBudget(store: Store | undefined, now: Date, minutes: number | null): void {
  try {
    if (minutes === null) store?.removeItem(KEY);
    else store?.setItem(KEY, JSON.stringify({ date: dateKey(now), minutes: clampBudget(minutes) }));
  } catch { /* storage is a convenience */ }
}
