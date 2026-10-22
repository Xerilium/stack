/**
 * Task lifecycle: operations on task documents (start, complete, skip, resume, suspend, set,
 * remove-completed, add-project, add-task, sweeps, next). Edits touch only the edited lines;
 * every other byte of a file is written back unchanged. Text rules follow the legacy PowerShell Stack.
 */
import { getDefaults, StackConfig } from './config';
import { parseProject, Project } from './parser';
import { rollRecurring } from './recurring';
import { getEngine, rankTasks, ScoringTask, toScoringProject } from './scoring';
import { ConflictError, NotFoundError, Storage } from './storage';

export class LifecycleError extends Error {}

/** @req FR:task-lifecycle/doc.load */
export interface TaskRef { path: string; line: number }

export interface LifecycleContext {
  storage: Storage;
  config?: StackConfig;
  /** Clock; defaults to the system time. */
  now?: () => Date;
  /** Scoring engine id; defaults to `legacy`. */
  engine?: string;
}

/** @req FR:task-lifecycle/doc.result */
export interface LifecycleResult {
  changed: boolean;
  ref?: TaskRef;
  before?: string;
  after?: string;
  message?: string;
  rolled?: boolean;
}

/** @req FR:task-lifecycle/next.@function */
export interface NextTask { ref: TaskRef; text: string; project: string; score: number }

// ------------------------------------------------------------------ constants

