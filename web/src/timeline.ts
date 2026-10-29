import type { Busy } from './meetings';
import type { Block, Day, DayBlock, Plan } from './plan';

/** My day's rows, in order. Pure; the view only draws it. @req FR:home/myday.timeline */
export type Item = { at: number; until: number; kind: 'block'; b: Block } | { at: number; until: number; kind: 'meeting'; m: Busy } | { at: number; until: number; kind: 'email'; e: NonNullable<Plan['email']> };
export type Row = Item | { at: number; kind: 'band'; name: string; emoji: string; personal: boolean; from: number; to: number } | { at: number; kind: 'gap'; min: number } | { at: number; kind: 'now' };

const GAP_MIN = 15;

/**
 * Schedule bands (a band ends at its block's end; time between blocks sits under a neutral `Open` header), meetings,
 * planned tasks, the email block, free gaps of 15 minutes or more in focus time, and a now line inside its band.
 * `earlier` is the time whose bands are fully past (folded into one line).
 */
export function timelineOf(plan: Plan, day: Day, start: number, end: number, now: number): { rows: Row[]; earlier: { from: number; to: number } | null } {
  const items: Item[] = [
    ...plan.blocks.map((b): Item => ({ at: b.start, until: b.end, kind: 'block', b })),
    ...plan.meetings.filter((m) => m.start < end).map((m): Item => ({ at: m.start, until: m.end, kind: 'meeting', m })),
    ...(plan.email ? [{ at: plan.email.start, until: plan.email.end, kind: 'email' as const, e: plan.email }] : []),
  ].sort((a, b) => a.at - b.at || (a.kind === 'meeting' ? -1 : 1));
  const bands = (day.blocks ?? []).filter((b) => b.end > start && b.start < end);
  const personal = bands.filter((b) => b.kind === 'personal');
  const rows: Row[] = [];
  let cursor = start;
  // No band yet (-Infinity): the first row outside every block opens one. A day without blocks has no bands at all.
  let bandEnd = (day.blocks ?? []).length ? -Infinity : Infinity;
  const openBand = (at: number) => {
    if (at < bandEnd) return;
    const from = bandEnd === -Infinity ? at : bandEnd;
    const next = bands.find((b) => b.start > at)?.start ?? day.end;
    rows.push({ at: from, kind: 'band', name: 'Open', emoji: '', personal: false, from, to: next });
    bandEnd = next;
  };
  /** Free time from the cursor to `to`, minus personal time, as gap rows of 15 minutes or more. */
  const gaps = (to: number) => {
    let segs: [number, number][] = [[cursor, to]];
    for (const p of personal) segs = segs.flatMap(([a, z]): [number, number][] => (p.end <= a || p.start >= z ? [[a, z]] : [[a, p.start], [p.end, z]]).filter(([x, y]) => y > x) as [number, number][]);
    for (const [a, z] of segs) if (z - a >= GAP_MIN) { openBand(a); rows.push({ at: a, kind: 'gap', min: z - a }); }
  };
  type Mark = { at: number; o: 0; band: DayBlock } | { at: number; o: 1 | 2; item?: Item };
  const marks: Mark[] = [
    ...bands.map((b): Mark => ({ at: Math.max(b.start, Math.min(start, now)), o: 0, band: b })),
    ...(day.asleep ? [] : [{ at: now, o: 2 } as Mark]),
    // A row already under way sorts at the plan start, under its band's header and above the now line.
    ...items.map((i): Mark => ({ at: Math.max(i.at, Math.min(start, now)), o: i.at < now ? 1 : 2, item: i })),
  ].sort((a, b) => a.at - b.at || a.o - b.o);
  for (const mk of marks) {
    if (mk.o === 0) {
      gaps(Math.min(mk.at, end)); cursor = Math.max(cursor, mk.at);
      rows.push({ at: mk.at, kind: 'band', name: mk.band.label ?? mk.band.name, emoji: mk.band.emoji, personal: mk.band.kind === 'personal', from: mk.band.start, to: mk.band.end });
      bandEnd = mk.band.end;
    } else if (!mk.item) { openBand(mk.at); rows.push({ at: mk.at, kind: 'now' }); }
    else {
      gaps(mk.item.at);
      openBand(mk.at);
      rows.push(mk.item);
      cursor = Math.max(cursor, mk.item.until);
    }
  }
  gaps(Math.min(day.end, end));
  const pastEnd = Math.max(0, ...(day.blocks ?? []).filter((b) => b.end <= start).map((b) => b.end));
  return { rows, earlier: day.origin && !day.asleep && pastEnd > day.start ? { from: day.start, to: pastEnd } : null };
}
