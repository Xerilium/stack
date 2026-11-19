/**
 * Triage result to ask-queue entry. Quiet classes only move counters; sensitive mail never carries a body.
 * @req FR:email-triage/ask.reply @req FR:email-triage/ask.decide @req FR:email-triage/ask.quiet @req FR:email-triage/ask.resolve @req FR:email-triage/ask.group
 */
import { createHash } from 'crypto';
import { handleAsk, oneLine, putAsk, readAsk, type AskPriority, type AskPut } from '../core/asks';
import type { LifecycleContext } from '../core/lifecycle';
import { ConflictError, NotFoundError } from '../core/storage';
import { redact } from '../core/triage';
import { DRAFT_MARKER } from './draft';
import { TRIAGE_CLASSES, type Message, type TriageClass, type TriageResult } from './types';

const ACTOR = 'email-triage';
const DETAIL_CHARS = 600;
const SUMMARY_CHARS = 400;
/** At or above this model confidence the draft is recommended as is. */
export const SEND_AS_DRAFTED = 0.8;
/** Classes that create no ask. @req FR:email-triage/ask.quiet */
export const QUIET_CLASSES: readonly TriageClass[] = ['newsletter', 'receipt', 'calendar', 'skip', 'fyi', 'spam'];

/** `mail-` plus 12 hex of the conversation id's sha1: one ask per thread. @req FR:email-triage/ask.reply */
export const mailKey = (conversationId: string): string => `mail-${createHash('sha1').update(conversationId).digest('hex').slice(0, 12)}`;

/** Lowercase, trimmed, with every leading `Re:`/`Fw:`/`Fwd:` dropped. @req FR:email-triage/ask.group */
export const normSubject = (subject: string): string => { let t = subject.trim().toLowerCase(); for (let p = ''; p !== t;) { p = t; t = t.replace(/^(?:re|fwd?)\s*:\s*/, ''); } return t; };
/** `mail-` plus 12 hex of the sha1 of sender address and normalized subject: one ask for the same notice in many threads. @req FR:email-triage/ask.group */
export const groupKey = (m: Message): string => `mail-${createHash('sha1').update(`${m.from.address.trim().toLowerCase()}\n${normSubject(m.subject)}`).digest('hex').slice(0, 12)}`;
/** Decide and sensitive asks are grouped; reply asks stay per thread (each draft is per thread). @req FR:email-triage/ask.group */
const grouped = (r: TriageResult): boolean => r.class === 'needs_decision' || r.class === 'sensitive';
/** The ask key for a result. */
export const askKey = (r: TriageResult): string => (grouped(r) ? groupKey(r.message) : mailKey(r.message.conversationId));

/** The last detail line of a grouped ask: how many mails, and short ids of the latest ones (so a mail seen again never counts twice). */
const MAILS = /^Mails: (\d+) \(([0-9a-f ]*)\)$/;
const MAX_IDS = 50;
const mailId = (m: Message) => createHash('sha1').update(m.id).digest('hex').slice(0, 8);
function mailsOf(detail: string): { n: number; ids: string[]; rest: string } {
  const lines = detail.split('\n');
  const hit = MAILS.exec(lines[lines.length - 1] ?? '');
  if (!hit) return { n: 0, ids: [], rest: detail };
  return { n: Number(hit[1]), ids: hit[2].split(' ').filter(Boolean), rest: lines.slice(0, -1).join('\n').trimEnd() };
}

