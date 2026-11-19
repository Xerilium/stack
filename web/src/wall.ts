/** Wall-clock minutes of `at` after local midnight of `origin`'s date; later dates count past 24:00, so DST days keep their clock times. */
export function wallMinutes(at: Date, origin: Date): number {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((day(at) - day(origin)) / 864e5) * 1440 + at.getHours() * 60 + at.getMinutes();
}

/** A wall-clock minute as a short time (`10:40a`); minutes past 24:00 wrap to the next day's clock. */
export const clock = (m: number) => { const h = Math.floor(m / 60) % 24; return `${h % 12 || 12}:${String(Math.floor(m % 60)).padStart(2, '0')}${h < 12 ? 'a' : 'p'}`; };
