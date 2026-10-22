/**
 * AI triage assist: autonomy gate, triage application, claim, and the in-repo result log.
 * Pure core: no model calls. The agent is external; this module only decides what it may change and records what it did.
 * @req FR:ai-triage-assist/autonomy.scope @req FR:ai-triage-assist/autonomy.gate @req FR:ai-triage-assist/triage.subtasks @req FR:ai-triage-assist/result.log
 */
import {
  addTask, applyTaskProps, completeTask, EFFORT, IMPACT, LifecycleError, PRIORITY, SPECIAL, STATUS, startTask,
  type LifecycleContext, type LifecycleResult, type TaskRef,
} from './lifecycle';
import { AUTONOMY_LEVELS, type Autonomy } from './model';
import { parseProject, type Task } from './parser';
import { ConflictError, NotFoundError } from './storage';

/** The autonomy gate said no. Agents treat this as "skip and move on". */
export class TriageDenied extends LifecycleError {
  constructor(message = 'Autonomy level does not allow this') { super(message); }
}

export type TriageAction = 'triage' | 'record' | 'claim' | 'complete-subtask' | 'complete-task';
export const OUTCOMES = ['done', 'partial', 'blocked', 'needs-human'] as const;
export type Outcome = (typeof OUTCOMES)[number];

/** Who is acting. `owner` (the CLI) skips the autonomy gate, never the input checks. */
export interface Caller { actor: string; owner?: boolean }
export interface Suggestion { agent?: string; human?: string; priority?: string; effort?: string; impact?: string }
export interface TriageResult { changed: boolean; ref: TaskRef; applied: string[]; added: TaskRef[] }
export interface ResultInput { outcome: Outcome; summary: string; complete?: boolean; human?: string }
export interface RecordOutcome { logged: true; completed: boolean; deferred: boolean; ref: TaskRef; human?: TaskRef }

const AGENT = '🪄';
const HUMAN = '🙋';
const MARKER = /(?:^|\s)🤖:(\S*)/g;
const REQUIRED = new Map<string, Autonomy>([
  ['triage', 'triage'], ['record', 'triage'], ['claim', 'assist'], ['complete-subtask', 'assist'], ['complete-task', 'full'],
]);
const MAX_CHILDREN = 20;
const MAX_DEPTH = 4;
const MAX_TEXT = 200;
const MAX_SUMMARY = 500;
const MAX_LOG = 256 * 1024;
const MAX_LOG_FILES = 5;
const ACTOR = /^[A-Za-z0-9._:-]{1,64}$/;
// Characters that start a new line or are invisible controls.
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
// eslint-disable-next-line no-control-regex
const CONTROL_RUN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g;
// Variation selectors and zero-width characters, removed before any syntax or secret check.
const INVISIBLE = /[\uFE0E\uFE0F\u200B-\u200F\u2060\uFEFF\u00AD]/g;
const norm = (v: string) => v.replace(INVISIBLE, '');
// Anything that would change what a row means: agent/human/autonomy marks, every status, priority, effort,
// impact, suspend/park/pin marker, due, start, and recurrence prefix.
const SYNTAX = [...new Set([AGENT, HUMAN, '🤖', ...STATUS, ...PRIORITY, ...EFFORT, ...IMPACT, ...SPECIAL, '📅', '⏰', '🔄', '⛔'].map(norm))];
const HELD = [...STATUS.filter((x) => x !== '🚧'), '💤', '🅿️', '⛔'].map(norm);

/**
 * Deny by default: unknown level or action is false; merge and deploy are never an action.
 * @req FR:ai-triage-assist/autonomy.gate
 */
export function authorize(level: string, action: string): boolean {
  const need = typeof action === 'string' ? REQUIRED.get(action) : undefined;
  if (need === undefined || typeof level !== 'string') return false;
  const have = (AUTONOMY_LEVELS as readonly string[]).indexOf(level);
  return have >= 0 && have >= AUTONOMY_LEVELS.indexOf(need);
}

// ------------------------------------------------------------------ rows

