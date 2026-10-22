import type { StackConfig } from './config';
import { parseProject } from './parser';
import {
  extractEmojis, legacyEngine, activeTimeBlocks, toScoringProject, weighProjects,
  type ScoreBreakdown, type ScoredTask, type ScoringProject, type ScoringTask, type TaskEmojis,
} from './scoring';

export class SummaryError extends Error {}

/** @req FR:summaries/$summary-input */
export interface SummaryInput {
  /** Project files in any order; they are processed in ordinal file-name order. */
  projects: { fileName: string; content: string }[];
  config: StackConfig;
  now: Date;
  previousReadme?: string;
  previousProjects?: string;
}

/** @req FR:summaries/$summary-files */
export interface SummaryFiles { readme: string; stack: string; projects: string; /** null when there are no tasks: legacy leaves my-day.md untouched. */ myDay: string | null }

// ------------------------------------------------------------------ PowerShell / .NET compatibility

/** @req FR:summaries/format.number */
export function formatNumber(n: number): string {
  if (Number.isNaN(n)) return 'NaN';
  if (!Number.isFinite(n)) return n < 0 ? '-Infinity' : 'Infinity';
  if (n === 0) return Object.is(n, -0) ? '-0' : '0';
  const [mantissa, exp] = Math.abs(n).toExponential(14).split('e');
  const x = Number(exp);
  const sign = n < 0 ? '-' : '';
  const digits = mantissa.replace('.', '').replace(/0+$/, '') || '0';
  if (x >= 15 || x < -5) {
    const m = digits.length > 1 ? `${digits[0]}.${digits.slice(1)}` : digits;
    const ax = Math.abs(x);
    return `${sign}${m}E${x < 0 ? '-' : '+'}${ax < 10 ? '0' : ''}${ax}`;
  }
  if (x >= 0) {
    const int = digits.slice(0, x + 1).padEnd(x + 1, '0');
    const frac = digits.slice(x + 1);
    return `${sign}${int}${frac ? '.' + frac : ''}`;
  }
  return `${sign}0.${'0'.repeat(-x - 1)}${digits}`;
}

/** @req FR:summaries/format.round */
export function roundHalfEven(value: number, digits: number): number {
  const power = 10 ** digits;
  const v = value * power;
  const f = Math.floor(v);
  const diff = v - f;
  const r = diff < 0.5 ? f : diff > 0.5 ? f + 1 : f % 2 === 0 ? f : f + 1;
  return r / power;
}

/** .NET `System.Decimal` subset (BigInt mantissa) for the breakdown lines, which legacy computes as decimals. */
export class Dec {
  constructor(readonly n: bigint, readonly s: number) {}
  static fromDouble(x: number): Dec {
    if (x === 0 || !Number.isFinite(x)) return new Dec(0n, 0);
    const [m, e] = Math.abs(x).toExponential(14).split('e');
    let n = BigInt(m.replace('.', ''));
    let s = 14 - Number(e);
    if (s < 0) { n *= 10n ** BigInt(-s); s = 0; }
    while (s > 0 && n % 10n === 0n) { n /= 10n; s--; }
    return new Dec(x < 0 ? -n : n, s);
  }
  add(o: Dec): Dec {
    const s = Math.max(this.s, o.s);
    return new Dec(this.n * 10n ** BigInt(s - this.s) + o.n * 10n ** BigInt(s - o.s), s);
  }
  div(o: Dec): Dec {
    const num = this.n * 10n ** BigInt(o.s);
    const den = o.n * 10n ** BigInt(this.s);
    const neg = (num < 0n) !== (den < 0n);
    const an = num < 0n ? -num : num;
    const ad = den < 0n ? -den : den;
    const limit = 79228162514264337593543950336n;
    for (let s = 28; s >= 0; s--) {
      const scaled = an * 10n ** BigInt(s);
      let q = scaled / ad;
      const rem = scaled % ad;
      if (q >= limit) continue;
      if (rem === 0n) {
        let sc = s;
        while (sc > 0 && q % 10n === 0n) { q /= 10n; sc--; }
        return new Dec(neg ? -q : q, sc);
      }
      const twice = rem * 2n;
      if (twice > ad || (twice === ad && q % 2n === 1n)) q += 1n;
      let sc = s;
      while (sc > 0 && q % 10n === 0n) { q /= 10n; sc--; }
      return new Dec(neg ? -q : q, sc);
    }
    throw new SummaryError('decimal overflow');
  }
  toString(): string {
    const neg = this.n < 0n;
    const abs = (neg ? -this.n : this.n).toString().padStart(this.s + 1, '0');
    const int = abs.slice(0, abs.length - this.s);
    const frac = this.s ? '.' + abs.slice(abs.length - this.s) : '';
    return `${neg ? '-' : ''}${int}${frac}`;
  }
}

function insertionSort<T>(k: T[], lo: number, hi: number, cmp: (a: T, b: T) => number): void {
  for (let i = lo; i < hi; i++) {
    const t = k[i + 1];
    let j = i;
    while (j >= lo && cmp(t, k[j]) < 0) { k[j + 1] = k[j]; j--; }
    k[j + 1] = t;
  }
}

function heapSort<T>(k: T[], lo: number, hi: number, cmp: (a: T, b: T) => number): void {
  const n = hi - lo + 1;
  const down = (i0: number, size: number) => {
    let i = i0;
    const d = k[lo + i - 1];
    while (i <= size >> 1) {
      let child = 2 * i;
      if (child < size && cmp(k[lo + child - 1], k[lo + child]) < 0) child++;
      if (!(cmp(d, k[lo + child - 1]) < 0)) break;
      k[lo + i - 1] = k[lo + child - 1];
      i = child;
    }
    k[lo + i - 1] = d;
  };
  for (let i = n >> 1; i >= 1; i--) down(i, n);
  for (let i = n; i > 1; i--) {
    [k[lo], k[lo + i - 1]] = [k[lo + i - 1], k[lo]];
    down(1, i - 1);
  }
}

