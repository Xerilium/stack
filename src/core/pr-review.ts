/**
 * PR review aids: spec-line counts, the live-validation rule, the PR facts cache, and agent briefs.
 * Pure rules have no I/O. The only GitHub calls are reads through `gh`. No LLM call.
 * @req FR:pr-review-lane/sort.lines @req FR:pr-review-lane/flag.rule @req FR:pr-review-lane/brief.model
 */
import { execFile } from 'child_process';
import { mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { withFileLock, writeAtomic, type LockOptions } from './file-lock';

export interface PrFile { filename: string; additions: number; deletions: number }
export interface PrRef { repo: string; number: number; url: string }

// ---- refs

/** `<owner>/<name>#<n>` or a GitHub PR url; null for anything else. */
export function parsePrRef(s: string): PrRef | null {
  const t = s.trim();
  const m = /^([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})#(\d{1,7})$/.exec(t) ?? /^https:\/\/github\.com\/([A-Za-z0-9][A-Za-z0-9-]{0,38})\/([A-Za-z0-9._-]{1,100})\/pull\/(\d{1,7})\/?$/.exec(t);
  if (!m) return null;
  const number = Number(m[3]);
  if (number < 1) return null;
  const repo = `${m[1]}/${m[2]}`;
  return { repo, number, url: `https://github.com/${repo}/pull/${number}` };
}
/** Case-free key for one PR. */
export const refKey = (r: { repo: string; number: number }): string => `${r.repo.toLowerCase()}#${r.number}`;
export const refText = (r: { repo: string; number: number }): string => `${r.repo}#${r.number}`;

// ---- pure rules

/** A spec file: under `.xe/`, any `spec.md`, or a `.md` file under `docs/`. */
export const isSpecPath = (p: string): boolean => p.startsWith('.xe/') || /(^|\/)spec\.md$/.test(p) || (p.startsWith('docs/') && /\.md$/i.test(p));

/** Lines changed (additions + deletions) in spec files. @req FR:pr-review-lane/sort.lines */
export const specLines = (files: PrFile[]): number => files.filter((f) => isSpecPath(f.filename)).reduce((n, f) => n + (f.additions || 0) + (f.deletions || 0), 0);

/** Label match with no case and no variation selectors. */
const norm = (s: string): string => s.replace(/️/g, '').trim().toLowerCase();
export const isAutopilot = (label: string): boolean => norm(label) === norm('Status: 🤖 Autopilot');

/** Drops Autopilot rows; fewest spec lines first; no count last; stable. @req FR:pr-review-lane/sort.order */
export function sortBySpecLines<T extends { labels: string[]; specLines?: number | null }>(rows: T[]): T[] {
  const key = (r: T) => (typeof r.specLines === 'number' ? r.specLines : Number.POSITIVE_INFINITY);
  return rows.map((r, i) => ({ r, i })).filter(({ r }) => !r.labels.some(isAutopilot)).sort((a, b) => key(a.r) - key(b.r) || a.i - b.i).map(({ r }) => r);
}

/** True when the PR needs a running app to check. @req FR:pr-review-lane/flag.rule */
export function needsLiveValidation(pr: { labels: string[]; body: string; paths: string[] }): { live: boolean; reasons: string[] } {
  const reasons: string[] = [];
  for (const l of pr.labels) if (/(needs|live)[\s_-]*validation/i.test(l)) reasons.push(`label: ${l}`);
  const body = pr.body ?? '';
  if (/live[\s_-]+validation/i.test(body)) reasons.push('body: live validation');
  if (/validate[\s_-]+live/i.test(body)) reasons.push('body: validate live');
  for (const p of pr.paths) {
    if (/^(infra|deploy)\//.test(p) || /(^|\/)(deploy|deployment)\//.test(p) || /^\.github\/workflows\/[^/]*deploy[^/]*\.ya?ml$/i.test(p)) reasons.push(`path: ${p}`);
  }
  return { live: reasons.length > 0, reasons };
}

// ---- gh reads

/** Runs `gh` with args and returns stdout. Reads only. */
export type Gh = (args: string[]) => Promise<string>;
/** The `gh` binary (`STACK_GH` or `gh`). */
export const ghRunner = (env: NodeJS.ProcessEnv = process.env): Gh => (args) => new Promise((ok, fail) => {
  execFile(env.STACK_GH || 'gh', args, { maxBuffer: 32 * 1024 * 1024, timeout: 60_000 }, (e, out, err) => (e ? fail(new Error(String(err || e.message).trim())) : ok(String(out))));
});

/** Runs `fn` on each item, at most `n` at a time, keeping input order. */
export async function mapLimit<T, R>(items: T[], n: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => { while (next < items.length) { const i = next++; out[i] = await fn(items[i]); } };
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, worker));
  return out;
}

// ---- facts cache

/** One PR's cached facts, per head SHA. @req FR:pr-review-lane/sort.cache */
export interface PrFacts { repo: string; number: number; url: string; title: string; headSha: string; specLines: number; labels: string[]; live: boolean; reasons: string[]; draft: boolean; at: string }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const SHA = /^[0-9a-f]{7,40}$/i;

