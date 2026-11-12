/**
 * Pris-aware ranking: link tasks to the owner's ordered priorities (`pris.json`), boost them by order, and list gaps.
 * Pure: the caller loads the priorities and hands them in with `setPris`.
 * @req FR:pris-aware-ranking/link.@function @req FR:pris-aware-ranking/engine.@function @req FR:pris-aware-ranking/cos.gaps.@function
 */
import { autopriRank, autopriParts, type AutopriParts } from './autopri';
import type { StackConfig } from './config';
import { PRI_LINKS, type Pri } from './pris';
import { escapeRe, wordsRe } from './regex';
import { isMessage, legacyEngine, listEngines, registerEngine, type ScoredTask, type ScoringEngine, type ScoringProject } from './scoring';

export type PriVia = 'ref' | 'keyword' | 'project';
/** @req FR:pris-aware-ranking/$pri-link */
export interface PriLink { id: string; rank: number; title: string; via: PriVia; term: string; boost: number }
export interface LinkRow { text: string; context?: string; project: string; aliases: string[] }

/** Boost for rank 1. Below the 🔓 score (4000), above due-today urgency (2000). @req FR:pris-aware-ranking/engine.boost */
export const PRI_SCORE = 3000;
const PROJECT_SHARE = 0.5;
const LINKING = new Set<Pri['status']>(['active', 'blocked']);
const VERSION = /(?<![\w.])(?:v\d+(?:\.\d+)*|\d+(?:\.\d+)+)(?!\w|\.\d)/giu;
const tokenRe = (t: string) => new RegExp(`(?<![\\w.])${escapeRe(t)}(?!\\w|\\.\\d)`, 'iu');
const low = (s: string) => s.toLowerCase();

