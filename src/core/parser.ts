export interface Task {
  checked: boolean;
  text: string;
  children: Task[];
  notes: string[];
  line: number;
  depth: number;
}
export interface Section { heading: string; tasks: Task[]; }
export interface Project {
  title: string;
  metadata: Record<string, string>;
  sections: Section[];
  lines: string[];
  setChecked(task: Task, checked: boolean): void;
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
  lines.forEach((raw, i) => {
    const l = clean(raw);
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
      const task: Task = { checked: t[2] !== ' ', text: t[3], children: [], notes: [], line: i, depth };
      while (stack.length && stack[stack.length - 1].depth >= depth) stack.pop();
      (stack.length ? stack[stack.length - 1].children : section.tasks).push(task);
      stack.push(task);
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
  return project;
}

/** @req FR:task-parser/roundtrip.exact */
export function serializeProject(p: Project): string {
  return p.lines.join('\n');
}
