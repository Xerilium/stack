/**
 * Live updates: server-sent events with a polling fallback for hosts that have no watcher.
 * @req FR:ask-queue/web.live @req FR:ask-queue/live.fallback @req FR:web-shell/state.live
 */
export interface EventSourceLike {
  readyState: number;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  addEventListener(type: string, fn: (e: { data: string }) => void): void;
  close(): void;
}
export type LiveStatus = 'live' | 'poll' | 'offline';
export interface LiveOpts {
  url?: string;
  /** `null` means the platform has no EventSource: poll from the start. */
  make?: ((url: string) => EventSourceLike) | null;
  onChange: (kinds: string[]) => void;
  onStatus: (s: LiveStatus) => void;
  pollMs?: number;
  visible?: () => boolean;
}
/** Call it to stop; `retry` reopens a dropped stream (or asks for a refresh while polling). */
export type LiveHandle = (() => void) & { retry: () => void };

const ALL = ['asks', 'tasks', 'state'];

export function connectLive(o: LiveOpts): LiveHandle {
  const make = o.make === undefined ? (typeof EventSource === 'undefined' ? null : (u: string) => new EventSource(u) as unknown as EventSourceLike) : o.make;
  const visible = o.visible ?? (() => typeof document === 'undefined' || document.visibilityState === 'visible');
  let es: EventSourceLike | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let wasLive = false;
  let stopped = false;
  const poll = () => {
    if (timer || stopped) return;
    o.onStatus('poll');
    timer = setInterval(() => { if (visible()) o.onChange(['poll']); }, o.pollMs ?? 15_000);
  };
  const open = () => {
    if (!make) return poll();
    es = make(o.url ?? '/events');
    const mine = es;
    mine.onopen = () => {
      o.onStatus('live');
      // A reconnect may have missed changes: refresh everything once.
      if (wasLive) o.onChange(ALL);
      wasLive = true;
    };
    mine.addEventListener('change', (e) => {
      try { const d = JSON.parse(e.data) as { kinds?: string[] }; o.onChange(Array.isArray(d.kinds) ? d.kinds : ALL); } catch { o.onChange(ALL); }
    });
    mine.onerror = () => {
      if (stopped || es !== mine) return;
      if (mine.readyState === 2) { mine.close(); es = null; poll(); } else o.onStatus('offline');
    };
  };
  open();
  const stop = (() => { stopped = true; if (timer) clearInterval(timer); es?.close(); }) as LiveHandle;
  /** Reopens the stream, even after a permanent close (a host that came back); without EventSource it just refreshes. */
  stop.retry = () => {
    if (stopped) return;
    if (!make) { o.onChange(['poll']); return; }
    if (timer) { clearInterval(timer); timer = null; }
    es?.close();
    es = null;
    open();
  };
  return stop;
}
