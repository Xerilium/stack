import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { parseProject, serializeProject } from './parser';
import type { Project, Section, Task } from './parser';
import type { FormatId, StackConfig } from './config';

export type { FormatId } from './config';

export class FormatterError extends Error {}

/**
 * Reads and writes one task file format.
 * @req FR:formatter-clean/iface.@type
 */
export interface Formatter {
  id: FormatId;
  extension: string;
  parse(src: string): Project;
  serialize(p: Project): string;
}

// ------------------------------------------------------------------ emoji

const indent = (n: number) => ' '.repeat(n);

function emojiTask(t: Task, depth: number, out: string[]): void {
  out.push(`${indent(depth)}- [${t.checked ? 'x' : ' '}] ${t.text}`);
  for (const n of t.notes) out.push(`${indent(depth + 2)}${n}`);
  for (const c of t.children) emojiTask(c, depth + 2, out);
}

function generateEmoji(p: Project): string {
  const out: string[] = [];
  if (p.title) out.push(`# ${p.title}`);
  const meta = Object.entries(p.metadata);
  if (meta.length) {
    if (out.length) out.push('');
    for (const [k, v] of meta) out.push(`- **${k}:** ${v}`);
  }
  for (const s of p.sections) {
    if (out.length) out.push('');
    out.push(`## ${s.heading}`);
    if (s.tasks.length) {
      out.push('');
      for (const t of s.tasks) emojiTask(t, 0, out);
    }
  }
  return out.length ? out.join('\n') + '\n' : '';
}

/**
 * Legacy emoji-markdown; delegates to the task-parser.
 * @req FR:formatter-clean/emoji.adapter @req FR:formatter-clean/emoji.generate
 */
export const emojiFormatter: Formatter = {
  id: 'emoji',
  extension: '.md',
  parse: parseProject,
  serialize: p => (p.lines.length ? serializeProject(p) : generateEmoji(p)),
};

// ------------------------------------------------------------------ clean

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const fail = (path: string, msg: string): never => { throw new FormatterError(`${path || 'root'}: ${msg}`); };

function strList(v: unknown, path: string): string[] {
  if (!Array.isArray(v)) return fail(path, 'expected list');
  v.forEach((x, i) => { if (typeof x !== 'string') fail(`${path}[${i}]`, 'expected string'); });
  return v as string[];
}

const checkKeys = (o: Obj, allowed: string[], path: string): void => {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) fail(path ? `${path}.${k}` : k, 'unknown key');
};

// depth is the emoji-format indent in spaces (2 per nesting level), matching the canonical 2-space indent.
function cleanTask(v: unknown, path: string, depth: number): Task {
  if (!isObj(v)) return fail(path, 'expected object');
  checkKeys(v, ['text', 'done', 'notes', 'subtasks'], path);
  if (typeof v.text !== 'string') fail(`${path}.text`, 'expected string');
  if (typeof v.done !== 'boolean') fail(`${path}.done`, 'expected boolean');
  const subs = v.subtasks === undefined ? [] : v.subtasks;
  if (!Array.isArray(subs)) fail(`${path}.subtasks`, 'expected list');
  return {
    checked: v.done as boolean,
    text: v.text as string,
    notes: v.notes === undefined ? [] : strList(v.notes, `${path}.notes`),
    children: (subs as unknown[]).map((c, i) => cleanTask(c, `${path}.subtasks[${i}]`, depth + 2)),
    line: -1,
    depth,
  };
}

function cleanOut(t: Task): Obj {
  return {
    text: t.text,
    done: t.checked,
    ...(t.notes.length ? { notes: t.notes } : {}),
    ...(t.children.length ? { subtasks: t.children.map(cleanOut) } : {}),
  };
}

