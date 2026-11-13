/**
 * Live updates: server-sent events, else polling a cheap change probe (`/api/sync`) on hosts with no watcher.
 * @req FR:ask-queue/web.live @req FR:ask-queue/live.fallback @req FR:web-shell/state.live
 * @req FR:live-deploy/web.poll @req FR:live-deploy/web.state @req FR:live-deploy/web.action
 */
export interface EventSourceLike {
  readyState: number;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  addEventListener(type: string, fn: (e: { data: string }) => void): void;
  close(): void;
}
/** `connecting` before the first answer; `poll` means polling (with a probe: the last probe succeeded); `signin` means the session expired. */
export type LiveStatus = 'connecting' | 'live' | 'poll' | 'offline' | 'signin';
export interface LiveOpts {
  url?: string;
  /** `null` means the platform has no EventSource: poll from the start. */
  make?: ((url: string) => EventSourceLike) | null;
  onChange: (kinds: string[]) => void;
  onStatus: (s: LiveStatus) => void;
  /** Returns the repo revision (null: unknown, reload every time). Throws an error with `status` on failure. Without it, polling reloads blindly. */
  probe?: () => Promise<string | null>;
  /** Hears each successful probe. */
  onSynced?: (at: Date) => void;
  pollMs?: number;
  /** A probe with no answer after this long counts as a failure, so one hung request never stops polling. Default 10000. */
  probeMs?: number;
  visible?: () => boolean;
  /** Subscribes to "check now" moments (page shown, back online); default uses document and window. */
  wake?: (fn: () => void) => () => void;
}
/** Call it to stop; `retry` reopens a dropped stream, or probes now while polling. */
export type LiveHandle = (() => void) & { retry: () => void };

const ALL = ['asks', 'tasks', 'state'];

/** Parts that re-read their own data (the PR page) hear every change the one stream sees. @req FR:pr-page/live.event */
const listeners = new Set<(kinds: string[]) => void>();
export function onLiveChange(fn: (kinds: string[]) => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }

const defaultWake = (fn: () => void) => {
  if (typeof document === 'undefined' || typeof window === 'undefined') return () => undefined;
  const vis = () => { if (document.visibilityState === 'visible') fn(); };
  document.addEventListener('visibilitychange', vis); window.addEventListener('online', fn);
  return () => { document.removeEventListener('visibilitychange', vis); window.removeEventListener('online', fn); };
};

export function connectLive(o: LiveOpts): LiveHandle {
  const emit = (kinds: string[]) => { o.onChange(kinds); for (const f of listeners) f(kinds); };
  const make = o.make === undefined ? (typeof EventSource === 'undefined' ? null : (u: string) => new EventSource(u) as unknown as EventSourceLike) : o.make;
  const visible = o.visible ?? (() => typeof document === 'undefined' || document.visibilityState === 'visible');
  let es: EventSourceLike | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let wasLive = false;
  let stopped = false;
  let rev: string | null | undefined;
  let inFlight = false;
  let failed = false;
  let seen = false;
  let unwake: () => void = () => undefined;

  /**
   * One probe. Reloads only when the revision changed (a null revision reloads every time); a failure keeps the
   * interval going, so polling resumes on its own, no click needed.
   * @req FR:live-deploy/web.poll.reload @req FR:live-deploy/web.action.auto
   */
  const check = () => {
    if (stopped || inFlight || !visible()) return;
    if (!o.probe) { emit(['poll']); return; }
    inFlight = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const hung = new Promise<never>((_ok, bad) => { timeout = setTimeout(() => bad(Object.assign(new Error('Timed out'), { status: 0 })), o.probeMs ?? 10_000); });
    Promise.race([o.probe(), hung]).finally(() => clearTimeout(timeout)).then((r) => {
      inFlight = false;
      if (stopped) return;
      o.onStatus('poll');
      o.onSynced?.(new Date());
      // After a failure, reload: changes may have been missed. A null revision cannot tell, so it reloads from the second probe on.
      if (failed) emit(ALL);
      else if (seen && r === null) emit(['poll']);
      // The first real revision also reloads once: a change between the initial load and this probe would otherwise wait for the next change.
      else if (r !== null && r !== rev) emit(ALL);
      rev = r; failed = false; seen = true;
    }, (e: unknown) => {
      inFlight = false;
      if (stopped) return;
      failed = true;
      o.onStatus((e as { status?: number } | null)?.status === 401 ? 'signin' : 'offline');
    });
  };

  /** The polling fallback (the badge reads Checks every 15 s). @req FR:web-shell/state.live.poll */
  const poll = () => {
    if (timer || stopped) return;
    if (!o.probe) o.onStatus('poll');
    timer = setInterval(check, o.pollMs ?? 15_000);
    unwake = (o.wake ?? defaultWake)(check);
    if (o.probe) check();
  };
  const unpoll = () => { if (timer) { clearInterval(timer); timer = null; } unwake(); unwake = () => undefined; };

  /** Opens the stream; a drop reconnects, a permanent close falls back to polling. @req FR:web-shell/state.live.drop */
  const open = () => {
    if (!make) return poll();
    es = make(o.url ?? '/events');
    const mine = es;
    mine.onopen = () => {
      o.onStatus('live');
      // A reconnect may have missed changes: refresh everything once.
      if (wasLive) emit(ALL);
      wasLive = true;
    };
    mine.addEventListener('change', (e) => {
      try { const d = JSON.parse(e.data) as { kinds?: string[] }; emit(Array.isArray(d.kinds) ? d.kinds : ALL); } catch { emit(ALL); }
    });
    mine.onerror = () => {
      if (stopped || es !== mine) return;
      if (mine.readyState === 2) { mine.close(); es = null; poll(); } else o.onStatus('offline');
    };
  };
  open();
  const stop = (() => { stopped = true; unpoll(); es?.close(); }) as LiveHandle;
  /** Without EventSource: probe now. With it: reopen the stream, even after a permanent close (a host that came back). @req FR:web-shell/state.live.retry */
  stop.retry = () => {
    if (stopped) return;
    if (!make) { check(); return; }
    unpoll();
    es?.close();
    es = null;
    open();
  };
  return stop;
}