/** Plain `...` so the core's NFKC folding cannot lengthen it. */
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 3).trimEnd()}...` : s);
const who = (m: Message) => clip(oneLine(m.from.name || m.from.address) || 'unknown sender', 60);
const subject = (m: Message) => oneLine(m.subject) || '(no subject)';
const line = (prefix: string, m: Message) => clip(`${prefix} ${who(m)}: ${subject(m)}`, 200);
function https(v?: string): string | undefined {
  if (!v || v.length > 2000 || !/^https:\/\/\S+$/.test(v)) return undefined;
  try { new URL(v); return v; } catch { return undefined; }
}

/** The ask detail: one voice line, then the draft without its marker (the owner is already reviewing it). @req FR:email-voice/score.ask @req FR:email-voice/score.none */
function voiced(d: NonNullable<TriageResult['draft']>): string {
  const v = d.voice;
  if (!v) return d.text;
  const head = v.profile ? `Voice: ${v.score}/100` : 'Voice: no profile yet';
  // Matched draft text is quoted; structural labels ("2 em dashes", "bullet list") are not.
  const LABELS = new Set(['em-dash', 'exclamations', 'length', 'bullets', 'emoji']);
  const fix = [...new Set(v.violations.map((x) => (LABELS.has(x.id) ? x.match : `"${x.match}"`)))].slice(0, 3).join(', ');
  return `${head}${fix ? ` · fix: ${fix}` : ''}\n\n${d.text.replace(DRAFT_MARKER, '').trim()}`;
}

function priority(r: TriageResult): AskPriority {
  const u = Math.max(r.urgency ?? 1, r.vip ? 1 : 0);
  return u >= 2 ? 'high' : u >= 1 ? 'normal' : 'low';
}

/** The ask for a result, or null when the owner has nothing to do. @req FR:email-triage/ask.reply @req FR:email-triage/ask.decide @req FR:email-triage/ask.quiet */
export function toAsk(r: TriageResult, opts: { project?: string } = {}): AskPut | null {
  const m = r.message;
  const base = { from: ACTOR, ...(opts.project ? { project: opts.project } : {}) };
  const why = r.reason ? clip(oneLine(r.reason), 500) : undefined;
  // A short model summary, never the message body. @req FR:email-inbox-zero/sum.ask
  const thread = r.summary ? `Thread: ${clip(oneLine(redact(r.summary)), SUMMARY_CHARS)}` : undefined;
  const detail = (rest?: string) => { const d = [thread, rest].filter(Boolean).join('\n\n'); return d ? { detail: d } : {}; };
  switch (r.class) {
    case 'needs_reply':
      if (!r.draft) return { ...base, kind: 'go-do', ask: line('Reply to', m), link: https(m.webLink), reversible: true, priority: priority(r), ...(why ? { why } : {}), ...detail() };
      return {
        ...base, kind: 'review', ask: line('Review draft reply to', m), // A reused draft keeps the recommendation from when it was scored. @req FR:email-voice/score.ask
        ...(r.draft.reused ? {} : { recommend: r.confidence >= SEND_AS_DRAFTED && r.draft.voice?.pass !== false ? 'Send as drafted' : 'Edit then send' }),
        link: https(r.draft.webLink), default: 'Draft stays in Drafts (nothing is sent)', reversible: true, priority: priority(r),
        ...(r.draft.reused ? {} : detail(redact(voiced(r.draft)).slice(0, DETAIL_CHARS))), ...(why ? { why } : {}),
      };
    case 'needs_decision': {
      const options = [...new Set((r.options ?? []).map((o) => clip(oneLine(String(o)).replace(/\|/g, '/'), 80)).filter(Boolean))].slice(0, 4);
      const rec = r.recommend ? clip(oneLine(r.recommend), 500) : undefined;
      return {
        ...base, kind: options.length >= 2 ? 'decide' : 'answer', ask: line('Decide on', m), priority: priority(r), reversible: true,
        ...(options.length >= 2 ? { options } : {}), ...(rec ? { recommend: rec } : {}), ...(why ? { why } : {}), link: https(m.webLink), ...detail(),
      };
    }
    case 'sensitive':
      return { ...base, kind: 'go-do', ask: line('Sensitive mail from', m), link: https(m.webLink) };
    default:
      return null;
  }
}

/** The draft already recorded for this conversation's open ask (its link and the detail kept from the draft), or null. @req FR:email-triage/ask.once */
export async function existingDraft(ctx: LifecycleContext, m: Message): Promise<{ webLink: string; text: string } | null> {
  const cur = await readAsk(ctx, mailKey(m.conversationId));
  const a = cur?.ask;
  if (!a || a.state === 'done' || a.kind !== 'review' || !a.link) return null;
  return { webLink: a.link, text: a.detail };
}

/**
 * Writes the ask for a result; the same conversation twice updates one ask. A handled ask is left alone.
 * A grouped ask counts each new mail once, shows `(n mails)` and keeps the newest link; a new mail opens a handled one again.
 * @req FR:email-triage/ask.quiet @req FR:email-triage/ask.group @req FR:email-triage/ask.group.count @req FR:email-triage/ask.group.reopen
 */
export async function recordResult(ctx: LifecycleContext, r: TriageResult, opts: { project?: string } = {}): Promise<{ key: string; created: boolean } | null> {
  const input = toAsk(r, opts);
  if (!input) return null;
  const key = askKey(r);
  let put: AskPut = input;
  if (grouped(r)) {
    const cur = (await readAsk(ctx, key))?.ask;
    const seen: { n: number; ids: string[] } = cur ? mailsOf(cur.detail) : { n: 0, ids: [] };
    const id = mailId(r.message);
    if (cur && seen.ids.includes(id)) return cur.state === 'done' ? null : { key, created: false };
    // A handled group starts again at one mail.
    const reopen = cur?.state === 'done';
    const n = reopen ? 1 : Math.max(seen.n, cur ? 1 : 0) + 1;
    const ids = [...(reopen ? [] : seen.ids), id].slice(-MAX_IDS);
    const suffix = n > 1 ? ` (${n} mails)` : '';
    put = { ...input, ask: `${clip(input.ask!, 200 - suffix.length)}${suffix}`, detail: [input.detail, `Mails: ${n} (${ids.join(' ')})`].filter(Boolean).join('\n\n'), ...(reopen ? { reopen: true } : {}) };
  }
  try { return await putAsk(ctx, key, put, ACTOR); }
  catch (e) { if (e instanceof ConflictError && /Ask is done/.test(e.message)) return null; throw e; }
}

/**
 * The owner replied in the thread: the ask is handled as resolved. With the sender known, the grouped ask for the thread's
 * sender and subject is resolved too. False when there was nothing to close. @req FR:email-triage/ask.resolve @req FR:email-triage/ask.group.resolve
 */
export async function resolveAsk(ctx: LifecycleContext, m: Message): Promise<boolean> {
  const keys = [mailKey(m.conversationId), ...(m.from?.address && typeof m.subject === 'string' ? [groupKey(m)] : [])];
  let changed = false;
  for (const key of keys) {
    try { if ((await handleAsk(ctx, key, { outcome: 'resolved', note: 'Owner replied in the thread' }, ACTOR)).changed) changed = true; }
    catch (e) { if (!(e instanceof NotFoundError)) throw e; }
  }
  return changed;
}

export interface RunSummary {
  messages: number; rules: number; model: number; drafts: number; redrafts: number; asks: number; resolved: number;
  /** Messages waiting in the archive and spam batch asks. @req FR:email-inbox-zero/batch.act */
  archivePending: number; spamPending: number;
  counts: Record<TriageClass, number>;
}

export const newSummary = (): RunSummary => ({ messages: 0, rules: 0, model: 0, drafts: 0, redrafts: 0, asks: 0, resolved: 0, archivePending: 0, spamPending: 0, counts: Object.fromEntries(TRIAGE_CLASSES.map((c) => [c, 0])) as Record<TriageClass, number> });

/** Ask keys already counted in each run summary (kept off the summary so it stays plain JSON). */
const counted = new WeakMap<RunSummary, Set<string>>();

/** Counts one result in the run summary; a grouped ask counts once per run. @req FR:email-triage/ask.quiet @req FR:email-triage/ask.group.summary */
export function tally(s: RunSummary, r: TriageResult, source: 'rule' | 'model'): void {
  s.messages++;
  if (source === 'rule') s.rules++; else s.model++;
  s.counts[r.class]++;
  if (toAsk(r)) {
    const keys = counted.get(s) ?? new Set<string>();
    counted.set(s, keys);
    const key = askKey(r);
    if (!keys.has(key)) { keys.add(key); s.asks++; }
  }
  if (r.draft && !r.draft.reused) s.drafts++;
}
