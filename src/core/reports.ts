/**
 * Status reports from agents: validated with a fixed schema and kept, the latest per agent and project, in a local
 * store under ~/.stack (live state, never git). Their asks are shown in Needs you. No LLM call.
 * @req FR:status-ingest/$report
 */
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import type { AskKind, AskPriority } from './asks';
import type { Need, NeedAnswer, NeedAnswerInput } from './needs-you';
import { NotFoundError } from './storage';

export const REPORT_ASK_KINDS = ['approve', 'review', 'go-do', 'answer'] as const satisfies readonly AskKind[];
const PRIORITIES = ['crit', 'high', 'normal', 'low'] as const satisfies readonly AskPriority[];
const SLUG = /^[a-z0-9][a-z0-9-]{0,23}$/;
const ISO = /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/;
/** Control, line-break and invisible format characters (ZWJ is kept so emoji sequences pass). */
const BAD_CHARS = new RegExp('[\\p{Cc}\\u0085\\u2028\\u2029]|(?!\\u200d)\\p{Cf}', 'u');
const LIMITS = { top: 3, asks: 10, blockers: 10, progress: 10 } as const;

export interface ReportItem { text: string; link?: string }
export interface ReportAsk {
  id: string; ask: string; link: string; by: string; kind: (typeof REPORT_ASK_KINDS)[number];
  recommend?: string; why?: string; default?: string; priority?: AskPriority;
}
export interface ReportInput { agent: string; project: string; top: ReportItem[]; asks: ReportAsk[]; blockers: ReportItem[]; progress: ReportItem[] }
/** One stored report. @req FR:status-ingest/$report */
export interface Report extends Omit<ReportInput, 'asks'> { at: string; writer: string; asks: (ReportAsk & { key: string; answer?: NeedAnswer })[] }
export interface ReportResult { agent: string; project: string; created: boolean; asks: { put: string[]; dropped: string[] } }
export interface Issue { field: string; message: string }

