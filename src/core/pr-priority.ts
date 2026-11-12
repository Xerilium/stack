/**
 * The owner's PR priority queue for the Sweep Manager, agent recommendations with the owner's decisions, merge-order
 * edges, thread acks and the escalation set. Live state under ~/.stack, never git. No LLM call; no GitHub write.
 * @req FR:pr-priority/$item @req FR:pr-priority/$rec @req FR:pr-priority/queue.model @req FR:pr-priority/rec.model
 */
import { randomBytes } from 'crypto';
import { mkdirSync, readFileSync, renameSync, unwatchFile, watchFile } from 'fs';
import { join } from 'path';
import { withFileLock, writeAtomic, type LockOptions } from './file-lock';
import type { Issue } from './reports';
import type { Need } from './needs-you';

export const PR_PRI_LIMITS = { items: 100, recs: 500, edges: 10, acks: 20, history: 20, rejectDays: 14, keepDays: 90, refresh: 4 } as const;
export const REC_STATES = ['open', 'accepted', 'edited', 'rejected'] as const;
export const DECISIONS = ['accept', 'edit', 'reject'] as const;
export const MOVE_TO = ['top', 'up', 'down'] as const;
export const QUEUE_OPS = ['add', 'move', 'pin', 'unpin', 'remove', 'undo', 'ack'] as const;
export const ESC_STATUSES = ['approve', 'review', 'decide', 'unblock'] as const;
export const RECORD_STATES = ['processing', 'waiting-on-me', 'blocked-on-me', 'pending', 'paused'] as const;
export const RECORD_OWNERS = ['Michael', 'Roland', 'CI', 'runner', 'none'] as const;
export const REC_PROJECTS = ['allyte', 'ftk', 'focus', 'f4', 'xerilium', 'other'] as const;

