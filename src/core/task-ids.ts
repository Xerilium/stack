/**
 * Readable, path-qualified task IDs (`T:<project-id>.<slug>`), the ID index, `stack ids assign`, `stack mv`, and the ID lint.
 * The file stores only the slug (`> id: <slug>` under the row); the project ID comes from the path.
 */
import { parseProject, type Task } from './parser';
import { NotFoundError, writeAll, type FileWrite, type Storage } from './storage';
import { inboxFile, isReadme, logFile, PROJECT_ID, projectId, projectPath, ROOT_SYSTEM, TASK_PATH } from './task-paths';
import { fencedLines, type LintIssue } from './task-lint';

/** The one place the prefix is spelled. @req FR:task-ids/id.format */
export const TASK_ID_PREFIX = 'T:';
const SLUG_MAX = 40;
/** @req FR:task-ids/assign.slug */
export const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Metadata keys of fields that are emoji in Stack; the emoji stays the source of truth. @req FR:task-ids/meta.emoji */
export const EMOJI_KEYS = ['priority', 'status', 'due', 'start', 'effort', 'impact', 'tier', 'parked', 'suspended', 'human', 'autonomy'] as const;
/** @req FR:task-ids/meta.fields: known metadata keys (typed links one per line); others are kept as unknown. */
export const META_KEYS = ['id', 'agent', 'blocked', 'pr', 'issue', 'mail', 'session', 'doc', 'link'] as const;
/** @req FR:task-ids/meta.retired: keys the owner retired. */
export const RETIRED_KEYS = ['owner', 'next', 'req', 'blocked_by'] as const;

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** A `T:` ref in text: the project is greedy, so it splits at the last `.` that a valid slug follows. */
/** Nothing word-like or path-like may come right before the prefix (`PST:9.30` and `AT:x.y` are not refs). */
const REF_IN_TEXT = new RegExp(`(?<![A-Za-z0-9_/.:-])${esc(TASK_ID_PREFIX)}([A-Za-z0-9_][A-Za-z0-9_./-]*)\\.([a-z0-9]+(?:-[a-z0-9]+)*)(?![A-Za-z0-9_-])`, 'g');
const PROJECT = new RegExp(`^${PROJECT_ID}$`);
/** Text a ref is never in: inline code and URLs (replaced by spaces, so columns hold). */
const unref = (l: string) => l.replace(/`[^`]*`|https?:\/\/\S+/g, (m) => ' '.repeat(m.length));

/** @req FR:task-ids/id.format */
export const formatTaskId = (project: string, slug: string): string => `${TASK_ID_PREFIX}${project}.${slug}`;

/** @req FR:task-ids/id.parse: `{ project, slug }`, split at the last `.`, or null. */
export function parseTaskId(s: string): { project: string; slug: string } | null {
  if (typeof s !== 'string' || !s.startsWith(TASK_ID_PREFIX)) return null;
  const body = s.slice(TASK_ID_PREFIX.length);
  const dot = body.lastIndexOf('.');
  if (dot <= 0) return null;
  const project = body.slice(0, dot), slug = body.slice(dot + 1);
  return PROJECT.test(project) && SLUG.test(slug) && slug.length <= SLUG_MAX && TASK_PATH.test(projectPath(project)) ? { project, slug } : null;
}

/** A row's `id` metadata value, if any. */
export const idOf = (t: Task): string | undefined => t.meta?.find(([k]) => k === 'id')?.[1];

const walk = (tasks: Task[], f: (t: Task) => void): void => { for (const t of tasks) { f(t); walk(t.children, f); } };
/** Every task row outside a code fence (a fenced row is an example, not a task). */
const rows = (src: string): { project: ReturnType<typeof parseProject>; tasks: Task[]; fenced: Set<number> } => {
  const project = parseProject(src);
  const fenced = fencedLines(project.lines);
  const tasks: Task[] = [];
  for (const s of project.sections) walk(s.tasks, (t) => { if (!fenced.has(t.line)) tasks.push(t); });
  return { project, tasks, fenced };
};

export interface TaskFile { path: string; content: string }

/** Full ID to `{ path, line }` (0-based) from the files given; the first row wins a duplicate. */
export function indexOf(files: TaskFile[]): Map<string, { path: string; line: number }> {
  const out = new Map<string, { path: string; line: number }>();
  for (const f of files) {
    if (isReadme(f.path)) continue;
    for (const t of rows(f.content).tasks) {
      const slug = idOf(t);
      if (!slug || !SLUG.test(slug)) continue;
      const id = formatTaskId(projectId(f.path), slug);
      if (!out.has(id)) out.set(id, { path: f.path, line: t.line });
    }
  }
  return out;
}

async function readTaskFiles(storage: Pick<Storage, 'list' | 'read'>): Promise<TaskFile[]> {
  const paths = (await storage.list()).filter((p) => !isReadme(p));
  return Promise.all(paths.map(async (path) => ({ path, content: (await storage.read(path)).content })));
}

/** Every task ID in the repo, built on read. @req FR:task-ids/id.index */
export async function taskIndex(storage: Pick<Storage, 'list' | 'read'>): Promise<Map<string, { path: string; line: number }>> {
  return indexOf(await readTaskFiles(storage));
}

/**
 * A slug from task text: no emoji, markdown, URLs, or `--` reason; lower case words joined by `-`, cut at 40 on a word end.
 * @req FR:task-ids/assign.slug
 */
export function slugOf(text: string): string {
  const t = text
    .replace(/\s(?:--|—|–)\s.*$/u, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/https?:\/\/\S+/gu, ' ')
    .replace(/[0-9#*]️?⃣/gu, ' ')
    .replace(/[\p{Extended_Pictographic}️‍]/gu, ' ')
    .toLowerCase();
  const words = t.split(/[^a-z0-9]+/).filter(Boolean);
  let out = '';
  for (const w of words) {
    const next = out ? `${out}-${w}` : w;
    if (next.length > SLUG_MAX) { if (!out) out = w.slice(0, SLUG_MAX); break; }
    out = next;
  }
  return out || 'task';
}

interface Ctx { storage: Storage }

/**
 * Adds `> id: <slug>` under each row without one (script-owned 🌐 rows excepted), one write for all files.
 * @req FR:task-ids/assign.add @req FR:task-ids/assign.keep @req FR:task-ids/assign.idempotent @req FR:task-ids/assign.commit
 */
export async function assignIds(ctx: Ctx, o: { project?: string; dryRun?: boolean } = {}): Promise<{ files: string[]; added: number }> {
  const writes: FileWrite[] = [];
  let added = 0;
  for (const path of (await ctx.storage.list()).filter((p) => !isReadme(p) && (o.project === undefined || p === projectPath(o.project)))) {
    const f = await ctx.storage.read(path);
    const { project, tasks } = rows(f.content);
    const taken = new Set(tasks.map(idOf).filter((s): s is string => !!s));
    const inserts: { after: number; line: string }[] = [];
    for (const t of tasks) {
      if (idOf(t) !== undefined || t.text.trimStart().startsWith('🌐')) continue;
      const base = slugOf(t.text);
      let slug = base;
      for (let n = 2; taken.has(slug); n++) slug = `${base.slice(0, SLUG_MAX - String(n).length - 1).replace(/-+$/, '')}-${n}`;
      taken.add(slug);
      const row = project.lines[t.line];
      const indent = /^\s*/.exec(row)![0];
      inserts.push({ after: t.line, line: `${indent}  > id: ${slug}${row.endsWith('\r') ? '\r' : ''}` });
    }
    if (!inserts.length) continue;
    const lines = [...project.lines];
    for (const ins of inserts.sort((a, b) => b.after - a.after)) lines.splice(ins.after + 1, 0, ins.line);
    writes.push({ path, content: lines.join('\n'), expectedVersion: f.version });
    added += inserts.length;
  }
  if (writes.length && !o.dryRun) await writeAll(ctx.storage, writes, `Assign ${added} task IDs`);
  return { files: writes.map((w) => w.path), added };
}

/** Every file in every `.stack/` folder; adapters without `listSystem` fall back to the files Stack knows by name. */
async function systemFiles(storage: Storage, projects: string[]): Promise<string[]> {
  if (storage.listSystem) return storage.listSystem();
  const out = new Set<string>([...(await storage.listAsks?.()) ?? [], ...(await storage.listAgents?.()) ?? [], `${ROOT_SYSTEM}/logs/sessions.md`]);
  for (const p of projects) { for (let n = 0; n < 5; n++) out.add(logFile(p, n)); out.add(inboxFile(p)); }
  return [...out];
}

const readOrNull = async (s: Storage, p: string) => { try { return await s.read(p); } catch (e) { if (e instanceof NotFoundError) return null; throw e; } };

/**
 * Moves a project file with its logs and inbox, and rewrites every ref to it under `tasks/`, in one write.
 * @req FR:task-ids/mv.file @req FR:task-ids/mv.refs @req FR:task-ids/mv.safe @req FR:task-ids/mv.report
 */
export async function moveProject(ctx: Ctx, from: string, to: string, o: { dryRun?: boolean } = {}): Promise<{ files: string[]; refs: number }> {
  const src = projectPath(from), dst = projectPath(to);
  for (const [id, p] of [[from, src], [to, dst]]) if (!PROJECT.test(id) || !TASK_PATH.test(p)) throw new Error(`Bad project ID: ${id}`);
  const cur = await readOrNull(ctx.storage, src);
  if (!cur) throw new NotFoundError(`Project not found: ${from}`);
  if (await readOrNull(ctx.storage, dst)) throw new Error(`Target exists: ${to}`);
  let refs = 0;
  // Whole refs only: `T:a.x` moves with `a`, never `T:a.b.x` (project `a.b`) or `T:ab.x`.
  const path = new RegExp(`(?<![A-Za-z0-9_/.-])${esc(src)}:(?=\\d)`, 'g');
  const apiRef = new RegExp(`(^|\\s)(ref: )${esc(from)}:(?=\\d)`, 'gm');
  const rewrite = (s: string) => s
    .replace(REF_IN_TEXT, (m, p: string, slug: string) => { if (p !== from) return m; refs++; return formatTaskId(to, slug); })
    .replace(path, () => { refs++; return `${dst}:`; })
    .replace(apiRef, (_m, pre: string, key: string) => { refs++; return `${pre}${key}${to}:`; });
  const moves = new Map<string, string>([[src, dst], ...[0, 1, 2, 3, 4].map((n) => [logFile(src, n), logFile(dst, n)] as [string, string]), [inboxFile(src), inboxFile(dst)]]);
  const writes: FileWrite[] = [];
  const changed: string[] = [];
  const projects = await ctx.storage.list();
  for (const path of [...new Set([...projects, ...await systemFiles(ctx.storage, projects)])].sort()) {
    const f = await readOrNull(ctx.storage, path);
    if (!f) continue;
    const next = rewrite(f.content);
    const dest = moves.get(path);
    if (dest) writes.push({ path: dest, content: next, expectedVersion: null }, { path, content: null, expectedVersion: f.version });
    else if (next !== f.content) writes.push({ path, content: next, expectedVersion: f.version });
    else continue;
    changed.push(path);
  }
  if (!o.dryRun) await writeAll(ctx.storage, writes, `Move ${from} to ${to}`);
  return { files: changed, refs };
}

/**
 * Duplicate slugs, bad slugs, emoji fields in metadata, and `T:` refs the index does not resolve. `line` is 1-based.
 * `only`: report issues for these paths only (the index still reads every file).
 * @req FR:task-ids/lint.duplicate @req FR:task-ids/lint.dangling @req FR:task-ids/lint.slug @req FR:task-ids/meta.emoji
 */
export function lintIds(files: TaskFile[], only?: Set<string>): LintIssue[] {
  const index = indexOf(files);
  const out: LintIssue[] = [];
  for (const f of files) {
    if (isReadme(f.path) || (only && !only.has(f.path))) continue;
    const { project, tasks, fenced } = rows(f.content);
    const seen = new Set<string>();
    for (const t of tasks) {
      (t.meta ?? []).forEach(([k, v], i) => {
        const line = t.line + i + 2;
        if (k === 'id') {
          if (!SLUG.test(v) || v.length > SLUG_MAX) out.push({ path: f.path, line, rule: 'id-slug', message: `Task ID "${v}" is not a slug (a-z, 0-9, -; up to ${SLUG_MAX}).` });
          else if (seen.has(v)) out.push({ path: f.path, line, rule: 'id-duplicate', message: `Task ID "${v}" is used twice in this file.` });
          seen.add(v);
        }
        if ((EMOJI_KEYS as readonly string[]).includes(k)) out.push({ path: f.path, line, rule: 'meta-emoji', message: `"${k}" is an emoji field. Use the emoji on the task row.` });
        if (k.includes('_') || (RETIRED_KEYS as readonly string[]).includes(k)) out.push({ path: f.path, line, rule: 'meta-key', message: `"${k}" is not a metadata key (no "_"; owner, next, req, and blocked_by are retired).` });
      });
    }
    project.lines.forEach((l, i) => {
      if (fenced.has(i)) return;
      for (const m of unref(l).matchAll(REF_IN_TEXT)) {
        const id = formatTaskId(m[1], m[2]);
        if (!index.has(id)) { out.push({ path: f.path, line: i + 1, rule: 'id-dangling', message: `Task ref ${id} does not resolve.` }); break; }
      }
    });
  }
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line));
}
