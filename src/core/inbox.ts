/**
 * Owner-to-agent inbox: one append-only markdown file per project (`tasks/inbox/<slug>.md`) that agents read and mark handled.
 * The task files are never changed by a reply.
 * @req FR:agent-inbox/inbox.format @req FR:agent-inbox/inbox.send @req FR:agent-inbox/inbox.list @req FR:agent-inbox/inbox.handle
 */
import { randomBytes } from 'crypto';
import { LifecycleError, type LifecycleContext, type TaskRef } from './lifecycle';
import { parseProject, type Task } from './parser';
import { ConflictError, NotFoundError } from './storage';
import { logName, md, redact } from './triage';

export type InboxKind = 'reply' | 'decision';
export type InboxTo = 'agent' | 'human' | 'none';
export type InboxState = 'open' | 'handled';
export const INBOX_KINDS = ['reply', 'decision'] as const;
export const INBOX_STATES = ['open', 'handled', 'all'] as const;

export interface InboxEntry {
  id: string; at: string; state: InboxState; kind: InboxKind; to: InboxTo;
  /** `tasks/<file>.md:<line>`, 1-based. */
  ref: string; task: string; text: string;
  handled?: string; note?: string;
  /** Lines this version does not know; kept as is. */
  extra: string[];
}
export interface ListedEntry extends Omit<InboxEntry, 'extra'> { project: string }

/** The inbox is full of open entries. Maps to 409 with fixed text. */
export class InboxFull extends ConflictError {
  constructor() { super('Inbox is full; handle some entries first'); }
}

