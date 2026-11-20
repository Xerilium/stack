/**
 * Live ask queue core: an ask is a nested 🙋 task row (`> key: value` metadata) under the task it blocks, that agents write,
 * the owner answers, and agents handle. The old one-file-per-ask format (`tasks/.stack/asks/<key>.md`) is read only by `importAsks`.
 * @req FR:ask-queue/ask.path @req FR:ask-queue/ask.format @req FR:ask-queue/ask.safe @req FR:ask-queue/ask.score @req FR:ask-queue/ask.rank
 * @req FR:ask-queue/flow.put @req FR:ask-queue/flow.answer @req FR:ask-queue/flow.handle @req FR:ask-queue/flow.default @req FR:ask-queue/flow.thread
 * @req FR:quick-triage/flow.fields @req FR:quick-triage/flow.apply @req FR:quick-triage/flow.text @req FR:quick-triage/flow.order
 * @req FR:task-asks/core.contract
 * @req FR:ask-routing/addr.link @req FR:ask-routing/turn.derive @req FR:ask-routing/reply.cmd
 */
import { EFFORT, IMPACT, LifecycleError, PRIORITY, SPECIAL, STATUS, type LifecycleContext } from './lifecycle';
import { ConflictError, NotFoundError, writeAll, type FileWrite } from './storage';
import { redact } from './triage';
import { isReadme, projectPath, ROOT_SYSTEM, TASK_PATH } from './task-paths';
import { updateWake } from './ask-wake';
import { currentRows, inboxTitle, rowKey } from './inbox';
import { parseProject, type Task } from './parser';
import { ASK_KEY, isAskRow } from './task-ids';
import { fencedLines } from './task-lint';
import { parseAgentLink } from './goal-model';
import { applyAction, describe as describeAction, parseAction, parseTaskRef, readRow, type Action } from './ask-actions';

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
export type AskTurn = 'owner' | 'agent' | 'none';
/** The owner's own questions to an agent carry this `from`. @req FR:ask-routing/ask.put */
export const OWNER = 'owner';

/** Whose move it is: the owner on an open agent ask or an answered owner question, the agent on the reverse. @req FR:ask-routing/turn.derive */
export function askTurn(a: Pick<Ask, 'from' | 'state'>): AskTurn {
  if (a.state === 'done') return 'none';
  const mine = a.from === OWNER;
  return (a.state === 'open') === mine ? 'agent' : 'owner';
}

export interface Ask {
  key: string; state: AskState; ask: string; kind: AskKind; from: string;
  project?: string; why?: string; recommend?: string; options?: string[]; default?: string; by?: string;
  reversible: boolean; link?: string; priority: AskPriority; effort?: string; blocks: number;
  created: string; updated: string;
  answer?: AskAnswer; text?: string; answered?: string; outcome?: AskOutcome; handled?: string; note?: string; snoozed?: string;
  /** Quick triage: the flow this question belongs to and its place; the row it is about; what Stack applies on the answer. @req FR:quick-triage/flow.fields */
  flow?: string; seq?: number; ref?: string; apply?: string; applies?: string[];
  /** The row's text when the ask was put: an action never lands on a row that changed. */
  refText?: string;
  /** Who created the ask (`token:<name>` for a token, else the core actor); only that writer or the owner updates it (security M5). */
  writer?: string;
  /** The agent side of the thread: `[Name](#local_<id>)`. @req FR:ask-routing/addr.link */
  agent?: string;
  /** When Stack woke the agent's session for this turn, or why it could not. @req FR:ask-routing/deliver.wake */
  delivered?: string; undelivered?: string;
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
  flow?: string; seq?: number; ref?: string; apply?: string; applies?: string[];
  agent?: string;
}
export interface AnswerInput { answer: AskAnswer; text?: string; until?: string }
export interface HandleInput { outcome: AskOutcome; note?: string; reply?: string }

export interface ListedAsk extends Omit<Ask, 'extra' | 'thread'> {
  /** Whose move it is. @req FR:ask-routing/turn.derive */
  turn: AskTurn;
  score: number; rank?: number; overdue: boolean; snoozedUntil?: string; agentReply?: string;
  /** The task title and where that row is now. @req FR:agent-thread/ask.ref */
  task?: string; row?: string;
  /** Progress through the flow this ask belongs to. @req FR:quick-triage/flow.order */
  flowTotal?: number; flowDone?: number;
}
export interface AskList { items: ListedAsk[]; total: number; latest?: string; snoozed: number }

/** Parsed asks by storage and path, reused while the file version is unchanged, so a refresh re-parses only what moved. */
const parsed = new WeakMap<object, Map<string, { version: string; rows: AskRow[]; ids: string[] }>>();

const MAX_ASK = 200;
const MAX_LINE = 500;
const MAX_TEXT = 1000;
const MAX_DETAIL = 20_000;
const KEY = ASK_KEY;
const FIELDS = ['state', 'ask', 'kind', 'from', 'project', 'why', 'recommend', 'options', 'default', 'by', 'reversible', 'link', 'priority', 'effort', 'blocks', 'created', 'updated', 'answer', 'text', 'answered', 'outcome', 'handled', 'note', 'snoozed', 'flow', 'seq', 'ref', 'apply', 'applies', 'reftext', 'writer', 'agent', 'delivered', 'undelivered'] as const;
const FLOW = /^[a-z0-9][a-z0-9._-]{0,79}$/;
const actionOk = (t: string) => { try { parseAction(t); return true; } catch { return false; } };
const refOk = (t: string) => { try { parseTaskRef(t); return true; } catch { return false; } };
// eslint-disable-next-line no-control-regex
const CONTROL_RUN = new RegExp('[\\u0000-\\u001f\\u007f-\\u009f\\u2028\\u2029]+', 'g');
const INVISIBLE = new RegExp('[\\uFE0E\\uFE0F\\u200B-\\u200F\\u2060\\uFEFF\\u00AD]', 'g');
const HEADER = '<!-- stack-ask v1. Agents write with POST /asks/<key> or `stack asks put`. Stack writes the answer; the agent reads it, acts, then handles the ask. -->';

/** The root path of a new ask; also checks the key. @req FR:task-structure/system.root */
export function asksPath(key: string): string {
  if (typeof key !== 'string' || !KEY.test(key)) throw new LifecycleError('Invalid ask key (lower case letters, digits, . _ -; up to 80)');
  return `${ROOT_SYSTEM}/asks/${key}.md`;
}

