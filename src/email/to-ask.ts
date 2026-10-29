/**
 * Triage result to ask-queue entry. Quiet classes only move counters; sensitive mail never carries a body.
 * @req FR:email-triage/ask.reply @req FR:email-triage/ask.decide @req FR:email-triage/ask.quiet @req FR:email-triage/ask.resolve
 */
import { createHash } from 'crypto';
import { handleAsk, oneLine, putAsk, readAsk, type AskPriority, type AskPut } from '../core/asks';
import type { LifecycleContext } from '../core/lifecycle';
import { ConflictError, NotFoundError } from '../core/storage';
import { redact } from '../core/triage';
import { TRIAGE_CLASSES, type Message, type TriageClass, type TriageResult } from './types';

const ACTOR = 'email-triage';
const DETAIL_CHARS = 600;
/** At or above this model confidence the draft is recommended as is. */
export const SEND_AS_DRAFTED = 0.8;
/** Classes that create no ask. @req FR:email-triage/ask.quiet */
export const QUIET_CLASSES: readonly TriageClass[] = ['newsletter', 'receipt', 'calendar', 'skip', 'fyi'];

/** `mail-` plus 12 hex of the conversation id's sha1: one ask per thread. @req FR:email-triage/ask.reply */
export const mailKey = (conversationId: string): string => `mail-${createHash('sha1').update(conversationId).digest('hex').slice(0, 12)}`;

/** Plain `...` so the core's NFKC folding cannot lengthen it. */
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 3).trimEnd()}...` : s);
const who = (m: Message) => clip(oneLine(m.from.name || m.from.address) || 'unknown sender', 60);
const subject = (m: Message) => oneLine(m.subject) || '(no subject)';
const line = (prefix: string, m: Message) => clip(`${prefix} ${who(m)}: ${subject(m)}`, 200);
function https(v?: string): string | undefined {
  if (!v || v.length > 2000 || !/^https:\/\/\S+$/.test(v)) return undefined;
  try { new URL(v); return v; } catch { return undefined; }
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
  switch (r.class) {
    case 'needs_reply':
      if (!r.draft) return { ...base, kind: 'go-do', ask: line('Reply to', m), link: https(m.webLink), reversible: true, priority: priority(r), ...(why ? { why } : {}) };
      return {
        ...base, kind: 'review', ask: line('Review draft reply to', m), recommend: r.confidence >= SEND_AS_DRAFTED ? 'Send as drafted' : 'Edit then send',
        link: https(r.draft.webLink), default: 'Draft stays in Drafts (nothing is sent)', reversible: true, priority: priority(r),
        ...(r.draft.reused ? {} : { detail: redact(r.draft.text).slice(0, DETAIL_CHARS) }), ...(why ? { why } : {}),
      };
    case 'needs_decision': {
      const options = [...new Set((r.options ?? []).map((o) => clip(oneLine(String(o)).replace(/\|/g, '/'), 80)).filter(Boolean))].slice(0, 4);
      const rec = r.recommend ? clip(oneLine(r.recommend), 500) : undefined;
      return {
        ...base, kind: options.length >= 2 ? 'decide' : 'answer', ask: line('Decide on', m), priority: priority(r), reversible: true,
        ...(options.length >= 2 ? { options } : {}), ...(rec ? { recommend: rec } : {}), ...(why ? { why } : {}), link: https(m.webLink),
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

/** Writes the ask for a result; the same conversation twice updates one ask. A handled ask is left alone. @req FR:email-triage/ask.quiet */
export async function recordResult(ctx: LifecycleContext, r: TriageResult, opts: { project?: string } = {}): Promise<{ key: string; created: boolean } | null> {
  const input = toAsk(r, opts);
  if (!input) return null;
  try { return await putAsk(ctx, mailKey(r.message.conversationId), input, ACTOR); }
  catch (e) { if (e instanceof ConflictError && /Ask is done/.test(e.message)) return null; throw e; }
}

/** The owner replied in the thread: the ask is handled as resolved. False when there was nothing to close. @req FR:email-triage/ask.resolve */
export async function resolveAsk(ctx: LifecycleContext, m: Message): Promise<boolean> {
  try { return (await handleAsk(ctx, mailKey(m.conversationId), { outcome: 'resolved', note: 'Owner replied in the thread' }, ACTOR)).changed; }
  catch (e) { if (e instanceof NotFoundError) return false; throw e; }
}

export interface RunSummary {
  messages: number; rules: number; model: number; drafts: number; asks: number; resolved: number;
  counts: Record<TriageClass, number>;
}

export const newSummary = (): RunSummary => ({ messages: 0, rules: 0, model: 0, drafts: 0, asks: 0, resolved: 0, counts: Object.fromEntries(TRIAGE_CLASSES.map((c) => [c, 0])) as Record<TriageClass, number> });

/** Counts one result in the run summary. @req FR:email-triage/ask.quiet */
export function tally(s: RunSummary, r: TriageResult, source: 'rule' | 'model'): void {
  s.messages++;
  if (source === 'rule') s.rules++; else s.model++;
  s.counts[r.class]++;
  if (toAsk(r)) s.asks++;
  if (r.draft && !r.draft.reused) s.drafts++;
}
