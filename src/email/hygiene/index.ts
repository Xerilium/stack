/**
 * Inbox zero: batch asks to archive settled mail and junk spam, a subscription ledger with stated value and revisits,
 * and the approval gate. Nothing moves or unsubscribes until the owner answered the ask in Stack.
 * @req FR:email-inbox-zero/gate.answered @req FR:email-inbox-zero/batch.archive @req FR:email-inbox-zero/batch.spam @req FR:email-inbox-zero/sub.ledger
 */
import { createHash } from 'crypto';
import { handleAsk, oneLine, putAsk, readAsk, type Ask } from '../../core/asks';
import type { LifecycleContext } from '../../core/lifecycle';
import { redact } from '../../core/triage';
import type { Message, TriageClass, TriageResult } from '../types';

export const ACTOR = 'email-triage';
export const ARCHIVE_AFTER_HOURS = 24;
export const REVISIT_DAYS = 30;
/** Under this read share of at least `MIN_ISSUES_FOR_RATE` issues, the recommendation is to unsubscribe. */
export const LOW_READ = 0.2;
export const MIN_ISSUES_FOR_RATE = 3;
export const SUB_OPTIONS = ['Keep', 'Unsubscribe', 'Archive on arrival'];
/** Settled classes that go to the archive batch. @req FR:email-inbox-zero/batch.archive */
export const ARCHIVABLE: readonly TriageClass[] = ['newsletter', 'receipt', 'calendar', 'fyi', 'skip'];
const KEEP_IDS = 200;
const KEEP_DECLINED = 2000;
const KEEP_SUBJECTS = 5;
const DETAIL_LINES = 20;

export type BatchKind = 'archive' | 'spam';
export type Destination = 'archive' | 'junkemail';
export const DESTINATION: Record<BatchKind, Destination> = { archive: 'archive', spam: 'junkemail' };
export interface Pending { id: string; cls: TriageClass; from: string; subject: string; at: string; sub?: string }
/** One batch ask as written: its key, exactly the ids it lists, and a fingerprint of the text the owner sees. @req FR:email-inbox-zero/gate.answered */
export interface Batch { key: string; kind: BatchKind; ids: string[]; fingerprint: string }
export type SubMethod = 'one-click' | 'link' | 'mailto' | 'none';
export interface SubRow {
  key: string; name: string; first: string; last: string; issues: number; read: number;
  ids: { id: string; read: boolean }[]; subjects: string[];
  method: SubMethod; url?: string; mailto?: string;
  decision?: 'keep' | 'archive' | 'unsubscribe' | 'unsubscribed'; value?: string; decidedAt?: string; revisit?: string;
  /** Counts when the owner decided, so a revisit shows reads since then. */
  since?: { issues: number; read: number };
  /** The open ask for this row: first decision or a revisit. */
  asked?: boolean;
}
export interface HygieneState { version: 1; archive: Pending[]; spam: Pending[]; batches: Batch[]; declined: string[]; subs: Record<string, SubRow> }

export interface MailState { get(): Promise<HygieneState>; put(s: HygieneState): Promise<void> }
export interface MailActions { move(id: string, destinationId: Destination): Promise<void> }
export interface Judge { newsletterValue(sender: string, subjects: string[]): Promise<string> }
/** One-click POST. Implementations must not follow redirects, send cookies, or wait past 10 s (`FR:email-runner/http.safe`). */
export interface Http { post(url: string, body: string, headers: Record<string, string>): Promise<{ status: number }> }