const STATUS = ['🚧', '⏸️', '👀', '⏳', '⛔️'] as const;
const PRIORITY = ['🚨', '‼️', '🔺', '🔻'] as const;
const EFFORT = ['🟢', '🟡', '🟠', '🔴', '⚫️'] as const;
const IMPACT = ['⬆️', '↔️', '⬇️'] as const;
const SPECIAL = ['💤', '☀️', '🅿️', '🏷️'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const SUSPEND_MARK = /💤\s+(?:[A-Za-z]{3}\s+\d{1,2}\s+\d{1,2}:\d{2}|[A-Za-z]{3}\s+\d{1,2}|\d{1,2}:\d{2}):\s*/gi;
const SUSPEND_SCAN = /💤\s+(?:([A-Za-z]{3}\s+\d{1,2}\s+\d{1,2}:\d{2})|([A-Za-z]{3}\s+\d{1,2})|(\d{1,2}:\d{2})):\s*/g;
const START_SCAN = /⏰\s+([A-Z][a-z]{2})\s+(\d{1,2}):\s+/g;
const ROW = /^(\s*- )(\[[ xX]\] )(.+)$/;
const ACTIVE = /^🔄 Active/i;
const TASK_LINE = /^(\s*)- \[ \] (.+)$/;

// ------------------------------------------------------------------ line helpers

const bare = (l: string) => l.replace(/\r$/, '');
const crOf = (l: string) => (l.endsWith('\r') ? '\r' : '');
const stripBom = (l: string) => l.replace(/^﻿/, '');
const has = (s: string, e: string) => s.includes(e);
const without = (s: string, e: string) => s.split(e).join('');
const collapse = (s: string) => s.replace(/\s+/g, ' ').trim();

/** Index just past the last real line (a final empty element is the trailing newline, not a line). */
function contentEnd(lines: string[]): number {
  return lines.length > 1 && lines[lines.length - 1] === '' ? lines.length - 1 : lines.length;
}

/** End (exclusive) of a task's block: following blank or deeper-indented lines (legacy rule). */
function blockEnd(lines: string[], i: number, limit = contentEnd(lines)): number {
  const indent = /^(\s*)/.exec(bare(lines[i]))![1].length;
  let j = i + 1;
  while (j < limit) {
    const l = bare(lines[j]);
    if (/^\s*$/.test(l) || /^\s*/.exec(l)![0].length > indent) j++;
    else break;
  }
  return j;
}

const trimBlanks = (lines: string[], start: number, end: number) => {
  while (end > start + 1 && /^\s*$/.test(bare(lines[end - 1]))) end--;
  return end;
};

// ------------------------------------------------------------------ pure text rules

export type Checkbox = 'Complete' | 'Incomplete';
export interface TaskProps {
  status?: (typeof STATUS)[number] | 'None';
  priority?: (typeof PRIORITY)[number] | 'None';
  effort?: (typeof EFFORT)[number] | 'None';
  impact?: (typeof IMPACT)[number] | 'None';
  checkbox?: Checkbox;
  /** `MMM d`, `HH:mm`, or `MMM d HH:mm`; `''` clears the marker. */
  suspend?: string;
  removeAllEmojis?: boolean;
}

function oneOf<T extends string>(v: string | undefined, list: readonly T[], label: string): void {
  if (v !== undefined && v !== 'None' && !(list as readonly string[]).includes(v)) {
    throw new LifecycleError(`${label} must be one of: ${list.join(' ')} or None`);
  }
}

function addEmoji(content: string, emoji: string, category: 'Status' | 'Priority' | 'Effort' | 'Impact'): string {
  switch (category) {
    case 'Priority': return `${emoji} ${content}`.trim();
    case 'Status': {
      const m = /^(🚨|‼️|🔺|🔻)\s*(.+)$/.exec(content);
      return m ? `${m[1]} ${emoji} ${m[2]}`.trim() : `${emoji} ${content}`.trim();
    }
    case 'Effort': {
      const m = /^(.+?)\s*(⬆️|↔️|⬇️)\s*$/.exec(content);
      return m ? `${m[1]} ${emoji} ${m[2]}`.trim() : `${content} ${emoji}`.trim();
    }
    default: return `${content} ${emoji}`.trim();
  }
}

function clearSuspend(s: string): string {
  return without(s.replace(SUSPEND_MARK, ''), '💤');
}

function setEmojis(content: string, p: TaskProps): string {
  let c = content;
  if (p.suspend !== undefined) {
    if (p.suspend.trim() !== '') return `💤 ${p.suspend}: ${clearSuspend(c)}`.trim();
    c = clearSuspend(c);
  } else if (p.status !== undefined && p.status.trim() !== '') {
    c = clearSuspend(c);
  }
  const cats: [string | undefined, readonly string[], 'Status' | 'Priority' | 'Effort' | 'Impact'][] = [
    [p.status, STATUS, 'Status'], [p.priority, PRIORITY, 'Priority'],
    [p.effort, EFFORT, 'Effort'], [p.impact, IMPACT, 'Impact'],
  ];
  for (const [want, list, name] of cats) {
    if (want === undefined || want.trim() === '') continue;
    if (want === 'None') {
      for (const e of list) c = without(c, e);
    } else {
      for (const e of list) if (e !== want) c = without(c, e);
      if (!has(c, want)) c = addEmoji(c, want, name);
    }
  }
  return collapse(c);
}

function removeAllEmojis(content: string): string {
  let c = content.replace(SUSPEND_MARK, '');
  for (const e of [...STATUS, ...PRIORITY, ...EFFORT, ...IMPACT, ...SPECIAL]) c = without(c, e);
  return collapse(c);
}

const SUSPEND_FORMAT = /^(?:[A-Za-z]{3} \d{1,2}(?: \d{2}:\d{2})?|\d{1,2}:\d{2})$/;

/**
 * Legacy `Set-Task` on one task line (no line ending): checkbox, status/priority/effort/impact emojis,
 * suspend marker. Whitespace in the task text is collapsed.
 * @req FR:task-lifecycle/set.props @req FR:task-lifecycle/set.placement @req FR:task-lifecycle/set.invalid
 * @req FR:task-lifecycle/start.status @req FR:task-lifecycle/complete.check
 */
export function applyTaskProps(line: string, props: TaskProps): string {
  oneOf(props.status, STATUS, 'status');
  oneOf(props.priority, PRIORITY, 'priority');
  oneOf(props.effort, EFFORT, 'effort');
  oneOf(props.impact, IMPACT, 'impact');
  if (props.suspend !== undefined && props.suspend !== '' && !SUSPEND_FORMAT.test(props.suspend)) {
    throw new LifecycleError(`suspend must be 'MMM d', 'HH:mm', or 'MMM d HH:mm': ${props.suspend}`);
  }
  const m = ROW.exec(line);
  if (!m) throw new LifecycleError(`Invalid task line: ${line}`);
  const box = props.checkbox === 'Complete' ? '[x] ' : props.checkbox === 'Incomplete' ? '[ ] ' : m[2];
  const content = props.removeAllEmojis ? removeAllEmojis(m[3]) : setEmojis(m[3], props);
  return `${m[1]}${box}${content}`;
}

// ------------------------------------------------------------------ clock

interface Wall { y: number; mo: number; d: number; h: number; mi: number; s: number }
const fmtCache = new Map<string, Intl.DateTimeFormat>();

/** Wall-clock parts of an instant in a time zone. */
function wallClock(at: Date, tz: string): Wall {
  let f = fmtCache.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
    });
    fmtCache.set(tz, f);
  }
  const parts = f.formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return { y: n('year'), mo: n('month'), d: n('day'), h: n('hour'), mi: n('minute'), s: n('second') };
}

