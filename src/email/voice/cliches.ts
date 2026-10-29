/**
 * Phrases that mark text as machine-written. Plain data; the owner's own habits waive a rule (see `learnVoice`).
 * @req FR:email-voice/cliche.list
 */

export type Severity = 'hard' | 'soft';
export interface ClicheRule {
  id: string;
  /** Case-insensitive regex source. Apostrophes match both ' and ’. */
  pattern: string;
  severity: Severity;
  /** What the guide shows under "Never write". */
  label: string;
  why: string;
}

const A = "['’]";
export const CLICHE_RULES: readonly ClicheRule[] = [
  { id: 'hope-finds-well', pattern: '\\bhope (this|the|my) (e-?mail|message|note) finds you( well)?', severity: 'hard', label: 'I hope this email finds you well', why: 'stock opener' },
  { id: 'hope-doing-well', pattern: `\\bI hope (you${A}re|you are|you${A}ve been|all is|everything is) (doing )?well`, severity: 'hard', label: "I hope you're doing well", why: 'stock opener' },
  { id: 'thanks-reaching-out', pattern: '\\bthank(s| you) (so much )?for (reaching out|your (e-?mail|message))', severity: 'hard', label: 'Thank you for reaching out', why: 'stock opener' },
  { id: 'wanted-reach-out', pattern: '\\bI (just )?wanted to (reach out|touch base|follow up)', severity: 'hard', label: 'I wanted to reach out', why: 'padding' },
  { id: 'dont-hesitate', pattern: `\\b(please )?(don${A}t|do not) hesitate to`, severity: 'hard', label: "Please don't hesitate to", why: 'stock closer' },
  { id: 'feel-free', pattern: '\\bfeel free to (reach out|contact|let me know|ask)', severity: 'hard', label: 'Feel free to reach out', why: 'stock closer' },
  { id: 'any-questions', pattern: '\\blet me know if you have any (other |further |more )?(questions|concerns)', severity: 'hard', label: 'Let me know if you have any questions', why: 'stock closer' },
  { id: 'hope-this-helps', pattern: '\\bhope (this|that) helps', severity: 'hard', label: 'Hope this helps', why: 'stock closer' },
  { id: 'happy-to', pattern: `\\bI${A}?d be (happy|glad|delighted) to`, severity: 'hard', label: "I'd be happy to", why: 'assistant voice' },
  { id: 'great-question', pattern: '\\b(great|good|excellent) question', severity: 'hard', label: 'Great question', why: 'assistant voice' },
  { id: 'apologize-inconvenience', pattern: '\\bapologi[sz]e for any (inconvenience|confusion)', severity: 'hard', label: 'I apologize for any inconvenience', why: 'corporate padding' },
  { id: 'understand-concern', pattern: '\\bI (completely |totally )?understand your (concern|frustration)', severity: 'hard', label: 'I understand your concern', why: 'assistant voice' },
  { id: 'rest-assured', pattern: '\\brest assured', severity: 'hard', label: 'Rest assured', why: 'corporate padding' },
  { id: 'delve', pattern: '\\bdelv(e|es|ed|ing)\\b', severity: 'hard', label: 'delve', why: 'AI tell' },
  { id: 'tapestry', pattern: '\\b(rich )?tapestry\\b', severity: 'hard', label: 'tapestry', why: 'AI tell' },
  { id: 'testament', pattern: '\\b(a |is a )?testament to\\b', severity: 'hard', label: 'a testament to', why: 'AI tell' },
  { id: 'navigate-complexities', pattern: '\\bnavigat(e|ing) the (complexities|landscape|intricacies)', severity: 'hard', label: 'navigate the complexities', why: 'AI tell' },
  { id: 'fast-paced', pattern: `\\bin today${A}s (fast-paced|ever-changing|digital)`, severity: 'hard', label: "in today's fast-paced world", why: 'AI tell' },
  { id: 'worth-noting', pattern: `\\bit${A}s (worth noting|important to note)`, severity: 'hard', label: "it's worth noting", why: 'AI tell' },
  { id: 'buzzword', pattern: '\\b(leverag(e|es|ed|ing)|seamless(ly)?|robust|streamlin(e|ed|es|ing)|elevat(e|es|ed|ing)|foster(s|ed|ing)?|game[- ]changer|synerg(y|ies)|cutting[- ]edge|empower(s|ed|ing)?|holistic)\\b', severity: 'soft', label: 'leverage, seamless, robust, streamline, elevate, foster, game-changer', why: 'buzzword' },
  { id: 'moving-forward', pattern: '\\b(moving forward|going forward|at the end of the day|circle back)\\b', severity: 'soft', label: 'moving forward, circle back', why: 'filler' },
  { id: 'eager-opener', pattern: '(^|\\n|[.!?]\\s+)(absolutely|certainly|definitely|of course)!', severity: 'soft', label: 'Absolutely! / Certainly!', why: 'assistant voice' },
  { id: 'formal-signoff', pattern: '(^|\\n)\\s*(best|warm|kind|warmest) regards\\b', severity: 'soft', label: 'Best regards / Warm regards', why: 'template sign-off' },
];

export const ruleById = (id: string): ClicheRule | undefined => CLICHE_RULES.find((r) => r.id === id);
