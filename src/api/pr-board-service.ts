/**
 * The host side of the PR page: polls GitHub while a page holds a lease, backs off on rate limits, and tells open pages when the board changes.
 * @req FR:pr-page/live.poll @req FR:pr-page/live.event @req FR:pr-page/live.backoff @req FR:pr-page/data.board
 */
import { activeAgents, buildRows, countRows, footerOf, isWip, parseQueue, type BoardCounts, type Escalations, type PrFacts, type PrRow } from '../core/pr-board';
import { GitHubRateLimit, type GitHubBoard } from './github-board';

/** @req FR:pr-page/$board */
export interface PrBoard {
  /** Time of the last good poll; null before the first. */
  at: string | null; user: string;
  agents: { count: number; source: 'sessions' | 'wip-label' };
  counts: BoardCounts; footer: { running: number; waiting: number; parked: number }; rows: PrRow[];
  escalations?: Escalations; queue: boolean;
  /** While polls are paused for a rate limit or errors. */
  rate?: { until: string };
  error?: string;
  /** A search hit its limit; some PRs may be missing. */
  truncated?: boolean;
}
export interface PrBoardService { get(): Promise<PrBoard>; refresh(): Promise<void>; stop(): void }
export interface PrBoardServiceOptions {
  source: GitHubBoard;
  /** The session inventory; absent means the WIP label stands in for active agents. */
  inventory?: () => { sessions: { state: string; prs: { url: string; state: string }[] }[] };
  /** The pr-priority store files, parsed JSON or undefined. */
  files?: () => { queue?: unknown; state?: unknown; config?: unknown };
  myRepos?: string[]; exclude?: string[];
  /** Whether the host can change the queue (the `pr-pri` command exists). */
  queue?: () => Promise<boolean>;
  intervalMs?: number; leaseMs?: number; now?: () => number;
  onChange?: () => void;
  timers?: { set: (fn: () => void, ms: number) => unknown; clear: (h: unknown) => void };
}

const MAX_BACKOFF = 15 * 60_000;
const LOW_POINTS = 100;
/** 30-60 s; default 45 s. @req FR:pr-page/live.poll */
export const clampInterval = (ms?: number) => Math.min(60_000, Math.max(30_000, ms ?? 45_000));

export function createPrBoardService(o: PrBoardServiceOptions): PrBoardService {
  const now = o.now ?? (() => Date.now());
  const interval = clampInterval(o.intervalMs);
  const leaseMs = o.leaseMs ?? 180_000;
  const timers = o.timers ?? { set: (fn: () => void, ms: number) => { const t = setTimeout(fn, ms); t.unref?.(); return t; }, clear: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>) };
  let facts: PrFacts[] | null = null;
  let user = '';
  let at: number | null = null;
  let lease = 0;
  let pausedUntil = 0;
  let failures = 0;
  let error = '';
  let timer: unknown = null;
  let inFlight: Promise<void> | null = null;
  let last = '';
  let stopped = false;
  let queueOk = false;
  let truncated = false;

  const build = (): PrBoard => {
    let agents: PrBoard['agents'];
    let agentPrs = new Set<string>();
    let inv: ReturnType<NonNullable<typeof o.inventory>> | null = null;
    try { inv = o.inventory?.() ?? null; } catch { inv = null; }
    if (inv) { const a = activeAgents(inv); agentPrs = a.prs; agents = { count: a.count, source: 'sessions' }; }
    else { const wip = (facts ?? []).filter(isWip); agentPrs = new Set(wip.map((f) => f.url.toLowerCase())); agents = { count: wip.length, source: 'wip-label' }; }
    let files: { queue?: unknown; state?: unknown; config?: unknown } = {};
    try { files = o.files?.() ?? {}; } catch { files = {}; }
    const q = parseQueue(files);
    // Excludes: config `github.exclude` plus the store's `pr-priority.config.json`.
    const rows = facts ? buildRows(facts, { user, now: new Date(now()), agentPrs, myRepos: o.myRepos, exclude: [...(o.exclude ?? []), ...q.exclude], reports: q.reports, ranks: q.ranks, pinned: q.pinned, recs: q.recs, acks: q.acks }) : [];
    return {
      at: at === null ? null : new Date(at).toISOString(), user, agents, counts: countRows(rows), footer: footerOf(rows, agents.count), rows,
      ...(q.escalations ? { escalations: q.escalations } : {}), queue: queueOk,
      ...(pausedUntil > now() ? { rate: { until: new Date(pausedUntil).toISOString() } } : {}), ...(error ? { error } : {}), ...(truncated ? { truncated } : {}),
    };
  };
  const fingerprint = (b: PrBoard) => JSON.stringify({ ...b, at: null, rate: null });

  /** One poll. A failure keeps the last good board. @req FR:pr-page/live.backoff */
  const poll = (): Promise<void> => {
    if (inFlight) return inFlight;
    inFlight = (async () => {
      try {
        if (o.queue) queueOk = await o.queue().catch(() => false);
        const r = await o.source.fetch();
        user = r.user;
        facts = r.facts; truncated = !!r.truncated; at = now(); failures = 0; error = ''; pausedUntil = 0;
        if (r.rate && r.rate.remaining < LOW_POINTS) pausedUntil = Date.parse(r.rate.resetAt) || now() + interval;
      } catch (e) {
        if (e instanceof GitHubRateLimit) { pausedUntil = e.until; error = 'GitHub rate limit'; }
        else { failures++; pausedUntil = now() + Math.min(MAX_BACKOFF, interval * 2 ** failures); error = 'GitHub unavailable'; }
      } finally { inFlight = null; }
      const fp = fingerprint(build());
      if (fp !== last) { const first = last === ''; last = fp; if (!first) o.onChange?.(); }
    })();
    return inFlight;
  };

  const schedule = () => {
    if (timer !== null || stopped) return;
    const wait = Math.max(interval, pausedUntil - now());
    timer = timers.set(() => {
      timer = null;
      if (stopped || now() >= lease) return; // no page holds a lease: stop until the next get()
      if (pausedUntil > now()) { schedule(); return; } // a refresh set a backoff after this timer was set
      void poll().finally(schedule);
    }, wait);
  };

  return {
    async get() {
      lease = now() + leaseMs;
      // No board yet, or one older than two intervals (the lease ran out): poll before answering. @req FR:pr-page/live.poll
      if ((facts === null || now() - (at ?? 0) > 2 * interval) && pausedUntil <= now()) await poll();
      schedule();
      return build();
    },
    async refresh() { if (pausedUntil <= now()) await poll(); },
    stop() { stopped = true; if (timer !== null) timers.clear(timer); timer = null; },
  };
}
