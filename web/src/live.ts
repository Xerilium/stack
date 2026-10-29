/**
 * Live updates: server-sent events with a polling fallback for hosts that have no watcher.
 * @req FR:ask-queue/web.live @req FR:ask-queue/live.fallback
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

const ALL = ['asks', 'tasks', 'state'];

export function connectLive(o: LiveOpts): () => void {
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
  if (!make) { poll(); return () => { stopped = true; if (timer) clearInterval(timer); }; }
  es = make(o.url ?? '/events');
  es.onopen = () => {
    o.onStatus('live');
    // A reconnect may have missed changes: refresh everything once.
    if (wasLive) o.onChange(ALL);
    wasLive = true;
  };
  es.addEventListener('change', (e) => {
    try { const d = JSON.parse(e.data) as { kinds?: string[] }; o.onChange(Array.isArray(d.kinds) ? d.kinds : ALL); } catch { o.onChange(ALL); }
  });
  es.onerror = () => {
    if (stopped) return;
    if (es && es.readyState === 2) { es.close(); poll(); } else o.onStatus('offline');
  };
  return () => { stopped = true; if (timer) clearInterval(timer); es?.close(); };
}
