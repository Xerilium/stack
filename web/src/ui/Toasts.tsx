/**
 * The toast stack: one polite live region; each toast has its text, an optional Undo, and Dismiss.
 * @req FR:ui-kit/toasts
 * @req FR:ui-kit/toasts.dismiss
 * @req FR:ui-kit/toasts.undo
 * @owns class:toasts
 * @owns class:toast
 */
export interface Toast { id: number; text: string; kind: 'ok' | 'err'; undo?: () => void }
export function Toasts({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }) {
  return (
    <div class="toasts" role="status" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} class={`toast ${t.kind}`}>
          <span>{t.text}</span>
          {t.undo && <button type="button" class="link" onClick={() => { t.undo!(); dismiss(t.id); }}>Undo</button>}
          <button type="button" class="link" aria-label="Dismiss" onClick={() => dismiss(t.id)}>×</button>
        </div>
      ))}
    </div>
  );
}