function parseFacts(v: unknown): PrFacts | null {
  if (!isObj(v)) return null;
  const r = parsePrRef(`${v.repo}#${v.number}`);
  if (!r || typeof v.headSha !== 'string' || !SHA.test(v.headSha) || typeof v.specLines !== 'number' || typeof v.at !== 'string') return null;
  const strs = (x: unknown) => (Array.isArray(x) ? x.filter((s): s is string => typeof s === 'string') : []);
  return { ...r, title: typeof v.title === 'string' ? v.title : '', headSha: v.headSha, specLines: v.specLines, labels: strs(v.labels), live: v.live === true, reasons: strs(v.reasons), draft: v.draft === true, at: v.at };
}

export interface StoreOptions extends LockOptions { now?: () => Date }

/** `<home>/pr-facts.json`: PR facts per head SHA, read with `gh`. @req FR:pr-review-lane/sort.cache */
export class FactsStore {
  readonly file: string;
  constructor(private readonly dir: string, private readonly o: StoreOptions = {}) { this.file = join(dir, 'pr-facts.json'); }

  read(): PrFacts[] {
    try {
      const d = JSON.parse(readFileSync(this.file, 'utf8')) as { items?: unknown };
      return Array.isArray(d.items) ? d.items.map(parseFacts).filter((f): f is PrFacts => !!f) : [];
    } catch { return []; }
  }
  get(r: { repo: string; number: number }): PrFacts | undefined { const k = refKey(r); return this.read().find((f) => refKey(f) === k); }

  /** Reads each PR (head first; files only when the head changed), at most 4 at a time. A failed read keeps prior facts. */
  async fetch(refs: PrRef[], gh: Gh, opts: { offline?: boolean } = {}): Promise<PrFacts[]> {
    const prior = new Map(this.read().map((f) => [refKey(f), f]));
    if (opts.offline) return refs.map((r) => prior.get(refKey(r))).filter((f): f is PrFacts => !!f);
    const now = (this.o.now ?? (() => new Date()))().toISOString();
    const got = await mapLimit(refs, 4, async (r): Promise<PrFacts | undefined> => {
      const old = prior.get(refKey(r));
      try {
        const pr = JSON.parse(await gh(['api', `repos/${r.repo}/pulls/${r.number}`])) as { head?: { sha?: string }; body?: string | null; labels?: { name?: string }[]; title?: string; draft?: boolean; html_url?: string };
        const headSha = String(pr.head?.sha ?? '');
        if (!SHA.test(headSha)) return old;
        const labels = (pr.labels ?? []).map((l) => String(l?.name ?? '')).filter(Boolean);
        let files: PrFile[] | null = null;
        if (!old || old.headSha !== headSha) {
          const out = await gh(['api', '--paginate', `repos/${r.repo}/pulls/${r.number}/files`, '--jq', '.[] | {filename, additions, deletions}']);
          files = out.split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as PrFile);
        }
        const paths = files ? files.map((f) => f.filename) : null;
        const sl = files ? specLines(files) : old!.specLines;
        // Path reasons only change with a new head; label and body reasons are read each time.
        const flag = needsLiveValidation({ labels, body: pr.body ?? '', paths: paths ?? [] });
        const reasons = paths ? flag.reasons : [...flag.reasons, ...old!.reasons.filter((x) => x.startsWith('path: '))];
        return { ...r, title: pr.title ?? '', headSha, specLines: sl, labels, live: reasons.length > 0, reasons, draft: pr.draft === true, at: now };
      } catch { return old; }
    });
    const fresh = got.filter((f): f is PrFacts => !!f);
    if (fresh.length) {
      await withFileLock(this.dir, 'pr-facts.lock', () => {
        const all = new Map(this.read().map((f) => [refKey(f), f]));
        for (const f of fresh) { all.delete(refKey(f)); all.set(refKey(f), f); }
        writeAtomic(this.file, `${JSON.stringify({ version: 1, items: [...all.values()].slice(-500) }, null, 2)}\n`);
      }, () => new Error('PR facts store is busy (pr-facts.lock); try again'), this.o);
    }
    return fresh;
  }
}

// ---- briefs

/** A per-PR brief an agent writes for an Autopilot PR that waits on the owner. @req FR:pr-review-lane/brief.model */
export interface Brief { repo: string; number: number; url: string; problem: string; solution: string; recommendation: string; evidence: string[]; askedAt: string; headSha: string; by?: string }
export class BriefInvalid extends Error { constructor(readonly issues: string[]) { super(`Invalid brief: ${issues.join('; ')}`); } }

const words = (s: string): number => s.split(/\s+/).filter((w) => /[A-Za-z0-9]/.test(w)).length;

