import type { StackConfig } from './config';
import type { Project, Task as ParsedTask } from './parser';

export class ScoringError extends Error {}

/** @req FR:scoring-engine/$task-emojis */
export interface TaskEmojis {
  Priority: string[];
  Status: string[];
  Effort: string[];
  Impact: string[];
  Value: string[];
  Special: string[];
  TimeBlocks: string[];
}

/** @req FR:scoring-engine/$scoring-task */
export interface ScoringTask {
  id: string;
  parent: string | null;
  text: string;
  level: number;
  project: string;
  complete?: boolean;
}

/** @req FR:scoring-engine/$scoring-project */
export interface ScoringProject {
  name: string;
  value: string[];
  weeklyCapacity: number;
  explicitPriority?: number;
  /** Time block name -> hours, from `- **<Block> capacity:** <n>h` lines. */
  capacity: Record<string, number>;
  tasks: ScoringTask[];
}

export interface EmojiContribution { category: string; emoji: string; value: number }

export interface ScoreBreakdown {
  emojiContributions: EmojiContribution[];
  projectBonus: number;
  placementBonus: number;
  baseScore: number;
  effortHours: number;
  calculatedTotal: number;
  /** Set by the stack engine when a blocker took a blocked task's score: that task's id. */
  inheritedFrom?: string;
}

/** @req FR:scoring-engine/$scored-task */
export interface ScoredTask {
  task: ScoringTask;
  leaf: boolean;
  parked: boolean;
  score: number;
  breakdown: ScoreBreakdown;
}

export interface ProjectWeight { name: string; valueScore: number; calculatedPriority: number; weight: number }

/** @req FR:scoring-engine/engine.interface */
export interface ScoringEngine {
  readonly id: string;
  score(projects: ScoringProject[], config: StackConfig): ScoredTask[];
  filter(tasks: ScoredTask[], projects: ScoringProject[], config: StackConfig, at: Date): ScoredTask[];
  /** Optional: replaces candidate selection and filtering in `rankTasks` (sees every scored task, parked ones too). */
  rank?(scored: ScoredTask[], projects: ScoringProject[], config: StackConfig, at?: Date): ScoredTask[];
}

// ---------------------------------------------------------------- emojis

const PRIORITY = ['🔝', '🚨', '‼️', '🔺', '🔻'];
const STATUS = ['🚧', '⏸️', '👀', '⏳', '⛔️'];
const EFFORT = ['🔹', '🟢', '🟡', '🟠', '🔴', '⚫️'];
const IMPACT = ['⬆️', '↔️', '⬇️'];
const VALUE = ['💰', '⚠️', '😊', '⏱️', '🌱', '🏃', '🌟'];
const SPECIAL = ['🅿️', '💤', '⏰', '📅', '🎯', '🔀'];

const present = (text: string, list: string[]): string[] => {
  const t = text.toLowerCase();
  return list.filter(e => t.includes(e.toLowerCase()));
};

function baseEmojis(text: string): Omit<TaskEmojis, 'TimeBlocks'> {
  return {
    Priority: present(text, PRIORITY),
    Status: present(text, STATUS),
    Effort: present(text, EFFORT),
    Impact: present(text, IMPACT),
    Value: VALUE.flatMap(e => Array<string>(text.split(e).length - 1).fill(e)),
    Special: present(text, SPECIAL),
  };
}

/**
 * @req FR:scoring-engine/emojis.@function @req FR:scoring-engine/emojis.input @req FR:scoring-engine/emojis.output
 * @req FR:scoring-engine/emojis.categories @req FR:scoring-engine/emojis.value-repeat @req FR:scoring-engine/emojis.timeblocks
 */
export function extractEmojis(text: string, config: StackConfig): TaskEmojis {
  return { ...baseEmojis(text), TimeBlocks: present(text, config.timeBlocks.map(b => b.emoji).filter(Boolean)) };
}

// ---------------------------------------------------------------- weights