/** A report that fails the schema; `issues` lists every problem. */
export class ReportInvalid extends Error {
  constructor(readonly issues: Issue[]) { super(`invalid report: ${issues.map((i) => `${i.field}: ${i.message}`).join('; ')}`); }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isHttps = (v: string) => { try { return new URL(v).protocol === 'https:'; } catch { return false; } };

/**
 * Checks a report body against the schema and returns it with defaults, or throws one `ReportInvalid` with every issue.
 * @req FR:status-ingest/schema.body @req FR:status-ingest/schema.items @req FR:status-ingest/schema.asks
 * @req FR:status-ingest/schema.names @req FR:status-ingest/schema.text @req FR:status-ingest/schema.errors
 */
export function parseReport(body: unknown): ReportInput {
  const issues: Issue[] = [];
  const bad = (field: string, message: string) => { issues.push({ field, message }); };
  if (!isObj(body)) throw new ReportInvalid([{ field: 'body', message: 'Must be a JSON object' }]);
  const text = (field: string, v: unknown, max: number, required: boolean): string | undefined => {
    if (v === undefined) { if (required) bad(field, 'Required'); return undefined; }
    if (typeof v !== 'string') { bad(field, 'Must be a string'); return undefined; }
    if (BAD_CHARS.test(v)) { bad(field, 'Must be one line with no control or invisible characters'); return undefined; }
    const t = v.trim();
    if (!t) { bad(field, 'Must not be empty'); return undefined; }
    if (t.length > max) { bad(field, `Must be at most ${max} characters`); return undefined; }
    return t;
  };
  const link = (field: string, v: unknown, required: boolean): string | undefined => {
    if (v === undefined) { if (required) bad(field, 'Required'); return undefined; }
    if (typeof v !== 'string' || v.length > 2000 || /\s/.test(v) || BAD_CHARS.test(v) || !isHttps(v)) { bad(field, 'Must be an https url'); return undefined; }
    return v;
  };
  const slug = (field: string, v: unknown): string | undefined => {
    if (typeof v !== 'string' || !SLUG.test(v)) { bad(field, 'Must match [a-z0-9][a-z0-9-]{0,23}'); return undefined; }
    return v;
  };
  const unknown = (field: string, o: Record<string, unknown>, allowed: readonly string[]) => {
    for (const k of Object.keys(o)) if (!allowed.includes(k)) bad(field ? `${field}.${k}` : k, 'Unknown field');
  };
  const list = (name: keyof typeof LIMITS): unknown[] => {
    const v = body[name];
    if (v === undefined) return [];
    if (!Array.isArray(v)) { bad(name, 'Must be an array'); return []; }
    if (v.length > LIMITS[name]) { bad(name, `At most ${LIMITS[name]} items`); return []; }
    return v;
  };
  const items = (name: 'top' | 'blockers' | 'progress'): ReportItem[] => list(name).flatMap((raw, i) => {
    const f = `${name}[${i}]`;
    if (!isObj(raw)) { bad(f, 'Must be an object {text, link?}'); return []; }
    unknown(f, raw, ['text', 'link']);
    const t = text(`${f}.text`, raw.text, 200, true); const l = link(`${f}.link`, raw.link, false);
    return t ? [{ text: t, ...(l ? { link: l } : {}) }] : [];
  });

  unknown('', body, ['agent', 'project', 'top', 'asks', 'blockers', 'progress']);
  const agent = slug('agent', body.agent); const project = slug('project', body.project);
  const top = items('top');
  const ids = new Set<string>();
  const asks = list('asks').flatMap((raw, i): ReportAsk[] => {
    const f = `asks[${i}]`;
    if (!isObj(raw)) { bad(f, 'Must be an object'); return []; }
    let id: string | undefined;
    if (raw.id === undefined) bad(`${f}.id`, 'Required');
    else if (typeof raw.id !== 'string' || !SLUG.test(raw.id)) bad(`${f}.id`, 'Must match [a-z0-9][a-z0-9-]{0,23}');
    else if (ids.has(raw.id)) bad(`${f}.id`, 'Must be unique in the report');
    else { id = raw.id; ids.add(id); }
    const ask = text(`${f}.ask`, raw.ask, 200, true);
    const l = link(`${f}.link`, raw.link, true);
    let by: string | undefined;
    if (raw.by === undefined) bad(`${f}.by`, 'Required');
    else if (typeof raw.by !== 'string' || !ISO.test(raw.by) || Number.isNaN(Date.parse(raw.by))) bad(`${f}.by`, 'Must be an ISO date or date-time');
    else by = raw.by;
    let kind: ReportAsk['kind'] = 'answer';
    if (raw.kind !== undefined) { if ((REPORT_ASK_KINDS as readonly unknown[]).includes(raw.kind)) kind = raw.kind as ReportAsk['kind']; else bad(`${f}.kind`, `Must be one of ${REPORT_ASK_KINDS.join(', ')}`); }
    let priority: AskPriority | undefined;
    if (raw.priority !== undefined) { if ((PRIORITIES as readonly unknown[]).includes(raw.priority)) priority = raw.priority as AskPriority; else bad(`${f}.priority`, `Must be one of ${PRIORITIES.join(', ')}`); }
    const recommend = text(`${f}.recommend`, raw.recommend, 200, false);
    const why = text(`${f}.why`, raw.why, 500, false);
    const dflt = text(`${f}.default`, raw.default, 200, false);
    unknown(f, raw, ['id', 'ask', 'link', 'by', 'kind', 'recommend', 'why', 'default', 'priority']);
    if (!id || !ask || !l || !by) return [];
    return [{ id, ask, link: l, by, kind, ...(recommend ? { recommend } : {}), ...(why ? { why } : {}), ...(dflt ? { default: dflt } : {}), ...(priority ? { priority } : {}) }];
  });
  const blockers = items('blockers'); const progress = items('progress');
  if (issues.length || !agent || !project) throw new ReportInvalid(issues);
  return { agent, project, top, asks, blockers, progress };
}

/** `~/.stack`, or `STACK_HOME` when set: live state owned by the desktop host, never in git. @req FR:status-ingest/store.path */
export const stackHome = (env: NodeJS.ProcessEnv = process.env, home = homedir()): string => env.STACK_HOME || join(home, '.stack');

/** The ask key of one report ask. @req FR:status-ingest/asks.key */
export const reportAskKey = (agent: string, project: string, id: string): string => `rp.${agent}.${project}.${id}`;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The live report store: one JSON file (`reports.json`) in the Stack home, written atomically (temp file and rename)
 * under a single-writer lock file (`reports.lock`). Reads need no lock.
 * @req FR:status-ingest/store.path @req FR:status-ingest/store.atomic @req FR:status-ingest/store.lock
 */
export class ReportStore {
  readonly file: string;
  private readonly lockFile: string;
  constructor(readonly dir: string, private readonly o: { now?: () => Date; lockWaitMs?: number; staleMs?: number } = {}) {
    this.file = join(dir, 'reports.json');
    this.lockFile = join(dir, 'reports.lock');
  }

  private read(): ReportsFile {
    let text: string;
    try { text = readFileSync(this.file, 'utf8'); } catch { return { reports: {} }; }
    try {
      const raw = JSON.parse(text.replace(/^\uFEFF/, '')) as Partial<ReportsFile>;
      return { reports: isObj(raw.reports) ? raw.reports as Record<string, Report> : {} };
    } catch { return { reports: {} }; }
  }

  private write(data: ReportsFile): void {
    const tmp = `${this.file}.${process.pid}.${Date.now()}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(data, null, 2)}\n`, { mode: 0o600 });
    renameSync(tmp, this.file);
  }

