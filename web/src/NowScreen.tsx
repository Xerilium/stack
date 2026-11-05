/**
 * Now: one task, one reason, three actions. Nothing else on the screen.
 * @req FR:now-screen/now.one @req FR:now-screen/now.why @req FR:now-screen/now.actions @req FR:now-screen/now.next @req FR:now-screen/now.empty @req FR:now-screen/now.a11y
 */
import { Md } from './parts';
import type { NowTask } from './nowscreen';
import './nowscreen.css';

export type NowAct = 'done' | 'defer' | 'delegate';

export function NowScreen({ n, busy, onAct }: { n: NowTask | null; busy: boolean; onAct: (a: NowAct) => void }) {
  return (
    <section class="now" aria-label="Now" data-testid="now">
      {/* The live region stays mounted, so a swap to the next task is announced. */}
      <div class="now-stage" aria-live="polite">
        {n ? (
          <article class="now-card" key={n.task.ref} data-ref={n.task.ref}>
            <h1 class="now-title" id="now-title" aria-describedby="now-why"><Md text={n.title} /></h1>
            <p class="now-why" id="now-why" data-testid="now-why">{n.why}</p>
          </article>
        ) : (
          <div class="now-card now-empty" key="empty" data-testid="now-empty">
            <span class="now-check" aria-hidden="true">✓</span>
            <h1 class="now-title">Nothing now</h1>
            <p class="now-why">You are clear.</p>
          </div>
        )}
      </div>
      {n && (
        <div class="now-actions" role="group" aria-label="Actions">
          <button type="button" class="now-btn primary" disabled={busy} onClick={() => onAct('done')}>Done <kbd>d</kbd></button>
          <button type="button" class="now-btn" disabled={busy} onClick={() => onAct('defer')}>Defer <kbd>n</kbd></button>
          <button type="button" class="now-btn" disabled={busy} onClick={() => onAct('delegate')}>Delegate <kbd>⇧A</kbd></button>
        </div>
      )}
    </section>
  );
}
