/**
 * The top of a page: an `h1` title, an optional muted `meta` after it, an optional `sub` line, and optional `actions` at the right.
 * @req FR:ui-kit/header @req FR:ui-kit/header.wrap
 */
import type { ComponentChildren } from 'preact';
import './ui.css';

export function PageHeader({ title, meta, sub, actions }: { title: ComponentChildren; /** A count or an "as of" time, after the title. */ meta?: ComponentChildren; /** One line under the title that says what the page is for. */ sub?: ComponentChildren; actions?: ComponentChildren }) {
  return (
    <header class="ui-head">
      <div class="ui-head-main">
        <h1 class="ui-head-title">{title}</h1>
        {meta != null && <span class="ui-head-meta">{meta}</span>}
        {sub != null && <p class="ui-head-sub">{sub}</p>}
      </div>
      {actions != null && <div class="ui-head-actions">{actions}</div>}
    </header>
  );
}
