/**
 * Quick capture: deterministic natural-language / speech parser that turns a phrase into a task row.
 * No LLM, no I/O besides `addTask`; the clock is injected.
 * @req FR:quick-capture/parse.@function @req FR:quick-capture/parse.due @req FR:quick-capture/parse.effort @req FR:quick-capture/parse.project
 * @req FR:quick-capture/parse.recurrence @req FR:quick-capture/parse.title @req FR:quick-capture/speech.fillers
 * @req FR:quick-capture/speech.numbers @req FR:quick-capture/speech.case @req FR:quick-capture/map.row @req FR:quick-capture/map.add
 */
import { getDefaults } from './config';
import { addTask, LifecycleError, type LifecycleContext, type LifecycleResult } from './lifecycle';
import type { Cadence, IsoDate, Recurrence, Weekday } from './model';

export class CaptureError extends Error {}

export interface CaptureSpec {
  title: string;
  due?: IsoDate;
  effort?: { minutes: number; emoji: string };
  /** Project hint as typed (`#name`, `@name`, `in project name`). */
  project?: string;
  recurrence?: Recurrence;
}

export interface ParseOptions { now?: () => Date; /** IANA zone defining "today"; defaults to UTC. */ timeZone?: string }

const DAY_MS = 86400000;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const MONTH_LABEL = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const WEEKDAY_IDS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const CADENCE_LABEL: Record<Cadence, string> = { daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', quarterly: 'Quarterly', yearly: 'Yearly' };

const WD_FULL = DAYS.join('|');
const WD_ABBR = 'mon|tues?|wed|thu(?:rs?)?|fri|sat|sun';
const WD_ANY = `${WD_FULL}|mon|tues?|wed|thu(?:rs?)?|fri|sat|sun`;
const MON_RE = 'january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sept?|oct|nov|dec';

const ONES = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const NUM = `(?:(?:${Object.keys(TENS).join('|')})(?:[ -](?:one|two|three|four|five|six|seven|eight|nine))?|${ONES.slice().reverse().join('|')}|a hundred|hundred)`;
const UNIT_AHEAD = '(?=\\s*(?:minutes?|mins?|hours?|hrs?|days?|weeks?|and a half)\\b)';

const wordToNumber = (w: string): number => {
  const s = w.toLowerCase().replace('-', ' ');
  if (s === 'a hundred' || s === 'hundred') return 100;
  const [a, b] = s.split(' ');
  if (a in TENS) return TENS[a] + (b ? ONES.indexOf(b) : 0);
  return ONES.indexOf(a);
};

/** Calendar date (y, 0-based month, d) of an instant in `tz`, as a UTC-midnight Date. */
function localDay(at: Date, tz: string): Date {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, year: 'numeric', month: 'numeric', day: 'numeric' }).formatToParts(at);
  const n = (t: string) => Number(parts.find((p) => p.type === t)!.value);
  return utc(n('year'), n('month') - 1, n('day'));
}

const utc = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (d: Date, n: number) => new Date(d.getTime() + n * DAY_MS);
const wdIndex = (name: string): number => {
  const n = name.toLowerCase();
  return DAYS.findIndex((d) => d === n || (n.length >= 3 && d.startsWith(n.slice(0, 3))));
};
const validDate = (y: number, m: number, d: number): Date | null => {
  const x = utc(y, m, d);
  return x.getUTCFullYear() === y && x.getUTCMonth() === m && x.getUTCDate() === d ? x : null;
};

const effortEmoji = (m: number) => (m <= 12 ? '🔹' : m <= 30 ? '🟢' : m <= 60 ? '🟡' : m <= 120 ? '🟠' : m <= 240 ? '🔴' : '⚫️');

/** Removes the first match of `re` from `s`; returns the match and the remaining text. */
function take(s: string, re: RegExp): { m: RegExpExecArray | null; rest: string } {
  const m = re.exec(s);
  return m ? { m, rest: `${s.slice(0, m.index)} ${s.slice(m.index + m[0].length)}` } : { m: null, rest: s };
}

const PRE = '(?:(?:for|takes?|about|around)\\s+)?';
const EFFORT_RES: [RegExp, (m: RegExpExecArray) => number][] = [
  [new RegExp(`${PRE}(?<![\\w.])(\\d+)\\s*h(?:ours?|rs?)?\\s*(?:and\\s*)?(\\d+)\\s*m(?:in(?:ute)?s?)?\\b`, 'i'), (m) => Number(m[1]) * 60 + Number(m[2])],
  [new RegExp(`${PRE}(?<![\\w.])(\\d+)\\s+and\\s+a\\s+half\\s+hours?\\b`, 'i'), (m) => Number(m[1]) * 60 + 30],
  [new RegExp(`${PRE}\\b(?:an?\\s+)?hour\\s+and\\s+a\\s+half\\b`, 'i'), () => 90],
  [new RegExp(`${PRE}\\b(?:an?\\s+)?half[ -](?:an\\s+)?hour\\b`, 'i'), () => 30],
  [new RegExp(`${PRE}\\ban?\\s+hour\\b`, 'i'), () => 60],
  [new RegExp(`${PRE}(?<![\\w.])(\\d+(?:\\.\\d+)?)\\s*(?:h|hrs?|hours?)\\b`, 'i'), (m) => Math.round(Number(m[1]) * 60)],
  [new RegExp(`${PRE}(?<![\\w.])(\\d+(?:\\.\\d+)?)\\s*(?:m|mins?|minutes?)\\b`, 'i'), (m) => Math.round(Number(m[1]))],
];