export const emptyState = (): HygieneState => ({ version: 1, archive: [], spam: [], batches: [], declined: [], subs: {} });
/** In-memory state for tests and dry runs. */
export function memoryState(init: HygieneState = emptyState()): MailState {
  let s = structuredClone(init);
  return { get: async () => s, put: async (n) => { s = n; } };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 3).trimEnd()}...` : s);
const clean = (s: string, n: number) => clip(oneLine(redact(s)), n);
const sha = (s: string) => createHash('sha1').update(s).digest('hex');
const header = (h: Record<string, string> | undefined, name: string) => Object.entries(h ?? {}).filter(([k]) => k.toLowerCase() === name.toLowerCase()).map(([, v]) => String(v)).join('; ');
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
/** What the owner sees on an ask, hashed: a changed text or a rewrite by anyone else breaks the match. */
export const fingerprint = (a: Pick<Ask, 'ask' | 'detail' | 'from'>) => sha(`${a.from}\n${a.ask}\n${a.detail}`);

/** `sub-` plus 12 hex of the list id (or sender address). */
export const subKey = (listOrAddress: string): string => `sub-${sha(listOrAddress.trim().toLowerCase()).slice(0, 12)}`;
function listOf(m: Message): string {
  const id = header(m.headers, 'List-Id');
  const inner = id && /<([^>]{1,200})>/.exec(id)?.[1];
  return (inner || id || m.from.address).trim().toLowerCase();
}
/** RFC 8058 needs a DKIM signature over the unsubscribe headers; a passing DKIM result is the signal available here. */
const dkimPass = (h?: Record<string, string>) => /\bdkim=pass\b/i.test(header(h, 'Authentication-Results'));

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
const PRIVATE_SUFFIX = /\.(local|localhost|localdomain|internal|intranet|lan|home|corp|home\.arpa)$/;
/** A one-click target: `https`, a public-looking host name (no IP literal, no single label, no private suffix), no credentials. DNS is checked again at send time. */
export function safeHttps(raw: string): string | undefined {
  try {
    const u = new URL(raw);
    const h = u.hostname.toLowerCase().replace(/\.+$/, '');
    if (u.protocol !== 'https:' || u.username || u.password || !h.includes('.') || IPV4.test(h) || h.startsWith('[') || h === 'localhost' || PRIVATE_SUFFIX.test(h)) return undefined;
    return u.toString();
  } catch { return undefined; }
}

/** The unsubscribe method from the sender's own headers. One-click needs a passing DKIM result. @req FR:email-inbox-zero/sub.unsubscribe */
export function unsubscribeTarget(headers: Record<string, string>): { method: SubMethod; url?: string; mailto?: string } {
  const parts = [...header(headers, 'List-Unsubscribe').matchAll(/<([^>]{1,2000})>/g)].map((x) => x[1].trim());
  const url = parts.map(safeHttps).find(Boolean);
  const mailto = parts.find((p) => /^mailto:/i.test(p))?.slice(7).split('?')[0];
  if (url && /List-Unsubscribe=One-Click/i.test(header(headers, 'List-Unsubscribe-Post')) && dkimPass(headers)) return { method: 'one-click', url };
  if (url) return { method: 'link', url };
  if (mailto && /^[^@\s]{1,64}@[^@\s]{1,255}$/.test(mailto)) return { method: 'mailto', mailto };
  return { method: 'none' };
}

/** Records one triage result: batches and the subscription ledger. VIP and declined mail never enter a batch. @req FR:email-inbox-zero/sub.ledger */
export function observe(s: HygieneState, r: TriageResult, o: { now: Date }): void {
  const m = r.message;
  const item = (sub?: string): Pending => ({ id: m.id, cls: r.class, from: clean(m.from.name || m.from.address, 60), subject: clean(m.subject || '(no subject)', 100), at: m.receivedAt, ...(sub ? { sub } : {}) });
  let sub: string | undefined;
  if (r.class === 'newsletter') {
    sub = subKey(listOf(m));
    const now = o.now.toISOString();
    const row = s.subs[sub] ?? (s.subs[sub] = { key: sub, name: clean(m.from.name || m.from.address, 60), first: now, last: now, issues: 0, read: 0, ids: [], subjects: [], method: 'none' });
    const seen = row.ids.find((x) => x.id === m.id);
    if (seen) {
      if (m.isRead && !seen.read) { seen.read = true; row.read++; }
    } else {
      row.issues++; row.last = now;
      if (m.isRead) row.read++;
      row.ids = [...row.ids, { id: m.id, read: !!m.isRead }].slice(-KEEP_IDS);
      row.subjects = [...row.subjects, clean(m.subject, 100)].slice(-KEEP_SUBJECTS);
      // Only a DKIM-passing issue may set or change where an unsubscribe goes; anyone can claim a List-Id.
      if (m.headers && (dkimPass(m.headers) || row.method === 'none')) Object.assign(row, { url: undefined, mailto: undefined }, unsubscribeTarget(m.headers));
    }
  }
  if (r.vip || s.declined.includes(m.id)) return;
  const queued = (x: Pending[]) => x.some((p) => p.id === m.id);
  if (r.class === 'spam') {
    if (!queued(s.spam)) s.spam.push(item());
    s.archive = s.archive.filter((x) => x.id !== m.id);
  } else if (ARCHIVABLE.includes(r.class) && !queued(s.archive) && !queued(s.spam)) {
    s.archive.push(item(sub));
  }
}

/** The owner's choice on an email-triage ask: `go`, the picked option, or null while open, rejected, or written by someone else. @req FR:email-inbox-zero/gate.answered */
export async function approvedChoice(ctx: LifecycleContext, key: string): Promise<string | null> {
  const a = (await readAsk(ctx, key))?.ask;
  if (!a || a.from !== ACTOR || a.state !== 'answered') return null;
  if (a.answer === 'option') return a.text ?? null;
  if (a.answer === 'go') return a.kind === 'decide' ? (a.recommend ?? null) : 'go';
  return null;
}

/** The batch's ask if it is still exactly what was written; null when it was changed or removed. @req FR:email-inbox-zero/gate.answered */
async function intact(ctx: LifecycleContext, b: Batch): Promise<Ask | null> {
  const a = (await readAsk(ctx, b.key))?.ask;
  return a && a.from === ACTOR && fingerprint(a) === b.fingerprint ? a : null;
}

/** Ids the owner approved, each with its one folder, for the guard. @req FR:email-inbox-zero/gate.guard */
export async function approvedMoves(ctx: LifecycleContext, s: HygieneState): Promise<Map<string, Destination>> {
  const out = new Map<string, Destination>();
  for (const b of s.batches) {
    const a = await intact(ctx, b);
    if (a?.state === 'answered' && a.answer === 'go') for (const id of b.ids) out.set(id, DESTINATION[b.kind]);
  }
  return out;
}

function batchDetail(items: Pending[]): string {
  const counts = new Map<string, number>();
  for (const x of items) counts.set(x.cls, (counts.get(x.cls) ?? 0) + 1);
  const head = [...counts].map(([c, n]) => `${n} ${c}`).join(', ');
  const lines = items.slice(0, DETAIL_LINES).map((x) => `- ${x.cls} · ${x.from} · ${x.subject}`);
  return [head, '', ...lines, ...(items.length > DETAIL_LINES ? [`- and ${items.length - DETAIL_LINES} more`] : [])].join('\n');
}

/** A new, immutable batch ask; while one of a kind is open, new mail waits for the next batch. @req FR:email-inbox-zero/batch.archive @req FR:email-inbox-zero/gate.answered */
async function writeBatch(ctx: LifecycleContext, s: HygieneState, kind: BatchKind, items: Pending[], base: { project?: string }): Promise<void> {
  if (!items.length || s.batches.some((b) => b.kind === kind)) return;
  const ids = items.map((x) => x.id);
  const key = `mail-${kind}-${sha(ids.join(',')).slice(0, 10)}`;
  const ask = kind === 'archive' ? `Archive ${plural(items.length, 'settled message')}?` : `Move ${plural(items.length, 'spam message')} to Junk?`;
  const cur = (await readAsk(ctx, key))?.ask;
  await putAsk(ctx, key, { ...base, kind: 'approve', ask, recommend: kind === 'archive' ? 'Archive' : 'Move to Junk', default: 'Nothing moves', reversible: true, priority: 'low', detail: batchDetail(items), ...(cur?.state === 'done' ? { reopen: true } : {}) }, ACTOR);
  const written = (await readAsk(ctx, key))!.ask;
  s.batches.push({ key, kind, ids, fingerprint: fingerprint(written) });
}

/** Writes new batch asks and subscription or revisit asks. Open batches are never rewritten. @req FR:email-inbox-zero/batch.archive @req FR:email-inbox-zero/sub.value @req FR:email-inbox-zero/sub.revisit */
export async function writeHygieneAsks(ctx: LifecycleContext, s: HygieneState, o: { now: Date; judge?: Judge; archiveAfterHours?: number; project?: string }): Promise<{ archive: number; spam: number }> {
  const base = o.project ? { project: o.project } : {};
  const cutoff = o.now.getTime() - (o.archiveAfterHours ?? ARCHIVE_AFTER_HOURS) * 3600_000;
  const listed = new Set(s.batches.flatMap((b) => b.ids));
  const eligible = s.archive.filter((x) => !listed.has(x.id) && (Date.parse(x.at) <= cutoff || (x.sub && s.subs[x.sub]?.decision === 'archive')));
  await writeBatch(ctx, s, 'archive', eligible, base);
  await writeBatch(ctx, s, 'spam', s.spam.filter((x) => !listed.has(x.id)), base);
  for (const row of Object.values(s.subs)) {
    if (row.asked) continue;
    const rate = row.issues >= MIN_ISSUES_FOR_RATE && row.read / row.issues < LOW_READ ? 'Unsubscribe' : 'Keep';
    const common = { ...base, kind: 'decide' as const, options: SUB_OPTIONS, recommend: rate, default: 'Keep (nothing changes)', reversible: true, priority: 'low' as const };
    const cur = (await readAsk(ctx, row.key))?.ask;
    const reopen = cur?.state === 'done' ? { reopen: true } : {};
    if (!row.decision && row.issues >= 2 && o.judge) {
      row.value = clean(await o.judge.newsletterValue(row.name, row.subjects), 200);
      await putAsk(ctx, row.key, { ...common, ...reopen, ask: clip(`Keep ${row.name}?`, 200), why: row.value, detail: `Issues: ${row.issues}, read: ${row.read}. Recent: ${row.subjects.join(' · ')}` }, ACTOR);
      row.asked = true;
    } else if (row.decision === 'keep' && row.revisit && Date.parse(row.revisit) <= o.now.getTime()) {
      const n = row.issues - (row.since?.issues ?? 0);
      const r = row.read - (row.since?.read ?? 0);
      await putAsk(ctx, row.key, { ...common, ...reopen, recommend: n >= MIN_ISSUES_FOR_RATE && r / n < LOW_READ ? 'Unsubscribe' : 'Keep', ask: clip(`Still worth it? ${row.name}`, 200), why: clip(`Expected "${row.value ?? 'no stated value'}" Read ${r} of ${plural(n, 'issue')} since ${(row.decidedAt ?? row.first).slice(0, 10)}.`, 500) }, ACTOR);
      row.asked = true;
    }
  }
  return { archive: s.batches.filter((b) => b.kind === 'archive').reduce((t, b) => t + b.ids.length, 0), spam: s.batches.filter((b) => b.kind === 'spam').reduce((t, b) => t + b.ids.length, 0) };
}

export interface ApplyResult { archived: number; junked: number; failed: number; unsubscribed: number; decided: number }
const remember = (s: HygieneState, ids: string[]) => { s.declined = [...s.declined, ...ids].slice(-KEEP_DECLINED); };
const gone = (e: unknown) => (e as { status?: unknown })?.status === 404;

/** Acts on one batch: go moves exactly its ids (saving after each, so a crash never moves twice), no declines them, anything else frees them for a new batch. @req FR:email-inbox-zero/batch.act @req FR:email-inbox-zero/gate.once */
async function settleBatch(ctx: LifecycleContext, d: { state: MailState; actions: MailActions }, s: HygieneState, b: Batch, r: ApplyResult): Promise<void> {
  const a = await intact(ctx, b);
  const drop = () => { s.batches = s.batches.filter((x) => x !== b); };
  if (!a) {
    drop();
    if ((await readAsk(ctx, b.key))?.ask.state !== 'done') await handleAsk(ctx, b.key, { outcome: 'handled', note: 'Changed outside email-triage; nothing moved' }, ACTOR).catch(() => undefined);
    return;
  }
  if (a.state === 'open') return;
  if (a.state === 'done') { drop(); return; }
  const list = b.kind === 'archive' ? 'archive' : 'spam';
  if (a.answer === 'go') {
    let moved = 0;
    let failed = 0;
    for (const id of [...b.ids]) {
      try { await d.actions.move(id, DESTINATION[b.kind]); moved++; s[list] = s[list].filter((x) => x.id !== id); }
      catch (e) { if (gone(e)) { s[list] = s[list].filter((x) => x.id !== id); } else failed++; }
      b.ids = b.ids.filter((x) => x !== id);
      await d.state.put(s);
    }
    if (b.kind === 'archive') r.archived += moved; else r.junked += moved;
    r.failed += failed;
    drop();
    await handleAsk(ctx, b.key, { outcome: 'handled', note: `${b.kind === 'archive' ? 'Archived' : 'Moved to Junk'} ${moved}${failed ? `; ${failed} failed and will be asked again` : ''}` }, ACTOR);
    return;
  }
  if (a.answer === 'no') {
    remember(s, b.ids);
    const ids = new Set(b.ids);
    s[list] = s[list].filter((x) => !ids.has(x.id));
    drop();
    await handleAsk(ctx, b.key, { outcome: 'handled', note: 'Nothing moved; these will not be asked about again' }, ACTOR);
    return;
  }
  // A reply or a question is not an approval: nothing moves and the mail goes into the next batch.
  drop();
  await handleAsk(ctx, b.key, { outcome: 'handled', note: 'Nothing moved (not an approval); a new batch will be asked' }, ACTOR);
}

async function toGoDo(ctx: LifecycleContext, row: SubRow, why: string): Promise<void> {
  await handleAsk(ctx, row.key, { outcome: 'reopen' }, ACTOR);
  const link = row.url && safeHttps(row.url);
  await putAsk(ctx, row.key, { kind: 'go-do', ask: clip(`Unsubscribe from ${row.name} (${why})`, 200), ...(link ? { link } : {}), default: 'You keep getting it', reversible: true }, ACTOR);
}

/** Acts on answered email-triage asks: batches, subscription decisions, one-click unsubscribes. @req FR:email-inbox-zero/batch.act @req FR:email-inbox-zero/gate.once @req FR:email-inbox-zero/sub.unsubscribe @req FR:email-inbox-zero/sub.revisit */
export async function applyApproved(ctx: LifecycleContext, d: { state: MailState; actions: MailActions; http?: Http; now?: Date }): Promise<ApplyResult> {
  const s = await d.state.get();
  const now = d.now ?? (ctx.now ?? (() => new Date()))();
  const r: ApplyResult = { archived: 0, junked: 0, failed: 0, unsubscribed: 0, decided: 0 };
  for (const b of [...s.batches]) await settleBatch(ctx, d, s, b, r);
  for (const row of Object.values(s.subs)) {
    if (!row.asked) continue;
    const a = (await readAsk(ctx, row.key))?.ask;
    if (!a || a.state === 'open') continue;
    row.asked = false;
    if (a.state === 'done' || a.kind !== 'decide' || a.from !== ACTOR) continue;
    const choice = await approvedChoice(ctx, row.key);
    const keep = (note: string) => {
      row.decision = 'keep'; row.decidedAt = now.toISOString(); row.since = { issues: row.issues, read: row.read };
      row.revisit = new Date(now.getTime() + REVISIT_DAYS * 86400_000).toISOString();
      return handleAsk(ctx, row.key, { outcome: 'handled', note: `${note}; revisit ${row.revisit.slice(0, 10)}` }, ACTOR);
    };
    if (!choice) { await keep('No change'); continue; }
    r.decided++;
    if (choice === 'Unsubscribe') {
      row.decision = 'unsubscribe';
      if (row.method === 'one-click' && row.url && d.http) {
        const status = await d.http.post(row.url, 'List-Unsubscribe=One-Click', { 'Content-Type': 'application/x-www-form-urlencoded' }).then((x) => x.status, () => 0);
        if (status >= 200 && status < 300) {
          row.decision = 'unsubscribed'; r.unsubscribed++;
          await handleAsk(ctx, row.key, { outcome: 'handled', note: 'Unsubscribed (one-click)' }, ACTOR);
        } else await toGoDo(ctx, row, `one-click failed: ${status ? `HTTP ${status}` : 'no response'}`);
      } else if (row.method === 'mailto') await toGoDo(ctx, row, `by email: ${row.mailto}`);
      else if (row.method === 'link' || row.method === 'one-click') await toGoDo(ctx, row, 'open the link');
      else await toGoDo(ctx, row, 'no unsubscribe header; use the sender settings');
      continue;
    }
    if (choice === 'Archive on arrival') {
      row.decision = 'archive'; row.decidedAt = now.toISOString();
      await handleAsk(ctx, row.key, { outcome: 'handled', note: 'Archiving on arrival (each batch still asks)' }, ACTOR);
    } else await keep('Keeping');
  }
  await d.state.put(s);
  return r;
}