  /** Runs `fn` while holding the lock file; a lock older than `staleMs` (a crashed writer) is taken over. */
  private async locked<T>(fn: () => T): Promise<T> {
    mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    const deadline = Date.now() + (this.o.lockWaitMs ?? 5000);
    for (;;) {
      try { closeSync(openSync(this.lockFile, 'wx')); break; } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        try { if (Date.now() - statSync(this.lockFile).mtimeMs > (this.o.staleMs ?? 30_000)) { unlinkSync(this.lockFile); continue; } } catch { continue; }
        if (Date.now() > deadline) throw new ReportBusy('Report store is busy (reports.lock); try again');
        await sleep(25);
      }
    }
    try { return fn(); } finally { try { unlinkSync(this.lockFile); } catch { /* already gone */ } }
  }

  /** Every stored report, newest first; none for a missing or broken file. @req FR:status-ingest/store.read */
  list(): Report[] {
    return Object.values(this.read().reports).filter((r) => isObj(r) && typeof r.at === 'string' && Array.isArray(r.asks)).sort((x, y) => y.at.localeCompare(x.at));
  }

  /**
   * Validates and stores a report, replacing the prior one for the pair. Owner answers on asks the report still lists are kept.
   * `opts.writer` names a token caller, which may replace only reports it wrote.
   * @req FR:status-ingest/store.replace @req FR:status-ingest/asks.answer.keep @req FR:status-ingest/asks.result @req FR:status-ingest/auth.writer
   */
  async put(body: unknown, actor: string, opts: { writer?: string } = {}): Promise<ReportResult> {
    const r = parseReport(body);
    const pair = `${r.agent}/${r.project}`;
    return this.locked(() => {
      const data = this.read();
      const prior = data.reports[pair];
      if (opts.writer && prior?.writer && prior.writer !== opts.writer) throw new ReportDenied('Only the agent that wrote this report can replace it');
      const answers = new Map((Array.isArray(prior?.asks) ? prior.asks : []).filter((a) => a?.answer).map((a) => [a.key, a.answer!]));
      const asks = r.asks.map((a) => { const key = reportAskKey(r.agent, r.project, a.id); const ans = answers.get(key); return { ...a, key, ...(ans ? { answer: ans } : {}) }; });
      const keep = new Set(asks.map((a) => a.key));
      const dropped = (Array.isArray(prior?.asks) ? prior.asks : []).map((a) => a?.key).filter((k): k is string => typeof k === 'string' && !keep.has(k));
      // The first writer keeps the pair, even when the owner writes it later.
      data.reports[pair] = { ...r, asks, at: (this.o.now ?? (() => new Date()))().toISOString(), writer: prior?.writer ?? opts.writer ?? actor };
      this.write(data);
      return { agent: r.agent, project: r.project, created: !prior, asks: { put: asks.map((a) => a.key), dropped } };
    });
  }

  /** Report asks as Needs you items, newest report first. @req FR:status-ingest/needs.list */
  needs(): Need[] {
    return this.list().flatMap((r) => r.asks.filter((a) => typeof a?.key === 'string').map((a): Need => ({
      id: a.key, title: a.ask, recommendation: a.recommend ?? 'Open the link and decide', link: a.link, project: r.project,
      ...(a.default ? { default: a.default } : {}), ...(a.by ? { by: a.by } : {}), ...(a.answer ? { answer: a.answer } : {}),
    })));
  }

  /** Records (or with `undo` clears) the owner's answer on a report ask. @req FR:status-ingest/needs.answer */
  async answer(key: string, input: NeedAnswerInput): Promise<void> {
    await this.locked(() => {
      const data = this.read();
      const ask = Object.values(data.reports).flatMap((r) => (isObj(r) && Array.isArray(r.asks) ? r.asks : [])).find((a) => a?.key === key);
      if (!ask) throw new NotFoundError(`Unknown report ask: ${key}`);
      if (input.choice === 'undo') delete ask.answer;
      else ask.answer = { choice: input.choice, at: (this.o.now ?? (() => new Date()))().toISOString(), ...(input.text ? { text: input.text } : {}), ...(input.until ? { until: input.until } : {}) };
      this.write(data);
    });
  }
}

/** Another writer held the lock too long. */
export class ReportBusy extends Error {}
/** A token tried to replace a report another token wrote; the message is fixed text. */
export class ReportDenied extends Error {}

interface ReportsFile { reports: Record<string, Report> }

/** Where a running host listens: `<home>/host.json`, written by the desktop host on start. @req FR:status-ingest/host.file */
export interface HostFile { url: string; pid: number }
export const hostFilePath = (dir: string): string => join(dir, 'host.json');

/** The host url from `host.json`, or null when there is none or it is broken. @req FR:status-ingest/host.file */
export function readHostFile(dir: string): HostFile | null {
  try {
    const h = JSON.parse(readFileSync(hostFilePath(dir), 'utf8')) as Partial<HostFile>;
    return typeof h.url === 'string' && /^http:\/\/127\.0\.0\.1:\d{1,5}$/.test(h.url) && typeof h.pid === 'number' ? { url: h.url, pid: h.pid } : null;
  } catch { return null; }
}

/** Writes `host.json` (atomic) and returns a function that removes it if it still names this host. @req FR:status-ingest/host.file */
export function writeHostFile(dir: string, h: HostFile): () => void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const f = hostFilePath(dir);
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(h)}\n`, { mode: 0o600 });
  renameSync(tmp, f);
  return () => { try { if (readHostFile(dir)?.url === h.url) unlinkSync(f); } catch { /* gone */ } };
}
