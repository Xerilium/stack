/**
 * A group that stays closed until the owner opens it: a heading button with the title and a count, and optional controls beside it.
 * @req FR:ui-kit/fold.show @req FR:ui-kit/fold.toggle @req FR:ui-kit/fold.aside @req FR:ui-kit/guard.owns
 * @owns class:ui-fold
 */
import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import './ui.css';

export function Fold({ id, title, count, aside, children, open: first = false }: { /** Unique on the page; names the content for the button. */ id: string; title: string; count?: number; /** Controls for the group, shown only while it is open. */ aside?: ComponentChildren; children: ComponentChildren; open?: boolean }) {
  const [open, setOpen] = useState(first);
  return (
    <section class="ui-fold" data-open={open ? 'true' : undefined}>
      <div class="ui-fold-head">
        <h2 class="ui-fold-h">
          <button type="button" class="ui-fold-btn" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
            <span class="ui-fold-chev" aria-hidden="true">›</span>{title}{count !== undefined && <span class="ui-fold-count">{count}</span>}
          </button>
        </h2>
        {open && aside !== undefined && <div class="ui-fold-aside">{aside}</div>}
      </div>
      <div id={id} class="ui-fold-body" hidden={!open}>{open && children}</div>
    </section>
  );
}