interface Located { chain: Task[]; row: Task; lines: string[]; section: string; version: string; content: string; name: string }
const collapse = (v: string) => v.replace(/\s+/g, ' ').trim();
const baseName = (p: string) => p.replace(/^.*\//, '').replace(/\.md$/, '');
const bare = (l: string) => l.replace(/\r$/, '');

function find(tasks: Task[], line: number, chain: Task[] = []): Task[] | null {
  for (const t of tasks) {
    if (t.line === line) return [...chain, t];
    const hit = find(t.children, line, [...chain, t]);
    if (hit) return hit;
  }
  return null;
}

function locateIn(content: string, line: number): { chain: Task[]; section: string; lines: string[] } | null {
  const project = parseProject(content);
  for (const s of project.sections) {
    const chain = find(s.tasks, line);
    if (chain) return { chain, section: s.heading, lines: project.lines };
  }
  return null;
}

/** The level a row's markers grant; any bad or conflicting marker fails closed to the lowest level. */
function levelOf(text: string): Autonomy | null {
  let found: Autonomy | null = null;
  for (const m of text.matchAll(MARKER)) {
    const lvl = (AUTONOMY_LEVELS as readonly string[]).includes(m[1]) ? (m[1] as Autonomy) : 'none';
    if (found === null || AUTONOMY_LEVELS.indexOf(lvl) < AUTONOMY_LEVELS.indexOf(found)) found = lvl;
  }
  return found;
}

/**
 * Nearest marker on the row or its ancestors; `none` when absent or unknown.
 * @req FR:ai-triage-assist/autonomy.marker
 */
export function effectiveAutonomy(content: string, line: number): Autonomy {
  const at = locateIn(content, line);
  if (!at) return 'none';
  for (let i = at.chain.length - 1; i >= 0; i--) {
    const lvl = levelOf(at.chain[i].text);
    if (lvl !== null) return lvl;
  }
  return 'none';
}

async function locate(ctx: LifecycleContext, ref: TaskRef): Promise<Located> {
  const f = await ctx.storage.read(ref.path);
  const at = locateIn(f.content, ref.line);
  if (!at) throw new LifecycleError('Task not found');
  return { ...at, row: at.chain[at.chain.length - 1], version: f.version, content: f.content, name: baseName(ref.path) };
}

const level = (l: Located): Autonomy => {
  for (let i = l.chain.length - 1; i >= 0; i--) {
    const lvl = levelOf(l.chain[i].text);
    if (lvl !== null) return lvl;
  }
  return 'none';
};
/** 🙋 anywhere makes a row human-only (safe side); 🪄 counts only as the leading token after status/priority emoji. */
function kindOf(t: Task): 'human' | 'agent' | 'task' {
  const text = norm(t.text);
  if (text.includes(HUMAN)) return 'human';
  let rest = text.trim();
  for (let go = true; go;) {
    go = false;
    for (const e of [...STATUS, ...PRIORITY].map(norm)) if (rest.startsWith(e)) { rest = rest.slice(e.length).trimStart(); go = true; }
  }
  return rest.startsWith(AGENT) ? 'agent' : 'task';
}
const held = (t: Task): boolean => HELD.some((e) => norm(t.text).includes(e));
const openHuman = (t: Task): boolean => t.children.some((c) => (!c.checked && kindOf(c) === 'human') || openHuman(c));

function open(l: Located): void {
  if (l.chain.some((t) => t.checked)) throw new LifecycleError('Task is not open');
}

function gate(c: Caller, lvl: Autonomy, action: TriageAction): void {
  if (!c.owner && !authorize(lvl, action)) throw new TriageDenied();
}

function checkCaller(c: Caller): void {
  if (typeof c?.actor !== 'string' || !ACTOR.test(c.actor)) throw new LifecycleError('Invalid actor');
}

/** One line of 1-200 characters with no control characters and no row syntax. @req FR:ai-triage-assist/triage.subtasks @req FR:ai-triage-assist/triage.syntax */
function subtaskText(v: unknown, label: string): string {
  if (typeof v !== 'string') throw new LifecycleError(`${label} must be a string`);
  const t = norm(v).trim();
  if (t === '' || t.length > MAX_TEXT) throw new LifecycleError(`${label} must be 1-${MAX_TEXT} characters`);
  if (CONTROL.test(t)) throw new LifecycleError(`${label} must be a single line`);
  if (SYNTAX.some((m) => t.includes(m))) throw new LifecycleError(`${label} cannot contain row markers`);
  return redact(t);
}

// ------------------------------------------------------------------ redaction

const R = '[redacted]';
const KEY = '(?:pass(?:word|wd|phrase)?|pwd|sig|account[_-]?key|secret|token|api[_-]?key|access[_-]?key|private[_-]?key|client[_-]?secret|credentials?)';
const VALUE = '(?:"[^"]*"|\'[^\']*\'|\\S+)';
const SECRETS: RegExp[] = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\bauthorization\s*[:=]\s*(?:(?:bearer|basic|token)\s+)?\S+/gi,
  /\bbearer\s+[A-Za-z0-9._~+/=-]{8,}/gi,
  new RegExp(`(?<![A-Za-z0-9])[A-Za-z0-9_-]*${KEY}[A-Za-z0-9_]*\\s*[:=]\\s*${VALUE}`, 'gi'),
  /\b(?:password|passwd|passphrase)\s+(?:is\s+)?(?:"[^"]*"|'[^']*'|\S+)/gi,
  /\b(?:set-)?cookie\s*[:=].*$/gim,
  /\b(?:api[_-]?key|access[_-]?key|token|secret)\s+is\s+(?:"[^"]*"|'[^']*'|\S+)/gi,
  /\b(?:api[_-]?key|access[_-]?key|token|secret)\s+(?=\S*\d)[A-Za-z0-9_+/=.~-]{6,}/gi,
  /[?&](?:key|apikey|api_key|token|access_token|sig|signature)=[^\s&]*/gi,
  /\bsk_(?:live|test)_[A-Za-z0-9]+/g,
  /\b[a-z][a-z0-9+.-]*:\/\/\S*@/gi,
  /\bstk_[A-Za-z0-9_.-]{16,}/g,
  /\bgh[a-z]_[A-Za-z0-9]{3,}/gi,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bglpat-[A-Za-z0-9_-]{10,}/g,
  /\bnpm_[A-Za-z0-9]{20,}/g,
  /\bsk-[A-Za-z0-9_-]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/g,
  /(?<![A-Za-z0-9_+/=-])[A-Za-z0-9_+/=-]{32,}(?![A-Za-z0-9_+/=-])/g,
];

