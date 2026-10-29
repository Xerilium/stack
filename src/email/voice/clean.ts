/**
 * Sent mail to the owner's own words, and the shape helpers (greeting, sign-off, words) shared by learning and scoring.
 * @req FR:email-voice/learn.clean
 */

/** Where quoted history or a signature starts; everything from that line on is dropped. */
const CUT: RegExp[] = [
  /^On .{4,200}wrote:\s*$/,
  /^-{2,}\s*Original Message\s*-{2,}\s*$/i,
  /^-{2,}\s*Forwarded message\s*-{2,}\s*$/i,
  /^Begin forwarded message:\s*$/i,
  /^-- ?$/,
  /^_{5,}\s*$/,
  /^>/,
  /^(sent from my|get outlook for)\b/i,
];
/** Gmail wraps a long "On ... wrote:" over two lines. */
const WROTE_WRAPPED = /^On .{4,200}\s*$/;
const HEADER_FROM = /^From:\s.+/;
const HEADER_NEXT = /^(Sent|Date|To):\s/;
/** Auto-replies by subject; a body only when it says so outright (a real reply may start "Out of office tomorrow, but yes"). */
const AUTO_SUBJECT = /^(automatic reply|auto(matic)?[- ]?(reply|response)|out of (the )?office)\b/i;
const AUTO_BODY = /^(automatic reply|auto(matic)?[- ]?(reply|response))\b/i;

