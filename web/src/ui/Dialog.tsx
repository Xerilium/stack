import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef } from 'preact/hooks';
import './ui.css';

/**
 * A modal dialog: a scrim, a titled box, a focus trap, Escape to close, and focus back to the opener on close.
 * @req FR:ui-kit/dialog
 * @req FR:ui-kit/dialog.focus
 * @req FR:ui-kit/dialog.trap
 * @req FR:ui-kit/dialog.return
 * @req FR:ui-kit/dialog.close
 * @req FR:ui-kit/dialog.sheet
 * @req FR:web-app/ux.a11y
 * @owns role:dialog legacy: FeedbackPanel.tsx=1 TaskDetail.tsx=2 NowChat.tsx=1 SessionsView.tsx=1
 * @owns class:dialog legacy: FeedbackPanel.tsx=1
 * @owns class:scrim legacy: FeedbackPanel.tsx=1
 */
export function Dialog({ title, onClose, children, sheet = true }: { title: string; onClose: () => void; children: ComponentChildren; sheet?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    const first = ref.current?.querySelector<HTMLElement>('input, button');
    first?.focus();
    return () => prev?.focus?.();
  }, []);
  return (
    <div class="scrim" onClick={onClose}>
      <div ref={ref} class={`dialog${sheet ? ' sheet' : ''}`} role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose(); return; }
          if (e.key === 'Tab') {
            const els = [...ref.current!.querySelectorAll<HTMLElement>('input, button, [tabindex="0"]')].filter((x) => !(x as HTMLButtonElement).disabled);
            if (!els.length) return;
            const i = els.indexOf(document.activeElement as HTMLElement);
            const next = e.shiftKey ? (i <= 0 ? els.length - 1 : i - 1) : (i + 1) % els.length;
            e.preventDefault();
            els[next].focus();
          }
        }}>
        <h2 class="dialog-title">{title}</h2>
        {children}
      </div>
    </div>
  );
}
