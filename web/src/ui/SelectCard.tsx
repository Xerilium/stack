/**
 * One card shape: a top line, a title, a sub line, and tools. A tap anywhere on the card (not on a link or a tool) selects it;
 * Enter or Space on the focused card does the same. It ends in a chevron and shows the selected state with `aria-current`.
 * @req FR:ui-kit/card
 */
import type { ComponentChildren } from 'preact';
import './ui.css';

export interface SelectCardProps {
  selected: boolean; onSelect: () => void; title: ComponentChildren;
  /** Above the title: links, flags, chips. Sits above the stretched select target. */
  top?: ComponentChildren; sub?: ComponentChildren;
  /** Read after the title by assistive tech only. */
  sr?: string; tools?: ComponentChildren;
  /** Extra classes on the card (tone, drag state). */
  class?: string;
  /** `data-*` attributes for the card. */
  data?: Record<string, string | number | undefined>;
}
export function SelectCard(p: SelectCardProps) {
  const data = Object.fromEntries(Object.entries(p.data ?? {}).filter(([, v]) => v !== undefined).map(([k, v]) => [`data-${k}`, String(v)]));
  return (
    <li class={`ui-card${p.class ? ` ${p.class}` : ''}`} data-selected={p.selected ? 'true' : undefined} {...data}>
      {p.top !== undefined && <div class="ui-card-top">{p.top}</div>}
      <button type="button" class="ui-card-open" aria-current={p.selected ? 'true' : undefined} onClick={p.onSelect}>
        <span class="ui-card-title">{p.title}</span>
        {p.sr && <span class="sr-only">{p.sr}</span>}
        {p.sub !== undefined && <span class="ui-card-sub">{p.sub}</span>}
        <span class="ui-card-chev" aria-hidden="true">›</span>
      </button>
      {p.tools !== undefined && <div class="ui-card-tools">{p.tools}</div>}
    </li>
  );
}