const wallMs = (w: Wall) => Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s);
/** Naive wall-clock ms for an instant in a zone. */
const wall = (at: Date, tz: string) => wallMs(wallClock(at, tz));
const pad = (n: number) => String(n).padStart(2, '0');

/** @req FR:task-lifecycle/suspend.days @req FR:task-lifecycle/suspend.hours @req FR:task-lifecycle/suspend.clock */
export function formatSuspendDate(at: Date, timeZone: string, dur: { days?: number; hours?: number }): string {
  let { days, hours } = dur;
  let useHours = false;
  if (hours !== undefined && hours > 24) {
    const extra = hours % 24;
    days = Math.floor(hours / 24);
    hours = extra;
    useHours = extra !== 0;
  } else if (hours !== undefined) {
    useHours = true;
  }
  if (days === undefined && hours === undefined) days = 1;
  const now = wall(at, timeZone);
  const target = new Date(now + (days ?? 0) * 86400000 + (useHours ? (hours ?? 0) * 3600000 : 0));
  const day = `${MONTHS[target.getUTCMonth()]} ${target.getUTCDate()}`;
  const time = `${pad(target.getUTCHours())}:${pad(target.getUTCMinutes())}`;
  if (!useHours) return day;
  const from = new Date(now);
  const sameDay = !days && target.getUTCFullYear() === from.getUTCFullYear() && target.getUTCMonth() === from.getUTCMonth() &&
    target.getUTCDate() === from.getUTCDate();
  return sameDay ? time : `${day} ${time}`;
}

// ------------------------------------------------------------------ documents

interface Doc {
  path: string;
  /** File base name without `.md`. */
  name: string;
  content: string;
  version: string;
  project: Project;
}

