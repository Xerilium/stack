/**
 * Page states: empty, loading, and error. Every view shows these three the same way.
 * @req FR:ui-kit/empty @req FR:ui-kit/loading @req FR:ui-kit/error
 */
import type { ComponentChildren } from 'preact';
import './ui.css';

/**
 * What is empty, then the next step (a key, a button, or a link). Text only, no art.
 * @req FR:ui-kit/empty @req FR:first-run-onboarding/polish.empty
 */
export function EmptyState({ what, next }: { what: ComponentChildren; next?: ComponentChildren }) {
  return <div class="empty-state" data-testid="empty-state"><p class="empty-what">{what}</p>{next && <p class="empty-next">{next}</p>}</div>;
}

/** A status whose text, `Loading {what}`, only assistive tech reads, with gray bars in place of rows. @req FR:ui-kit/loading @req FR:ui-kit/loading.bars */
export function Loading({ what, rows = 3 }: { /** The plural noun that loads, for example `sessions`. */ what: string; rows?: number }) {
  return (
    <div class="ui-loading" role="status" data-testid="ui-loading">
      <span class="sr-only">{`Loading ${what}`}</span>
      {Array.from({ length: rows }, (_, i) => <div key={i} class="ui-sk" aria-hidden="true" />)}
    </div>
  );
}

/** An alert: what happened, the next step, and `Retry` when the view can retry. @req FR:ui-kit/error @req FR:ui-kit/error.retry */
export function ErrorState({ what, next, onRetry }: { what: ComponentChildren; next?: ComponentChildren; onRetry?: () => void }) {
  return (
    <div class="ui-error" role="alert" data-testid="ui-error">
      <p class="ui-error-what">{what}</p>
      {next && <p class="ui-error-next">{next}</p>}
      {onRetry && <button type="button" class="fl-btn" onClick={onRetry}>Retry</button>}
    </div>
  );
}