function parseClean(src: string): Project {
  let doc: unknown;
  try {
    doc = yamlParse(src.replace(/^﻿/, ''));
  } catch (e) {
    throw new FormatterError(`root: invalid YAML (${(e as Error).message.split('\n')[0]})`);
  }
  if (doc === null || doc === undefined) doc = {};
  if (!isObj(doc)) return fail('root', 'expected mapping');
  checkKeys(doc, ['title', 'metadata', 'sections'], '');
  if (doc.title !== undefined && typeof doc.title !== 'string') fail('title', 'expected string');
  const metadata: Record<string, string> = {};
  if (doc.metadata !== undefined) {
    if (!isObj(doc.metadata)) fail('metadata', 'expected mapping');
    for (const [k, v] of Object.entries(doc.metadata as Obj)) {
      if (typeof v !== 'string') fail(`metadata.${k}`, 'expected string');
      metadata[k] = v as string;
    }
  }
  const rawSections = doc.sections === undefined ? [] : doc.sections;
  if (!Array.isArray(rawSections)) fail('sections', 'expected list');
  const sections: Section[] = (rawSections as unknown[]).map((s, i) => {
    const path = `sections[${i}]`;
    if (!isObj(s)) return fail(path, 'expected object');
    checkKeys(s, ['heading', 'tasks'], path);
    if (typeof s.heading !== 'string') fail(`${path}.heading`, 'expected string');
    const tasks = s.tasks === undefined ? [] : s.tasks;
    if (!Array.isArray(tasks)) fail(`${path}.tasks`, 'expected list');
    return {
      heading: s.heading as string,
      tasks: (tasks as unknown[]).map((t, j) => cleanTask(t, `${path}.tasks[${j}]`, 0)),
    };
  });
  const project: Project = {
    title: (doc.title as string | undefined) ?? '',
    metadata,
    sections,
    lines: [],
    setChecked(task, checked) { task.checked = checked; },
  };
  return project;
}

function serializeClean(p: Project): string {
  const doc: Obj = {
    ...(p.title ? { title: p.title } : {}),
    ...(Object.keys(p.metadata).length ? { metadata: p.metadata } : {}),
    sections: p.sections.map(s => ({ heading: s.heading, tasks: s.tasks.map(cleanOut) })),
  };
  return yamlStringify(doc, { lineWidth: 0 });
}

/**
 * Clean YAML format.
 * @req FR:formatter-clean/clean.shape @req FR:formatter-clean/clean.parse @req FR:formatter-clean/clean.serialize
 * @req FR:formatter-clean/clean.invalid @req FR:formatter-clean/clean.set-checked
 */
export const cleanFormatter: Formatter = {
  id: 'clean',
  extension: '.yaml',
  parse: parseClean,
  serialize: serializeClean,
};

// --------------------------------------------------------------- registry

const FORMATTERS: Record<FormatId, Formatter> = { emoji: emojiFormatter, clean: cleanFormatter };

/** @req FR:formatter-clean/iface.registry */
export function getFormatter(id: FormatId): Formatter {
  if (!Object.prototype.hasOwnProperty.call(FORMATTERS, id)) throw new FormatterError(`unknown format: ${String(id)}`);
  return FORMATTERS[id];
}

/** @req FR:formatter-clean/iface.detect */
export function detectFormat(path: string): FormatId {
  return /\.ya?ml$/i.test(path) ? 'clean' : 'emoji';
}

/** @req FR:formatter-clean/convert.fn @req FR:formatter-clean/convert.emoji-clean-emoji @req FR:formatter-clean/convert.clean-emoji-clean */
export function convert(src: string, from: FormatId, to: FormatId): string {
  return getFormatter(to).serialize(getFormatter(from).parse(src));
}

/** @req FR:formatter-clean/select.render */
export function renderOutputs(
  project: Project,
  config: Pick<StackConfig, 'format' | 'alsoWrite'>,
): { format: FormatId; extension: string; content: string }[] {
  return [config.format, ...config.alsoWrite].map(id => {
    const f = getFormatter(id);
    return { format: id, extension: f.extension, content: f.serialize(project) };
  });
}
