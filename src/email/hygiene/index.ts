/**
 * Inbox zero: batch asks to archive settled mail and junk spam, a subscription ledger with stated value and revisits,
 * and the approval gate. Nothing moves or unsubscribes until the owner answered the ask in Stack.
 * @req FR:email-inbox-zero/gate.answered @req FR:email-inbox-zero/batch.archive @req FR:email-inbox-zero/batch.spam @req FR:email-inbox-zero/sub.ledger
 */
import { createHash } from 'crypto';
import { handleAsk, oneLine, putAsk, readAsk, type AskPut } from '../../core/asks';
import type { LifecycleContext } from '../../core/lifecycle';
import { redact } from '../../core/triage';
import type { Message, TriageClass, TriageResult } from '../types';

export const ACTOR = 'email-triage';
export const ARCHIVE_KEY = 'mail-archive';
export const SPAM_KEY = 'mail-spam';
export const ARCHIVE_AFTER_HOURS = 24;
export const REVISIT_DAYS = 30;
/** Under this read share of at least `MIN_ISSUES_FOR_RATE` issues, the recommendation is to unsubscribe. */
export const LOW_READ = 0.2;
export const MIN_ISSUES_FOR_RATE = 3;
export const SUB_OPTIONS = ['Keep', 'Unsubscribe', 'Archive on arrival'];
/** Settled classes that go to the archive batch. @req FR:email-inbox-zero/batch.archive */
export const ARCHIVABLE: readonly TriageClass[] = ['newsletter', 'receipt', 'calendar', 'fyi', 'skip'];
const KEEP_IDS = 50;
const KEEP_SUBJECTS = 5;
const DETAIL_LINES = 20;

export interface Pending { id: string; cls: TriageClass; from: string; subject: string; at: string; sub?: string }
export type SubMethod = 'one-click' | 'link' | 'mailto' | 'none';
export interface SubRow {
  key: string; name: string; first: string; last: string; issues: number; read: number;
  ids: { id: string; read: boolean }[]; subjects: string[];
  method: SubMethod; url?: string; mailto?: string;
  decision?: 'keep' | 'archive' | 'unsubscribe' | 'unsubscribed'; value?: string; decidedAt?: string; revisit?: string;
  /** The open ask for this row: first decision or a revisit. */
  asked?: boolean;
}
export interface HygieneState { version: 1; archive: Pending[]; spam: Pending[]; archiveAsked: string[]; spamAsked: string[]; subs: Record<string, SubRow> }

export interface MailState { get(): Promise<HygieneState>; put(s: HygieneState): Promise<void> }
export interface MailActions { move(id: string, destinationId: 'archive' | 'junkemail'): Promise<void> }
export interface Judge { newsletterValue(sender: string, subjects: string[]): Promise<string> }
export interface Http { post(url: string, body: string, headers: Record<string, string>): Promise<{ status: number }> }

