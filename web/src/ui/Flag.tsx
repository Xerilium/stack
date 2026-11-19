/**
 * A flag: a small icon and a muted word that notes something. Not a control: no fill, no border, no hover, not focusable.
 * @req FR:ui-kit/flag
 */
import './ui.css';

export function Flag({ text, hidden = false }: { text: string; /** Hide from assistive tech when the same words are said elsewhere. */ hidden?: boolean }) {
  return (
    <span class="ui-flag" {...(hidden ? { 'aria-hidden': 'true' } : {})}>
      <svg class="ui-flag-ic" viewBox="0 0 16 16" width="12" height="12" aria-hidden="true"><path d="M3.5 14V2.5m0 0h8l-1.8 3 1.8 3h-8" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
      {text}
    </span>
  );
}
