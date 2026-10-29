/**
 * Live ask queue core: one markdown file per ask (`tasks/asks/<key>.md`) that agents write, the owner answers, and agents handle.
 * @req FR:ask-queue/ask.path @req FR:ask-queue/ask.format @req FR:ask-queue/ask.safe @req FR:ask-queue/ask.score @req FR:ask-queue/ask.rank
 * @req FR:ask-queue/flow.put @req FR:ask-queue/flow.answer @req FR:ask-queue/flow.handle @req FR:ask-queue/flow.default @req FR:ask-queue/flow.thread
 */
import { LifecycleError, type LifecycleContext } from './lifecycle';
import { ConflictError, NotFoundError, writeAll, type FileWrite } from './storage';
import { redact } from './triage';

export const ASK_KINDS = ['approve', 'decide', 'review', 'go-do', 'answer'] as const;
export const ASK_STATES = ['open', 'answered', 'done'] as const;
export const ASK_PRIORITIES = ['crit', 'high', 'normal', 'low'] as const;
export const ASK_ANSWERS = ['go', 'no', 'option', 'reply', 'ask', 'done', 'defer', 'retract'] as const;
export const ASK_OUTCOMES = ['handled', 'resolved', 'defaulted', 'reopen'] as const;
export const LIST_STATES = ['open', 'answered', 'done', 'snoozed', 'all'] as const;
export type AskKind = (typeof ASK_KINDS)[number];
export type AskState = (typeof ASK_STATES)[number];
export type AskPriority = (typeof ASK_PRIORITIES)[number];
export type AskAnswer = (typeof ASK_ANSWERS)[number];
export type AskOutcome = (typeof ASK_OUTCOMES)[number];

export interface Ask {
  key: string; state: AskState; ask: string; kind: AskKind; from: string;
  project?: string; why?: string; recommend?: string; options?: string[]; default?: string; by?: string;
  reversible: boolean; link?: string; priority: AskPriority; effort?: string; blocks: number;
  created: string; updated: string;
  answer?: AskAnswer; text?: string; answered?: string; outcome?: AskOutcome; handled?: string; note?: string; snoozed?: string;
  /** Free markdown under `## Detail`; shown only when the owner expands the ask. */
  detail: string;
  /** Lines under `## Thread`, as written. */
  thread: string[];
  /** Lines this version does not know; kept as is. */
  extra: string[];
}

/** What an agent may write. Owner fields are not accepted. */
export interface AskPut {
  ask?: string; kind?: AskKind; from?: string; project?: string; why?: string; recommend?: string; options?: string[]; default?: string; by?: string;
  reversible?: boolean; link?: string; priority?: AskPriority; effort?: string; blocks?: number; detail?: string; reopen?: boolean;
}
export interface AnswerInput { answer: AskAnswer; text?: string; until?: string }
export interface HandleInput { outcome: AskOutcome; note?: string; reply?: string }

export interface ListedAsk extends Omit<Ask, 'extra' | 'thread'> {
  score: number; rank?: number; overdue: boolean; snoozedUntil?: string; agentReply?: string;
}
export interface AskList { items: ListedAsk[]; total: number; latest?: string; snoozed: number }

/** Parsed asks by storage and path, reused while the file version is unchanged, so a refresh re-parses only what moved. */
const parsed = new WeakMap<object, Map<string, { version: string; ask: Ask }>>();

const MAX_ASK = 200;
const MAX_LINE = 500;
const MAX_TEXT = 1000;
const MAX_DETAIL = 20_000;
const KEY = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const FIELDS = ['state', 'ask', 'kind', 'from', 'project', 'why', 'recommend', 'options', 'default', 'by', 'reversible', 'link', 'priority', 'effort', 'blocks', 'created', 'updated', 'answer', 'text', 'answered', 'outcome', 'handled', 'note', 'snoozed'] as const;
// eslint-disable-next-line no-control-regex
const CONTROL_RUN = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]+', 'g');
const INVISIBLE = new RegExp('[\\uFE0E\\uFE0F\\u200B-\\u200F\\u2060\\uFEFF\\u00AD]', 'g');
const HEADER = '<!-- stack-ask v1. Agents write with POST /asks/<key> or `stack asks put`. Stack writes the answer; the agent reads it, acts, then handles the ask. -->';

export function asksPath(key: string): string {
  if (typeof key !== 'string' || !KEY.test(key)) throw new LifecycleError('Invalid ask key (lower case letters, digits, . _ -; up to 80)');
  return `tasks/asks/${key}.md`;
}

