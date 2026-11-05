/**
 * Push selection and delivery. The sender is injected, so this file has no network code.
 * @req FR:iphone-access/notify.@function
 */
import type { Ask } from '../core/asks';
import type { DeviceService, PushSubscriptionRecord } from './auth/devices';

const HOUR = 3_600_000;
const TITLE_MAX = 120;

/** Delivers one payload; resolves with the push service's HTTP status. A real adapter signs with the VAPID private key. */
export interface PushSender { send(sub: PushSubscriptionRecord, payload: string): Promise<{ status: number }> }
export interface PushCounts { sent: number; removed: number; failed: number }

/** Open, unsnoozed asks whose deadline is ahead and within the window, earliest first. @req FR:iphone-access/notify.select */
export function dueWithin(asks: Ask[], now: Date, ms = HOUR): Ask[] {
  const t = now.getTime();
  const due = (a: Ask) => {
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
function payloadFor(due: Ask[]): string {
  if (due.length === 1) return JSON.stringify({ key: due[0].key, title: clean(due[0].ask) });
  return JSON.stringify({ key: due[0].key, title: `${due.length} asks due within 1h` });
}

export function createPushNotifier(opts: { devices: DeviceService; sender: PushSender; now?: () => Date; onEvent?: (c: PushCounts) => void }) {
  return {
    /** @req FR:iphone-access/notify.send @req FR:iphone-access/notify.prune @req FR:iphone-access/notify.isolate @req FR:iphone-access/notify.none @req FR:iphone-access/notify.events */
    async notify(asks: Ask[]): Promise<PushCounts> {
      const counts: PushCounts = { sent: 0, removed: 0, failed: 0 };
      const due = dueWithin(asks, (opts.now ?? (() => new Date()))());
      if (due.length === 0) return counts;
      const subs = await opts.devices.subscriptions();
      if (subs.length === 0) return counts;
      const payload = payloadFor(due);
      for (const { deviceId, sub } of subs) {
        try {
          const { status } = await opts.sender.send(sub, payload);
          if (status === 404 || status === 410) { await opts.devices.removePush(deviceId, sub.endpoint); counts.removed++; }
          else if (status >= 200 && status < 300) counts.sent++;
          else counts.failed++;
        } catch {
          counts.failed++;
        }
      }
      try { opts.onEvent?.({ ...counts }); } catch { /* a broken logger never changes delivery */ }
      return counts;
    },
  };
}
