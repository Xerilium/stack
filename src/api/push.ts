/**
 * Push selection and delivery. The sender is injected, so this file has no network code.
 * @req FR:iphone-access/notify.@function
 */
import type { Ask } from '../core/asks';
import type { DeviceService, PushSubscriptionRecord } from './auth/devices';
import { StoreConflict, type TokenStore } from './auth/tokens';

const HOUR = 3_600_000;
const TITLE_MAX = 120;
const LEDGER_RETRIES = 10;

/** Delivers one payload; resolves with the push service's HTTP status. A real adapter signs with the VAPID private key. */
export interface PushSender { send(sub: PushSubscriptionRecord, payload: string): Promise<{ status: number }> }
export interface PushCounts { sent: number; removed: number; failed: number; skipped: number }
/** The ask fields push reads; listed asks from the api fit. */
export type DueAsk = Pick<Ask, 'key' | 'state' | 'ask' | 'by' | 'snoozed' | 'priority'>;

/** Open, unsnoozed asks whose deadline is ahead and within the window, earliest first. @req FR:iphone-access/notify.select */
export function dueWithin<T extends DueAsk>(asks: T[], now: Date, ms = HOUR): T[] {
  const t = now.getTime();
  const due = (a: T) => {
    if (a.state !== 'open' || !a.by) return false;
    if (a.snoozed && Date.parse(a.snoozed) > t) return false;
    const by = Date.parse(a.by);
    return by > t && by - t <= ms;
  };
  return asks.filter(due).sort((a, b) => Date.parse(a.by as string) - Date.parse(b.by as string) || a.key.localeCompare(b.key));
}

// eslint-disable-next-line no-control-regex
const CTRL = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]', 'g');
const clean = (s: string) => s.replace(CTRL, '').slice(0, TITLE_MAX);

/** @req FR:iphone-access/notify.payload: key and title only. */
function payloadFor(due: DueAsk[]): string {
  if (due.length === 1) return JSON.stringify({ key: due[0].key, title: clean(due[0].ask) });
  return JSON.stringify({ key: due[0].key, title: `${due.length} asks due within 1h` });
}

/** Quiet window in a time zone: hours `[start, end)`, wrapping midnight when `start > end`. */
export interface QuietHours { start: number; end: number; timeZone: string }

/** @req FR:iphone-access/notify.quiet */
export function inQuiet(q: QuietHours, now: Date): boolean {
  const h = Number(new Intl.DateTimeFormat('en-US', { timeZone: q.timeZone, hour: '2-digit', hourCycle: 'h23' }).format(now));
  return q.start <= q.end ? h >= q.start && h < q.end : h >= q.start || h < q.end;
}

/** Ask key -> `by` already pushed, per device. @req FR:iphone-access/notify.dedupe */
export interface PushLedger {
  sent(deviceId: string): Promise<Record<string, string>>;
  mark(deviceId: string, pairs: Record<string, string>): Promise<void>;
}

/** `{ version: 1, sent: { <deviceId>: { <askKey>: <by> } } }` over a version-checked store. @req FR:iphone-access/notify.dedupe.store */
export function createPushLedger(store: TokenStore, now: () => Date = () => new Date()): PushLedger {
  type Sent = Record<string, Record<string, string>>;
  async function load(): Promise<{ sent: Sent; version: string | null }> {
    const f = await store.read();
    if (!f) return { sent: {}, version: null };
    try {
      const v = JSON.parse(f.content) as { version?: unknown; sent?: unknown };
      if (v.version === 1 && typeof v.sent === 'object' && v.sent !== null && !Array.isArray(v.sent)) return { sent: v.sent as Sent, version: f.version };
    } catch { /* a broken ledger starts over: worst case one repeat push */ }
    return { sent: {}, version: f.version };
  }
  return {
    sent: async (id) => ({ ...((await load()).sent[id] ?? {}) }),
    async mark(id, pairs) {
      for (let i = 0; ; i++) {
        const { sent, version } = await load();
        const cut = now().getTime() - HOUR;
        sent[id] = { ...(sent[id] ?? {}), ...pairs };
        for (const dev of Object.keys(sent)) {
          for (const [k, by] of Object.entries(sent[dev])) if (!(Date.parse(by) >= cut)) delete sent[dev][k];
          if (Object.keys(sent[dev]).length === 0) delete sent[dev];
        }
        try { await store.write(JSON.stringify({ version: 1, sent }, null, 2) + '\n', version); return; } catch (e) {
          if (!(e instanceof StoreConflict) || i + 1 >= LEDGER_RETRIES) throw e;
        }
      }
    },
  };
}

