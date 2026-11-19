/**
 * Task bloat lint: deterministic rules on open task rows (no IO, no model call, no clock).
 * A title holds the action only; status, dates, and detail go in nested bullets.
 * @req FR:task-lint/title.@function @req FR:task-lint/file.@function
 */
import { DUE_MARK } from './autopri-tags';
import { SUSPEND_MARK } from './lifecycle';
import { parseProject, type Task } from './parser';
import { TRIGGER } from './query-tasks';
import { AGENT_TAG, TIERS } from './tiered-tasks';

export const LINT_RULES = ['title-length', 'title-status', 'title-parens', 'detail-nesting', 'id-duplicate', 'id-dangling', 'id-slug', 'meta-emoji', 'meta-key', 'note-status'] as const;
export type LintRule = (typeof LINT_RULES)[number];
export interface LintFinding { rule: LintRule; message: string }
/** `line` is 1-based. */
export interface LintIssue extends LintFinding { path: string; line: number }

/** @req FR:task-lint/cli.lint.exit: rules that flag existing content; they warn and never fail a command. */
export const WARN_RULES: readonly LintRule[] = ['note-status', 'meta-key', 'meta-emoji'];
export const isError = (i: LintFinding): boolean => !WARN_RULES.includes(i.rule);

/** @req FR:task-lint/rule.length */
export const MAX_TITLE = 120;
const MAX_PARENS = 1;

const all = (re: RegExp) => new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
/** Marks the rules do not read. @req FR:task-lint/title.exempt */
const EXEMPT = [TRIGGER, AGENT_TAG, DUE_MARK, /📅\s*[A-Za-z]{3}[a-z]*\s+\d{1,2}\b/u, SUSPEND_MARK, /⏰\s+[A-Za-z]{3}\s+\d{1,2}:\s*/u, new RegExp(Object.keys(TIERS).join('|'), 'u')].map(all);

/** The title the rules read: links as their labels, no bare URLs, no exempt marks. @req FR:task-lint/title.links @req FR:task-lint/title.exempt */
export function measuredTitle(text: string): string {
  let t = text.replace(/\[([^\]]*)\]\([^)]*\)/gu, (_m, label: string) => label).replace(/https?:\/\/\S+/gu, ' ');
  for (const re of EXEMPT) t = t.replace(re, ' ');
  return t.replace(/\s+/g, ' ').trim();
}

/** The measured title with no code spans, for the rules that read words. @req FR:task-lint/title.code */
const prose = (t: string): string => t.replace(/`[^`]*`/gu, ' ');

const EDGE = '[\\p{L}\\p{N}_=-]';
/** @req FR:task-lint/rule.status.words */
const STATUS_WORDS = new RegExp(`(?<!${EDGE})(?:done|waiting|blocked|merged|landed|shipped|parked|on\\s+hold|as\\s+of)(?!${EDGE})`, 'iu');
/** @req FR:task-lint/rule.status.dates */
const MONTH = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
const DAY = '\\d{1,2}(?:st|nd|rd|th)?';
const STATUS_DATE = new RegExp(`\\b(?:${MONTH}\\.?\\s+${DAY}\\b|${DAY}\\s+${MONTH}\\b|\\d{4}-\\d{2}-\\d{2}\\b)`, 'u');
/** @req FR:task-lint/rule.nesting.inline */
const DASH_DETAIL = /\s(?:--|—|–)\s+\S/u;

/** Parentheticals at the top level; a nested pair counts once. */
function parens(t: string): number {
  let depth = 0, n = 0;
  for (const c of t) {
    if (c === '(') depth++;
    else if (c === ')' && depth > 0 && --depth === 0) n++;
  }
  return n;
}

/**
 * The title rules one row text breaks, in rule order.
 * @req FR:task-lint/title.@function @req FR:task-lint/rule.length @req FR:task-lint/rule.status @req FR:task-lint/rule.parens @req FR:task-lint/rule.nesting.inline
 */
export function lintTitle(text: string): LintFinding[] {
  const t = measuredTitle(text);
  const out: LintFinding[] = [];
  const length = [...t].length;
  if (length > MAX_TITLE) out.push({ rule: 'title-length', message: `Title has ${length} characters (max ${MAX_TITLE}). Move detail to nested bullets.` });
  const words = prose(t);
  const status = [STATUS_WORDS.exec(words), STATUS_DATE.exec(words)].filter((m): m is RegExpExecArray => m !== null).sort((a, b) => a.index - b.index)[0];
  if (status) out.push({ rule: 'title-status', message: `Title holds status text "${status[0]}". Move it to a nested bullet.` });
  const count = parens(words);
  if (count > MAX_PARENS) out.push({ rule: 'title-parens', message: `Title has ${count} parentheticals (max ${MAX_PARENS}). Move detail to nested bullets.` });
  if (DASH_DETAIL.test(words)) out.push({ rule: 'detail-nesting', message: 'Title holds detail after a dash. Move it to a nested bullet.' });
  return out;
}

const ROW = /^\s*- \[[ xX]\]/;
const width = (l: string) => l.slice(0, l.length - l.trimStart().length).replace(/\t/g, '    ').length;

/**
 * The lines in the block of `task` that are not bullets, 0-based. Child rows and their blocks are not read.
 * @req FR:task-lint/rule.nesting.prose @req FR:task-lint/rule.nesting.allowed
 */
function proseLines(lines: string[], task: Pick<Task, 'line' | 'depth'>, fenced: Set<number>, all = false): number[] {
  const out: number[] = [];
  let child = -1; // indent of the child row whose block is skipped
  for (let i = task.line + 1; i < lines.length; i++) {
    const l = lines[i].replace(/\r$/, '');
    if (!l.trim() || fenced.has(i)) continue;
    const indent = width(l);
    if (l.startsWith('#') || indent <= task.depth) break;
    if (child >= 0 && indent > child) continue;
    child = -1;
    const body = l.trim();
    if (ROW.test(l)) { child = indent; continue; }
    if (!all && (body.startsWith('>') || /^(?:[-*+]|\d+[.)])\s/.test(body))) continue;
    out.push(i);
  }
  return out;
}

/** The lines of every code fence (three backticks or three tildes), fence lines included, 0-based. A fence closes on its own marker. @req FR:task-lint/rule.nesting.allowed */
export function fencedLines(lines: string[]): Set<number> {
  const out = new Set<number>();
  let open: string | null = null;
  lines.forEach((l, i) => {
    const mark = /^\s*(```|~~~)/.exec(l)?.[1];
    if (open) { out.add(i); if (mark === open) open = null; }
    else if (mark) { out.add(i); open = mark; }
  });
  return out;
}

