/**
 * A fast index of the local Claude session store (`<config>/projects/<cwd>/<id>.jsonl`): file stats for the list, head and tail samples for
 * identity, and an append-only usage scan that runs in the background one file at a time and re-reads only the bytes added since the last
 * scan. The SDK's own lister parses every transcript on every call (measured: 70 s for 7,000 sessions, 6 GB), so the list is built here and
 * the SDK keeps transcripts and runs.
 * @req FR:agent-sessions/driver.sdk @req FR:agent-sessions/driver.cost
 */
import { openSync, readdirSync, readSync, closeSync, statSync } from 'fs';
import { join } from 'path';
import { oneLine } from '../core/asks';
import { projectOf, type Cost, type Session } from './driver';

export interface StoreOptions {
  configDir: string; now?: () => Date; activeMs?: number;
  /** Bytes read per background step; a file larger than this is scanned over several steps. */
  stepBytes?: number;
  /** Run the scan queue (default true); tests call `scanAll()` instead. */
  background?: boolean;
}
export interface StoreEntry { id: string; path: string; mtime: number; size: number }
export interface Identity { title: string; cwd: string; branch?: string; sidechain: boolean; prs: string[] }
export interface Usage { byModel: Record<string, { usd: number; tokens: number }>; usd: number; priced: boolean }

/**
 * List prices per million tokens (input, output, cache write for 5 minutes and 1 hour, cache read), from platform.claude.com/docs/en/about-claude/pricing
 * on 2026-10-29. Haiku 5.5 uses its under-100k-token tier. A model not listed adds tokens but no dollars and marks the session approximate.
 */
export const PRICES: Record<string, { in: number; out: number; write: number; write1h: number; read: number }> = {
  'claude-fable-5-1': { in: 10, out: 50, write: 12.5, write1h: 20, read: 0.25 }, 'claude-mythos-5-1': { in: 10, out: 50, write: 12.5, write1h: 20, read: 0.25 },
  'claude-fable-5': { in: 10, out: 50, write: 12.5, write1h: 20, read: 1 }, 'claude-mythos-5': { in: 10, out: 50, write: 12.5, write1h: 20, read: 1 },
  'claude-opus-5-5': { in: 4, out: 20, write: 5, write1h: 8, read: 0.2 },
  'claude-opus-5': { in: 5, out: 25, write: 6.25, write1h: 10, read: 0.5 }, 'claude-opus-4-8': { in: 5, out: 25, write: 6.25, write1h: 10, read: 0.5 }, 'claude-opus-4-7': { in: 5, out: 25, write: 6.25, write1h: 10, read: 0.5 },
  'claude-opus-4-6': { in: 5, out: 25, write: 6.25, write1h: 10, read: 0.5 }, 'claude-opus-4-5': { in: 5, out: 25, write: 6.25, write1h: 10, read: 0.5 },
  'claude-opus-4-1': { in: 15, out: 75, write: 18.75, write1h: 30, read: 1.5 }, 'claude-opus-4': { in: 15, out: 75, write: 18.75, write1h: 30, read: 1.5 },
  'claude-sonnet-5-5': { in: 2, out: 10, write: 2.5, write1h: 4, read: 0.1 }, 'claude-sonnet-5': { in: 2, out: 10, write: 2.5, write1h: 4, read: 0.2 },
  'claude-sonnet-4-6': { in: 3, out: 15, write: 3.75, write1h: 6, read: 0.3 }, 'claude-sonnet-4-5': { in: 3, out: 15, write: 3.75, write1h: 6, read: 0.3 },
  'claude-haiku-5-5': { in: 0.1, out: 0.5, write: 0.125, write1h: 0.2, read: 0.01 }, 'claude-haiku-4-5': { in: 1, out: 5, write: 1.25, write1h: 2, read: 0.1 }, 'claude-haiku-3-5': { in: 0.8, out: 4, write: 1, write1h: 1.6, read: 0.08 },
};
/** `claude-haiku-4-5-20251001` prices as `claude-haiku-4-5`. */
export const priceFor = (model: string) => PRICES[model] ?? PRICES[model.replace(/-\d{8}$/, '')];

const HEAD = 64 * 1024;
const TAIL = 256 * 1024;
const TITLE = 80;
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const round = (n: number) => Math.round(n * 1e6) / 1e6;
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);
const EMPTY_USAGE = (): Usage => ({ byModel: {}, usd: 0, priced: true });

function readWindow(path: string, size: number, start: number, len: number): string {
  const n = Math.max(0, Math.min(len, size - start));
  if (n === 0) return '';
  const fd = openSync(path, 'r');
  try { const b = Buffer.alloc(n); readSync(fd, b, 0, n, start); return b.toString('utf8'); } finally { closeSync(fd); }
}
const first = (text: string, re: RegExp): string | undefined => re.exec(text)?.[1];
const last = (text: string, re: RegExp): string | undefined => { let m: RegExpExecArray | null; let out: string | undefined; const g = new RegExp(re.source, 'g'); while ((m = g.exec(text))) out = m[1]; return out; };
const unjson = (s: string): string => { try { return JSON.parse(`"${s}"`) as string; } catch { return s; } };

