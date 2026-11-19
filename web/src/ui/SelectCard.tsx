/**
 * One card shape: a top line, a title, a sub line, and tools. A tap anywhere on the card (not on a link or a tool) selects it;
 * Enter or Space on the focused card does the same. It ends in a chevron and shows the selected state with `aria-current`.
 * With `label`, the title and sub line sit outside the button (so links in them stay links) and the button is named `label`.
 * @req FR:ui-kit/card @req FR:ui-kit/guard.owns
 * @owns class:ui-card legacy: PrioritiesTables.tsx=1
 */
import type { ComponentChildren } from "preact";
import "./ui.css";

export interface SelectCardProps {
  selected: boolean;
  onSelect: () => void;
  title: ComponentChildren;
  /** Above the title: links, flags, chips. Sits above the stretched select target. */
  top?: ComponentChildren;
  sub?: ComponentChildren;
  /** Read after the title by assistive tech only. */
  sr?: string;
  tools?: ComponentChildren;
  /** The button name when the title or sub line holds links: they then sit outside the button, above its stretched target. */
  label?: string;
  /** Extra classes on the card (tone, drag state). */
  class?: string;
  /** `data-*` attributes for the card. */
  data?: Record<string, string | number | undefined>;
}
export function SelectCard(p: SelectCardProps) {
  const data = Object.fromEntries(
    Object.entries(p.data ?? {})
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [`data-${k}`, String(v)]),
  );
  const current = p.selected ? "true" : undefined;
  return (
    <li
      class={`ui-card${p.class ? ` ${p.class}` : ""}`}
      data-selected={current}
      {...data}
    >
      {p.top !== undefined && <div class="ui-card-top">{p.top}</div>}
      {p.label !== undefined ? (
        <div class="ui-card-body">
          <span class="ui-card-title">{p.title}</span>
          {p.sub !== undefined && <span class="ui-card-sub">{p.sub}</span>}
          <button
            type="button"
            class="ui-card-open ui-card-chev-btn"
            aria-label={p.label}
            aria-current={current}
            onClick={p.onSelect}
          >
            <span class="ui-card-chev" aria-hidden="true">
              ›
            </span>
          </button>
        </div>
      ) : (
        <button
          type="button"
          class="ui-card-open"
          aria-current={current}
          onClick={p.onSelect}
        >
          <span class="ui-card-title">{p.title}</span>
          {p.sr && <span class="sr-only">{p.sr}</span>}
          {p.sub !== undefined && <span class="ui-card-sub">{p.sub}</span>}
          <span class="ui-card-chev" aria-hidden="true">
            ›
          </span>
        </button>
      )}
      {p.tools !== undefined && <div class="ui-card-tools">{p.tools}</div>}
    </li>
  );
}
