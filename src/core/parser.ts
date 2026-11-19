export interface Task {
  checked: boolean;
  text: string;
  children: Task[];
  notes: string[];
  line: number;
  depth: number;
  /** @req FR:task-ids/meta.model: `> key: value` lines directly under the row, in order; unknown keys kept. Set by `parseProject`. */
  meta?: [string, string][];
}

/** One metadata line: indented `> key: value`, key lower case. @req FR:task-ids/meta.parse */
export const META_LINE = /^(\s+)> ([a-z][a-z0-9_-]*):(?: (.*))?$/;
export interface Section { heading: string; tasks: Task[]; }
export interface Project {
  title: string;
  metadata: Record<string, string>;
  sections: Section[];
  lines: string[];
  setChecked(task: Task, checked: boolean): void;
}

export type FmValue = string | string[] | Record<string, string>;
/** A frontmatter block: its values, and the number of lines it takes (both `---` lines included). */
export interface Frontmatter { data: Record<string, FmValue>; lines: number }

const unquote = (v: string) => { const t = v.trim(); return /^(["']).*\1$/.test(t) ? t.slice(1, -1).replace(/\\"/g, '"') : t; };
const LINK_VALUE = /^\[[^\]]*\]\([^)]*\)$/;
/** One value: a quoted or plain string, or a flow list `[a, b]` (a markdown link stays a string). */
function scalar(raw: string): string | string[] {
  const v = raw.trim();
  if (v.startsWith('[') && v.endsWith(']') && !LINK_VALUE.test(v)) return v.slice(1, -1).split(',').map(unquote).filter(Boolean);
  return unquote(/^["']/.test(v) ? v : v.replace(/\s+#.*$/, ''));
}

/**
 * The YAML frontmatter at the start of a file (after a BOM), or null. The one reader, and a small one: `key: value`, `key: [a, b]`,
 * and a key with an indented `- item` list or `k: v` map. Unknown keys are kept; nothing is written.
 * @req FR:goal-model/front.parse @req FR:goal-model/front.roundtrip
 */
export function readFrontmatter(src: string): Frontmatter | null {
  if (!/^﻿?---\r?\n/.test(src)) return null;
  const lines = src.replace(/^﻿/, '').split('\n').map((l) => l.replace(/\r$/, ''));
  if (lines[0] !== '---') return null;
  const end = lines.findIndex((l, i) => i > 0 && (l === '---' || l === '...'));
  if (end < 0) return null;
  const data: Record<string, FmValue> = {};
  let open: string | null = null;
  for (const l of lines.slice(1, end)) {
    if (!l.trim()) continue;
    if (/^\s/.test(l)) {
      if (!open) continue;
      const item = /^\s+-\s+(.*)$/.exec(l);
      if (item) { const cur = data[open]; data[open] = [...(Array.isArray(cur) ? cur : []), unquote(item[1])]; continue; }
      const kv = /^\s+(.+?):\s+(.*)$/.exec(l);
      if (kv) { const cur = data[open]; data[open] = { ...(cur && typeof cur === 'object' && !Array.isArray(cur) ? cur : {}), [unquote(kv[1])]: unquote(kv[2]) }; }
      continue;
    }
    // @req FR:goal-model/front.strict: a top-level line that is not `key:` means the block is markdown, not frontmatter.
    const m = /^([A-Za-z][A-Za-z0-9_-]*):(?:\s+(.*))?$/.exec(l);
    if (!m) return null;
    open = m[1];
    data[m[1]] = m[2] === undefined || m[2].trim() === '' ? '' : scalar(m[2]);
  }
  return { data, lines: end + 1 };
}

/** The first line of the markdown body: 0 without frontmatter, else the first non-blank line after it. @req FR:goal-model/front.parse */
export function bodyStart(lines: string[]): number {
  if (!/^﻿?---\r?$/.test(lines[0] ?? '')) return 0;
  const n = readFrontmatter(lines.join('\n'))?.lines ?? 0;
  let i = n;
  while (n && i < lines.length && !lines[i].trim()) i++;
  return i;
}

/** Frontmatter `aliases` as a list, or undefined. @req FR:goal-model/front.bullets */
export function frontmatterAliases(fm: Frontmatter | null): string[] | undefined {
  const a = fm?.data.aliases;
  if (Array.isArray(a)) return a;
  return typeof a === 'string' && a ? a.split(',').map((s) => s.trim()).filter(Boolean) : undefined;
}

/** Indent width with tabs counted as 4 columns. */
const width = (ws: string) => ws.replace(/\t/g, '    ').length;
const TASK = /^(\s*)- \[([ xX])\] ?(.*)$/;
const META = /^- \*\*(.+?):\*\*\s*(.*)$/;

/**
 * @req FR:task-parser/parse.@function @req FR:task-parser/parse.title @req FR:task-parser/parse.metadata @req FR:task-parser/parse.sections
 * @req FR:task-parser/parse.tree @req FR:task-parser/parse.tree.tabs @req FR:task-parser/parse.tree.orphan @req FR:task-parser/task.state @req FR:task-parser/task.notes
 * @req FR:task-parser/mutate.set-checked
 */
export function parseProject(src: string): Project {
  const lines = src.split('\n');
  const clean = (l: string) => l.replace(/^﻿/, '').replace(/\r$/, '');
  const project: Project = {
    title: '', metadata: {}, sections: [], lines,
    setChecked(task, checked) {
      lines[task.line] = lines[task.line].replace(/\[[ xX]\]/, checked ? '[x]' : '[ ]');
      task.checked = checked;
    },
  };
  let section: Section | null = null;
  const stack: Task[] = [];
  /** The row whose metadata block is still open (only right after the row). @req FR:task-ids/meta.parse */
  let metaOf: Task | null = null;
  // @req FR:goal-model/front.bullets: frontmatter lines are not markdown; its `aliases` win over the `- **Aliases:**` bullet.
  const fm = readFrontmatter(src);
  lines.forEach((raw, i) => {
    if (fm && i < fm.lines) return;
    const l = clean(raw);
    if (metaOf) {
      const m = META_LINE.exec(l);
      if (m && width(m[1]) > metaOf.depth) {
        metaOf.meta!.push([m[2], (m[3] ?? '').trim()]);
        // Every metadata line but `id` stays a note too, so each reader of notes still sees it.
        if (m[2] === 'id') return;
      } else metaOf = null;
    }
    if (!project.title && l.startsWith('# ')) { project.title = l.slice(2).trim(); return; }
    if (l.startsWith('## ')) {
      section = { heading: l.slice(3).trim(), tasks: [] };
      project.sections.push(section);
      stack.length = 0;
      return;
    }
    const t = TASK.exec(l);
    if (t && section) {
      const depth = width(t[1]);
      const task: Task = { checked: t[2] !== ' ', text: t[3], children: [], notes: [], line: i, depth, meta: [] };
      while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
      (stack.length ? stack[stack.length - 1].children : section.tasks).push(task);
      stack.push(task);
      metaOf = task;
      return;
    }
    if (!section) {
      const m = META.exec(l);
      if (m) project.metadata[m[1]] = m[2].trim();
      return;
    }
    if (/^\s+\S/.test(l) && stack.length) {
      const indent = width(l.slice(0, l.length - l.trimStart().length));
      let owner: Task | undefined;
      for (let k = stack.length - 1; k >= 0; k--) {
        if (stack[k].depth < indent) { owner = stack[k]; break; }
      }
      if (owner) owner.notes.push(l.trim());
    }
  });
  const aliases = frontmatterAliases(fm);
  if (aliases) project.metadata['Aliases'] = aliases.join(', ');
  return project;
}

/** @req FR:task-parser/roundtrip.exact */
export function serializeProject(p: Project): string {
  return p.lines.join('\n');
}
