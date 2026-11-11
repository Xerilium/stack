/**
 * Autopri tagging and explain: pure helpers. Set `🔓`/`📅` tags, parse the owner ground truth, match it to ranked rows.
 * @req FR:autopri-tagging/tag.@function @req FR:autopri-tagging/truth.parse @req FR:autopri-tagging/truth.match @req FR:autopri-tagging/truth.report
 */
import { UNBLOCK, type AutopriParts } from './autopri';
import { escapeRe } from './regex';

export interface Tags { unblocker?: boolean; due?: string | null }

const DUE_MARK = /📅\s*[A-Za-z]{3}[a-z]*\s+\d{1,2}(?:,\s*\d{4})?\s*(?:-\s*\d{1,2}\s*)?:\s*/u;
const DUE_FORMAT = /^[A-Za-z]{3} \d{1,2}$/;
const ROW = /^(\s*- \[[ xX]\] )(.*)$/;
const clean = (s: string) => s.replace(/\s{2,}/g, ' ').trim();

/** @req FR:autopri-tagging/tag.unblocker @req FR:autopri-tagging/tag.due */
export function applyTags(line: string, tags: Tags): string {
  const m = ROW.exec(line);
  if (!m) throw new Error(`Invalid task line: ${line}`);
  if (tags.due != null && !DUE_FORMAT.test(tags.due)) throw new Error(`due must be 'MMM d' (e.g. Nov 12): ${tags.due}`);
  let c = m[2];
  if (tags.unblocker === false) c = clean(c.split(UNBLOCK).join(''));
  if (tags.unblocker === true && !c.includes(UNBLOCK)) c = `${c} ${UNBLOCK}`;
  if (tags.due !== undefined) {
    c = c.replace(DUE_MARK, '');
    if (tags.due !== null) c = `📅 ${tags.due}: ${c}`;
    c = clean(c);
  }
  return `${m[1]}${c}`;
}

export interface TruthItem { rank: number | null; project: string; work: string; date: string; why: string }

/** @req FR:autopri-tagging/truth.parse */
export function parseTruth(text: string): TruthItem[] {
  const out: TruthItem[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cells = line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
    if (cells.length < 5 || !/^(\d+|-)$/.test(cells[0])) continue;
    out.push({ rank: cells[0] === '-' ? null : Number(cells[0]), project: cells[1], work: cells[2], date: cells[3], why: cells[4] });
  }
  return out;
}

export interface TruthRow { project: string; aliases: string[]; text: string; context?: string; ref?: string }
export type TruthStatus = 'ranked' | 'untagged' | 'missing';
export interface TruthMatch { item: TruthItem; status: TruthStatus; /** 1-based rank of the matched row */ actual?: number; row?: number; suggest?: string }

const tokenIn = (hay: string, tok: string) => new RegExp(`(?<![\\w.])${escapeRe(tok)}(?!\\w|\\.\\d)`, 'iu').test(hay);
const anchors = (work: string): string[] => {
  const v = work.match(/(?<![\w.])(?:v\d+(?:\.\d+)*|\d+(?:\.\d+)+)(?!\w|\.\d)/giu);
  return v?.length ? [...new Set(v)] : work.split(/\s+/).filter(Boolean).slice(0, 3);
};
const isUnblocker = (why: string) => /unblock|enabler|speeds|slow everything/i.test(why);

/** @req FR:autopri-tagging/truth.match @req FR:autopri-tagging/truth.report */
export function matchTruth(items: TruthItem[], rows: TruthRow[]): TruthMatch[] {
  return items.map((item) => {
    const p = item.project.toLowerCase();
    const inProject = rows.map((r, i) => ({ r, i })).filter(({ r }) => [r.project, ...r.aliases].some((n) => { const l = n.toLowerCase(); return l === p || l.includes(p) || p.includes(l); }));
    const pool = inProject.length ? inProject : rows.map((r, i) => ({ r, i }));
    const need = anchors(item.work);
    const hit = pool.find(({ r }) => need.every((a) => tokenIn(`${r.text}\n${r.context ?? ''}`, a)));
    const unblock = isUnblocker(item.why);
    const dateArg = DUE_FORMAT.test(item.date) ? ` --due "${item.date}"` : '';
    if (!hit) {
      const proj = item.project.toLowerCase();
      const tag = unblock || dateArg ? ` then: stack tag <ref>${unblock ? ' --unblocker yes' : ''}${dateArg}` : '';
      return { item, status: 'missing' as const, suggest: `stack add ${proj} "${item.work}"${tag}` };
    }
    const base = { item, actual: hit.i + 1, row: hit.i };
    if (unblock && !hit.r.text.includes(UNBLOCK)) return { ...base, status: 'untagged' as const, suggest: `stack tag ${hit.r.ref ?? '<ref>'} --unblocker yes${dateArg}` };
    return { ...base, status: 'ranked' as const };
  });
}

export interface ExplainRow { rank: number; ref: string; project: string; text: string; score: number; parts: AutopriParts; rule?: string }

/** Plain-text report. @req FR:autopri-tagging/explain.cli */
export function formatExplain(rows: ExplainRow[], truth?: TruthMatch[]): string {
  const n = (x: number) => Number(x.toFixed(1));
  const out = rows.map((r) => `${r.rank}. ${r.ref} ${n(r.score)} [unblock=${n(r.parts.unblock)} urgency=${n(r.parts.urgency)} value=${n(r.parts.value)}]${r.rule ? ` rule=${r.rule}` : ''} ${r.project} ${r.text}`);
  if (truth) {
    out.push('', 'Ground truth:');
    for (const t of truth) {
      const id = `${t.item.rank ?? '-'} ${t.item.project} ${t.item.work}`;
      out.push(t.status === 'ranked' ? `ok ranked #${t.actual} (want ${t.item.rank ?? '-'}): ${id}` : `${t.status}: ${id}\n   -> ${t.suggest}`);
    }
  }
  return out.join('\n');
}
