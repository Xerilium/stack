import type { ComponentChildren } from "preact";
import { useRef } from "preact/hooks";
import "./ui.css";

/**
 * Tabs (ARIA tabs pattern): arrows, Home and End move; `aside` sits at the right end of the bar.
 * @req FR:ui-kit/tabs @req FR:ui-kit/guard.owns
 * @owns role:tablist legacy: PrsPanel.tsx=1 SessionsView.tsx=1
 * @owns class:ui-tabs
 * @owns class:ui-tab
 */
export function Tabs<K extends string>({
  items,
  current,
  onPick,
  label,
  idPrefix,
  aside,
}: {
  items: { key: K; label: string }[];
  current: K;
  onPick: (k: K) => void;
  label: string;
  idPrefix: string;
  aside?: ComponentChildren;
}) {
  const refs = useRef<Partial<Record<K, HTMLButtonElement | null>>>({});
  const keys = items.map((x) => x.key);
  const onKey = (e: KeyboardEvent) => {
    const i = keys.indexOf(current);
    const to =
      e.key === "ArrowRight"
        ? keys[(i + 1) % keys.length]
        : e.key === "ArrowLeft"
          ? keys[(i - 1 + keys.length) % keys.length]
          : e.key === "Home"
            ? keys[0]
            : e.key === "End"
              ? keys[keys.length - 1]
              : undefined;
    if (to) {
      e.preventDefault();
      onPick(to);
      refs.current[to]?.focus();
    }
  };
  return (
    <div class="ui-tabbar">
      <div class="ui-tabs" role="tablist" aria-label={label} onKeyDown={onKey}>
        {items.map((x) => (
          <button
            key={x.key}
            type="button"
            role="tab"
            id={`${idPrefix}-tab-${x.key}`}
            aria-controls={`${idPrefix}-panel`}
            aria-selected={x.key === current}
            tabIndex={x.key === current ? 0 : -1}
            class="ui-tab"
            ref={(el) => {
              refs.current[x.key] = el;
            }}
            onClick={() => onPick(x.key)}
            data-testid={`${idPrefix}-tab-${x.key}`}
          >
            {x.label}
          </button>
        ))}
      </div>
      {aside !== undefined && <div class="ui-tabbar-aside">{aside}</div>}
    </div>
  );
}
