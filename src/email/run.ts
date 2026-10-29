/**
 * One triage run: provider delta, prefilter, classify, (draft), putAsk. All I/O is injected.
 * @req FR:email-triage/ask.reply @req FR:email-triage/ask.quiet @req FR:email-triage/ask.resolve
 */
import type { LifecycleContext } from '../core/lifecycle';
import { markDraft } from './draft';
import { prefilter, type RulesConfig } from './rules';
import { newSummary, recordResult, resolveAsk, tally, type RunSummary } from './to-ask';
import { TRIAGE_CLASSES, type Classifier, type Drafter, type MailProvider, type Message, type TriageResult } from './types';

export interface RunDeps {
  ctx: LifecycleContext;
  provider: MailProvider;
  classifier: Classifier;
  /** Absent in observe mode: nothing is written to the mailbox. */
  drafter?: Drafter;
  rules: RulesConfig;
  /** Project the asks belong to (the mailbox). */
  project?: string;
  cursor?: string;
}

const clamp = (n: unknown, lo: number, hi: number) => (typeof n === 'number' && Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : lo);

async function triage(d: RunDeps, m: Message, summary: RunSummary): Promise<TriageResult> {
  const pre = prefilter(m, d.rules);
  if (pre?.class) {
    if (pre.class === 'skip' && (await resolveAsk(d.ctx, m))) summary.resolved++;
    const r: TriageResult = { message: m, class: pre.class, confidence: 1, reason: pre.rule, ...(pre.vip ? { vip: true } : {}) };
    tally(summary, r, 'rule');
    return r;
  }
  const vip = pre?.vip === true;
  const c = await d.classifier.classify(m, { vip });
  // Model output is data: an unknown class or an injection flag goes to the owner undrafted.
  const trusted = (TRIAGE_CLASSES as readonly string[]).includes(c.class) && !c.injectionSuspected;
  const r: TriageResult = {
    message: m, class: trusted ? c.class : 'needs_decision', confidence: clamp(c.confidence, 0, 1), urgency: Math.max(clamp(c.urgency, 0, 3), vip ? 1 : 0),
    reason: c.injectionSuspected ? 'Possible prompt injection; not drafted' : c.reason, ...(trusted && c.options ? { options: c.options } : {}), ...(trusted && c.recommend ? { recommend: c.recommend } : {}),
    ...(vip ? { vip } : {}),
  };
  if (r.class === 'needs_reply' && d.drafter) {
    const text = markDraft(await d.drafter.draft(m));
    r.draft = { text, webLink: (await d.provider.createDraft(m.id, text)).webLink };
  }
  tally(summary, r, 'model');
  return r;
}

/** Runs one pass over the provider's delta; only the newest message of each conversation is triaged. */
export async function runTriage(d: RunDeps): Promise<{ cursor: string; summary: RunSummary }> {
  const { messages, cursor } = await d.provider.delta(d.cursor);
  const newest = new Map<string, Message>();
  for (const m of [...messages].sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt))) newest.set(m.conversationId, m);
  const summary = newSummary();
  for (const m of newest.values()) await recordResult(d.ctx, await triage(d, m, summary), { project: d.project });
  return { cursor, summary };
}
