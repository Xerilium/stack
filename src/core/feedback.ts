/**
 * Owner feedback from the app: one JSON line per item in `<stack home>/feedback.jsonl`, append-only, for an agent session to tail.
 * See docs/feedback.md. @req FR:feedback-button/store.path
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeSync, fsyncSync } from 'fs';
import { randomBytes } from 'crypto';
import { join } from 'path';
import { withFileLock, writeAtomic } from './file-lock';

export interface FeedbackItem {
  id: string; at: string; text: string;
  route?: string; viewport?: string; theme?: 'light' | 'dark';
  appVersion?: string; sha?: string; screenshotPath?: string;
}
export interface FeedbackInput { text: string; route?: string; viewport?: string; theme?: 'light' | 'dark' }
export interface FeedbackOptions { now?: () => Date; app?: { appVersion?: string; sha?: string }; maxPngBytes?: number }

export class FeedbackError extends Error { constructor(m: string, readonly code: 'invalid' | 'not_found' | 'busy' = 'invalid') { super(m); this.name = 'FeedbackError'; } }

export const MAX_TEXT = 4000;
export const MAX_PNG_BYTES = 700 * 1024;
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const FILE = 'feedback.jsonl';
const DONE = 'feedback.done.jsonl';
const LOCK = 'feedback.lock';

/** Token-like strings: GitHub, Anthropic/OpenAI, Slack, AWS keys, JWTs, bearer values, key=value secrets. @req FR:feedback-button/store.redact */
const SECRETS: RegExp[] = [
  /\b(?:gh[pousr]_|github_pat_)[A-Za-z0-9_]{20,}/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi,
  /\b((?:password|passwd|secret|token|api[_-]?key)\s*[:=]\s*)\S+/gi,
];
export const redactSecrets = (s: string): string => SECRETS.reduce((t, re) => t.replace(re, (m, p1?: string) => (typeof p1 === 'string' && /[:=]\s*$/.test(p1) ? `${p1}[redacted]` : '[redacted]')), s);
/** The route without its query string, which can carry tokens. */
const cleanRoute = (r: string): string => r.replace(/\?[^#]*/, '');

/** The host's page capture (desktop shell: `webContents.capturePage`). In-process, so no renderer bridge. @req FR:feedback-button/store.capture */
let capturePage: (() => Promise<Buffer | null>) | undefined;
export const setPageCapture = (fn: (() => Promise<Buffer | null>) | undefined): void => { capturePage = fn; };

const isPng = (b: Buffer) => b.length > PNG_MAGIC.length && b.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC);

/** Appends `line` in one write (O_APPEND), then fsyncs: a tailing reader sees all of it or none. @req FR:feedback-button/store.atomic */
function appendLine(file: string, obj: object): void {
  const fd = openSync(file, 'a', 0o600);
  try { writeSync(fd, Buffer.from(JSON.stringify(obj) + '\n', 'utf8')); fsyncSync(fd); } finally { closeSync(fd); }
}

const readLines = <T>(file: string): T[] => {
  if (!existsSync(file)) return [];
  const out: T[] = [];
  for (const l of readFileSync(file, 'utf8').split('\n')) { if (!l.trim()) continue; try { out.push(JSON.parse(l) as T); } catch { /* skip a bad line */ } }
  return out;
};

/** `fb-<yyyymmddHHMMssSSS>-<hex>`; never at or before `last`'s time part. @req FR:feedback-button/store.line */
export function nextId(at: Date, last?: string): string {
  let t = BigInt(at.toISOString().replace(/[-:.TZ]/g, '').slice(0, 17));
  const prev = last && /^fb-(\d{17})-/.exec(last)?.[1];
  if (prev && BigInt(prev) >= t) t = BigInt(prev) + 1n;
  return `fb-${t}-${randomBytes(3).toString('hex')}`;
}

const lastId = (file: string): string | undefined => {
  if (!existsSync(file)) return undefined;
  const lines = readFileSync(file, 'utf8').trimEnd().split('\n');
  for (let i = lines.length - 1; i >= 0; i--) { try { const id = (JSON.parse(lines[i]) as { id?: unknown }).id; if (typeof id === 'string') return id; } catch { /* skip */ } }
  return undefined;
};

export class FeedbackStore {
  private readonly now: () => Date;
  constructor(readonly home: string, private readonly o: FeedbackOptions = {}) { this.now = o.now ?? (() => new Date()); }

  get file(): string { return join(this.home, FILE); }

  private lock<T>(fn: () => T): Promise<T> { return withFileLock(this.home, LOCK, fn, () => new FeedbackError('Feedback store is busy', 'busy')); }

  /** Validates, saves the screenshot (if any) first, then appends the line. @req FR:feedback-button/store.line */
  async add(input: FeedbackInput, shot: { png?: Buffer; capture?: boolean } = {}): Promise<FeedbackItem> {
    const text = redactSecrets(input.text ?? '').trim();
    if (!text) throw new FeedbackError('text is required');
    if (text.length > MAX_TEXT) throw new FeedbackError(`text is over ${MAX_TEXT} characters`);
    const max = this.o.maxPngBytes ?? MAX_PNG_BYTES;
    let png = shot.png;
    if (png && (!isPng(png) || png.length > max)) throw new FeedbackError(isPng(png) ? `screenshot is over ${max} bytes` : 'screenshot must be a PNG');
    if (!png && shot.capture && capturePage) {
      // A failed capture is not an error: the feedback still goes. @req FR:feedback-button/store.capture
      try { const b = await capturePage(); if (b && isPng(b)) png = b.length > max ? undefined : b; } catch { png = undefined; }
    }
    const at = this.now();
    const item: FeedbackItem = {
      id: '', at: at.toISOString(), text,
      ...(input.route ? { route: redactSecrets(cleanRoute(input.route)) } : {}),
      ...(input.viewport ? { viewport: input.viewport } : {}),
      ...(input.theme ? { theme: input.theme } : {}),
      ...(this.o.app?.appVersion ? { appVersion: this.o.app.appVersion } : {}),
      ...(this.o.app?.sha ? { sha: this.o.app.sha } : {}),
    };
    mkdirSync(this.home, { recursive: true, mode: 0o700 });
    await this.lock(() => {
      // The id is made under the lock, after the last line's, so ids sort in file order even within one millisecond.
      item.id = nextId(at, lastId(this.file));
      if (png) {
        const dir = join(this.home, 'feedback');
        mkdirSync(dir, { recursive: true, mode: 0o700 });
        item.screenshotPath = join(dir, `${item.id}.png`);
        writeAtomic(item.screenshotPath, png);
      }
      appendLine(this.file, item);
    });
    return item;
  }

  /** Items in file order, after `since` when given, each with `done`. @req FR:feedback-button/cli.list */
  list(o: { since?: string } = {}): (FeedbackItem & { done: boolean })[] {
    const done = new Set(readLines<{ id: string }>(join(this.home, DONE)).map((d) => d.id));
    let items = readLines<FeedbackItem>(this.file);
    if (o.since) { const i = items.findIndex((x) => x.id === o.since); items = i < 0 ? items.filter((x) => x.id > o.since!) : items.slice(i + 1); }
    return items.map((x) => ({ ...x, done: done.has(x.id) }));
  }

  /** Appends `{id, at}` to the sidecar; a second call is a no-op. @req FR:feedback-button/store.done */
  async done(id: string): Promise<{ id: string; changed: boolean }> {
    return this.lock(() => {
      if (!readLines<{ id: string }>(this.file).some((x) => x.id === id)) throw new FeedbackError(`No feedback ${id}`, 'not_found');
      const sidecar = join(this.home, DONE);
      if (readLines<{ id: string }>(sidecar).some((x) => x.id === id)) return { id, changed: false };
      appendLine(sidecar, { id, at: this.now().toISOString() });
      return { id, changed: true };
    });
  }
}
