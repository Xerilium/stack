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
  /^(sent from my|get outlook for)\b/i,
];
const HEADER_FROM = /^From:\s.+/;
const HEADER_NEXT = /^(Sent|Date|To):\s/;
const AUTO = /^(automatic reply|auto(matic)?[- ]?response|out of (the )?office)\b/i;

/** A closing line: "Thanks,", "Best!", "Cheers". */
export const CLOSING = /^(many thanks|thanks( again| so much)?|thank you|thx|ty|best( regards| wishes)?|kind regards|warm regards|warmly|regards|cheers|sincerely|talk soon|all the best|take care)\s*[,.!]?$/i;
/** A name line: one or two capitalized words, or "-Name", optionally "Name / mobile". */
const NAME = /^-?\s?[A-Z][\w'-]*( [A-Z][\w'.-]*)?( \/ [\w ]{1,20})?$/;
const GREETING = /^(hi|hey|hello|dear|morning|good (morning|afternoon|evening)|hiya|greetings)\b/i;
const GROUP = /^(all|team|everyone|folks|there|guys|y'all|both|everybody)$/i;

export const paragraphs = (t: string): string[] => t.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
export const isAutoReply = (subjectOrBody: string): boolean => AUTO.test(subjectOrBody.trim());

/** Index of the sign-off paragraph: a closing line ("Thanks,"), a lone name, or the last paragraph opening with a name (a signature follows). */
function signoffAt(paras: string[]): number {
  for (let i = 1; i < paras.length; i++) {
    const lines = paras[i].split('\n').map((l) => l.trim());
    if (CLOSING.test(lines[0]) && lines.length <= 3) return i;
    if (lines.length <= 2 && lines.every((l) => NAME.test(l))) return i;
    if (i === paras.length - 1 && NAME.test(lines[0])) return i;
  }
  return -1;
}
const signoffLines = (p: string): string[] => {
  const lines = p.split('\n').map((l) => l.trim());
  const kept = CLOSING.test(lines[0]) ? lines.slice(0, 2) : lines.slice(0, NAME.test(lines[1] ?? '') ? 2 : 1);
  return kept.map((l) => (NAME.test(l) ? l.replace(/ \/ [\w ]+$/, '') : l));
};

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
  const kept = s >= 0 ? [...paras.slice(0, s), signoffLines(paras[s]).join('\n')] : paras;
  return kept.join('\n\n').trim();
}

/**
 * The greeting as a form: "Hi Alex," to "Hi {name},", "Hi, Becky." to "Hi, {name}.", "Alex," to "{name},", "Hey, there!" kept as is.
 * `inline` greetings share their line with the first sentence; `length` is how much of the first paragraph they take.
 */
export function greetingOf(text: string): { form: string; index: number; length: number } {
  const none = { form: '', index: -1, length: 0 };
  const first = paragraphs(text)[0] ?? '';
  const g = GREETING.exec(first);
  if (g) {
    const rest = first.slice(g[0].length);
    const m = /^(,?\s+)([A-Za-z][\w'-]*(?: [A-Z][\w'-]*)?)\s*([,!:.])(?=\s|$)/.exec(rest) ?? /^()()\s*([,!:.])(?=\s|$)/.exec(rest);
    if (m) {
      const who = !m[2] ? '' : GROUP.test(m[2]) ? m[2].toLowerCase() : /^[A-Z]/.test(m[2]) ? '{name}' : null;
      if (who !== null) return { form: `${g[0]}${who ? `${m[1].includes(',') ? ', ' : ' '}${who}` : ''}${m[3]}`, index: 0, length: g[0].length + m[0].length };
    }
    if (!first.includes('\n') && first.split(/\s+/).length <= 3) return { form: first, index: 0, length: first.length };
    return none;
  }
  const n = /^[A-Z][\w'-]*( [A-Z][\w'-]*)?\s*([,:])(?=\s|$)/.exec(first);
  if (n && (first.length === n[0].length || /^\s*\n/.test(first.slice(n[0].length)))) return { form: `{name}${n[2]}`, index: 0, length: n[0].length };
  return none;
}

/** "Thanks,\nSam" to "Thanks,\n{me}"; no sign-off to "". */
export function signoffOf(text: string): { form: string; index: number } {
  const paras = paragraphs(text);
  const i = signoffAt(paras);
  if (i < 0) return { form: '', index: -1 };
  const form = signoffLines(paras[i]).map((l) => (CLOSING.test(l) ? l : NAME.test(l) ? (l.startsWith('-') ? '-{me}' : '{me}') : l)).join('\n');
  return { form, index: i };
}

/** The message body without its greeting and sign-off. */
export function bodyOf(text: string): string {
  const paras = paragraphs(text);
  const g = greetingOf(text);
  const s = signoffOf(text).index;
  if (g.index === 0) paras[0] = paras[0].slice(g.length).trim();
  return paras.filter((p, i) => p && (s < 0 || i < s)).join('\n\n');
}

export const words = (t: string): number => (t.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