function introSort<T>(k: T[], lo0: number, size0: number, depth0: number, cmp: (a: T, b: T) => number): void {
  const lo = lo0;
  let size = size0;
  let depth = depth0;
  const swapIfGreater = (i: number, j: number) => {
    if (i !== j && cmp(k[lo + i], k[lo + j]) > 0) [k[lo + i], k[lo + j]] = [k[lo + j], k[lo + i]];
  };
  while (size > 1) {
    if (size <= 16) {
      if (size === 2) { swapIfGreater(0, 1); return; }
      if (size === 3) { swapIfGreater(0, 1); swapIfGreater(0, 2); swapIfGreater(1, 2); return; }
      insertionSort(k, lo, lo + size - 1, cmp);
      return;
    }
    if (depth === 0) { heapSort(k, lo, lo + size - 1, cmp); return; }
    depth--;
    const hi = size - 1;
    const middle = hi >> 1;
    swapIfGreater(0, middle); swapIfGreater(0, hi); swapIfGreater(middle, hi);
    const pivot = k[lo + middle];
    [k[lo + middle], k[lo + hi - 1]] = [k[lo + hi - 1], k[lo + middle]];
    let left = 0;
    let right = hi - 1;
    while (left < right) {
      while (cmp(k[lo + ++left], pivot) < 0);
      while (cmp(pivot, k[lo + --right]) < 0);
      if (left >= right) break;
      [k[lo + left], k[lo + right]] = [k[lo + right], k[lo + left]];
    }
    if (left !== hi - 1) [k[lo + left], k[lo + hi - 1]] = [k[lo + hi - 1], k[lo + left]];
    introSort(k, lo + left + 1, size - left - 1, depth, cmp);
    size = left;
  }
}

/**
 * Sort like .NET `Array.Sort` (introsort): unstable, so ties order as PowerShell `Sort-Object` does.
 * @req FR:summaries/format.sort
 */
export function netSort<T>(items: T[], cmp: (a: T, b: T) => number): T[] {
  const k = items.slice();
  if (k.length < 2) return k;
  introSort(k, 0, k.length, 2 * (Math.floor(Math.log2(k.length)) + 1), cmp);
  return k;
}

const collator = new Intl.Collator('en-US', { sensitivity: 'accent' });
const cmpStr = (a: string, b: string): number => collator.compare(a, b);
const cmpScoreDesc = (a: { score: number }, b: { score: number }): number => (a.score < b.score ? 1 : a.score > b.score ? -1 : 0);
const eqi = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase();
const inCi = (v: string, list: string[]): boolean => list.some(x => eqi(x, v));
const WS = /^[^\S﻿]+|[^\S﻿]+$/g;
const trim = (s: string): string => s.replace(WS, '');
const trimEnd = (s: string): string => s.replace(/[^\S﻿]+$/, '');

/** Sort-Object Id -Unique */
function uniqueById<T extends { id: string }>(list: T[]): T[] {
  const sorted = netSort(list, (a, b) => cmpStr(a.id, b.id));
  return sorted.filter((t, i) => i === 0 || cmpStr(sorted[i - 1].id, t.id) !== 0);
}

// ------------------------------------------------------------------ time

const DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

interface Clock { y: number; mo: number; d: number; h: number; mi: number; s: number; ms: number; dow: number }

function clockIn(at: Date, timeZone: string): Clock {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(at);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  return {
    y: Number(get('year')), mo: Number(get('month')), d: Number(get('day')),
    h: Number(get('hour')), mi: Number(get('minute')), s: Number(get('second')),
    ms: ((at.getTime() % 1000) + 1000) % 1000, dow: DAYS_SHORT.indexOf(get('weekday')),
  };
}

