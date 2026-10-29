/**
 * Actions an ask can carry, run by Stack on the owner's answer so the task file changes at once.
 * @req FR:quick-triage/flow.actions @req FR:quick-triage/flow.apply @req FR:quick-triage/flow.text
 */
import { completeTask, EFFORT, IMPACT, LifecycleError, PRIORITY, resumeTask, setProperties, skipTask, startTask, STATUS, suspendTask, type LifecycleContext, type LifecycleResult, type TaskProps, type TaskRef } from './lifecycle';
import { ConflictError, NotFoundError } from './storage';

export type Action =
  | { kind: 'set'; props: TaskProps }
  | { kind: 'due'; date: string }
  | { kind: 'suspend'; days?: number; hours?: number }
  | { kind: 'skip' } | { kind: 'complete' } | { kind: 'start' } | { kind: 'resume' }
  | { kind: 'note'; text: string };

const REF = /^([^/\\:\0.][^/\\:\0]*):(\d{1,9})$/;
const ROW = /^(\s*- )(\[[ xX]\] )(.+)$/;
const DUE = /^([A-Z][a-z]{2}) (\d{1,2})(?:, (\d{4}))?$/;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DUE_MARK = /📅\s+[A-Za-z]{3}\s+\d{1,2}(?:,\s*\d{4})?:\s*/u;
const PROPS: Record<string, readonly string[]> = { priority: PRIORITY, status: STATUS, effort: EFFORT, impact: IMPACT };

/** `project:line` (the api ref: the 0-based line of the row in `tasks/<project>.md`). */
export function parseTaskRef(v: unknown): TaskRef {
  const m = typeof v === 'string' ? REF.exec(v) : null;
  if (!m || /^readme$/i.test(m[1])) throw new LifecycleError(`ref must look like project:line: ${String(v)}`);
  return { path: `tasks/${m[1]}.md`, line: Number(m[2]) };
}

/** One action line; `-` means none (null). Anything outside the vocabulary throws. @req FR:quick-triage/flow.actions */
export function parseAction(text: string): Action | null {
  const t = (text ?? '').trim();
  if (t === '-') return null;
  const [verb, ...rest] = t.split(/\s+/);
  const arg = rest.join(' ');
  switch (verb) {
    case 'set': {
      if (!rest.length) throw new LifecycleError('set needs prop=value');
      const props: TaskProps = {};
      for (const pair of rest) {
        const m = /^(priority|status|effort|impact|checkbox)=(.+)$/.exec(pair);
        if (!m) throw new LifecycleError(`set: unknown property in "${pair}" (priority, status, effort, impact, checkbox)`);
        const [, k, v] = m;
        if (k === 'checkbox') { if (v !== 'Complete' && v !== 'Incomplete') throw new LifecycleError('checkbox must be Complete or Incomplete'); props.checkbox = v; continue; }
        if (v !== 'None' && !PROPS[k].includes(v)) throw new LifecycleError(`set: ${k} must be one of ${PROPS[k].join(' ')} or None`);
        (props as Record<string, string>)[k] = v;
      }
      return { kind: 'set', props };
    }
    case 'due': {
      const m = DUE.exec(arg);
      if (!m || !MONTHS.includes(m[1]) || Number(m[2]) < 1 || Number(m[2]) > 31) throw new LifecycleError(`due must be like "Nov 3" or "Nov 3, 2027": ${arg}`);
      return { kind: 'due', date: arg };
    }
    case 'suspend': {
      const m = /^(\d{1,4})([dh])$/.exec(arg);
      if (!m) throw new LifecycleError(`suspend must be like 7d or 2h: ${arg}`);
      return m[2] === 'd' ? { kind: 'suspend', days: Number(m[1]) } : { kind: 'suspend', hours: Number(m[1]) };
    }
    case 'skip': case 'complete': case 'start': case 'resume':
      if (arg) throw new LifecycleError(`${verb} takes no argument`);
      return { kind: verb };
    case 'note':
      if (!arg) throw new LifecycleError('note needs text');
      return { kind: 'note', text: arg };
    default:
      throw new LifecycleError(`Unknown action: ${t || '(empty)'} (set, due, suspend, skip, complete, start, resume, note)`);
  }
}

/** The row at `ref`, or a NotFoundError. */
export async function readRow(ctx: LifecycleContext, ref: TaskRef): Promise<{ lines: string[]; version: string; row: RegExpExecArray }> {
  let f: { content: string; version: string };
  try { f = await ctx.storage.read(ref.path); } catch { throw new NotFoundError(`No such file: ${ref.path}`); }
  const lines = f.content.split('\n');
  const row = ROW.exec((lines[ref.line] ?? '').replace(/\r$/, '').replace(/^﻿/, ''));
  if (!row) throw new NotFoundError(`Not a task row: ${ref.path}:${ref.line}`);
  if (ref.text !== undefined && row[3].trim() !== ref.text.trim()) throw new ConflictError(`Row changed since the ask was written: ${ref.path}:${ref.line}`);
  return { lines, version: f.version, row };
}

const cr = (l: string) => (l.endsWith('\r') ? '\r' : '');

/** Runs one action on the row; a row that moved or vanished is a ConflictError. @req FR:quick-triage/flow.apply */
export async function applyAction(ctx: LifecycleContext, ref: TaskRef, a: Action): Promise<LifecycleResult> {
  try {
    switch (a.kind) {
      case 'set': return await setProperties(ctx, ref, a.props);
      case 'suspend': return await suspendTask(ctx, ref, { days: a.days, hours: a.hours });
      case 'skip': return await skipTask(ctx, ref);
      case 'complete': return await completeTask(ctx, ref);
      case 'start': return await startTask(ctx, ref);
      case 'resume': return await resumeTask(ctx, ref);
      case 'due': {
        const { lines, version, row } = await readRow(ctx, ref);
        const body = row[3].replace(DUE_MARK, '');
        const lead = /^((?:🚨|‼️|🔺|🔻)\s+)?/u.exec(body)![1] ?? '';
        const next = `${row[1]}${row[2]}${lead}📅 ${a.date}: ${body.slice(lead.length)}`;
        lines[ref.line] = next + cr(lines[ref.line]);
        await ctx.storage.write(ref.path, lines.join('\n'), { expectedVersion: version, message: `Due ${a.date}: ${row[3]}` });
        return { changed: true, ref, before: row[0], after: next };
      }
      case 'note': {
        const { lines, version, row } = await readRow(ctx, ref);
        const indent = `${row[1].replace(/- $/, '')}  `;
        lines.splice(ref.line + 1, 0, `${indent}> ${a.text}${cr(lines[ref.line])}`);
        await ctx.storage.write(ref.path, lines.join('\n'), { expectedVersion: version, message: `Note: ${row[3]}` });
        return { changed: true, ref, before: row[0], after: row[0] };
      }
    }
  } catch (e) {
    if (e instanceof NotFoundError || e instanceof LifecycleError) throw new ConflictError(`Could not apply "${describe(a)}" to ${ref.path}:${ref.line}: ${e.message}`);
    throw e;
  }
}

export function describe(a: Action): string {
  switch (a.kind) {
    case 'set': return `set ${Object.entries(a.props).map(([k, v]) => `${k}=${v}`).join(' ')}`;
    case 'due': return `due ${a.date}`;
    case 'suspend': return `suspend ${a.days !== undefined ? `${a.days}d` : `${a.hours}h`}`;
    case 'note': return `note ${a.text}`;
    default: return a.kind;
  }
}