/** One clean line: no control or invisible characters, secrets redacted, no markdown link or html syntax. */
export function oneLine(v: string): string {
  return redact(v.replace(INVISIBLE, '')).split(CONTROL_RUN).join(' ').replace(/\[/g, '(').replace(/\]/g, ')').replace(/</g, '‹').replace(/>/g, '›').replace(/`/g, "'").replace(/\s+/g, ' ').trim();
}

const isoOk = (v: unknown): v is string => typeof v === 'string' && !Number.isNaN(Date.parse(v));
const iso = (v: string) => new Date(v).toISOString();
const isHttps = (v: string) => { try { return new URL(v).protocol === 'https:'; } catch { return false; } };
const oneOf = <T extends string>(set: readonly T[], v: unknown): v is T => typeof v === 'string' && (set as readonly string[]).includes(v);

// ---------------------------------------------------------------- format

/** The ask as markdown (v1). */
export function formatAsk(a: Ask): string {
  const f: [string, string | undefined][] = [
    ['state', a.state], ['ask', a.ask], ['kind', a.kind], ['from', a.from], ['project', a.project], ['why', a.why], ['recommend', a.recommend],
    ['options', a.options?.join(' | ')], ['default', a.default], ['by', a.by], ['reversible', a.reversible ? 'yes' : 'no'], ['link', a.link], ['priority', a.priority],
    ['effort', a.effort], ['blocks', String(a.blocks)], ['created', a.created], ['updated', a.updated],
    ['answer', a.answer], ['text', a.text], ['answered', a.answered], ['outcome', a.outcome], ['handled', a.handled], ['note', a.note], ['snoozed', a.snoozed],
  ];
  const lines = [`# Ask: ${a.key}`, '', HEADER, '', ...f.filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `- ${k}: ${v}`), ...a.extra];
  if (a.detail.trim()) lines.push('', '## Detail', '', a.detail.trim().replace(/^## /gm, '\\## '));
  if (a.thread.length) lines.push('', '## Thread', '', ...a.thread);
  return `${lines.join('\n')}\n`;
}

/** Tolerant parse: a missing field takes its default, a bad one is dropped, unknown lines are kept. */
export function parseAsk(key: string, content: string): Ask {
  const a: Ask = { key, state: 'open', ask: '', kind: 'approve', from: '', reversible: false, priority: 'normal', blocks: 0, created: '', updated: '', detail: '', thread: [], extra: [] };
  let section: 'head' | 'detail' | 'thread' = 'head';
  const detail: string[] = [];
  for (const raw of content.split('\n')) {
    const line = raw.replace(/\r$/, '');
    if (/^## Detail\s*$/.test(line)) { section = 'detail'; continue; }
    if (/^## Thread\s*$/.test(line)) { section = 'thread'; continue; }
    if (section === 'detail') { detail.push(line.replace(/^\\## /, '## ')); continue; }
    if (section === 'thread') { if (line.startsWith('- ')) a.thread.push(line); continue; }
    if (line === '' || line.startsWith('#') || line.startsWith('<!--')) continue;
    const m = /^- ([a-z]+): (.*)$/.exec(line);
    if (!m || !(FIELDS as readonly string[]).includes(m[1])) { if (line.startsWith('- ')) a.extra.push(line); continue; }
    const v = m[2].trim();
    switch (m[1]) {
      case 'state': if (oneOf(ASK_STATES, v)) a.state = v; break;
      case 'kind': if (oneOf(ASK_KINDS, v)) a.kind = v; break;
      case 'priority': if (oneOf(ASK_PRIORITIES, v)) a.priority = v; break;
      case 'answer': if (oneOf(ASK_ANSWERS, v)) a.answer = v; break;
      case 'outcome': if (oneOf(ASK_OUTCOMES, v)) a.outcome = v; break;
      case 'reversible': a.reversible = v === 'yes'; break;
      case 'blocks': if (/^\d{1,2}$/.test(v)) a.blocks = Number(v); break;
      case 'effort': if (/^\d{1,3}[mh]$/.test(v)) a.effort = v; break;
      case 'link': if (isHttps(v)) a.link = v; break;
      case 'options': a.options = v.split(' | ').map((o) => o.trim()).filter(Boolean); break;
      case 'by': case 'created': case 'updated': case 'answered': case 'snoozed': if (isoOk(v)) a[m[1]] = v; break;
      default: (a as unknown as Record<string, string>)[m[1]] = v;
    }
  }
  a.detail = detail.join('\n').trim();
  return a;
}

// ---------------------------------------------------------------- score

const WEIGHT: Record<AskPriority, number> = { crit: 100, high: 60, normal: 30, low: 10 };
const effortMinutes = (e?: string): number | null => { const m = e ? /^(\d+)([mh])$/.exec(e) : null; return m ? Number(m[1]) * (m[2] === 'h' ? 60 : 1) : null; };

/** Deterministic rank score. @req FR:ask-queue/ask.score */
export function scoreAsk(a: Ask, now: Date): number {
  let s = WEIGHT[a.priority];
  const left = a.by ? (Date.parse(a.by) - now.getTime()) / 3600_000 : null;
  if (left !== null) s += left < 0 ? 80 : left < 2 ? 70 : left < 24 ? 50 : left < 72 ? 30 : left < 168 ? 15 : 0;
  s += Math.min(20, a.blocks * 5);
  const m = effortMinutes(a.effort);
  if (m !== null && m <= 5) s += 8;
  if (!a.reversible && left !== null && left >= 0 && left < 72) s += 10;
  const days = Math.floor((now.getTime() - Date.parse(a.created || a.updated)) / 86400_000);
  if (days > 0) s += Math.min(10, days);
  return s;
}

// ---------------------------------------------------------------- io

const clock = (ctx: LifecycleContext) => (ctx.now ?? (() => new Date()))();

export async function readAsk(ctx: LifecycleContext, key: string): Promise<{ ask: Ask; version: string } | null> {
  try {
    const f = await ctx.storage.read(asksPath(key));
    return { ask: parseAsk(key, f.content), version: f.version };
  } catch (e) { if (e instanceof NotFoundError) return null; throw e; }
}

async function save(ctx: LifecycleContext, a: Ask, version: string | null, message: string): Promise<void> {
  await ctx.storage.write(asksPath(a.key), formatAsk(a), { expectedVersion: version, message });
}

/** Retries a read-modify-write when another writer got in between. */
type Step<T> = { next: Ask; message: string; result: T } | { skip: T };
async function mutate<T>(ctx: LifecycleContext, key: string, fn: (cur: { ask: Ask; version: string } | null) => Step<T>): Promise<T> {
  for (let tries = 0; ; tries++) {
    const cur = await readAsk(ctx, key);
    const r = fn(cur);
    if ('skip' in r) return r.skip;
    try { await save(ctx, r.next, cur ? cur.version : null, r.message); return r.result; }
    catch (e) { if (!(e instanceof ConflictError) || tries >= 5) throw e; }
  }
}

function line(name: string, v: unknown, max = MAX_LINE, optional = true): string | undefined {
  if (v === undefined || v === null) { if (optional) return undefined; throw new LifecycleError(`${name} is required`); }
  if (typeof v !== 'string') throw new LifecycleError(`${name} must be a string`);
  const t = oneLine(v);
  if (t === '') { if (optional) return undefined; throw new LifecycleError(`${name} must not be empty`); }
  if (t.length > max) throw new LifecycleError(`${name} must be at most ${max} characters`);
  return t;
}

const OWNER_FIELDS = ['answer', 'text', 'answered', 'outcome', 'handled', 'note', 'snoozed', 'state', 'created', 'updated'];

/** Validates agent input; returns only the fields the agent sent. */
function checkPut(input: AskPut): Partial<Ask> & { detail?: string } {
  for (const k of OWNER_FIELDS) if (k in (input as object)) throw new LifecycleError(`Agents cannot write ${k}`);
  const out: Partial<Ask> & { detail?: string } = {};
  if (input.ask !== undefined) out.ask = line('ask', input.ask, MAX_ASK, false);
  if (input.kind !== undefined) { if (!oneOf(ASK_KINDS, input.kind)) throw new LifecycleError(`kind must be one of ${ASK_KINDS.join(', ')}`); out.kind = input.kind; }
  if (input.from !== undefined) out.from = line('from', input.from, 80, false);
  for (const k of ['project', 'why', 'recommend', 'default'] as const) if (input[k] !== undefined) out[k] = line(k, input[k]);
  if (input.options !== undefined) {
    if (!Array.isArray(input.options) || input.options.length < 2 || input.options.length > 4) throw new LifecycleError('options must list 2-4 choices');
    out.options = input.options.map((o) => (line('option', typeof o === 'string' ? o.replace(/\|/g, '/') : o, 80, false) as string));
  }
  if (input.by !== undefined) { if (!isoOk(input.by)) throw new LifecycleError('by must be an ISO date-time'); out.by = iso(input.by); }
  if (input.reversible !== undefined) { if (typeof input.reversible !== 'boolean') throw new LifecycleError('reversible must be yes or no'); out.reversible = input.reversible; }
// eslint-disable-next-line no-control-regex
  if (input.link !== undefined) { const l = typeof input.link === 'string' ? input.link.trim() : ''; if (!isHttps(l) || /[\s\u0000-\u001f]/.test(l) || l.length > 2000) throw new LifecycleError('link must be an https url'); out.link = l; }
  if (input.priority !== undefined) { if (!oneOf(ASK_PRIORITIES, input.priority)) throw new LifecycleError(`priority must be one of ${ASK_PRIORITIES.join(', ')}`); out.priority = input.priority; }
  if (input.effort !== undefined) { if (typeof input.effort !== 'string' || !/^\d{1,3}[mh]$/.test(input.effort)) throw new LifecycleError('effort must look like 5m or 2h'); out.effort = input.effort; }
  if (input.blocks !== undefined) { if (!Number.isInteger(input.blocks) || input.blocks < 0 || input.blocks > 99) throw new LifecycleError('blocks must be 0-99'); out.blocks = input.blocks; }
  if (input.detail !== undefined) {
    if (typeof input.detail !== 'string' || input.detail.length > MAX_DETAIL) throw new LifecycleError(`detail must be at most ${MAX_DETAIL} characters`);
// eslint-disable-next-line no-control-regex
    out.detail = input.detail.replace(INVISIBLE, '').replace(/\u0000/g, '').replace(/\r/g, '').replace(/^## (Detail|Thread)\s*$/gim, '\\$&').trim();
  }
  return out;
}

/** Creates or updates an ask. @req FR:ask-queue/flow.put */
export async function putAsk(ctx: LifecycleContext, key: string, input: AskPut, actor: string): Promise<{ key: string; created: boolean }> {
  asksPath(key);
  const fields = checkPut(input);
  const now = clock(ctx).toISOString();
  return mutate<{ key: string; created: boolean }>(ctx, key, (cur) => {
    if (!cur) {
      const from = fields.from ?? line('from', actor, 80);
      if (!fields.ask || !fields.kind || !from) throw new LifecycleError('ask, kind and from are required');
      if (fields.kind === 'decide' && !fields.options) throw new LifecycleError('options are required for kind decide');
      const next: Ask = { key, state: 'open', reversible: false, priority: 'normal', blocks: 0, detail: '', thread: [], extra: [], ...fields, ask: fields.ask, kind: fields.kind, from, created: now, updated: now };
      return { next, message: `Ask: ${key}`, result: { key, created: true } };
    }
    const old = cur.ask;
    if (old.state === 'done' && input.reopen !== true) throw new ConflictError('Ask is done; send reopen to open it again');
    const next: Ask = { ...old, ...fields, key, updated: now };
    if (next.kind !== 'decide') delete next.options;
    if (next.kind === 'decide' && !next.options) throw new LifecycleError('options are required for kind decide');
    if (old.state === 'done') {
      next.state = 'open';
      for (const k of ['answer', 'text', 'answered', 'outcome', 'handled', 'note', 'snoozed'] as const) delete next[k];
    }
    return { next, message: `Ask: ${key}`, result: { key, created: false } };
  });
}

/** The owner's answer. @req FR:ask-queue/flow.answer */
export async function answerAsk(ctx: LifecycleContext, key: string, input: AnswerInput): Promise<{ changed: boolean }> {
  asksPath(key);
  if (!oneOf(ASK_ANSWERS, input.answer)) throw new LifecycleError(`answer must be one of ${ASK_ANSWERS.join(', ')}`);
  const nowD = clock(ctx);
  const now = nowD.toISOString();
  const text = input.text === undefined ? undefined : line('text', input.text, MAX_TEXT);
  if (['reply', 'ask', 'option'].includes(input.answer) && !text) throw new LifecycleError(`text is required for ${input.answer}`);
  return mutate<{ changed: boolean }>(ctx, key, (cur) => {
    if (!cur) throw new NotFoundError(`Ask not found: ${key}`);
    const a = { ...cur.ask };
    if (input.answer === 'retract') {
      if (a.state !== 'answered') throw new ConflictError('Nothing to retract');
      a.state = 'open';
      for (const k of ['answer', 'text', 'answered'] as const) delete a[k];
      a.updated = now;
      return { next: a, message: `Ask retracted: ${key}`, result: { changed: true } };
    }
    if (a.state !== 'open') throw new ConflictError(`Ask is ${a.state}`);
    if (input.answer === 'defer') {
      if (!isoOk(input.until)) throw new LifecycleError('until must be an ISO date-time');
      let until = Date.parse(input.until);
      if (until <= nowD.getTime()) throw new LifecycleError('until must be in the future');
      // Clamp to the deadline only while it is ahead; a past deadline must not turn the snooze into a no-op.
      if (a.reversible && a.default && a.by && Date.parse(a.by) > nowD.getTime()) until = Math.min(until, Date.parse(a.by));
      a.snoozed = new Date(until).toISOString();
      a.updated = now;
      return { next: a, message: `Ask deferred: ${key}`, result: { changed: true } };
    }
    if (input.answer === 'option' && !(a.options ?? []).includes(text!)) throw new LifecycleError('text must be one of the options');
    a.state = 'answered'; a.answer = input.answer; a.answered = now; a.updated = now; delete a.snoozed;
    if (text) a.text = text; else delete a.text;
    if (input.answer === 'reply' || input.answer === 'ask') a.thread = [...a.thread, `- ${now} you: ${text}`];
    return { next: a, message: `Ask answered: ${key}`, result: { changed: true } };
  });
}

/** The agent closes or reopens an ask. @req FR:ask-queue/flow.handle */
export async function handleAsk(ctx: LifecycleContext, key: string, input: HandleInput, actor: string): Promise<{ changed: boolean }> {
  asksPath(key);
  if (!oneOf(ASK_OUTCOMES, input.outcome)) throw new LifecycleError(`outcome must be one of ${ASK_OUTCOMES.join(', ')}`);
  const note = input.note === undefined ? undefined : line('note', input.note, 500);
  const reply = input.reply === undefined ? undefined : line('reply', input.reply, MAX_TEXT);
  const who = /^[A-Za-z0-9._:-]{1,64}$/.test(actor) ? actor : 'api';
  const now = clock(ctx).toISOString();
  return mutate<{ changed: boolean }>(ctx, key, (cur) => {
    if (!cur) throw new NotFoundError(`Ask not found: ${key}`);
    const a = { ...cur.ask };
    if (input.outcome === 'reopen') {
      if (a.state === 'open') return { skip: { changed: false } };
      a.state = 'open'; a.updated = now;
      for (const k of ['answer', 'text', 'answered', 'outcome', 'handled', 'snoozed'] as const) delete a[k];
      if (reply) a.thread = [...a.thread, `- ${now} ${who}: ${reply}`];
      if (note) a.note = note;
      return { next: a, message: `Ask reopened: ${key}`, result: { changed: true } };
    }
    if (a.state === 'done') return { skip: { changed: false } };
    a.state = 'done'; a.outcome = input.outcome; a.handled = `${now} by ${who}`; a.updated = now;
    if (note) a.note = note;
    return { next: a, message: `Ask ${input.outcome}: ${key}`, result: { changed: true } };
  });
}

/** Every well-formed ask file, parsed once per version. */
async function readAll(ctx: LifecycleContext): Promise<Ask[]> {
  let cache = parsed.get(ctx.storage);
  if (!cache) { cache = new Map(); parsed.set(ctx.storage, cache); }
  const all: Ask[] = [];
  const seen = new Set<string>();
  for (const p of (await ctx.storage.listAsks?.()) ?? []) {
    const key = p.replace(/^.*\//, '').replace(/\.md$/, '');
    seen.add(p);
    try {
      const f = await ctx.storage.read(p);
      const hit = cache.get(p);
      const a = hit && hit.version === f.version ? hit.ask : parseAsk(key, f.content);
      cache.set(p, { version: f.version, ask: a });
      if (a.ask && a.from && a.created) all.push(a);
    } catch (e) { if (!(e instanceof NotFoundError)) throw e; }
  }
  for (const p of cache.keys()) if (!seen.has(p)) cache.delete(p);
  return all;
}

async function exists(ctx: LifecycleContext, path: string): Promise<boolean> {
  try { await ctx.storage.read(path); return true; } catch (e) { if (e instanceof NotFoundError) return false; throw e; }
}

/** The archive folder for a key. @req FR:ask-queue/ask.archive */
export const archivePath = (key: string): string => `tasks/asks/archive/${key}.md`;

/**
 * Moves `done` asks untouched for `days` days to `tasks/asks/archive/`, one write (one commit) for all of them.
 * The open list never reads the archive, so the queue stays small however many asks agents have closed.
 * @req FR:ask-queue/ask.archive
 */
export async function archiveAsks(ctx: LifecycleContext, o: { days?: number } = {}): Promise<{ archived: string[] }> {
  const days = o.days ?? 14;
  if (!Number.isInteger(days) || days < 0 || days > 3650) throw new LifecycleError('days must be a whole number of days (0-3650)');
  const cutoff = clock(ctx).getTime() - days * 86_400_000;
  const writes: FileWrite[] = [];
  const archived: string[] = [];
  for (const a of await readAll(ctx)) {
    if (a.state !== 'done' || Date.parse(a.updated) > cutoff) continue;
    const f = await ctx.storage.read(asksPath(a.key));
    // A key reused after an earlier archive (email threads come back) gets a dated name; nothing already archived is overwritten.
    let dest = archivePath(a.key);
    if (await exists(ctx, dest)) dest = archivePath(`${a.key}.${a.updated.slice(0, 10).replace(/-/g, '')}`);
    if (await exists(ctx, dest)) continue;
    writes.push({ path: dest, content: f.content, expectedVersion: null }, { path: asksPath(a.key), content: null, expectedVersion: f.version });
    archived.push(a.key);
  }
  if (writes.length) await writeAll(ctx.storage, writes, archived.length === 1 ? `Archive ask: ${archived[0]}` : `Archive ${archived.length} asks`);
  return { archived };
}

/** Ranked list. @req FR:ask-queue/ask.rank @req FR:ask-queue/flow.default */
export async function listAsks(ctx: LifecycleContext, o: { state?: (typeof LIST_STATES)[number]; limit?: number } = {}, at?: Date): Promise<AskList> {
  const state = o.state ?? 'open';
  if (!oneOf(LIST_STATES, state)) throw new LifecycleError(`state must be one of ${LIST_STATES.join(', ')}`);
  const now = at ?? clock(ctx);
  const all = await readAll(ctx);
  const latest = all.map((a) => a.updated).sort().pop();
  const snoozed = (a: Ask) => !!a.snoozed && Date.parse(a.snoozed) > now.getTime();
  const lastReply = (a: Ask) => { const m = a.thread.length ? /^- \S+ (\S+): (.*)$/.exec(a.thread[a.thread.length - 1]) : null; return m && m[1] !== 'you' ? m[2] : undefined; };
  const decorate = (a: Ask): ListedAsk => {
    const { extra, thread, ...rest } = a;
    void extra;
    const agentReply = a.state === 'open' ? lastReply({ ...a, thread }) : undefined;
    return { ...rest, score: scoreAsk(a, now), overdue: a.state === 'open' && !!a.by && Date.parse(a.by) < now.getTime(), ...(a.snoozed ? { snoozedUntil: a.snoozed } : {}), ...(agentReply ? { agentReply } : {}) };
  };
  let rows: Ask[];
  if (state === 'open') {
    rows = all.filter((a) => a.state === 'open' && !snoozed(a)).sort((a, b) => scoreAsk(b, now) - scoreAsk(a, now) || (Date.parse(a.by ?? '') || Infinity) - (Date.parse(b.by ?? '') || Infinity) || a.created.localeCompare(b.created) || a.key.localeCompare(b.key));
  } else if (state === 'snoozed') rows = all.filter((a) => a.state === 'open' && snoozed(a)).sort((a, b) => (a.snoozed ?? '').localeCompare(b.snoozed ?? ''));
  else if (state === 'answered') rows = all.filter((a) => a.state === 'answered').sort((a, b) => (a.answered ?? '').localeCompare(b.answered ?? ''));
  else if (state === 'done') rows = all.filter((a) => a.state === 'done').sort((a, b) => b.updated.localeCompare(a.updated));
  else rows = all.sort((a, b) => a.key.localeCompare(b.key));
  const total = rows.length;
  const items = rows.slice(0, o.limit ?? 50).map(decorate);
  if (state === 'open') items.forEach((it, i) => { it.rank = i + 1; });
  return { items, total, latest, snoozed: all.filter((a) => a.state === 'open' && snoozed(a)).length };
}