const h12 = (h: number, m: number): string => `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
const hhmm = (t: string): { h: number; m: number } => ({ h: Number(t.slice(0, 2)), m: Number(t.slice(3, 5)) });
const daysIn = (y: number, mo: number): number => new Date(Date.UTC(y, mo, 0)).getUTCDate();

// ------------------------------------------------------------------ model

interface SProject {
  name: string;
  displayName: string;
  emoji: string | null;
  relativePath: string;
  content: string;
  scoring: ScoringProject;
  weeklyCapacity: number;
  capacity: Map<string, number>;
}

interface STask {
  id: string;
  text: string;
  level: number;
  parent: string | null;
  leaf: boolean;
  project: SProject;
  emojis: TaskEmojis;
  quotes: string[];
  lists: string[];
  score: number;
  breakdown: ScoreBreakdown;
  scored: ScoredTask;
}

class World {
  byId = new Map<string, STask>();
  children = new Map<string, STask[]>();
  constructor(readonly list: STask[]) {
    for (const t of list) this.byId.set(t.id, t);
    for (const t of list) if (t.parent) this.children.set(t.parent, [...(this.children.get(t.parent) ?? []), t]);
  }
  kids(id: string): STask[] { return this.children.get(id) ?? []; }
}

function parseCapacity(content: string, config: StackConfig): Map<string, number> {
  const valid = new Set(config.timeBlocks.map(b => b.name.toLowerCase()));
  const out = new Map<string, number>();
  for (const line of content.split('\n')) {
    const m = /^-\s+\*\*(.+?)\s+capacity:\*\*\s+(\d+(?:\.\d+)?)h\s*$/is.exec(line);
    if (m && valid.has(trim(m[1]).toLowerCase())) out.set(trim(m[1]).toLowerCase(), Number(m[2]));
  }
  return out;
}

function projectIdentity(fileName: string, content: string): { name: string; displayName: string; emoji: string | null } {
  const base = fileName.replace(/\.md$/i, '');
  const first = trim(content.split('\n')[0] ?? '');
  const h1 = /^# (.+)$/s.exec(first);
  if (h1) {
    const full = trim(h1[1]);
    const split = /^(.+?)\s+(.+)$/s.exec(full);
    if (split && split[1].length <= 4 && /[\u0080-\uFFFF]/.test(split[1])) {
      return { name: full, displayName: split[2], emoji: split[1] };
    }
    return { name: full, displayName: full, emoji: null };
  }
  const name = base.replace(/-/g, ' ');
  return { name, displayName: name, emoji: null };
}

interface RawTask { text: string; level: number; parentIndex: number; quotes: string[]; lists: string[] }

/** @req FR:summaries/generate.parse */
function scanTasks(content: string): RawTask[] {
  const tasks: RawTask[] = [];
  let inActive = false;
  let hierarchy: number[] = [];
  for (const line of content.split('\n')) {
    if (/^## 🔄 Active/i.test(line)) { inActive = true; continue; }
    if (/^## /.test(line) && inActive) break;
    if (!inActive) continue;
    const m = /^(\s*)- \[ \] (.+)$/s.exec(line);
    if (m) {
      const level = Math.floor(m[1].length / 2);
      if (level < hierarchy.length) hierarchy = level === 0 ? [] : hierarchy.slice(0, level);
      tasks.push({
        text: trim(m[2]), level, parentIndex: hierarchy.length ? hierarchy[hierarchy.length - 1] : -1, quotes: [], lists: [],
      });
      hierarchy.push(tasks.length - 1);
    } else if (tasks.length > 0) {
      const last = tasks[tasks.length - 1];
      if (/^\s*>/.test(line) && trim(line) !== '>') last.quotes.push(trim(line).replace(/^>\s*/, ''));
      else {
        const l = /^\s*-\s+(.+)/s.exec(line);
        if (l && !/- \[[ x]\]/i.test(line)) last.lists.push(l[1]);
      }
    }
  }
  return tasks;
}

/** @req FR:summaries/generate.load @req FR:summaries/generate.rank */
function load(input: SummaryInput): { projects: SProject[]; world: World; sorted: STask[]; scoring: ScoringProject[] } {
  const { config } = input;
  const order = new Map<string, number>();
  let idx = 1;
  for (const line of (input.previousProjects ?? '').split('\n')) {
    const m = /^## \[([^\]]+)\]/.exec(line);
    if (m) order.set(m[1], idx++);
  }

  const files = netSort(input.projects, (a, b) => (a.fileName < b.fileName ? -1 : a.fileName > b.fileName ? 1 : 0));
  const loaded = files.map(f => {
    const content = f.content.replace(/^﻿/, '');
    const id = projectIdentity(f.fileName, content);
    const base = toScoringProject(parseProject(content), f.fileName.replace(/\.md$/i, ''));
    const raw = scanTasks(content);
    const tasks: ScoringTask[] = raw.map((r, i) => ({
      id: `${id.name}_task_${i}`, parent: r.parentIndex >= 0 ? `${id.name}_task_${r.parentIndex}` : null,
      text: r.text, level: r.level, project: id.name,
    }));
    const scoring: ScoringProject = { ...base, name: id.name, tasks };
    const project: SProject = {
      ...id, relativePath: `tasks/${f.fileName}`, content, scoring,
      weeklyCapacity: base.weeklyCapacity, capacity: parseCapacity(content, config),
    };
    return { project, raw };
  });

  // Legacy sorts projects by calculated priority, then projects.md position (999 when absent), then file order.
  const calc = new Map(weighProjects(loaded.map(l => l.project.scoring), config).map(w => [w.name, w.calculatedPriority]));
  const ranked = netSort(
    loaded.map(l => ({ ...l, calc: calc.get(l.project.name) ?? 50 })),
    (a, b) => a.calc - b.calc || (order.get(a.project.name) ?? 999) - (order.get(b.project.name) ?? 999),
  );

  const scoring = ranked.map(r => r.project.scoring);
  const scoredAll = legacyEngine.score(scoring, config);
  const quoteMap = new Map<string, RawTask>();
  for (const r of ranked) r.raw.forEach((t, i) => quoteMap.set(`${r.project.name}_task_${i}`, t));
  const projectByName = new Map(ranked.map(r => [r.project.name, r.project]));

  const list: STask[] = scoredAll.map(s => {
    const raw = quoteMap.get(s.task.id)!;
    return {
      id: s.task.id, text: s.task.text, level: s.task.level, parent: s.task.parent, leaf: s.leaf,
      project: projectByName.get(s.task.project)!, emojis: extractEmojis(s.task.text, config),
      quotes: raw.quotes, lists: raw.lists, score: s.score, breakdown: s.breakdown, scored: s,
    };
  });
  const sorted = netSort(list, cmpScoreDesc);
  return { projects: ranked.map(r => r.project), world: new World(sorted), sorted, scoring };
}

// ------------------------------------------------------------------ task helpers (TaskHelpers.ps1)

/** `.Count` of a lone task hashtable in legacy is its key count (15 task keys plus Breakdown). */
const TASK_KEY_COUNT = 16;

const selfParked = (t: STask): boolean =>
  t.emojis.Special.some(s => s === '🅿️' || s === '💤' || s === '⏰') || t.emojis.Status.includes('⛔️');

/** Test-TaskParked: the task or any ancestor found in `pool`. */
function isParked(task: STask, pool: Map<string, STask>): boolean {
  if (selfParked(task)) return true;
  let cur = task;
  const seen = new Set<string>();
  while (cur.parent && !seen.has(cur.id)) {
    seen.add(cur.id);
    const p = pool.get(cur.parent);
    if (!p) break;
    if (selfParked(p)) return true;
    cur = p;
  }
  return false;
}

function outcomeParent(task: STask, w: World): STask | null {
  let outcome: STask | null = null;
  let root: STask | null = null;
  let cur = task;
  const seen = new Set<string>();
  while (cur.parent && !seen.has(cur.id)) {
    seen.add(cur.id);
    const p = w.byId.get(cur.parent);
    if (!p) break;
    if (p.emojis.Special.includes('🎯')) outcome = p;
    root = p;
    cur = p;
  }
  return outcome ?? root;
}

function displayText(task: STask, w: World): string {
  const parent = outcomeParent(task, w);
  if (parent) return `${trim(parent.text.replace(/🎯\s*/gi, ''))} (next: ${trim(task.text)})`;
  return task.text;
}

/** Get-FirstActionableTask; every task counts as incomplete in legacy. */
function firstActionable(parent: STask, w: World): STask | null {
  const pool = w.byId;
  const hasParallel = (t: STask) => t.emojis.Special.includes('🔀');
  const find = (pid: string): STask | null => {
    const children = netSort(w.kids(pid), (a, b) => cmpStr(a.id, b.id));
    if (children.length === 0) return null;
    let i = 0;
    while (i < children.length) {
      const child = children[i];
      if (w.kids(child.id).length > 0) {
        const r = find(child.id);
        if (r) return r;
        return null;
      }
      if (isParked(child, pool)) { i++; continue; }
      if (hasParallel(child)) {
        const group = [child];
        let j = i + 1;
        while (j < children.length) {
          const next = children[j];
          if (w.kids(next.id).length === 0 && hasParallel(next) && !isParked(next, pool)) { group.push(next); j++; } else break;
        }
        return netSort(group, cmpScoreDesc)[0];
      }
      return child;
    }
    return null;
  };
  if (w.kids(parent.id).length === 0) return isParked(parent, pool) ? null : parent;
  return find(parent.id);
}

function uniqueOutcomeTasks(tasks: STask[], w: World): STask[] {
  const seen = new Set<string>();
  const out: STask[] = [];
  for (const task of tasks) {
    const parent = outcomeParent(task, w);
    const key = (parent?.id ?? task.id).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    if (parent) out.push(firstActionable(parent, w) ?? task);
    else out.push(task);
  }
  return out;
}

function incompleteSubtasks(root: STask, w: World): STask[] {
  const out: STask[] = [];
  for (const c of w.list.filter(t => t.parent === root.id)) {
    if (c.leaf) out.push(c); else out.push(...incompleteSubtasks(c, w));
  }
  return out;
}

function hierarchy(task: STask, w: World, opts: { removeStatus?: boolean; includeScore?: boolean }): string {
  const chain: STask[] = [];
  let cur: STask | undefined = task;
  const seen = new Set<string>();
  while (cur && !seen.has(cur.id)) {
    chain.unshift(cur);
    seen.add(cur.id);
    cur = cur.parent ? w.byId.get(cur.parent) : undefined;
  }
  const p = task.project;
  let result = `- ${p.emoji ? p.emoji + ' ' : ''}[${p.displayName}](./${p.relativePath})\n`;
  chain.forEach((item, i) => {
    const indent = '  '.repeat(i + 1);
    let text = item.text;
    if (opts.removeStatus) text = text.replace(/📅\s*/gi, '').replace(/🚧\s*/gi, '');
    if (item.leaf && (opts.includeScore || !opts.removeStatus)) text += ` 🟰 ${formatNumber(item.score)}`;
    result += `${indent}- ${text}\n`;
    if (item.leaf) {
      for (const q of item.quotes) result += `${indent}  > ${q}\n`;
      for (const l of item.lists) result += `${indent}  - ${l}\n`;
    }
  });
  return trimEnd(result);
}

const CATEGORY_ORDER = ['Priority', 'Status', 'Effort', 'Impact', 'Value', 'TimeBlocks', 'Special'];

function breakdownLines(b: ScoreBreakdown, actual: number, indent: string): string[] {
  const parts: string[] = [];
  for (const cat of CATEGORY_ORDER) {
    for (const c of b.emojiContributions.filter(x => x.category === cat)) {
      if (c.value !== 0) parts.push(`${c.emoji} ${formatNumber(c.value)}`);
    }
  }
  const emojiTotal = b.emojiContributions.reduce((s, c) => s + c.value, 0);
  const bonus = Dec.fromDouble(b.projectBonus);
  const place = Dec.fromDouble(b.placementBonus);
  const effort = Dec.fromDouble(b.effortHours);
  const base = Dec.fromDouble(emojiTotal).add(bonus).add(place);
  const total = base.div(effort);
  if (b.projectBonus !== 0) parts.push(`🗂️ ${bonus}`);
  if (b.placementBonus !== 0) parts.push(`🔢 ${place}`);
  const formula = parts.join(' + ');
  const lines = [
    effort.toString() !== '1' && effort.toString() !== '0'
      ? `${indent}  - 🧮 ${total} = (${formula}) / ⏱️${effort}h`
      : `${indent}  - 🧮 ${total} = ${formula}`,
  ];
  if (Math.abs(Number(total.toString()) - actual) > 0.01) lines.push(`${indent}  - ⚠️ Expanded scoring algorithm does not match the evaluated score!`);
  return lines;
}

const effortOf = (t: { emojis: TaskEmojis }, hours: Record<string, number>): number => {
  const e = t.emojis.Effort[0];
  return e !== undefined && Object.prototype.hasOwnProperty.call(hours, e) ? hours[e] : 1;
};

// ------------------------------------------------------------------ stack.md

/** @req FR:summaries/stack.header @req FR:summaries/stack.tasks @req FR:summaries/stack.breakdown */
function buildStack(w: World, projects: SProject[], config: StackConfig): string {
  const hours = config.taskScoring.effortHours;
  const leaves = w.list.filter(t => t.leaf);
  const leafPool = new Map(leaves.map(t => [t.id, t]));
  const active = leaves.filter(t => !isParked(t, leafPool));
  const total = active.reduce((s, t) => s + effortOf(t, hours), 0);
  const days = Math.ceil(total / 9);
  const missing = active.filter(t => t.emojis.Effort.length === 0).length;
  const roots = w.list.filter(t => t.level === 0 && !isParked(t, w.byId)).length;

  let content = `# 💼 My full stack\n\n- 🗂️ ${projects.length} active projects\n- 📑 ${roots} root-level tasks\n- 📄 ${active.length === 1 ? TASK_KEY_COUNT : active.length} leaf node tasks\n- ⏱️ ${formatNumber(Math.ceil(total))} hours (${formatNumber(days)} days)\n- ⚠️ ${missing} tasks missing effort\n\n---\n`;
  for (const task of active) {
    content += `\n${hierarchy(task, w, { includeScore: true })}`;
    let depth = 0;
    let cur = task.parent;
    while (cur && w.byId.has(cur)) { depth++; cur = w.byId.get(cur)!.parent; }
    for (const l of breakdownLines(task.breakdown, task.score, '  '.repeat(depth + 1))) content += `\n${l}`;
    if (task.emojis.Effort.length === 0) content += '\n    - ⚠️ Missing effort estimation';
    content += '\n';
  }
  return trimEnd(content.replace(/\n\n\n+/g, '\n\n'));
}

