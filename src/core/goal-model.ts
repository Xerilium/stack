/**
 * The goal model: ⭐️ marks Now, dated ⛔️ and ⏰ hold work until their date, goal files carry YAML frontmatter, and an agent is a
 * session link (`[Name](#local_<id>)`) that a task inherits from its parents, its goal file, and the folder defaults above it.
 * Pure, except the readers that take a storage.
 * @req FR:goal-model/front.parse @req FR:goal-model/agent.link
 */
import { parseProject, readFrontmatter, type FmValue, type Task } from './parser';
import { NotFoundError, type Storage } from './storage';
import { SYSTEM, TASKS_DIR } from './task-paths';
import type { LintIssue } from './task-lint';

// ------------------------------------------------------------------ priority and dates

/** @req FR:goal-model/pri.now: ⭐️ (with or without the variation selector) on a row is Now. */
export const STAR = /⭐️?/u;
export const isNow = (text: string): boolean => STAR.test(text);

/** @req FR:goal-model/pri.blocked-until: `⛔️ <yyyy-mm-dd>`; a bare ⛔️ keeps its old meaning. */
export const BLOCKED_UNTIL = /⛔️?\s*(\d{4}-\d{2}-\d{2})\b/gu;
/** @req FR:goal-model/pri.start: `⏰ <yyyy-mm-dd>` (a colon may follow), next to the older `⏰ Nov 12:`. */
export const START_ISO = /⏰\s*(\d{4}-\d{2}-\d{2})\b:?/gu;
const START_MD = /⏰\s*([A-Za-z]{3})[a-z]*\s+(\d{1,2})(?:,\s*(\d{4}))?:/gu;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const iso = (y: number, m: number, d: number) => `${String(y).padStart(4, '0')}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
const validIso = (s: string) => { const [y, m, d] = s.split('-').map(Number); const t = new Date(Date.UTC(y, m - 1, d)); return t.getUTCMonth() === m - 1 && t.getUTCDate() === d; };

/** Today (`yyyy-mm-dd`) at `at` in `timeZone`. */
export function todayIn(at: Date, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', ...(timeZone ? { timeZone } : {}) }).format(at);
  } catch { return at.toISOString().slice(0, 10); }
}

/**
 * The dates a row is held until: each `⛔️ <date>` and each `⏰ <date>`. A year-less `⏰ Nov 12:` is this year, or last year when that
 * is more than six months ahead (the sweep's rule).
 * @req FR:goal-model/pri.blocked-until @req FR:goal-model/pri.start
 */
export function holdDates(text: string, today: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(BLOCKED_UNTIL)) if (validIso(m[1])) out.push(m[1]);
  for (const m of text.matchAll(START_ISO)) if (validIso(m[1])) out.push(m[1]);
  for (const m of text.matchAll(START_MD)) {
    const mo = MONTHS.indexOf(m[1].toLowerCase());
    if (mo < 0) continue;
    const y0 = Number(today.slice(0, 4));
    let y = m[3] ? Number(m[3]) : y0;
    if (!m[3]) {
      const six = new Date(Date.UTC(y0, Number(today.slice(5, 7)) - 1 + 6, Number(today.slice(8, 10))));
      if (Date.UTC(y, mo, Number(m[2])) > six.getTime()) y--;
    }
    out.push(iso(y, mo, Number(m[2])));
  }
  return out;
}

/** True while a dated ⛔️ or ⏰ on the row is after `today`. @req FR:goal-model/pri.hide */
export const isHeld = (text: string, today: string): boolean => holdDates(text, today).some((d) => d > today);

/** The text with every due `⛔️ <date>` mark removed (the sweep): `null` when nothing is due. @req FR:goal-model/pri.blocked-until */
export function releaseBlocks(line: string, today: string): { line: string; count: number } {
  let count = 0;
  const out = line.replace(new RegExp(`${BLOCKED_UNTIL.source}\\s*`, 'gu'), (m, d: string) => (validIso(d) && d <= today ? (count++, '') : m));
  return { line: out, count };
}

// ------------------------------------------------------------------ frontmatter

export { readFrontmatter, type FmValue, type Frontmatter } from './parser';

/** A session link: the name is a label, the id (`local_<id>`) is the session. @req FR:goal-model/agent.link */
export interface AgentLink { name: string; id: string }
const LINK = /^\[([^\]\n]+)\]\(#(local_[A-Za-z0-9_-]+)\)$/;
/** `[Name](#local_<id>)`, or null. @req FR:goal-model/agent.link */
export function parseAgentLink(v: string | undefined): AgentLink | null {
  const m = LINK.exec((v ?? '').trim());
  return m ? { name: m[1].trim(), id: m[2] } : null;
}
export const formatAgentLink = (l: AgentLink): string => `[${l.name}](#${l.id})`;

/** What a goal file (or a folder default) says in its frontmatter. */
export interface GoalMeta {
  aliases?: string[];
  /** The raw `agent` value; `link` when it is a session link. */ agent?: string; link?: AgentLink;
  agentDef?: string;
  legend: Record<string, string>;
  /** Every key as read, unknown ones included. */ data: Record<string, FmValue>;
}

/** The frontmatter of a goal file as Stack reads it; null without frontmatter. @req FR:goal-model/front.parse @req FR:goal-model/front.legend */
export function goalMeta(src: string): GoalMeta | null {
  const fm = readFrontmatter(src);
  if (!fm) return null;
  const d = fm.data;
  const str = (v: FmValue | undefined) => (typeof v === 'string' && v ? v : undefined);
  const aliases = Array.isArray(d.aliases) ? d.aliases : typeof d.aliases === 'string' && d.aliases ? d.aliases.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
  const agent = str(d.agent);
  const link = parseAgentLink(agent);
  const agentDef = str(d['agent-def']);
  const legend = d.legend && typeof d.legend === 'object' && !Array.isArray(d.legend) ? d.legend : {};
  return { ...(aliases ? { aliases } : {}), ...(agent ? { agent } : {}), ...(link ? { link } : {}), ...(agentDef ? { agentDef } : {}), legend, data: d };
}

/**
 * The file with one top-level frontmatter value replaced: only the value bytes change (a quoted value stays quoted). A missing key goes
 * last in the block; a file with no frontmatter gets one.
 * @req FR:goal-model/agent.restart
 */
export function setFrontmatterValue(src: string, key: string, value: string): string {
  const bom = src.startsWith('﻿') ? '﻿' : '';
  const body = src.slice(bom.length);
  const fm = readFrontmatter(body);
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  const q = (v: string, quote: string) => (quote ? `${quote}${v}${quote}` : /^[[{>|*&!%@`#'"]/.test(v) || /:\s|\s#/.test(v) ? `"${v}"` : v);
  if (!fm) return `${bom}---${eol}${key}: ${q(value, '')}${eol}---${eol}${body}`;
  const lines = body.split('\n');
  const re = new RegExp(`^(${key.replace(/[-]/g, '\\-')}:\\s*)(["']?)(.*?)(\\2)(\\r?)$`);
  for (let i = 1; i < fm.lines - 1; i++) {
    const m = re.exec(lines[i]);
    if (m) { lines[i] = `${m[1]}${q(value, m[2])}${m[5]}`; return bom + lines.join('\n'); }
  }
  const close = fm.lines - 1;
  const cr = lines[close].endsWith('\r') ? '\r' : '';
  lines.splice(close, 0, `${key}: ${q(value, '')}${cr}`);
  return bom + lines.join('\n');
}

// ------------------------------------------------------------------ agents

/** The folder default beside a folder: `<folder>/.stack/agent.md`. @req FR:goal-model/agent.inherit */
export const folderAgentPath = (folder: string): string => `${folder}/${SYSTEM}/agent.md`;
/** The folders from a goal file's own folder up to `tasks/`, nearest first. */
export function foldersOf(path: string): string[] {
  const parts = path.split('/').slice(0, -1);
  const out: string[] = [];
  for (let n = parts.length; n >= 1; n--) { const f = parts.slice(0, n).join('/'); out.push(f); if (f === TASKS_DIR) break; }
  return out.filter((f) => f === TASKS_DIR || f.startsWith(`${TASKS_DIR}/`));
}

export type AgentLevel = 'task' | 'parent' | 'goal' | 'folder';
/** A resolved agent: the link, where it came from (the file, and the task line for a task level), and that level's `agent-def`. */
export interface ResolvedAgent { link: AgentLink; level: AgentLevel; path: string; line?: number; agentDef?: string }

const metaOf = (t: Task, k: string) => t.meta?.find(([key]) => key === k)?.[1];

/** The task chain at a 0-based line, root first; null when no row is there. */
export function chainAt(src: string, line: number): Task[] | null {
  const find = (ts: Task[], up: Task[]): Task[] | null => {
    for (const t of ts) { if (t.line === line) return [...up, t]; const r = find(t.children, [...up, t]); if (r) return r; }
    return null;
  };
  for (const s of parseProject(src).sections) { const r = find(s.tasks, []); if (r) return r; }
  return null;
}

/**
 * A task's agent: its own `> agent:`, then its parents' (nearest first), then the goal file frontmatter `agent`, then
 * `<folder>/.stack/agent.md` from the goal's folder up to `tasks/`. Null: the task is the owner's.
 * `folders`: the folder defaults' sources by folder (missing: none).
 * @req FR:goal-model/agent.inherit @req FR:goal-model/agent.none
 */
export function resolveAgent(path: string, src: string, line: number | null, folders: Map<string, string>): ResolvedAgent | null {
  const chain = line === null ? [] : chainAt(src, line) ?? [];
  for (let i = chain.length - 1; i >= 0; i--) {
    const link = parseAgentLink(metaOf(chain[i], 'agent'));
    if (link) return { link, level: i === chain.length - 1 ? 'task' : 'parent', path, line: chain[i].line };
  }
  return projectLead(path, src, folders);
}

/** The lead of a goal file: its frontmatter `agent`, else the nearest folder default. @req FR:goal-model/agent.inherit @req FR:goal-model/lint.lead */
export function projectLead(path: string, src: string, folders: Map<string, string>): ResolvedAgent | null {
  const own = goalMeta(src);
  if (own?.link) return { link: own.link, level: 'goal', path, ...(own.agentDef ? { agentDef: own.agentDef } : {}) };
  for (const f of foldersOf(path)) {
    const p = folderAgentPath(f);
    const m = folders.has(p) ? goalMeta(folders.get(p)!) : null;
    if (m?.link) return { link: m.link, level: 'folder', path: p, ...(m.agentDef ? { agentDef: m.agentDef } : {}) };
  }
  return null;
}

/** Every folder default above the given goal files, read from storage (a missing one is skipped). @req FR:goal-model/agent.inherit */
export async function readFolderAgents(storage: Pick<Storage, 'read'>, paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const p of [...new Set(paths.flatMap(foldersOf))].map(folderAgentPath)) {
    try { out.set(p, (await storage.read(p)).content); } catch (e) { if (!(e instanceof NotFoundError)) throw e; }
  }
  return out;
}

/** The resolved agent of the row at `ref` (0-based line), read from storage. @req FR:goal-model/agent.inherit */
export async function taskAgent(storage: Pick<Storage, 'read'>, ref: { path: string; line: number }): Promise<ResolvedAgent | null> {
  const src = (await storage.read(ref.path)).content;
  return resolveAgent(ref.path, src, ref.line, await readFolderAgents(storage, [ref.path]));
}

/** A session from the local session list (`id` `local_…`, `cli` the Claude Code id). */
export interface LocalSession { id: string; cli?: string }
/** The link's session is on this machine: its id is the session id, or `local_<cli id>` for a session Stack started. @req FR:goal-model/lint.dead */
export const sessionAlive = (link: AgentLink, sessions: LocalSession[]): boolean =>
  sessions.some((s) => s.id === link.id || (!!s.cli && `local_${s.cli}` === link.id));

// ------------------------------------------------------------------ lint

export interface AgentLintOptions {
  /** Paths to report on (others are only read); all when absent. */ only?: Set<string>;
  /** True when a repo path exists (for `agent-def`); the check is skipped when absent. */ exists?: (path: string) => boolean;
  /** The local session list; null or absent skips the dead-link check. */ sessions?: LocalSession[] | null;
}

/**
 * Agent lint over goal files and folder defaults (`tasks/**\/.stack/agent.md`). No network: the dead-link check reads only the
 * local session list it is handed.
 * @req FR:goal-model/lint.lead @req FR:goal-model/lint.duplicate @req FR:goal-model/lint.dead @req FR:goal-model/lint.agent-def
 */
export function lintAgents(files: { path: string; content: string }[], o: AgentLintOptions = {}): LintIssue[] {
  const folders = new Map(files.filter((f) => f.path.endsWith(`/${SYSTEM}/agent.md`)).map((f) => [f.path, f.content]));
  const goals = files.filter((f) => !folders.has(f.path));
  const report = (p: string) => !o.only || o.only.has(p);
  const out: LintIssue[] = [];
  const links: { link: AgentLink; path: string; line: number }[] = [];
  const fmLine = (src: string, key: string) => { const i = src.split('\n').findIndex((l, n) => n > 0 && l.startsWith(`${key}:`)); return i < 0 ? 1 : i + 1; };
  for (const f of files) {
    const m = goalMeta(f.content);
    if (m?.link) links.push({ link: m.link, path: f.path, line: fmLine(f.content, 'agent') });
    // @req FR:goal-model/lint.agent-def
    if (m?.agentDef && o.exists && report(f.path) && (m.agentDef.split('/').includes('..') || m.agentDef.startsWith('/') || !o.exists(m.agentDef))) {
      out.push({ path: f.path, line: fmLine(f.content, 'agent-def'), rule: 'agent-def', message: `agent-def names ${m.agentDef}, which does not exist. Fix the path from the repo root, or remove it.` });
    }
  }
  for (const g of goals) {
    const walk = (ts: Task[]) => { for (const t of ts) { const l = parseAgentLink(metaOf(t, 'agent')); if (l) links.push({ link: l, path: g.path, line: t.line + 2 + (t.meta ?? []).findIndex(([k]) => k === 'agent') }); walk(t.children); } };
    for (const s of parseProject(g.content).sections) walk(s.tasks);
    // @req FR:goal-model/lint.lead
    if (report(g.path) && !projectLead(g.path, g.content, folders)) {
      out.push({ path: g.path, line: 1, rule: 'agent-lead', message: `No lead agent: the file is the owner's. Add agent: "[Name](#local_<id>)" to its frontmatter or to ${folderAgentPath(foldersOf(g.path)[0] ?? TASKS_DIR)}.` });
    }
  }
  // @req FR:goal-model/lint.duplicate
  const ids = new Map<string, Set<string>>();
  const names = new Map<string, Set<string>>();
  for (const { link } of links) { (ids.get(link.name) ?? ids.set(link.name, new Set()).get(link.name)!).add(link.id); (names.get(link.id) ?? names.set(link.id, new Set()).get(link.id)!).add(link.name); }
  for (const x of links) {
    if (!report(x.path)) continue;
    if (ids.get(x.link.name)!.size > 1) out.push({ path: x.path, line: x.line, rule: 'agent-duplicate', message: `Agent "${x.link.name}" links to ${ids.get(x.link.name)!.size} sessions (${[...ids.get(x.link.name)!].join(', ')}). Use one session per name.` });
    else if (names.get(x.link.id)!.size > 1) out.push({ path: x.path, line: x.line, rule: 'agent-duplicate', message: `Session ${x.link.id} has ${names.get(x.link.id)!.size} names (${[...names.get(x.link.id)!].join(', ')}). Use one name per session.` });
  }
  // @req FR:goal-model/lint.dead
  if (o.sessions) {
    for (const x of links) {
      if (report(x.path) && !sessionAlive(x.link, o.sessions)) out.push({ path: x.path, line: x.line, rule: 'agent-dead', message: `Agent link ${formatAgentLink(x.link)} has no live session on this machine. Relink it to a live session, or add agent-def to restart it.` });
    }
  }
  return out;
}
