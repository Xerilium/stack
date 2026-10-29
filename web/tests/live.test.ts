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
  it('retry while polling just asks for a refresh', () => {
    const { changes, stop, es } = setup();
    es().fail(true);
    stop.retry();
    expect(changes).toEqual([['poll']]);
    expect(FakeES.all).toHaveLength(1);
  });
});
