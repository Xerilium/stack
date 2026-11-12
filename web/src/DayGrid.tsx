/**
 * My day as a grid of equal 30-minute slots: meetings and planned tasks at their real duration, free slots to place a task,
 * and the block detail beside the grid (wide) or full page (narrow).
 * @req FR:my-day-grid/grid.slots @req FR:my-day-grid/grid.now @req FR:my-day-grid/grid.meetings @req FR:my-day-grid/grid.tasks
 * @req FR:my-day-grid/grid.free @req FR:my-day-grid/grid.drag @req FR:my-day-grid/detail.open @req FR:my-day-grid/detail.side @req FR:my-day-grid/look.fluent
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'preact/hooks';
import { freeSlots, gridOf, labelOf, SLOT, type GridItem } from './grid';
import { clock, estimate, nowMinutes, span, type Day, type Plan } from './plan';
import type { CalEvent } from './meetings';
import { parseRow } from './row';
import type { Task } from './types';
import { SIDE } from './TaskDetail';
import './daygrid.css';

export const ROW = 48;
const DRAG = 'application/x-stack-ref';

export interface DayGridProps {
  now: Date; plan: Plan; day: Day; events: CalEvent[];
  /** Today (now line, past slots closed); false on another day. */ today: boolean;
  /** A past day: meetings only, nothing to place. */ past: boolean;
  selected?: string | null; titles: Map<string, string>;
  onOpen: (ref: string) => void; onPlace?: (ref: string, at: number) => void; /** Open the asks behind the email block. */ onEmail?: () => void; /** Close the task detail (a meeting detail is opening). */ onCloseTask?: () => void;
}

const titleOf = (t: Task) => parseRow(t.text).title || t.text;
const STATUS: Record<CalEvent['showAs'], string> = { busy: 'Busy', tentative: 'Tentative', oof: 'Out of office', free: 'Free', workingElsewhere: 'Working elsewhere', unknown: '' };

