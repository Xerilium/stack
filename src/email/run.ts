/**
 * One triage run: provider delta, prefilter, classify, (draft), putAsk. All I/O is injected.
 * @req FR:email-triage/ask.reply @req FR:email-triage/ask.quiet @req FR:email-triage/ask.resolve
 */
import type { LifecycleContext } from '../core/lifecycle';
import { markDraft } from './draft';
import { prefilter, type RulesConfig } from './rules';
import { existingDraft, newSummary, recordResult, resolveAsk, tally, type RunSummary } from './to-ask';
import { TRIAGE_CLASSES, type Classifier, type Drafter, type DraftVoice, type MailProvider, type Message, type TriageResult } from './types';
import { DEFAULT_PROFILE, redraftFeedback, scoreDraft, type VoiceProfile } from './voice';

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
  /** The owner's learned voice; without it drafts are checked against the cliche list only. */
  voice?: VoiceProfile;
}

/** Drafts, checks the voice, and redrafts once with the violations when the first draft fails; the better score wins, a tie keeps the redraft. @req FR:email-voice/score.redraft */
async function voicedDraft(drafter: Drafter, m: Message, profile: VoiceProfile | undefined, summary: RunSummary): Promise<{ text: string; voice: DraftVoice }> {
  const p = profile ?? DEFAULT_PROFILE;
  let text = await drafter.draft(m);
  let s = scoreDraft(text, p);
  if (!s.pass) {
    summary.redrafts++;
    // A failed redraft keeps the first draft; the voice line tells the owner it needs edits.
    const again = await drafter.draft(m, { feedback: redraftFeedback(s.violations) }).catch(() => null);
    const s2 = again === null ? null : scoreDraft(again, p);
    if (again !== null && s2 && s2.score >= s.score) { text = again; s = s2; }
  }
  return { text, voice: { ...s, profile: !!profile } };
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
    // One draft per conversation: a run that died after drafting, or a thread seen again, reuses the draft already in the mailbox. @req FR:email-triage/ask.once
    const prior = await existingDraft(d.ctx, m);
    if (prior) r.draft = { text: prior.text, webLink: prior.webLink, reused: true };
    else {
      const { text, voice } = await voicedDraft(d.drafter, m, d.voice, summary);
      const marked = markDraft(text);
      r.draft = { text: marked, webLink: (await d.provider.createDraft(m.id, marked)).webLink, voice };
    }
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
