/**
 * Filter pills: a named group of toggles that filter a list; any number can be on. Each pill is the word, then an optional quiet count.
 * On shows a check mark, so the state does not rely on color alone. Filters, not actions: no fill, no shadow.
 * @req FR:ui-kit/pills @req FR:ui-kit/pills.toggle @req FR:ui-kit/pills.count @req FR:ui-kit/pills.look
 * @owns class:ui-pills
 * @owns class:ui-pill
 */
import './ui.css';

export function FilterPills<K extends string>({ label, items, selected, onToggle }: {
  label: string;
  items: { key: K; label: string; count?: number }[];
  selected: readonly K[];
  onToggle: (k: K) => void;
}) {
  return (
    <div class="ui-pills" role="group" aria-label={label}>
      {items.map((x) => {
        const on = selected.includes(x.key);
        return (
          <button key={x.key} type="button" class="ui-pill" aria-pressed={on} onClick={() => onToggle(x.key)}>
            {on && <svg class="ui-pill-check" aria-hidden="true" viewBox="0 0 12 12" width="12" height="12"><path d="M2.5 6.2 5 8.5l4.5-5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>}
            {x.label}
            {x.count !== undefined && <>{' '}<span class="ui-pill-count">{x.count}</span></>}
          </button>
        );
      })}
    </div>
  );
}