// Cyrillic and Greek letters that look like Latin ones are folded to Latin so they cannot hide a keyword.
const CONFUSABLE: Record<string, string> = {
  а: 'a', в: 'b', е: 'e', к: 'k', м: 'm', н: 'h', о: 'o', р: 'p', с: 'c', т: 't', у: 'y', х: 'x', і: 'i', ѕ: 's', ј: 'j', ԁ: 'd', ӏ: 'l',
  А: 'A', В: 'B', Е: 'E', К: 'K', М: 'M', Н: 'H', О: 'O', Р: 'P', С: 'C', Т: 'T', Х: 'X', У: 'Y', І: 'I', Ѕ: 'S', Ј: 'J',
  α: 'a', β: 'b', γ: 'y', ε: 'e', ι: 'i', κ: 'k', ν: 'v', ο: 'o', ρ: 'p', τ: 't', υ: 'u', χ: 'x',
  Α: 'A', Β: 'B', Ε: 'E', Ζ: 'Z', Η: 'H', Ι: 'I', Κ: 'K', Μ: 'M', Ν: 'N', Ο: 'O', Ρ: 'P', Τ: 'T', Υ: 'Y', Χ: 'X',
};
CONFUSABLE['ı'] = 'i'; CONFUSABLE['ſ'] = 's';
const fold = (v: string): string => v.replace(/[\u0131\u017f\u0370-\u03ff\u0400-\u04ff]/g, (c) => CONFUSABLE[c] ?? c);

