/**
 * The shared view kit: one set of components every view builds on (`.xe/standards/ui.md`). Muted Fluent 2: neutral
 * surfaces, one accent (brand: links, the chosen tab, focus). The PR page and the priorities report use it.
 * @req FR:priorities-tables/web.kit
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import './kit.css';

/** True while `query` matches (for example a wide split view). */
export function useWide(query: string, on = true): boolean {
  const q = () => on && typeof window !== 'undefined' && !!window.matchMedia?.(query).matches;
  const [wide, setWide] = useState(q);
  useEffect(() => {
    if (!on || !window.matchMedia) return;
    const m = window.matchMedia(query);
    const f = () => setWide(m.matches);
    f();
    m.addEventListener('change', f);
    return () => m.removeEventListener('change', f);
  }, [query, on]);
  return wide;
}

/** A state chip: outline, no fill; an optional icon and one word. @req FR:priorities-tables/web.status.chip */
export function Chip({ icon, children, cls, title }: { icon?: string; children: ComponentChildren; cls?: string; title?: string }) {
  return <span class={`kit-chip${cls ? ` ${cls}` : ''}`} title={title}>{icon && <span class="kit-chip-icon" aria-hidden="true">{icon}</span>}{children}</span>;
}

/**
 * A card in a list. The whole card opens its detail (a stretched button named `label`); links in `top` and `title` sit above
 * it and stay links. Ends in a chevron. @req FR:priorities-tables/web.card.open
 */
export function ItemCard({ label, onOpen, current, top, aside, title, sub, cls, testid }: {
  label: string; onOpen: () => void; current?: boolean; top: ComponentChildren; aside?: ComponentChildren; title: ComponentChildren; sub?: ComponentChildren; cls?: string; testid?: string;
}) {
  return (
    <li class={`kit-card${cls ? ` ${cls}` : ''}`} data-current={current ? 'true' : undefined} data-testid={testid}>
      <div class="kit-card-top">{top}</div>
      {aside !== undefined && <div class="kit-card-aside">{aside}</div>}
      <div class="kit-card-title">{title}</div>
      {sub !== undefined && <div class="kit-card-sub">{sub}</div>}
      <button type="button" class="kit-card-open" aria-label={label} aria-current={current ? 'true' : undefined} onClick={onOpen}><span class="kit-card-chev" aria-hidden="true">›</span></button>
    </li>
  );
}

/** Tabs (ARIA tabs pattern): arrows, Home and End move; `aside` sits at the right end of the bar. @req FR:priorities-tables/web.tabs.keys */
export function Tabs<K extends string>({ items, current, onPick, label, idPrefix, aside }: {
  items: { key: K; label: string }[]; current: K; onPick: (k: K) => void; label: string; idPrefix: string; aside?: ComponentChildren;
}) {
  const refs = useRef<Partial<Record<K, HTMLButtonElement | null>>>({});
  const keys = items.map((x) => x.key);
  const onKey = (e: KeyboardEvent) => {
    const i = keys.indexOf(current);
    const to = e.key === 'ArrowRight' ? keys[(i + 1) % keys.length] : e.key === 'ArrowLeft' ? keys[(i - 1 + keys.length) % keys.length] : e.key === 'Home' ? keys[0] : e.key === 'End' ? keys[keys.length - 1] : undefined;
    if (to) { e.preventDefault(); onPick(to); refs.current[to]?.focus(); }
  };
  return (
    <div class="kit-tabbar">
      <div class="kit-tabs" role="tablist" aria-label={label} onKeyDown={onKey}>
        {items.map((x) => (
          <button key={x.key} type="button" role="tab" id={`${idPrefix}-tab-${x.key}`} aria-controls={`${idPrefix}-panel`} aria-selected={x.key === current} tabIndex={x.key === current ? 0 : -1}
            class="kit-tab" ref={(el) => { refs.current[x.key] = el; }} onClick={() => onPick(x.key)} data-testid={`${idPrefix}-tab-${x.key}`}>{x.label}</button>
        ))}
      </div>
      {aside !== undefined && <div class="kit-tabbar-aside">{aside}</div>}
    </div>
  );
}

/**
 * A list with a detail pane: side by side when wide; when narrow the detail replaces the list, with Back.
 * @req FR:priorities-tables/web.detail
 */
export function SplitView({ wide, open, list, detail, label, empty, onBack }: {
  wide: boolean; open: boolean; list: ComponentChildren; detail: ComponentChildren; label: string; empty: string; onBack: () => void;
}) {
  const h = useRef<HTMLDivElement>(null);
  useEffect(() => { if (open && !wide) h.current?.querySelector<HTMLElement>('h3')?.focus(); }, [open, wide]);
  const show = !wide && open;
  return (
    <div class={`kit-split${wide ? ' wide' : ''}`}>
      <div class="kit-split-list" hidden={show}>{list}</div>
      {(wide || show) && (
        <aside class="kit-split-detail" aria-label={label} ref={h} data-testid="split-detail">
          {show && <button type="button" class="fl-btn subtle kit-back" onClick={onBack}>‹ Back</button>}
          {open ? detail : <p class="kit-split-empty">{empty}</p>}
        </aside>
      )}
    </div>
  );
}