const MAX_INBOX = 256 * 1024;
const MAX_TEXT = 1000;
const MAX_NOTE = 500;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]/;
// eslint-disable-next-line no-control-regex
const CONTROL_RUN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g;
const INVISIBLE = /[\uFE0E\uFE0F\u200B-\u200F\u2060\uFEFF\u00AD]/g;
const KEYS = ['at', 'state', 'kind', 'to', 'ref', 'task', 'text', 'handled', 'note'] as const;
const HEAD = /^## (in-[0-9TZ]+-[0-9a-f]{4,})\s*$/;
const baseName = (p: string) => p.replace(/^.*\//, '').replace(/\.md$/, '');

export const inboxPath = (ref: Pick<TaskRef, 'path'>): string => `tasks/inbox/${logName({ path: ref.path, line: 0 })}.md`;

/** First lines of a new inbox file. */
export const INBOX_HEADER = (title: string): string =>
  `# ${title} inbox\n\n<!-- stack-inbox v1. Stack appends entries. An agent handles an entry, then sets \`state: handled\` (or calls POST /inbox/handled). -->\n\n`;

/** One entry as markdown; ends with a blank line. */
export function formatEntry(e: InboxEntry): string {
  const lines = [`## ${e.id}`, '', `- at: ${e.at}`, `- state: ${e.state}`, `- kind: ${e.kind}`, `- to: ${e.to}`, `- ref: ${e.ref}`, `- task: ${e.task}`, `- text: ${e.text}`];
  if (e.handled) lines.push(`- handled: ${e.handled}`);
  if (e.note) lines.push(`- note: ${e.note}`);
  return [...lines, ...e.extra, ''].join('\n');
}

interface Block { entry: InboxEntry; start: number; end: number }

function blocks(content: string): Block[] {
  const lines = content.split('\n');
  const out: Block[] = [];
  let cur: Block | null = null;
  let offset = 0;
  const close = (at: number) => { if (cur) { cur.end = at; out.push(cur); cur = null; } };
  for (const raw of lines) {
    const line = raw.replace(/\r$/, '');
    const h = HEAD.exec(line);
    if (h) {
      close(offset);
      cur = { entry: { id: h[1], at: '', state: 'open', kind: 'reply', to: 'none', ref: '', task: '', text: '', extra: [] }, start: offset, end: offset };
    } else if (cur && line !== '') {
      const m = /^- ([a-z]+): (.*)$/.exec(line);
      const k = m?.[1] as (typeof KEYS)[number] | undefined;
      if (m && k && (KEYS as readonly string[]).includes(k)) (cur.entry as unknown as Record<string, string>)[k] = m[2];
      else cur.entry.extra.push(line);
    }
    offset += raw.length + 1;
  }
  close(content.length);
  for (const b of out) {
    if (b.entry.handled === undefined) delete b.entry.handled;
    if (b.entry.note === undefined) delete b.entry.note;
  }
  return out;
}

/** Entries in file order. Tolerant: unknown keys go to `extra`, bad entries keep their defaults. */
export const parseInbox = (content: string): InboxEntry[] => blocks(content).map((b) => b.entry);

const field = (v: string) => md(redact(v.replace(INVISIBLE, '')).split(CONTROL_RUN).join(' ')).trim();
const iso = (ctx: LifecycleContext) => (ctx.now ?? (() => new Date()))();
const newId = (at: Date) => `in-${at.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z')}-${randomBytes(2).toString('hex')}`;

function find(tasks: Task[], line: number): Task | null {
  for (const t of tasks) {
    if (t.line === line) return t;
    const hit = find(t.children, line);
    if (hit) return hit;
  }
  return null;
}
const bareRow = (l: string) => l.replace(/\r$/, '').replace(/^\s*- \[[ xX]\] ?/, '');
const toOf = (text: string): InboxTo => (text.includes('🙋') ? 'human' : /🤖|🪄/.test(text) ? 'agent' : 'none');
/** The row title without gate marks. */
export const taskTitle = (text: string): string => text.replace(/🤖:\S*/g, '').replace(/[🤖🪄🙋]/gu, '').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim();

const MAX_TASK = 300;
/** The `task` an entry stores for a row: redacted, escaped, at most 300 characters. */
export const inboxTitle = (text: string): string => field(taskTitle(text)).slice(0, MAX_TASK);

/** The words of a stored title, without marks, dates, or links, so status, effort, due, and PR links can change. */
const taskKey = (title: string): string =>
  (title.replace(/🤖:\S*/gu, ' ').replace(/https?:\/\/\S+/g, ' ').replace(/(?:📅|⏰|💤|🔄)\s*[^:\n]*:/gu, ' ').toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).join(' ');

/**
 * Where each entry's row is now (entry id → `path:line`, 1-based like `ref`). Lines move, so rows are found by title words in the
 * same file, with both sides run through the same redaction and escaping. A cut title matches by prefix; the row nearest the stored line breaks ties.
 * Entries whose row is gone, or whose `ref` is missing or not a task file (hand-edited), are left out; one bad entry never fails the rest.
 * @req FR:agent-inbox/inbox.rows
 */
export async function currentRows(ctx: LifecycleContext, entries: Pick<InboxEntry, 'id' | 'ref' | 'task'>[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const byPath = new Map<string, typeof entries>();
  for (const e of entries) {
    const m = /^(tasks\/[^:]+\.md):\d+$/.exec(e.ref ?? '');
    if (m) byPath.set(m[1], [...(byPath.get(m[1]) ?? []), e]);
  }
  for (const [path, list] of byPath) {
    let f: { content: string } | null;
    try { f = await readOrNull(ctx, path); } catch { continue; } // e.g. a hand-edited ref outside the task files
    if (!f) continue;
    const rows: { line: number; key: string }[] = [];
    const walk = (ts: Task[]) => { for (const t of ts) { rows.push({ line: t.line + 1, key: taskKey(field(taskTitle(t.text))) }); walk(t.children); } };
    for (const s of parseProject(f.content).sections) walk(s.tasks);
    for (const e of list) {
      const cut = e.task.length >= MAX_TASK;
      const key = cut ? taskKey(e.task).replace(/ ?\S+$/, '') : taskKey(e.task); // the last word may be cut short
      if (key === '') continue;
      const was = Number(/:(\d+)$/.exec(e.ref)?.[1] ?? 0);
      const hit = rows.filter((r) => (cut ? r.key.startsWith(key) : r.key === key)).sort((a, b) => Math.abs(a.line - was) - Math.abs(b.line - was))[0];
      if (hit) out.set(e.id, `${path}:${hit.line}`);
    }
  }
  return out;
}

async function readOrNull(ctx: LifecycleContext, path: string): Promise<{ content: string; version: string } | null> {
  try { return await ctx.storage.read(path); } catch (e) { if (e instanceof NotFoundError) return null; throw e; }
}

/** Removes handled entries, oldest first, until the content fits. @req FR:agent-inbox/inbox.cap */
function makeRoom(content: string, need: number): string {
  if (content.length + need <= MAX_INBOX) return content;
  let out = content;
  for (const b of blocks(content).filter((x) => x.entry.state === 'handled')) {
    if (out.length + need <= MAX_INBOX) break;
    const piece = content.slice(b.start, b.end);
    out = out.replace(piece, '');
  }
  if (out.length + need > MAX_INBOX) throw new InboxFull();
  return out;
}

/**
 * Appends one entry for the row at `ref`. `expect` is the row text the sender saw; a mismatch is a conflict.
 * @req FR:agent-inbox/inbox.send @req FR:agent-inbox/inbox.id @req FR:agent-inbox/inbox.cap
 */
export async function sendToInbox(ctx: LifecycleContext, ref: TaskRef, text: string, kind: InboxKind, expect?: string): Promise<{ id: string; path: string }> {
  if (typeof text !== 'string') throw new LifecycleError('text must be a string');
  const t = text.replace(INVISIBLE, '').trim();
  if (t === '' || t.length > MAX_TEXT) throw new LifecycleError(`text must be 1-${MAX_TEXT} characters`);
  if (CONTROL.test(t)) throw new LifecycleError('text must be a single line');
  if (!(INBOX_KINDS as readonly string[]).includes(kind)) throw new LifecycleError('Invalid kind');
  const file = await ctx.storage.read(ref.path);
  const project = parseProject(file.content);
  let row: Task | null = null;
  for (const s of project.sections) row = row ?? find(s.tasks, ref.line);
  if (!row) throw new LifecycleError('Task not found');
  const rowText = bareRow(project.lines[ref.line] ?? row.text);
  if (expect !== undefined && expect !== rowText) throw new ConflictError('Row changed');
  const path = inboxPath(ref);
  for (let tries = 0; ; tries++) {
    const now = iso(ctx);
    const cur = await readOrNull(ctx, path);
    const used = new Set(cur ? parseInbox(cur.content).map((e) => e.id) : []);
    let id = newId(now);
    while (used.has(id)) id = newId(now);
    const entry = formatEntry({
      id, at: now.toISOString(), state: 'open', kind, to: toOf(row.text), ref: `${ref.path}:${ref.line + 1}`,
      task: inboxTitle(row.text), text: field(t), extra: [],
    });
    const head = cur ? makeRoom(cur.content, entry.length + 1).replace(/\n*$/, '\n\n') : INBOX_HEADER(field(project.title || baseName(ref.path)));
    try {
      await ctx.storage.write(path, head + entry, { expectedVersion: cur ? cur.version : null, message: `Inbox: ${baseName(ref.path)}` });
      return { id, path };
    } catch (e) {
      if (!(e instanceof ConflictError) || e instanceof InboxFull || tries >= 5) throw e;
    }
  }
}

/** Open (default), handled, or all entries across every project inbox, oldest first. @req FR:agent-inbox/inbox.list */
export async function listInbox(ctx: LifecycleContext, o: { project?: string; state?: (typeof INBOX_STATES)[number] } = {}): Promise<ListedEntry[]> {
  const state = o.state ?? 'open';
  const out: ListedEntry[] = [];
  for (const p of await ctx.storage.list()) {
    const name = baseName(p);
    if (/^readme$/i.test(name) || (o.project && o.project.toLowerCase() !== name.toLowerCase())) continue;
    const f = await readOrNull(ctx, inboxPath({ path: p }));
    if (!f) continue;
    for (const full of parseInbox(f.content)) {
      const { extra, ...e } = full;
      void extra;
      if (state === 'all' || e.state === state) out.push({ ...e, project: name });
    }
  }
  return out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

/** Marks one entry handled; every other byte stays. @req FR:agent-inbox/inbox.handle */
export async function handleEntry(ctx: LifecycleContext, id: string, actor: string, note?: string): Promise<{ changed: boolean }> {
  if (note !== undefined && (typeof note !== 'string' || note.length > MAX_NOTE || CONTROL.test(note))) throw new LifecycleError('Invalid note');
  for (const p of await ctx.storage.list()) {
    const f = await readOrNull(ctx, inboxPath({ path: p }));
    if (!f) continue;
    const b = blocks(f.content).find((x) => x.entry.id === id);
    if (!b) continue;
    if (b.entry.state === 'handled') return { changed: false };
    const piece = f.content.slice(b.start, b.end);
    const extra = [`- handled: ${iso(ctx).toISOString()} by ${/^[A-Za-z0-9._:-]{1,64}$/.test(actor) ? actor : 'api'}`, ...(note && note.trim() ? [`- note: ${field(note)}`] : [])].join('\n');
    const next = piece.replace(/^- state: open\r?$/m, '- state: handled').replace(/\n*$/, (tail) => `\n${extra}${tail || '\n'}`);
    await ctx.storage.write(inboxPath({ path: p }), f.content.slice(0, b.start) + next + f.content.slice(b.end), { expectedVersion: f.version, message: `Inbox handled: ${baseName(p)}` });
    return { changed: true };
  }
  throw new LifecycleError('Inbox entry not found');
}