export const emptyState = (): HygieneState => ({ version: 1, archive: [], spam: [], archiveAsked: [], spamAsked: [], subs: {} });
/** In-memory state for tests and dry runs. */
export function memoryState(init: HygieneState = emptyState()): MailState {
  let s = structuredClone(init);
  return { get: async () => s, put: async (n) => { s = n; } };
}

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 3).trimEnd()}...` : s);
const clean = (s: string, n: number) => clip(oneLine(redact(s)), n);
const sha = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 12);
const header = (m: Message, name: string) => Object.entries(m.headers ?? {}).find(([k]) => k.toLowerCase() === name.toLowerCase())?.[1];
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** `sub-` plus 12 hex of the list id (or sender address). */
export const subKey = (listOrAddress: string): string => `sub-${sha(listOrAddress.trim().toLowerCase())}`;
function listOf(m: Message): string {
  const id = header(m, 'List-Id');
  const inner = id && /<([^>]{1,200})>/.exec(id)?.[1];
  return (inner || id || m.from.address).trim().toLowerCase();
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;
/** A safe one-click target: `https`, a public host name (no IP literal, no localhost), no credentials. */
function safeHttps(raw: string): string | undefined {
  try {
    const u = new URL(raw);
    const h = u.hostname.toLowerCase();
    if (u.protocol !== 'https:' || u.username || u.password || !h.includes('.') || IPV4.test(h) || h.startsWith('[') || h === 'localhost' || h.endsWith('.localhost')) return undefined;
    return u.toString();
  } catch { return undefined; }
}

/** The unsubscribe method from the sender's own headers. @req FR:email-inbox-zero/sub.unsubscribe */
export function unsubscribeTarget(headers: Record<string, string>): { method: SubMethod; url?: string; mailto?: string } {
  const get = (n: string) => Object.entries(headers).find(([k]) => k.toLowerCase() === n.toLowerCase())?.[1] ?? '';
  const parts = [...get('List-Unsubscribe').matchAll(/<([^>]{1,2000})>/g)].map((x) => x[1].trim());
  const url = parts.map(safeHttps).find(Boolean);
  const mailto = parts.find((p) => /^mailto:/i.test(p))?.slice(7).split('?')[0];
  if (url && /List-Unsubscribe=One-Click/i.test(get('List-Unsubscribe-Post'))) return { method: 'one-click', url };
  if (url) return { method: 'link', url };
  if (mailto && /^[^@\s]{1,64}@[^@\s]{1,255}$/.test(mailto)) return { method: 'mailto', mailto };
  return { method: 'none' };
}

/** Records one triage result in the state: archive and spam batches, and the subscription ledger. @req FR:email-inbox-zero/sub.ledger */
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
      if (m.headers) Object.assign(row, { url: undefined, mailto: undefined }, unsubscribeTarget(m.headers));
    }
  }
  if (r.class === 'spam' && !s.spam.some((x) => x.id === m.id)) {
    s.spam.push(item());
    s.archive = s.archive.filter((x) => x.id !== m.id);
  } else if (ARCHIVABLE.includes(r.class) && !s.archive.some((x) => x.id === m.id) && !s.spam.some((x) => x.id === m.id)) {
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

async function put(ctx: LifecycleContext, key: string, input: AskPut): Promise<void> {
  const cur = (await readAsk(ctx, key))?.ask;
  if (cur?.state === 'answered') return; // never change what the owner already answered
  await putAsk(ctx, key, { ...input, from: ACTOR, ...(cur?.state === 'done' ? { reopen: true } : {}) }, ACTOR);
}

function batchDetail(items: Pending[]): string {
  const counts = new Map<string, number>();
  for (const x of items) counts.set(x.cls, (counts.get(x.cls) ?? 0) + 1);
  const head = [...counts].map(([c, n]) => `${n} ${c}`).join(', ');
  const lines = items.slice(0, DETAIL_LINES).map((x) => `- ${x.cls} · ${x.from} · ${x.subject}`);
  return [head, '', ...lines, ...(items.length > DETAIL_LINES ? [`- and ${items.length - DETAIL_LINES} more`] : [])].join('\n');
}

/** Writes or updates the batch, subscription and revisit asks. Asks the owner already answered are left alone. @req FR:email-inbox-zero/batch.archive @req FR:email-inbox-zero/sub.value @req FR:email-inbox-zero/sub.revisit */
export async function writeHygieneAsks(ctx: LifecycleContext, s: HygieneState, o: { now: Date; judge?: Judge; archiveAfterHours?: number; project?: string }): Promise<{ archive: number; spam: number }> {
  const base = o.project ? { project: o.project } : {};
  const cutoff = o.now.getTime() - (o.archiveAfterHours ?? ARCHIVE_AFTER_HOURS) * 3600_000;
  const eligible = s.archive.filter((x) => Date.parse(x.at) <= cutoff || (x.sub && s.subs[x.sub]?.decision === 'archive'));
  if (eligible.length && (await readAsk(ctx, ARCHIVE_KEY))?.ask.state !== 'answered') {
    await put(ctx, ARCHIVE_KEY, { ...base, kind: 'approve', ask: `Archive ${plural(eligible.length, 'settled message')}?`, recommend: 'Archive', default: 'Nothing moves', reversible: true, priority: 'low', detail: batchDetail(eligible) });
    s.archiveAsked = eligible.map((x) => x.id);
  }
  if (s.spam.length && (await readAsk(ctx, SPAM_KEY))?.ask.state !== 'answered') {
    await put(ctx, SPAM_KEY, { ...base, kind: 'approve', ask: `Move ${plural(s.spam.length, 'spam message')} to Junk?`, recommend: 'Move to Junk', default: 'Nothing moves', reversible: true, priority: 'low', detail: batchDetail(s.spam) });
    s.spamAsked = s.spam.map((x) => x.id);
  }
  for (const row of Object.values(s.subs)) {
    if (row.asked) continue;
    const rate = row.issues >= MIN_ISSUES_FOR_RATE && row.read / row.issues < LOW_READ ? 'Unsubscribe' : 'Keep';
    const common = { ...base, kind: 'decide' as const, options: SUB_OPTIONS, recommend: rate, default: 'Keep (nothing changes)', reversible: true, priority: 'low' as const };
    if (!row.decision && row.issues >= 2 && o.judge) {
      row.value = clean(await o.judge.newsletterValue(row.name, row.subjects), 200);
      await put(ctx, row.key, { ...common, ask: clip(`Keep ${row.name}?`, 200), why: row.value, detail: `Issues: ${row.issues}, read: ${row.read}. Recent: ${row.subjects.join(' · ')}` });
      row.asked = true;
    } else if (row.decision === 'keep' && row.revisit && Date.parse(row.revisit) <= o.now.getTime()) {
      await put(ctx, row.key, { ...common, ask: clip(`Still worth it? ${row.name}`, 200), why: clip(`Expected "${row.value ?? 'no stated value'}" Read ${row.read} of ${plural(row.issues, 'issue')} since ${row.first.slice(0, 10)}.`, 500) });
      row.asked = true;
    }
  }
  return { archive: eligible.length, spam: s.spam.length };
}

export interface ApplyResult { archived: number; junked: number; failed: number; unsubscribed: number; decided: number }

async function moveBatch(ctx: LifecycleContext, s: HygieneState, which: 'archive' | 'spam', actions: MailActions): Promise<{ moved: number; failed: number }> {
  const key = which === 'archive' ? ARCHIVE_KEY : SPAM_KEY;
  const askedField = which === 'archive' ? 'archiveAsked' : 'spamAsked';
  const choice = await approvedChoice(ctx, key);
  const a = (await readAsk(ctx, key))?.ask;
  if (a?.from === ACTOR && a.state === 'answered' && !choice) {
    // Rejected: nothing moves, and these messages are not asked about again.
    const asked = new Set(s[askedField]);
    s[which] = s[which].filter((x) => !asked.has(x.id));
    s[askedField] = [];
    await handleAsk(ctx, key, { outcome: 'handled', note: 'Nothing moved' }, ACTOR);
    return { moved: 0, failed: 0 };
  }
  if (!choice) return { moved: 0, failed: 0 };
  let moved = 0;
  const failed: string[] = [];
  for (const id of s[askedField]) {
    try { await actions.move(id, which === 'archive' ? 'archive' : 'junkemail'); moved++; s[which] = s[which].filter((x) => x.id !== id); }
    catch { failed.push(id); }
  }
  s[askedField] = [];
  const verb = which === 'archive' ? 'Archived' : 'Moved to Junk';
  await handleAsk(ctx, key, { outcome: 'handled', note: `${verb} ${moved}${failed.length ? `; ${failed.length} failed and stays listed` : ''}` }, ACTOR);
  return { moved, failed: failed.length };
}

async function toGoDo(ctx: LifecycleContext, row: SubRow, why: string): Promise<void> {
  await handleAsk(ctx, row.key, { outcome: 'reopen' }, ACTOR);
  const link = row.url && safeHttps(row.url);
  await putAsk(ctx, row.key, { kind: 'go-do', ask: clip(`Unsubscribe from ${row.name} (${why})`, 200), ...(link ? { link } : {}), default: 'You keep getting it', reversible: true }, ACTOR);
}

/** Acts on answered email-triage asks: moves exactly the listed messages, records subscription decisions, and unsubscribes by one-click only. @req FR:email-inbox-zero/batch.act @req FR:email-inbox-zero/gate.once @req FR:email-inbox-zero/sub.unsubscribe */
export async function applyApproved(ctx: LifecycleContext, d: { state: MailState; actions: MailActions; http?: Http; now?: Date }): Promise<ApplyResult> {
  const s = await d.state.get();
  const now = d.now ?? (ctx.now ?? (() => new Date()))();
  const arch = await moveBatch(ctx, s, 'archive', d.actions);
  const junk = await moveBatch(ctx, s, 'spam', d.actions);
  const r: ApplyResult = { archived: arch.moved, junked: junk.moved, failed: arch.failed + junk.failed, unsubscribed: 0, decided: 0 };
  for (const row of Object.values(s.subs)) {
    if (!row.asked) continue;
    const a = (await readAsk(ctx, row.key))?.ask;
    if (!a || a.state === 'open') continue;
    row.asked = false;
    if (a.state === 'done' || a.kind !== 'decide') continue;
    const choice = await approvedChoice(ctx, row.key);
    if (!choice) { await handleAsk(ctx, row.key, { outcome: 'handled', note: 'No change' }, ACTOR); continue; }
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
    if (choice === 'Archive on arrival') row.decision = 'archive';
    else { row.decision = 'keep'; row.revisit = new Date(now.getTime() + REVISIT_DAYS * 86400_000).toISOString(); }
    row.decidedAt = now.toISOString();
    await handleAsk(ctx, row.key, { outcome: 'handled', note: row.decision === 'keep' ? `Keeping; revisit ${row.revisit!.slice(0, 10)}` : 'Archiving on arrival' }, ACTOR);
  }
  await d.state.put(s);
  return r;
}
