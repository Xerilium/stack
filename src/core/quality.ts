/**
 * Task quality gate: four deterministic checks on one row (no model call), read from the raw lines under the row.
 * Field lines follow the task schema grammar; the parser itself is unchanged, so files keep their bytes.
 * @req FR:product-reset/quality.check @req FR:product-reset/quality.rules @req FR:product-reset/quality.score
 */
import { rowOwner, type RowOwner } from './owner';
import type { Project, Task } from './parser';
import { isVerb } from './verbs';

export const CHECKS = ['next', 'doneWhen', 'context', 'single'] as const;
export type Check = (typeof CHECKS)[number];
export interface Quality { score: 0 | 1 | 2 | 3 | 4; actionable: boolean; missing: Check[] }

/** The typed fields under a row. Single-value fields keep the first one. @req FR:product-reset/schema.keys */
export interface RowFields { next?: string; doneWhen?: string; owner?: string; context: string[]; links: string[] }

const KEYS: Record<string, keyof RowFields | 'notes' | 'blockedBy' | 'checked'> = {
  'next': 'next', 'done when': 'doneWhen', 'context': 'context', 'links': 'links', 'owner': 'owner', 'blocked by': 'blockedBy', 'checked': 'checked', 'notes': 'notes',
};
const FIELD = /^- (?:\*\*([^*]+?):\*\*|([A-Za-z][A-Za-z ]*?):)(?:\s+(.*))?$/;
const TASK = /^\s*- \[[ xX]\]/;
const width = (l: string) => l.slice(0, l.length - l.trimStart().length).replace(/\t/g, '    ').length;
const bulletText = (l: string) => l.trim().replace(/^[-*+]\s+/, '').trim();

/**
 * The fields and the notes of `task`: nested lines that are not a child task row (or inside one).
 * A line nested under a field bullet is part of that field. Lines under `Notes:` are notes.
 * @req FR:product-reset/schema.grammar
 */
export function readFields(project: Pick<Project, 'lines'>, task: Pick<Task, 'line' | 'depth'>): { fields: RowFields; notes: string[] } {
  const fields: RowFields = { context: [], links: [] };
  const notes: string[] = [];
  const lines = project.lines;
  let child = -1; // indent of the child task row being skipped
  let field: { key: (typeof KEYS)[string]; indent: number } | null = null;
  for (let i = task.line + 1; i < lines.length; i++) {
    const l = lines[i].replace(/\r$/, '');
    if (!l.trim()) continue;
    const ind = width(l);
    if (l.startsWith('#') || ind <= task.depth) break;
    if (child >= 0 && ind > child) continue;
    child = -1;
    if (TASK.test(l)) { child = ind; field = null; continue; }
    if (field && ind > field.indent) {
      const v = bulletText(l);
      if (field.key === 'context') fields.context.push(v);
      else if (field.key === 'links') fields.links.push(...v.split(',').map((s) => s.trim()).filter(Boolean));
      else if (field.key === 'notes') notes.push(v);
      continue;
    }
    field = null;
    const m = FIELD.exec(l.trim());
    const key = m ? KEYS[(m[1] ?? m[2]).trim().toLowerCase()] : undefined;
    if (!m || !key) { notes.push(bulletText(l)); continue; }
    field = { key, indent: ind };
    const v = (m[3] ?? '').trim();
    if (key === 'context') { if (v) fields.context.push(v); }
    else if (key === 'links') fields.links.push(...v.split(',').map((s) => s.trim()).filter(Boolean));
    else if (key === 'notes') { if (v) notes.push(v); }
    else if ((key === 'next' || key === 'doneWhen' || key === 'owner') && v && fields[key] === undefined) fields[key] = v;
  }
  return { fields, notes };
}

const DUE_MARK = /📅\s*[A-Za-z]{3}[a-z]*\s+\d{1,2}(?:,\s*\d{4})?\s*(?:-\s*\d{1,2}\s*)?:\s*/u;

/** The row title the checks read: no owner marks, no due mark, no leading emoji or punctuation. @req FR:product-reset/quality.rules */
export function checkTitle(text: string): string {
  return text.replace(/\[([^\]]*)\]\([^)]*\)/gu, (_m, label: string) => label).replace(/🤖:\S*/gu, ' ').replace(/[🤖🪄🙋]/gu, ' ').replace(DUE_MARK, ' ').replace(/^[^\p{L}\p{N}[]+/u, '').replace(/\s+/g, ' ').trim();
}

const OWNER_REPO = /^[A-Za-z0-9][\w.-]*\/[\w.-]+$/;
const repoOf = (raw: string): string | undefined => {
  const s = raw.trim().replace(/^\[[^\]]*\]\(([^)]*)\)$/, '$1').replace(/^`|`$/g, '').replace(/^https?:\/\/github\.com\//i, '').replace(/\.git$/, '').replace(/\/+$/, '');
  return OWNER_REPO.test(s) ? s : undefined;
};

