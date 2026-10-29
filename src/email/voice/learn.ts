/**
 * Learns the owner's voice from Sent items: shape, habits, waived cliche rules and a spread of few-shot examples.
 * @req FR:email-voice/learn.profile @req FR:email-voice/learn.examples @req FR:email-voice/cliche.own
 */
import { redact } from '../../core/triage';
import type { RulesConfig } from '../rules';
import type { Address } from '../types';
import { CLICHE_RULES } from './cliches';
import { bodyOf, greetingOf, isAutoReply, ownText, signoffOf, templateGreeting, words } from './clean';

/** A sent message as read from the mailbox. `body` is plain text, quoted history included. */
/**
 * A sent message as read from the mailbox. `body` is plain text, quoted history included.
 * `kind: 'other'` marks the owner's writing from elsewhere (e.g. issue comments): it shapes habits and length, never greetings or sign-offs. @req FR:email-voice/learn.sources
 */
export interface SentMessage { id: string; subject: string; sentAt: string; body: string; to: Address[]; conversationId?: string; kind?: 'email' | 'other' }

export interface FormShare { text: string; share: number }
export type LengthBucket = 'short' | 'medium' | 'long';
export interface VoiceExample { subject: string; text: string; bucket: LengthBucket; audience: 'internal' | 'external'; source: 'email' | 'other' }

export interface VoiceProfile {
  version: 1;
  account: string;
  learnedAt: string;
  sampleCount: number;
  greetings: FormShare[];
  signoffs: FormShare[];
  /** Words per message, greeting and sign-off excluded. */
  words: { p25: number; median: number; p75: number };
  sentenceWords: number;
  rates: { contractionsPer100: number; exclamationsPerMsg: number; emDashPer100: number; questionsPerMsg: number; bulletShare: number; emojiShare: number };
  /** Cliche rule ids the owner's own mail uses often enough to keep. */
  waived: string[];
  examples: VoiceExample[];
}

/** Neutral profile for a mailbox with no learned voice: no form checks, strict on AI tells. @req FR:email-voice/score.none */
export const DEFAULT_PROFILE: VoiceProfile = {
  version: 1, account: '', learnedAt: '', sampleCount: 0, greetings: [], signoffs: [], words: { p25: 25, median: 60, p75: 120 }, sentenceWords: 14,
  rates: { contractionsPer100: 2, exclamationsPerMsg: 0.3, emDashPer100: 0, questionsPerMsg: 0.5, bulletShare: 0.2, emojiShare: 0 }, waived: [], examples: [],
};

export const MIN_SAMPLES = 5;
/** Email messages needed before greetings and sign-offs come from email alone. */
export const MIN_EMAIL_FORMS = 3;
const MAX_EXAMPLES = 8;
/** A rule is waived when the owner uses it in at least this share of mail. @req FR:email-voice/cliche.own */
export const WAIVE_SHARE = 0.1;

