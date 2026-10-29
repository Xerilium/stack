/** @req FR:ask-queue/web.live @req FR:ask-queue/live.fallback */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { connectLive, type EventSourceLike } from '../src/live';

class FakeES implements EventSourceLike {
  static all: FakeES[] = [];
  readyState = 0; onopen: (() => void) | null = null; onerror: (() => void) | null = null; closed = false;
  private subs = new Map<string, ((e: { data: string }) => void)[]>();
  constructor(public url: string) { FakeES.all.push(this); }
  addEventListener(t: string, fn: (e: { data: string }) => void) { this.subs.set(t, [...(this.subs.get(t) ?? []), fn]); }
  close() { this.closed = true; this.readyState = 2; }
  emit(t: string, data: unknown) { for (const fn of this.subs.get(t) ?? []) fn({ data: JSON.stringify(data) }); }
  open() { this.readyState = 1; this.onopen?.(); }
  fail(permanent: boolean) { this.readyState = permanent ? 2 : 0; this.onerror?.(); }
}

beforeEach(() => { FakeES.all = []; vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

const setup = () => {
  const changes: string[][] = []; const status: string[] = [];
  const stop = connectLive({ make: (u) => new FakeES(u), onChange: (k) => changes.push(k), onStatus: (s) => status.push(s), pollMs: 15_000, visible: () => true });
  return { changes, status, stop, es: () => FakeES.all[FakeES.all.length - 1] };
};

describe('connectLive', () => {
  it('goes live on open and reports each change with its kinds', () => {
    const { changes, status, es } = setup();
    es().open();
    es().emit('change', { rev: 1, kinds: ['asks'] });
    expect(status).toEqual(['live']);
    expect(changes).toEqual([['asks']]);
  });
  it('refetches once after a reconnect so nothing is missed', () => {
    const { changes, status, es } = setup();
    es().open();
    es().fail(false);
    expect(status).toEqual(['live', 'offline']);
    es().open();
    expect(status).toEqual(['live', 'offline', 'live']);
    expect(changes).toEqual([['asks', 'tasks', 'state']]);
  });
  it('a permanent failure (host without a watcher) falls back to polling while visible', () => {
    const { changes, status, es } = setup();
    es().fail(true);
    expect(status).toEqual(['poll']);
    vi.advanceTimersByTime(15_000);
    vi.advanceTimersByTime(15_000);
    expect(changes).toEqual([['poll'], ['poll']]);
  });
  it('polling pauses while the page is hidden', () => {
    let vis = true; const changes: string[][] = [];
    connectLive({ make: (u) => new FakeES(u), onChange: (k) => changes.push(k), onStatus: () => undefined, pollMs: 1000, visible: () => vis });
    FakeES.all[0].fail(true);
    vis = false; vi.advanceTimersByTime(3000);
    expect(changes).toEqual([]);
    vis = true; vi.advanceTimersByTime(1000);
    expect(changes).toEqual([['poll']]);
  });
  it('stop closes the stream and the timers', () => {
    const { changes, stop, es } = setup();
    es().fail(true);
    stop();
    vi.advanceTimersByTime(60_000);
    expect(changes).toEqual([]);
    expect(es().closed).toBe(true);
  });
  it('a missing EventSource means polling from the start', () => {
    const changes: string[][] = []; const status: string[] = [];
    connectLive({ make: null, onChange: (k) => changes.push(k), onStatus: (s) => status.push(s), pollMs: 1000, visible: () => true });
    expect(status).toEqual(['poll']);
    vi.advanceTimersByTime(1000);
    expect(changes).toEqual([['poll']]);
  });
});

// @req FR:web-shell/state.live
describe('retry', () => {
  it('reopens the stream after a drop and goes live again', () => {
    const { status, changes, stop, es } = setup();
    es().open();
    es().fail(false);
    const old = es();
    stop.retry();
    expect(old.closed).toBe(true);
    expect(FakeES.all).toHaveLength(2);
    es().open();
    expect(status).toEqual(['live', 'offline', 'live']);
    expect(changes).toEqual([['asks', 'tasks', 'state']]);
  });
  it('retry while polling reopens the stream (the host may be back); it polls again if that fails for good', () => {
    const { changes, status, stop, es } = setup();
    es().fail(true);
    stop.retry();
    expect(FakeES.all).toHaveLength(2);
    es().open();
    expect(status).toEqual(['poll', 'live']);
    vi.advanceTimersByTime(15_000);
    expect(changes).toEqual([]);
    es().fail(true);
    expect(status).toEqual(['poll', 'live', 'poll']);
  });
  it('retry without EventSource just asks for a refresh', () => {
    const changes: string[][] = [];
    const stop = connectLive({ make: null, onChange: (k) => changes.push(k), onStatus: () => undefined, pollMs: 15_000, visible: () => true });
    stop.retry();
    expect(changes).toEqual([['poll']]);
  });
});

/** @req FR:live-deploy/web.poll @req FR:live-deploy/web.state @req FR:live-deploy/web.action */
describe('connectLive with a change probe', () => {
  const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  const mkProbe = () => {
    const p = { rev: 'a' as string | null, fail: null as null | { status: number }, calls: 0 };
    const probe = async () => { p.calls++; if (p.fail) throw Object.assign(new Error('x'), p.fail); return p.rev; };
    return { p, probe };
  };
  const run = (probe: () => Promise<string | null>, visible = () => true) => {
    const changes: string[][] = []; const status: string[] = []; const synced: Date[] = [];
    const live = connectLive({ make: null, probe, onChange: (k) => changes.push(k), onStatus: (s) => status.push(s), onSynced: (d) => synced.push(d), pollMs: 1000, visible });
    return { changes, status, synced, live };
  };

  it('probes at once, reloads once on the first revision (closing the gap after the initial load), then only on change', async () => {
    const { p, probe } = mkProbe();
    const { changes, status, synced } = run(probe);
    await flush();
    expect(p.calls).toBe(1);
    expect(status).toEqual(['poll']);
    expect(synced).toHaveLength(1);
    expect(changes).toEqual([['asks', 'tasks', 'state']]);
    vi.advanceTimersByTime(3000); await flush();
    expect(changes).toHaveLength(1);
    p.rev = 'b';
    vi.advanceTimersByTime(1000); await flush();
    expect(changes).toEqual([['asks', 'tasks', 'state'], ['asks', 'tasks', 'state']]);
  });
  it('a null revision reloads on every probe after the first', async () => {
    const { p, probe } = mkProbe(); p.rev = null;
    const { changes } = run(probe);
    await flush();
    vi.advanceTimersByTime(1000); await flush();
    vi.advanceTimersByTime(1000); await flush();
    expect(changes).toEqual([['poll'], ['poll']]);
  });
  it('a network failure is offline and keeps retrying without a click', async () => {
    const { p, probe } = mkProbe(); p.fail = { status: 0 };
    const { status, changes } = run(probe);
    await flush();
    expect(status).toEqual(['offline']);
    p.fail = null; p.rev = 'b';
    vi.advanceTimersByTime(1000); await flush();
    expect(status).toEqual(['offline', 'poll']);
    expect(changes).toEqual([['asks', 'tasks', 'state']]);
  });
  it('401 is signin', async () => {
    const { p, probe } = mkProbe(); p.fail = { status: 401 };
    const { status } = run(probe);
    await flush();
    expect(status).toEqual(['signin']);
  });
  it('retry probes now; it does not wait for the interval', async () => {
    const { p, probe } = mkProbe(); p.fail = { status: 0 };
    const { status, live } = run(probe);
    await flush();
    p.fail = null;
    live.retry(); await flush();
    expect(status).toEqual(['offline', 'poll']);
    expect(p.calls).toBe(2);
  });
  it('probes at once when the page becomes visible or the browser comes online', async () => {
    let vis = false; let wake = () => undefined as void;
    const { p, probe } = mkProbe();
    connectLive({ make: null, probe, onChange: () => undefined, onStatus: () => undefined, pollMs: 60_000, visible: () => vis, wake: (fn) => { wake = fn; return () => undefined; } });
    await flush();
    expect(p.calls).toBe(0);
    vis = true;
    wake(); await flush();
    expect(p.calls).toBe(1);
    wake(); await flush();
    expect(p.calls).toBe(2);
  });
  it('retry on a dropped stream reconnects and reloads', () => {
    const changes: string[][] = [];
    const live = connectLive({ make: (u) => new FakeES(u), onChange: (k) => changes.push(k), onStatus: () => undefined, pollMs: 1000, visible: () => true });
    FakeES.all[0].open();
    FakeES.all[0].fail(false);
    live.retry();
    expect(FakeES.all).toHaveLength(2);
    expect(FakeES.all[0].closed).toBe(true);
    FakeES.all[1].open();
    expect(changes).toEqual([['asks', 'tasks', 'state']]);
  });
});

/** @req FR:live-deploy/web.action */
describe('hung probe', () => {
  it('a probe with no answer times out to offline, and the next tick probes again', async () => {
    const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
    let calls = 0; let hang = true;
    const status: string[] = [];
    connectLive({ make: null, probe: () => { calls++; return hang ? new Promise<string>(() => undefined) : Promise.resolve('a'); }, onChange: () => undefined, onStatus: (s) => status.push(s), pollMs: 15_000, probeMs: 10_000, visible: () => true, wake: () => () => undefined });
    vi.advanceTimersByTime(10_000); await flush();
    expect(status).toEqual(['offline']);
    hang = false;
    vi.advanceTimersByTime(5_000); await flush();
    expect(calls).toBe(2);
    expect(status).toEqual(['offline', 'poll']);
  });
});
