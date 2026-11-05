import { createDeviceService, createTokenService, MemoryTokenStore } from '../../src/api/auth';
import { createPushNotifier, dueWithin, type PushSender } from '../../src/api/push';
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
    expect(out).toEqual({ sent: 2, removed: 0, failed: 0 });
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
    expect(out).toEqual({ sent: 0, removed: 2, failed: 1 });
    expect((await devices.subscriptions()).map((s) => s.sub.endpoint)).toEqual(['https://web.push.apple.com/e2']);
  });
  // @req FR:iphone-access/notify.isolate
  it('a throwing sender does not stop the others', async () => {
    const { devices } = await mk(2);
    const r = recorder((e) => (e.endsWith('e0') ? new Error('net') : 201));
    const out = await createPushNotifier({ devices, sender: r.sender, now: () => NOW }).notify([ask('k')]);
    expect(out).toEqual({ sent: 1, removed: 0, failed: 1 });
    expect(r.calls).toHaveLength(2);
  });
  // @req FR:iphone-access/notify.none @req FR:iphone-access/notify.events
  it('sends nothing when nothing is due or nobody subscribed; events hold counts only', async () => {
    const { devices } = await mk(1);
    const r = recorder();
    const events: unknown[] = [];
    const n = createPushNotifier({ devices, sender: r.sender, now: () => NOW, onEvent: (e) => events.push(e) });
    expect(await n.notify([ask('far', { by: min(200) })])).toEqual({ sent: 0, removed: 0, failed: 0 });
    const empty = await mk(0);
    const n2 = createPushNotifier({ devices: empty.devices, sender: r.sender, now: () => NOW });
    expect(await n2.notify([ask('k')])).toEqual({ sent: 0, removed: 0, failed: 0 });
    expect(r.calls).toHaveLength(0);
    await n.notify([ask('k')]);
    expect(events).toEqual([{ sent: 1, removed: 0, failed: 0 }]);
  });
  it('skips revoked devices', async () => {
    const { devices, ids } = await mk(2);
    await devices.revoke(ids[0]);
    const r = recorder();
    await createPushNotifier({ devices, sender: r.sender, now: () => NOW }).notify([ask('k')]);
    expect(r.calls).toHaveLength(1);
  });
});
