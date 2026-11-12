/**
 * App chrome for Notifications and More: the bell with its count, the desktop flyout, and the More menu.
 * @req FR:notifications/bell.place @req FR:notifications/bell.count @req FR:notifications/bell.flyout @req FR:notifications/bell.phone
 * @req FR:notifications/nav.rail @req FR:notifications/nav.tabbar @req FR:notifications/sessions.more @req NFR:notifications/a11y.targets @req NFR:notifications/calm
 */
import { useEffect, useRef } from 'preact/hooks';
import type { AskItem } from './asks';
import { AskCards, type AskCtl } from './NowAsks';
import './notifications.css';

const BELL = 'M12 3a6 6 0 0 0-6 6v3.6L4.3 15.4A1 1 0 0 0 5.2 17h13.6a1 1 0 0 0 .9-1.6L18 12.6V9a6 6 0 0 0-6-6Zm-2.2 15.5a2.3 2.3 0 0 0 4.4 0Z';

/** The flyout only on a wide screen with a pointer; a phone opens the page. */
export const flyoutFits = () => typeof matchMedia === 'function' && matchMedia('(min-width: 720px) and (hover: hover)').matches;

export function Bell({ count, open, onClick, compact }: { count: number; open: boolean; onClick: (el: HTMLElement) => void; compact?: boolean }) {
  return (
    <button type="button" class={`bell${compact ? ' compact' : ''}`} data-testid={compact ? 'bell-phone' : 'bell'} aria-label={count > 0 ? `Notifications, ${count}` : 'Notifications'}
      aria-haspopup="dialog" aria-expanded={open} title="Notifications (G K)" onClick={(e) => onClick(e.currentTarget as HTMLElement)}>
      <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d={BELL} fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" /></svg>
      {count > 0 && <span class="badge" aria-hidden="true">{count > 99 ? '99+' : count}</span>}
    </button>
  );
}

/** Top notifications as Now's ask cards, with direct actions; `See all` opens the page. */
export function NoticeFlyout({ rows, more, ctl, signin, onSignIn, onSeeAll, onClose, opener }: {
  rows: AskItem[]; more: number; ctl: AskCtl; signin: boolean; onSignIn: () => void; onSeeAll: () => void; onClose: () => void; opener: HTMLElement | null;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    ref.current?.focus();
    const close = (back: boolean) => { onClose(); if (back) opener?.focus(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); close(true); } };
    const onDown = (e: MouseEvent) => { const t = e.target as Node; if (!ref.current?.contains(t) && !opener?.contains(t)) close(false); };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('mousedown', onDown);
    return () => { window.removeEventListener('keydown', onKey, true); document.removeEventListener('mousedown', onDown); };
  }, []);
  const empty = rows.length === 0 && !signin;
  return (
    <div class="notice-fly" role="dialog" aria-label="Notifications" tabIndex={-1} ref={ref}>
      <div class="notice-head">
        <h2 class="notice-h">Notifications</h2>
        <a class="notice-all" href="#/notifications" onClick={(e) => { e.preventDefault(); onSeeAll(); }}>See all{more > 0 ? ` (${more} more)` : ''}</a>
      </div>
      {signin && (
        <div class="notice-signin" data-testid="signin-flyout">
          <span>Sign-in expired</span>
          <button type="button" class="now-act primary" onClick={onSignIn}>Sign in</button>
        </div>
      )}
      {empty ? <p class="notice-empty">You're all caught up.</p> : rows.length > 0 && <AskCards rows={rows} ctl={ctl} testId="notice-asks" />}
    </div>
  );
}

export interface MoreItem { id: string; label: string; run: () => void }

/** A menu of the places that have no slot of their own. Arrow keys move; Escape or a click outside closes. */
export function MoreMenu({ items, onClose, opener, cls }: { items: MoreItem[]; onClose: () => void; opener: HTMLElement | null; cls: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    (ref.current?.querySelector('[role="menuitem"]') as HTMLElement | null)?.focus();
    const onDown = (e: MouseEvent) => { const t = e.target as Node; if (!ref.current?.contains(t) && !opener?.contains(t)) onClose(); };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);
  const onKey = (e: KeyboardEvent) => {
    const all = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? [])];
    const at = all.indexOf(document.activeElement as HTMLElement);
    const to = (i: number) => { e.preventDefault(); all[(i + all.length) % all.length]?.focus(); };
    if (e.key === 'ArrowDown') to(at + 1);
    else if (e.key === 'ArrowUp') to(at - 1);
    else if (e.key === 'Home') to(0);
    else if (e.key === 'End') to(all.length - 1);
    else if (e.key === 'Escape' || e.key === 'Tab') { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); opener?.focus(); } onClose(); }
  };
  return (
    <div class={`more-menu ${cls}`} role="menu" aria-label="More" ref={ref} onKeyDown={onKey}>
      {items.map((x) => <button type="button" role="menuitem" class="more-item" key={x.id} tabIndex={-1} onClick={() => { onClose(); x.run(); }}>{x.label}</button>)}
    </div>
  );
}
