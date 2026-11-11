/**
 * The owner's ordered priorities: `<home>/pris.json` (live state under ~/.stack, never git), seeded once from markdown.
 * @req FR:session-inventory/$pri
 */
import { createHash } from 'crypto';
import { mkdirSync, readFileSync, renameSync } from 'fs';
import { join } from 'path';
import { withFileLock, writeAtomic, type LockOptions } from './file-lock';
import type { Issue } from './reports';

export const PRI_STATUSES = ['active', 'paused', 'blocked', 'done'] as const;
export const PRI_ITEM_STATUSES = ['todo', 'doing', 'blocked', 'done'] as const;
const LIMITS = { pris: 30, items: 20, backlog: 50, weekly: 12 } as const;
const SLUG = /^[a-z0-9][a-z0-9-]{0,23}$/;
const WEEK = /^\d{4}-W(0[1-9]|[1-4]\d|5[0-3])$/;
const BAD_CHARS = new RegExp('[\\p{Cc}\\u0085\\u2028\\u2029]|(?!\\u200d)\\p{Cf}', 'u');

export interface PriItem { text: string; status: (typeof PRI_ITEM_STATUSES)[number] }
export interface Pri {
  id: string; title: string; status: (typeof PRI_STATUSES)[number];
  items: PriItem[]; backlog: PriItem[]; weekly: { week: string; text: string }[];
}
export interface PrisFile { version: 1; rev: number; updatedAt?: string; seed?: { source: string; at: string; sha256: string }; pris: Pri[] }

/** A priority list that fails the schema; `issues` lists every problem. */
export class PrisInvalid extends Error {
  constructor(readonly issues: Issue[]) { super(`invalid priorities: ${issues.map((i) => `${i.field}: ${i.message}`).join('; ')}`); }
}
/** The `rev` sent is not the current one. */
export class PrisConflict extends Error {}
/** Another writer held `pris.lock` too long. */
export class PrisBusy extends Error {}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * Checks a priority list and returns it, or throws one `PrisInvalid` with every issue.
 * @req FR:session-inventory/pris.model @req FR:session-inventory/pris.validate
 */
export function parsePris(body: unknown): Pri[] {
  const issues: Issue[] = [];
  const bad = (field: string, message: string) => { issues.push({ field, message }); };
  if (!Array.isArray(body)) throw new PrisInvalid([{ field: 'pris', message: 'Must be an array' }]);
  if (body.length > LIMITS.pris) throw new PrisInvalid([{ field: 'pris', message: `At most ${LIMITS.pris} items` }]);
  const text = (f: string, v: unknown, max: number): string | undefined => {
    if (typeof v !== 'string') { bad(f, 'Must be a string'); return undefined; }
    if (BAD_CHARS.test(v)) { bad(f, 'Must be one line with no control or invisible characters'); return undefined; }
    const t = v.trim();
    if (!t) { bad(f, 'Must not be empty'); return undefined; }
    if (t.length > max) { bad(f, `Must be at most ${max} characters`); return undefined; }
    return t;
  };
  const oneOf = <T extends string>(f: string, v: unknown, values: readonly T[]): T | undefined => {
    if ((values as readonly unknown[]).includes(v)) return v as T;
    bad(f, `Must be one of ${values.join(', ')}`); return undefined;
  };
  const unknown = (f: string, o: Record<string, unknown>, allowed: readonly string[]) => { for (const k of Object.keys(o)) if (!allowed.includes(k)) bad(`${f}.${k}`, 'Unknown field'); };
  const list = (f: string, v: unknown, max: number): unknown[] => {
    if (v === undefined) return [];
    if (!Array.isArray(v)) { bad(f, 'Must be an array'); return []; }
    if (v.length > max) { bad(f, `At most ${max} items`); return []; }
    return v;
  };
  const items = (f: string, v: unknown, max: number): PriItem[] => list(f, v, max).flatMap((raw, i) => {
    const g = `${f}[${i}]`;
    if (!isObj(raw)) { bad(g, 'Must be an object {text, status}'); return []; }
    unknown(g, raw, ['text', 'status']);
    const t = text(`${g}.text`, raw.text, 300); const s = oneOf(`${g}.status`, raw.status, PRI_ITEM_STATUSES);
    return t && s ? [{ text: t, status: s }] : [];
  });
  const ids = new Set<string>();
  const out = body.flatMap((raw, i): Pri[] => {
    const f = `[${i}]`;
    if (!isObj(raw)) { bad(f, 'Must be an object'); return []; }
    unknown(f, raw, ['id', 'title', 'status', 'items', 'backlog', 'weekly']);
    let id: string | undefined;
    if (typeof raw.id !== 'string' || !SLUG.test(raw.id)) bad(`${f}.id`, 'Must match [a-z0-9][a-z0-9-]{0,23}');
    else if (ids.has(raw.id)) bad(`${f}.id`, 'Must be unique');
    else { id = raw.id; ids.add(id); }
    const title = text(`${f}.title`, raw.title, 200);
    const status = oneOf(`${f}.status`, raw.status, PRI_STATUSES);
    const its = items(`${f}.items`, raw.items, LIMITS.items);
    const backlog = items(`${f}.backlog`, raw.backlog, LIMITS.backlog);
    const weekly = list(`${f}.weekly`, raw.weekly, LIMITS.weekly).flatMap((w, j) => {
      const g = `${f}.weekly[${j}]`;
      if (!isObj(w)) { bad(g, 'Must be an object {week, text}'); return []; }
      unknown(g, w, ['week', 'text']);
      const week = typeof w.week === 'string' && WEEK.test(w.week) ? w.week : (bad(`${g}.week`, 'Must be an ISO week YYYY-Www'), undefined);
      const t = text(`${g}.text`, w.text, 500);
      return week && t ? [{ week, text: t }] : [];
    });
    for (let j = 1; j < weekly.length; j++) if (weekly[j].week >= weekly[j - 1].week) { bad(`${f}.weekly`, 'Must be newest first, one entry per week'); break; }
    return id && title && status ? [{ id, title, status, items: its, backlog, weekly }] : [];
  });
  if (issues.length) throw new PrisInvalid(issues);
  return out;
}