interface Terms { refs: string[]; keywords: string[]; projects: string[]; auto: boolean }
/** A capitalized whole word or phrase, as a name is written in a title (`Personal`, `FTK`), not a common word. */
const nameIn = (title: string, name: string): boolean => {
  const re = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(name)}(?![\\p{L}\\p{N}])`, 'giu');
  for (const m of title.matchAll(re)) if (/^\p{Lu}/u.test(m[0])) return true;
  return false;
};

/** The priorities that link (active, blocked), in order, with rank 1..N. @req FR:pris-aware-ranking/link.active */
export const linkingPris = (pris: Pri[]): { pri: Pri; rank: number }[] => pris.filter((p) => LINKING.has(p.status)).map((pri, i) => ({ pri, rank: i + 1 }));

/** Explicit terms, or automatic ones from the title when none are set. @req FR:pris-aware-ranking/link.auto */
function termsOf(p: Pri, names: string[]): Terms {
  if (PRI_LINKS.some((k) => p[k]?.length)) return { refs: p.refs ?? [], keywords: p.keywords ?? [], projects: p.projects ?? [], auto: false };
  // Text in parentheses is a note, not the subject.
  const title = p.title.replace(/\([^)]*\)/g, ' ');
  const projects = names.filter((n) => nameIn(title, n));
  return { refs: [], keywords: [...new Set(title.match(VERSION) ?? [])], projects, auto: true };
}

/**
 * A linker over a fixed priority list; `names` are every project name and alias (for automatic terms).
 * @req FR:pris-aware-ranking/link.ref @req FR:pris-aware-ranking/link.keyword @req FR:pris-aware-ranking/link.project @req FR:pris-aware-ranking/link.best
 */
export function linker(pris: Pri[], names: string[] = []): (row: LinkRow) => PriLink | undefined {
  const list = linkingPris(pris);
  const n = list.length;
  const compiled = list.map(({ pri, rank }) => {
    const t = termsOf(pri, names);
    // Auto version tokens use the strict token rule (`0.4` is not in `v0.4`); explicit phrases match whole words.
    const re = (s: string) => (t.auto ? tokenRe(s) : wordsRe(s));
    // Auto version tokens apply only inside the projects the title names, when it names any (`Stack v2` is not FOCUS v2).
    const scope = t.auto && t.projects.length ? new Set(t.projects.map(low)) : undefined;
    return { pri, rank, full: (PRI_SCORE * (n + 1 - rank)) / n, refs: t.refs.map((s) => [s, wordsRe(s)] as const), keywords: t.keywords.map((s) => [s, re(s)] as const), projects: t.projects.map(low), scope };
  });
  return (row) => {
    let best: PriLink | undefined;
    const names = new Set([row.project, ...row.aliases].map(low));
    for (const c of compiled) {
      const hit = (via: PriVia, term: string, share = 1) => {
        const boost = c.full * share;
        if (!best || boost > best.boost) best = { id: c.pri.id, rank: c.rank, title: c.pri.title, via, term, boost };
      };
      const ref = c.refs.find(([, re]) => re.test(row.text));
      if (ref) { hit('ref', ref[0]); continue; }
      const inScope = !c.scope || [...names].some((x) => c.scope!.has(x));
      const kw = inScope ? c.keywords.find(([, re]) => re.test(row.text) || (row.context !== undefined && re.test(row.context))) : undefined;
      if (kw) { hit('keyword', kw[0]); continue; }
      const pj = c.projects.find((p) => names.has(p));
      if (pj) hit('project', pj, PROJECT_SHARE);
    }
    return best;
  };
}

/** @req FR:pris-aware-ranking/link.@function */
export const linkTask = (pris: Pri[], row: LinkRow): PriLink | undefined => linker(pris, [row.project, ...row.aliases])(row);

/** Every project name and alias. */
const projectNames = (projects: ScoringProject[]): string[] => projects.flatMap((p) => [p.name, ...(p.aliases ?? [])]);

/** Link rows for scored tasks: own text, parent texts as context, project aliases. */
function rowsOf(all: ScoredTask[], projects: ScoringProject[]): Map<string, LinkRow> {
  const byId = new Map(all.map((s) => [s.task.id, s.task]));
  const aliases = new Map(projects.map((p) => [p.name, p.aliases ?? []]));
  const out = new Map<string, LinkRow>();
  for (const s of all) {
    const above: string[] = [];
    const seen = new Set<string>();
    for (let p = s.task.parent; p && !seen.has(p); p = byId.get(p)?.parent ?? null) { seen.add(p); const t = byId.get(p); if (t) above.unshift(t.text); }
    out.set(s.task.id, { text: s.task.text, ...(above.length ? { context: above.join('\n') } : {}), project: s.task.project, aliases: aliases.get(s.task.project) ?? [] });
  }
  return out;
}

/** Link per task id. */
export function linkAll(all: ScoredTask[], projects: ScoringProject[], pris: Pri[]): Map<string, PriLink> {
  const link = linker(pris, projectNames(projects));
  const out = new Map<string, PriLink>();
  for (const [id, row] of rowsOf(all, projects)) { const l = link(row); if (l) out.set(id, l); }
  return out;
}

export interface PrisParts extends AutopriParts { pri: number; link?: PriLink }

/** `autopri` parts plus the `pri` term per task id. @req FR:pris-aware-ranking/engine.score @req FR:pris-aware-ranking/explain.cli */
export function prisParts(all: ScoredTask[], projects: ScoringProject[], config: StackConfig, pris: Pri[], at?: Date): Map<string, PrisParts> {
  const links = linkAll(all, projects, pris);
  return new Map([...autopriParts(all, projects, config, at)].map(([id, p]) => {
    const link = links.get(id);
    return [id, { ...p, pri: link?.boost ?? 0, ...(link ? { link } : {}) }];
  }));
}

let current: Pri[] = [];
let version = 0;
/** Sets the priorities the `pris` engine reads. @req FR:pris-aware-ranking/engine.@function */
export function setPris(pris: Pri[]): void {
  const same = JSON.stringify(pris) === JSON.stringify(current);
  current = pris;
  if (!same) version++;
}

/**
 * `unblock + urgency + value + pri`, then blockers lift. Same as `autopri` with no priorities.
 * @req FR:pris-aware-ranking/engine.@function @req FR:pris-aware-ranking/engine.score @req FR:pris-aware-ranking/engine.unblock @req FR:pris-aware-ranking/engine.same
 */
export const prisEngine: ScoringEngine = {
  id: 'pris',
  score: legacyEngine.score,
  filter: legacyEngine.filter,
  rank(all, projects, config, at, opts = {}) {
    const links = linkAll(all, projects, current);
    return autopriRank(all, projects, config, at, opts, new Map([...links].map(([id, l]) => [id, l.boost])));
  },
  /** Changes with each `setPris`, so a ranking cache keys on it. @req FR:pris-aware-ranking/engine.memo */
  version: () => `pris@${version}`,
};

/** Registers `pris` once. Never changes the default engine. */
export function registerPrisEngine(): void {
  if (!listEngines().includes(prisEngine.id)) registerEngine(prisEngine);
}

// ---------------------------------------------------------------- gaps

export type PriGapKind = 'no-status' | 'stale' | 'no-tasks';
/** @req FR:pris-aware-ranking/$pri-gap */
export interface PriGap { id: string; rank: number; title: string; gaps: PriGapKind[]; lastStatus?: string; days?: number; linked: number }

const STALE_DAYS = 7;
const DAY_MS = 86_400_000;

/** Monday 00:00 UTC of an ISO week `YYYY-Www`. */
export function weekStart(week: string): Date {
  const [y, w] = week.split('-W').map(Number);
  const jan4 = Date.UTC(y, 0, 4);
  const dow = (new Date(jan4).getUTCDay() + 6) % 7; // Monday = 0
  return new Date(jan4 - dow * DAY_MS + (w - 1) * 7 * DAY_MS);
}

/** The ISO week `YYYY-Www` of a date (UTC). */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - dow + 3); // Thursday decides the year
  const y = t.getUTCFullYear();
  const w = 1 + Math.floor((t.getTime() - Date.UTC(y, 0, 1)) / (7 * DAY_MS));
  return `${y}-W${String(w).padStart(2, '0')}`;
}

/** @req FR:pris-aware-ranking/cos.gaps.kinds */
export function priGaps(pris: Pri[], linked: Map<string, number>, now: Date): PriGap[] {
  return linkingPris(pris).flatMap(({ pri, rank }): PriGap[] => {
    // The newer of the note time and the newest week, so a hand-added week is not stale.
    const times = [...(pri.statusAt ? [Date.parse(pri.statusAt)] : []), ...(pri.weekly[0] ? [weekStart(pri.weekly[0].week).getTime()] : [])];
    const at = times.length ? new Date(Math.max(...times)) : undefined;
    const gaps: PriGapKind[] = [];
    const days = at ? Math.floor((now.getTime() - at.getTime()) / DAY_MS) : undefined;
    if (!at) gaps.push('no-status');
    else if (days! > STALE_DAYS) gaps.push('stale');
    const n = linked.get(pri.id) ?? 0;
    if (!n) gaps.push('no-tasks');
    if (!gaps.length) return [];
    return [{ id: pri.id, rank, title: pri.title, gaps, ...(at ? { lastStatus: at.toISOString(), days } : {}), linked: n }];
  });
}

/** Open tasks linked per priority id (leaves, not parked, not 💬 messages: the rows the ranking keeps). */
export function linkCounts(all: ScoredTask[], projects: ScoringProject[], pris: Pri[]): Map<string, number> {
  const out = new Map<string, number>();
  const live = new Set(all.filter((s) => s.leaf && !s.parked && !isMessage(s.task.text)).map((s) => s.task.id));
  for (const [id, l] of linkAll(all, projects, pris)) if (live.has(id)) out.set(l.id, (out.get(l.id) ?? 0) + 1);
  return out;
}

/** Plain-text gap report. @req FR:pris-aware-ranking/cos.gaps.cli */
export function formatGaps(gaps: PriGap[]): string {
  if (!gaps.length) return 'no gaps';
  return gaps.map((g) => {
    const next = g.gaps.includes('no-status') || g.gaps.includes('stale') ? `stack pris note ${g.id} "..."` : `stack pris link ${g.id} --keywords "..."`;
    return `${g.rank}. ${g.id} ${g.title}: ${g.gaps.join(', ')}${g.days !== undefined ? ` [last ${g.days}d]` : ''} -> ${next}`;
  }).join('\n');
}

// ---------------------------------------------------------------- edits (pure)

/** Replaces the given link lists on one priority; an empty list clears it. @req FR:pris-aware-ranking/cos.link */
export function withLinks(pris: Pri[], id: string, links: Partial<Record<(typeof PRI_LINKS)[number], string[]>>): Pri[] {
  if (!pris.some((p) => p.id === id)) throw new RangeError(`Unknown priority: ${id}`);
  return pris.map((p) => {
    if (p.id !== id) return p;
    const next: Pri = { ...p };
    for (const k of PRI_LINKS) {
      const v = links[k];
      if (v === undefined) continue;
      if (v.length) next[k] = v; else delete next[k];
    }
    return next;
  });
}

/** Sets `statusAt` and this week's `weekly` entry. @req FR:pris-aware-ranking/cos.note */
export function withNote(pris: Pri[], id: string, text: string, now: Date): Pri[] {
  if (!pris.some((p) => p.id === id)) throw new RangeError(`Unknown priority: ${id}`);
  const week = isoWeek(now);
  return pris.map((p) => (p.id !== id ? p : { ...p, statusAt: now.toISOString(), weekly: [{ week, text }, ...p.weekly.filter((w) => w.week !== week)].sort((a, b) => (a.week < b.week ? 1 : -1)).slice(0, 12) }));
}