// ------------------------------------------------------------------ projects.md

/** @req FR:summaries/projects.kpi @req FR:summaries/projects.sections */
function buildProjects(w: World, projects: SProject[], config: StackConfig): string {
  const hours = config.taskScoring.effortHours;
  const hasKids = (t: STask) => w.kids(t.id).length > 0;
  const candidates = w.list.filter(t => t.leaf || (t.level === 0 && hasKids(t)));
  const unique = new Map<string, STask>();
  for (const t of candidates) if (!unique.has(t.id.toLowerCase())) unique.set(t.id.toLowerCase(), t);

  const rootOf = (t: STask): string => {
    let cur = t;
    const seen = new Set<string>();
    while (cur.parent && !seen.has(cur.id)) {
      seen.add(cur.id);
      const p = w.byId.get(cur.parent);
      if (!p) break;
      cur = p;
    }
    return cur.id;
  };
  const groups = new Map<string, STask[]>();
  for (const t of unique.values()) {
    const r = rootOf(t);
    groups.set(r, [...(groups.get(r) ?? []), t]);
  }
  const reps: STask[] = [];
  for (const [rootId, group] of groups) {
    const rootTask = group.find(t => t.id === rootId) ?? netSort(group, cmpScoreDesc)[0];
    const best = Math.max(...group.map(t => t.score));
    reps.push({ ...rootTask, score: best });
  }
  const repPool = new Map(reps.map(t => [t.id, t]));
  const active = reps.filter(t => !isParked(t, repPool) && t.text.trim() !== '' && t.project.name.trim() !== '');

  const counts: Record<string, number> = { '‼️': 0, '🔺': 0, '🚧': 0, '⏸️': 0, '⏳': 0, '⛔️': 0 };
  for (const t of active) for (const e of [...t.emojis.Priority, ...t.emojis.Status]) if (e in counts) counts[e]++;

  const hoursOf = (list: STask[]) => list.reduce((s, t) => s + effortOf(t, hours), 0);
  const over: string[] = [];
  let totalOver = 0;
  for (const p of projects) {
    const diff = hoursOf(active.filter(t => eqi(t.project.name, p.name))) - p.weeklyCapacity;
    if (diff > 0) { over.push(p.name); totalOver += diff; }
  }

  const kpi = [`- 🗂️ ${projects.length} projects`];
  if (over.length > 0) kpi.push(`- 🚨 ${over.length} projects over capacity (${formatNumber(roundHalfEven(totalOver, 1))}h total)`);
  kpi.push(`- 📑 ${active.length} total tasks`);
  const labels: [string, string][] = [['‼️', 'critical'], ['🔺', 'high priority'], ['🚧', 'in progress'], ['⏸️', 'paused'], ['⏳', 'waiting'], ['⛔️', 'blocked']];
  for (const [e, name] of labels) if (counts[e] > 0) kpi.push(`- ${e} ${counts[e]} ${name}`);

  let content = `# 📂 Project summary\n\n${kpi.join('\n')}\n\n---\n`;
  for (const p of projects) {
    const mine = active.filter(t => t.project.name === p.name);
    content += `\n## [${p.name}](./${p.relativePath}) — ${mine.length} active tasks\n`;
    const diff = hoursOf(mine) - p.weeklyCapacity;
    if (diff > 0) {
      content += `\n🚨 Project is over capacity by ${formatNumber(Math.abs(diff))} ${Math.abs(diff) === 1 ? 'hour' : 'hours'}\n`;
    } else if (diff < -4) {
      content += `\nℹ️ Project is under capacity by ${formatNumber(Math.abs(diff))} ${Math.abs(diff) === 1 ? 'hour' : 'hours'}\n`;
    }
    if (mine.length > 0) {
      content += '\n';
      const top = netSort(mine, cmpScoreDesc).slice(0, 5);
      top.forEach((task, i) => {
        let text = displayText(task, w);
        if (!text || text.trim() === '') text = task.text.trim() !== '' ? task.text : `Task ${task.id}`;
        let sub = '';
        if (task.level === 0 && !task.leaf) {
          const all = incompleteSubtasks(task, w);
          const blocked = all.filter(t => t.emojis.Status.includes('⛔️'));
          const parts: string[] = [];
          if (all.length > 0) {
            parts.push(`${all.length} subtasks`);
            if (blocked.length > 0) parts.push(`${blocked.length === 1 ? TASK_KEY_COUNT : blocked.length} blocked`);
          }
          const next = firstActionable(task, w);
          if (next) parts.push(`next: ${trim(next.text)}`);
          sub = parts.length > 0 ? ` (${parts.join(', ')})` : '';
        }
        content += `${i + 1}. ${text}${sub} 🟰 ${formatNumber(task.score)}\n`;
      });
    }
    content += '\n<br>\n';
  }
  return trimEnd(content.replace(/\n\n\n+/g, '\n\n'));
}