const cfg = (ctx: LifecycleContext) => ctx.config ?? getDefaults();
const clock = (ctx: LifecycleContext) => (ctx.now ?? (() => new Date()))();
const baseName = (path: string) => path.replace(/^.*\//, '').replace(/\.md$/, '');

async function loadDoc(storage: Storage, path: string): Promise<Doc> {
  const f = await storage.read(path);
  return { path, name: baseName(path), content: f.content, version: f.version, project: parseProject(f.content) };
}

/** @req FR:task-lifecycle/doc.load */
async function loadDocs(storage: Storage): Promise<Doc[]> {
  const paths = (await storage.list()).filter((p) => baseName(p).toLowerCase() !== 'readme');
  const docs: Doc[] = [];
  for (const p of [...paths].sort()) docs.push(await loadDoc(storage, p));
  return docs;
}

/**
 * Write back changed lines with the version we read; lines keep their own endings and BOM.
 * @req FR:task-lifecycle/doc.version @req FR:task-lifecycle/doc.noop @req FR:task-lifecycle/doc.lossless @req FR:task-lifecycle/doc.crlf
 */
async function commit(ctx: LifecycleContext, doc: Doc, lines: string[], message: string): Promise<boolean> {
  const content = lines.join('\n');
  if (content === doc.content) return false;
  await ctx.storage.write(doc.path, content, { expectedVersion: doc.version, message });
  return true;
}

const brief = (s: string) => {
  const t = collapse(s);
  return t.length > 60 ? `${t.slice(0, 57)}...` : t;
};

/** Lines of the first Active section the scoring adapter reads, in its order (unchecked rows only). */
function scoringRows(doc: Doc): number[] {
  const active = doc.project.sections.find((s) => ACTIVE.test(s.heading));
  const flat: number[] = [];
  const walk = (ts: Project['sections'][number]['tasks']) => { for (const t of ts) { flat.push(t.line); walk(t.children); } };
  if (active) walk(active.tasks);
  return flat.filter((ln) => TASK_LINE.test(stripBom(bare(doc.project.lines[ln]))));
}

// ------------------------------------------------------------------ next

async function findNext(ctx: LifecycleContext, at?: Date): Promise<{ next: NextTask; doc: Doc } | null> {
  const docs = await loadDocs(ctx.storage);
  const projects = docs.map((d) => toScoringProject(d.project, d.name));
  const where = new Map<ScoringTask, { doc: Doc; line: number }>();
  projects.forEach((p, i) => {
    const rows = scoringRows(docs[i]);
    p.tasks.forEach((t, k) => where.set(t, { doc: docs[i], line: rows[k] }));
  });
  const top = rankTasks(getEngine(ctx.engine), projects, cfg(ctx), at ?? clock(ctx))[0];
  if (!top) return null;
  const loc = where.get(top.task)!;
  return {
    doc: loc.doc,
    next: { ref: { path: loc.doc.path, line: loc.line }, text: top.task.text, project: top.task.project, score: top.score },
  };
}

/** @req FR:task-lifecycle/next.@function @req FR:task-lifecycle/next.rank @req FR:task-lifecycle/next.map @req FR:task-lifecycle/next.none */
export async function nextTask(ctx: LifecycleContext, at?: Date): Promise<NextTask | null> {
  return (await findNext(ctx, at))?.next ?? null;
}

interface Target { doc: Doc; ref: TaskRef; row: RegExpExecArray }

/** @req FR:task-lifecycle/doc.target */
async function target(ctx: LifecycleContext, ref?: TaskRef): Promise<Target | null> {
  let doc: Doc;
  if (ref) {
    doc = await loadDoc(ctx.storage, ref.path);
  } else {
    const n = await findNext(ctx);
    if (!n) return null;
    doc = n.doc;
    ref = n.next.ref;
  }
  return { doc, ref, row: rowAt(doc, ref) };
}

function rowAt(doc: Doc, ref: TaskRef): RegExpExecArray {
  const raw = doc.project.lines[ref.line];
  const m = raw === undefined ? null : ROW.exec(stripBom(bare(raw)));
  if (!m) throw new LifecycleError(`Not a task line: ${ref.path}:${ref.line}`);
  return m;
}

const NONE: LifecycleResult = { changed: false, message: 'No active tasks available' };
const noop = (ref: TaskRef, message: string): LifecycleResult => ({ changed: false, ref, message });

/** Replace one line, keeping its line ending, and write. */
async function editLine(ctx: LifecycleContext, t: Target, next: string, msg: string): Promise<LifecycleResult> {
  const lines = [...t.doc.project.lines];
  const before = bare(lines[t.ref.line]);
  lines[t.ref.line] = next + crOf(lines[t.ref.line]);
  const changed = await commit(ctx, t.doc, lines, msg);
  return { changed, ref: t.ref, before: stripBom(before), after: next };
}

// ------------------------------------------------------------------ start

/** @req FR:task-lifecycle/start.status @req FR:task-lifecycle/start.already */
export async function startTask(ctx: LifecycleContext, ref?: TaskRef): Promise<LifecycleResult> {
  const t = await target(ctx, ref);
  if (!t) return NONE;
  if (has(t.row[3], '🚧')) return noop(t.ref, 'Task is already in progress');
  return editLine(ctx, t, applyTaskProps(stripBom(bare(t.doc.project.lines[t.ref.line])), { status: '🚧' }), `Start: ${brief(t.row[3])}`);
}

// ------------------------------------------------------------------ complete

export interface CompleteOptions { summary?: string; remove?: boolean }

/**
 * @req FR:task-lifecycle/complete.check @req FR:task-lifecycle/complete.already @req FR:task-lifecycle/complete.summary
 * @req FR:task-lifecycle/complete.remove @req FR:task-lifecycle/complete.recurring
 */
export async function completeTask(ctx: LifecycleContext, ref?: TaskRef, opts: CompleteOptions = {}): Promise<LifecycleResult> {
  const t = await target(ctx, ref);
  if (!t) return NONE;
  const { doc } = t;
  const lines = [...doc.project.lines];
  const i = t.ref.line;
  const msg = `Complete: ${brief(t.row[3])}`;
  if (/^\s*- \[[xX]\]/.test(stripBom(lines[i]))) return noop(t.ref, 'Task is already completed');

  if (opts.remove) {
    const end = blockEnd(lines, i);
    lines.splice(i, end - i);
    return { changed: await commit(ctx, doc, lines, `Remove: ${brief(t.row[3])}`), ref: t.ref, before: stripBom(bare(doc.project.lines[i])), message: 'Task removed' };
  }

  const cr = crOf(lines[i]);
  const before = stripBom(bare(lines[i]));
  const stripped = applyTaskProps(before, { status: 'None' });

  // Recurring rows roll in place instead of completing. @req FR:task-lifecycle/complete.recurring
  const end = trimBlanks(lines, i, blockEnd(lines, i));
  const block = [stripped + cr, ...lines.slice(i + 1, end)].join('\n');
  const today = wallClock(clock(ctx), cfg(ctx).timezone);
  const rolled = rollRecurring(block, new Date(Date.UTC(today.y, today.mo - 1, today.d)));
  if (rolled !== null) {
    const out = rolled.split('\n');
    const first = i === 0 && lines[0].startsWith('﻿') ? '﻿' + out[0] : out[0];
    lines.splice(i, end - i, first, ...out.slice(1));
    return { changed: await commit(ctx, doc, lines, `Roll: ${brief(t.row[3])}`), ref: t.ref, before, after: bare(out[0]), rolled: true };
  }

  const done = applyTaskProps(before, { checkbox: 'Complete', status: 'None' });
  lines[i] = (i === 0 && lines[0].startsWith('﻿') ? '﻿' : '') + done + cr;
  const summary = opts.summary?.trim();
  if (summary) addSummary(lines, i, summary, /^(\s*)/.exec(done)![1], cr);
  return { changed: await commit(ctx, doc, lines, msg), ref: t.ref, before, after: done };
}

/** Replace the `> Prompt:` note or insert a summary line. */
function addSummary(lines: string[], i: number, summary: string, indent: string, cr: string): void {
  for (let j = i + 1; j < contentEnd(lines); j++) {
    const l = bare(lines[j]);
    if (/^\s*> Prompt:/i.test(l)) {
      lines[j] = `${l.replace(/^(\s*>).*/, '$1')} ✅ **COMPLETED**: ${summary}${crOf(lines[j])}`;
      return;
    }
    if (/^(\s*- \[|\s*#{1,6} )/.test(l)) break;
  }
  lines.splice(i + 1, 0, `${indent}  > ✅ **COMPLETED**: ${summary}${cr}`);
}

// ------------------------------------------------------------------ skip / resume

/** @req FR:task-lifecycle/skip.park @req FR:task-lifecycle/skip.already */
export async function skipTask(ctx: LifecycleContext, ref?: TaskRef): Promise<LifecycleResult> {
  const t = await target(ctx, ref);
  if (!t) return NONE;
  if (has(t.row[3], '🅿️')) return noop(t.ref, 'Task is already parked');
  const line = stripBom(bare(t.doc.project.lines[t.ref.line]));
  const m = /^(\s*- \[ \] )(.+)$/.exec(line);
  if (!m) throw new LifecycleError(`Only unchecked tasks can be parked: ${t.ref.path}:${t.ref.line}`);
  return editLine(ctx, t, `${m[1]}🅿️ ${m[2]}`, `Park: ${brief(t.row[3])}`);
}

/** @req FR:task-lifecycle/skip.alias */
export const parkTask = skipTask;

/** @req FR:task-lifecycle/resume.first @req FR:task-lifecycle/resume.remove @req FR:task-lifecycle/resume.none */
export async function resumeTask(ctx: LifecycleContext, ref?: TaskRef): Promise<LifecycleResult> {
  let t: Target | null = null;
  if (ref) {
    t = await target(ctx, ref);
  } else {
    for (const doc of await loadDocs(ctx.storage)) {
      const line = scoringRows(doc).find((ln) => has(stripBom(bare(doc.project.lines[ln])), '🅿️'));
      if (line !== undefined) {
        const r = { path: doc.path, line };
        t = { doc, ref: r, row: rowAt(doc, r) };
        break;
      }
    }
  }
  if (!t) return { changed: false, message: 'No parked tasks available to resume' };
  const line = stripBom(bare(t.doc.project.lines[t.ref.line]));
  const m = /^(\s*- \[ \] )(.+)$/.exec(line);
  if (!m) throw new LifecycleError(`Only unchecked tasks can be resumed: ${t.ref.path}:${t.ref.line}`);
  const r = /^🅿️\s*(.+)$/.exec(m[2]);
  if (!r) return noop(t.ref, 'Parking emoji is not at the start of the task');
  return editLine(ctx, t, `${m[1]}${r[1]}`, `Resume: ${brief(r[1])}`);
}

// ------------------------------------------------------------------ suspend

export interface SuspendOptions { days?: number; hours?: number }

/** @req FR:task-lifecycle/suspend.marker @req FR:task-lifecycle/suspend.already @req FR:task-lifecycle/suspend.validate */
export async function suspendTask(ctx: LifecycleContext, ref?: TaskRef, opts: SuspendOptions = {}): Promise<LifecycleResult> {
  const { days, hours } = opts;
  if (days !== undefined && hours !== undefined) throw new LifecycleError('Use either days or hours, not both');
  if (days !== undefined && !(Number.isInteger(days) && days >= 1 && days <= 365)) throw new LifecycleError('days must be an integer from 1 to 365');
  if (hours !== undefined && !(Number.isInteger(hours) && hours >= 1 && hours <= 8760)) throw new LifecycleError('hours must be an integer from 1 to 8760');
  const t = await target(ctx, ref);
  if (!t) return NONE;
  if (/^\s*- \[[xX]\]/.test(stripBom(t.doc.project.lines[t.ref.line]))) return noop(t.ref, 'Task is already completed');
  if (has(t.row[3], '💤')) return noop(t.ref, 'Task is already suspended');
  const when = formatSuspendDate(clock(ctx), cfg(ctx).timezone, { days, hours });
  const r = await editLine(ctx, t, applyTaskProps(stripBom(bare(t.doc.project.lines[t.ref.line])), { suspend: when }), `Suspend until ${when}: ${brief(t.row[3])}`);
  return { ...r, message: `Suspended until ${when}` };
}

// ------------------------------------------------------------------ set

/** @req FR:task-lifecycle/set.props */
export async function setProperties(ctx: LifecycleContext, ref: TaskRef, props: TaskProps): Promise<LifecycleResult> {
  const t = await target(ctx, ref);
  if (!t) return NONE;
  return editLine(ctx, t, applyTaskProps(stripBom(bare(t.doc.project.lines[t.ref.line])), props), `Update: ${brief(t.row[3])}`);
}

// ------------------------------------------------------------------ remove completed

/** @req FR:task-lifecycle/remove.blocks @req FR:task-lifecycle/remove.count @req FR:task-lifecycle/remove.missing */
export async function removeCompleted(ctx: LifecycleContext, opts: { project?: string } = {}): Promise<{ removed: number; files: string[] }> {
  let docs = await loadDocs(ctx.storage);
  if (opts.project !== undefined) {
    docs = docs.filter((d) => d.name === opts.project);
    if (!docs.length) throw new LifecycleError(`Project file not found: ${opts.project}.md`);
  }
  let removed = 0;
  const files: string[] = [];
  for (const doc of docs) {
    const src = doc.project.lines;
    const limit = contentEnd(src);
    const out: string[] = [];
    let n = 0;
    for (let i = 0; i < src.length; i++) {
      if (i < limit && /^(\s*)- \[x\] (.+)$/.test(bare(src[i]))) {
        n++;
        i = blockEnd(src, i, limit) - 1;
      } else {
        out.push(src[i]);
      }
    }
    if (n > 0 && (await commit(ctx, doc, out, `Remove ${n} completed task${n === 1 ? '' : 's'}`))) {
      removed += n;
      files.push(doc.path);
    }
  }
  return { removed, files };
}

// ------------------------------------------------------------------ add project

export interface NewProject {
  name: string;
  description?: string;
  repositoryUrl?: string;
  aliases?: string[];
  /** Project priority number. */
  priority?: number;
  /** Hours per week by time block name. */
  capacity?: Record<string, number>;
  /** Shorthand for `capacity: { Work: n }` when `capacity` is not given. */
  weeklyCapacity?: number;
  fileName?: string;
  force?: boolean;
}

/** @req FR:task-lifecycle/project.name */
export function kebabCase(text: string): string {
  const k = text.toLowerCase().replace(/[^\p{L}\p{N}_\s-]/gu, '').replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  if (k.trim() === '') throw new LifecycleError(`Cannot generate a valid file name from project name: ${text}`);
  return k;
}

/** @req FR:task-lifecycle/project.file @req FR:task-lifecycle/project.capacity */
function renderProject(p: NewProject, config: StackConfig): string {
  const capacity = p.capacity ?? (p.weeklyCapacity ? { Work: p.weeklyCapacity } : undefined);
  const out: string[] = [`# ${p.name}`, ''];
  if (p.description) out.push(p.description, '');
  if (p.repositoryUrl) out.push(`- **Repository:** [${p.repositoryUrl.split('/').slice(-2).join('/')}](${p.repositoryUrl})`);
  if (p.aliases?.length) out.push(`- **Aliases:** ${p.aliases.join(', ')}`);
  if (p.priority) out.push(`- **Project priority:** ${p.priority}`);
  if (capacity) {
    const names = config.timeBlocks.map((b) => b.name);
    for (const [block, hours] of Object.entries(capacity)) if (names.includes(block)) out.push(`- **${block} capacity:** ${hours}h`);
  }
  out.push('', '## 🔄 Active', '', 'Current work that needs to be done.', '', '- [ ] ', '',
    '## ⏭️ Up next', '', 'Tasks to pick up when active work is completed.', '', '- [ ] ', '',
    '## 📋 Backlog', '', 'Future work and ideas.', '', '- [ ] ', '');
  // Legacy writes each line with a newline, so the template ends with a blank line.
  return '\uFEFF' + out.join('\n') + '\n';
}

/** @req FR:task-lifecycle/project.file @req FR:task-lifecycle/project.exists */
export async function addProject(ctx: LifecycleContext, input: NewProject): Promise<{ path: string }> {
  const path = `tasks/${input.fileName ?? kebabCase(input.name)}.md`;
  let existing: string | null = null;
  try {
    existing = (await ctx.storage.read(path)).version;
  } catch (e) {
    if (!(e instanceof NotFoundError)) throw e;
  }
  if (existing !== null && !input.force) throw new ConflictError(`Project file already exists: ${path}`);
  await ctx.storage.write(path, renderProject(input, cfg(ctx)), { expectedVersion: existing, message: `Add project: ${input.name}` });
  return { path };
}

// ------------------------------------------------------------------ add task

export interface NewTask {
  /** File base name, project title, or alias. */
  project: string;
  text: string;
  /** Section heading text (default `Active`). */
  section?: string;
  parent?: TaskRef;
}

const headingKey = (h: string) => h.replace(/^[^\p{L}\p{N}]+/u, '').trim().toLowerCase();

/** @req FR:task-lifecycle/add.insert @req FR:task-lifecycle/add.placeholder @req FR:task-lifecycle/add.parent @req FR:task-lifecycle/add.invalid */
export async function addTask(ctx: LifecycleContext, input: NewTask): Promise<LifecycleResult> {
  const text = input.text.trim();
  if (!text) throw new LifecycleError('Task text is required');
  if (/[\r\n]/.test(text)) throw new LifecycleError('Task text must be a single line');
  const key = input.project.trim().toLowerCase();
  const docs = await loadDocs(ctx.storage);
  const doc = docs.find((d) => d.name.toLowerCase() === key)
    ?? docs.find((d) => d.project.title.toLowerCase() === key)
    ?? docs.find((d) => (d.project.metadata['Aliases'] ?? '').split(',').some((a) => a.trim().toLowerCase() === key));
  if (!doc) throw new LifecycleError(`Project not found: ${input.project}`);

  const lines = [...doc.project.lines];
  const limit = contentEnd(lines);
  const cr = crOf(lines[0] ?? '');

  // Section ranges, in the same order the parser creates sections.
  const heads: number[] = [];
  lines.forEach((l, i) => { if (i < limit && stripBom(bare(l)).startsWith('## ')) heads.push(i); });
  const wanted = headingKey(input.section ?? 'Active');
  const k = doc.project.sections.findIndex((s) => headingKey(s.heading) === wanted);
  if (k < 0 || heads[k] === undefined) throw new LifecycleError(`Section not found: ${input.section ?? 'Active'}`);
  const start = heads[k];
  const end = heads[k + 1] ?? limit;

  const rows: { i: number; indent: number }[] = [];
  for (let i = start + 1; i < end; i++) {
    const m = /^(\s*)- \[[ xX]\]/.exec(bare(lines[i]));
    if (m) rows.push({ i, indent: m[1].length });
  }

  let at: number;
  let indent = '';
  let replace = false;
  if (input.parent) {
    if (input.parent.path !== doc.path) throw new LifecycleError('Parent must be in the same project file');
    rowAt(doc, input.parent);
    const pl = input.parent.line;
    at = trimBlanks(lines, pl, blockEnd(lines, pl, limit));
    indent = `${/^(\s*)/.exec(bare(lines[pl]))![1]}  `;
  } else if (rows.length) {
    const min = Math.min(...rows.map((r) => r.indent));
    const top = rows.filter((r) => r.indent === min);
    indent = ' '.repeat(min);
    const ph = top.find((r) => /^\s*- \[ \]\s*$/.test(bare(lines[r.i])));
    if (ph) {
      at = ph.i;
      replace = true;
    } else {
      at = trimBlanks(lines, top[top.length - 1].i, Math.min(blockEnd(lines, top[top.length - 1].i, limit), end));
    }
  } else {
    at = trimBlanks(lines, start, end);
  }

  const row = `${indent}- [ ] ${text}${cr}`;
  if (replace) lines[at] = row;
  else lines.splice(at, 0, row);
  await commit(ctx, doc, lines, `Add task: ${brief(text)}`);
  return { changed: true, ref: { path: doc.path, line: at }, after: bare(row) };
}

// ------------------------------------------------------------------ sweeps

const monthIndex = (s: string) => MONTHS.findIndex((m) => m.toLowerCase() === s.toLowerCase());
const validDay = (y: number, mo: number, d: number) => {
  const t = new Date(Date.UTC(y, mo, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo && t.getUTCDate() === d;
};

function addMonthsClamped(ms: number, n: number): number {
  const t = new Date(ms);
  const m = t.getUTCMonth() + n;
  const y = t.getUTCFullYear() + Math.floor(m / 12);
  const mo = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
  return Date.UTC(y, mo, Math.min(t.getUTCDate(), last));
}

interface SweepOut { activated: number; reactivated: number; files: string[] }

async function sweepDocs(ctx: LifecycleContext, starts: boolean, suspends: boolean): Promise<SweepOut> {
  const conf = cfg(ctx);
  const w = wallClock(clock(ctx), conf.timezone);
  const nowMs = wallMs(w);
  const todayMs = Date.UTC(w.y, w.mo - 1, w.d);
  const sixMonths = addMonthsClamped(todayMs, 6);
  const sod = /^(\d{1,2}):(\d{2})$/.exec(conf.startOfDay ?? '');
  const out: SweepOut = { activated: 0, reactivated: 0, files: [] };

  const dueStart = (mon: string, day: string): boolean => {
    const mo = monthIndex(mon);
    const d = Number(day);
    if (mo < 0 || !validDay(w.y, mo, d)) return false;
    let start = Date.UTC(w.y, mo, d);
    if (start > sixMonths) start = Date.UTC(w.y - 1, mo, Math.min(d, new Date(Date.UTC(w.y - 1, mo + 1, 0)).getUTCDate()));
    return start <= todayMs;
  };

  const dueSuspend = (dt?: string, date?: string, time?: string): boolean => {
    const hm = (s: string): [number, number] | null => {
      const m = /^(\d{2}):(\d{2})$/.exec(s);
      return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? [Number(m[1]), Number(m[2])] : null;
    };
    if (dt) {
      const m = /^([A-Za-z]{3})\s+(\d{1,2})\s+(\S+)$/.exec(dt)!;
      const mo = monthIndex(m[1]);
      const t = hm(m[3]);
      if (mo < 0 || !t || !validDay(w.y, mo, Number(m[2]))) return false;
      return Date.UTC(w.y, mo, Number(m[2]), t[0], t[1]) <= nowMs;
    }
    if (date) {
      const m = /^([A-Za-z]{3})\s+(\d{1,2})$/.exec(date)!;
      const mo = monthIndex(m[1]);
      if (mo < 0 || !validDay(w.y, mo, Number(m[2]))) return false;
      return Date.UTC(w.y, mo, Number(m[2]), sod ? Number(sod[1]) : 0, sod ? Number(sod[2]) : 0) <= nowMs;
    }
    const t = hm(time!);
    return !!t && Date.UTC(w.y, w.mo - 1, w.d, t[0], t[1]) <= nowMs;
  };

  for (const doc of await loadDocs(ctx.storage)) {
    const lines = [...doc.project.lines];
    let hits = 0;
    for (let i = 0; i < lines.length; i++) {
      const cr = crOf(lines[i]);
      let line = bare(lines[i]);
      if (starts) {
        line = line.replace(START_SCAN, (m, mon: string, day: string) => {
          if (!dueStart(mon, day)) return m;
          out.activated++;
          return '';
        });
      }
      if (suspends && /^\s*- \[ \] /.test(stripBom(line)) && line.includes('💤')) {
        let guard = 0;
        for (;;) {
          SUSPEND_SCAN.lastIndex = 0;
          let found: RegExpExecArray | null = null;
          let m: RegExpExecArray | null;
          while ((m = SUSPEND_SCAN.exec(line)) !== null) {
            if (dueSuspend(m[1], m[2], m[3])) { found = m; break; }
            if (m[0] === '') SUSPEND_SCAN.lastIndex++;
          }
          if (!found || guard++ > 20) break;
          const head = /^(\s*)- \[ \] (.*)$/.exec(stripBom(line.slice(0, found.index)))!;
          const bom = line.startsWith('﻿') ? '﻿' : '';
          line = `${bom}${head[1]}- [ ] ${(head[2] + line.slice(found.index + found[0].length)).trim()}`;
          out.reactivated++;
        }
      }
      if (line + cr !== lines[i]) { lines[i] = line + cr; hits++; }
    }
    if (hits > 0 && (await commit(ctx, doc, lines, 'Sweep start dates and suspended tasks'))) out.files.push(doc.path);
  }
  return out;
}

/** @req FR:task-lifecycle/sweep.start */
export async function sweepStartDates(ctx: LifecycleContext): Promise<{ activated: number; files: string[] }> {
  const r = await sweepDocs(ctx, true, false);
  return { activated: r.activated, files: r.files };
}

/** @req FR:task-lifecycle/sweep.suspend */
export async function sweepSuspended(ctx: LifecycleContext): Promise<{ reactivated: number; files: string[] }> {
  const r = await sweepDocs(ctx, false, true);
  return { reactivated: r.reactivated, files: r.files };
}

/** @req FR:task-lifecycle/sweep.all */
export async function sweep(ctx: LifecycleContext): Promise<SweepOut> {
  return sweepDocs(ctx, true, true);
}