type Weights = Record<'Priority' | 'Status' | 'Impact' | 'Value' | 'Special' | 'TimeBlocks', Record<string, number>>;

const own = (o: Record<string, number>, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k);

/** @req FR:scoring-engine/score.timeblock-weight @req FR:scoring-engine/score.aggregate.effort */
function effectiveWeights(config: StackConfig): Weights {
  const w = config.taskScoring.emojiWeights;
  const pick = (k: string) => ({ ...(w[k] ?? {}) });
  const tb: Record<string, number> = {};
  for (const b of config.timeBlocks) if (b.emoji) tb[b.emoji] = 8;
  tb['☀️'] = 8;
  const custom = w.timeBlocks ?? {};
  if (custom.default) for (const k of Object.keys(tb)) tb[k] = custom.default;
  for (const [k, v] of Object.entries(custom)) if (k !== 'default') tb[k] = v;
  // `effort` weights are intentionally absent: effort only drives the divisor.
  return { Priority: pick('priority'), Status: pick('status'), Impact: pick('impact'), Value: pick('value'), Special: pick('special'), TimeBlocks: tb };
}

// ---------------------------------------------------------------- projects

/** @req FR:scoring-engine/score.project-value @req FR:scoring-engine/score.project-weight */
export function weighProjects(projects: ScoringProject[], config: StackConfig): ProjectWeight[] {
  const value = effectiveWeights(config).Value;
  const ranked = projects.map((p, i) => {
    const valueScore = p.value.reduce((s, e) => s + (own(value, e) ? value[e] : 3), 0);
    const calculatedPriority = valueScore > 0 ? 100 - valueScore
      : p.explicitPriority !== undefined ? p.explicitPriority
      : p.weeklyCapacity > 0 ? 100 - p.weeklyCapacity
      : 50;
    return { name: p.name, valueScore, calculatedPriority, i };
  }).sort((a, b) => a.calculatedPriority - b.calculatedPriority || a.i - b.i);
  return ranked.map((r, rank) => ({
    name: r.name, valueScore: r.valueScore, calculatedPriority: r.calculatedPriority, weight: ranked.length - 1 - rank,
  }));
}

// ---------------------------------------------------------------- scoring

const SINGLE = ['Status', 'Effort', 'Impact'] as const;
const MULTI = ['Priority', 'TimeBlocks', 'Special'] as const;

interface Ctx {
  config: StackConfig;
  weights: Weights;
  byId: Map<string, ScoringTask>;
  children: Map<string, ScoringTask[]>;
  emojis: Map<string, TaskEmojis>;
}

function ancestors(t: ScoringTask, ctx: Ctx): ScoringTask[] {
  const out: ScoringTask[] = [];
  const seen = new Set<string>([t.id]);
  let cur = t.parent ? ctx.byId.get(t.parent) : undefined;
  while (cur && !seen.has(cur.id)) {
    out.push(cur);
    seen.add(cur.id);
    cur = cur.parent ? ctx.byId.get(cur.parent) : undefined;
  }
  return out;
}

/** @req FR:scoring-engine/score.aggregate @req FR:scoring-engine/score.aggregate.single @req FR:scoring-engine/score.aggregate.multi @req FR:scoring-engine/score.aggregate.value */
function emojiScore(t: ScoringTask, ctx: Ctx): { score: number; contributions: EmojiContribution[] } {
  const chain = [t, ...ancestors(t, ctx)].map(x => ctx.emojis.get(x.id)!);
  const agg = (c: keyof TaskEmojis) => chain.flatMap(e => e[c]);
  const contributions: EmojiContribution[] = [];
  let score = 0;
  const weightsOf = (c: string): Record<string, number> => (ctx.weights as Record<string, Record<string, number>>)[c] ?? {};
  for (const cat of SINGLE) {
    const w = weightsOf(cat);
    let best: string | undefined;
    let bestVal = -Infinity;
    for (const e of agg(cat)) if (own(w, e) && w[e] > bestVal) { bestVal = w[e]; best = e; }
    if (best !== undefined) { score += bestVal; contributions.push({ category: cat, emoji: best, value: bestVal }); }
  }
  for (const cat of MULTI) {
    const w = weightsOf(cat);
    for (const e of [...new Set(agg(cat))].sort()) {
      if (own(w, e)) { score += w[e]; contributions.push({ category: cat, emoji: e, value: w[e] }); }
    }
  }
  const vw = weightsOf('Value');
  for (const e of agg('Value')) if (own(vw, e)) { score += vw[e]; contributions.push({ category: 'Value', emoji: e, value: vw[e] }); }
  return { score, contributions };
}