const CLOSE_WORDS = 'many thanks|thanks( again| so much)?|thank you|thx|ty|best( regards| wishes)?|kind regards|warm regards|warmly|regards|cheers|sincerely|talk soon|all the best|take care';
/** A closing line: "Thanks,", "Best!", "Cheers". */
export const CLOSING = new RegExp(`^(${CLOSE_WORDS})\\s*[,.!]?$`, 'i');
/** A closing and the name on one line: "Thanks, Sam". */
const CLOSING_NAMED = new RegExp(`^(${CLOSE_WORDS})\\s*[,.!]?\\s+(?<name>-?\\p{L}[\\p{L}'-]*)$`, 'iu');
/** The name from "Thanks, Sam", only when it is capitalized. */
const closingName = (l: string): string | undefined => { const n = CLOSING_NAMED.exec(l)?.groups?.name; return n && /^-?\p{Lu}/u.test(n) ? n : undefined; };
/** A name line: one to three capitalized words, or "-Name", optionally "Name / mobile". */
const NAME = /^-?\s?\p{Lu}[\p{L}'-]*( \p{Lu}[\p{L}'.-]*){0,2}( \/ [\p{L} ]{1,20})?$/u;
const GREETING = /^(hi|hey|hello|dear|morning|good (morning|afternoon|evening)|hiya|greetings)\b/i;
const GROUP = /^(all|team|everyone|folks|there|guys|y'all|both|everybody)$/i;
/** Words that open a reply but are not a name: "Yes," "Thanks," "Sure,". */
const NOT_NAME = new RegExp(`^(${CLOSE_WORDS}|yes|yep|yeah|no|nope|ok|okay|sure|done|agreed|great|perfect|correct|right|absolutely|also|so|well|actually|update|fyi|note|heads up)$`, 'i');
/** A signature line: no sentence ending, or a contact marker. */
/** A signature line: a contact marker, a bare domain, or a short name/title line ("Sam Owner", "CEO, Acme Corp"). Prose with no period ("Will do") is not one. */
const SIG_LINE = /[|·・•@]|\+?\d[\d ().-]{6,}|https?:|www\.|\.(com|net|org|io)\b|^[\w-]+(\.[\w-]+)+$/i;
const TITLE_LINE = /^[\p{Lu}\d&][\p{L}\d&'’.,|-]*(?: (?:of|and|for|the|[\p{Lu}\d&][\p{L}\d&'’.,|-]*)){0,7}$/u;
const isSigLine = (l: string) => { const t = l.trim(); return SIG_LINE.test(t) || ((NAME.test(t) || TITLE_LINE.test(t)) && !NOT_NAME.test(t.replace(/[^\p{L}' ]/gu, ''))); };

export const paragraphs = (t: string): string[] => t.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
export const isAutoReply = (subject: string, body = ''): boolean => AUTO_SUBJECT.test(subject.trim()) || AUTO_BODY.test(body.trim());

/** Index of the sign-off paragraph: a closing line ("Thanks,"), a lone name, or a name over a signature. Only signature lines may follow it. */
function signoffAt(paras: string[]): number {
  // Paragraphs from `tail` on are all signature-like, so a sign-off can only sit at tail - 1 or later (one pass, not quadratic).
  let tail = paras.length;
  while (tail > 0 && paras[tail - 1].split('\n').every(isSigLine)) tail--;
  for (let i = Math.max(1, tail - 1); i < paras.length; i++) {
    const lines = paras[i].split('\n').map((l) => l.trim());
    if (CLOSING.test(lines[0]) || closingName(lines[0])) return i;
    if (NAME.test(lines[0]) && !NOT_NAME.test(lines[0].replace(/[^\p{L}' ]/gu, '')) && lines.slice(1).every(isSigLine)) return i;
  }
  return -1;
}
const signoffLines = (p: string): string[] => {
  const lines = p.split('\n').map((l) => l.trim());
  const name = closingName(lines[0]);
  const kept = name ? [lines[0].slice(0, lines[0].length - name.length).trim(), name] : CLOSING.test(lines[0]) ? lines.slice(0, NAME.test(lines[1] ?? '') ? 2 : 1) : lines.slice(0, 1);
  return kept.map((l) => (NAME.test(l) ? l.replace(/ \/ [\p{L} ]+$/u, '') : l));
};

/** Keeps only what the owner wrote: no quoted history, no signature block, tidy whitespace. @req FR:email-voice/learn.clean */
export function ownText(body: string): string {
  const lines = body.replace(/\r\n?/g, '\n').split('\n');
  if (AUTO_BODY.test(lines.find((l) => l.trim()) ?? '')) return '';
  let end = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trimEnd();
    const wrapped = WROTE_WRAPPED.test(l) && /^\S.{0,200}wrote:\s*$/.test((lines[i + 1] ?? '').trim()) && /^On .{4,400}wrote:\s*$/.test(`${l} ${(lines[i + 1] ?? '').trim()}`);
    if (CUT.some((re) => re.test(l)) || wrapped || (HEADER_FROM.test(l) && lines.slice(i + 1, i + 4).some((n) => HEADER_NEXT.test(n)))) { end = i; break; }
  }
  const paras = paragraphs(lines.slice(0, end).map((l) => l.trim()).join('\n'));
  const s = signoffAt(paras);
  const kept = s >= 0 ? [...paras.slice(0, s), signoffLines(paras[s]).join('\n')] : paras;
  return kept.join('\n\n').trim();
}

/**
 * The greeting as a form: "Hi Alex," to "Hi {name},", "Hi, Becky." to "Hi, {name}.", "Alex," to "{name},", "Hey, there!" kept as is.
 * Inline greetings share their line with the first sentence; `length` is how much of the first paragraph they take.
 */
export function greetingOf(text: string): { form: string; index: number; length: number } {
  const none = { form: '', index: -1, length: 0 };
  const first = paragraphs(text)[0] ?? '';
  const g = GREETING.exec(first);
  if (g) {
    const rest = first.slice(g[0].length);
    const m = /^(,?\s+)((?:(?:Mr|Mrs|Ms|Mx|Dr|Prof)\.? )?\p{L}[\p{L}'-]*(?: \p{Lu}[\p{L}'-]*){0,2})\s*([,!:.])(?=\s|$)/u.exec(rest) ?? /^()()\s*([,!:.])(?=\s|$)/.exec(rest);
    if (m) {
      // A lowercase name ("Hi alex,") is still a name; only group words ("Hi all,") stay literal.
      const who = !m[2] ? '' : GROUP.test(m[2]) ? m[2].toLowerCase() : '{name}';
      if (who !== null) return { form: `${g[0]}${who ? `${m[1].includes(',') ? ', ' : ' '}${who}` : ''}${m[3]}`, index: 0, length: g[0].length + m[0].length };
    }
    if (!first.includes('\n') && first.split(/\s+/).length <= 3) return { form: first, index: 0, length: first.length };
    return none;
  }
  const n = /^(\p{Lu}[\p{L}'-]*(?: \p{Lu}[\p{L}'-]*){0,2})\s*([,:])(?=\s|$)/u.exec(first);
  if (n && !NOT_NAME.test(n[1]) && (first.length === n[0].length || /^\s*\n/.test(first.slice(n[0].length)))) return { form: `{name}${n[2]}`, index: 0, length: n[0].length };
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

/** Replaces the recipient's name in a greeting with `{name}`, so examples carry no first names. @req FR:email-voice/learn.examples */
export function templateGreeting(text: string): string {
  const g = greetingOf(text);
  if (g.index !== 0) return text;
  const t = text.trimStart();
  return `${g.form}${t.slice(g.length)}`;
}

export const words = (t: string): number => (t.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) ?? []).length;
