/** Wall-clock minutes of `at` after local midnight of `origin`'s date; later dates count past 24:00, so DST days keep their clock times. */
export function wallMinutes(at: Date, origin: Date): number {
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  return Math.round((day(at) - day(origin)) / 864e5) * 1440 + at.getHours() * 60 + at.getMinutes();
}