/** @req FR:scoring-engine/score.effort.own */
function ownEffort(t: ScoringTask, ctx: Ctx): number {
  const first = ctx.emojis.get(t.id)!.Effort[0];
  const hours = ctx.config.taskScoring.effortHours;
  return first !== undefined && own(hours, first) ? hours[first] : 1;
}

/** @req FR:scoring-engine/score.effort.parent */
function outcomeParent(t: ScoringTask, ctx: Ctx): ScoringTask | undefined {
  let outcome: ScoringTask | undefined;
  let root: ScoringTask | undefined;
  for (const a of ancestors(t, ctx)) {
    if (ctx.emojis.get(a.id)!.Special.includes('🎯')) outcome = a; // keeps updating: ends at the highest
    root = a;
  }
  return outcome ?? root;
}

/** @req FR:scoring-engine/score.effort */
function outcomeEffort(t: ScoringTask, ctx: Ctx): number {
  const parent = outcomeParent(t, ctx);
  if (!parent) return ownEffort(t, ctx);
  const leaves: ScoringTask[] = [];
  const walk = (id: string) => {
    for (const c of ctx.children.get(id) ?? []) {
      if (!(ctx.children.get(c.id)?.length)) { if (!c.complete) leaves.push(c); } else walk(c.id);
    }
  };
  walk(parent.id);
  if (!leaves.length) return ownEffort(t, ctx);
  return leaves.reduce((s, l) => s + ownEffort(l, ctx), 0);
}

/** @req FR:scoring-engine/filter.parked */
export function isParked(task: ScoringTask, all: ScoringTask[]): boolean {
  return parkedIn(task, new Map(all.map(t => [t.id, t])));
}

function parkedIn(task: ScoringTask, byId: Map<string, ScoringTask>): boolean {
  const seen = new Set<string>();
  for (let cur: ScoringTask | undefined = task; cur && !seen.has(cur.id); cur = cur.parent ? byId.get(cur.parent) : undefined) {
    seen.add(cur.id);
    const e = baseEmojis(cur.text);
    if (e.Special.some(s => s === '🅿️' || s === '💤' || s === '⏰') || e.Status.includes('⛔️')) return true;
  }
  return false;
}

/**
 * @req FR:scoring-engine/score.@function @req FR:scoring-engine/score.input @req FR:scoring-engine/score.output
 * @req FR:scoring-engine/score.formula @req FR:scoring-engine/score.placement @req FR:scoring-engine/score.breakdown @req FR:scoring-engine/score.validate
 */