const LEAD = /^(?:please|hey|okay|ok|so|remind me to|add (?:a |the )?(?:new )?task(?: to)?|new task)\b\s*/i;
const TRAIL = /\s+(?:by|on|at|for|in|due|until|before|to|and|every)$/i;
const DUE_PRE = '(?:(?:by|due|on|until|before)\\s+)?';

/**
 * Parses a typed or dictated phrase into a task spec.
 * @throws CaptureError when no title remains or the phrase asks for unsupported recurrence
 */
export function parseCapture(input: string, opts: ParseOptions = {}): CaptureSpec {
  const now = (opts.now ?? (() => new Date()))();
  const today = localDay(now, opts.timeZone ?? 'UTC');

  // Normalize: transcript punctuation, fillers, spoken numbers.
  let s = input.replace(/[,;]+/g, ' ').replace(/[.!?]+\s*$/, '').replace(/\s+/g, ' ').trim();
  s = s.replace(/\b(?:um+|uh+|erm?|hmm+)\b/gi, ' ').replace(/\byou know\b/gi, ' ').replace(/\bi mean\b/gi, ' ').replace(/\s+/g, ' ').trim();
  for (let prev = ''; prev !== s;) { prev = s; s = s.replace(LEAD, ''); }
  s = s.replace(new RegExp(`\\b(${NUM})${UNIT_AHEAD}`, 'gi'), (w) => String(wordToNumber(w)));

  const spec: CaptureSpec = { title: '' };

  // Recurrence
  if (new RegExp(`\\bevery\\s+(?:${WD_ANY})\\s+and\\s+(?:${WD_ANY})\\b|\\b(?:every\\s+weekday|weekdays)\\b`, 'i').test(s)) {
    throw new CaptureError('Multi-weekday recurrence is not supported');
  }
  let weekdayRecur: number | null = null;
  {
    const wd = take(s, new RegExp(`\\bevery\\s+(${WD_ANY})\\b`, 'i'));
    if (wd.m) {
      weekdayRecur = wdIndex(wd.m[1]);
      spec.recurrence = { cadence: 'weekly', weekdays: [WEEKDAY_IDS[weekdayRecur]] };
      s = wd.rest;
    } else {
      const table: [RegExp, Cadence][] = [
        [/\b(?:daily|every\s+day)\b/i, 'daily'], [/\b(?:weekly|every\s+week)\b/i, 'weekly'], [/\b(?:monthly|every\s+month)\b/i, 'monthly'],
        [/\b(?:quarterly|every\s+quarter)\b/i, 'quarterly'], [/\b(?:yearly|annually|every\s+year)\b/i, 'yearly'],
      ];
      for (const [re, cadence] of table) {
        const t = take(s, re);
        if (t.m) { spec.recurrence = { cadence }; s = t.rest; break; }
      }
    }
  }

  // Effort
  for (const [re, minutes] of EFFORT_RES) {
    const t = take(s, re);
    if (t.m) {
      const m = minutes(t.m);
      spec.effort = { minutes: m, emoji: effortEmoji(m) };
      s = t.rest;
      break;
    }
  }

  // Project hint
  {
    const a = take(s, /(?:^|\s)[#@]([A-Za-z0-9][\w-]*)/);
    const b = take(s, /\b(?:in|for)\s+project\s+([\w-]+)/i);
    const t = a.m ? a : b;
    if (t.m) { spec.project = t.m[1]; s = t.rest; }
  }

  // Due date
  const due = ((): Date | null => {
    const tryRe = (re: string, f: (m: RegExpExecArray) => Date | null): Date | null => {
      const t = take(s, new RegExp(`${DUE_PRE}${re}`, 'i'));
      if (!t.m) return null;
      const d = f(t.m);
      if (d) s = t.rest;
      return d;
    };
    const nextMonday = addDays(today, ((1 - today.getUTCDay() + 7) % 7) || 7);
    const month = (n: string) => MONTHS.indexOf(n.slice(0, 3).toLowerCase());
    const md = (mi: number, day: number, year?: string): Date | null => {
      if (year) return validDate(Number(year), mi, day);
      const here = validDate(today.getUTCFullYear(), mi, day);
      if (here && here >= today) return here;
      return validDate(today.getUTCFullYear() + 1, mi, day);
    };
    return (
      tryRe('\\bday after tomorrow\\b', () => addDays(today, 2))
      ?? tryRe('\\btomorrow\\b', () => addDays(today, 1))
      ?? tryRe('\\b(?:today|tonight|tonite)\\b', () => today)
      ?? tryRe('\\bin\\s+(\\d+)\\s+(day|week)s?\\b', (m) => addDays(today, Number(m[1]) * (m[2].toLowerCase() === 'week' ? 7 : 1)))
      ?? tryRe('\\bnext\\s+week\\b', () => nextMonday)
      ?? tryRe(`\\bnext\\s+(${WD_FULL})\\b`, (m) => addDays(nextMonday, (wdIndex(m[1]) + 6) % 7))
      ?? tryRe(`\\b(?:this\\s+)?(${WD_FULL})\\b`, (m) => addDays(today, ((wdIndex(m[1]) - today.getUTCDay() + 7) % 7) || 7))
      // Abbreviations only after an explicit cue, so words like "sat"/"sun"/"mon" in titles survive.
      ?? tryRe(`\\bnext\\s+(${WD_ABBR})\\b`, (m) => addDays(nextMonday, (wdIndex(m[1]) + 6) % 7))
      ?? tryRe(`\\b(?:by|due|on|until|before|this)\\s+(${WD_ABBR})\\b`, (m) => addDays(today, ((wdIndex(m[1]) - today.getUTCDay() + 7) % 7) || 7))
      ?? tryRe('\\b(?:end of (?:the )?month|eom)\\b', () => utc(today.getUTCFullYear(), today.getUTCMonth() + 1, 0))
      ?? tryRe('\\b(\\d{4})-(\\d\\d)-(\\d\\d)\\b', (m) => validDate(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
      ?? tryRe(`\\b(${MON_RE})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:\\s+(\\d{4}))?\\b`, (m) => md(month(m[1]), Number(m[2]), m[3]))
      ?? tryRe(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MON_RE})\\b(?:\\s+(\\d{4}))?`, (m) => md(month(m[2]), Number(m[1]), m[3]))
    );
  })();
  if (due) spec.due = iso(due);
  else if (spec.recurrence) {
    spec.due = iso(weekdayRecur === null ? today : addDays(today, (weekdayRecur - today.getUTCDay() + 7) % 7));
  }

  // Title
  let t = s.replace(/\s+/g, ' ').trim();
  for (let prev = ''; prev !== t;) { prev = t; t = t.replace(/^(?:to|and|then|that)\s+/i, '').replace(TRAIL, '').trim(); }
  if (!t || /^(?:to|and|then|that|by|on|at|for|in|due)$/i.test(t)) throw new CaptureError('No task title found');
  spec.title = t.charAt(0).toUpperCase() + t.slice(1);
  return spec;
}

/** Renders the task row text (no checkbox). */
export function toTaskText(spec: CaptureSpec, now: Date, timeZone = 'UTC'): string {
  const parts: string[] = [];
  const r = spec.recurrence;
  if (r?.weekdays?.length === 1) {
    const name = DAYS[WEEKDAY_IDS.indexOf(r.weekdays[0])];
    parts.push(`📅 ${name.charAt(0).toUpperCase()}${name.slice(1)}:`);
  } else if (spec.due) {
    const [y, m, d] = spec.due.split('-').map(Number);
    parts.push(`📅 ${MONTH_LABEL[m - 1]} ${d}${y !== localDay(now, timeZone).getUTCFullYear() ? `, ${y}` : ''}:`);
  }
  if (r) parts.push(`🔄 ${CADENCE_LABEL[r.cadence]}:`);
  parts.push(spec.title);
  if (spec.effort) parts.push(spec.effort.emoji);
  return parts.join(' ');
}

export interface CaptureOptions { project?: string; section?: string; dryRun?: boolean }

/** Parses `text` with the context clock and adds it through the lifecycle. */
export async function captureTask(
  ctx: LifecycleContext, text: string, opts: CaptureOptions = {},
): Promise<{ result: LifecycleResult; spec: CaptureSpec }> {
  const now = (ctx.now ?? (() => new Date()))();
  const timeZone = (ctx.config ?? getDefaults()).timezone;
  const spec = parseCapture(text, { now: () => now, timeZone });
  const project = spec.project ?? opts.project;
  if (!project) throw new LifecycleError('Project required: use #project or the project option');
  const row = toTaskText(spec, now, timeZone);
  if (opts.dryRun) return { result: { changed: false, after: `- [ ] ${row}` }, spec };
  return { result: await addTask(ctx, { project, text: row, section: opts.section }), spec };
}