/** Issues of one row: none for a checked row, a script-owned query row, or a row inside a code fence. @req FR:task-lint/scope.open @req FR:task-lint/scope.generated */
function rowIssues(path: string, lines: string[], task: Task, fenced: Set<number>): LintIssue[] {
  if (task.checked || fenced.has(task.line) || task.text.trimStart().startsWith('🌐')) return [];
  return [
    ...lintTitle(task.text).map((f) => ({ path, line: task.line + 1, ...f })),
    ...proseLines(lines, task, fenced).map((i) => ({ path, line: i + 1, rule: 'detail-nesting' as const, message: 'Detail line is not a bullet. Start it with "- ".' })),
    ...proseLines(lines, task, fenced, true).flatMap((i) => { const s = noteStatus(lines[i]); return s ? [{ path, line: i + 1, rule: 'note-status' as const, message: `Note holds status text "${s}". State lives in the emoji, git history, and the app.` }] : []; }),
  ];
}

/** @req FR:task-ids/lint.status-note: progress claims such as `50%` or `3/5`. */
const PROGRESS = /(?<![\p{L}\p{N}_/.-])(?:\d{1,3}%|\d{1,3}\/\d{1,3})(?![\p{L}\p{N}_/-])/u;
/** Status text in one nested line (an `id` line never counts), or null. */
function noteStatus(line: string): string | null {
  const raw = line.replace(/\r$/, '').trim().replace(/^>\s*/, '').replace(/^(?:[-*+]|\d+[.)])\s+/, '');
  // Metadata (`> key: value`) is data, not prose.
  if (/^>\s*[a-z][a-z0-9_-]*:/.test(line.trim())) return null;
  if (/^id:/.test(raw)) return null;
  // A field label (`Done when:`, `Next:`) is not status; its value still counts.
  const body = raw.replace(/^[A-Za-z][A-Za-z ]{0,20}:\s+/, '');
  const words = prose(measuredTitle(body));
  return [STATUS_WORDS.exec(words), STATUS_DATE.exec(words), PROGRESS.exec(words)].filter((m): m is RegExpExecArray => m !== null).sort((a, b) => a.index - b.index)[0]?.[0] ?? null;
}

const walk = (tasks: Task[], f: (t: Task) => void): void => { for (const t of tasks) { f(t); walk(t.children, f); } };

/** Every issue in one project file, in line order. @req FR:task-lint/file.@function */
export function lintProject(path: string, src: string): LintIssue[] {
  const project = parseProject(src);
  const fenced = fencedLines(project.lines);
  const out: LintIssue[] = [];
  for (const s of project.sections) walk(s.tasks, (t) => out.push(...rowIssues(path, project.lines, t, fenced)));
  return out.sort((a, b) => a.line - b.line);
}

/**
 * The issues of the row at 1-based `line`; none when no task row is there.
 * @req FR:task-lint/file.row
 */
export function lintRow(path: string, src: string, line: number): LintIssue[] {
  const project = parseProject(src);
  const fenced = fencedLines(project.lines);
  let out: LintIssue[] = [];
  for (const s of project.sections) walk(s.tasks, (t) => { if (t.line === line - 1) out = rowIssues(path, project.lines, t, fenced); });
  return out;
}

/** `<path>:<line> <rule> <message>`. @req FR:task-lint/cli.lint.out */
export const formatIssue = (i: LintIssue): string => `${i.path}:${i.line} ${i.rule} ${i.message}`;

/** `<n> issues in <m> files`. @req FR:task-lint/cli.lint.out */
export const formatCount = (issues: LintIssue[]): string => `${issues.length} issues in ${new Set(issues.map((i) => i.path)).size} files`;