/** One clean line: no control or invisible characters, secrets redacted, no markdown link or html syntax. */
export function oneLine(v: string): string {
  return redact(v.replace(INVISIBLE, '')).split(CONTROL_RUN).join(' ').replace(/\[/g, '(').replace(/\]/g, ')').replace(/</g, '‹').replace(/>/g, '›').replace(/`/g, "'").replace(/\s+/g, ' ').trim();
}

/** Every emoji that sets a row property in Stack; ask text never holds one. */
const MARK_EMOJI = [...STATUS, ...PRIORITY, ...EFFORT, ...IMPACT, ...SPECIAL, '🔹', '🙋', '🪄', '🤖', '⏫', '📅', '⏰', '🅿️', '💤', '⭐️', '🔓', '🌐'];
const reEsc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const ROW_MARK = new RegExp(`(?:${[...new Set(MARK_EMOJI.map((e) => e.replace(/️/g, '')))].map(reEsc).join('|')})\\uFE0F?|[1-5]\\uFE0F?\\u20E3`, 'gu');

/**
 * The ask text with every Stack mark emoji removed, so the text never sets a row property (a leading 🚨 is not read as priority).
 * @req FR:task-asks/format.clean
 */
export const stripMarks = (v: string): string => v.replace(ROW_MARK, ' ').replace(/\s+/g, ' ').trim();

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
    ['flow', a.flow], ['seq', a.seq === undefined ? undefined : String(a.seq)], ['ref', a.ref], ['reftext', a.refText], ['apply', a.apply], ['applies', a.applies?.join(' | ')],
    ['writer', a.writer], ['agent', a.agent], ['delivered', a.delivered], ['undelivered', a.undelivered],
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
    setField(a, m[1], m[2].trim());
  }
  a.detail = detail.join('\n').trim();
  return a;
}

/** One known field from its stored text; a bad value is dropped. */
function setField(a: Ask, k: string, v: string): void {
  switch (k) {
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
    case 'flow': if (FLOW.test(v)) a.flow = v; break;
    case 'seq': if (/^\d{1,2}$/.test(v) && Number(v) >= 1) a.seq = Number(v); break;
    case 'ref': if (refOk(v)) a.ref = v; break;
    case 'reftext': a.refText = v; break;
    case 'apply': if (actionOk(v)) a.apply = v; break;
    case 'applies': { const parts = v.split(' | ').map((o) => o.trim()); if (parts.every(actionOk)) a.applies = parts; break; }
    case 'by': case 'created': case 'updated': case 'answered': case 'snoozed': case 'delivered': if (isoOk(v)) a[k] = v; break;
    case 'agent': if (parseAgentLink(v)) a.agent = v; break;
    default: (a as unknown as Record<string, string>)[k] = v;
  }
}

// ---------------------------------------------------------------- rows

/** The file for an ask with no task and no project file. @req FR:task-asks/place.default */
export const ASKS_FILE = 'tasks/asks.md';
const ASKS_HEAD = '# Asks\n\n## Open\n\n';
/** Priority emoji on the row; `normal` has none. @req FR:task-asks/format.fields */
const PRIORITY_MARK: Record<AskPriority, string> = { crit: '🚨', high: '‼️', normal: '', low: '🔻' };
const MARKS = /^\s*(🙋|🚨|‼️?|🔻)(?=\s|$)\s*/u;
/** Metadata keys that are row parts (text, emoji, checkbox), never read from metadata. */
const ROW_PARTS = new Set(['id', 'ask', 'priority', 'effort']);
const META_EXTRA = /^[a-z][a-z0-9_-]*:(?: .*)?$/;
const MARKER = /^\\*## (Detail|Thread)\s*$/;
const clean = (l: string) => l.replace(/^﻿/, '').replace(/\r$/, '');
const lead = (l: string) => /^\s*/.exec(clean(l))![0];
const width = (ws: string) => ws.replace(/\t/g, '    ').length;
const blank = (l: string | undefined) => l === undefined || clean(l).trim() === '';

/**
 * The ask as row lines: the 🙋 row, `> key: value` metadata, then `> ## Detail` and `> ## Thread` blockquote lines.
 * @req FR:task-asks/format.row @req FR:task-asks/format.fields
 */
export function formatAskRow(a: Ask, indent = ''): string[] {
  const sub = `${indent}  `;
  const mark = PRIORITY_MARK[a.priority];
  // `state` only when the checkbox and `answer` cannot tell it.
  const told = a.state === 'done' || a.state === (a.answer ? 'answered' : 'open');
  const f: [string, string | undefined][] = [
    ['id', a.key], ['state', told ? undefined : a.state], ['kind', a.kind], ['from', a.from], ['project', a.project], ['why', a.why], ['recommend', a.recommend],
    ['options', a.options?.join(' | ')], ['default', a.default], ['by', a.by], ['reversible', a.reversible ? 'yes' : undefined], ['link', a.link],
    ['time', a.effort], ['blocks', a.blocks ? String(a.blocks) : undefined], ['created', a.created], ['updated', a.updated],
    ['answer', a.answer], ['text', a.text], ['answered', a.answered], ['outcome', a.outcome], ['handled', a.handled], ['note', a.note], ['snoozed', a.snoozed],
    ['flow', a.flow], ['seq', a.seq === undefined ? undefined : String(a.seq)], ['ref', a.ref], ['reftext', a.refText], ['apply', a.apply], ['applies', a.applies?.join(' | ')],
    ['writer', a.writer], ['agent', a.agent], ['delivered', a.delivered], ['undelivered', a.undelivered],
  ];
  const lines = [
    `${indent}- [${a.state === 'done' ? 'x' : ' '}] 🙋 ${mark ? `${mark} ` : ''}${a.ask}`,
    ...f.filter(([, v]) => v !== undefined && v !== '').map(([k, v]) => `${sub}> ${k}: ${v}`),
    ...a.extra.filter((e) => META_EXTRA.test(e)).map((e) => `${sub}> ${e}`),
  ];
  const quote = (l: string) => (l === '' ? `${sub}>` : `${sub}> ${l}`);
  if (a.detail.trim()) lines.push(`${sub}> ## Detail`, ...a.detail.trim().split('\n').map((l) => quote(MARKER.test(l) ? `\\${l}` : l)));
  if (a.thread.length) lines.push(`${sub}> ## Thread`, ...a.thread.map(quote));
  return lines;
}

/** Last line (inclusive) of the row's own blockquote lines. */
function blockEnd(lines: string[], i: number): number {
  const w = width(lead(lines[i]));
  let j = i;
  while (j + 1 < lines.length) { const m = /^(\s*)>/.exec(clean(lines[j + 1])); if (!m || width(m[1]) <= w) break; j++; }
  return j;
}

/** Last non-blank line (inclusive) of the row's subtree: children, notes, metadata. */
function subtreeEnd(lines: string[], i: number): number {
  const w = width(lead(lines[i]));
  let last = i;
  for (let j = i + 1; j < lines.length; j++) {
    if (blank(lines[j])) continue;
    if (clean(lines[j]).startsWith('#') || width(lead(lines[j])) <= w) break;
    last = j;
  }
  return last;
}

/**
 * The ask's own lines after its block: blockquote lines at the block's indent, from the first `> ## Detail` or `> ## Thread` on,
 * anywhere in the row's subtree but outside its child rows (an owner note may come before them).
 * @req FR:task-asks/format.detail
 */
function moreLines(t: Task, lines: string[], end: number): number[] {
  const last = subtreeEnd(lines, t.line);
  if (last <= end) return [];
  const kids = new Set<number>();
  for (const c of t.children) for (let j = c.line, e = subtreeEnd(lines, c.line); j <= e; j++) kids.add(j);
  const w = width(lead(lines[t.line + 1] ?? ''));
  const out: number[] = [];
  let on = false;
  for (let j = end + 1; j <= last; j++) {
    const l = clean(lines[j]);
    if (kids.has(j) || !/^\s*>/.test(l) || width(lead(l)) !== w) continue;
    if (!on) { const body = l.trimStart().replace(/^> ?/, '').trimEnd(); on = body === '## Detail' || body === '## Thread'; }
    if (on) out.push(j);
  }
  return out;
}

/** The ask of a 🙋 row with `kind` metadata; null for any other row. @req FR:task-asks/format.row @req FR:task-asks/format.fields */
function askOfRow(t: Task, lines: string[], end: number, more: number[] = []): Ask | null {
  const meta = t.meta ?? [];
  const key = meta.find(([k]) => k === 'id')?.[1];
  if (!isAskRow(t) || !key || !KEY.test(key)) return null;
  const a: Ask = { key, state: 'open', ask: '', kind: 'approve', from: '', reversible: false, priority: 'normal', blocks: 0, created: '', updated: '', detail: '', thread: [], extra: [] };
  let text = t.text;
  let pri: AskPriority | undefined;
  for (let m = MARKS.exec(text); m; m = MARKS.exec(text)) {
    if (!pri) pri = (Object.keys(PRIORITY_MARK) as AskPriority[]).find((p) => PRIORITY_MARK[p] && PRIORITY_MARK[p].startsWith(m![1]));
    text = text.slice(m[0].length);
  }
  a.ask = text.trim();
  if (pri) a.priority = pri;
  let state: AskState | undefined;
  for (const [k, v] of meta) {
    if (k === 'id') continue;
    if (k === 'state') { if (oneOf(ASK_STATES, v)) state = v; continue; }
    if (k === 'time') { setField(a, 'effort', v); continue; }
    if (ROW_PARTS.has(k) || !(FIELDS as readonly string[]).includes(k)) { a.extra.push(v ? `${k}: ${v}` : `${k}:`); continue; }
    setField(a, k, v);
  }
  a.state = t.checked ? 'done' : state ?? (a.answer ? 'answered' : 'open');
  let section: 'head' | 'detail' | 'thread' = 'head';
  const detail: string[] = [];
  const own = [...Array(end - t.line).keys()].map((k) => t.line + 1 + k).concat(more);
  for (const j of own) {
    const q = clean(lines[j]).trimStart();
    const body = q === '>' ? '' : q.slice(q.startsWith('> ') ? 2 : 1);
    if (body.trimEnd() === '## Detail') { section = 'detail'; continue; }
    if (body.trimEnd() === '## Thread') { section = 'thread'; continue; }
    if (section === 'detail') detail.push(MARKER.test(body) ? body.slice(1) : body);
    else if (section === 'thread' && body.startsWith('- ')) a.thread.push(body);
  }
  a.detail = detail.join('\n').trim();
  return a;
}

/** An ask row: its line, the last line of its block, and its own lines after the block (`FR:task-asks/format.detail`). */
export interface AskRow { ask: Ask; line: number; end: number; more: number[] }

/** The ask rows of a task file, and the `id` of every other row (`FR:task-asks/place.unique`). */
function parseFile(content: string): { rows: AskRow[]; ids: string[] } {
  const p = parseProject(content);
  const fenced = fencedLines(p.lines);
  const rows: AskRow[] = [];
  const ids: string[] = [];
  const walk = (ts: Task[]) => { for (const t of ts) {
    if (!fenced.has(t.line)) {
      const end = blockEnd(p.lines, t.line);
      const more = isAskRow(t) ? moreLines(t, p.lines, end) : [];
      const a = askOfRow(t, p.lines, end, more);
      if (a) rows.push({ ask: a, line: t.line, end, more });
      else { const id = t.meta?.find(([k]) => k === 'id')?.[1]; if (id) ids.push(id); }
    }
    walk(t.children);
  } };
  for (const s of p.sections) walk(s.tasks);
  return { rows, ids };
}

/** Every ask row of a task file, in file order (rows in a code fence are examples). @req FR:task-asks/format.row */
export function readAskRows(content: string): AskRow[] {
  return parseFile(content).rows;
}

/**
 * Replaces `del` lines at `at` with `rows`, in the file's line ending; a file with no final newline keeps none.
 * @req FR:task-asks/format.roundtrip
 */
function spliceRows(lines: string[], at: number, del: number, rows: string[]): void {
  const eol = lines.some((l) => l.endsWith('\r')) ? '\r' : '';
  const atEnd = at + del === lines.length;
  if (atEnd && at > 0) {
    if (rows.length && del === 0 && eol && !lines[at - 1].endsWith('\r')) lines[at - 1] += eol;
    if (!rows.length) lines[at - 1] = lines[at - 1].replace(/\r$/, '');
  }
  lines.splice(at, del, ...rows.map((r, i) => r + (atEnd && i === rows.length - 1 ? '' : eol)));
}

/** Where a new row goes at the end of the first `## ` section; null when the file has none. */
function sectionEnd(lines: string[]): { at: number; gap: boolean } | null {
  const h = lines.findIndex((l) => clean(l).startsWith('## '));
  if (h < 0) return null;
  let k = h + 1;
  while (k < lines.length && !clean(lines[k]).startsWith('## ')) k++;
  let last = k - 1;
  while (last > h && blank(lines[last])) last--;
  // Right under the heading, keep one blank line between it and the first row.
  if (last === h) return blank(lines[h + 1]) && h + 1 < k ? { at: h + 2, gap: false } : { at: h + 1, gap: true };
  return { at: last + 1, gap: false };
}

/** A row by line, else by its text when that is unique (the line moved); null when gone. */
function findRow(lines: string[], line: number, text?: string): number | null {
  const ROW = /^\s*- \[[ xX]\] (.+)$/;
  const at = (i: number) => ROW.exec(clean(lines[i] ?? ''))?.[1];
  const cur = at(line);
  if (cur !== undefined && (text === undefined || rowKey(cur) === rowKey(text))) return line;
  if (text === undefined) return null;
  const hits = lines.map((_, i) => i).filter((i) => { const t = at(i); return t !== undefined && rowKey(t) === rowKey(text); });
  return hits.length === 1 ? hits[0] : null;
}

type Pending = Map<string, { lines: string[]; version: string | null }>;

/**
 * A file to edit: from the snapshot when it has it (so the write is checked against the versions the key was checked on), else read.
 * @req FR:task-asks/place.unique @req FR:task-asks/core.reads
 */
async function load(ctx: LifecycleContext, files: Pending, path: string, snap?: Snapshot): Promise<{ lines: string[]; version: string | null } | null> {
  const hit = files.get(path);
  if (hit) return hit;
  const have = snap?.files.get(path);
  if (have) { const v = { lines: have.content.split('\n'), version: have.version }; files.set(path, v); return v; }
  try { const f = await ctx.storage.read(path); const v = { lines: f.content.split('\n'), version: f.version }; files.set(path, v); return v; }
  catch (e) { if (e instanceof NotFoundError) return null; throw e; }
}

/**
 * Inserts a new ask row: last child of its `ref` row, else end of its project's first section, else `tasks/asks.md`. Returns the path.
 * @req FR:task-asks/place.ref @req FR:task-asks/place.project @req FR:task-asks/place.default
 */
async function place(ctx: LifecycleContext, files: Pending, a: Ask, snap?: Snapshot): Promise<string> {
  if (a.ref) {
    const r = parseTaskRef(a.ref);
    const f = await load(ctx, files, r.path, snap);
    const line = f ? findRow(f.lines, r.line, a.refText) : null;
    if (f && line !== null) { spliceRows(f.lines, subtreeEnd(f.lines, line) + 1, 0, formatAskRow(a, `${lead(f.lines[line])}  `)); return r.path; }
  }
  const path = a.project ? projectPath(a.project) : '';
  if (a.project && TASK_PATH.test(path) && !isReadme(path) && path !== ASKS_FILE) {
    const f = await load(ctx, files, path, snap);
    const s = f ? sectionEnd(f.lines) : null;
    if (f && s) { spliceRows(f.lines, s.at, 0, [...(s.gap ? [''] : []), ...formatAskRow(a)]); return path; }
  }
  let f = await load(ctx, files, ASKS_FILE, snap);
  if (!f) { f = { lines: ASKS_HEAD.split('\n'), version: null }; files.set(ASKS_FILE, f); }
  let s = sectionEnd(f.lines);
  if (!s) { spliceRows(f.lines, f.lines.length - (blank(f.lines[f.lines.length - 1]) ? 1 : 0), 0, ['', '## Open', '']); s = sectionEnd(f.lines)!; }
  spliceRows(f.lines, s.at, 0, [...(s.gap ? [''] : []), ...formatAskRow(a)]);
  return ASKS_FILE;
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

/** One ask row and the file read it came from. */
interface Found extends AskRow { path: string; version: string; content: string }
/** One read of every task file: ask rows (first per key, and all), file contents, and the `id` of every other row. */
interface Snapshot { rows: Found[]; all: Found[]; files: Map<string, { content: string; version: string }>; ids: Set<string> }

/**
 * The task file that holds an ask key's row (the first in sort order), else `tasks/asks.md`.
 * @req FR:task-asks/place.unique
 */
export async function askFile(ctx: LifecycleContext, key: string): Promise<string> {
  asksPath(key);
  return (await locate(ctx, key))?.path ?? ASKS_FILE;
}

async function locate(ctx: LifecycleContext, key: string): Promise<Found | null> {
  return (await snapshot(ctx)).rows.find((r) => r.ask.key === key) ?? null;
}

export async function readAsk(ctx: LifecycleContext, key: string): Promise<{ ask: Ask; version: string; path: string } | null> {
  const f = await locate(ctx, key);
  return f ? { ask: f.ask, version: f.version, path: f.path } : null;
}

/** The row's lines with its own lines after the block (`FR:task-asks/format.detail`) removed and its block replaced. */
function rewrite(cur: Found, a: Ask | null): string[] {
  const lines = cur.content.split('\n');
  for (const j of [...cur.more].sort((x, y) => y - x)) spliceRows(lines, j, 1, []);
  spliceRows(lines, cur.line, cur.end - cur.line + 1, a ? formatAskRow(a, lead(lines[cur.line])) : []);
  return lines;
}

/**
 * Rewrites the ask's own row and lines in place, or inserts a new row (`FR:task-asks/place.*`), against the snapshot's file versions.
 * A create then checks the key again: when another row holds it, its own row is removed and the write is a conflict, so the caller retries and finds that row.
 * @req FR:task-asks/format.roundtrip @req FR:task-asks/format.detail @req FR:task-asks/place.unique
 */
async function save(ctx: LifecycleContext, snap: Snapshot, cur: Found | null, a: Ask, message: string): Promise<void> {
  if (cur) {
    await ctx.storage.write(cur.path, rewrite(cur, a).join('\n'), { expectedVersion: cur.version, message });
    return;
  }
  const files: Pending = new Map();
  const path = await place(ctx, files, a, snap);
  const f = files.get(path)!;
  await ctx.storage.write(path, f.lines.join('\n'), { expectedVersion: f.version, message });
  for (let tries = 0; tries < 5; tries++) {
    const hits = (await snapshot(ctx)).all.filter((r) => r.ask.key === a.key);
    const mine = hits.find((r) => r.path === path);
    if (!mine || hits.length < 2) return;
    try { await ctx.storage.write(path, rewrite(mine, null).join('\n'), { expectedVersion: mine.version, message: `Ask key taken: ${a.key}` }); }
    catch (e) { if (e instanceof ConflictError) continue; throw e; }
    throw new ConflictError(`Ask key taken: ${a.key}`);
  }
}

/** The api ref (`<project>:<line>`, 0-based) of a stored `tasks/<file>.md:<line>` (1-based). */
export const apiRefOf = (stored: string): string | undefined => { const m = /^tasks\/(.+)\.md:(\d+)$/.exec(stored); return m ? `${m[1]}:${Number(m[2]) - 1}` : undefined; };

/** Ask writes of one storage, one at a time in this process, so two creates of one key never race here. @req FR:task-asks/place.unique */
const queues = new WeakMap<object, Promise<unknown>>();
function serial<T>(ctx: LifecycleContext, f: () => Promise<T>): Promise<T> {
  const run = (queues.get(ctx.storage) ?? Promise.resolve()).then(f, f);
  queues.set(ctx.storage, run.catch(() => undefined));
  return run;
}

/**
 * Retries a read-modify-write when another writer got in between. Each attempt reads the task files once and hands that read to `fn` and the write.
 * @req FR:task-asks/core.reads
 */
type Step<T> = { next: Ask; message: string; result: T } | { skip: T };
function mutate<T>(ctx: LifecycleContext, key: string, fn: (cur: Found | null, snap: Snapshot) => Step<T>): Promise<T> {
  return serial(ctx, async () => {
    for (let tries = 0; ; tries++) {
      const snap = await snapshot(ctx);
      const cur = snap.rows.find((r) => r.ask.key === key) ?? null;
      const r = fn(cur, snap);
      if ('skip' in r) return r.skip;
      try { await save(ctx, snap, cur, r.next, r.message); return r.result; }
      catch (e) { if (!(e instanceof ConflictError) || tries >= 5) throw e; }
    }
  });
}

function line(name: string, v: unknown, max = MAX_LINE, optional = true): string | undefined {
  if (v === undefined || v === null) { if (optional) return undefined; throw new LifecycleError(`${name} is required`); }
  if (typeof v !== 'string') throw new LifecycleError(`${name} must be a string`);
  const t = oneLine(v);
  if (t === '') { if (optional) return undefined; throw new LifecycleError(`${name} must not be empty`); }
  if (t.length > max) throw new LifecycleError(`${name} must be at most ${max} characters`);
  return t;
}

const OWNER_FIELDS = ['answer', 'text', 'answered', 'outcome', 'handled', 'note', 'snoozed', 'state', 'created', 'updated', 'delivered', 'undelivered'];

/** Validates agent input; returns only the fields the agent sent. */
function checkPut(input: AskPut): Partial<Ask> & { detail?: string } {
  for (const k of OWNER_FIELDS) if (k in (input as object)) throw new LifecycleError(`Agents cannot write ${k}`);
  const out: Partial<Ask> & { detail?: string } = {};
  // @req FR:task-asks/format.clean: no Stack mark in the text; empty after the strip is refused.
  // Strip before and after the clean-up: it folds some marks (‼️ to !!) and could join parts into one.
  if (input.ask !== undefined) { out.ask = stripMarks(line('ask', typeof input.ask === 'string' ? stripMarks(input.ask) : input.ask, MAX_ASK, false)!); if (!out.ask) throw new LifecycleError('ask must not be empty'); }
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
  // quick triage fields. @req FR:quick-triage/flow.fields @req FR:quick-triage/flow.actions
  if (input.flow !== undefined) { if (typeof input.flow !== 'string' || !FLOW.test(input.flow)) throw new LifecycleError('flow must be a slug like triage-oct29'); out.flow = input.flow; }
  if (input.seq !== undefined) { if (!Number.isInteger(input.seq) || input.seq < 1 || input.seq > 99) throw new LifecycleError('seq must be 1-99'); out.seq = input.seq; }
  if (input.ref !== undefined) { parseTaskRef(input.ref); out.ref = input.ref as string; }
  if (input.apply !== undefined) { const v = line('apply', input.apply, MAX_LINE, false)!; parseAction(v); out.apply = v; }
  if (input.applies !== undefined) {
    if (!Array.isArray(input.applies) || !input.applies.every((x) => typeof x === 'string')) throw new LifecycleError('applies must list one action per option');
    out.applies = input.applies.map((x, i) => { const v = line(`applies[${i}]`, x, MAX_LINE, false)!.replace(/\|/g, '/'); parseAction(v); return v; }); // one clean line each; `|` separates the stored list
  }
  // @req FR:ask-routing/addr.link @req FR:ask-routing/addr.api
  if (input.agent !== undefined) {
    const l = typeof input.agent === 'string' ? parseAgentLink(input.agent) : null;
    if (!l) throw new LifecycleError('agent must be a link like [Name](#local_<id>)');
    out.agent = `[${oneLine(l.name).replace(/[[\]]/g, '')}](#${l.id})`;
  }
  if (input.detail !== undefined) {
    if (typeof input.detail !== 'string' || input.detail.length > MAX_DETAIL) throw new LifecycleError(`detail must be at most ${MAX_DETAIL} characters`);
// eslint-disable-next-line no-control-regex
    out.detail = input.detail.replace(INVISIBLE, '').replace(/\u0000/g, '').replace(/\r/g, '').replace(/^## (Detail|Thread)\s*$/gim, '\\$&').trim();
  }
  return out;
}

/** A write the caller may not make; the message is fixed text. */
export class AskDenied extends Error {}
/** A new agent ask without context; fixed text, so the API may relay it. @req FR:ask-routing/addr.context */
export class AskNeedsContext extends LifecycleError { constructor() { super('why is required: say what you need and why in one line'); } }

/** Creates or updates an ask. `opts.writer` names a token caller, which may update only asks it wrote. @req FR:ask-queue/flow.put */
export async function putAsk(ctx: LifecycleContext, key: string, input: AskPut, actor: string, opts: { writer?: string; /** An agent surface (CLI, token, MCP): a new ask needs `why`. */ agent?: boolean } = {}): Promise<{ key: string; created: boolean }> {
  asksPath(key);
  const fields = checkPut(input);
  // @req FR:ask-routing/ask.put: only the owner asks as the owner, and an owner question names the agent that must answer.
  if (fields.from === OWNER && opts.writer) throw new AskDenied('Only the owner can ask as the owner');
  if (fields.from === OWNER && !fields.kind) fields.kind = 'answer';
  if (fields.ref !== undefined) { try { fields.refText = (await readRow(ctx, parseTaskRef(fields.ref))).row[3]; } catch (e) { if (e instanceof NotFoundError) throw e; throw new LifecycleError(`ref: ${e instanceof Error ? e.message : 'no such row'}`); } }
  const now = clock(ctx).toISOString();
  return mutate<{ key: string; created: boolean }>(ctx, key, (cur, snap) => {
    if (!cur) {
      // @req FR:task-asks/place.unique: a new key never takes a task's ID.
      if (snap.ids.has(key)) throw new LifecycleError(`Ask key "${key}" is a task ID; use another key`);
      const from = fields.from ?? line('from', actor, 80);
      if (!fields.ask || !fields.kind || !from) throw new LifecycleError('ask, kind and from are required');
      // @req FR:ask-routing/addr.context
      if (opts.agent && from !== OWNER && !fields.why) throw new AskNeedsContext();
      if (from === OWNER && !fields.agent) throw new LifecycleError('agent is required: name the session that must answer');
      if (fields.kind === 'decide' && !fields.options) throw new LifecycleError('options are required for kind decide');
      if (fields.applies && fields.applies.length !== (fields.options ?? []).length) throw new LifecycleError('applies must have one entry per option');
      const next: Ask = { key, state: 'open', reversible: false, priority: 'normal', blocks: 0, detail: '', thread: [], extra: [], ...fields, ask: fields.ask, kind: fields.kind, from, created: now, updated: now, writer: opts.writer ?? actor };
      return { next, message: `Ask: ${key}`, result: { key, created: true } };
    }
    const old = cur.ask;
    // A token updates only its own asks; an ask written before `writer` existed stays open to any writer (security M5).
    if (opts.writer && old.writer && old.writer !== opts.writer) throw new AskDenied('Only the agent that wrote this ask can change it');
    if (old.state === 'done' && input.reopen !== true) throw new ConflictError('Ask is done; send reopen to open it again');
    const next: Ask = { ...old, ...fields, key, updated: now };
    if (next.kind !== 'decide') delete next.options;
    if (next.kind === 'decide' && !next.options) throw new LifecycleError('options are required for kind decide');
    if (next.applies && next.applies.length !== (next.options ?? []).length) throw new LifecycleError('applies must have one entry per option');
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
  // Quick triage: the answer is recorded, then the action runs; a failed action reopens the ask and is a conflict, so a retry runs it once.
  // @req FR:quick-triage/flow.apply @req FR:quick-triage/flow.text
  // @req FR:task-asks/core.reads: the ask before the answer comes from the answer's own read.
  const seen: { ask?: Ask } = {};
  const result = await recordAnswer(ctx, key, input, text, now, nowD, seen);
  const before = seen.ask ? { ask: seen.ask } : null;
  let action: Action | null = null;
  if (before && before.ask.state === 'open' && before.ask.ref && before.ask.from !== OWNER) {
    const a = before.ask;
    if (input.answer === 'go' && a.apply) action = parseAction(a.apply);
    else if (input.answer === 'option' && a.applies && a.options) { const i = a.options.indexOf(text!); if (i >= 0 && a.applies[i]) action = parseAction(a.applies[i]); }
    else if (a.kind === 'answer' && (input.answer === 'reply' || input.answer === 'ask')) action = { kind: 'note', text: `🙋 ${now.slice(0, 10)}: ${text}` };
  }
  // @req FR:task-asks/core.wake: wake files are keyed by ask key and `from`, so they work the same for ask rows.
  if (result.changed && before && before.ask.from !== OWNER && !['defer'].includes(input.answer)) await updateWake(ctx, before.ask.from, key, input.answer === 'retract' ? null : input.answer, nowD);
  if (action && before) {
    let r;
    try { r = await applyAction(ctx, { ...parseTaskRef(before.ask.ref!), text: before.ask.refText }, action); }
    catch (e) {
      // whatever state the agent left it in, the ask is open again with the reason; the owner's reply line goes too, so a retry writes once
      const why = e instanceof Error ? e.message : 'failed';
      await mutate<void>(ctx, key, (cur) => {
        if (!cur) return { skip: undefined };
        const a = { ...cur.ask }; a.state = 'open'; delete a.answer; delete a.text; delete a.answered; delete a.outcome; delete a.handled; a.updated = now;
        a.thread = [...a.thread.filter((l) => l !== `- ${now} you: ${text}`), `- ${now} failed: ${describeAction(action!)} (${why})`];
        return { next: a, message: `Ask reopened (action failed): ${key}`, result: undefined };
      });
      await updateWake(ctx, before!.ask.from, key, null, nowD);
      throw e;
    }
    const applied = r.changed ? `${describeAction(action)} → ${r.after ?? r.before ?? ''}`.trim() : `${describeAction(action)} (${r.message ?? 'no change'})`;
    await mutate<void>(ctx, key, (cur) => (cur ? { next: { ...cur.ask, thread: [...cur.ask.thread, `- ${now} applied: ${applied}`] }, message: `Ask applied: ${key}`, result: undefined } : { skip: undefined }));
  }
  return result;
}

/** The owner's answer on the ask file itself. */
async function recordAnswer(ctx: LifecycleContext, key: string, input: AnswerInput, text: string | undefined, now: string, nowD: Date, seen: { ask?: Ask }): Promise<{ changed: boolean }> {
  return mutate<{ changed: boolean }>(ctx, key, (cur) => {
    if (!cur) throw new NotFoundError(`Ask not found: ${key}`);
    seen.ask = cur.ask;
    const a = { ...cur.ask };
    if (input.answer === 'retract') {
      if (a.state !== 'answered') throw new ConflictError('Nothing to retract');
      a.state = 'open';
      for (const k of ['answer', 'text', 'answered'] as const) delete a[k];
      a.updated = now;
      return { next: a, message: `Ask retracted: ${key}`, result: { changed: true } };
    }
    // @req FR:ask-routing/ask.follow: on his own question the owner follows up (the agent's turn again) or closes it.
    if (a.from === OWNER && a.state !== 'done' && input.answer !== 'defer') {
      if (input.answer === 'done') {
        a.state = 'done'; a.outcome = 'handled'; a.handled = `${now} by ${OWNER}`; a.updated = now;
        return { next: a, message: `Ask closed: ${key}`, result: { changed: true } };
      }
      if (input.answer !== 'reply' && input.answer !== 'ask') throw new LifecycleError('answer must be reply, ask or done on your own question');
      a.state = 'open'; a.updated = now;
      for (const k of ['answer', 'text', 'answered', 'delivered', 'undelivered'] as const) delete a[k];
      a.thread = [...a.thread, `- ${now} you: ${text}`];
      return { next: a, message: `Ask follow-up: ${key}`, result: { changed: true } };
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
    // @req FR:ask-routing/deliver.reset: the agent's turn starts undelivered.
    a.state = 'answered'; a.answer = input.answer; a.answered = now; a.updated = now; delete a.snoozed; delete a.delivered; delete a.undelivered;
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
  let from = '';
  const res = await mutate<{ changed: boolean }>(ctx, key, (cur) => {
    if (!cur) throw new NotFoundError(`Ask not found: ${key}`);
    from = cur.ask.from;
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
  // @req FR:ask-queue/wake.clear
  if (from) await updateWake(ctx, from, key, null, new Date(now));
  return res;
}

/**
 * The caller's own session as a link, from the environment Claude Code gives every tool call: the desktop id (`local_…`), else
 * `local_<Claude Code session id>`. Undefined outside a session.
 * @req FR:ask-routing/addr.env
 */
export function envLink(name: string, env: Record<string, string | undefined>): string | undefined {
  const host = env.CLAUDE_CODE_HOST_SESSION_ID?.trim();
  const cli = env.CLAUDE_CODE_SESSION_ID?.trim();
  const id = host && /^local_[A-Za-z0-9_-]+$/.test(host) ? host : cli && /^[A-Za-z0-9_-]+$/.test(cli) ? `local_${cli}` : undefined;
  const label = oneLine(name).replace(/[[\]]/g, '').slice(0, 80);
  return id && label ? `[${label}](#${id})` : undefined;
}

/** A thread name: the actor without line breaks or `:`, at most 64 characters. */
const threadName = (actor: string) => oneLine(actor).replace(/[:[\]]/g, '').slice(0, 64).trim() || 'agent';

/**
 * The agent's reply in the thread: answers an owner question, reopens an answered agent ask, or adds context to an open one.
 * @req FR:ask-routing/reply.cmd
 */
export async function replyAsk(ctx: LifecycleContext, key: string, input: { text: string; agent?: string }, actor: string): Promise<{ changed: boolean }> {
  asksPath(key);
  const text = line('text', input.text, MAX_TEXT, false)!;
  const link = input.agent === undefined ? undefined : checkPut({ agent: input.agent }).agent;
  const who = threadName(actor);
  const nowD = clock(ctx);
  const now = nowD.toISOString();
  let from = '';
  const res = await mutate<{ changed: boolean }>(ctx, key, (cur) => {
    if (!cur) throw new NotFoundError(`Ask not found: ${key}`);
    if (cur.ask.state === 'done') throw new ConflictError('Ask is done');
    const a = { ...cur.ask, updated: now, thread: [...cur.ask.thread, `- ${now} ${who}: ${text}`] };
    if (link) a.agent = link;
    from = a.from;
    if (a.from === OWNER) {
      if (a.state === 'answered') return { next: a, message: `Ask reply: ${key}`, result: { changed: true } }; // more for the owner to read
      a.state = 'answered'; a.answer = 'reply'; a.text = text; a.answered = now;
    } else if (a.state === 'answered') {
      a.state = 'open';
      for (const k of ['answer', 'text', 'answered', 'outcome', 'handled', 'snoozed', 'delivered', 'undelivered'] as const) delete a[k];
    }
    return { next: a, message: `Ask reply: ${key}`, result: { changed: true } };
  });
  if (from && from !== OWNER) await updateWake(ctx, from, key, null, nowD);
  return res;
}

/** What the courier records on an ask. */
export type DeliveryMark = { claim: true } | { sent: string } | { release: true } | { failed: string };

/**
 * The courier's marks, each one version-checked write: `claim` takes the turn for delivery (true only for the one writer that set it),
 * `sent` logs the delivery, `release` gives a busy session's turn back, `failed` records why it could not be delivered.
 * @req FR:ask-routing/deliver.once @req FR:ask-routing/deliver.wake @req FR:ask-routing/deliver.find
 */
export async function markDelivery(ctx: LifecycleContext, key: string, m: DeliveryMark): Promise<boolean> {
  const now = clock(ctx).toISOString();
  return mutate<boolean>(ctx, key, (cur) => {
    if (!cur) return { skip: false };
    const a = { ...cur.ask };
    if ('claim' in m) {
      if (askTurn(a) !== 'agent' || !a.agent || a.delivered || a.undelivered) return { skip: false };
      a.delivered = now;
      return { next: a, message: `Ask delivery: ${key}`, result: true };
    }
    if (!a.delivered) return { skip: false };
    if ('sent' in m) a.thread = [...a.thread, `- ${now} stack: delivered to ${threadName(m.sent)}`];
    else {
      delete a.delivered;
      if ('failed' in m) { a.undelivered = line('reason', m.failed, 200) ?? 'failed'; a.thread = [...a.thread, `- ${now} stack: not delivered (${a.undelivered})`]; }
    }
    return { next: a, message: `Ask delivery: ${key}`, result: true };
  });
}

/**
 * Every ask row in every task file, parsed once per file version. A key in two rows: the first in sort order wins.
 * @req FR:task-asks/place.unique @req FR:task-structure/system.ask-key
 */
async function snapshot(ctx: LifecycleContext): Promise<Snapshot> {
  let cache = parsed.get(ctx.storage);
  if (!cache) { cache = new Map(); parsed.set(ctx.storage, cache); }
  const snap: Snapshot = { rows: [], all: [], files: new Map(), ids: new Set() };
  const keys = new Set<string>();
  const seen = new Set<string>();
  for (const path of (await ctx.storage.list()).filter((p) => !isReadme(p))) {
    seen.add(path);
    let f;
    try { f = await ctx.storage.read(path); } catch (e) { if (e instanceof NotFoundError) continue; throw e; }
    snap.files.set(path, { content: f.content, version: f.version });
    const hit = cache.get(path);
    const one = hit && hit.version === f.version ? hit : { version: f.version, ...parseFile(f.content) };
    cache.set(path, one);
    for (const id of one.ids) snap.ids.add(id);
    for (const r of one.rows) {
      const found = { ...r, path, version: f.version, content: f.content };
      snap.all.push(found);
      if (keys.has(r.ask.key)) continue;
      keys.add(r.ask.key);
      snap.rows.push(found);
    }
  }
  for (const p of cache.keys()) if (!seen.has(p)) cache.delete(p);
  return snap;
}

/** Every well-formed ask. */
async function readAll(ctx: LifecycleContext): Promise<Ask[]> {
  return (await snapshot(ctx)).rows.map((r) => r.ask).filter((a) => a.ask && a.from && a.created);
}

/** The old archive path for a key in a `.stack` folder (the root one by default). @req FR:ask-queue/ask.archive @req FR:task-structure/system.ask-key */
export const archivePath = (key: string, dir: string = ROOT_SYSTEM): string => `${dir}/asks/archive/${key}.md`;

/**
 * Deletes the rows (with their lines) of `done` asks untouched for `days` days, one write (one commit) for all; git history keeps them.
 * @req FR:ask-queue/ask.archive
 * @req FR:task-asks/core.archive
 */
export async function archiveAsks(ctx: LifecycleContext, o: { days?: number } = {}): Promise<{ archived: string[] }> {
  const days = o.days ?? 14;
  if (!Number.isInteger(days) || days < 0 || days > 3650) throw new LifecycleError('days must be a whole number of days (0-3650)');
  const cutoff = clock(ctx).getTime() - days * 86_400_000;
  const byFile = new Map<string, Found[]>();
  for (const r of (await snapshot(ctx)).rows) {
    const updated = Date.parse(r.ask.updated);
    // An ask whose `updated` cannot be read is left alone rather than archived at once.
    if (r.ask.state !== 'done' || !Number.isFinite(updated) || updated > cutoff) continue;
    // @req FR:task-asks/core.archive: a subtree with an open row or a line that is not the ask's own (owner note, child row) stays.
    const lines = r.content.split('\n');
    const own = new Set(r.more);
    let foreign = false;
    for (let j = r.end + 1, e = subtreeEnd(lines, r.line); j <= e && !foreign; j++) foreign = !own.has(j) && !blank(lines[j]);
    if (foreign) continue;
    byFile.set(r.path, [...(byFile.get(r.path) ?? []), r]);
  }
  const writes: FileWrite[] = [];
  const archived: string[] = [];
  for (const [path, rows] of byFile) {
    const lines = rows[0].content.split('\n');
    for (const r of [...rows].sort((a, b) => b.line - a.line)) { spliceRows(lines, r.line, subtreeEnd(lines, r.line) - r.line + 1, []); archived.push(r.ask.key); }
    writes.push({ path, content: lines.join('\n'), expectedVersion: rows[0].version });
  }
  archived.sort();
  if (writes.length) await writeAll(ctx.storage, writes, archived.length === 1 ? `Archive ask: ${archived[0]}` : `Archive ${archived.length} asks`);
  return { archived };
}

/**
 * One-time import: each open or answered ask file becomes an ask row (`FR:task-asks/place.*`), in one write; the files stay.
 * A key already present as a row is skipped.
 * @req FR:task-asks/import.cmd
 * @req FR:task-asks/import.idempotent
 */
export async function importAsks(ctx: LifecycleContext, o: { dryRun?: boolean } = {}): Promise<{ imported: string[]; skipped: string[]; files: string[] }> {
  const snap = await snapshot(ctx);
  const have = new Set(snap.rows.map((r) => r.ask.key));
  const files: Pending = new Map();
  const changed = new Set<string>();
  const imported: string[] = [];
  const skipped = new Set<string>();
  for (const path of (await ctx.storage.listAsks?.()) ?? []) {
    const key = path.replace(/^.*\//, '').replace(/\.md$/, '');
    if (!KEY.test(key)) continue;
    if (have.has(key)) { skipped.add(key); continue; }
    const a = parseAsk(key, (await ctx.storage.read(path)).content);
    if (a.state === 'done' || !a.ask || !a.from || !a.created) continue;
    a.extra = a.extra.map((e) => e.replace(/^- /, ''));
    // @req FR:task-asks/format.clean
    a.ask = stripMarks(a.ask);
    if (!a.ask) continue;
    changed.add(await place(ctx, files, a, snap));
    imported.push(key);
    have.add(key);
  }
  const writes: FileWrite[] = [...changed].sort().map((p) => ({ path: p, content: files.get(p)!.lines.join('\n'), expectedVersion: files.get(p)!.version }));
  if (writes.length && !o.dryRun) await writeAll(ctx.storage, writes, `Import ${imported.length} asks`);
  return { imported, skipped: [...skipped].sort(), files: writes.map((w) => w.path) };
}

/** Ranked list. @req FR:ask-queue/ask.rank @req FR:ask-queue/flow.default */
export async function listAsks(ctx: LifecycleContext, o: { state?: (typeof LIST_STATES)[number]; limit?: number; turn?: AskTurn } = {}, at?: Date): Promise<AskList> {
  // @req FR:ask-routing/turn.list: a turn alone lists that side's live asks (open or answered, not snoozed), ranked like the open list.
  const byTurn = o.turn !== undefined && o.state === undefined;
  const state = o.state ?? 'open';
  if (!oneOf(LIST_STATES, state)) throw new LifecycleError(`state must be one of ${LIST_STATES.join(', ')}`);
  if (o.turn !== undefined && !oneOf(['owner', 'agent', 'none'] as const, o.turn)) throw new LifecycleError('turn must be one of owner, agent, none');
  const now = at ?? clock(ctx);
  const all = await readAll(ctx);
  const latest = all.map((a) => a.updated).sort().pop();
  const snoozed = (a: Ask) => !!a.snoozed && Date.parse(a.snoozed) > now.getTime();
  const lastReply = (a: Ask) => { const m = a.thread.length ? /^- \S+ (\S+): (.*)$/.exec(a.thread[a.thread.length - 1]) : null; return m && m[1] !== 'you' ? m[2] : undefined; };
  // @req FR:agent-thread/ask.ref: asks with a task report it as an api ref, and where that row is now.
  const rowOf = await currentRows(ctx, all.filter((a) => a.ref && a.refText).map((a) => { const r = parseTaskRef(a.ref!); return { id: a.key, ref: `${r.path}:${r.line + 1}`, task: inboxTitle(a.refText!) }; })).catch(() => new Map<string, string>());
  const decorate = (a: Ask): ListedAsk => {
    const { extra, thread, ...rest } = a;
    void extra;
    const agentReply = a.state === 'open' ? lastReply({ ...a, thread }) : undefined;
    const flow = a.flow ? all.filter((x) => x.flow === a.flow) : [];
    const progress = a.flow ? { flowTotal: flow.length, flowDone: flow.filter((x) => x.state !== 'open').length } : {};
    const cur = rowOf.get(a.key);
    return { ...rest, ...(a.refText ? { task: inboxTitle(a.refText) } : {}), ...(cur ? { row: apiRefOf(cur) } : {}), turn: askTurn(a), score: scoreAsk(a, now), overdue: a.state === 'open' && !!a.by && Date.parse(a.by) < now.getTime(), ...(a.snoozed ? { snoozedUntil: a.snoozed } : {}), ...(agentReply ? { agentReply } : {}), ...progress };
  };
  /** A flow's questions sit together, by seq, where its best-scored question ranks. @req FR:quick-triage/flow.order */
  const flowsTogether = (sorted: Ask[]): Ask[] => {
    const out: Ask[] = [];
    const seen = new Set<string>();
    for (const a of sorted) {
      if (!a.flow) { out.push(a); continue; }
      if (seen.has(a.flow)) continue;
      seen.add(a.flow);
      out.push(...sorted.filter((x) => x.flow === a.flow).sort((x, y) => (x.seq ?? 99) - (y.seq ?? 99) || x.key.localeCompare(y.key)));
    }
    return out;
  };
  let rows: Ask[];
  const turnOk = (a: Ask) => o.turn === undefined || askTurn(a) === o.turn;
  if (state === 'open' || byTurn) {
    rows = flowsTogether(all.filter((a) => (byTurn ? a.state !== 'done' : a.state === 'open') && !snoozed(a) && turnOk(a)).sort((a, b) => scoreAsk(b, now) - scoreAsk(a, now) || (Date.parse(a.by ?? '') || Infinity) - (Date.parse(b.by ?? '') || Infinity) || a.created.localeCompare(b.created) || a.key.localeCompare(b.key)));
  } else if (state === 'snoozed') rows = all.filter((a) => a.state === 'open' && snoozed(a)).sort((a, b) => (a.snoozed ?? '').localeCompare(b.snoozed ?? ''));
  else if (state === 'answered') rows = all.filter((a) => a.state === 'answered').sort((a, b) => (a.answered ?? '').localeCompare(b.answered ?? ''));
  else if (state === 'done') rows = all.filter((a) => a.state === 'done').sort((a, b) => b.updated.localeCompare(a.updated));
  else rows = all.sort((a, b) => a.key.localeCompare(b.key));
  rows = rows.filter(turnOk);
  const total = rows.length;
  const items = rows.slice(0, o.limit ?? 50).map(decorate);
  if (state === 'open' || byTurn) items.forEach((it, i) => { it.rank = i + 1; });
  return { items, total, latest, snoozed: all.filter((a) => a.state === 'open' && snoozed(a)).length };
}
