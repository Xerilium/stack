/**
 * Row text edit and block move for the web app. Same storage rules as the lifecycle: write with the version read.
 * @req FR:web-app/api.edit @req FR:web-app/api.move
 */
import { EFFORT, IMPACT, LifecycleError, PRIORITY, STATUS } from '../core/lifecycle';
import { ConflictError, type Storage } from '../core/storage';

interface TaskRef { path: string; line: number }
export interface EditResult { changed: boolean; ref: TaskRef; before?: string; after?: string; message: string }

const ROW = /^(\s*- \[[ xX]\] ?)(.*)$/;
const bare = (l: string) => l.replace(/\r$/, '');
const unbom = (l: string) => l.replace(/^﻿/, '');
const brief = (s: string) => (s.length > 60 ? `${s.slice(0, 57)}...` : s);

function rowAt(lines: string[], line: number, expect?: string): RegExpExecArray {
  const m = lines[line] === undefined ? null : ROW.exec(unbom(bare(lines[line])));
  if (!m) throw new LifecycleError('Task not found');
  if (expect !== undefined && m[2] !== expect) throw new ConflictError('Row changed since it was read');
  return m;
}

/** End (exclusive) of a row's block: following deeper-indented or blank lines, minus trailing blanks. */
function blockEnd(lines: string[], i: number): number {
  const indent = /^\s*/.exec(bare(lines[i]))![0].length;
  let j = i + 1;
  while (j < lines.length) {
    const l = bare(lines[j]);
    if (/^\s*$/.test(l) || /^\s*/.exec(l)![0].length > indent) j++;
    else break;
  }
  while (j > i + 1 && /^\s*$/.test(bare(lines[j - 1]))) j--;
  return j;
}

/** Current text after the checkbox of one row (same errors as editTask). */
export async function rowText(storage: Storage, ref: TaskRef): Promise<string> {
  const f = await storage.read(ref.path);
  return rowAt(f.content.split('\n'), ref.line)[2];
}

/** Texts of a row's ancestors, nearest last. */
function ancestors(lines: string[], line: number): string[] {
  const out: string[] = [];
  let indent = /^(\s*)/.exec(unbom(bare(lines[line] ?? '')))![1].length;
  for (let i = line - 1; i >= 0 && indent > 0; i--) {
    const m = ROW.exec(unbom(bare(lines[i])));
    const lead = m ? /^\s*/.exec(m[1])![0].length : 0;
    if (m && lead < indent) { out.unshift(m[2]); indent = lead; }
  }
  return out;
}

/** Replace the text after the checkbox of one row. `chain` pins the ancestors' texts (nearest last), so a concurrent move makes the write fail. */
export async function editTask(storage: Storage, ref: TaskRef, text: string, expect?: string, chain?: string[]): Promise<EditResult> {
  const f = await storage.read(ref.path);
  const lines = f.content.split('\n');
  const m = rowAt(lines, ref.line, expect);
  if (chain !== undefined) {
    const now = ancestors(lines, ref.line);
    if (now.length !== chain.length || now.some((t, i) => t.trim() !== chain[i].trim())) throw new ConflictError('Row moved since it was read');
  }
  const cr = lines[ref.line].endsWith('\r') ? '\r' : '';
  const bom = lines[ref.line].startsWith('﻿') ? '﻿' : '';
  const before = m[2];
  if (before === text) return { changed: false, ref, before, after: text, message: 'No change' };
  lines[ref.line] = `${bom}${m[1]}${text}${cr}`;
  await storage.write(ref.path, lines.join('\n'), { expectedVersion: f.version, message: `Edit: ${brief(text)}` });
  return { changed: true, ref, before, after: text, message: 'Saved' };
}

const strip = (t: string) => t.replace(/\uFE0F/g, '');
const MARKS = new Set([...STATUS, ...PRIORITY, ...EFFORT, ...IMPACT, '🔹'].map(strip));
const isMark = (t: string) => MARKS.has(strip(t));

/** New row text; the old text's leading and trailing status, priority, effort, and impact marks stay unless the new text has its own at that end. */
export function keepMarks(old: string, text: string): string {
  const neu = text.trim();
  const ot = old.trim().split(/\s+/).filter(Boolean);
  let a = 0;
  while (a < ot.length && isMark(ot[a])) a++;
  let b = ot.length;
  while (b > a && isMark(ot[b - 1])) b--;
  const nt = neu.split(/\s+/);
  const lead = isMark(nt[0]) ? [] : ot.slice(0, a);
  const trail = isMark(nt[nt.length - 1]) ? [] : ot.slice(b);
  return [...lead, neu, ...trail].join(' ');
}

const oneLine = (t: string, what: string): string => {
  if (!t.trim()) throw new LifecycleError(`${what} needs text`);
  if (/[\r\n]/.test(t)) throw new LifecycleError(`${what} must be one line`);
  return t;
};

/** Edit a row's text in place through `editTask`, keeping the old marks (see `keepMarks`). */
export async function retitleTask(storage: Storage, ref: TaskRef, text: string, expect?: string): Promise<EditResult> {
  oneLine(text, 'retitle');
  const cur = await rowText(storage, ref);
  if (expect !== undefined && cur !== expect) throw new ConflictError('Row changed since it was read');
  return editTask(storage, ref, keepMarks(cur, text), cur);
}

/** Append `- text` as a nested bullet at the end of a row's block; children and older notes stay. */
export async function addNote(storage: Storage, ref: TaskRef, text: string, expect?: string): Promise<EditResult> {
  oneLine(text, 'note');
  if (/^\[[ xX]\]/.test(text.trim())) throw new LifecycleError('note must not start with a checkbox');
  const f = await storage.read(ref.path);
  const lines = f.content.split('\n');
  const m = rowAt(lines, ref.line, expect);
  const indent = /^\s*/.exec(bare(unbom(lines[ref.line])))![0].length + 2;
  const cr = lines[ref.line].endsWith('\r') ? '\r' : '';
  const end = blockEnd(lines, ref.line);
  lines.splice(end, 0, `${' '.repeat(indent)}- ${text.trim()}${cr}`);
  await storage.write(ref.path, lines.join('\n'), { expectedVersion: f.version, message: `Note: ${brief(text.trim())}` });
  return { changed: true, ref, before: m[2], after: m[2], message: 'Saved' };
}

/** Move a task block before or after another task block in the same file. */
export async function moveTask(storage: Storage, ref: TaskRef, target: TaskRef, position: 'before' | 'after', expect?: { ref?: string; target?: string }): Promise<EditResult> {
  if (ref.path !== target.path) throw new LifecycleError('Target must be in the same project');
  const f = await storage.read(ref.path);
  const lines = f.content.split('\n');
  const m = rowAt(lines, ref.line, expect?.ref);
  rowAt(lines, target.line, expect?.target);
  const start = ref.line;
  const end = blockEnd(lines, start);
  if (target.line >= start && target.line < end) throw new LifecycleError('Cannot move a task next to itself or its own subtasks');
  const ins = position === 'before' ? target.line : blockEnd(lines, target.line);
  if (ins === start || ins === end) return { changed: false, ref, message: 'No change' };
  const block = lines.slice(start, end);
  const rest = [...lines.slice(0, start), ...lines.slice(end)];
  const at = ins > start ? ins - block.length : ins;
  rest.splice(at, 0, ...block);
  await storage.write(ref.path, rest.join('\n'), { expectedVersion: f.version, message: `Move: ${brief(m[2])}` });
  return { changed: true, ref: { path: ref.path, line: at }, message: 'Moved' };
}
