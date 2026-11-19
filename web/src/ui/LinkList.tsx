/**
 * One labelled line of links: a small muted label, then the links, which wrap. Web links open in a new tab; app links open in place.
 * Shows nothing with no items. The caller checks each target.
 * @req FR:ui-kit/links
 */
import './ui.css';

export interface LinkItem { text: string; href: string }
export function LinkList({ label, items }: { label: string; items: LinkItem[] }) {
  if (!items.length) return null;
  return (
    <p class="ui-links">
      <span class="ui-links-h">{label}</span>
      {items.map((x) => (/^https?:/i.test(x.href)
        ? <a key={x.href} href={x.href} target="_blank" rel="noopener noreferrer">{x.text}</a>
        : <a key={x.href} href={x.href}>{x.text}</a>))}
    </p>
  );
}
