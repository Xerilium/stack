const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ROW = /^(\s*- \[)[ xX](\] 📅 )([A-Za-z]{3}) (\d{1,2})(?:, (\d{4}))?(: 🔄 )(Daily|Weekly|Monthly|Quarterly|Yearly)(:.*)$/i;
const DAY_MS = 86400000;

/** Parses the first line; null if not a 🔄 row or the date is invalid (unknown month, Feb 31, day 0). */
function parseFirst(line: string, today: Date) {
  const m = ROW.exec(line.replace(/\r$/, ''));
  if (!m) return null;
  const mon = MONTHS.findIndex(x => x.toLowerCase() === m[3].toLowerCase());
  if (mon < 0) return null;
  const hasYear = m[5] !== undefined;
  const year = hasYear ? Number(m[5]) : today.getUTCFullYear();
  const day = Number(m[4]);
  const base = new Date(Date.UTC(year, mon, day));
  if (base.getUTCMonth() !== mon || base.getUTCDate() !== day) return null;
  return { m, mon, year, day, hasYear, base };
}

/**
 * @req FR:recurring-rows/detect.@function @req FR:recurring-rows/detect.valid @req FR:recurring-rows/format.crlf
 */
export function isRecurring(line: string, today: Date = new Date()): boolean {
  return parseFirst(line.split(/\r?\n/)[0], today) !== null;
}

function addMonths(y: number, m: number, d: number, n: number): Date {
  const t = m + n;
  const year = y + Math.floor(t / 12);
  const month = ((t % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(d, last)));
}

/**
 * Rolls a 🔄 row (plus indented subtasks) to its next due date. Returns null if not recurring or the date is invalid.
 * @req FR:recurring-rows/roll.@function @req FR:recurring-rows/format.row @req FR:recurring-rows/format.cadence
 * @req FR:recurring-rows/roll.step @req FR:recurring-rows/roll.clamp @req FR:recurring-rows/roll.weekend
 * @req FR:recurring-rows/preserve.unchecked @req FR:recurring-rows/preserve.text @req FR:recurring-rows/preserve.subtasks
 * @req FR:recurring-rows/format.crlf @req FR:recurring-rows/detect.valid @req FR:recurring-rows/detect.non-recurring
 */
export function rollRecurring(block: string, today: Date = new Date()): string | null {
  // Odd indexes are the line endings (\n or \r\n), kept verbatim.
  const parts = block.split(/(\r?\n)/);
  const p = parseFirst(parts[0], today);
  if (!p) return null;
  const { m, mon, year, day, hasYear, base } = p;
  let next: Date;
  switch (m[7].toLowerCase()) {
    case 'daily': next = new Date(base.getTime() + DAY_MS); break;
    case 'weekly': next = new Date(base.getTime() + 7 * DAY_MS); break;
    case 'monthly': next = addMonths(year, mon, day, 1); break;
    case 'quarterly': next = addMonths(year, mon, day, 3); break;
    default: next = addMonths(year, mon, day, 12);
  }
  const dow = next.getUTCDay();
  if (dow === 6) next = new Date(next.getTime() + 2 * DAY_MS);
  else if (dow === 0) next = new Date(next.getTime() + DAY_MS);
  const date = `${MONTHS[next.getUTCMonth()]} ${next.getUTCDate()}` + (hasYear ? `, ${next.getUTCFullYear()}` : '');
  const cr = parts[0].endsWith('\r') ? '\r' : '';
  parts[0] = `${m[1]} ${m[2]}${date}${m[6]}${m[7]}${m[8]}${cr}`;
  for (let i = 2; i < parts.length; i += 2) parts[i] = parts[i].replace(/^(\s*- \[)[xX](\])/, '$1 $2');
  return parts.join('');
}