function scoreAll(projects: ScoringProject[], config: StackConfig): ScoredTask[] {
  const all = projects.flatMap(p => p.tasks);
  const ctx: Ctx = {
    config, weights: effectiveWeights(config),
    byId: new Map(all.map(t => [t.id, t])), children: new Map(),
    emojis: new Map(all.map(t => [t.id, extractEmojis(t.text, config)])),
  };
  for (const t of all) if (t.parent) ctx.children.set(t.parent, [...(ctx.children.get(t.parent) ?? []), t]);
  const weights = new Map<string, number>();
  for (const w of weighProjects(projects, config)) if (!weights.has(w.name.toLowerCase())) weights.set(w.name.toLowerCase(), w.weight);

  const out: ScoredTask[] = [];
  for (const p of projects) {
    const leaves = p.tasks.filter(t => !ctx.children.has(t.id));
    for (const t of p.tasks) {
      const leaf = !ctx.children.has(t.id);
      const pos = leaves.indexOf(t);
      const placementBonus = leaf && leaves.length > 0 ? (leaves.length - pos) / 10.0 : 0;
      const projectBonus = weights.get(t.project.toLowerCase()) ?? 0;
      const { score: emoji, contributions } = emojiScore(t, ctx);
      const baseScore = emoji + projectBonus + placementBonus;
      const effortHours = outcomeEffort(t, ctx);
      if (!(effortHours > 0)) throw new ScoringError(`effort hours must be positive for task ${t.id}`);
      const score = baseScore / effortHours;
      out.push({
        task: t, leaf, parked: parkedIn(t, ctx.byId), score,
        breakdown: { emojiContributions: contributions, projectBonus, placementBonus, baseScore, effortHours, calculatedTotal: score },
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- time blocks

const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });
    formatters.set(timeZone, f);
  }
  return f;
}

/** @req FR:scoring-engine/filter.blocks */
export function activeTimeBlocks(config: StackConfig, at: Date): string[] {
  const parts = formatter(config.timezone).formatToParts(at);
  const get = (t: string) => parts.find(p => p.type === t)?.value ?? '';
  const day = get('weekday').toLowerCase();
  const ms = ((Number(get('hour')) * 60 + Number(get('minute'))) * 60 + Number(get('second'))) * 1000 + (((at.getTime() % 1000) + 1000) % 1000);
  const mins = (t: string) => (Number(t.slice(0, 2)) * 60 + Number(t.slice(3))) * 60000;
  return config.timeBlocks.filter(b => {
    if (!b.days.some(d => d.toLowerCase() === day)) return false;
    const s = mins(b.startTime);
    const e = mins(b.endTime);
    return s > e ? ms >= s || ms <= e : ms >= s && ms <= e;
  }).map(b => b.name);
}

/** @req FR:scoring-engine/filter.time @req FR:scoring-engine/filter.time.critical @req FR:scoring-engine/filter.time.emoji-active
 *  @req FR:scoring-engine/filter.time.emoji-inactive @req FR:scoring-engine/filter.time.capacity @req FR:scoring-engine/filter.time.unknown-project */
export function filterByTimeBlock(tasks: ScoredTask[], projects: ScoringProject[], config: StackConfig, at: Date): ScoredTask[] {
  const active = new Set(activeTimeBlocks(config, at).map(n => n.toLowerCase()));
  const blockNames = new Set(config.timeBlocks.map(b => b.name.toLowerCase()));
  const byName = new Map<string, ScoringProject>();
  for (const p of projects) if (!byName.has(p.name.toLowerCase())) byName.set(p.name.toLowerCase(), p);
  const capacityOf = (p: ScoringProject) => new Set(Object.keys(p.capacity).map(k => k.toLowerCase()).filter(k => blockNames.has(k)));

  return tasks.filter(({ task }) => {
    if (baseEmojis(task.text).Priority.includes('🚨')) return true;
    const project = byName.get(task.project.toLowerCase());
    let anyBlock = false;
    let matched: string | undefined;
    for (const e of extractEmojis(task.text, config).TimeBlocks) {
      const block = config.timeBlocks.find(b => b.emoji.toLowerCase() === e.toLowerCase());
      if (!block) continue;
      anyBlock = true;
      if (active.has(block.name.toLowerCase())) { matched = block.name.toLowerCase(); break; }
    }
    if (matched !== undefined) {
      if (!project) return true;
      const cap = capacityOf(project);
      return cap.size === 0 || cap.has(matched);
    }
    if (anyBlock) return false;
    if (!project) return true;
    const cap = capacityOf(project);
    return cap.size === 0 || [...active].some(a => cap.has(a));
  });
}

// ---------------------------------------------------------------- engines

/** Legacy PowerShell formula, ported line for line. @req FR:scoring-engine/parity.golden @req FR:scoring-engine/parity.quirks */
export const legacyEngine: ScoringEngine = {
  id: 'legacy',
  score: scoreAll,
  filter: filterByTimeBlock,
};

// ---------------------------------------------------------------- stack engine (default for NOW)

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DUE = /📅\s*([A-Za-z]{3})[a-z]*\s+(\d{1,2})(?:,\s*(\d{4}))?\s*(?:-\s*\d{1,2}\s*)?:/u;
/** Planning horizon: tasks due further out than this never rank NOW. */
export const NOW_HORIZON_DAYS = 14;
/** A year-less date up to this many days past is overdue; older means its next occurrence. */
export const OVERDUE_WINDOW_DAYS = 60;
/** Default engine for `next`. */
export const DEFAULT_ENGINE = 'stack';
/** Reply rows (`💬 …`) are messages to an agent, not work: never a NOW candidate. */
export const isMessage = (text: string): boolean => /^\s*💬/u.test(text);
const dayFormatters = new Map<string, Intl.DateTimeFormat>();

/** Days from `at` (calendar days in the config timezone) to the 📅 date in `text`; null when none. Without a year, the next occurrence
 *  wins, counting up to `OVERDUE_WINDOW_DAYS` past as overdue. */
export function daysUntilDue(text: string, config: StackConfig, at: Date): number | null {
  const m = DUE.exec(text);
  if (!m) return null;
  const mo = MONTHS.indexOf(m[1].toLowerCase());
  if (mo < 0) return null;
  let f = dayFormatters.get(config.timezone);
  if (!f) dayFormatters.set(config.timezone, (f = new Intl.DateTimeFormat('en-US', { timeZone: config.timezone, year: 'numeric', month: 'numeric', day: 'numeric' })));
  const parts = f.formatToParts(at);
  const n = (t: string) => Number(parts.find(p => p.type === t)?.value);
  const today = Date.UTC(n('year'), n('month') - 1, n('day'));
  const day = Number(m[2]);
  if (m[3]) return Math.round((Date.UTC(Number(m[3]), mo, day) - today) / 86400000);
  const near = [n('year') - 1, n('year'), n('year') + 1].map((y) => Math.round((Date.UTC(y, mo, day) - today) / 86400000));
  return near.find((d) => d >= -OVERDUE_WINDOW_DAYS)!;
}

/** Due-soon tier: 3 overdue/today, 2 within 3 days, 1 within a week or overdue more than 30 days (stale: no longer jumps the queue), 0 undated or later. */
const STALE_DAYS = 30;
const dueTier = (days: number | null): number => (days === null ? 0 : days < -STALE_DAYS ? 1 : days <= 0 ? 3 : days <= 3 ? 2 : days <= 7 ? 1 : 0);

// ---- blockers

const REASON = /^(after|pending|blocked on|blocked by|until|waiting on|waiting for)\s+(.*)$/i;
/** A date, day, time, or bare number ("Until Oct 30", "after lunch", "until Monday") is not a task name. */
const NOT_A_NAME = /^(?:(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?\s+\d|(?:\d+|\d{1,2}:\d\d|\d{1,2}(?::\d\d)?\s*(?:am|pm)|(?:next |this )?(?:mon|tues|wednes|thurs|fri|satur|sun)day|today|tonight|tomorrow|lunch|noon|eod|eow|end of (?:day|week|month)|(?:next|this) (?:week|month)|weekend)$)/i;

/** Row title without markers, dates, reason, emoji, or a leading "the": what another row's reason can name. */
function titleKey(text: string): string {
  return text.replace(/--.*$/, ' ')
    .replace(/(?:\u{1F4C5}|\u23F0|\u{1F4A4})\s*[^:]*:/gu, ' ').replace(/\u{1F504}\s*[^:]*:/gu, ' ')
    .replace(/[\p{Extended_Pictographic}\uFE0F\u200D]/gu, ' ').replace(/[`*_]/g, '')
    .replace(/\s+/g, ' ').trim().toLowerCase().replace(/[.:;,]+$/, '').replace(/^the\s+/, '').trim();
}

/** Names a row says it is waiting on: the reason after `--` (up to a `;`) when it reads like a dependency. @req FR:scoring-engine/blockers.parse */
export function blockedOn(text: string): string[] {
  const r = reasonOf(text);
  return r === undefined ? [] : r.split(/\s*(?:,|&|\band\b)\s*/i).map(titleKey).filter(isName);
}

/** The reason after the first `--`, up to a `;`, without its lead word; undefined when it is not a dependency. */
function reasonOf(text: string): string | undefined {
  const i = text.indexOf('--');
  const m = i < 0 ? null : REASON.exec(text.slice(i + 2).trim());
  return m ? m[2].split(';')[0] : undefined;
}
const isName = (n: string) => n !== '' && !NOT_A_NAME.test(n);

const escapeRe = (x: string) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Blocked task id -> ids of the tasks it waits on. @req FR:scoring-engine/blockers.resolve */
export function resolveBlockers(projects: ScoringProject[]): Map<string, string[]> {
  const all = projects.flatMap(p => p.tasks.map(t => ({ t, key: titleKey(t.text) })));
  const edges = new Map<string, string[]>();
  for (const p of projects) {
    for (const t of p.tasks) {
      const found = new Set<string>();
      // The whole reason as one exact title first (`After Q&A review`, `Pending research and design`), else its parts.
      const whole = titleKey(reasonOf(t.text) ?? '');
      const sameWhole = all.filter(x => x.t.project === t.project && x.t.id !== t.id && x.key === whole);
      const wholeHit = isName(whole) && (sameWhole.length ? sameWhole : all.filter(x => x.t.project !== t.project && x.key === whole)).length === 1;
      for (const name of wholeHit ? [whole] : blockedOn(t.text)) {
        // Same project: exact title, else a title that starts with the name (whole words). Any same-project hit, even an
        // ambiguous one, stops the search; otherwise another project on an exact title only.
        const mine = all.filter(x => x.t.project === t.project && x.t.id !== t.id);
        const exact = mine.filter(x => x.key === name);
        const lead = new RegExp(`^${escapeRe(name)}(\\W|$)`);
        const hit = exact.length ? exact : name.length >= 3 ? mine.filter(x => lead.test(x.key)) : [];
        const only = hit.length ? hit : all.filter(x => x.t.project !== t.project && x.key === name);
        if (only.length === 1) found.add(only[0].t.id);
      }
      if (found.size) edges.set(t.id, [...found]);
    }
  }
  return edges;
}

// ---- stack engine

/**
 * Legacy score plus a due-date lens and blocker inheritance. Due lens: overdue and due-soon tasks lead (tiers dominate
 * the score) and a task due beyond the horizon is not a NOW candidate. Blockers: a task that blocks others scores at
 * least as high as the most urgent task it blocks, transitively, never summed.
 * @req FR:scoring-engine/engine.stack @req FR:scoring-engine/blockers.inherit @req FR:scoring-engine/blockers.eligible @req FR:scoring-engine/blockers.cycle @req FR:scoring-engine/blockers.unchanged
 */
function lens(s: ScoredTask, config: StackConfig, at: Date | undefined): { drop: boolean; adj: number } {
  const days = at ? daysUntilDue(s.task.text, config, at) : null;
  return { drop: days !== null && days > NOW_HORIZON_DAYS, adj: s.score + dueTier(days) * 1000 };
}

function stackRank(all: ScoredTask[], projects: ScoringProject[], config: StackConfig, at?: Date): ScoredTask[] {
  const byId = new Map(all.map(s => [s.task.id, s]));
  const adj = new Map<string, number>();
  const eligible = new Map<string, boolean>();
  for (const s of all) {
    const l = lens(s, config, at);
    adj.set(s.task.id, l.adj);
    // Could be worked on once unblocked: not parked for any reason but ⛔️, and not due beyond the horizon.
    let parked = false;
    const seen = new Set<string>();
    for (let cur: ScoringTask | undefined = s.task; cur && !seen.has(cur.id); cur = cur.parent ? byId.get(cur.parent)?.task : undefined) {
      seen.add(cur.id);
      if (baseEmojis(cur.text).Special.some(e => e === '🅿️' || e === '💤' || e === '⏰')) { parked = true; break; }
    }
    eligible.set(s.task.id, !parked && !l.drop && !isMessage(s.task.text));
  }
  const blockedBy = resolveBlockers(projects);
  const blocks = new Map<string, string[]>(); // blocker -> tasks it blocks
  for (const [blocked, blockers] of blockedBy) for (const b of blockers) blocks.set(b, [...(blocks.get(b) ?? []), blocked]);
  const children = new Map<string, string[]>();
  for (const s of all) if (s.task.parent) children.set(s.task.parent, [...(children.get(s.task.parent) ?? []), s.task.id]);
  const lend = (id: string): number => {
    const s = byId.get(id)!;
    const pen = s.breakdown.emojiContributions.filter(c => c.category === 'Status' && c.emoji === '⛔️').reduce((a, c) => a + c.value, 0);
    return adj.get(id)! - pen / s.breakdown.effortHours;
  };
  /**
   * Best score among tasks reachable through "blocks" edges, passing only through eligible tasks. A blocked row holds
   * up its subtasks too, so they lend (and pass on what they block) like the row itself.
   */
  const inherited = (id: string): { value: number; from?: string } => {
    let best = -Infinity, from: string | undefined;
    const seen = new Set<string>([id]);
    const queue = [...(blocks.get(id) ?? [])];
    while (queue.length) {
      const next = queue.pop()!;
      if (seen.has(next) || !byId.has(next)) continue;
      seen.add(next);
      if (!eligible.get(next)) continue;
      const v = lend(next);
      if (v > best) { best = v; from = next; }
      queue.push(...(blocks.get(next) ?? []), ...(children.get(next) ?? []));
    }
    return { value: best, from };
  };

  const candidates = all.filter(s => s.leaf && !s.parked);
  const kept = at ? filterByTimeBlock(candidates, projects, config, at) : candidates;
  const out: ScoredTask[] = [];
  for (const s of kept) {
    if (isMessage(s.task.text)) continue;
    const l = lens(s, config, at);
    if (l.drop) continue;
    let score = l.adj;
    let from: string | undefined;
    const chain = [s.task.id];
    for (let cur = s.task.parent ? byId.get(s.task.parent) : undefined; cur && !chain.includes(cur.task.id); cur = cur.task.parent ? byId.get(cur.task.parent) : undefined) chain.push(cur.task.id);
    for (const id of chain) { const inh = inherited(id); if (inh.value > score) { score = inh.value; from = inh.from; } }
    out.push(from === undefined ? { ...s, score } : { ...s, score, breakdown: { ...s.breakdown, inheritedFrom: from } });
  }
  return byScore(out);
}

export const stackEngine: ScoringEngine = {
  id: 'stack',
  score: scoreAll,
  filter(tasks, projects, config, at) {
    return filterByTimeBlock(tasks, projects, config, at).flatMap(s => {
      if (isMessage(s.task.text)) return [];
      const l = lens(s, config, at);
      return l.drop ? [] : [{ ...s, score: l.adj }];
    });
  },
  rank: stackRank,
};

const engines = new Map<string, ScoringEngine>([[legacyEngine.id, legacyEngine], [stackEngine.id, stackEngine]]);

/** @req FR:scoring-engine/engine.registry */
export function registerEngine(engine: ScoringEngine): void {
  if (engines.has(engine.id)) throw new ScoringError(`engine already registered: ${engine.id}`);
  engines.set(engine.id, engine);
}

/** @req FR:scoring-engine/engine.registry @req FR:scoring-engine/engine.unknown */
export function getEngine(id = 'legacy'): ScoringEngine {
  const e = engines.get(id);
  if (!e) throw new ScoringError(`unknown scoring engine: ${id}`);
  return e;
}

/** @req FR:scoring-engine/engine.registry */
export function listEngines(): string[] {
  return [...engines.keys()];
}

/** Stable sort by score, highest first. */
export function byScore<T extends { score: number }>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => b.score - a.score);
}

/** @req FR:scoring-engine/rank.@function @req FR:scoring-engine/rank.order */
export function rankTasks(engine: ScoringEngine, projects: ScoringProject[], config: StackConfig, at?: Date): ScoredTask[] {
  const all = engine.score(projects, config);
  if (engine.rank) return engine.rank(all, projects, config, at);
  const candidates = all.filter(s => s.leaf && !s.parked);
  return byScore(at ? engine.filter(candidates, projects, config, at) : candidates);
}

// ---------------------------------------------------------------- adapter

const ACTIVE = /^🔄 Active/i;
const TASK_LINE = /^(\s*)- \[ \] (.+)$/;
const CAPACITY_LINE = /^-\s+\*\*(.+?)\s+capacity:\*\*\s+(\d+(?:\.\d+)?)h\s*$/i;

/**
 * @req FR:scoring-engine/load.@function @req FR:scoring-engine/load.name @req FR:scoring-engine/load.metadata
 * @req FR:scoring-engine/load.tasks @req FR:scoring-engine/filter.capacity
 */
export function toScoringProject(project: Project, fallbackName = ''): ScoringProject {
  // Legacy: H1 on the first line only; otherwise the file base name with '-' as ' '.
  const first = project.lines[0]?.replace(/^﻿/, '').replace(/\r$/, '').trim() ?? '';
  const h1 = /^# (.+)$/.exec(first)?.[1].trim();
  const name = h1 || fallbackName.replace(/-/g, ' ');
  const lines = project.lines.map(l => l.replace(/^﻿/, '').replace(/\r$/, ''));
  const content = lines.join('\n');

  const value: string[] = [];
  const valueLine = /\*\*Project value:\*\*\s*([^\n]+)/i.exec(content)?.[1];
  if (valueLine) for (const e of VALUE) value.push(...Array<string>(valueLine.split(e).length - 1).fill(e));
  const weekly = /\*\*Weekly capacity:\*\*\s*(\d+)/i.exec(content)?.[1];
  const prio = /\*\*Project priority:\*\*\s*(\d+)/i.exec(content)?.[1];
  const capacity: Record<string, number> = {};
  for (const l of lines) {
    const m = CAPACITY_LINE.exec(l);
    if (m) capacity[m[1].trim()] = Number(m[2]);
  }

  const active = project.sections.find(s => ACTIVE.test(s.heading));
  const flat: ParsedTask[] = [];
  const walk = (ts: ParsedTask[]) => { for (const t of ts) { flat.push(t); walk(t.children); } };
  if (active) walk(active.tasks);

  const tasks: ScoringTask[] = [];
  let hierarchy: string[] = [];
  for (const pt of flat) {
    const m = TASK_LINE.exec(lines[pt.line]);
    if (!m) continue;
    const level = Math.floor(m[1].length / 2);
    if (level < hierarchy.length) hierarchy = level === 0 ? [] : hierarchy.slice(0, level);
    const id = `${name}_task_${tasks.length}`;
    tasks.push({ id, parent: hierarchy.length ? hierarchy[hierarchy.length - 1] : null, text: m[2].trim(), level, project: name });
    hierarchy.push(id);
  }

  return {
    name, value, weeklyCapacity: weekly !== undefined ? Number(weekly) : 40,
    ...(prio !== undefined ? { explicitPriority: Number(prio) } : {}), capacity, tasks,
  };
}