const REPO = /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/;
const URL_RE = /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100})\/pull\/(\d{1,7})(?:[/?#].*)?$/;
const AGENT = /^[a-z0-9][a-z0-9-]{0,39}$/;
const BAD_CHARS = new RegExp('[\\p{Cc}\\u0085\\u2028\\u2029]|(?!\\u200d)\\p{Cf}', 'u');
const DAY = 864e5;

export interface PrRef { repo: string; number: number }
export interface PrPriItem { rank: number; repo: string; number: number; url: string; pinned: boolean; note?: string; by: string; at: string }
export interface PrPriFile { version: 1; rev: number; updatedAt?: string; items: PrPriItem[] }
export type RecState = (typeof REC_STATES)[number];
export type Decision = (typeof DECISIONS)[number];
export interface PrRec {
  id: string; repo: string; number: number; url: string; agent: string; reason: string; toRank?: number; state: RecState; at: string;
  decision?: { at: string; reason?: string; rank?: number; note?: string };
}
export interface PrAck { thread: string; note: string; at: string }
export interface PrFacts {
  title?: string; author?: string; isDraft?: boolean; assignee?: string | null; labels?: string[]; reviewDecision?: string | null;
  checks?: 'green' | 'red' | 'pending'; mergeable?: string; lastPushAt?: string; headSha?: string; factsAt?: string;
}
/** The SM's record for one PR. @req FR:pr-priority/record.model */
export interface PrRecord {
  state: (typeof RECORD_STATES)[number]; ts: string; owner?: (typeof RECORD_OWNERS)[number]; worker?: string;
  blocker?: { text: string; threadUrl?: string }; nextAction?: string; headSha?: string; humanOnly?: boolean; bucket?: (typeof ESC_STATUSES)[number];
}
export interface Escalations {
  blockedAutopilot: { pr: string; status: (typeof ESC_STATUSES)[number]; exactBlocker: string; context: string; recommendedAnswer: string }[];
  enableAutopilot: { pr: string; whyEasy: string }[];
  liveValidation: { pr: string; why: string }[];
  at?: string;
}
export interface PrPriState {
  version: 1; recs: PrRec[]; deps: Record<string, string[]>; acks: Record<string, PrAck[]>; records: Record<string, PrRecord>; escalations?: Escalations;
  facts: Record<string, PrFacts>; history: { items: PrPriItem[]; at: string }[];
}
export type Blocked = { kind: 'queued'; rank: number } | { kind: 'rejected'; id: string; reason: string; at: string } | { kind: 'excluded' };
export type RecommendResult = { created: boolean; rec: PrRec } | { blocked: Blocked };
export type QueueOp =
  | { op: 'add'; ref: string; rank?: number; note?: string }
  | { op: 'move'; ref: string; to: (typeof MOVE_TO)[number] | number; note?: string }
  | { op: 'pin' | 'unpin' | 'remove'; ref: string }
  | { op: 'undo' };
/** One row of the list view: the queue item plus facts, edges, decisions, the newest report record, acks and status. @req FR:pr-priority/view.item */
export interface PrPriView extends PrPriItem, PrFacts {
  pr: number; baseStack: string[]; why?: string; michaelDecision?: { state: RecState; reason?: string; at: string };
  report?: PrRecord & { stale: boolean }; acks: PrAck[]; status?: (typeof ESC_STATUSES)[number];
}

/** One line on why a recommendation is blocked. @req FR:pr-priority/cli.recommend @req FR:pr-priority/api.recommend */
export function blockedText(b: Blocked): string {
  return b.kind === 'rejected' ? `rejected ${b.at} by owner: ${b.reason} (${b.id})` : b.kind === 'queued' ? `already queued at rank ${b.rank}` : 'excluded by config';
}

/** Bad input; `issues` lists every problem. */
export class PrPriInvalid extends Error {
  constructor(readonly issues: Issue[]) { super(issues.map((i) => `${i.field}: ${i.message}`).join('; ')); }
}
/** A stale `rev`, or another decision on a decided recommendation. */
export class PrPriConflict extends Error {}
/** The PR is not queued, or the recommendation id is unknown. */
export class PrPriNotFound extends Error {}
/** Another writer held `pr-priority.lock` too long. */
export class PrPriBusy extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const keyOf = (repo: string, n: number) => `${repo.toLowerCase()}#${n}`;
export const prUrl = (repo: string, n: number): string => `https://github.com/${repo}/pull/${n}`;

/** `<owner>/<name>#<n>` or a GitHub PR url. @req FR:pr-priority/queue.ref */
export function parsePrRef(s: string, field = 'ref'): PrRef {
  const t = typeof s === 'string' ? s.trim() : '';
  const u = URL_RE.exec(t);
  const m = u ? [t, u[1], u[2]] : /^([^#\s]+)#(\d{1,7})$/.exec(t);
  if (!m || !REPO.test(m[1]) || Number(m[2]) < 1) throw new PrPriInvalid([{ field, message: 'Must be <owner>/<name>#<n> or a GitHub PR url' }]);
  return { repo: m[1], number: Number(m[2]) };
}
const prUrlOk = (v: unknown): v is string => { const m = typeof v === 'string' ? /^https:\/\/github\.com\/([^/]+\/[^/]+)\/pull\/\d{1,7}$/.exec(v) : null; return !!m && REPO.test(m[1]); };

const line = (v: unknown, max: number): string | undefined => {
  if (typeof v !== 'string' || BAD_CHARS.test(v)) return undefined;
  const t = v.trim();
  return t && t.length <= max ? t : undefined;
};
const httpsUrl = (v: unknown): v is string => { if (typeof v !== 'string' || v.length > 2000 || /\s/.test(v) || BAD_CHARS.test(v)) return false; try { return new URL(v).protocol === 'https:'; } catch { return false; } };

/** The project of a repo, for ordering recommendations. @req FR:pr-priority/rec.order */
export function repoProject(repo: string): (typeof REC_PROJECTS)[number] {
  const [owner, name] = repo.split('/');
  if (/^allytehq$/i.test(owner) || /^(finops-hubs|allyte)/i.test(name)) return 'allyte';
  if (/^finops-toolkit/i.test(name)) return 'ftk';
  if (/^focus/i.test(name)) return 'focus';
  if (/^f4/i.test(name)) return 'f4';
  if (/^xerilium$/i.test(owner) || /^(stack|catalyst|printer|prime|todo)/i.test(name)) return 'xerilium';
  return 'other';
}

const STOP = new Set(['the', 'and', 'for', 'this', 'that', 'with', 'from', 'are', 'was', 'has', 'have', 'its', 'into', 'but', 'not', 'now', 'should', 'would', 'could', 'will', 'please', 'very', 'more', 'than', 'then', 'also', 'just']);
const words = (s: string) => new Set(s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)).map((w) => w.replace(/(ing|ed|er|es|s)$/, '')));
/** Two reasons are similar when shared stemmed words are at least 60% of the smaller set. @req FR:pr-priority/rec.memory */
export function similarReason(a: string, b: string): boolean {
  const x = words(a); const y = words(b);
  if (!x.size || !y.size) return !x.size && !y.size;
  let shared = 0; for (const w of x) if (y.has(w)) shared++;
  return shared / Math.min(x.size, y.size) >= 0.6;
}

/** PR facts from `gh pr view --json ...`. @req FR:pr-priority/view.refresh */
export function parseFacts(raw: unknown): PrFacts {
  const r = isObj(raw) ? raw : {};
  const s = (v: unknown) => (typeof v === 'string' ? v : undefined);
  const login = (v: unknown) => (isObj(v) ? s(v.login) : undefined);
  const out: PrFacts = {};
  if (s(r.title) !== undefined) out.title = s(r.title);
  if (login(r.author)) out.author = login(r.author);
  if (typeof r.isDraft === 'boolean') out.isDraft = r.isDraft;
  if (Array.isArray(r.assignees)) out.assignee = login(r.assignees[0]) ?? null;
  if (Array.isArray(r.labels)) out.labels = r.labels.map((l) => (isObj(l) ? s(l.name) : undefined)).filter((x): x is string => !!x);
  if ('reviewDecision' in r) out.reviewDecision = s(r.reviewDecision) || null;
  if (Array.isArray(r.statusCheckRollup)) {
    const c = r.statusCheckRollup.filter(isObj);
    const red = c.some((x) => ['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ACTION_REQUIRED', 'STARTUP_FAILURE', 'ERROR'].includes(String(x.conclusion ?? x.state ?? '')));
    const pending = c.some((x) => ('status' in x ? x.status !== 'COMPLETED' : ['PENDING', 'EXPECTED'].includes(String(x.state))));
    out.checks = red ? 'red' : pending ? 'pending' : 'green';
  }
  if (s(r.mergeable)) out.mergeable = s(r.mergeable);
  if (s(r.headRefOid)) out.headSha = s(r.headRefOid);
  if (Array.isArray(r.commits)) {
    const d = r.commits.map((c) => (isObj(c) ? s(c.committedDate) : undefined)).filter((x): x is string => !!x).sort();
    if (d.length) out.lastPushAt = d[d.length - 1];
  }
  return out;
}

/** Checks a whole escalation set. @req FR:pr-priority/edge.escalate */
export function parseEscalations(body: unknown): Escalations {
  const issues: Issue[] = [];
  if (!isObj(body)) throw new PrPriInvalid([{ field: 'body', message: 'Must be a JSON object' }]);
  for (const k of Object.keys(body)) if (!['blockedAutopilot', 'enableAutopilot', 'liveValidation'].includes(k)) issues.push({ field: k, message: 'Unknown field' });
  const list = <T>(name: string, max: number, fields: string[], extra: (o: Record<string, unknown>, f: string) => Partial<T> | undefined): T[] => {
    const v = body[name];
    if (v === undefined) return [];
    if (!Array.isArray(v)) { issues.push({ field: name, message: 'Must be an array' }); return []; }
    if (v.length > max) { issues.push({ field: name, message: `At most ${max} items` }); return []; }
    return v.flatMap((o, i) => {
      const f = `${name}[${i}]`;
      if (!isObj(o)) { issues.push({ field: f, message: 'Must be an object' }); return []; }
      const n = issues.length;
      for (const k of Object.keys(o)) if (!['pr', ...fields].includes(k)) issues.push({ field: `${f}.${k}`, message: 'Unknown field' });
      if (!prUrlOk(o.pr)) issues.push({ field: `${f}.pr`, message: 'Must be a GitHub PR url' });
      const out: Record<string, unknown> = { pr: o.pr };
      for (const k of fields) {
        if (k === 'status') continue;
        const t = line(o[k], 200);
        if (!t) issues.push({ field: `${f}.${k}`, message: 'Must be one line of 1-200 characters' }); else out[k] = t;
      }
      Object.assign(out, extra(o, f) ?? {});
      return issues.length === n ? [out as T] : [];
    });
  };
  const blockedAutopilot = list<Escalations['blockedAutopilot'][number]>('blockedAutopilot', 3, ['status', 'exactBlocker', 'context', 'recommendedAnswer'], (o, f) => {
    if (!(ESC_STATUSES as readonly unknown[]).includes(o.status)) { issues.push({ field: `${f}.status`, message: `Must be one of ${ESC_STATUSES.join(', ')}` }); return undefined; }
    return { status: o.status as (typeof ESC_STATUSES)[number] };
  });
  const enableAutopilot = list<Escalations['enableAutopilot'][number]>('enableAutopilot', 3, ['whyEasy'], () => undefined);
  const liveValidation = list<Escalations['liveValidation'][number]>('liveValidation', 1, ['why'], () => undefined);
  if (issues.length) throw new PrPriInvalid(issues);
  // Keep a fixed key order so readers see a stable shape.
  return {
    blockedAutopilot: blockedAutopilot.map((x) => ({ pr: x.pr, status: x.status, exactBlocker: x.exactBlocker, context: x.context, recommendedAnswer: x.recommendedAnswer })),
    enableAutopilot: enableAutopilot.map((x) => ({ pr: x.pr, whyEasy: x.whyEasy })), liveValidation: liveValidation.map((x) => ({ pr: x.pr, why: x.why })),
  };
}

/** Checks one SM record. @req FR:pr-priority/record.model */
export function parseRecord(body: unknown): PrRecord {
  if (!isObj(body)) throw new PrPriInvalid([{ field: 'body', message: 'Must be a JSON object' }]);
  const issues: Issue[] = [];
  const bad = (field: string, message: string) => { issues.push({ field, message }); };
  for (const k of Object.keys(body)) if (!['state', 'ts', 'owner', 'worker', 'blocker', 'nextAction', 'headSha', 'humanOnly', 'bucket'].includes(k)) bad(k, 'Unknown field');
  const oneOf = (k: string, values: readonly string[], required = false) => {
    const v = body[k];
    if (v === undefined) { if (required) bad(k, 'Required'); return; }
    if (!values.includes(v as string)) bad(k, `Must be one of ${values.join(', ')}`);
  };
  oneOf('state', RECORD_STATES, true); oneOf('owner', RECORD_OWNERS); oneOf('bucket', ESC_STATUSES);
  if (typeof body.ts !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(body.ts) || Number.isNaN(Date.parse(body.ts))) bad('ts', 'Must be an ISO date-time');
  if (body.worker !== undefined && (typeof body.worker !== 'string' || !AGENT.test(body.worker))) bad('worker', 'Must match [a-z0-9][a-z0-9-]{0,39}');
  if (body.nextAction !== undefined && !line(body.nextAction, 200)) bad('nextAction', 'Must be one line of 1-200 characters');
  if (body.headSha !== undefined && (typeof body.headSha !== 'string' || !/^[0-9a-f]{7,40}$/i.test(body.headSha))) bad('headSha', 'Must be 7-40 hex characters');
  if (body.humanOnly !== undefined && typeof body.humanOnly !== 'boolean') bad('humanOnly', 'Must be true or false');
  let blocker: PrRecord['blocker'];
  if (body.blocker !== undefined) {
    const b = body.blocker;
    if (!isObj(b)) bad('blocker', 'Must be an object {text, threadUrl?}');
    else {
      for (const k of Object.keys(b)) if (k !== 'text' && k !== 'threadUrl') bad(`blocker.${k}`, 'Unknown field');
      const t = line(b.text, 200);
      if (!t) bad('blocker.text', 'Must be one line of 1-200 characters');
      if (b.threadUrl !== undefined && !httpsUrl(b.threadUrl)) bad('blocker.threadUrl', 'Must be an https url');
      if (t) blocker = { text: t, ...(httpsUrl(b.threadUrl) ? { threadUrl: b.threadUrl } : {}) };
    }
  }
  if (issues.length) throw new PrPriInvalid(issues);
  return {
    state: body.state as PrRecord['state'], ts: body.ts as string, ...(body.owner ? { owner: body.owner as PrRecord['owner'] } : {}), ...(body.worker ? { worker: body.worker as string } : {}),
    ...(blocker ? { blocker } : {}), ...(body.nextAction ? { nextAction: line(body.nextAction, 200)! } : {}), ...(body.headSha ? { headSha: body.headSha as string } : {}),
    ...(typeof body.humanOnly === 'boolean' ? { humanOnly: body.humanOnly } : {}), ...(body.bucket ? { bucket: body.bucket as PrRecord['bucket'] } : {}),
  };
}

const EMPTY_STATE = (): PrPriState => ({ version: 1, recs: [], deps: {}, acks: {}, records: {}, facts: {}, history: [] });

function validItems(v: unknown): PrPriItem[] | undefined {
  if (!Array.isArray(v) || v.length > PR_PRI_LIMITS.items) return undefined;
  const seen = new Set<string>();
  for (const [i, x] of v.entries()) {
    if (!isObj(x) || x.rank !== i + 1 || typeof x.repo !== 'string' || !REPO.test(x.repo) || !Number.isInteger(x.number) || typeof x.by !== 'string' || typeof x.at !== 'string') return undefined;
    const k = keyOf(x.repo, x.number as number);
    if (seen.has(k)) return undefined;
    seen.add(k);
  }
  return (v as PrPriItem[]).map((x) => ({ ...x, pinned: x.pinned === true, url: prUrl(x.repo, x.number) }));
}

/**
 * The PR priority store: `<dir>/pr-priority.json` (the queue, the SM's lean contract) and `<dir>/pr-priority-state.json`
 * (recommendations, edges, acks, escalations, facts, history), written atomically under `pr-priority.lock`.
 * @req FR:pr-priority/queue.write
 */
export class PrPriorityStore {
  readonly file: string;
  readonly stateFile: string;
  readonly configFile: string;
  private readonly listeners = new Set<() => void>();
  constructor(readonly dir: string, private readonly o: LockOptions & { now?: () => Date } = {}) {
    this.file = join(dir, 'pr-priority.json'); this.stateFile = join(dir, 'pr-priority-state.json'); this.configFile = join(dir, 'pr-priority.config.json');
  }
  private now(): string { return (this.o.now ?? (() => new Date()))().toISOString(); }

  private loadQueue(): { data: PrPriFile; broken?: boolean } {
    let t: string;
    try { t = readFileSync(this.file, 'utf8'); } catch { return { data: { version: 1, rev: 0, items: [] } }; }
    try {
      const j = JSON.parse(t) as Record<string, unknown>;
      const items = isObj(j) && Number.isInteger(j.rev) && (j.rev as number) >= 0 ? validItems(j.items) : undefined;
      if (items) return { data: { version: 1, rev: j.rev as number, ...(typeof j.updatedAt === 'string' ? { updatedAt: j.updatedAt } : {}), items } };
    } catch { /* broken */ }
    return { data: { version: 1, rev: 0, items: [] }, broken: true };
  }
  private loadState(): { data: PrPriState; broken?: boolean } {
    let t: string;
    try { t = readFileSync(this.stateFile, 'utf8'); } catch { return { data: EMPTY_STATE() }; }
    try {
      const j = JSON.parse(t) as Partial<PrPriState>;
      if (isObj(j) && Array.isArray(j.recs)) {
        const e = EMPTY_STATE();
        return { data: { ...e, recs: j.recs, deps: isObj(j.deps) ? j.deps as PrPriState['deps'] : {}, acks: isObj(j.acks) ? j.acks as PrPriState['acks'] : {}, records: isObj(j.records) ? j.records as PrPriState['records'] : {}, facts: isObj(j.facts) ? j.facts as PrPriState['facts'] : {}, history: Array.isArray(j.history) ? j.history : [], ...(isObj(j.escalations) ? { escalations: j.escalations as Escalations } : {}) } };
      }
    } catch { /* broken */ }
    return { data: EMPTY_STATE(), broken: true };
  }

  /** The queue, or an empty queue at rev 0 when none or broken. @req FR:pr-priority/queue.broken */
  read(): PrPriFile { return this.loadQueue().data; }
  /** Recommendations, edges, acks, escalations, facts and history. */
  state(): PrPriState { return this.loadState().data; }
  /** Excluded PR keys from `pr-priority.config.json`; none when missing or broken. @req FR:pr-priority/queue.exclude */
  excluded(): Set<string> {
    try {
      const j = JSON.parse(readFileSync(this.configFile, 'utf8')) as { exclude?: unknown };
      return new Set((Array.isArray(j.exclude) ? j.exclude : []).flatMap((r) => { try { const p = parsePrRef(String(r)); return [keyOf(p.repo, p.number)]; } catch { return []; } }));
    } catch { return new Set(); }
  }
  /** The queue rank of a PR, or null. @req FR:pr-priority/api.pr */
  rankOf(repo: string, n: number): number | null { return this.read().items.find((i) => keyOf(i.repo, i.number) === keyOf(repo, n))?.rank ?? null; }

  /** Hears each successful write in this process. */
  onWrite(fn: () => void): () => void { this.listeners.add(fn); return () => { this.listeners.delete(fn); }; }
  /** Hears writes by other processes (the CLI) by polling both files; returns a stop function. */
  watch(fn: () => void, intervalMs = 2000): () => void {
    const h = () => fn();
    for (const f of [this.file, this.stateFile]) watchFile(f, { persistent: false, interval: intervalMs }, h);
    return () => { for (const f of [this.file, this.stateFile]) unwatchFile(f, h); };
  }
  private told(): void { for (const fn of this.listeners) { try { fn(); } catch { /* a listener never fails a write */ } } }

  /** Runs `fn` under the lock with fresh data; writes what `fn` marks changed. Broken files are moved aside first. */
  private async tx<T>(fn: (q: PrPriFile, s: PrPriState, mark: { queue: boolean; state: boolean }) => T): Promise<T> {
    const out = await withFileLock(this.dir, 'pr-priority.lock', () => {
      const q = this.loadQueue(); const s = this.loadState();
      const mark = { queue: false, state: false };
      const r = fn(q.data, s.data, mark);
      if (!mark.queue && !mark.state) return { r, wrote: false };
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      if (q.broken) renameSync(this.file, `${this.file}.broken-${Date.now()}`);
      if (s.broken) renameSync(this.stateFile, `${this.stateFile}.broken-${Date.now()}`);
      if (mark.queue) {
        q.data.rev += 1; q.data.updatedAt = this.now();
        writeAtomic(this.file, `${JSON.stringify(q.data, null, 2)}\n`);
      }
      if (mark.state || s.broken) { this.prune(s.data); writeAtomic(this.stateFile, `${JSON.stringify(s.data, null, 2)}\n`); }
      return { r, wrote: true };
    }, () => new PrPriBusy('PR priority store is busy (pr-priority.lock); try again'), this.o);
    if (out.wrote) this.told();
    return out.r;
  }

  /** @req FR:pr-priority/rec.prune */
  private prune(s: PrPriState): void {
    const cut = Date.parse(this.now()) - PR_PRI_LIMITS.keepDays * DAY;
    s.recs = s.recs.filter((r) => r.state === 'open' || Date.parse(r.decision?.at ?? r.at) >= cut)
      .sort((a, b) => (b.decision?.at ?? b.at).localeCompare(a.decision?.at ?? a.at)).slice(0, PR_PRI_LIMITS.recs);
  }

  /**
   * One queue action: add, move, pin, unpin, remove or undo. Idempotent; returns `changed` and the new queue.
   * @req FR:pr-priority/queue.add @req FR:pr-priority/queue.move @req FR:pr-priority/queue.pin @req FR:pr-priority/queue.remove
   * @req FR:pr-priority/queue.idem @req FR:pr-priority/queue.undo @req FR:pr-priority/queue.write @req FR:pr-priority/queue.exclude
   */
  async edit(op: QueueOp, o: { rev?: number } = {}): Promise<{ changed: boolean; queue: PrPriFile }> {
    const ref = op.op === 'undo' ? undefined : parsePrRef(op.ref);
    if ('note' in op && op.note !== undefined && !line(op.note, 300)) throw new PrPriInvalid([{ field: 'note', message: 'Must be one line of 1-300 characters' }]);
    const excluded = this.excluded();
    return this.tx((q, s, mark) => {
      if (o.rev !== undefined && o.rev !== q.rev) throw new PrPriConflict(`PR priorities changed (rev ${q.rev}); reload and try again`);
      const before = q.items.map((i) => ({ ...i }));
      let changed: boolean;
      if (op.op === 'undo') {
        const h = s.history.shift();
        if (!h) return { changed: false, queue: q };
        q.items = h.items;
        changed = true;
      } else {
        changed = this.apply(q, op, ref!, 'owner', excluded);
        if (op.op === 'remove' && changed) { const k = keyOf(ref!.repo, ref!.number); delete s.deps[k]; for (const [a, list] of Object.entries(s.deps)) s.deps[a] = list.filter((x) => x !== k); }
        if (changed) s.history = [{ items: before, at: this.now() }, ...s.history].slice(0, PR_PRI_LIMITS.history);
      }
      if (changed) { mark.queue = true; mark.state = true; }
      return { changed, queue: q };
    });
  }

  /** Applies one action to `q`; true when the order, a note or a pin changed. */
  private apply(q: PrPriFile, op: Exclude<QueueOp, { op: 'undo' }>, ref: PrRef, by: string, excluded: Set<string>): boolean {
    const k = keyOf(ref.repo, ref.number);
    const idx = q.items.findIndex((i) => keyOf(i.repo, i.number) === k);
    const cur = idx >= 0 ? q.items[idx] : undefined;
    const sig = () => JSON.stringify(q.items.map((i) => [i.repo, i.number, i.pinned, i.note]));
    const was = sig();
    if (op.op !== 'remove' && excluded.has(k)) throw new PrPriInvalid([{ field: 'ref', message: 'This PR is excluded by pr-priority.config.json' }]);
    const place = (item: PrPriItem, target: (rest: PrPriItem[], pinnedCount: number, from: number) => number) => {
      const from = q.items.indexOf(item);
      const rest = q.items.filter((i) => i !== item);
      const p = rest.filter((i) => i.pinned).length;
      const [lo, hi] = item.pinned ? [0, p] : [p, rest.length];
      const t = Math.min(hi, Math.max(lo, target(rest, p, from)));
      rest.splice(t, 0, item);
      q.items = rest;
    };
    const setNote = (item: PrPriItem, note?: string) => { if (note !== undefined) item.note = line(note, 300)!; };
    switch (op.op) {
      case 'add': {
        if (cur) {
          setNote(cur, op.note);
          if (op.rank !== undefined) place(cur, () => op.rank! - 1);
          break;
        }
        if (q.items.length >= PR_PRI_LIMITS.items) throw new PrPriInvalid([{ field: 'items', message: `At most ${PR_PRI_LIMITS.items} PRs` }]);
        const item: PrPriItem = { rank: 0, repo: ref.repo, number: ref.number, url: prUrl(ref.repo, ref.number), pinned: false, ...(op.note ? { note: line(op.note, 300)! } : {}), by, at: this.now() };
        q.items.push(item);
        place(item, (_r, p) => (op.rank === undefined ? p : op.rank - 1));
        break;
      }
      case 'move': {
        if (!cur) throw new PrPriNotFound(`Not queued: ${prUrl(ref.repo, ref.number)}`);
        setNote(cur, op.note);
        place(cur, (_r, p, from) => (op.to === 'top' ? (cur.pinned ? 0 : p) : op.to === 'up' ? from - 1 : op.to === 'down' ? from + 1 : op.to - 1));
        break;
      }
      case 'pin': case 'unpin': {
        if (!cur) throw new PrPriNotFound(`Not queued: ${prUrl(ref.repo, ref.number)}`);
        if (cur.pinned === (op.op === 'pin')) break;
        cur.pinned = op.op === 'pin';
        // Pin goes to the last pinned place; unpin to the top of the unpinned items: both are index p.
        place(cur, (_r, p) => p);
        break;
      }
      case 'remove':
        if (cur) q.items = q.items.filter((i) => i !== cur);
        break;
    }
    const changed = sig() !== was;
    if (changed && cur && op.op !== 'remove') cur.at = this.now();
    q.items.forEach((i, n) => { i.rank = n + 1; });
    return changed;
  }

  /** Records the owner's ack on a hold thread. @req FR:pr-priority/edge.ack */
  async ack(refText: string, thread: string, note: string): Promise<{ changed: boolean }> {
    const ref = parsePrRef(refText);
    const issues: Issue[] = [];
    if (!httpsUrl(thread)) issues.push({ field: 'thread', message: 'Must be an https url' });
    const n = line(note, 300);
    if (!n) issues.push({ field: 'note', message: 'Must be one line of 1-300 characters' });
    if (issues.length) throw new PrPriInvalid(issues);
    return this.tx((_q, s, mark) => {
      const k = keyOf(ref.repo, ref.number);
      const list = s.acks[k] ?? [];
      const prior = list.find((a) => a.thread === thread);
      if (prior?.note === n) return { changed: false };
      s.acks[k] = [{ thread, note: n!, at: this.now() }, ...list.filter((a) => a.thread !== thread)].slice(0, PR_PRI_LIMITS.acks);
      mark.state = true;
      return { changed: true };
    });
  }

  /** Adds (or with `remove` drops) the edge "ref merges after on". @req FR:pr-priority/edge.depends */
  async depends(refText: string, onText: string, remove = false): Promise<{ changed: boolean }> {
    return this.dependsMany([{ pr: refText, on: onText }], remove);
  }

  /** Adds (or drops) many edges `[{pr, on}]`, all or none. @req FR:pr-priority/edge.depends */
  async dependsMany(edges: unknown, remove = false): Promise<{ changed: boolean; count: number }> {
    if (!Array.isArray(edges) || !edges.length || edges.length > 200) throw new PrPriInvalid([{ field: 'edges', message: 'Must be an array of 1-200 {pr, on}' }]);
    const issues: Issue[] = [];
    const pairs = edges.flatMap((e, i): [string, string][] => {
      const f = `edges[${i}]`;
      if (!isObj(e) || Object.keys(e).some((k) => k !== 'pr' && k !== 'on')) { issues.push({ field: f, message: 'Must be an object {pr, on}' }); return []; }
      try {
        const a = parsePrRef(String(e.pr), `${f}.pr`); const b = parsePrRef(String(e.on), `${f}.on`);
        const ka = keyOf(a.repo, a.number); const kb = keyOf(b.repo, b.number);
        if (ka === kb) { issues.push({ field: `${f}.on`, message: 'A PR cannot depend on itself' }); return []; }
        return [[ka, kb]];
      } catch (x) { if (x instanceof PrPriInvalid) { issues.push(...x.issues); return []; } throw x; }
    });
    if (issues.length) throw new PrPriInvalid(issues);
    return this.tx((_q, st, mark) => {
      const s = { ...st, deps: Object.fromEntries(Object.entries(st.deps).map(([k, v]) => [k, [...v]])) };
      let n = 0;
      for (const [ka, kb] of pairs) if (this.edge(s, ka, kb, remove)) n++;
      if (n) { st.deps = s.deps; mark.state = true; }
      return { changed: n > 0, count: n };
    });
  }

  /** Applies one edge to `s.deps`; true when it changed. */
  private edge(s: Pick<PrPriState, 'deps'>, ka: string, kb: string, remove: boolean): boolean {
    const list = s.deps[ka] ?? [];
    if (remove) {
      if (!list.includes(kb)) return false;
      s.deps[ka] = list.filter((x) => x !== kb); if (!s.deps[ka].length) delete s.deps[ka];
      return true;
    }
    if (list.includes(kb)) return false;
    if (list.length >= PR_PRI_LIMITS.edges) throw new PrPriInvalid([{ field: 'on', message: `At most ${PR_PRI_LIMITS.edges} edges per PR` }]);
    // A path from `on` back to `ref` would make a cycle.
    const seen = new Set<string>(); const stack = [kb];
    while (stack.length) { const x = stack.pop()!; if (x === ka) throw new PrPriInvalid([{ field: 'on', message: 'This edge makes a cycle' }]); if (!seen.has(x)) { seen.add(x); stack.push(...(s.deps[x] ?? [])); } }
    s.deps[ka] = [...list, kb];
    return true;
  }

  /** Stores the SM record for a PR; the newest `ts` wins. @req FR:pr-priority/record.model @req FR:pr-priority/record.latest */
  async record(refText: string, body: unknown): Promise<{ changed: boolean; record: PrRecord }> {
    const ref = parsePrRef(refText);
    const rec = parseRecord(body);
    return this.tx((_q, s, mark) => {
      const k = keyOf(ref.repo, ref.number);
      const cur = s.records[k];
      if (cur && Date.parse(cur.ts) > Date.parse(rec.ts)) return { changed: false, record: cur };
      if (cur && JSON.stringify(cur) === JSON.stringify(rec)) return { changed: false, record: cur };
      s.records[k] = rec; mark.state = true;
      return { changed: true, record: rec };
    });
  }

  /** Replaces the escalation set. @req FR:pr-priority/edge.escalate */
  async escalate(body: unknown): Promise<Escalations> {
    const e = parseEscalations(body);
    return this.tx((_q, s, mark) => { s.escalations = { ...e, at: this.now() }; mark.state = true; return s.escalations; });
  }

  /**
   * An agent's recommendation to raise a PR. Returns the stored (or already open) one, or why it is blocked.
   * @req FR:pr-priority/rec.put @req FR:pr-priority/rec.queued @req FR:pr-priority/rec.memory @req FR:pr-priority/queue.exclude
   */
  async recommend(input: { repo: string; number: number; agent: string; reason: string; toRank?: number }): Promise<RecommendResult> {
    const issues: Issue[] = [];
    if (typeof input.repo !== 'string' || !REPO.test(input.repo)) issues.push({ field: 'repo', message: 'Must be <owner>/<name>' });
    if (!Number.isInteger(input.number) || input.number < 1 || input.number > 9_999_999) issues.push({ field: 'number', message: 'Must be a whole number from 1 to 9999999' });
    if (typeof input.agent !== 'string' || !AGENT.test(input.agent)) issues.push({ field: 'agent', message: 'Must match [a-z0-9][a-z0-9-]{0,39}' });
    const reason = line(input.reason, 300);
    if (!reason) issues.push({ field: 'reason', message: 'Must be one line of 1-300 characters' });
    if (input.toRank !== undefined && (!Number.isInteger(input.toRank) || input.toRank < 1 || input.toRank > PR_PRI_LIMITS.items)) issues.push({ field: 'toRank', message: 'Must be a whole number from 1 to 100' });
    if (issues.length) throw new PrPriInvalid(issues);
    const k = keyOf(input.repo, input.number);
    if (this.excluded().has(k)) return { blocked: { kind: 'excluded' } };
    return this.tx((q, s, mark): RecommendResult => {
      const item = q.items.find((i) => keyOf(i.repo, i.number) === k);
      if (item && (input.toRank === undefined || item.rank <= input.toRank)) return { blocked: { kind: 'queued', rank: item.rank } };
      const cut = Date.parse(this.now()) - PR_PRI_LIMITS.rejectDays * DAY;
      const rejected = s.recs.filter((r) => r.state === 'rejected' && keyOf(r.repo, r.number) === k && Date.parse(r.decision!.at) >= cut && similarReason(r.reason, reason!))
        .sort((a, b) => b.decision!.at.localeCompare(a.decision!.at))[0];
      if (rejected) return { blocked: { kind: 'rejected', id: rejected.id, reason: rejected.decision!.reason ?? '', at: rejected.decision!.at } };
      const open = s.recs.find((r) => r.state === 'open' && keyOf(r.repo, r.number) === k);
      if (open) return { created: false, rec: open };
      const rec: PrRec = { id: `pp-${randomBytes(4).toString('hex')}`, repo: input.repo, number: input.number, url: prUrl(input.repo, input.number), agent: input.agent, reason: reason!, ...(input.toRank !== undefined ? { toRank: input.toRank } : {}), state: 'open', at: this.now() };
      s.recs.unshift(rec);
      mark.state = true;
      return { created: true, rec };
    });
  }

  /**
   * The owner's decision on a recommendation. Idempotent for the same decision.
   * @req FR:pr-priority/rec.decide @req FR:pr-priority/rec.reason @req FR:pr-priority/rec.closed
   */
  async decide(id: string, input: { decision: Decision; rank?: number; note?: string; reason?: string }): Promise<{ changed: boolean; rec: PrRec; queue: PrPriFile }> {
    const issues: Issue[] = [];
    if (!(DECISIONS as readonly string[]).includes(input.decision)) issues.push({ field: 'decision', message: `Must be one of ${DECISIONS.join(', ')}` });
    const reason = input.reason === undefined ? undefined : line(input.reason, 300);
    if (input.reason !== undefined && !reason) issues.push({ field: 'reason', message: 'Must be one line of 1-300 characters' });
    if ((input.decision === 'edit' || input.decision === 'reject') && !reason) issues.push({ field: 'reason', message: `Required for ${input.decision}` });
    if (input.note !== undefined && !line(input.note, 300)) issues.push({ field: 'note', message: 'Must be one line of 1-300 characters' });
    if (input.rank !== undefined && (!Number.isInteger(input.rank) || input.rank < 1 || input.rank > PR_PRI_LIMITS.items)) issues.push({ field: 'rank', message: 'Must be a whole number from 1 to 100' });
    if (issues.length) throw new PrPriInvalid([...new Map(issues.map((i) => [i.field, i])).values()]);
    const excluded = this.excluded();
    return this.tx((q, s, mark) => {
      const rec = s.recs.find((r) => r.id === id);
      if (!rec) throw new PrPriNotFound(`Unknown recommendation: ${id}`);
      const state: RecState = input.decision === 'accept' ? 'accepted' : input.decision === 'edit' ? 'edited' : 'rejected';
      if (rec.state !== 'open') {
        if (rec.state === state) return { changed: false, rec, queue: q };
        throw new PrPriConflict(`Recommendation ${id} is already ${rec.state}`);
      }
      const decision: NonNullable<PrRec['decision']> = { at: this.now(), ...(reason ? { reason } : {}) };
      if (state !== 'rejected') {
        const rank = input.decision === 'edit' && input.rank !== undefined ? input.rank : rec.toRank;
        const note = input.decision === 'edit' && input.note !== undefined ? line(input.note, 300)! : `${rec.agent}: ${rec.reason}`.slice(0, 300);
        const before = q.items.map((i) => ({ ...i }));
        const ref = { repo: rec.repo, number: rec.number };
        const queued = q.items.some((i) => keyOf(i.repo, i.number) === keyOf(rec.repo, rec.number));
        const changed = queued
          ? this.apply(q, rank === undefined ? { op: 'add', ref: `${rec.repo}#${rec.number}`, note } : { op: 'move', ref: `${rec.repo}#${rec.number}`, to: rank, note }, ref, rec.agent, excluded)
          : this.apply(q, { op: 'add', ref: `${rec.repo}#${rec.number}`, rank: rank ?? PR_PRI_LIMITS.items, note }, ref, rec.agent, excluded);
        if (changed) { s.history = [{ items: before, at: this.now() }, ...s.history].slice(0, PR_PRI_LIMITS.history); mark.queue = true; }
        decision.rank = q.items.find((i) => keyOf(i.repo, i.number) === keyOf(rec.repo, rec.number))!.rank;
        decision.note = note;
      }
      rec.state = state; rec.decision = decision;
      mark.state = true;
      return { changed: true, rec, queue: q };
    });
  }

  /** Open recommendations by project, then oldest first. @req FR:pr-priority/rec.order */
  openRecs(): PrRec[] {
    const p = (r: PrRec) => REC_PROJECTS.indexOf(repoProject(r.repo));
    return this.state().recs.filter((r) => r.state === 'open').sort((a, b) => p(a) - p(b) || a.at.localeCompare(b.at));
  }
  /** Decided recommendations, newest decision first. @req FR:pr-priority/rec.decisions */
  decisions(agent?: string): PrRec[] {
    return this.state().recs.filter((r) => r.state !== 'open' && (!agent || r.agent === agent)).sort((a, b) => b.decision!.at.localeCompare(a.decision!.at));
  }
  /** Open recommendations as Needs you decisions. @req FR:pr-priority/needs.list */
  needs(): Need[] {
    return this.openRecs().map((r) => ({
      id: `pp.${r.id}`, kind: 'decision', title: `Raise ${r.url} to rank ${r.toRank ?? 'last'}: ${r.reason}`.slice(0, 200),
      recommendation: 'Accept, edit, or reject with a reason', link: r.url, project: repoProject(r.repo),
      actions: [...DECISIONS], decide: `/api/pr-priority/recommendations/${r.id}`,
    }));
  }

  /**
   * The list view: queue items (excluded ones left out) with facts, edges, decisions, the SM record, acks and status.
   * @req FR:pr-priority/view.item
   */
  view(): PrPriView[] {
    const s = this.state(); const ex = this.excluded();
    const urlOf = (k: string) => { const [repo, n] = k.split('#'); return prUrl(repo, Number(n)); };
    return this.read().items.filter((i) => !ex.has(keyOf(i.repo, i.number))).map((i) => {
      const k = keyOf(i.repo, i.number);
      const recs = s.recs.filter((r) => keyOf(r.repo, r.number) === k).sort((a, b) => b.at.localeCompare(a.at));
      const dec = recs.filter((r) => r.decision).sort((a, b) => b.decision!.at.localeCompare(a.decision!.at))[0];
      const rec = s.records[k]; const facts = s.facts[k];
      const status = s.escalations?.blockedAutopilot.find((b) => b.pr.toLowerCase() === i.url.toLowerCase())?.status ?? rec?.bucket;
      // @req FR:pr-priority/record.stale: the head moved since the SM wrote its record.
      const report = rec ? { ...rec, stale: !!(facts?.headSha && rec.headSha && facts.headSha.toLowerCase() !== rec.headSha.toLowerCase()) } : undefined;
      return {
        ...i, pr: i.number, ...(facts ?? {}), baseStack: (s.deps[k] ?? []).map(urlOf),
        ...(recs[0] ? { why: recs[0].reason } : {}),
        ...(dec ? { michaelDecision: { state: dec.state, ...(dec.decision!.reason ? { reason: dec.decision!.reason } : {}), at: dec.decision!.at } } : {}),
        ...(report ? { report } : {}), acks: s.acks[k] ?? [], ...(status ? { status } : {}),
      };
    });
  }

  /** Reads facts for each queued PR (at most 4 at a time) and caches them; a PR that cannot be read keeps its prior facts. @req FR:pr-priority/view.refresh */
  async refresh(read: (repo: string, n: number) => Promise<unknown>): Promise<{ read: number; failed: number }> {
    const items = this.read().items;
    const got = new Map<string, PrFacts>();
    let failed = 0;
    for (let i = 0; i < items.length; i += PR_PRI_LIMITS.refresh) {
      await Promise.all(items.slice(i, i + PR_PRI_LIMITS.refresh).map(async (it) => {
        const raw = await read(it.repo, it.number).catch(() => null);
        if (isObj(raw)) got.set(keyOf(it.repo, it.number), { ...parseFacts(raw), factsAt: this.now() }); else failed++;
      }));
    }
    if (got.size) await this.tx((_q, s, mark) => { for (const [k, f] of got) s.facts[k] = f; mark.state = true; });
    return { read: got.size, failed };
  }
}
