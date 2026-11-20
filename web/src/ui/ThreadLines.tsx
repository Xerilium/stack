import { useState } from 'preact/hooks';
import './ui.css';

export interface ThreadLineItem { at: string; who: string; text: string; /** A system line (Stack's own notes): shown quieter. */ muted?: boolean }

const when = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).replace(' AM', ' am').replace(' PM', ' pm');
};

/**
 * A conversation thread, oldest first: the newest `max` lines, and `Show all` for the rest. Each line is `<who>: <text>` with its time.
 * @req FR:ask-routing/ui.thread @req FR:ask-routing/ui.kit @req FR:ui-kit/guard.owns
 * @owns class:ui-thread
 */
export function ThreadLines({ lines, label, max = 5 }: { lines: ThreadLineItem[]; label: string; max?: number }) {
  const [all, setAll] = useState(false);
  if (!lines.length) return null;
  const hidden = all ? 0 : Math.max(0, lines.length - max);
  return (
    <div class="ui-thread-wrap">
      <ol class="ui-thread" aria-label={label}>
        {lines.slice(hidden).map((l, i) => (
          <li key={`${l.at}-${i}`} class={l.muted ? 'muted' : undefined}>
            <span class="ui-thread-say"><span class="ui-thread-who">{l.who}:</span> {l.text}</span>
            <time dateTime={l.at}>{when(l.at)}</time>
          </li>
        ))}
      </ol>
      {(hidden > 0 || all) && lines.length > max && <button type="button" class="ui-thread-more" aria-expanded={all} onClick={() => setAll(!all)}>{all ? 'Show fewer' : 'Show all'}</button>}
    </div>
  );
}