export interface PushNotifierOptions {
  devices: DeviceService; sender: PushSender; now?: () => Date; onEvent?: (c: PushCounts) => void;
  /** Only `crit` asks push inside this window. */
  quiet?: QuietHours;
  /** One push per device, ask key and deadline. */
  ledger?: PushLedger;
  /** Longest wait for the check before this one. A hung check never blocks later checks for good. */
  waitMs?: number;
}

export function createPushNotifier(opts: PushNotifierOptions) {
  // @req FR:iphone-access/notify.serial: one check at a time, so two checks never read the same ledger state and both send.
  let tail: Promise<unknown> = Promise.resolve();
  return {
    /** @req FR:iphone-access/notify.send @req FR:iphone-access/notify.prune @req FR:iphone-access/notify.isolate @req FR:iphone-access/notify.none @req FR:iphone-access/notify.events @req FR:iphone-access/notify.quiet @req FR:iphone-access/notify.dedupe @req FR:iphone-access/notify.serial */
    notify(asks: DueAsk[] | Promise<DueAsk[]>): Promise<PushCounts> {
      const list = Promise.resolve(asks);
      list.catch(() => undefined); // handled when its turn comes
      const run = tail.then(async () => notifyOnce(await list));
      // @req FR:iphone-access/notify.serial: the next check waits for this one at most `waitMs`.
      tail = tail.then(() => bounded(run, opts.waitMs));
      return run;
    },
  };

  function bounded(p: Promise<unknown>, ms: number | undefined): Promise<unknown> {
    const settled = p.catch(() => undefined);
    if (ms === undefined) return settled;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const limit = new Promise<void>((ok) => { timer = setTimeout(ok, ms); timer.unref?.(); });
    return Promise.race([settled, limit]).finally(() => clearTimeout(timer));
  }

  async function notifyOnce(asks: DueAsk[]): Promise<PushCounts> {
    const counts: PushCounts = { sent: 0, removed: 0, failed: 0, skipped: 0 };
    const now = (opts.now ?? (() => new Date()))();
    let due = dueWithin(asks, now);
    if (opts.quiet && inQuiet(opts.quiet, now)) due = due.filter((a) => a.priority === 'crit');
    if (due.length === 0) return counts;
    const subs = await opts.devices.subscriptions();
    if (subs.length === 0) return counts;
    for (const { deviceId, sub } of subs) {
      try {
        const seen = opts.ledger ? await opts.ledger.sent(deviceId) : {};
        const fresh = due.filter((a) => seen[a.key] !== a.by);
        if (fresh.length === 0) { counts.skipped++; continue; }
        const { status } = await opts.sender.send(sub, payloadFor(fresh));
        if (status === 404 || status === 410) { await opts.devices.removePush(deviceId, sub.endpoint); counts.removed++; }
        else if (status >= 200 && status < 300) {
          counts.sent++;
          // A lost ledger write costs one repeat push at most; it never fails the delivery.
          await opts.ledger?.mark(deviceId, Object.fromEntries(fresh.map((a) => [a.key, a.by as string]))).catch(() => undefined);
        } else counts.failed++;
      } catch {
        counts.failed++;
      }
    }
    try { opts.onEvent?.({ ...counts }); } catch { /* a broken logger never changes delivery */ }
    return counts;
  }
}
