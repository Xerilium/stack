/**
 * Draft check: cliche rules plus shape relative to the owner's profile. Pure and deterministic, so it costs no tokens.
 * @req FR:email-voice/score.draft @req FR:email-voice/cliche.shape @req FR:email-voice/cliche.own
 */
import { DRAFT_MARKER } from '../draft';
import { CLICHE_RULES, type Severity } from './cliches';
import { bodyOf, greetingOf, signoffOf, words } from './clean';
import { BULLET, EMOJI, EM_DASH, type VoiceProfile } from './learn';

export interface Violation { id: string; severity: Severity; match: string; why: string }
export interface VoiceScore { score: number; pass: boolean; violations: Violation[] }

export const HARD_COST = 25;
export const SOFT_COST = 8;
export const PASS_SCORE = 70;
/** Below this many em dashes per 100 words the owner counts as never using them. */
const NEAR_ZERO = 0.2;

const clipMatch = (s: string) => (s.length > 60 ? `${s.slice(0, 57)}...` : s).replace(/\n/g, ' ');
const knows = (forms: { text: string; share: number }[], form: string) => !forms.length || forms.some((f) => f.text.toLowerCase() === form.toLowerCase());

/** Scores a draft against the owner's voice. The AI draft marker is ignored. @req FR:email-voice/score.draft */
export function scoreDraft(draft: string, p: VoiceProfile): VoiceScore {
  const text = draft.replace(/\r\n?/g, '\n').replace(DRAFT_MARKER, '').trim();
  const body = bodyOf(text);
  const n = words(body);
  const v: Violation[] = [];
  const add = (id: string, severity: Severity, match: string, why: string) => v.push({ id, severity, match: clipMatch(match), why });

  for (const r of CLICHE_RULES) {
    if (p.waived.includes(r.id)) continue;
    // The owner's own sign-off is never a cliche, however rare.
    if (r.id === 'formal-signoff' && p.signoffs.some((f) => new RegExp(r.pattern, 'i').test(f.text))) continue;
    const m = new RegExp(r.pattern, 'i').exec(text);
    if (m) add(r.id, r.severity, m[0].trim(), r.why);
  }

  const dashes = text.match(EM_DASH) ?? [];
  if (dashes.length) {
    if (p.rates.emDashPer100 < NEAR_ZERO) add('em-dash', dashes.length >= 2 ? 'hard' : 'soft', `${dashes.length} em dash${dashes.length > 1 ? 'es' : ''}`, 'owner does not use em dashes');
    else if (dashes.length > Math.ceil((p.rates.emDashPer100 * n) / 100) + 1) add('em-dash', 'soft', `${dashes.length} em dashes`, 'more than the owner uses');
  }
  const bangs = (body.match(/!/g) ?? []).length;
  if (bangs > p.rates.exclamationsPerMsg + 1) add('exclamations', 'soft', `${bangs} exclamation marks`, 'more than the owner uses');
  if (p.words.p75 > 0 && n > 3 * p.words.p75) add('length', 'hard', `${n} words`, `owner usually writes ${p.words.p25}-${p.words.p75}`);
  else if (p.words.p75 > 0 && n > 2 * p.words.p75) add('length', 'soft', `${n} words`, `owner usually writes ${p.words.p25}-${p.words.p75}`);
  const g = greetingOf(text).form;
  if (!knows(p.greetings, g)) add('greeting', 'soft', g || '(no greeting)', 'owner does not open this way');
  const s = signoffOf(text).form;
  // A formal sign-off already flagged is not flagged twice.
  if (!knows(p.signoffs, s) && !v.some((x) => x.id === 'formal-signoff')) add('signoff', 'soft', s || '(no sign-off)', 'owner does not close this way');
  if (p.rates.bulletShare < 0.1 && BULLET.test(body)) add('bullets', 'soft', 'bullet list', 'owner rarely uses bullets');
  const nb = /\bnot (?:just |only |merely )?(?:a|an|the|about|because)\b[^,.;!?\n]{1,40}, but\b/i.exec(body);
  if (nb) add('not-but', 'soft', nb[0], '"not X, but Y" is an AI tell');
  const tri = /\b(?:a|an|the) [a-z]+, [a-z]+,? (?:and )?[a-z]+ [a-z]+\b/.exec(body);
  if (tri) add('triple', 'soft', tri[0], 'three-adjective runs read as generated');
  if (p.rates.emojiShare === 0 && EMOJI.test(body)) add('emoji', 'soft', 'emoji', 'owner does not use emoji');

  v.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'hard' ? -1 : 1));
  const score = Math.max(0, 100 - v.reduce((t, x) => t + (x.severity === 'hard' ? HARD_COST : SOFT_COST), 0));
  return { score, pass: score >= PASS_SCORE && !v.some((x) => x.severity === 'hard'), violations: v };
}
