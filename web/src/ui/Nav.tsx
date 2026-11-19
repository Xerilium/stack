/**
 * The nav item and the one nav icon set. Every item in the desktop rail and the phone tab bar is a `NavItem`:
 * a muted line icon, the label, and an optional badge. Add a new icon to `NAV_ICONS`; do not draw one in a view.
 * @req FR:ui-kit/nav @req FR:ui-kit/nav.icon @req FR:ui-kit/nav.icon.all @req FR:ui-kit/nav.icon.muted @req FR:ui-kit/nav.current
 * @owns class:ui-nav-ic
 * @owns class:tab-label
 */
import type { ComponentChildren } from 'preact';
import './ui.css';

/** One path per icon, on a 24 px grid. @req FR:ui-kit/nav.icon.all */
export const NAV_ICONS = {
  new: 'M12 5v14M5 12h14',
  now: 'M12 4a8 8 0 1 0 0 16 8 8 0 0 0 0-16Zm0 5a3 3 0 1 0 0 6 3 3 0 0 0 0-6Z',
  home: 'M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1Z',
  today: 'M5 5h14a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Zm-1 5h16M8 3v4m8-4v4',
  asks: 'M12 3a6 6 0 0 0-6 6v3.6L4.3 15.4A1 1 0 0 0 5.2 17h13.6a1 1 0 0 0 .9-1.6L18 12.6V9a6 6 0 0 0-6-6Zm-2.2 15.5a2.3 2.3 0 0 0 4.4 0',
  prs: 'M6 8.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm0 0v7m0 0a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm12 0a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5Zm0 0V9.5a3 3 0 0 0-3-3h-3.5m0 0L14 4m-2.5 2.5L14 9',
  inbox: 'M4 13h4l1.5 3h5L16 13h4M4 13l2-7h12l2 7v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1Z',
  sessions: 'M12 3.5V7M7 7h10a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Zm2.5 5v1.5m5-1.5v1.5M9.5 16h5M2.5 11.5v3m19-3v3',
  inventory: 'M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6Zm4 13h8M8 8l2.5 2.5L8 13m4 0h4',
  projects: 'M3.5 7a2 2 0 0 1 2-2h3.7l2 2.5h7.3a2 2 0 0 1 2 2V17a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2Z',
  list: 'M12 4 3.5 8.5 12 13l8.5-4.5L12 4Zm-8.5 8L12 16.5l8.5-4.5m-17 3.5L12 20l8.5-4.5',
  settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 3h-4l-.4 2.6a7.5 7.5 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7.5 7.5 0 0 0 2 1.2l.4 2.6h4l.4-2.6a7.5 7.5 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z',
  commands: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14Zm5 12 4.5 4.5',
  shortcuts: 'M4 7h16a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 20 17H4a1.5 1.5 0 0 1-1.5-1.5v-7A1.5 1.5 0 0 1 4 7Zm3 3.5h.01m3.99 0h.01m3.99 0h.01M8 13.5h8',
  more: 'M5 12h.01M12 12h.01M19 12h.01',
} as const;
export type NavIconName = keyof typeof NAV_ICONS;

/** One icon from the set: a line drawing in the current text color, hidden from assistive tech. @req FR:ui-kit/nav.icon */
export function NavIcon({ name }: { name: NavIconName }) {
  return <svg class="ui-nav-ic" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" data-icon={name}><path d={NAV_ICONS[name]} fill="none" stroke="currentColor" stroke-width={name === 'more' ? 3 : 1.7} stroke-linecap="round" stroke-linejoin="round" /></svg>;
}

export interface NavItemProps {
  icon: NavIconName;
  label: string;
  onClick: () => void;
  /** The current page: `aria-current="page"` and the class `on`. */
  current?: boolean;
  /** The tooltip, for example `Now (g n)`. */
  title?: string;
  /** The accessible name when it must say more than the label. */
  name?: string;
  /** A count pill or an attention dot, after the label. */
  badge?: ComponentChildren;
  /** Extra classes on the button (`add`, `set-tab`). */
  class?: string;
  testid?: string;
}
/** One nav button: icon, label, badge. The rail and the tab bar lay it out. @req FR:ui-kit/nav @req FR:ui-kit/nav.current */
export function NavItem(p: NavItemProps) {
  return (
    <button type="button" class={`tab${p.class ? ` ${p.class}` : ''}${p.current ? ' on' : ''}`} aria-current={p.current ? 'page' : undefined} aria-label={p.name} title={p.title} data-testid={p.testid} onClick={p.onClick}>
      <NavIcon name={p.icon} />
      <span class="tab-label">{p.label}{p.badge}</span>
    </button>
  );
}