/** The repos a project names: `Repository:` first, then `Repos:`; and its `Ref prefixes:` (`FH = owner/repo`). */
function projectRepos(meta: Record<string, string>): { repos: string[]; prefixes: Map<string, string> } {
  const repos: string[] = [];
  for (const v of [meta['Repository'] ?? '', ...(meta['Repos'] ?? '').split(',')]) { const r = repoOf(v); if (r && !repos.includes(r)) repos.push(r); }
  const prefixes = new Map<string, string>();
  for (const part of (meta['Ref prefixes'] ?? '').split(',')) {
    const m = /^\s*([A-Za-z][\w-]*)\s*=\s*(\S+)\s*$/.exec(part);
    const r = m ? repoOf(m[2]) : undefined;
    if (m && r) prefixes.set(m[1].toLowerCase(), r);
  }
  return { repos, prefixes };
}

/**
 * Distinct PR and issue refs in `text` that resolve to a repo, as `owner/repo#N`, in order of appearance.
 * Short refs (`#N`, `PR N`) take the project's first repo; `repo#N` needs a project repo with that name; `{prefix} N` uses `Ref prefixes:`.
 * @req FR:product-reset/schema.refs
 */
export function rowRefs(text: string, meta: Record<string, string>): string[] {
  const { repos, prefixes } = projectRepos(meta);
  const hits: { at: number; ref: string }[] = [];
  const add = (at: number, repo: string | undefined, n: string) => { if (repo) hits.push({ at, ref: `${repo}#${Number(n)}` }); };
  const taken: [number, number][] = [];
  const free = (a: number, b: number) => !taken.some(([x, y]) => a < y && b > x);
  const scan = (re: RegExp, f: (m: RegExpExecArray) => void) => { for (const m of text.matchAll(re)) { const a = m.index!, b = a + m[0].length; if (free(a, b)) { taken.push([a, b]); f(m as RegExpExecArray); } } };
  scan(/https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/(?:pull|issues)\/(\d+)\S*/giu, (m) => add(m.index!, m[1], m[2]));
  scan(/(?<![\w/.-])([A-Za-z0-9][\w.-]*\/[\w.-]+)#(\d+)\b/gu, (m) => add(m.index!, m[1], m[2]));
  scan(/(?<![\w/.-])([A-Za-z0-9][\w.-]*)#(\d+)\b/gu, (m) => add(m.index!, repos.find((r) => r.split('/')[1].toLowerCase() === m[1].toLowerCase()), m[2]));
  scan(/(?<![\w/.#-])#(\d+)\b/gu, (m) => add(m.index!, repos[0], m[1]));
  scan(/\b(?:PR|issue)\s+(\d+)\b/giu, (m) => add(m.index!, repos[0], m[1]));
  if (prefixes.size) scan(/\b([A-Za-z][\w-]*)\s+(\d+)\b/gu, (m) => add(m.index!, prefixes.get(m[1].toLowerCase()), m[2]));
  const out: string[] = [];
  for (const h of hits.sort((a, b) => a.at - b.at)) if (!out.some((r) => r.toLowerCase() === h.ref.toLowerCase())) out.push(h.ref);
  return out;
}

const JOIN = /\s+(?:and|then)\s+|\s*;\s*/iu;
/** True when the title joins two actions: a later part (after `and`, `then` or `;`) starts with a verb. */
const joinsVerbs = (title: string): boolean => title.split(JOIN).slice(1).some((part) => isVerb(part.trim().split(/\s+/)[0] ?? ''));
const firstWord = (title: string) => (/^[\p{L}][\p{L}'-]*/u.exec(title)?.[0] ?? '');

/** The owner the checks read: an `Owner:` field settles it; else the row marks, then the ancestors'. @req FR:product-reset/schema.owner */
const ownerFor = (fields: RowFields, task: Task, ancestors: Task[]): RowOwner => (fields.owner ? (/^me$/i.test(fields.owner) ? 'me' : 'agent') : rowOwner(task.text, ancestors.map((a) => a.text)));

/**
 * The four checks on one row. `ancestors` are nearest first.
 * @req FR:product-reset/quality.rules @req FR:product-reset/quality.score
 */
export function checkRow(project: Pick<Project, 'lines' | 'metadata'>, task: Task, ancestors: Task[] = []): Quality {
  const { fields, notes } = readFields(project, task);
  const title = checkTitle(task.text);
  const refs = rowRefs([task.text, ...fields.links].join(' \n '), project.metadata);
  const pass: Record<Check, boolean> = {
    next: fields.next !== undefined || (task.children.length === 0 && isVerb(firstWord(title))),
    doneWhen: fields.doneWhen !== undefined || refs.length === 1,
    context: fields.context.length > 0 || fields.links.length > 0 || rowRefs(task.text, project.metadata).length > 0 || notes.length > 0,
    single: ownerFor(fields, task, ancestors) !== 'mixed' && !joinsVerbs(title),
  };
  const missing = CHECKS.filter((c) => !pass[c]);
  const score = (CHECKS.length - missing.length) as Quality['score'];
  return { score, actionable: score === 4, missing };
}

const chainAt = (tasks: Task[], line: number, chain: Task[] = []): Task[] | null => {
  for (const t of tasks) { if (t.line === line) return [...chain, t]; const hit = chainAt(t.children, line, [...chain, t]); if (hit) return hit; }
  return null;
};

/** The checks on the row at 0-based `line`; null when no task row is there. Pure: reads the parsed file, never writes. @req FR:product-reset/quality.check */
export function checkTask(project: Project, line: number): Quality | null {
  for (const s of project.sections) {
    const chain = chainAt(s.tasks, line);
    if (chain) return checkRow(project, chain[chain.length - 1], chain.slice(0, -1).reverse());
  }
  return null;
}