/** At most 120 words in the three text fields; no sentence over 20 words (STE). @req FR:pr-review-lane/brief.lint */
export function lintBrief(b: { problem: string; solution: string; recommendation: string }): { ok: boolean; words: number; issues: string[] } {
  const texts = [b.problem, b.solution, b.recommendation].map((t) => String(t ?? ''));
  const total = texts.reduce((n, t) => n + words(t), 0);
  const issues: string[] = [];
  if (total > 120) issues.push(`brief has ${total} words: over 120 words`);
  for (const t of texts) for (const s of t.split(/(?<=[.!?])\s+/)) { const n = words(s); if (n > 20) issues.push(`sentence over 20 words (${n}): ${s.slice(0, 60)}`); }
  return { ok: issues.length === 0, words: total, issues };
}

/** Stale when the known head differs from the brief head (prefix match for short SHAs). @req FR:pr-review-lane/brief.stale */
export function isStale(b: { headSha: string }, head: string | undefined): boolean {
  if (!head) return false;
  const a = b.headSha.toLowerCase(); const h = head.toLowerCase();
  return !(h.startsWith(a) || a.startsWith(h));
}

const line = (v: unknown, max: number): string | undefined => (typeof v === 'string' && v.trim() && v.length <= max && !/[\r\n]/.test(v) ? v.trim() : undefined);
const AGENT = /^[a-z0-9][a-z0-9-]{0,39}$/;

function checkBrief(v: unknown, ref: PrRef, by: string | undefined, now: string): Brief {
  const issues: string[] = [];
  if (!isObj(v)) throw new BriefInvalid(['brief must be a JSON object']);
  const allowed = ['problem', 'solution', 'recommendation', 'evidence', 'askedAt', 'headSha'];
  for (const k of Object.keys(v)) if (!allowed.includes(k)) issues.push(`${k}: unknown field`);
  const text: Record<string, string> = {};
  for (const k of ['problem', 'solution', 'recommendation']) { const s = line(v[k], 600); if (!s) issues.push(`${k}: one line, 1-600 characters`); else text[k] = s; }
  const ev = Array.isArray(v.evidence) ? v.evidence : [];
  if (ev.length < 1 || ev.length > 5 || !ev.every((e) => typeof e === 'string' && /^https:\/\/\S+$/.test(e) && e.length <= 2000)) issues.push('evidence: 1-5 https links');
  if (typeof v.headSha !== 'string' || !SHA.test(v.headSha)) issues.push('headSha: 7-40 hex characters');
  if (v.askedAt !== undefined && (typeof v.askedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(v.askedAt) || Number.isNaN(Date.parse(v.askedAt)))) issues.push('askedAt: an ISO time');
  if (by !== undefined && !AGENT.test(by)) issues.push('agent: lowercase letters, digits and dashes');
  if (issues.length) throw new BriefInvalid(issues);
  const lint = lintBrief(text as { problem: string; solution: string; recommendation: string });
  if (!lint.ok) throw new BriefInvalid(lint.issues);
  return { ...ref, problem: text.problem, solution: text.solution, recommendation: text.recommendation, evidence: ev as string[], askedAt: (v.askedAt as string | undefined) ?? now, headSha: v.headSha as string, ...(by ? { by } : {}) };
}

/** `<home>/pr-briefs.json`: one brief per PR. Agents write it; Stack makes no LLM call. @req FR:pr-review-lane/brief.model */
export class BriefStore {
  readonly file: string;
  constructor(private readonly dir: string, private readonly o: StoreOptions = {}) { this.file = join(dir, 'pr-briefs.json'); }

  read(): Brief[] {
    try {
      const d = JSON.parse(readFileSync(this.file, 'utf8')) as { items?: unknown };
      if (!Array.isArray(d.items)) return [];
      return d.items.filter((b): b is Brief => isObj(b) && !!parsePrRef(`${b.repo}#${b.number}`) && typeof b.problem === 'string' && typeof b.headSha === 'string');
    } catch { return []; }
  }
  get(r: { repo: string; number: number }): Brief | undefined { const k = refKey(r); return this.read().find((b) => refKey(b) === k); }

  /** Checks, lints, and stores a brief; it replaces the PR's prior brief. */
  async put(input: unknown, ref: PrRef, by?: string): Promise<{ brief: Brief; words: number }> {
    const brief = checkBrief(input, ref, by, (this.o.now ?? (() => new Date()))().toISOString());
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    await withFileLock(this.dir, 'pr-briefs.lock', () => {
      const items = this.read().filter((b) => refKey(b) !== refKey(ref));
      items.push(brief);
      writeAtomic(this.file, `${JSON.stringify({ version: 1, items: items.slice(-200) }, null, 2)}\n`);
    }, () => new Error('Brief store is busy (pr-briefs.lock); try again'), this.o);
    return { brief, words: lintBrief(brief).words };
  }
}

/** Briefs with `stale` from the facts cache. @req FR:pr-review-lane/brief.api */
export const briefViews = (briefs: Brief[], facts: PrFacts[]): (Brief & { stale: boolean })[] => {
  const heads = new Map(facts.map((f) => [refKey(f), f.headSha]));
  return briefs.map((b) => ({ ...b, stale: isStale(b, heads.get(refKey(b))) }));
};
