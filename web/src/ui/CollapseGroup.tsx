import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import './ui.css';

/**
 * A collapsed group under a list: one header button `<label> (<count>)` that opens and closes it. Starts collapsed.
 * @req FR:ask-routing/ui.waiting @req FR:ask-routing/ui.kit @req FR:ui-kit/guard.owns
 * @owns class:ui-group
 */
export function CollapseGroup({ label, count, testid, children }: { label: string; count: number; testid?: string; children: ComponentChildren }) {
  const [open, setOpen] = useState(false);
  return (
    <section class="ui-group" aria-label={label} {...(testid ? { 'data-testid': testid } : {})}>
      <button type="button" class="ui-group-head" aria-expanded={open} onClick={() => setOpen(!open)}>{label} ({count})</button>
      {open && <div class="ui-group-body">{children}</div>}
    </section>
  );
}
