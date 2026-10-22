import type { Cadence, IsoDate, Recurrence, Weekday } from './model';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS: Weekday[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const DAY_MS = 86400000;

const CAD = '(Daily|Weekly|Monthly|Quarterly-EOM\\+1|Quarterly|Yearly)';
const DATE = '([A-Za-z]{3,9})(?: (\\d{1,2})(?:, (\\d{4}))?)?';
const MARKER = /(\s*)<!--nominal:(\d{4})-(\d\d)-(\d\d)(?: day:(\d{1,2}))?-->(\s*)$/;
const CANON = new RegExp(`^(\\s*- \\[)([ xX])(\\] )📅 ${DATE}: 🔄 ${CAD}:(.*)$`, 'i');
const LEGACY = new RegExp(`^(\\s*- \\[)([ xX])(\\] )🔄 ${CAD}: 📅 ${DATE}:(.*)$`, 'i');

/** Options for {@link rollRecurring}. @req FR:recurring-rows/roll.@function */
export interface RollOptions {
  /** Shift Sat/Sun due dates to Monday (default true; pass the config value). */
  shiftWeekends?: boolean;
}

/** A parsed recurring row. @req FR:recurring-rows/detect.parse */
export interface RecurringRow {
  form: 'canonical' | 'legacy';
  recurrence: Recurrence;
  /** Shown due date; absent for weekday-name rows. */
  dueDate?: IsoDate;
  /** Nominal (pre-shift) date from the hidden marker, when it still matches the shown date. */
  nominalDay?: IsoDate;
}

interface Parsed extends RecurringRow {
  pre: string;
  mid: string;
  cadText: string;
  rest: string;
  dateText?: string;
  hasYear: boolean;
  weekday: boolean;
  /** Lower-cased cadence token. */
  cad: string;
  /** Base (nominal) date and intended day of month. */
  base?: Date;
  day?: number;
  /** Existing marker split into leading space, marker, trailing space. */
  marker?: { lead: string; trail: string };
}

const mk = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d));
const lastDay = (y: number, m: number) => mk(y, m + 1, 0).getUTCDate();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const weekdayIndex = (n: string) => {
  const w = n.toLowerCase().replace(/s$/, '');
  return WEEKDAY_NAMES.findIndex(x => (w.length === 3 && x.startsWith(w)) || x === w);
};

function shifted(d: Date, on: boolean): Date {
  if (!on) return d;
  const w = d.getUTCDay();
  return w === 6 ? new Date(d.getTime() + 2 * DAY_MS) : w === 0 ? new Date(d.getTime() + DAY_MS) : d;
}

/** The month end that a weekend shift pushed onto this Monday, if any. */
function eomOrigin(shown: Date): Date | null {
  if (shown.getUTCDay() !== 1) return null;
  for (const back of [1, 2]) {
    const c = new Date(shown.getTime() - back * DAY_MS);
    if ([0, 6].includes(c.getUTCDay()) && c.getUTCDate() === lastDay(c.getUTCFullYear(), c.getUTCMonth())) return c;
  }
  return null;
}

function parseLine(line: string, today: Date): Parsed | null {
  const text = line.replace(/\r$/, '');
  let form: 'canonical' | 'legacy' = 'canonical';
  let g: { mon: string; day?: string; year?: string; cad: string; rest: string; pre: string; mid: string };
  let m = CANON.exec(text);
  if (m) g = { pre: m[1], mid: m[3], mon: m[4], day: m[5], year: m[6], cad: m[7], rest: m[8] };
  else if ((m = LEGACY.exec(text))) {
    form = 'legacy';
    g = { pre: m[1], mid: m[3], cad: m[4], mon: m[5], day: m[6], year: m[7], rest: m[8] };
  } else return null;
  const cad = g.cad.toLowerCase();
  let rest = g.rest;
  const mm = MARKER.exec(rest);
  let markerDate: Date | undefined;
  let markerDay: number | undefined;
  if (mm) {
    markerDate = mk(Number(mm[2]), Number(mm[3]) - 1, Number(mm[4]));
    if (markerDate.getUTCMonth() !== Number(mm[3]) - 1 || markerDate.getUTCDate() !== Number(mm[4])) return null;
    if (mm[5] !== undefined) {
      markerDay = Number(mm[5]);
      if (markerDay > 31 || markerDay <= markerDate.getUTCDate()) return null;
    }
    rest = rest.slice(0, mm.index);
  }
  const p: Parsed = {
    form, pre: g.pre, mid: g.mid, cadText: g.cad, rest, hasYear: g.year !== undefined, weekday: false, cad,
    recurrence: { cadence: (cad.startsWith('quarterly') ? 'quarterly' : cad) as Cadence },
  };
  if (cad.endsWith('eom+1')) p.recurrence.anchor = 'end-of-month';
  if (mm) p.marker = { lead: mm[1], trail: mm[6] };
  if (g.day === undefined) { // weekday name
    const w = weekdayIndex(g.mon);
    if (w < 0 || cad !== 'weekly') return null;
    p.weekday = true;
    p.dateText = g.mon;
    p.recurrence.weekdays = [WEEKDAYS[w]];
    return p;
  }
  const mon = MONTHS.findIndex(x => x.toLowerCase() === g.mon.toLowerCase());
  if (mon < 0) return null;
  const day = Number(g.day);
  const year = p.hasYear ? Number(g.year) : markerDate ? markerDate.getUTCFullYear() : today.getUTCFullYear();
  const shown = mk(year, mon, day);
  if (shown.getUTCMonth() !== mon || shown.getUTCDate() !== day) return null;
  p.dateText = `${g.mon} ${g.day}${p.hasYear ? ', ' + g.year : ''}`;
  p.dueDate = iso(shown);
  p.base = shown;
  p.day = day;
  // Honor the marker only while it still explains the shown date; a hand-edited date makes it stale.
  if (markerDate && cad !== 'daily') {
    const fits = [true, false].some(on => {
      const s = shifted(markerDate as Date, on);
      return p.hasYear ? s.getTime() === shown.getTime() : s.getUTCMonth() === mon && s.getUTCDate() === day;
    });
    if (fits) {
      p.base = markerDate;
      p.day = markerDay ?? markerDate.getUTCDate();
      p.nominalDay = iso(markerDate);
      p.recurrence.nominalDay = p.nominalDay;
    }
  } else if (cad.endsWith('eom+1')) {
    const o = eomOrigin(shown);
    if (o) { p.base = o; p.day = o.getUTCDate(); }
  }
  return p;
}

