/**
 * The live validation lane: exactly one PR at a time, with a checklist the owner taps through.
 * Stack only stores state here. It never starts a server or an agent, and never touches GitHub threads or labels.
 * @req FR:pr-review-lane/lane.model @req FR:pr-review-lane/lane.guard
 */
import { randomBytes } from 'crypto';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { pidAlive, withFileLock, writeAtomic, type LockOptions } from './file-lock';
import type { Need, NeedAnswerInput } from './needs-you';
import { parsePrRef, refKey, refText, type PrRef } from './pr-review';

export const LIVE_STATES = ['preparing', 'working', 'ready-for-michael', 'revalidating'] as const;
export type LiveState = (typeof LIVE_STATES)[number];
export const ITEM_STATES = ['open', 'passed', 'failed', 'needs-fix', 'fixed-pending-revalidation', 'blocked'] as const;
export type ItemState = (typeof ITEM_STATES)[number];
export const ITEM_OPS = ['add', 'check', 'uncheck', 'fail', 'needs-fix', 'fixed', 'block', 'comment', 'edit'] as const;
export type ItemOp = (typeof ITEM_OPS)[number];
export const DONE_REASONS = ['merged', 'closed', 'done'] as const;

export interface ActivePr { repo: string; number: number; url: string; title?: string; state: LiveState; by?: string; claimedAt: string; worktree?: string; serverUrl?: string; port?: number; pid?: number; headSha?: string; waitingOnLock?: string }
/** @req FR:pr-review-lane/lane.item */
export interface LiveItem { id: string; text: string; by: string; state: ItemState; comment?: string; reason?: string; createdAt: string; updatedAt: string; updatedBy?: string }
export interface DonePr { repo: string; number: number; url: string; at: string; reason: string }
interface LaneFile { version: 1; rev: number; active?: ActivePr; done: DonePr[]; lists: Record<string, LiveItem[]> }
export interface LaneView { state: LiveState | 'idle'; rev: number; active?: ActivePr; items: LiveItem[]; done: DonePr[] }

/** Error codes map to CLI exits (usage 2, notfound 1, conflict 3, none 4) and API errors. */
export class LiveError extends Error { constructor(readonly code: 'usage' | 'notfound' | 'conflict' | 'none', message: string) { super(message); } }

// ---- config

/** @req FR:pr-review-lane/lane.config */
export interface LiveConfig { lockPath: string; portMin: number; portMax: number; reservedPorts: number[]; exclude: string[] }
export const LIVE_DEFAULTS: LiveConfig = { lockPath: '/tmp/fh-server.lock', portMin: 5173, portMax: 5182, reservedPorts: [5180], exclude: ['#918'] };

/** `<home>/live.config.json` over the defaults; a missing or broken file is the defaults. @req FR:pr-review-lane/lane.config */
export function readLiveConfig(home: string): LiveConfig {
  let raw: Record<string, unknown> = {};
  try { const v = JSON.parse(readFileSync(join(home, 'live.config.json'), 'utf8')); if (v && typeof v === 'object' && !Array.isArray(v)) raw = v; } catch { /* defaults */ }
  const port = (v: unknown, d: number) => (Number.isInteger(v) && (v as number) > 0 && (v as number) < 65536 ? v as number : d);
  const ints = (v: unknown, d: number[]) => (Array.isArray(v) && v.every((x) => Number.isInteger(x)) ? v as number[] : d);
  const strs = (v: unknown, d: string[]) => (Array.isArray(v) && v.every((x) => typeof x === 'string') ? v as string[] : d);
  return {
    lockPath: typeof raw.lockPath === 'string' && raw.lockPath.trim() ? raw.lockPath : LIVE_DEFAULTS.lockPath,
    portMin: port(raw.portMin, LIVE_DEFAULTS.portMin), portMax: port(raw.portMax, LIVE_DEFAULTS.portMax),
    reservedPorts: ints(raw.reservedPorts, LIVE_DEFAULTS.reservedPorts), exclude: strs(raw.exclude, LIVE_DEFAULTS.exclude),
  };
}