export const BULLET = /^\s*([-*•]|\d+[.)])\s+/m;
export const EMOJI = /\p{Emoji_Presentation}/u;
/** Em dashes, and spaced en dashes or double hyphens used as one; a number range ("3 – 5") is not a dash. */
export const EM_DASH = /—|(?<!\d)\s–\s(?!\d)|\s--\s/g;
const CONTRACTION = /\b\p{L}+['’](s|re|ve|ll|d|t|m)\b/giu;
const count = (t: string, re: RegExp) => (t.match(new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`)) ?? []).length;
const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d;
function pct(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  return Math.round(sorted[lo] + (sorted[Math.ceil(i)] - sorted[lo]) * (i - lo));
}
function shares(forms: string[]): FormShare[] {
  const m = new Map<string, number>();
  for (const f of forms) m.set(f, (m.get(f) ?? 0) + 1);
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([text, n]) => ({ text, share: round(n / forms.length) }));
}
export const bucketOf = (n: number): LengthBucket => (n <= 25 ? 'short' : n <= 80 ? 'medium' : 'long');

const domainOf = (a: string) => a.trim().toLowerCase().slice(a.lastIndexOf('@') + 1);
function matches(address: string, list: string[]): boolean {
  const a = address.trim().toLowerCase();
  const d = domainOf(a);
  return list.some((raw) => { const e = raw.trim().toLowerCase().replace(/^@/, ''); return e.includes('@') ? a === e : d === e || d.endsWith(`.${e}`); });
}

/** Contact data out of examples: they travel to a model with every draft. Input is capped first and the patterns are bounded. @req FR:email-voice/learn.examples */
export function redactExample(t: string): string {
  return redact(t.slice(0, 4000))
    .replace(/[\w.+-]{1,64}@[\w-]{1,63}(?:\.[\w-]{1,63}){1,8}/g, '[email]')
    .replace(/(?:\+\d{1,3}[ .-]?)?\(?\b\d{3}\)?[ .-]\d{3}[ .-]\d{4}\b/g, '[phone]')
    .replace(/\d{6,}/g, '[number]');
}

/** Builds the owner's voice profile from their sent mail. @req FR:email-voice/learn.profile */
export function learnVoice(sent: SentMessage[], opts: { account: string; owner: string[]; rules?: Pick<RulesConfig, 'sensitive' | 'sensitivePatterns'>; now?: Date }): VoiceProfile {
  const usable = sent
    .filter((s) => !isAutoReply(s.subject, s.body))
    .map((s) => ({ s, text: ownText(s.body), email: s.kind !== 'other' }))
    .filter((x) => words(bodyOf(x.text)) > 0);
  if (usable.length < MIN_SAMPLES) throw new Error(`Voice needs at least ${MIN_SAMPLES} sent messages with the owner's own text (got ${usable.length})`);

  const emails = usable.filter((x) => x.email);
  const formSrc = emails.length >= MIN_EMAIL_FORMS ? emails : usable;
  const bodies = usable.map((x) => bodyOf(x.text));
  const wc = bodies.map(words);
  const totalWords = wc.reduce((a, b) => a + b, 0) || 1;
  const sorted = [...wc].sort((a, b) => a - b);
  const sentences = bodies.flatMap((b) => b.split(/(?<=[.!?])\s+|\n+/)).map(words).filter((n) => n > 0).sort((a, b) => a - b);
  const share = (re: RegExp) => round(bodies.filter((b) => re.test(b)).length / bodies.length);
  const waived = CLICHE_RULES.filter((r) => usable.filter((x) => new RegExp(r.pattern, 'i').test(x.text)).length / usable.length >= WAIVE_SHARE).map((r) => r.id);

  const ownerDomains = new Set(opts.owner.map((o) => o.trim().toLowerCase().replace(/^@/, '')).map((o) => (o.includes('@') ? domainOf(o) : o)));
  const sensitive = (s: SentMessage) => s.to.some((t) => matches(t.address, opts.rules?.sensitive ?? []) || (opts.rules?.sensitivePatterns ?? []).some((p) => new RegExp(p, 'i').test(t.address)));
  const pool = usable
    .map((x, i) => ({ ...x, n: wc[i] }))
    // Writing from elsewhere is a weaker model of email: no long pieces, no lists. @req FR:email-voice/learn.sources
    .filter((x) => !sensitive(x.s) && (x.email || (bucketOf(x.n) !== 'long' && !BULLET.test(x.text))))
    .sort((a, b) => Number(b.email) - Number(a.email) || Date.parse(b.s.sentAt) - Date.parse(a.s.sentAt))
    .map((x) => ({
      subject: redactExample(x.s.subject.slice(0, 120)), text: redactExample(templateGreeting(x.text).slice(0, 1200)), bucket: bucketOf(x.n),
      audience: (x.s.to.length && x.s.to.every((t) => ownerDomains.has(domainOf(t.address))) ? 'internal' : 'external') as VoiceExample['audience'],
      source: (x.email ? 'email' : 'other') as VoiceExample['source'],
    }));
  // Round-robin over (length, audience) buckets, newest first in each, for spread.
  const groups = new Map<string, VoiceExample[]>();
  for (const e of pool) groups.set(`${e.bucket}/${e.audience}`, [...(groups.get(`${e.bucket}/${e.audience}`) ?? []), e]);
  const examples: VoiceExample[] = [];
  while (examples.length < MAX_EXAMPLES && [...groups.values()].some((g) => g.length)) for (const g of groups.values()) if (g.length && examples.length < MAX_EXAMPLES) examples.push(g.shift()!);

  return {
    version: 1, account: opts.account, learnedAt: (opts.now ?? new Date()).toISOString(), sampleCount: usable.length,
    greetings: shares(formSrc.map((x) => greetingOf(x.text).form)),
    signoffs: shares(formSrc.map((x) => signoffOf(x.text).form)),
    words: { p25: pct(sorted, 0.25), median: pct(sorted, 0.5), p75: pct(sorted, 0.75) },
    sentenceWords: pct(sentences, 0.5),
    rates: {
      contractionsPer100: round((bodies.reduce((a, b) => a + count(b, CONTRACTION), 0) / totalWords) * 100),
      exclamationsPerMsg: round(bodies.reduce((a, b) => a + count(b, /!/g), 0) / bodies.length),
      emDashPer100: round((bodies.reduce((a, b) => a + count(b, EM_DASH), 0) / totalWords) * 100),
      questionsPerMsg: round(bodies.reduce((a, b) => a + count(b, /\?/g), 0) / bodies.length),
      bulletShare: share(BULLET),
      emojiShare: share(EMOJI),
    },
    waived, examples,
  };
}
