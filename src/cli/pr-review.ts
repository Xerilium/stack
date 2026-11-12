/**
 * CLI for the PR review lane: `stack prs --sort spec-lines`, `stack pr-pri brief`, and `stack live`.
 * Live state is under ~/.stack; no content repo, no GitHub write, no LLM call.
 * @req FR:pr-review-lane/sort.cli @req FR:pr-review-lane/brief.cli @req FR:pr-review-lane/lane.guard
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { stackHome } from '../core/reports';
import {
  BriefStore, FactsStore, ghRunner, isAutopilot, isStale, parsePrRef, refKey, refText, sortBySpecLines, type Gh, type PrRef,
} from '../core/pr-review';
import { ITEM_OPS, ITEM_STATES, LiveError, LiveStore, pickNext, readQueue, type ItemOp } from '../core/live-lane';
import { UsageError, type Parsed } from './args';

export interface Outcome { json: Record<string, unknown>; text: string; code?: number }
const flag = (f: Parsed['flags'], n: string): string | undefined => (typeof f[n] === 'string' ? f[n] as string : undefined);
const ref = (s: string | undefined, what = 'a PR ref'): PrRef => {
  const r = s ? parsePrRef(s) : null;
  if (!r) throw new UsageError(`Expected ${what} (<owner>/<name>#<n> or a PR url): ${s ?? '(none)'}`);
  return r;
};
const readJsonFile = (file: string | undefined, name: string): unknown => {
  if (!file) throw new UsageError(`${name} needs --file <json>`);
  let text: string;
  try { text = readFileSync(resolve(file), 'utf8'); } catch { throw new UsageError(`Cannot read --file: ${file}`); }
  try { return JSON.parse(text.replace(/^﻿/, '')); } catch { throw new UsageError(`--file is not JSON: ${file}`); }
};

// ---- stack prs --sort spec-lines

/**
 * Adds `specLines` and `live` from the facts cache (read with `gh` per head SHA) to board rows, then drops Autopilot rows
 * and sorts fewest spec lines first. The PR page `prs` command calls this for `--sort spec-lines`.
 * @req FR:pr-review-lane/sort.cli
 */
export async function specSort<T extends { repo: string; number: number; labels: string[] }>(rows: T[], gh: Gh = ghRunner(), home = stackHome()): Promise<(T & { specLines: number | null; live: boolean })[]> {
  const keep = rows.filter((r) => !r.labels.some(isAutopilot));
  const facts = await new FactsStore(home).fetch(keep.map((r) => parsePrRef(`${r.repo}#${r.number}`)).filter((r): r is PrRef => !!r), gh);
  const by = new Map(facts.map((f) => [refKey(f), f]));
  return sortBySpecLines(keep.map((r) => { const f = by.get(refKey(r)); return { ...r, specLines: f ? f.specLines : null, live: !!f?.live }; }));
}

// ---- stack pr-pri brief

/** `stack pr-pri brief <ref> [--file f] [--agent a] [--refresh]`. The pr-priority command sends `brief` here. @req FR:pr-review-lane/brief.cli */
export async function briefCmd(p: Parsed, gh: Gh = ghRunner()): Promise<Outcome> {
  const [sub, target, extra] = p.positionals;
  if (sub !== 'brief') throw new UsageError(`Unknown pr-pri command: ${sub ?? '(none)'} (this build has: brief)`);
  if (extra !== undefined) throw new UsageError(`Unexpected argument: ${extra}`);
  const r = ref(target);
  const home = stackHome();
  const store = new BriefStore(home);
  const file = flag(p.flags, 'file');
  if (file !== undefined) {
    const input = readJsonFile(file, 'pr-pri brief');
    const { brief, words } = await store.put(input, r, flag(p.flags, 'agent'));
    return { json: { ok: true, brief, words }, text: `brief stored ${refText(r)} (${words} words)` };
  }
  const brief = store.get(r);
  if (!brief) return { json: { ok: false, error: `no brief for ${refText(r)}` }, text: `no brief for ${refText(r)}`, code: 1 };
  const facts = new FactsStore(home);
  if (p.flags['refresh'] === true) await facts.fetch([r], gh);
  const stale = isStale(brief, facts.get(r)?.headSha);
  const lines = [`${brief.url}${stale ? ' [stale]' : ''} (head ${brief.headSha.slice(0, 7)}, asked ${brief.askedAt.slice(0, 10)}${brief.by ? ` by ${brief.by}` : ''})`, `Problem: ${brief.problem}`, `Solution: ${brief.solution}`, `Recommendation: ${brief.recommendation}`, ...brief.evidence.map((e) => `Evidence: ${e}`)];
  return { json: { ok: true, brief: { ...brief, stale } }, text: lines.join('\n') };
}

// ---- stack live

const num = (v: string | undefined, name: string): number | undefined => {
  if (v === undefined) return undefined;
  if (!/^\d+$/.test(v)) throw new UsageError(`--${name} must be a whole number: ${v}`);
  return Number(v);
};

/** Maps lane errors to CLI exits: usage 2, not found 1, conflict 3, none 4. */
async function lane<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (e instanceof LiveError && e.code === 'usage') throw new UsageError(e.message);
    throw e;
  }
}
export const liveExit = (e: LiveError): number => ({ usage: 2, notfound: 1, conflict: 3, none: 4 })[e.code];