/**
 * Parses a 🔄 row's first line (either form) into task-model terms. Null if not a valid recurring row.
 * @req FR:recurring-rows/detect.parse @req FR:recurring-rows/format.legacy @req FR:recurring-rows/format.weekday
 */
export function parseRecurringRow(line: string, today: Date = new Date()): RecurringRow | null {
  const p = parseLine(line.split(/\r?\n/)[0], today);
  if (!p) return null;
  return { form: p.form, recurrence: p.recurrence, ...(p.dueDate ? { dueDate: p.dueDate } : {}), ...(p.nominalDay ? { nominalDay: p.nominalDay } : {}) };
}

/**
 * @req FR:recurring-rows/detect.@function @req FR:recurring-rows/detect.valid @req FR:recurring-rows/format.crlf
 */
export function isRecurring(line: string, today: Date = new Date()): boolean {
  return parseLine(line.split(/\r?\n/)[0], today) !== null;
}

function addMonths(y: number, m: number, d: number, n: number): Date {
  const t = m + n;
  const year = y + Math.floor(t / 12);
  const month = ((t % 12) + 12) % 12;
  return mk(year, month, Math.min(d, lastDay(year, month)));
}

/**
 * Rolls a 🔄 row (plus indented subtasks) to its next due date, editing only the checkbox, date and
 * nominal marker of the first line and subtask checkboxes. Returns null if not recurring or invalid.
 * @req FR:recurring-rows/roll.@function @req FR:recurring-rows/format.row @req FR:recurring-rows/format.cadence
 * @req FR:recurring-rows/format.eom @req FR:recurring-rows/roll.step @req FR:recurring-rows/roll.clamp
 * @req FR:recurring-rows/roll.weekend @req FR:recurring-rows/roll.nominal
 * @req FR:recurring-rows/preserve.unchecked @req FR:recurring-rows/preserve.text @req FR:recurring-rows/preserve.subtasks
 * @req FR:recurring-rows/format.crlf @req FR:recurring-rows/detect.valid @req FR:recurring-rows/detect.non-recurring
 */
export function rollRecurring(block: string, today: Date = new Date(), options: RollOptions = {}): string | null {
  const shiftOn = options.shiftWeekends !== false;
  // Odd indexes are the line endings (\n or \r\n), kept verbatim.
  const parts = block.split(/(\r?\n)/);
  const p = parseLine(parts[0], today);
  if (!p) return null;
  const cr = parts[0].endsWith('\r') ? '\r' : '';
  let dateText = p.dateText;
  let marker = '';
  if (!p.weekday) {
    const base = p.base as Date;
    const day = p.day as number;
    const y = base.getUTCFullYear();
    const mo = base.getUTCMonth();
    let next: Date;
    switch (p.cad) {
      case 'daily': next = new Date(base.getTime() + DAY_MS); break;
      case 'weekly': next = new Date(base.getTime() + 7 * DAY_MS); break;
      case 'monthly': next = addMonths(y, mo, day, 1); break;
      case 'yearly': next = addMonths(y, mo, day, 12); break;
      case 'quarterly': next = addMonths(y, mo, day, 3); break;
      default: next = mk(y, mo + 4, 0); // Quarterly-EOM+1: month end 3 months on
    }
    const shown = shifted(next, shiftOn);
    const clamped = (p.cad === 'monthly' || p.cad === 'quarterly' || p.cad === 'yearly') && next.getUTCDate() < day;
    // Daily has no nominal day: it advances from the shown date.
    if (p.cad !== 'daily' && (shown.getTime() !== next.getTime() || clamped)) {
      marker = `<!--nominal:${iso(next)}${clamped ? ` day:${day}` : ''}-->`;
    }
    dateText = `${MONTHS[shown.getUTCMonth()]} ${shown.getUTCDate()}` + (p.hasYear ? `, ${shown.getUTCFullYear()}` : '');
  }
  const body = p.form === 'canonical'
    ? `${p.pre} ${p.mid}📅 ${dateText}: 🔄 ${p.cadText}:${p.rest}`
    : `${p.pre} ${p.mid}🔄 ${p.cadText}: 📅 ${dateText}:${p.rest}`;
  const tail = p.marker ? (marker ? `${p.marker.lead}${marker}` : '') + p.marker.trail : marker ? ` ${marker}` : '';
  parts[0] = body + tail + cr;
  for (let i = 2; i < parts.length; i += 2) parts[i] = parts[i].replace(/^(\s*- \[)[xX](\])/, '$1 $2');
  return parts.join('');
}