/** Splits `s` at each match of `sep` that is outside parentheses. */
function splitOutside(s: string, sep: RegExp): string[] {
  const parts: string[] = [];
  let depth = 0; let start = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '(') depth++;
    else if (c === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      const m = sep.exec(s.slice(i));
      if (m && m.index === 0) { parts.push(s.slice(start, i)); i += m[0].length - 1; start = i + 1; }
    }
  }
  parts.push(s.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}
const clean = (s: string) => s.replace(/^\d+\.\d+\s+/, '').replace(/\.$/, '').trim();

/**
 * Priorities from markdown: each numbered line `N. ...` is one priority with id `p<N>`.
 * @req FR:session-inventory/pris.seed
 */
export function parsePrisMarkdown(md: string): Pri[] {
  const seen = new Set<string>();
  return md.split(/\r?\n/).flatMap((l): Pri[] => {
    const m = /^(\d+)\.\s+(.+)$/.exec(l.trim());
    // A later list that reuses a number is not a new priority: the first line with each number wins.
    if (!m || seen.has(m[1])) return [];
    seen.add(m[1]);
    const body = m[2].trim();
    const colon = splitOutside(body, /^:\s/);
    let title: string; let rest: string;
    if (colon.length > 1) { title = colon[0]; rest = body.slice(body.indexOf(colon[1], colon[0].length)); } else {
      const semi = splitOutside(body, /^;\s*/);
      title = semi[0]; rest = semi.slice(1).join('; ');
    }
    let parts = splitOutside(rest, /^(;\s*|\.\s+(?=[A-Z]))/);
    if (colon.length > 1 && parts.length === 1) parts = splitOutside(parts[0], /^,\s/);
    const items = parts.map(clean).filter(Boolean).map((text): PriItem => ({ text, status: 'todo' }));
    return [{ id: `p${m[1]}`, title: clean(title), status: 'active', items, backlog: [], weekly: [] }];
  });
}

const EMPTY: PrisFile = { version: 1, rev: 0, pris: [] };

/**
 * The priorities store: `<dir>/pris.json`, written atomically under `pris.lock`.
 * @req FR:session-inventory/pris.write
 */
export class PriStore {
  readonly file: string;
  constructor(readonly dir: string, private readonly o: LockOptions & { now?: () => Date } = {}) { this.file = join(dir, 'pris.json'); }

  private load(): { data: PrisFile; exists: boolean; broken?: boolean } {
    let t: string;
    try { t = readFileSync(this.file, 'utf8'); } catch { return { data: { ...EMPTY, pris: [] }, exists: false }; }
    try {
      const j = JSON.parse(t) as Partial<PrisFile>;
      if (isObj(j) && Array.isArray(j.pris) && typeof j.rev === 'number') return { data: j as PrisFile, exists: true };
    } catch { /* broken */ }
    return { data: { ...EMPTY, pris: [] }, exists: true, broken: true };
  }

  /** The stored file, or an empty list (rev 0) when none or broken. @req FR:session-inventory/api.pris.get */
  read(): PrisFile { return this.load().data; }

  private save(d: PrisFile): PrisFile {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const next: PrisFile = { ...d, version: 1, rev: d.rev + 1, updatedAt: (this.o.now ?? (() => new Date()))().toISOString() };
    writeAtomic(this.file, `${JSON.stringify(next, null, 2)}\n`);
    return next;
  }
  private locked<T>(fn: () => T): Promise<T> {
    return withFileLock(this.dir, 'pris.lock', fn, () => new PrisBusy('Priorities store is busy (pris.lock); try again'), this.o);
  }

  /** Replaces the list when `rev` is current. @req FR:session-inventory/pris.write @req FR:session-inventory/api.pris.put */
  async put(rev: number, body: unknown): Promise<PrisFile> {
    const pris = parsePris(body);
    return this.locked(() => {
      const { data: cur, broken } = this.load();
      if (cur.rev !== rev) throw new PrisConflict(`Priorities changed (rev ${cur.rev}); reload and try again`);
      // A broken file is moved aside, never silently overwritten. @req FR:session-inventory/pris.broken
      if (broken) renameSync(this.file, `${this.file}.broken-${Date.now()}`);
      return this.save({ ...cur, pris });
    });
  }

  /** Seeds from markdown only when no `pris.json` exists. @req FR:session-inventory/pris.seed.once */
  async seed(source: string): Promise<{ seeded: boolean; count: number }> {
    const md = readFileSync(source, 'utf8');
    return this.locked(() => {
      const cur = this.load();
      if (cur.exists) return { seeded: false, count: cur.data.pris.length };
      const pris = parsePris(parsePrisMarkdown(md));
      const at = (this.o.now ?? (() => new Date()))().toISOString();
      this.save({ ...EMPTY, pris, seed: { source, at, sha256: createHash('sha256').update(md).digest('hex') } });
      return { seeded: true, count: pris.length };
    });
  }
}