/** The owner's first words: the first user record's text without system reminders. */
function firstPrompt(head: string): string {
  for (const line of head.split('\n')) {
    if (!line.includes('"type":"user"')) continue;
    let r: { message?: { content?: unknown }; isMeta?: boolean };
    try { r = JSON.parse(line) as typeof r; } catch { continue; }
    if (r.isMeta) continue;
    const c = r.message?.content;
    const text = typeof c === 'string' ? c : Array.isArray(c) ? (c as { type?: string; text?: string }[]).filter((b) => b.type === 'text' && typeof b.text === 'string').map((b) => b.text).join(' ') : '';
    const clean = text.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>/g, '').trim();
    if (clean) return clean;
  }
  return '';
}

/** Identity from a head and a tail sample. */
export function readIdentity(path: string, size: number): Identity {
  const head = readWindow(path, size, 0, HEAD);
  const tail = size > HEAD + TAIL ? readWindow(path, size, size - TAIL, TAIL) : size > HEAD ? readWindow(path, size, HEAD, size - HEAD) : '';
  const both = head + tail;
  const cwd = unjson(first(head, /"cwd":"((?:[^"\\]|\\.)*)"/) ?? '');
  const branch = unjson(first(head, /"gitBranch":"((?:[^"\\]|\\.)*)"/) ?? '') || undefined;
  const top = head.slice(0, 4000);
  const sidechain = /"isSidechain":true/.test(top) && !/"isSidechain":false/.test(top);
  const customTitle = last(both, /"type":"custom-title","customTitle":"((?:[^"\\]|\\.)*)"/) ?? last(both, /"customTitle":"((?:[^"\\]|\\.)*)"/);
  const title = cut(oneLine(unjson(customTitle ?? '') || firstPrompt(head) || path.replace(/^.*\//, '').slice(0, 8)), TITLE);
  const prs: string[] = [];
  for (const m of both.matchAll(/"type":"pr-link"[^\n]*?"prUrl":"(https:\/\/github\.com\/[^"]+)"/g)) if (!prs.includes(m[1]) && prs.length < 5) prs.push(m[1]);
  return { title, cwd, branch, sidechain, prs };
}

/** Cost from a `cost-state` record (the CLI's own accounting up to that point). */
function costState(line: string): Usage | null {
  try {
    const r = JSON.parse(line) as { totalCostUSD?: unknown; modelUsage?: Record<string, Record<string, unknown>> };
    if (!r.modelUsage) return null;
    const byModel: Usage['byModel'] = {};
    for (const [m, u] of Object.entries(r.modelUsage)) byModel[m] = { usd: round(num(u.costUSD)), tokens: num(u.inputTokens) + num(u.outputTokens) + num(u.cacheReadInputTokens) + num(u.cacheCreationInputTokens) };
    return { byModel, usd: round(num(r.totalCostUSD)), priced: true };
  } catch { return null; }
}

function add(into: Usage, more: Usage): Usage {
  const byModel = { ...into.byModel };
  for (const [m, v] of Object.entries(more.byModel)) { const cur = byModel[m] ?? { usd: 0, tokens: 0 }; byModel[m] = { usd: round(cur.usd + v.usd), tokens: cur.tokens + v.tokens }; }
  return { byModel, usd: round(into.usd + more.usd), priced: into.priced && more.priced };
}

/**
 * Sums assistant usage over whole lines of `text` with a line scan (no JSON parsing): per model, tokens and the list-price estimate.
 * A `cost-state` line resets the running total to the CLI's own figure. Synthetic model names are skipped.
 */
export function scanUsage(text: string): Usage {
  let total = EMPTY_USAGE();
  let at = 0;
  for (;;) {
    const nl = text.indexOf('\n', at);
    const line = text.slice(at, nl < 0 ? text.length : nl);
    if (line.startsWith('{"type":"cost-state"')) { const s = costState(line); if (s) total = s; }
    else if (line.includes('"type":"assistant"')) {
      const u = line.indexOf('"usage":{');
      const model = first(line, /"model":"([^"]+)"/) ?? 'unknown';
      if (u >= 0 && !model.startsWith('<')) {
        const seg = line.slice(u, u + 600);
        const inT = Number(first(seg, /"input_tokens":(\d+)/) ?? 0), outT = Number(first(seg, /"output_tokens":(\d+)/) ?? 0);
        const cr = Number(first(seg, /"cache_read_input_tokens":(\d+)/) ?? 0), cw = Number(first(seg, /"cache_creation_input_tokens":(\d+)/) ?? 0);
        const cw1h = Math.min(cw, Number(first(seg, /"ephemeral_1h_input_tokens":(\d+)/) ?? 0));
        const p = priceFor(model);
        const usd = p ? (inT * p.in + outT * p.out + (cw - cw1h) * p.write + cw1h * p.write1h + cr * p.read) / 1e6 : 0;
        total = add(total, { byModel: { [model]: { usd: round(usd), tokens: inT + outT + cr + cw } }, usd: round(usd), priced: !!p });
      }
    }
    if (nl < 0) break;
    at = nl + 1;
  }
  return total;
}

interface Cached {
  mtime: number; size: number; identity: Identity;
  /** Bytes scanned so far (always at a line boundary) and the usage up to there. */
  scanned: number; usage: Usage;
}
export interface StoreIndex {
  /** Sessions newest first (identity from samples, cost from the scan so far); only the newest `limit` files are touched. */
  list(o?: { limit?: number; sinceMs?: number }): Session[];
  entries(): StoreEntry[];
  /** Files whose scan has not caught up with their size. */
  pending(): number;
  /** Scans every queued file to the end now (tests and one-shot commands). */
  scanAll(): void;
}

export function createStoreIndex(o: StoreOptions): StoreIndex {
  const now = o.now ?? (() => new Date());
  const activeMs = o.activeMs ?? 120_000;
  const stepBytes = o.stepBytes ?? 4 * 1024 * 1024;
  const root = join(o.configDir, 'projects');
  const cache = new Map<string, Cached>();
  const queue: StoreEntry[] = [];
  let pumping = false;

  function entries(): StoreEntry[] {
    const out: StoreEntry[] = [];
    let dirs: string[] = [];
    try { dirs = readdirSync(root); } catch { return out; }
    for (const d of dirs) {
      if (d.startsWith('.')) continue;
      let files: string[] = [];
      try { files = readdirSync(join(root, d)); } catch { continue; }
      for (const f of files) {
        if (!f.endsWith('.jsonl')) continue;
        const path = join(root, d, f);
        try { const st = statSync(path); if (st.isFile() && st.size > 0) out.push({ id: f.slice(0, -6), path, mtime: st.mtimeMs, size: st.size }); } catch { /* vanished */ }
      }
    }
    return out.sort((a, b) => b.mtime - a.mtime);
  }

  /** Identity for an entry, re-sampled when the file changed; the usage scan is queued, not done here. */
  function touch(e: StoreEntry): Cached {
    const hit = cache.get(e.path);
    if (hit && hit.mtime === e.mtime && hit.size === e.size) return hit;
    const identity = readIdentity(e.path, e.size);
    const next: Cached = hit && e.size >= hit.scanned
      ? { ...hit, mtime: e.mtime, size: e.size, identity }
      : { mtime: e.mtime, size: e.size, identity, scanned: 0, usage: EMPTY_USAGE() };
    cache.set(e.path, next);
    if (next.scanned < next.size && !queue.some((q) => q.path === e.path)) queue.push(e);
    return next;
  }

  /** One scan step: up to `stepBytes` of appended text, cut at the last line end. */
  function step(e: StoreEntry): void {
    const c = cache.get(e.path);
    if (!c || c.scanned >= c.size) return;
    let text: string;
    try { text = readWindow(e.path, c.size, c.scanned, Math.min(stepBytes, c.size - c.scanned)); } catch { c.scanned = c.size; return; }
    const end = c.scanned + Buffer.byteLength(text) >= c.size ? text.length : text.lastIndexOf('\n') + 1;
    if (end <= 0) { c.scanned = c.size; return; }
    c.usage = add(c.usage, scanUsage(text.slice(0, end)));
    c.scanned += Buffer.byteLength(text.slice(0, end));
  }

  function pump(): void {
    if (pumping || o.background === false) return;
    pumping = true;
    const run = () => {
      const e = queue[0];
      if (!e) { pumping = false; return; }
      step(e);
      const c = cache.get(e.path);
      if (!c || c.scanned >= c.size) queue.shift();
      setImmediate(run);
    };
    setImmediate(run);
  }

  function list(q: { limit?: number; sinceMs?: number } = {}): Session[] {
    const t = now().getTime();
    const limit = q.limit ?? 50;
    const out: Session[] = [];
    for (const e of entries()) {
      if (q.sinceMs !== undefined && e.mtime < q.sinceMs) break;
      if (out.length >= limit) break;
      const c = touch(e);
      if (c.identity.sidechain) continue;
      const i = c.identity;
      const tokens = Object.values(c.usage.byModel).reduce((n, m) => n + m.tokens, 0);
      const cost: Cost = { usd: c.usage.usd, tokens, byModel: c.usage.byModel, ...(c.scanned < c.size || !c.usage.priced ? { approx: true } : {}) };
      out.push({ id: e.id, title: i.title, project: projectOf(i.cwd), cwd: i.cwd, branch: i.branch, lastActive: new Date(e.mtime).toISOString(), active: t - e.mtime < activeMs, cost, prs: i.prs });
    }
    pump();
    return out;
  }

  return {
    list, entries,
    pending: () => queue.length,
    scanAll() { while (queue.length) { const e = queue[0]; step(e); const c = cache.get(e.path); if (!c || c.scanned >= c.size) queue.shift(); } },
  };
}
