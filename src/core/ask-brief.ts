/**
 * The brief on an ask: the context the owner needs to decide without opening the link.
 * Agents send it with an ask (report or ask file); Stack validates it the same way everywhere.
 * @req FR:ask-briefs/$brief @req FR:ask-briefs/brief.validate @req FR:ask-briefs/brief.store
 */

/** One brief. @req FR:ask-briefs/$brief */
export interface AskBrief { problem: string; solution: string; risks: string[]; recommendation: string; evidence?: string[] }
export interface BriefIssue { field: string; message: string }

export const BRIEF_MAX_WORDS = 120;
export const BRIEF_MAX_SENTENCE = 25;
const MAX_TEXT = 400;
const MAX_ITEMS = 5;
const KEYS = ['problem', 'solution', 'risks', 'recommendation', 'evidence'] as const;
/** Control, line-break and invisible format characters (ZWJ is kept so emoji sequences pass). */
const BAD_CHARS = new RegExp('[\\p{Cc}\\u0085\\u2028\\u2029]|(?!\\u200d)\\p{Cf}', 'u');
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isHttps = (v: string) => { try { return new URL(v).protocol === 'https:'; } catch { return false; } };

const words = (t: string): number => (t.match(/\S+/g) ?? []).length;
/** Sentences end at `.`, `!`, `?` or `;` followed by a space or the end. A url's dots never end one. */
const sentences = (t: string): string[] => t.split(/(?<=[.!?;])\s+/).map((s) => s.trim()).filter(Boolean);

/** Total words in the text fields (evidence links are not counted). */
export const briefWords = (b: AskBrief): number => [b.problem, b.solution, ...b.risks, b.recommendation].reduce((n, t) => n + words(t), 0);

/**
 * Checks a brief: only the five keys; `problem`, `solution`, `recommendation` one line each; `risks` 1-5 lines;
 * `evidence` 0-5 https urls; at most 120 words in all and 25 words per sentence (Simplified Technical English).
 * Returns the clean brief, or the issues (field names start with `prefix`).
 * @req FR:ask-briefs/brief.validate
 */
export function checkBrief(raw: unknown, prefix = 'brief'): { brief?: AskBrief; issues: BriefIssue[] } {
  const issues: BriefIssue[] = [];
  const bad = (field: string, message: string) => { issues.push({ field: field ? `${prefix}.${field}` : prefix, message }); };
  if (!isObj(raw)) { bad('', 'Must be an object {problem, solution, risks, recommendation, evidence?}'); return { issues }; }
  for (const k of Object.keys(raw)) if (!(KEYS as readonly string[]).includes(k)) bad(k, 'Unknown field');
  const text = (field: string, v: unknown): string | undefined => {
    if (v === undefined) { bad(field, 'Required'); return undefined; }
    if (typeof v !== 'string') { bad(field, 'Must be a string'); return undefined; }
    if (BAD_CHARS.test(v)) { bad(field, 'Must be one line with no control or invisible characters'); return undefined; }
    const t = v.replace(/\s+/g, ' ').trim();
    if (!t) { bad(field, 'Must not be empty'); return undefined; }
    if (t.length > MAX_TEXT) { bad(field, `Must be at most ${MAX_TEXT} characters`); return undefined; }
    const long = sentences(t).find((s) => words(s) > BRIEF_MAX_SENTENCE);
    if (long) { bad(field, `Each sentence must be at most ${BRIEF_MAX_SENTENCE} words (Simplified Technical English)`); return undefined; }
    return t;
  };
  const problem = text('problem', raw.problem);
  const solution = text('solution', raw.solution);
  const recommendation = text('recommendation', raw.recommendation);
  let risks: string[] = [];
  if (!Array.isArray(raw.risks)) bad('risks', 'Must list 1-5 risks or cons');
  else if (raw.risks.length < 1 || raw.risks.length > MAX_ITEMS) bad('risks', 'Must list 1-5 risks or cons');
  else risks = raw.risks.map((r, i) => text(`risks[${i}]`, r)).filter((r): r is string => !!r);
  let evidence: string[] | undefined;
  if (raw.evidence !== undefined) {
    if (!Array.isArray(raw.evidence) || raw.evidence.length > MAX_ITEMS) bad('evidence', 'Must list at most 5 https links');
    else {
      evidence = raw.evidence.flatMap((u, i) => {
        if (typeof u !== 'string' || u.length > 2000 || /\s/.test(u) || BAD_CHARS.test(u) || !isHttps(u)) { bad(`evidence[${i}]`, 'Must be an https url'); return []; }
        return [u];
      });
    }
  }
  if (issues.length || !problem || !solution || !recommendation) return { issues };
  const brief: AskBrief = { problem, solution, risks, recommendation, ...(evidence?.length ? { evidence } : {}) };
  const n = briefWords(brief);
  if (n > BRIEF_MAX_WORDS) { bad('', `Must be at most ${BRIEF_MAX_WORDS} words in all (has ${n})`); return { issues }; }
  return { brief, issues };
}

/** Kinds that need a brief before the owner can go with the recommendation. @req FR:ask-briefs/brief.lint */
export const BRIEF_KINDS = ['approve', 'decide'] as const;
export const needsBrief = (kind: string | undefined, brief: unknown): boolean => (BRIEF_KINDS as readonly string[]).includes(kind ?? '') && !brief;

/** The brief as markdown lines under `## Brief` in an ask file. @req FR:ask-briefs/brief.store */
export function formatBriefLines(b: AskBrief): string[] {
  return [`- problem: ${b.problem}`, `- solution: ${b.solution}`, ...b.risks.map((r) => `- risk: ${r}`), `- recommendation: ${b.recommendation}`, ...(b.evidence ?? []).map((u) => `- evidence: ${u}`)];
}

/** Reads `## Brief` lines back; a brief that no longer passes the check is dropped. @req FR:ask-briefs/brief.store */
export function parseBriefLines(lines: string[]): AskBrief | undefined {
  const raw: { problem?: string; solution?: string; recommendation?: string; risks: string[]; evidence: string[] } = { risks: [], evidence: [] };
  for (const l of lines) {
    const m = /^- (problem|solution|risk|recommendation|evidence): (.*)$/.exec(l.trim());
    if (!m) continue;
    if (m[1] === 'risk') raw.risks.push(m[2]); else if (m[1] === 'evidence') raw.evidence.push(m[2]); else raw[m[1] as 'problem'] = m[2];
  }
  if (!raw.problem && !raw.solution && !raw.recommendation) return undefined;
  return checkBrief({ problem: raw.problem, solution: raw.solution, risks: raw.risks, recommendation: raw.recommendation, ...(raw.evidence.length ? { evidence: raw.evidence } : {}) }).brief;
}
