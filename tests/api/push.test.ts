import { createDeviceService, createTokenService, MemoryTokenStore } from '../../src/api/auth';
import { createPushLedger, createPushNotifier, dueWithin, type PushSender } from '../../src/api/push';
import type { Ask } from '../../src/core/asks';

const NOW = new Date('2026-11-05T18:00:00Z');
const min = (n: number) => new Date(NOW.getTime() + n * 60_000).toISOString();
const ask = (key: string, over: Partial<Ask> = {}): Ask => ({
  key, state: 'open', ask: `Ask ${key}`, kind: 'approve', from: 'a', reversible: false, priority: 'normal', blocks: 0,
  created: min(-100), updated: min(-100), detail: '', thread: [], extra: [], by: min(30), ...over,
});
const SUB = (n: string) => ({ endpoint: `https://web.push.apple.com/${n}`, p256dh: 'BKey', auth: 'sec' });

async function mk(n = 2) {
  const tokens = createTokenService({ store: new MemoryTokenStore(), now: () => NOW });
  const devices = createDeviceService({ store: new MemoryTokenStore(), tokens, now: () => NOW });
  const ids: string[] = [];
  for (let i = 0; i < n; i++) { const d = await devices.create(`p${i}`); ids.push(d.device.id); await devices.setPush(d.device.id, SUB(`e${i}`)); }
  return { devices, ids };
}
const recorder = (status: (endpoint: string) => number | Error = () => 201) => {
  const calls: { endpoint: string; payload: string }[] = [];
  const sender: PushSender = { send: async (sub, payload) => {
    calls.push({ endpoint: sub.endpoint, payload });
    const r = status(sub.endpoint);
    if (r instanceof Error) throw r;
    return { status: r };
  } };
  return { calls, sender };
};

// @req FR:iphone-access/notify.select
describe('dueWithin', () => {
  it('keeps open asks due in the next 60 minutes, earliest first', () => {
    const out = dueWithin([
      ask('late', { by: min(59) }), ask('soon', { by: min(5) }), ask('past', { by: min(-1) }), ask('far', { by: min(61) }),
      ask('none', { by: undefined }), ask('done', { state: 'done' }), ask('snz', { snoozed: min(120) }), ask('edge', { by: min(60) }),
    ], NOW);
    expect(out.map((a) => a.key)).toEqual(['soon', 'late', 'edge']);
  });
  it('takes a custom window', () => {
    expect(dueWithin([ask('a', { by: min(90) })], NOW, 120 * 60_000)).toHaveLength(1);
  });
  it('ignores an unparseable deadline', () => {
    expect(dueWithin([ask('a', { by: 'soonish' })], NOW)).toEqual([]);
  });
});

