/**
 * A day grid: rows of 30 minutes, all one height; items sit at their start time with a height in proportion to their length.
 * The rows are decoration; the items are the list. A consumer draws what is in an item.
 * @req FR:ui-kit/daygrid
 */
import type { ComponentChild } from 'preact';
import './ui.css';

/** Minutes in one row. */
export const SLOT_MIN = 30;
/** The least height of an item, in rows (15 minutes): its target stays 24 px, 48 px on touch. */
export const MIN_SIZE = 0.5;

export interface GridSpan { /** Start, in minutes after midnight. */ start: number; /** End, in minutes after midnight. */ end: number }
export interface GridItem extends GridSpan { key: string; node: ComponentChild }
export interface GridBand extends GridSpan { label: string; /** Tint the band's rows (time that is not for work). */ muted?: boolean }
/** Where an item sits: `top` and `size` in rows (30 minutes is 1, never under `MIN_SIZE`); `lane` of `lanes` when items overlap in time. */
export interface Placed<T> { item: T; top: number; size: number; lane: number; lanes: number; /** Drawn higher than its length: it sits above the item after it, so its whole height takes a tap. */ raised?: true }

/**
 * Lay items out on the span `from` to `to`: clip each to the span, drop the ones outside it, sort by start,
 * and put items that overlap in time side by side. Pure.
 */
export function placeItems<T extends GridSpan>(items: T[], from: number, to: number): Placed<T>[] {
  const shown = items
    .map((item) => ({ item, a: Math.max(item.start, from), z: Math.min(item.end, to) }))
    .filter((x) => x.z > x.a)
    .sort((x, y) => x.a - y.a || y.z - x.z);
  const out: Placed<T>[] = [];
  let group: { p: Placed<T>; z: number }[] = [];
  let groupEnd = -Infinity;
  const close = () => { const lanes = Math.max(0, ...group.map((g) => g.p.lane)) + 1; for (const g of group) g.p.lanes = lanes; group = []; };
  for (const x of shown) {
    if (x.a >= groupEnd) close();
    const taken = new Set(group.filter((g) => g.z > x.a).map((g) => g.p.lane));
    let lane = 0;
    while (taken.has(lane)) lane++;
    // Only an item that is short by itself gets the least height; one cut by the span keeps its cut size. Never past the last row.
    const size = (x.z - x.a) / SLOT_MIN;
    const short = x.item.end - x.item.start < MIN_SIZE * SLOT_MIN && size < MIN_SIZE;
    const p: Placed<T> = { item: x.item, top: (x.a - from) / SLOT_MIN, size: short ? Math.min(MIN_SIZE, (to - x.a) / SLOT_MIN) : size, lane, lanes: 1, ...(short ? { raised: true as const } : {}) };
    group.push({ p, z: x.z });
    groupEnd = Math.max(groupEnd, x.z);
    out.push(p);
  }
  close();
  return out;
}

const hour = (m: number) => { const h = Math.floor(m / 60) % 24; return `${h % 12 || 12}${h < 12 ? 'a' : 'p'}`; };
const clock = (m: number) => { const h = Math.floor(m / 60) % 24; return `${h % 12 || 12}:${String(Math.floor(m % 60)).padStart(2, '0')}${h < 12 ? 'a' : 'p'}`; };

export function DayGrid({ label, from, to, items, bands = [], now, testid }: {
  /** The list name for assistive tech. */ label: string;
  /** First minute shown; the grid starts at the half hour that holds it. */ from: number;
  /** Last minute shown; the grid ends at the half hour that holds it. */ to: number;
  items: GridItem[];
  bands?: GridBand[];
  /** The current time; draws the now line when inside the span. */ now?: number;
  testid?: string;
}) {
  const start = Math.floor(from / SLOT_MIN) * SLOT_MIN;
  const end = Math.max(start + SLOT_MIN, Math.ceil(to / SLOT_MIN) * SLOT_MIN);
  const slots = Array.from({ length: (end - start) / SLOT_MIN }, (_, i) => start + i * SLOT_MIN);
  const bandAt = (m: number) => bands.find((b) => b.start < m + SLOT_MIN && b.end > m);
  return (
    <div class="ui-grid">
      <ol class="ui-slots" aria-hidden="true">
        {slots.map((m, i) => {
          const band = bandAt(m);
          const first = band && (i === 0 || bandAt(m - SLOT_MIN) !== band);
          return (
            <li key={m} class={`ui-slot${m % 60 === 0 ? ' hour' : ''}${band?.muted ? ' muted' : ''}`}>
              <span class="ui-slot-when">{m % 60 === 0 && <time>{hour(m)}</time>}{first && <span class="ui-slot-band">{band.label}</span>}</span>
            </li>
          );
        })}
      </ol>
      <ol class="ui-grid-items" aria-label={label} data-testid={testid}>
        {placeItems(items, start, end).map((p) => (
          <li key={p.item.key} class={`ui-grid-item${p.raised ? ' raised' : ''}`} style={{ '--top': p.top, '--size': p.size, '--lane': p.lane, '--lanes': p.lanes }}>{p.item.node}</li>
        ))}
      </ol>
      {now !== undefined && now >= start && now < end && <div class="now-line ui-grid-now" role="img" aria-label={`Now ${clock(now)}`} style={{ '--top': (now - start) / SLOT_MIN }} />}
    </div>
  );
}