/** An entry is a ref, a PR url, or `#<n>` for any repo. */
export function isExcluded(r: { repo: string; number: number }, exclude: string[]): boolean {
  return exclude.some((e) => { const t = e.trim(); if (/^#\d+$/.test(t)) return Number(t.slice(1)) === r.number; const x = parsePrRef(t); return !!x && refKey(x) === refKey(r); });
}

// ---- queue and pick

/** The pr-priority queue (`<home>/pr-priority.json`), rank order, read-only; missing or broken is empty. */
export function readQueue(home: string): PrRef[] {
  try {
    const d = JSON.parse(readFileSync(join(home, 'pr-priority.json'), 'utf8')) as { items?: { rank?: number; repo?: string; number?: number }[] };
    if (!Array.isArray(d.items)) return [];
    return [...d.items].sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)).map((i) => parsePrRef(`${i.repo}#${i.number}`)).filter((r): r is PrRef => !!r);
  } catch { return []; }
}

/** First queued PR that is not excluded, not done, and live. Asks `isLive` in order and stops at the first yes. @req FR:pr-review-lane/lane.pick */
export async function pickNext(queue: PrRef[], o: { exclude: string[]; done: string[] }, isLive: (r: PrRef) => Promise<boolean>): Promise<PrRef | null> {
  const done = new Set(o.done.map((d) => d.toLowerCase()));
  for (const r of queue) {
    if (isExcluded(r, o.exclude) || done.has(refKey(r))) continue;
    if (await isLive(r)) return r;
  }
  return null;
}

// ---- server lock

/** The shared server lock file, also written by the Sweep Manager. @req FR:pr-review-lane/lane.lock */
export interface ServerLock { owner: string; port: number; pid: number; wt: string; head: string }
export const laneOwner = (r: { repo: string; number: number }): string => `live:${refText(r)}`;

export function readLock(path: string): ServerLock | null {
  try { const v = JSON.parse(readFileSync(path, 'utf8')); return v && typeof v === 'object' && typeof v.owner === 'string' ? v as ServerLock : null; } catch { return null; }
}
/** Free when absent, broken, ours, or its pid is not running (stale). @req FR:pr-review-lane/lane.lock */
export function lockState(lock: ServerLock | null, owner: string, alive: (pid: number) => boolean = pidAlive): { free: boolean; holder?: string } {
  if (!lock || lock.owner === owner || !alive(Number(lock.pid))) return { free: true };
  return { free: false, holder: `${lock.owner} (pid ${lock.pid}, port ${lock.port})` };
}

// ---- store

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const line = (v: string | undefined, max = 300): string | undefined => (typeof v === 'string' && v.trim() && v.length <= max && !/[\r\n]/.test(v) ? v.trim() : undefined);
const BY = /^(owner|[a-z0-9][a-z0-9-]{0,39})$/;

export interface LiveOptions extends LockOptions { now?: () => Date; alive?: (pid: number) => boolean }
type Pick = () => Promise<PrRef | null>;
/** Title and head SHA of a PR, from the facts cache. */
export type PrInfo = (r: PrRef) => { title?: string; headSha?: string } | undefined;
const infoOf = (info: PrInfo | undefined, r: PrRef) => { const i = info?.(r); return { ...(i?.title ? { title: i.title } : {}), ...(i?.headSha ? { headSha: i.headSha } : {}) }; };

/** `<home>/live-lane.json`. @req FR:pr-review-lane/lane.model */
export class LiveStore {
  readonly file: string;
  private readonly listeners = new Set<() => void>();
  constructor(readonly home: string, private readonly o: LiveOptions = {}) { this.file = join(home, 'live-lane.json'); }

  config(): LiveConfig { return readLiveConfig(this.home); }
  private now(): string { return (this.o.now ?? (() => new Date()))().toISOString(); }
  private alive(pid: number): boolean { return (this.o.alive ?? pidAlive)(pid); }

  private load(): LaneFile {
    try {
      const d = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<LaneFile>;
      if (!isObj(d) || d.version !== 1) throw new Error('broken');
      return { version: 1, rev: Number(d.rev) || 0, ...(isObj(d.active) ? { active: d.active as ActivePr } : {}), done: Array.isArray(d.done) ? d.done : [], lists: isObj(d.lists) ? d.lists as Record<string, LiveItem[]> : {} };
    } catch { return { version: 1, rev: 0, done: [], lists: {} }; }
  }

  /** Runs `fn` on the file under the lock; writes only when `fn` returns changed. */
  private write<T>(fn: (d: LaneFile) => { changed: boolean; out: T }): Promise<T> {
    return withFileLock(this.home, 'live-lane.lock', () => {
      const d = this.load();
      const r = fn(d);
      if (r.changed) {
        d.rev += 1;
        writeAtomic(this.file, `${JSON.stringify(d, null, 2)}\n`);
        for (const f of this.listeners) f();
      }
      return r.out;
    }, () => new LiveError('conflict', 'Live lane store is busy (live-lane.lock); try again'), this.o);
  }

  /** Called after each write (the host tells open pages). */
  onWrite(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }

  /** @req FR:pr-review-lane/lane.show */
  view(): LaneView {
    const d = this.load();
    const items = d.active ? d.lists[refKey(d.active)] ?? [] : [];
    return { state: d.active?.state ?? 'idle', rev: d.rev, ...(d.active ? { active: d.active } : {}), items, done: d.done };
  }
  doneKeys(): string[] { return this.load().done.map(refKey); }

  private activeFor(d: LaneFile, r: { repo: string; number: number }): ActivePr {
    if (!d.active || refKey(d.active) !== refKey(r)) throw new LiveError('notfound', `${refText(r)} is not the live PR${d.active ? ` (live: ${refText(d.active)})` : ' (lane is idle)'}`);
    return d.active;
  }
  private heldLock(r: { repo: string; number: number }): string | undefined {
    return lockState(readLock(this.config().lockPath), laneOwner(r), (p) => this.alive(p)).holder;
  }

  /**
   * Claims a PR for an agent. With an active PR: no change, except the agent is recorded when none is.
   * @req FR:pr-review-lane/lane.next
   */
  async next(o: { ref?: PrRef; agent?: string; worktree?: string; info?: PrInfo }, pick: Pick): Promise<{ changed: boolean; active: ActivePr; lock?: string }> {
    if (o.agent !== undefined && !BY.test(o.agent)) throw new LiveError('usage', '--agent: lowercase letters, digits and dashes');
    const cfg = this.config();
    if (o.ref && isExcluded(o.ref, cfg.exclude)) throw new LiveError('usage', `${refText(o.ref)} is excluded from the live lane (live.config.json)`);
    const cur = this.load().active;
    const target = cur ? null : o.ref ?? await pick();
    if (!cur && !target) throw new LiveError('none', 'idle: no PR needs live validation');
    if (target && isExcluded(target, cfg.exclude)) throw new LiveError('none', 'idle: no PR needs live validation');
    const out = await this.write((d) => {
      if (d.active) {
        // One live PR: a ref that is not the live PR is refused, so an agent never works the wrong PR.
        if (o.ref && refKey(o.ref) !== refKey(d.active)) throw new LiveError('conflict', `${refText(d.active)} is live; resolve it before ${refText(o.ref)}`);
        if (!d.active.by && o.agent) { d.active.by = o.agent; if (o.worktree) d.active.worktree = o.worktree; return { changed: true, out: { changed: true, active: d.active } }; }
        return { changed: false, out: { changed: false, active: d.active } };
      }
      // The lane went idle between the read and the lock (a resolve with no next): nothing to claim.
      if (!target) throw new LiveError('none', 'idle: no PR needs live validation');
      d.active = { repo: target.repo, number: target.number, url: target.url, ...infoOf(o.info, target), state: 'preparing', claimedAt: this.now(), ...(o.agent ? { by: o.agent } : {}), ...(o.worktree ? { worktree: o.worktree } : {}) };
      return { changed: true, out: { changed: true, active: d.active } };
    });
    const lock = this.heldLock(out.active);
    return lock ? { ...out, lock } : out;
  }

  /** Records the server (lock + port rules) and hands the PR to the owner. @req FR:pr-review-lane/lane.ready @req FR:pr-review-lane/lane.port @req FR:pr-review-lane/lane.lock */
  async ready(r: PrRef, o: { url: string; port?: number; pid: number; worktree?: string; head?: string }): Promise<ActivePr> {
    let u: URL;
    try { u = new URL(o.url); } catch { throw new LiveError('usage', `--url must be an http or https url: ${o.url}`); }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new LiveError('usage', `--url must be an http or https url: ${o.url}`);
    const port = o.port ?? (u.port ? Number(u.port) : u.protocol === 'https:' ? 443 : 80);
    const cfg = this.config();
    if (!Number.isInteger(port) || port < cfg.portMin || port > cfg.portMax || cfg.reservedPorts.includes(port)) throw new LiveError('usage', `port ${port} is not allowed: use ${cfg.portMin}-${cfg.portMax}, never ${cfg.reservedPorts.join(', ') || '-'}`);
    if (!Number.isInteger(o.pid) || o.pid <= 0) throw new LiveError('usage', '--pid must be the server process id');
    let refused: string | undefined;
    const active = await this.write((d) => {
      const a = this.activeFor(d, r);
      const holder = this.heldLock(a);
      if (holder) { refused = holder; const changed = a.waitingOnLock !== holder; a.waitingOnLock = holder; return { changed, out: a }; }
      const wt = o.worktree ?? a.worktree ?? '';
      const head = o.head ?? a.headSha ?? '';
      writeAtomic(cfg.lockPath, `${JSON.stringify({ owner: laneOwner(a), port, pid: o.pid, wt, head } satisfies ServerLock)}\n`);
      const fixing = (d.lists[refKey(a)] ?? []).some((i) => i.state === 'fixed-pending-revalidation');
      delete a.waitingOnLock;
      Object.assign(a, { state: fixing ? 'revalidating' : 'ready-for-michael', serverUrl: o.url, port, pid: o.pid, ...(wt ? { worktree: wt } : {}), ...(head ? { headSha: head } : {}) });
      return { changed: true, out: a };
    });
    if (refused) throw new LiveError('conflict', `server lock held by ${refused}; wait or ask its owner to stop`);
    return active;
  }

  /** The agent state of the live PR. @req FR:pr-review-lane/lane.state */
  async setState(r: PrRef, state: 'preparing' | 'working'): Promise<ActivePr> {
    if (state !== 'preparing' && state !== 'working') throw new LiveError('usage', 'state must be preparing or working');
    return this.write((d) => { const a = this.activeFor(d, r); const changed = a.state !== state; a.state = state; return { changed, out: a }; });
  }

  /** Seeds items; an item whose text is already listed (no case) is skipped. @req FR:pr-review-lane/lane.checklist */
  async seed(r: PrRef, texts: string[], agent: string): Promise<{ added: number; items: LiveItem[] }> {
    if (!BY.test(agent)) throw new LiveError('usage', '--agent: lowercase letters, digits and dashes');
    if (texts.length < 1 || texts.length > 50) throw new LiveError('usage', 'checklist needs 1-50 items');
    const clean = texts.map((t) => line(t));
    if (clean.some((t) => !t)) throw new LiveError('usage', 'each item text is one line, 1-300 characters');
    return this.write((d) => {
      const a = this.activeFor(d, r);
      const list = d.lists[refKey(a)] ?? (d.lists[refKey(a)] = []);
      const seen = new Set(list.map((i) => i.text.toLowerCase()));
      let added = 0;
      for (const t of clean as string[]) {
        if (seen.has(t.toLowerCase())) continue;
        seen.add(t.toLowerCase());
        list.push(this.newItem(t, agent)); added++;
      }
      return { changed: added > 0, out: { added, items: list } };
    });
  }

  private newItem(text: string, by: string): LiveItem {
    const at = this.now();
    return { id: `li-${randomBytes(4).toString('hex')}`, text, by, state: 'open', createdAt: at, updatedAt: at };
  }

  /** One item change; the same change twice changes nothing. @req FR:pr-review-lane/lane.items */
  async item(r: PrRef, op: ItemOp, o: { id?: string; text?: string; reason?: string; by: string }): Promise<{ changed: boolean; item: LiveItem }> {
    if (!(ITEM_OPS as readonly string[]).includes(op)) throw new LiveError('usage', `unknown item op: ${op} (use ${ITEM_OPS.join(', ')})`);
    if (!BY.test(o.by)) throw new LiveError('usage', '--by is owner or an agent name');
    const text = o.text === undefined ? undefined : line(o.text);
    if (o.text !== undefined && !text) throw new LiveError('usage', '--text is one line, 1-300 characters');
    const reason = o.reason === undefined ? undefined : line(o.reason);
    if (['add', 'comment', 'edit'].includes(op) && !text) throw new LiveError('usage', `${op} needs --text`);
    if (op === 'block' && !reason) throw new LiveError('usage', 'block needs --reason');
    if (op !== 'add' && !o.id) throw new LiveError('usage', `${op} needs an item id`);
    return this.write((d) => {
      const a = this.activeFor(d, r);
      const list = d.lists[refKey(a)] ?? (d.lists[refKey(a)] = []);
      if (op === 'add') { const it = this.newItem(text!, o.by); list.push(it); return { changed: true, out: { changed: true, item: it } }; }
      const it = list.find((i) => i.id === o.id);
      if (!it) throw new LiveError('notfound', `no item ${o.id} on ${refText(a)}`);
      const before = JSON.stringify(it);
      const STATE: Partial<Record<ItemOp, ItemState>> = { check: 'passed', uncheck: 'open', fail: 'failed', 'needs-fix': 'needs-fix', fixed: 'fixed-pending-revalidation', block: 'blocked' };
      if (STATE[op]) it.state = STATE[op]!;
      if (op === 'block') it.reason = reason; else if (STATE[op]) delete it.reason;
      if (op === 'comment' || (op === 'needs-fix' && text)) it.comment = text;
      if (op === 'edit') it.text = text!;
      const changed = JSON.stringify(it) !== before;
      if (changed) { it.updatedAt = this.now(); it.updatedBy = o.by; }
      return { changed, out: { changed, item: it } };
    });
  }

  /** Done, free our lock, and make the next PR active at once. @req FR:pr-review-lane/lane.resolve */
  async resolve(r: PrRef, reason: string, pick: Pick, info?: PrInfo): Promise<{ done: DonePr; next?: ActivePr }> {
    if (!(DONE_REASONS as readonly string[]).includes(reason)) throw new LiveError('usage', `--reason is ${DONE_REASONS.join(', ')}`);
    const cfg = this.config();
    const done = await this.write((d) => {
      const a = this.activeFor(d, r);
      const lock = readLock(cfg.lockPath);
      if (lock && lock.owner === laneOwner(a) && existsSync(cfg.lockPath)) { try { unlinkSync(cfg.lockPath); } catch { /* gone */ } }
      const entry: DonePr = { repo: a.repo, number: a.number, url: a.url, at: this.now(), reason };
      d.done = [entry, ...d.done.filter((x) => refKey(x) !== refKey(a))].slice(0, 50);
      delete d.lists[refKey(a)];
      delete d.active;
      return { changed: true, out: entry };
    });
    const target = await pick();
    if (!target || isExcluded(target, cfg.exclude)) return { done };
    const next = await this.write((d) => {
      if (d.active) return { changed: false, out: d.active };
      d.active = { repo: target.repo, number: target.number, url: target.url, ...infoOf(info, target), state: 'preparing', claimedAt: this.now() };
      return { changed: true, out: d.active };
    });
    return { done, next };
  }

  /** Blocked items of the live PR as Needs-you entries. @req FR:pr-review-lane/lane.needs */
  needs(): Need[] {
    const v = this.view();
    if (!v.active) return [];
    return v.items.filter((i) => i.state === 'blocked').map((i) => ({ id: `lv.${i.id}`, title: `Live check blocked: ${i.text}`.slice(0, 200), recommendation: i.reason ?? 'Open the PR and decide', link: v.active!.url, project: v.active!.repo }));
  }

  /** `go` or `reply` reopens the blocked item; the reply becomes its comment. @req FR:pr-review-lane/lane.needs */
  async answerNeed(id: string, input: NeedAnswerInput): Promise<boolean> {
    const itemId = id.replace(/^lv\./, '');
    return this.write((d) => {
      const list = d.active ? d.lists[refKey(d.active)] ?? [] : [];
      const it = list.find((i) => i.id === itemId);
      if (!it) throw new LiveError('notfound', `no live item ${itemId}`);
      // Only a blocked item reopens: a stale answer never undoes a pass.
      if (it.state !== 'blocked' || (input.choice !== 'go' && input.choice !== 'reply')) return { changed: false, out: false };
      it.state = 'open'; delete it.reason;
      if (input.choice === 'reply' && input.text) it.comment = input.text.replace(/[\r\n]+/g, ' ').slice(0, 300);
      it.updatedAt = this.now(); it.updatedBy = 'owner';
      return { changed: true, out: true };
    });
  }
}
