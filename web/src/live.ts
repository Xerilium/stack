/**
 * Live updates: server-sent events, else polling a cheap change probe (`/api/sync`) on hosts with no watcher.
 * @req FR:ask-queue/web.live @req FR:ask-queue/live.fallback
 * @req FR:live-deploy/web.poll @req FR:live-deploy/web.state @req FR:live-deploy/web.action
 */
export interface EventSourceLike {
  readyState: number;
  onopen: (() => void) | null;
  onerror: (() => void) | null;
  addEventListener(type: string, fn: (e: { data: string }) => void): void;
  close(): void;
}
/** `connecting` before the first answer; `poll` means the last probe succeeded; `signin` means the session expired. */
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
export interface Live { (): void; /** Check now: probe at once, or reconnect a dropped stream. */ retry(): void }

const ALL = ['asks', 'tasks', 'state'];

const defaultWake = (fn: () => void) => {
  if (typeof document === 'undefined' || typeof window === 'undefined') return () => undefined;
  const vis = () => { if (document.visibilityState === 'visible') fn(); };
  document.addEventListener('visibilitychange', vis); window.addEventListener('online', fn);
  return () => { document.removeEventListener('visibilitychange', vis); window.removeEventListener('online', fn); };
};

export function connectLive(o: LiveOpts): Live {
  const make = o.make === undefined ? (typeof EventSource === 'undefined' ? null : (u: string) => new EventSource(u) as unknown as EventSourceLike) : o.make;
  const visible = o.visible ?? (() => typeof document === 'undefined' || document.visibilityState === 'visible');
  let es: EventSourceLike | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let wasLive = false;
  let stopped = false;
  let polling = false;
  let rev: string | null | undefined;
  let inFlight = false;
  let failed = false;
  let seen = false;
  let unwake: () => void = () => undefined;

  const check = () => {
    if (stopped || inFlight || !visible()) return;
    if (!o.probe) { o.onChange(['poll']); return; }
    inFlight = true;
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const hung = new Promise<never>((_ok, bad) => { timeout = setTimeout(() => bad(Object.assign(new Error('Timed out'), { status: 0 })), o.probeMs ?? 10_000); });
    Promise.race([o.probe(), hung]).finally(() => clearTimeout(timeout)).then((r) => {
      inFlight = false;
      if (stopped) return;
      o.onStatus('poll');
      o.onSynced?.(new Date());
      // After a failure, reload: changes may have been missed. A null revision cannot tell, so it reloads from the second probe on.
      if (failed) o.onChange(ALL);
      else if (seen && r === null) o.onChange(['poll']);
      // The first real revision also reloads once: a change between the initial load and this probe would otherwise wait for the next change.
      else if (r !== null && r !== rev) o.onChange(ALL);
      rev = r; failed = false; seen = true;
    }, (e: unknown) => {
      inFlight = false;
      if (stopped) return;
      failed = true;
      o.onStatus((e as { status?: number } | null)?.status === 401 ? 'signin' : 'offline');
    });
  };
  const poll = () => {
    if (timer || stopped) return;
    polling = true;
    if (!o.probe) o.onStatus('poll');
    timer = setInterval(check, o.pollMs ?? 15_000);
    unwake = (o.wake ?? defaultWake)(check);
    if (o.probe) check();
  };

  const open = () => {
    es = make!(o.url ?? '/events');
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
  };

  if (!make) poll(); else open();

  const stop = (() => { stopped = true; if (timer) clearInterval(timer); unwake(); es?.close(); }) as Live;
  stop.retry = () => {
    if (stopped) return;
    if (polling) { check(); return; }
    if (es && es.readyState !== 1) { es.close(); wasLive = true; open(); }
  };
  return stop;
}