describe('push notifier', () => {
  // @req FR:iphone-access/notify.payload @req FR:iphone-access/notify.send
  it('sends one due ask as key and title to every device', async () => {
    const { devices } = await mk(2);
    const r = recorder();
    const n = createPushNotifier({ devices, sender: r.sender, now: () => NOW });
    const out = await n.notify([ask('k1', { ask: 'Approve\u0007 deploy', why: 'secret reason' }), ask('far', { by: min(300) })]);
    expect(out).toEqual({ sent: 2, removed: 0, failed: 0, skipped: 0 });
    expect(r.calls).toHaveLength(2);
    expect(JSON.parse(r.calls[0].payload)).toEqual({ key: 'k1', title: 'Approve deploy' });
    expect(r.calls[0].payload).not.toContain('secret reason');
  });
  it('sends one summary for several and cuts long titles', async () => {
    const { devices } = await mk(1);
    const r = recorder();
    const n = createPushNotifier({ devices, sender: r.sender, now: () => NOW });
    await n.notify([ask('b', { by: min(40) }), ask('a', { by: min(10) }), ask('c', { by: min(20) })]);
    expect(r.calls).toHaveLength(1);
    expect(JSON.parse(r.calls[0].payload)).toEqual({ key: 'a', title: '3 asks due within 1h' });
    const r2 = recorder();
    await createPushNotifier({ devices, sender: r2.sender, now: () => NOW }).notify([ask('x', { ask: 'y'.repeat(300) })]);
    expect(JSON.parse(r2.calls[0].payload).title).toHaveLength(120);
  });
  // @req FR:iphone-access/notify.prune
  it('removes a subscription on 404 or 410, keeps it on other failures', async () => {
    const { devices } = await mk(3);
    const r = recorder((e) => (e.endsWith('e0') ? 410 : e.endsWith('e1') ? 404 : 503));
    const out = await createPushNotifier({ devices, sender: r.sender, now: () => NOW }).notify([ask('k')]);
    expect(out).toEqual({ sent: 0, removed: 2, failed: 1, skipped: 0 });
    expect((await devices.subscriptions()).map((s) => s.sub.endpoint)).toEqual(['https://web.push.apple.com/e2']);
  });
  // @req FR:iphone-access/notify.isolate
  it('a throwing sender does not stop the others', async () => {
    const { devices } = await mk(2);
    const r = recorder((e) => (e.endsWith('e0') ? new Error('net') : 201));
    const out = await createPushNotifier({ devices, sender: r.sender, now: () => NOW }).notify([ask('k')]);
    expect(out).toEqual({ sent: 1, removed: 0, failed: 1, skipped: 0 });
    expect(r.calls).toHaveLength(2);
  });
  // @req FR:iphone-access/notify.none @req FR:iphone-access/notify.events
  it('sends nothing when nothing is due or nobody subscribed; events hold counts only', async () => {
    const { devices } = await mk(1);
    const r = recorder();
    const events: unknown[] = [];
    const n = createPushNotifier({ devices, sender: r.sender, now: () => NOW, onEvent: (e) => events.push(e) });
    expect(await n.notify([ask('far', { by: min(200) })])).toEqual({ sent: 0, removed: 0, failed: 0, skipped: 0 });
    const empty = await mk(0);
    const n2 = createPushNotifier({ devices: empty.devices, sender: r.sender, now: () => NOW });
    expect(await n2.notify([ask('k')])).toEqual({ sent: 0, removed: 0, failed: 0, skipped: 0 });
    expect(r.calls).toHaveLength(0);
    await n.notify([ask('k')]);
    expect(events).toEqual([{ sent: 1, removed: 0, failed: 0, skipped: 0 }]);
  });
  it('skips revoked devices', async () => {
    const { devices, ids } = await mk(2);
    await devices.revoke(ids[0]);
    const r = recorder();
    await createPushNotifier({ devices, sender: r.sender, now: () => NOW }).notify([ask('k')]);
    expect(r.calls).toHaveLength(1);
  });
});

describe('quiet hours', () => {
  // 18:00Z = 10:00 in Los Angeles; 06:00Z = 22:00 the day before.
  const NIGHT = new Date('2026-11-06T06:00:00Z');
  const at = (d: Date, n: number) => new Date(d.getTime() + n * 60_000).toISOString();
  const QUIET = { start: 21, end: 8, timeZone: 'America/Los_Angeles' };

  // @req FR:iphone-access/notify.quiet
  it('sends only crit asks inside quiet hours', async () => {
    const { devices } = await mk(1);
    const r = recorder();
    const n = createPushNotifier({ devices, sender: r.sender, now: () => NIGHT, quiet: QUIET });
    const out = await n.notify([ask('norm', { by: at(NIGHT, 20) }), ask('fire', { by: at(NIGHT, 30), priority: 'crit', ask: 'Prod down' })]);
    expect(out).toMatchObject({ sent: 1 });
    expect(JSON.parse(r.calls[0].payload)).toEqual({ key: 'fire', title: 'Prod down' });
  });
  // @req FR:iphone-access/notify.quiet
  it('sends nothing at night with no crit ask, and everything by day', async () => {
    const { devices } = await mk(1);
    const r = recorder();
    expect(await createPushNotifier({ devices, sender: r.sender, now: () => NIGHT, quiet: QUIET }).notify([ask('a', { by: at(NIGHT, 20) })])).toMatchObject({ sent: 0 });
    expect(r.calls).toHaveLength(0);
    expect(await createPushNotifier({ devices, sender: r.sender, now: () => NOW, quiet: QUIET }).notify([ask('a')])).toMatchObject({ sent: 1 });
  });
  // @req FR:iphone-access/notify.quiet
  it('handles a window that does not wrap midnight', async () => {
    const { devices } = await mk(1);
    const r = recorder();
    // 10:00 local is inside 9-12.
    expect(await createPushNotifier({ devices, sender: r.sender, now: () => NOW, quiet: { start: 9, end: 12, timeZone: 'America/Los_Angeles' } }).notify([ask('a')])).toMatchObject({ sent: 0 });
  });
});

