/**
 * Actions for one item: a quiet `⋯` button with a menu, and the same actions as a bar for a details pane.
 * Arrow keys, Home, End; Escape or a tap outside closes and returns focus. Opens upward when there is no room below.
 * @req FR:ui-kit/menu @req FR:ui-kit/bar
 */
import { useLayoutEffect, useRef, useState } from 'preact/hooks';
import './ui.css';

export interface ActionItem { id: string; label: string; title?: string; href?: string; disabled?: boolean; onSelect?: () => void }

export function ActionMenu({ name, items }: { /** The button and menu name, for example `Actions for o/r#1`. */ name: string; items: ActionItem[] }) {
  const [open, setOpen] = useState(false);
  const [up, setUp] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const els = () => [...(box.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not(:disabled)') ?? [])];
  const close = (back: boolean) => { setOpen(false); if (back) btn.current?.focus(); };
  useLayoutEffect(() => {
    if (!open) { setUp(false); return; }
    const m = box.current?.querySelector<HTMLElement>('[role="menu"]');
    const b = btn.current?.getBoundingClientRect();
    const bar = document.querySelector<HTMLElement>('.tabbar');
    const floor = Math.min(window.innerHeight, bar?.getBoundingClientRect().top || Infinity) - 8;
    if (m && b && b.bottom + m.offsetHeight + 4 > floor && b.top - m.offsetHeight - 4 > 0) setUp(true);
    els()[0]?.focus();
  }, [open]);
  useLayoutEffect(() => {
    if (!open) return;
    const key = (e: KeyboardEvent) => {
      // Escape closes the menu only, not a dialog under it.
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(true); return; }
      if (e.key === 'Tab') { close(false); return; }
      const all = els(); const at = all.indexOf(document.activeElement as HTMLElement);
      const go = (i: number) => { e.preventDefault(); e.stopPropagation(); all[(i + all.length) % all.length]?.focus(); };
      if (e.key === 'ArrowDown') go(at + 1); else if (e.key === 'ArrowUp') go(at - 1); else if (e.key === 'Home') go(0); else if (e.key === 'End') go(all.length - 1);
    };
    const down = (e: Event) => { if (!box.current?.contains(e.target as Node)) close(false); };
    document.addEventListener('keydown', key, true); document.addEventListener('pointerdown', down, true);
    return () => { document.removeEventListener('keydown', key, true); document.removeEventListener('pointerdown', down, true); };
  }, [open]);
  return (
    <div class="ui-more" ref={box}>
      <button type="button" ref={btn} class="ui-more-btn" aria-haspopup="menu" aria-expanded={open} aria-label={name} title="Actions" onClick={() => setOpen((o) => !o)}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 12h.01M12 12h.01M18 12h.01" stroke="currentColor" stroke-width="3" stroke-linecap="round" /></svg>
      </button>
      {open && (
        <div class={`menu ui-menu${up ? ' up' : ''}`} role="menu" aria-label={name}>
          {items.map((a) => a.href
            ? <a key={a.id} role="menuitem" class="menu-item" href={a.href} target="_blank" rel="noopener noreferrer" title={a.title} onClick={() => close(false)}>{a.label}</a>
            : <button key={a.id} type="button" role="menuitem" class="menu-item" title={a.title} disabled={a.disabled} onClick={() => { close(true); a.onSelect?.(); }}>{a.label}</button>)}
        </div>
      )}
    </div>
  );
}

/** The same actions as plain buttons and links, under a heading. @req FR:ui-kit/bar */
export function ActionBar({ heading, items }: { heading: string; items: ActionItem[] }) {
  return (
    <section class="ui-bar" aria-label={heading}>
      <h4 class="ui-bar-h">{heading}</h4>
      <div class="ui-bar-row">
        {items.map((a) => a.href
          ? <a key={a.id} class="fl-btn" href={a.href} target="_blank" rel="noopener noreferrer" title={a.title}>{a.label}</a>
          : <button key={a.id} type="button" class="fl-btn" title={a.title} disabled={a.disabled} onClick={a.onSelect}>{a.label}</button>)}
      </div>
    </section>
  );
}
