/**
 * Sent mail to the owner's own words, and the shape helpers (greeting, sign-off, words) shared by learning and scoring.
 * @req FR:email-voice/learn.clean
 */

/** Where quoted history or a signature starts; everything from that line on is dropped. */
const CUT: RegExp[] = [
  /^On .{4,200}wrote:\s*$/,
  /^-{2,}\s*Original Message\s*-{2,}\s*$/i,
  /^-- ?$/,
  /^_{5,}\s*$/,
  /^>/,
];
const HEADER_FROM = /^From:\s.+/;
const HEADER_NEXT = /^(Sent|Date|To):\s/;
const AUTO = /^(automatic reply|auto(matic)?[- ]?response|out of (the )?office)\b/i;

/** A closing line: "Thanks,", "Best!", "Cheers". */
export const CLOSING = /^(many thanks|thanks( again| so much)?|thank you|thx|ty|best( regards| wishes)?|kind regards|warm regards|warmly|regards|cheers|sincerely|talk soon|all the best|take care)\s*[,.!]?$/i;
/** A name line: one or two capitalized words, or "-Name". */
const NAME = /^-?\s?[A-Z][\w'-]*( [A-Z][\w'.-]*)?$/;
const GREETING = /^(hi|hey|hello|dear|morning|good (morning|afternoon|evening)|hiya|greetings)\b/i;

export const paragraphs = (t: string): string[] => t.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
export const isAutoReply = (subjectOrBody: string): boolean => AUTO.test(subjectOrBody.trim());

function signoffAt(paras: string[]): number {
  for (let i = 1; i < paras.length; i++) {
    const lines = paras[i].split('\n').map((l) => l.trim());
    if (CLOSING.test(lines[0]) && lines.length <= 3) return i;
    if (lines.length <= 2 && lines.every((l) => NAME.test(l))) return i;
  }
  return -1;
}

/** Keeps only what the owner wrote: no quoted history, no signature block, tidy whitespace. @req FR:email-voice/learn.clean */
export function ownText(body: string): string {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  if (isAutoReply(lines.find((l) => l.trim()) ?? '')) return '';
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trimEnd();
    if (CUT.some((re) => re.test(l)) || (HEADER_FROM.test(l) && lines.slice(i + 1, i + 4).some((n) => HEADER_NEXT.test(n)))) { end = i; break; }
  }
  const paras = paragraphs(lines.slice(0, end).map((l) => l.replace(/[ \t]+$/, '').replace(/^[ \t]+/, '')).join('\n'));
  const s = signoffAt(paras);
  const kept = s >= 0 ? [...paras.slice(0, s), paras[s].split('\n').slice(0, 2).join('\n')] : paras;
  return kept.join('\n\n').trim();
}

/** "Hi Alex," to "Hi {name},"; "Alex," to "{name},"; no greeting line to "". */
export function greetingOf(text: string): { form: string; index: number } {
  const first = paragraphs(text)[0] ?? '';
  if (first.includes('\n') || first.split(/\s+/).length > 5) return { form: '', index: -1 };
  const g = GREETING.exec(first);
  if (g) {
    const rest = first.slice(g[0].length);
    const named = /^\s+[A-Z][\w'-]*(?:\s+[A-Z][\w'-]*)?\s*([,!:.]?)$/.exec(rest);
    return { form: named ? `${g[0]} {name}${named[1]}` : first, index: 0 };
  }
  if (/^[A-Z][\w'-]*( [A-Z][\w'-]*)?\s*[,:]$/.test(first)) return { form: `{name}${first.trim().slice(-1)}`, index: 0 };
  return { form: '', index: -1 };
}

/** "Thanks,\nSam" to "Thanks,\n{me}"; no sign-off to "". */
export function signoffOf(text: string): { form: string; index: number } {
  const paras = paragraphs(text);
  const i = signoffAt(paras);
  if (i < 0) return { form: '', index: -1 };
  const form = paras[i].split('\n').map((l) => l.trim()).map((l) => (CLOSING.test(l) ? l : NAME.test(l) ? (l.startsWith('-') ? '-{me}' : '{me}') : l)).join('\n');
  return { form, index: i };
}

/** The message body without its greeting and sign-off paragraphs. */
export function bodyOf(text: string): string {
  const paras = paragraphs(text);
  const g = greetingOf(text).index;
  const s = signoffOf(text).index;
  return paras.filter((_, i) => i !== g && (s < 0 || i < s)).join('\n\n');
}

export const words = (t: string): number => (t.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