describe('per-device dedupe', () => {
  const mkLedger = () => createPushLedger(new MemoryTokenStore(), () => NOW);

  // @req FR:iphone-access/notify.dedupe
  it('pushes each ask and deadline once per device', async () => {
    const { devices } = await mk(2);
    const ledger = mkLedger();
    const r = recorder();
    const n = createPushNotifier({ devices, sender: r.sender, now: () => NOW, ledger });
    expect(await n.notify([ask('k')])).toEqual({ sent: 2, removed: 0, failed: 0, skipped: 0 });
    expect(await n.notify([ask('k')])).toEqual({ sent: 0, removed: 0, failed: 0, skipped: 2 });
    expect(r.calls).toHaveLength(2);
    // A moved deadline is a new push.
    await n.notify([ask('k', { by: min(45) })]);
    expect(r.calls).toHaveLength(4);
  });
  // @req FR:iphone-access/notify.serial
  it('overlapping checks push each pair once', async () => {
    const { devices } = await mk(1);
    const calls: string[] = [];
    const sender: PushSender = { send: async (sub) => { calls.push(sub.endpoint); await new Promise((ok) => setTimeout(ok, 10)); return { status: 201 }; } };
    const n = createPushNotifier({ devices, sender, now: () => NOW, ledger: mkLedger() });
    const [a, b] = await Promise.all([n.notify([ask('k')]), n.notify([ask('k')])]);
    expect(calls).toHaveLength(1);
    expect(a.sent + b.sent).toBe(1);
    expect(a.skipped + b.skipped).toBe(1);
  });
  // @req FR:iphone-access/notify.serial
  it('a hung check blocks the next check for waitMs only', async () => {
    const { devices } = await mk(1);
    let first = true;
    const r = recorder();
    const sender: PushSender = { send: (sub, payload) => { if (first) { first = false; return new Promise<never>(() => undefined); } return r.sender.send(sub, payload); } };
    const n = createPushNotifier({ devices, sender, now: () => NOW, waitMs: 20 });
    void n.notify([ask('k')]);
    expect(await n.notify([ask('k')])).toEqual({ sent: 1, removed: 0, failed: 0, skipped: 0 });
    expect(r.calls).toHaveLength(1);
  });
  // @req FR:iphone-access/notify.dedupe
  it('builds each payload from that device own unsent asks', async () => {
    const { devices } = await mk(1);
    const ledger = mkLedger();
    const r = recorder();
    const n = createPushNotifier({ devices, sender: r.sender, now: () => NOW, ledger });
    await n.notify([ask('a', { by: min(10) })]);
    await n.notify([ask('a', { by: min(10) }), ask('b', { by: min(20), ask: 'Second' })]);
    expect(JSON.parse(r.calls[1].payload)).toEqual({ key: 'b', title: 'Second' });
  });
  // @req FR:iphone-access/notify.dedupe
  it('marks sent only on 2xx, so a failed push retries', async () => {
    const { devices } = await mk(1);
    const ledger = mkLedger();
    let status = 503;
    const r = recorder(() => status);
    const n = createPushNotifier({ devices, sender: r.sender, now: () => NOW, ledger });
    expect(await n.notify([ask('k')])).toMatchObject({ failed: 1 });
    status = 201;
    expect(await n.notify([ask('k')])).toMatchObject({ sent: 1 });
  });
  // @req FR:iphone-access/notify.dedupe.store
  it('ledger stores ids, keys and times only, and drops stale pairs', async () => {
    const store = new MemoryTokenStore();
    let now = NOW;
    const ledger = createPushLedger(store, () => now);
    await ledger.mark('d1', { k: min(30) });
    expect(await ledger.sent('d1')).toEqual({ k: min(30) });
    const raw = JSON.parse((await store.read())!.content);
    expect(raw).toEqual({ version: 1, sent: { d1: { k: min(30) } } });
    now = new Date(NOW.getTime() + 3 * 3600_000);
    await ledger.mark('d2', { j: new Date(now.getTime() + 600_000).toISOString() });
    expect(await ledger.sent('d1')).toEqual({});
  });
});