/** Escapes characters that render as HTML, links, images, code, or tables; keeps the `[redacted]` mark readable. */
const md = (v: string): string => v.split(R).map((p) => p.replace(/[\\<>[\]`|]/g, '\\$&')).join(R);

/**
 * Best effort: replaces anything that looks like a credential with `[redacted]`. Zero-width characters are removed first.
 * @req FR:ai-triage-assist/result.noleak
 */
export function redact(s: string): string {
  let out = fold(s.replace(/[\u200B-\u200F\u2060\uFEFF\u00AD]/g, '').normalize('NFKC'));
  for (const re of SECRETS) out = out.replace(re, R);
  return out;
}

// ------------------------------------------------------------------ writes

async function writeRow(ctx: LifecycleContext, ref: TaskRef, l: Located, next: string, message: string): Promise<boolean> {
  const lines = [...l.lines];
  const cr = lines[ref.line].endsWith('\r') ? '\r' : '';
  if (bare(lines[ref.line]) === next) return false;
  lines[ref.line] = next + cr;
  await ctx.storage.write(ref.path, lines.join('\n'), { expectedVersion: l.version, message });
  return true;
}

/** Owner-only: sets or clears the row's autonomy marker. @req FR:ai-triage-assist/autonomy.set */
export async function setAutonomy(ctx: LifecycleContext, ref: TaskRef, to: Autonomy): Promise<LifecycleResult> {
  if (!(AUTONOMY_LEVELS as readonly string[]).includes(to)) throw new LifecycleError(`autonomy must be one of: ${AUTONOMY_LEVELS.join(' ')}`);
  const l = await locate(ctx, ref);
  open(l);
  const line = bare(l.lines[ref.line]);
  const stripped = line.replace(/(?:^|\s+)🤖:\S*/g, '').replace(/\s+$/, '');
  const next = to === 'none' ? stripped : `${stripped} 🤖:${to}`;
  const changed = await writeRow(ctx, ref, l, next, `Autonomy ${to}: ${l.name}`);
  return { changed, ref: { path: ref.path, line: ref.line }, before: line, after: next };
}

/** Finds an identical direct child or adds one. */
async function ensureChild(ctx: LifecycleContext, parent: TaskRef, mark: string, text: string): Promise<{ ref: TaskRef; added: boolean }> {
  const l = await locate(ctx, parent);
  if (parent.text !== undefined && collapse(parent.text) !== collapse(l.row.text)) throw new ConflictError('Task changed since it was read');
  if (parent.chain !== undefined) {
    const up = l.chain.slice(0, -1);
    if (up.length !== parent.chain.length || up.some((t, i) => collapse(t.text) !== collapse(parent.chain![i]))) throw new ConflictError('Task moved since it was read');
  }
  const want = `${mark} ${text}`;
  const same = l.row.children.find((c) => c.text.trim() === want);
  if (same) return { ref: { path: parent.path, line: same.line }, added: false };
  if (l.chain.length >= MAX_DEPTH) throw new LifecycleError('Subtasks are nested too deeply');
  if (l.row.children.length >= MAX_CHILDREN) throw new LifecycleError(`A task can have at most ${MAX_CHILDREN} children`);
  const r = await addTask(ctx, { project: l.name, text: want, section: l.section, parent: { path: parent.path, line: parent.line, text: parent.text, chain: parent.chain } });
  return { ref: { path: parent.path, line: r.ref!.line }, added: true };
}

// ------------------------------------------------------------------ triage

const PROPS = { priority: PRIORITY, effort: EFFORT, impact: IMPACT } as const;
const SUGGESTION_KEYS = new Set(['agent', 'human', 'priority', 'effort', 'impact']);

/** The row as read, @req FR:ai-triage-assist/triage.pin @req FR:ai-triage-assist/autonomy.owner - so a concurrent edit makes the write fail instead of landing on a different row. */
const pinned = (ref: TaskRef, l: Located): TaskRef => ({ path: ref.path, line: ref.line, text: l.row.text, chain: l.chain.slice(0, -1).map((t) => t.text) });

/**
 * Applies a suggestion: fills missing priority/effort/impact and adds one 🪄 and/or one 🙋 subtask.
 * @req FR:ai-triage-assist/triage.subtasks @req FR:ai-triage-assist/triage.props @req FR:ai-triage-assist/triage.gate @req FR:ai-triage-assist/triage.open
 */
export async function applyTriage(ctx: LifecycleContext, ref: TaskRef, s: Suggestion, caller: Caller): Promise<TriageResult> {
  checkCaller(caller);
  if (typeof s !== 'object' || s === null) throw new LifecycleError('Suggestion must be an object');
  for (const k of Object.keys(s)) if (!SUGGESTION_KEYS.has(k)) throw new LifecycleError(`Unknown field: ${k}`);
  const props: [keyof typeof PROPS, string][] = [];
  for (const k of Object.keys(PROPS) as (keyof typeof PROPS)[]) {
    const v = s[k];
    if (v === undefined) continue;
    if (typeof v !== 'string' || !(PROPS[k] as readonly string[]).includes(v)) throw new LifecycleError(`${k} must be one of: ${PROPS[k].join(' ')}`);
    props.push([k, v]);
  }
  const agent = s.agent === undefined ? undefined : subtaskText(s.agent, 'agent');
  const human = s.human === undefined ? undefined : subtaskText(s.human, 'human');

  const l = await locate(ctx, ref);
  open(l);
  gate(caller, level(l), 'triage');

  const applied: string[] = [];
  let line = bare(l.lines[ref.line]);
  for (const [k, v] of props) {
    if ((PROPS[k] as readonly string[]).some((e) => l.row.text.includes(e))) continue;
    line = applyTaskProps(line, { [k]: v });
    applied.push(k);
  }
  let changed = applied.length > 0 && (await writeRow(ctx, ref, l, line, `Triage: ${l.name}`));
  const added: TaskRef[] = [];
  const parent: TaskRef = applied.length > 0
    ? { path: ref.path, line: ref.line, text: line.replace(/^\s*- \[[ xX]\]\s*/, ''), chain: pinned(ref, l).chain }
    : pinned(ref, l);
  for (const [mark, text] of [[AGENT, agent], [HUMAN, human]] as const) {
    if (text === undefined) continue;
    const c = await ensureChild(ctx, parent, mark, text);
    if (c.added) { added.push(c.ref); changed = true; }
  }
  return { changed, ref: { path: ref.path, line: ref.line }, applied, added };
}

// ------------------------------------------------------------------ log

const iso = (ctx: LifecycleContext) => (ctx.now ?? (() => new Date()))().toISOString();
/** A storage-safe log name for any project file name. */
const logName = (ref: TaskRef): string => {
  const slug = baseName(ref.path).replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^[^A-Za-z0-9]+/, '');
  return /^readme$/i.test(slug) || slug === '' ? 'project' : slug;
};
const logFile = (ref: TaskRef, n: number): string => `tasks/logs/${logName(ref)}${n === 0 ? '' : `.${n + 1}`}.md`;

/**
 * Append-only entry in `tasks/logs/<project>.md` (rolls to `.2.md`, `.3.md`, ... when a file is full, at most 5 files; a slug has no dots so a rollover never equals another project's log). Every field is one redacted line.
 * @req FR:ai-triage-assist/result.log
 */
async function appendLog(ctx: LifecycleContext, ref: TaskRef, caller: Caller, lvl: Autonomy, fields: [string, string][]): Promise<void> {
  const entry = [
    `## ${iso(ctx)}`, '',
    `- actor: ${caller.actor}`,
    `- ref: ${ref.path}:${ref.line + 1}`,
    `- level: ${lvl}`,
    ...fields.map(([k, v]) => `- ${k}: ${md(redact(v).split(CONTROL_RUN).join(' '))}`),
    '',
  ].join('\n');
  for (let attempt = 0, n = 0; ; attempt++) {
    if (attempt > 0) await new Promise((r) => setTimeout(r, 1 + Math.random() * 6));
    const path = logFile(ref, n);
    let cur: { content: string; version: string } | null = null;
    try { cur = await ctx.storage.read(path); } catch (e) { if (!(e instanceof NotFoundError)) throw e; }
    if (cur && cur.content.length > MAX_LOG) {
      if (++n >= MAX_LOG_FILES) throw new LifecycleError('Result log is full');
      continue;
    }
    const title = cur ? '' : md(redact(parseProject((await ctx.storage.read(ref.path)).content).title || baseName(ref.path)));
    const head = cur ? cur.content.replace(/\n*$/, '\n\n') : `# ${title} agent log\n\n`;
    try {
      await ctx.storage.write(path, head + entry, { expectedVersion: cur ? cur.version : null, message: `Log: ${baseName(ref.path)}` });
      return;
    } catch (e) {
      if (!(e instanceof ConflictError) || attempt >= 12) throw e;
    }
  }
}

// ------------------------------------------------------------------ claim

/**
 * Marks a row in progress for the agent. Needs `assist`; never a 🙋 row, a held row (blocked, parked, waiting, suspended), or a row under a closed one.
 * The claim is logged before the row changes.
 * @req FR:ai-triage-assist/claim.start @req FR:ai-triage-assist/claim.log
 */
export async function claimTask(ctx: LifecycleContext, ref: TaskRef, caller: Caller): Promise<LifecycleResult> {
  checkCaller(caller);
  const l = await locate(ctx, ref);
  open(l);
  const lvl = level(l);
  gate(caller, lvl, 'claim');
  if (kindOf(l.row) === 'human') throw new TriageDenied('Needs a human');
  if (l.chain.some(held)) throw new TriageDenied('Task is on hold');
  if (norm(l.row.text).includes('🚧')) return { changed: false, ref: { path: ref.path, line: ref.line } };
  await appendLog(ctx, ref, caller, lvl, [['action', 'claimed']]);
  try {
    const r = await startTask(ctx, pinned(ref, l));
    return { changed: r.changed, ref: { path: ref.path, line: ref.line } };
  } catch (e) {
    await appendLog(ctx, ref, caller, lvl, [['action', 'claim-failed']]).catch(() => undefined);
    throw e;
  }
}

// ------------------------------------------------------------------ results

const clip = (v: string, n: number) => (v.length > n ? `${v.slice(0, n - 3)}...` : v);
const plain = (v: string) => SYNTAX.reduce((a, m) => a.split(m).join(''), norm(v)).replace(/\s+/g, ' ').trim();

/**
 * Logs what the agent did. Completes only inside the autonomy level; otherwise defers to a 🙋 subtask. Never blocks.
 * @req FR:ai-triage-assist/result.log @req FR:ai-triage-assist/result.nosilent @req FR:ai-triage-assist/result.noblock @req FR:ai-triage-assist/result.actor
 */
export async function recordResult(ctx: LifecycleContext, ref: TaskRef, r: ResultInput, caller: Caller): Promise<RecordOutcome> {
  checkCaller(caller);
  if (!(OUTCOMES as readonly string[]).includes(r?.outcome)) throw new LifecycleError(`outcome must be one of: ${OUTCOMES.join(' ')}`);
  if (typeof r.summary !== 'string' || r.summary.trim() === '' || r.summary.length > MAX_SUMMARY) throw new LifecycleError(`summary must be 1-${MAX_SUMMARY} characters`);
  if (CONTROL.test(r.summary)) throw new LifecycleError('summary must be a single line');
  if (r.complete !== undefined && typeof r.complete !== 'boolean') throw new LifecycleError('complete must be true or false');
  const summary = redact(r.summary.trim());
  const given = r.human === undefined ? undefined : subtaskText(r.human, 'human');

  const l = await locate(ctx, ref);
  open(l);
  const lvl = level(l);
  const kind = kindOf(l.row);
  if (kind === 'human') throw new TriageDenied('Needs a human');
  gate(caller, lvl, 'record');

  const wants = r.complete === true;
  const can = wants && r.outcome === 'done' && !openHuman(l.row) && !l.chain.some(held) && given === undefined &&
    (caller.owner === true || authorize(lvl, kind === 'agent' ? 'complete-subtask' : 'complete-task'));
  const needsHuman = r.outcome === 'blocked' || r.outcome === 'needs-human';
  const humanText = needsHuman
    ? (given ?? subtaskText(`${r.outcome === 'blocked' ? 'Unblock' : 'Review'}: ${clip(plain(summary), 150) || 'see log'}`, 'human'))
    : given;
  const at = pinned(ref, l);

  // A person is asked for first, so a full log never stops the agent from handing off.
  let human: TaskRef | undefined;
  if (humanText !== undefined) human = (await ensureChild(ctx, at, HUMAN, humanText)).ref;
  await appendLog(ctx, ref, caller, lvl, [
    ['action', 'result'], ['outcome', r.outcome], ['completed', can ? 'yes' : wants ? 'deferred' : 'no'], ['summary', summary],
  ]);
  if (wants && !can && human === undefined) human = (await ensureChild(ctx, at, HUMAN, 'Review and complete')).ref;
  let completed = false;
  if (can) {
    try {
      completed = (await completeTask(ctx, at)).changed;
    } catch (e) {
      await appendLog(ctx, ref, caller, lvl, [['action', 'complete-failed'], ['completed', 'no'], ['summary', 'completion did not apply']]).catch(() => undefined);
      throw e;
    }
  }
  return { logged: true, completed, deferred: wants && !completed, ref: { path: ref.path, line: ref.line }, ...(human ? { human } : {}) };
}