/**
 * `stack live [next|ready|state|checklist|item|resolve]`. Never touches a GitHub thread, label or review.
 * @req FR:pr-review-lane/lane.next @req FR:pr-review-lane/lane.ready @req FR:pr-review-lane/lane.state @req FR:pr-review-lane/lane.checklist
 * @req FR:pr-review-lane/lane.items @req FR:pr-review-lane/lane.resolve @req FR:pr-review-lane/lane.show @req FR:pr-review-lane/lane.pick
 */
export async function liveCmd(p: Parsed, gh: Gh = ghRunner()): Promise<Outcome> {
  const home = stackHome();
  const store = new LiveStore(home);
  const facts = new FactsStore(home);
  const offline = p.flags['offline'] === true;
  // Facts newer than 10 minutes are used as is; older or missing facts are read again. @req FR:pr-review-lane/lane.pick
  const fresh = (r: PrRef) => { const f = facts.get(r); return f && Date.now() - Date.parse(f.at) < 600_000 ? f : undefined; };
  const isLive = async (r: PrRef) => (fresh(r) ?? (await facts.fetch([r], gh, { offline }))[0])?.live === true;
  const info = (r: PrRef) => facts.get(r);
  const pick = () => pickNext(readQueue(home), { exclude: store.config().exclude, done: store.doneKeys() }, isLive);
  const [sub, ...rest] = p.positionals;
  const by = flag(p.flags, 'by') ?? 'owner';

  switch (sub) {
    case undefined: {
      const v = store.view();
      if (!v.active) return { json: { ok: true, ...v }, text: 'idle' };
      const counts = ITEM_STATES.map((s) => [s, v.items.filter((i) => i.state === s).length] as const).filter(([, n]) => n > 0).map(([s, n]) => `${s} ${n}`);
      return { json: { ok: true, ...v }, text: [`${v.active.url} ${v.active.state}${v.active.serverUrl ? ` ${v.active.serverUrl}` : ''}${v.active.waitingOnLock ? ` (waiting on lock: ${v.active.waitingOnLock})` : ''}`, `items: ${counts.join(', ') || 'none'}`].join('\n') };
    }
    case 'next': {
      if (rest.length > 1) throw new UsageError(`Unexpected argument: ${rest[1]}`);
      const r = rest[0] ? ref(rest[0]) : undefined;
      if (r && !offline) await facts.fetch([r], gh);
      const out = await lane(() => store.next({ ref: r, agent: flag(p.flags, 'agent'), worktree: flag(p.flags, 'worktree'), info }, pick));
      const a = out.active;
      const headSha = a.headSha ?? facts.get(a)?.headSha;
      const text = `${out.changed && a.claimedAt ? 'claimed' : 'live'} ${a.url} (${a.state})${out.lock ? `\nserver lock: held by ${out.lock}` : ''}`;
      return { json: { ok: true, ...out, ...(headSha ? { headSha } : {}) }, text };
    }
    case 'ready': {
      const r = ref(rest[0]);
      const url = flag(p.flags, 'url');
      if (!url) throw new UsageError('live ready needs --url <server url>');
      const pid = num(flag(p.flags, 'pid'), 'pid');
      if (pid === undefined) throw new UsageError('live ready needs --pid <server process id>');
      const a = await lane(() => store.ready(r, { url, port: num(flag(p.flags, 'port'), 'port'), pid, worktree: flag(p.flags, 'worktree'), head: facts.get(r)?.headSha }));
      return { json: { ok: true, active: a }, text: `ready ${a.url} at ${a.serverUrl} (${a.state})` };
    }
    case 'state': {
      const r = ref(rest[0]);
      const s = rest[1];
      if (s !== 'preparing' && s !== 'working') throw new UsageError('live state <ref> preparing|working');
      const a = await lane(() => store.setState(r, s));
      return { json: { ok: true, active: a }, text: `${a.url} ${a.state}` };
    }
    case 'checklist': {
      const r = ref(rest[0]);
      const raw = readJsonFile(flag(p.flags, 'file'), 'live checklist');
      const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' && Array.isArray((raw as { items?: unknown }).items) ? (raw as { items: unknown[] }).items : null;
      if (!list || !list.every((x) => x && typeof x === 'object' && typeof (x as { text?: unknown }).text === 'string')) throw new UsageError('--file must be [{text}] or {items: [{text}]}');
      const out = await lane(() => store.seed(r, list.map((x) => (x as { text: string }).text), flag(p.flags, 'agent') ?? 'agent'));
      return { json: { ok: true, ...out }, text: `seeded ${out.added} items` };
    }
    case 'item': {
      const [op, target, id] = rest;
      if (!op || !(ITEM_OPS as readonly string[]).includes(op)) throw new UsageError(`live item <${ITEM_OPS.join('|')}> <ref> [<id>]`);
      const r = ref(target);
      const out = await lane(() => store.item(r, op as ItemOp, { id, text: flag(p.flags, 'text'), reason: flag(p.flags, 'reason'), by }));
      return { json: { ok: true, ...out }, text: `${out.item.id} ${out.item.state}: ${out.item.text}` };
    }
    case 'resolve': {
      const r = ref(rest[0]);
      const out = await lane(() => store.resolve(r, flag(p.flags, 'reason') ?? 'done', pick, info));
      return { json: { ok: true, ...out }, text: `done ${out.done.url}\n${out.next ? `next ${out.next.url}` : 'next: none (idle)'}` };
    }
    default: throw new UsageError(`Unknown live command: ${sub} (use next, ready, state, checklist, item, resolve)`);
  }
}
