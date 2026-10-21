const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ROW = /^(\s*- \[)[ xX](\] 📅 )([A-Za-z]{3}) (\d{1,2})(?:, (\d{4}))?(: 🔄 )(Daily|Weekly|Monthly|Quarterly|Yearly)(:.*)$/i;

export function isRecurring(line: string): boolean {
  return ROW.test(line.split('\n')[0]);
}

function addMonths(y: number, m: number, d: number, n: number): Date {
  const t = m + n;
  const year = y + Math.floor(t / 12);
  const month = ((t % 12) + 12) % 12;
  const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month, Math.min(d, last)));
}

/** Rolls a 🔄 row (plus indented subtasks) to its next due date. Returns null if not recurring. */
export function rollRecurring(block: string, today: Date = new Date()): string | null {
  const [first, ...rest] = block.split('\n');
  const m = ROW.exec(first);
  if (!m) return null;
  const mon = MONTHS.findIndex(x => x.toLowerCase() === m[3].toLowerCase());
  if (mon < 0) return null;
  const hasYear = m[5] !== undefined;
  const year = hasYear ? Number(m[5]) : today.getUTCFullYear();
  const day = Number(m[4]);
  const base = new Date(Date.UTC(year, mon, day));
  let next: Date;
  switch (m[7].toLowerCase()) {
    case 'daily': next = new Date(base.getTime() + 86400000); break;
    case 'weekly': next = new Date(base.getTime() + 7 * 86400000); break;
    case 'monthly': next = addMonths(year, mon, day, 1); break;
    case 'quarterly': next = addMonths(year, mon, day, 3); break;
    default: next = addMonths(year, mon, day, 12);
  }
  const dow = next.getUTCDay();
  if (dow === 6) next = new Date(next.getTime() + 2 * 86400000);
  else if (dow === 0) next = new Date(next.getTime() + 86400000);
  const date = `${MONTHS[next.getUTCMonth()]} ${next.getUTCDate()}` + (hasYear ? `, ${next.getUTCFullYear()}` : '');
  const head = `${m[1]} ${m[2]}${date}${m[6]}${m[7]}${m[8]}`;
  const subs = rest.map(l => l.replace(/^(\s*- \[)[xX](\])/, '$1 $2'));
  return [head, ...subs].join('\n');
}