/** The meeting detail: beside the grid when wide, else the full page. Esc closes. */
function MeetingDetail({ e, start, end, onClose }: { e: CalEvent; start: number; end: number; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null);
  const [opener] = useState(() => document.activeElement as HTMLElement | null);
  useLayoutEffect(() => { box.current?.focus(); return () => { if (opener?.isConnected) opener.focus(); }; }, []);
  const wide = matchMedia(SIDE).matches;
  // Full page: a modal, so Tab stays inside. Beside the grid: Tab moves on to the page.
  useEffect(() => {
    const key = (k: KeyboardEvent) => {
      const b = box.current;
      if (k.key !== 'Tab' || !b || matchMedia(SIDE).matches) return;
      const els = [...b.querySelectorAll<HTMLElement>('button, a[href]')];
      const i = els.indexOf(document.activeElement as HTMLElement);
      k.preventDefault();
      els[k.shiftKey ? (i <= 0 ? els.length - 1 : i - 1) : (i + 1) % els.length]?.focus();
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, []);
  return (
    <div ref={box} tabIndex={-1} class="focus-mode fl side" role="dialog" aria-modal={!wide} aria-label="Meeting detail" data-testid="meeting-detail">
      <button type="button" class="close" aria-label="Close" title="Close" onClick={onClose}><svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" /></svg></button>
      <div class="focus-inner">
        <p class="fl-facts">Meeting{STATUS[e.showAs] ? ` · ${STATUS[e.showAs]}` : ''}</p>
        <h1>{e.subject}</h1>
        <p class="dg-when">{clock(start)}–{clock(end)} · {span(end - start)}{e.organizer ? ` · ${e.organizer}` : ''}</p>
        <div class="fl-actions dg-actions">
          {e.joinUrl && <a class="fl-btn primary" href={e.joinUrl} target="_blank" rel="noopener noreferrer">Join</a>}
          {e.webLink && <a class="fl-btn" href={e.webLink} target="_blank" rel="noopener noreferrer">Open in calendar</a>}
        </div>
      </div>
    </div>
  );
}

export function DayGrid(g: DayGridProps) {
  const grid = useMemo(() => gridOf(g.plan, g.day, g.events), [g.plan, g.day, g.events]);
  const nowMin = nowMinutes(g.now, g.day);
  const showNow = g.today && !g.day.asleep && nowMin >= grid.from && nowMin < grid.to;
  const free = useMemo(() => new Set(g.past ? [] : freeSlots(grid, g.today && !g.day.asleep ? nowMin : null)), [grid, g.past, g.today, g.day.asleep, nowMin]);
  const [meeting, setMeeting] = useState<{ e: CalEvent; start: number; end: number } | null>(null);
  const [placing, setPlacing] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const top = (m: number) => ((m - grid.from) / SLOT) * ROW;
  const slots: number[] = [];
  for (let s = grid.from; s < grid.to; s += SLOT) slots.push(s);

  // Scroll so now (or the first block) sits near the top third. @req FR:my-day-grid/grid.now
  const anchor = showNow ? nowMin : grid.items[0]?.start ?? grid.from;
  useLayoutEffect(() => {
    const el = body.current;
    if (!el) return;
    // The shell scrolls `.main`, not the window.
    const sc = (el.closest('.main') as HTMLElement | null) ?? (document.scrollingElement as HTMLElement | null);
    if (!sc) return;
    const y = sc.scrollTop + el.getBoundingClientRect().top - (sc === document.scrollingElement ? 0 : sc.getBoundingClientRect().top) + top(anchor) - sc.clientHeight / 3;
    sc.scrollTop = Math.max(0, y);
  }, [g.day.origin?.getTime(), g.day.start]);

  // Esc closes the meeting detail or the place list.
  useEffect(() => {
    if (!meeting && placing === null) return;
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (placing !== null) closePlace(placing); else setMeeting(null); } };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [meeting, placing]);

  // What can go in a slot: tasks that do not fit first, then planned ones not already there.
  const choices = (at: number) => [
    ...g.plan.overflow.map((t) => ({ t, planned: false })),
    ...g.plan.blocks.filter((b) => b.start !== at).map((b) => ({ t: b.task, planned: true })),
  ].slice(0, 12);
  // Focus goes back to the slot, or on to the placed block once it is drawn there.
  const focusLater = (sel: string) => setTimeout(() => body.current?.querySelector<HTMLElement>(sel)?.focus(), 60);
  const closePlace = (at: number) => { setPlacing(null); focusLater(`[data-at="${at}"]`); };
  const place = (ref: string, at: number) => { setPlacing(null); g.onPlace?.(ref, at); focusLater(`[data-ref="${CSS.escape(ref)}"] .dg-open`); };

  const item = (i: GridItem) => {
    const h = Math.max(ROW, top(i.end) - top(i.start)) - 2;
    const style = { top: `${top(i.start) + 1}px`, height: `${h}px`, left: `calc(var(--dg-gutter) + (100% - var(--dg-gutter)) * ${i.lane / i.lanes})`, width: `calc((100% - var(--dg-gutter)) / ${i.lanes} - 4px)` };
    const time = `${clock(i.start)}–${clock(i.end)}`;
    if (i.kind === 'meeting') {
      const on = meeting?.e.id === i.e.id;
      return (
        <div key={`m${i.id}`} class={`dg-item meeting${i.e.showAs === 'tentative' ? ' tentative' : ''}${on ? ' on' : ''}`} style={style} data-testid="dg-meeting">
          <button type="button" class="dg-open" onClick={() => { g.onCloseTask?.(); setMeeting({ e: i.e, start: i.start, end: i.end }); }}>
            <span class="dg-title">{i.e.subject}</span><span class="dg-time">{time}</span>
          </button>
          {i.e.joinUrl && <a class="dg-join" href={i.e.joinUrl} target="_blank" rel="noopener noreferrer" aria-label={`Join ${i.e.subject}`}>Join</a>}
        </div>
      );
    }
    if (i.kind === 'email') {
      return (
        <div key="email" class="dg-item email" style={style} data-testid="dg-email">
          <button type="button" class="dg-open" onClick={g.onEmail} disabled={!g.onEmail}><span class="dg-title">Email · {i.count} ask{i.count === 1 ? '' : 's'}</span><span class="dg-time">{time}</span></button>
        </div>
      );
    }
    const t = i.b.task;
    const proj = g.titles.get(t.project) ?? t.project;
    return (
      <div key={`t${t.ref}`} class={`dg-item task${g.selected === t.ref ? ' on' : ''}`} style={style} data-testid="dg-task" data-ref={t.ref}
        draggable={!!g.onPlace && !g.past} onDragStart={(e) => { e.dataTransfer?.setData(DRAG, t.ref); e.dataTransfer?.setData('text/plain', t.ref); }}>
        <button type="button" class="dg-open row-open" onClick={() => { setMeeting(null); g.onOpen(t.ref); }}>
          <span class="dg-title">{i.b.placed && <span class="dg-pin"><span aria-hidden="true">📌 </span><span class="sr-only">Placed: </span></span>}{titleOf(t)}</span>
          <span class="dg-time">{time} · {proj}</span>
          <span class="chev" aria-hidden="true">›</span>
        </button>
      </div>
    );
  };

  return (
    <div class="dg fl" data-testid="day-grid" data-split={!!(meeting || g.selected) || undefined}>
      <div ref={body} class="dg-body" style={{ height: `${slots.length * ROW}px` }}>
        {slots.map((s) => {
          const label = s % 60 === 0 ? <span class="dg-hour" aria-hidden="true">{labelOf(s)}</span> : null;
          if (!free.has(s) || !g.onPlace) return <div key={s} class={`dg-slot${s % 60 === 0 ? ' hour' : ''}`} style={{ top: `${top(s)}px` }}>{label}</div>;
          return (
            <div key={s} class={`dg-slot${s % 60 === 0 ? ' hour' : ''}`} style={{ top: `${top(s)}px` }}>
              {label}
              <button type="button" class={`dg-free${over === s ? ' over' : ''}`} data-testid="dg-free" data-at={s} aria-label={`Place a task at ${clock(s)}`} aria-expanded={placing === s}
                onClick={() => (placing === s ? closePlace(s) : setPlacing(s))}
                onDragOver={(e) => { e.preventDefault(); setOver(s); }} onDragLeave={() => setOver(null)}
                onDrop={(e) => { e.preventDefault(); setOver(null); const ref = e.dataTransfer?.getData(DRAG); if (ref) place(ref, s); }}>
                <span class="dg-plus" aria-hidden="true">+</span>
              </button>
            </div>
          );
        })}
        {(g.day.blocks ?? []).filter((b) => b.kind === 'personal' && b.end > grid.from && b.start < grid.to).map((b) => (
          <div key={`p${b.start}`} class="dg-band" style={{ top: `${top(Math.max(b.start, grid.from))}px`, height: `${top(Math.min(b.end, grid.to)) - top(Math.max(b.start, grid.from))}px` }} aria-hidden="true"><span>{b.emoji} {b.label ?? b.name}</span></div>
        ))}
        {grid.items.map(item)}
        {showNow && <div class="dg-now" style={{ top: `${top(nowMin)}px` }} role="img" aria-label={`Now ${clock(nowMin)}`} data-testid="dg-now"><time>{clock(nowMin)}</time></div>}
        {placing !== null && (
          <div class="fl-popover dg-place" role="dialog" aria-label={`Place here, ${clock(placing)}`} data-testid="dg-place" style={{ top: `${top(placing) + ROW}px` }}>
            <p class="dg-place-head">Place at {clock(placing)}</p>
            {choices(placing).length === 0 && <p class="fl-hint">Nothing to place. Add a task first.</p>}
            {choices(placing).map(({ t, planned }) => (
              <button type="button" key={t.ref} class="fl-option" onClick={() => place(t.ref, placing)} ref={(el) => { if (el && !el.dataset.seen && el === el.parentElement?.querySelector('.fl-option')) { el.dataset.seen = '1'; el.focus(); } }}>
                <span class="dg-place-t">{titleOf(t)}</span><span class="dg-place-m">{span(estimate(t).minutes)}{planned ? ' · planned' : " · doesn't fit"}</span>
              </button>
            ))}
            <div class="fl-pop-row"><button type="button" class="fl-btn subtle" onClick={() => closePlace(placing)}>Cancel</button></div>
          </div>
        )}
      </div>
      {meeting && <MeetingDetail {...meeting} onClose={() => setMeeting(null)} />}
    </div>
  );
}
