/**
 * The live validation checklist: types, labels, and the small API client for `/live`.
 * @req FR:pr-review-lane/panel.chip @req FR:pr-review-lane/panel.check
 */
export type LaneState = 'idle' | 'preparing' | 'working' | 'ready-for-michael' | 'revalidating';
export type ItemState = 'open' | 'passed' | 'failed' | 'needs-fix' | 'fixed-pending-revalidation' | 'blocked';
export interface LiveItem { id: string; text: string; by: string; state: ItemState; comment?: string; reason?: string; createdAt: string; updatedAt: string; updatedBy?: string }
export interface ActivePr { repo: string; number: number; url: string; title?: string; state: Exclude<LaneState, 'idle'>; by?: string; serverUrl?: string; waitingOnLock?: string }
export interface Lane { state: LaneState; rev: number; active?: ActivePr; items: LiveItem[]; done: { url: string }[] }
export type ItemOp = 'add' | 'check' | 'uncheck' | 'fail' | 'needs-fix' | 'fixed' | 'block' | 'comment' | 'edit';

/** The state chip words. @req FR:pr-review-lane/panel.chip */
export const CHIP: Record<LaneState, string> = { idle: 'Idle', preparing: 'Preparing', working: 'Agent working', 'ready-for-michael': 'Ready for you', revalidating: 'Recheck' };
/** Item state as words. */
export const ITEM_WORD: Record<ItemState, string> = { open: 'Open', passed: 'Passed', failed: 'Failed', 'needs-fix': 'Needs fix', 'fixed-pending-revalidation': 'Fixed, recheck', blocked: 'Blocked' };

/** A tap on the check toggles passed and open. @req FR:pr-review-lane/panel.check */
export const toggleOp = (i: Pick<LiveItem, 'state'>): ItemOp => (i.state === 'passed' ? 'uncheck' : 'check');

/** An older reload (lower rev) never replaces a newer lane. @req FR:pr-review-lane/panel.refresh */
export const newerLane = (prev: Lane | null, next: Lane): Lane => (prev && next.rev < prev.rev ? prev : next);

/** Who added an item, for the row. */
export const byWord = (by: string): string => (by === 'owner' ? 'you' : by);

export function liveClient(fetchFn: typeof fetch = (...a) => fetch(...a), base = '/api') {
  async function call<T>(path: string, body?: unknown): Promise<T> {
    const res = await fetchFn(`${base}${path}`, body === undefined ? { credentials: 'same-origin' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), credentials: 'same-origin' });
    const t = await res.text();
    const j = t ? JSON.parse(t) : undefined;
    if (!res.ok) throw new Error((j as { error?: { message?: string } } | undefined)?.error?.message ?? `HTTP ${res.status}`);
    return j as T;
  }
  return {
    lane: () => call<Lane>('/live'),
    item: (pr: { repo: string; number: number }, op: ItemOp, o: { id?: string; text?: string } = {}) => call<{ changed: boolean; item: LiveItem }>('/live/items', { op, repo: pr.repo, number: pr.number, ...o }),
  };
}