// ------------------------------------------------------------------ README.md

function countReadyAi(contents: string[]): number {
  let count = 0;
  for (const content of contents) {
    let inActive = false;
    let stack: number[] = [];
    for (const line of content.split('\n')) {
      if (/^## 🔄 Active/i.test(line)) { inActive = true; continue; }
      if (/^## /.test(line) && inActive) break;
      if (!inActive) continue;
      const m = /^(\s*)- \[ \] (.+)$/s.exec(line);
      if (!m) continue;
      const indent = m[1].length;
      const text = m[2].toLowerCase();
      while (stack.length > 0 && stack[stack.length - 1] >= indent) stack = stack.slice(0, -1);
      const has = text.includes('🪄');
      const excluded = text.includes('⛔') || text.includes('🅿️') || text.includes('💤');
      if (has && !excluded) {
        if (stack.length === 0) count++;
        stack.push(indent);
      } else if (has) stack.push(indent);
    }
  }
  return count;
}

function countCheckpoints(contents: string[]): number {
  let count = 0;
  for (const content of contents) {
    let inActive = false;
    const state = new Map<number, boolean>();
    let last = -1;
    for (const line of content.split('\n')) {
      if (/^## 🔄 Active/i.test(line)) { inActive = true; continue; }
      if (/^## /.test(line) && inActive) break;
      if (!inActive) continue;
      const m = /^(\s*)- \[([ x])\] (.+)$/is.exec(line);
      if (!m) continue;
      const indent = m[1].length;
      const complete = m[2].toLowerCase() === 'x';
      const text = m[3].toLowerCase();
      if (indent < last) for (const k of [...state.keys()]) if (k > indent) state.delete(k);
      if (indent > last) state.set(indent, false);
      if (!state.has(indent)) state.set(indent, false);
      const excluded = text.includes('⛔') || text.includes('🅿️') || text.includes('💤');
      if (text.includes('🙋') && !complete && !excluded && !state.get(indent)) count++;
      if (!complete) state.set(indent, true);
      last = indent;
    }
  }
  return count;
}

function extractFooter(existing: string): string {
  const m = /^.*---\s*(.*)$/s.exec(existing);
  if (!m) return '';
  let f = trim(m[1]);
  f = f.replace(/<br>\s*/gi, '');
  f = f.replace(/\n\s*\n\s*\n+/g, '\n\n').replace(/^\s+/, '').replace(/\s+$/, '');
  return trim(f);
}

/** @req FR:summaries/readme.banner @req FR:summaries/readme.top @req FR:summaries/readme.other @req FR:summaries/readme.parking @req FR:summaries/readme.footer */
function buildReadme(
  w: World, input: SummaryInput, projects: SProject[], scoring: ScoringProject[],
): string {
  const { config } = input;
  const clock = clockIn(input.now, config.timezone);
  const footer = extractFooter(input.previousReadme ?? '');

  const leaves = w.list.filter(t => t.leaf);
  const activeTasks = leaves.filter(t => !isParked(t, w.byId));
  const filtered = activeTasks.length > 0
    ? legacyEngine.filter(activeTasks.map(t => t.scored), scoring, config, input.now).map(s => w.byId.get(s.task.id)!)
    : [];

  const parkedAtLevel = w.list.filter(t => t.emojis.Special.includes('🅿️') || t.emojis.Special.includes('💤'));
  const unique = uniqueOutcomeTasks(filtered, w);
  const top = unique[0];
  const topHierarchy = top ? hierarchy(top, w, { removeStatus: true, includeScore: true }) : 'No active tasks available';
  const upNext = unique.slice(1, 4);

  const topChain: STask[] = [];
  for (let cur: STask | undefined = top; cur;) {
    topChain.push(cur);
    cur = cur.parent ? w.byId.get(cur.parent) : undefined;
  }
  const displayed = uniqueById([...topChain, ...upNext]);
  const other = otherPriorities(displayed, projects, w);

  const active = activeTimeBlocks(config, input.now);
  const banner = [`- 🕒 **${DAYS_LONG[clock.dow]} ${h12(clock.h, clock.mi)}**`];
  for (const name of active) banner.push(`- 📆 **${name}** time`);
  const urgent = filtered.length > 0 && activeTasks.length > 0 ? activeTasks.filter(t => t.emojis.Priority.includes('🚨')).length : 0;
  if (urgent > 0 && active.length > 0) banner.push(urgent === 1 ? '- 🚨 **1 urgent** task' : `- 🚨 **${urgent} urgent** tasks`);
  const contents = projects.map(p => p.content);
  const ai = countReadyAi(contents);
  if (ai > 0) banner.push(ai === 1 ? '- 🪄 **1 AI task** ready' : `- 🪄 **${ai} AI tasks** ready`);
  const checkpoints = countCheckpoints(contents);
  if (checkpoints > 0) banner.push(checkpoints === 1 ? '- 🙋 **1 checkpoint** waiting' : `- 🙋 **${checkpoints} checkpoints** waiting`);
  const statusBanner = banner.join('\n') + '\n\n';

  const line = (t: STask) => `- ${displayText(t, w)} 🟰 ${formatNumber(t.score)}`;
  const otherContent = other.length === 0 ? '🎯 All current priorities are captured above!' : other.map(line).join('\n');
  const otherSection = `\n## 🗂️ Other priorities\n\n${otherContent}\n\n[See all project details ➔](projects.md)\n\n<br>`;
  const parking = parkedAtLevel.length === 0
    ? '🎉 Congrats! There are no tasks on hold!'
    : parkedAtLevel.map(t => `- ${t.text.replace(/🅿️\s*/gi, '')} 🟰 ${formatNumber(t.score)}`).join('\n');
  const scheduling = w.list.filter(t => t.level === 0 && !selfParked(t)).length;

  let content = `# 🧠 My stack\n\n${statusBanner}\n\n## 🎯 Top of the stack\n\n${topHierarchy}\n\n[See today's plan ➔](my-day.md)\n\n<br>\n\n## ⏭️ Up next\n\n${upNext.map(line).join('\n')}\n\n[See full stack ➔](stack.md)\n\n<br>\n${otherSection}\n\n## 🅿️ Parking lot\n\n${parking}\n\n<br>\n\n## 📊 More views\n\n[${scheduling} tasks need to be scheduled ➔](scheduling.md)\n\n<br>\n\n---\n\n<br>\n\n${footer}`;
  content = trimEnd(content.replace(/\n\n\n+/g, '\n\n'));
  return content + '\n\n<br>';
}

/** Get-EnhancedOtherPriorities (the daytime-only half never fires in legacy). */
function otherPriorities(displayed: STask[], projects: SProject[], w: World): STask[] {
  const represented = displayed.map(t => t.project.name);
  const result: STask[] = [];
  for (const p of projects) {
    if (inCi(p.name, represented)) continue;
    const mine = w.list.filter(t => eqi(t.project.name, p.name) && !isParked(t, w.byId));
    const best = netSort(mine, cmpScoreDesc)[0];
    if (!best) continue;
    const parent = outcomeParent(best, w);
    result.push(parent ? firstActionable(parent, w) ?? best : best);
  }
  return netSort(uniqueById(result), cmpScoreDesc);
}

// ------------------------------------------------------------------ my-day.md

const MY_DAY_EFFORT: Record<string, number> = { '🔹': 0.1, '🟢': 0.5, '🟡': 1, '🟠': 2, '🔴': 4, '⚫': 8 };

/** The ⏰ start-date test of legacy my-day: true when the task starts in the future (or the date is invalid). */
function startsLater(text: string, clock: Clock): boolean {
  const m = /⏰\s+([A-Z][a-z]{2})\s+(\d{1,2}):/i.exec(text);
  if (!m) return false;
  const month = MONTHS.indexOf(m[1].toLowerCase()) + 1;
  const day = Number(m[2]);
  if (month === 0 || day < 1 || day > 31) return true; // Get-Date -Day is range checked, ParseExact rejects the month
  // Get-Date -Month clamps the day to the month, then -Day adds the difference (so Feb 30 rolls into March).
  const clamped = Math.min(clock.d, daysIn(clock.y, month));
  const start = Date.UTC(clock.y, month - 1, clamped) + (day - clamped) * 86400000;
  const today = Date.UTC(clock.y, clock.mo - 1, clock.d);
  const plus6 = (() => {
    const mi = clock.mo - 1 + 6;
    const y = clock.y + Math.floor(mi / 12);
    const mo = ((mi % 12) + 12) % 12;
    return Date.UTC(y, mo, Math.min(clock.d, daysIn(y, mo + 1)));
  })();
  let s = start;
  if (start > plus6) {
    const d = new Date(start);
    const y = d.getUTCFullYear() - 1;
    const mo = d.getUTCMonth();
    s = Date.UTC(y, mo, Math.min(d.getUTCDate(), daysIn(y, mo + 1)));
  }
  return s > today;
}

/** @req FR:summaries/myday.capacity @req FR:summaries/myday.top @req FR:summaries/myday.finished */
function buildMyDay(w: World, projects: SProject[], config: StackConfig, now: Date): string {
  const clock = clockIn(now, config.timezone);
  const active = activeTimeBlocks(config, now);
  const dayShort = DAYS_SHORT[clock.dow];
  const label = (b: { name: string; label?: string }) => (b.label && trim(b.label) ? trim(b.label) : b.name);
  const startMins = (t: string) => { const x = hhmm(t); return x.h * 60 + x.m; };
  const today = netSort(
    config.timeBlocks.filter(b => b.days.some(d => eqi(d, dayShort)) && b.name.toLowerCase() !== 'sleep'),
    (a, b) => startMins(a.startTime) - startMins(b.startTime),
  );
  const dayLong = DAYS_LONG[clock.dow];
  const time = h12(clock.h, clock.mi);
  if (config.timeBlocks.length === 0) return `\n- \n- 📊 **0** / 0 hours\n\n---\n\nNo time blocks configured`;
  if (today.length === 0) return `\n- \n- 📊 **0** / 0 hours\n\n---\n\nNo time blocks for today (${dayShort})`;

  interface Group { tasks: STask[]; capacities: Map<string, number>; used: Map<string, number> }
  const groups = new Map<string, Group>();
  let totalUsed = 0;
  const selected = new Set<string>();

  for (const tb of today) {
    const isActive = inCi(tb.name, active);
    const eligible: STask[] = [];
    const caps = new Map<string, number>();
    for (const p of projects) {
      const cap = p.capacity.get(tb.name.toLowerCase());
      if (cap === undefined || !(cap > 0)) continue;
      caps.set(p.name, cap);
      const ok = (t: STask): boolean => {
        if (!eqi(t.project.name, p.name)) return false;
        if (!t.leaf) return false;
        if (selected.has(t.id)) return false;
        if (t.emojis.Status.includes('💤') || t.emojis.Status.includes('⛔️') || t.emojis.Status.includes('🅿️')) return false;
        if (t.emojis.Special.includes('🅿️') || t.emojis.Special.includes('💤')) return false;
        if (t.emojis.Special.includes('⏰') && startsLater(t.text, clock)) return false;
        let cur = t;
        const seen = new Set<string>();
        while (cur.parent && !seen.has(cur.id)) {
          seen.add(cur.id);
          const parent = w.byId.get(cur.parent);
          if (!parent) break;
          if (parent.emojis.Special.includes('💤') || parent.emojis.Special.includes('🅿️')) return false;
          if (parent.emojis.Status.includes('💤') || parent.emojis.Status.includes('⛔️') || parent.emojis.Status.includes('🅿️')) return false;
          cur = parent;
        }
        return true;
      };
      eligible.push(...w.list.filter(ok));
    }
    const sortedLeaves = netSort(eligible, cmpScoreDesc);
    const chosen: STask[] = [];
    const totalCap = [...caps.values()].reduce((s, v) => s + v, 0);
    let usedTotal = 0;
    const used = new Map<string, number>([...caps.keys()].map(k => [k, 0]));
    for (const t of sortedLeaves) {
      const e = t.emojis.Effort[0];
      const effort = e !== undefined && Object.prototype.hasOwnProperty.call(MY_DAY_EFFORT, e) ? MY_DAY_EFFORT[e] : 1;
      const limit = caps.get(t.project.name) ?? 0;
      const cur = used.get(t.project.name) ?? 0;
      if (usedTotal + effort <= totalCap && cur + effort <= limit) {
        chosen.push(t);
        usedTotal += effort;
        selected.add(t.id);
        if (used.has(t.project.name)) used.set(t.project.name, cur + effort);
        if (isActive) totalUsed += effort;
      }
    }
    groups.set(tb.name, { tasks: chosen, capacities: caps, used });
  }

  let totalDaily = 0;
  let activeLabel = '';
  let activeEmoji = '';
  for (const tb of today) {
    for (const p of projects) {
      const cap = p.capacity.get(tb.name.toLowerCase());
      if (cap !== undefined && cap > 0) totalDaily += cap;
    }
    if (inCi(tb.name, active)) { activeLabel = label(tb); activeEmoji = tb.emoji || ''; }
  }

  const activeBlockTasks: STask[] = [];
  for (const [name, g] of groups) if (inCi(name, active)) activeBlockTasks.push(...g.tasks);
  const topTask = netSort(activeBlockTasks, cmpScoreDesc)[0];
  const topHierarchy = topTask ? hierarchy(topTask, w, { includeScore: true }) : 'No active tasks available';
  if (topTask) for (const g of groups.values()) g.tasks = g.tasks.filter(t => t.id !== topTask.id);

  let md = '# 📆 My day\n\n';
  md += `- 🕒 **${dayLong} ${time}**\n`;
  if (activeEmoji && activeLabel) md += `- ${activeEmoji} **${activeLabel}** time\n`;
  md += `- 📊 **${formatNumber(totalUsed)}** / ${formatNumber(totalDaily)} hours\n\n---\n\n## 🎯 Top of the stack\n\n${topHierarchy}\n\n---\n\n`;

  const done = new Set<string>();
  const nowMs = ((clock.h * 60 + clock.mi) * 60 + clock.s) * 1000 + clock.ms;
  for (const tb of today) {
    const lab = label(tb);
    if (done.has(lab.toLowerCase())) continue;
    done.add(lab.toLowerCase());
    const same = today.filter(b => eqi(label(b), lab));
    const first = same[0];
    let start = first.startTime;
    let end = first.endTime;
    if (same.length > 1) {
      start = same.map(b => b.startTime).reduce((a, b) => (startMins(a) <= startMins(b) ? a : b));
      end = same.map(b => b.endTime).reduce((a, b) => (startMins(a) >= startMins(b) ? a : b));
    }
    const s = hhmm(start);
    const e = hhmm(end);
    let isFinished = true;
    for (const b of same) {
      if (inCi(b.name, active)) { isFinished = false; break; }
      const be = hhmm(b.endTime);
      const bs = hhmm(b.startTime);
      let endMs = ((be.h * 60 + be.m) * 60) * 1000 + clock.ms;
      if (be.h < bs.h) endMs += 86400000;
      if (nowMs < endMs) isFinished = false;
    }

    md += `## ${first.emoji || ''} ${lab} time\n\n`;
    const all: STask[] = [];
    const capTotals = new Map<string, number>();
    const usedTotals = new Map<string, number>();
    for (const b of same) {
      const g = groups.get(b.name);
      if (!g) continue;
      all.push(...g.tasks);
      for (const [pn, cap] of g.capacities) {
        capTotals.set(pn, (capTotals.get(pn) ?? 0) + cap);
        usedTotals.set(pn, (usedTotals.get(pn) ?? 0) + (g.used.get(pn) ?? 0));
      }
    }
    md += `> - 🕒 **${h12(s.h, s.m)}** - **${h12(e.h, e.m)}**\n`;
    for (const pn of netSort([...capTotals.keys()], cmpStr)) {
      md += `> - 🗂️ **${pn}** = ${formatNumber(usedTotals.get(pn)!)} / ${formatNumber(capTotals.get(pn)!)} hours\n`;
    }
    md += '\n';
    let unique = netSort(uniqueById(all), cmpScoreDesc);
    // A lone task is a hashtable in legacy: .Count is its key count and [i] finds nothing, so blank lines print.
    const lone = unique.length === 1;
    if (isFinished && unique.length > 1) unique = [unique[0]];
    if (unique.length > 0) {
      const n = lone ? (isFinished ? 1 : TASK_KEY_COUNT) : unique.length;
      for (let i = 0; i < n; i++) {
        md += `${lone ? '' : hierarchy(unique[i], w, { includeScore: true })}\n`;
        if (i < n - 1) md += '\n';
      }
    } else md += 'None\n';
    md += '\n';
  }
  return trimEnd(md);
}

// ------------------------------------------------------------------ entry

/**
 * @req FR:summaries/generate.@function @req FR:summaries/generate.input @req FR:summaries/generate.output @req FR:summaries/generate.pure
 * @req FR:summaries/parity.fixture @req FR:summaries/parity.env @req FR:summaries/parity.quirks
 */
export function generateSummaries(input: SummaryInput): SummaryFiles {
  const { projects, world, scoring } = load(input);
  const BOM = '﻿';
  return {
    readme: `${BOM}${buildReadme(world, input, projects, scoring)}\n`,
    stack: `${BOM}${buildStack(world, projects, input.config)}\n`,
    projects: `${BOM}${buildProjects(world, projects, input.config)}\n`,
    myDay: world.list.length === 0 ? null : `${buildMyDay(world, projects, input.config, input.now)}\n`,
  };
}
