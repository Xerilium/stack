import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";
import "./ui.css";

/**
 * A list with a detail pane: side by side when wide; when narrow the detail replaces the list, with Back.
 * @req FR:ui-kit/split @req FR:ui-kit/guard.owns
 * @owns class:ui-split
 */
export function SplitView({
  wide,
  open,
  list,
  detail,
  label,
  empty,
  onBack,
  reader = false,
}: {
  wide: boolean;
  open: boolean;
  list: ComponentChildren;
  detail: ComponentChildren;
  label: string;
  empty: string;
  onBack: () => void;
  /** A reading layout: the detail takes the larger share of the width. @req FR:ui-kit/split.reader */
  reader?: boolean;
}) {
  const h = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (open && !wide) h.current?.querySelector<HTMLElement>("h3")?.focus();
  }, [open, wide]);
  const show = !wide && open;
  return (
    <div class={`ui-split${wide ? " wide" : ""}${reader ? " reader" : ""}`}>
      <div class="ui-split-list" hidden={show}>
        {list}
      </div>
      {(wide || show) && (
        <aside
          class="ui-split-detail"
          aria-label={label}
          ref={h}
          data-testid="split-detail"
        >
          {show && (
            <button
              type="button"
              class="fl-btn subtle ui-back"
              onClick={onBack}
            >
              ‹ Back
            </button>
          )}
          {open ? detail : <p class="ui-split-empty">{empty}</p>}
        </aside>
      )}
    </div>
  );
}
