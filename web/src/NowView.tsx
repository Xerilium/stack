/**
 * Now: the one place. One task, one reason, two actions, a message to its agent; beside it on wide screens (under it on
 * phones) the next meetings; under both, the priorities tables.
 * @req FR:now-screen/now.one @req FR:now-screen/now.why @req FR:now-screen/now.actions @req FR:now-screen/now.compose @req FR:now-screen/now.next @req FR:now-screen/now.empty @req FR:now-screen/now.a11y @req FR:now-screen/now.layout
 * @req FR:ux-consolidation/one.meetings @req FR:ux-consolidation/one.messages @req FR:ux-consolidation/one.focus @req FR:ux-consolidation/one.clamp @req FR:ux-consolidation/one.layout
 * @req FR:product-reset/ui.done @req FR:product-reset/ia.now @req FR:priorities-tables/web.place
 */
import type { Brief } from './brief';
import { Md } from './parts';
import type { NowTask } from './nowscreen';
import { NowChat, type NowChatProps } from './NowChat';
import { NowNext, type CalCtl, type Layer } from './NowNext';
import type { PrioritiesView } from './priorities';
import { PrioritiesTables } from './PrioritiesTables';
import './nowscreen.css';

export type NowAct = 'done' | 'defer';
export type { Layer };
export function NowScreen({ n, done = false, b, layer, busy, onAct, pri, cal, now, chat }: {
  n: NowTask | null; /** Done just ran on this task: the card plays the check, then the next task replaces it. @req FR:product-reset/ui.done */ done?: boolean; b: Brief; layer: Layer; busy: boolean; onAct: (a: NowAct) => void;
  /** The message composer under the task. */ chat?: Omit<NowChatProps, 'taskRef' | 'busy'>;
  /** The priorities tables; null hides them (loading, or no store on this host). */ pri: PrioritiesView | null;
  /** The calendar source; fixes live in Settings. */ cal: Pick<CalCtl, 'source'>;
  now: Date;
}) {
  return (
    <section class="now" aria-label="Now" data-testid="now">
      <div class="now-focus" data-testid="now-focus">
        {/* The live region stays mounted, so a swap to the next task is announced. */}
        <div class="now-stage" aria-live="polite">
          {n ? (
            <article class={`now-card${done ? ' done-anim' : ''}`} key={n.task.ref} data-ref={n.task.ref}>
              {done && <span class="now-done-check" aria-hidden="true">✓</span>}
              <h1 class="now-title" id="now-title" aria-describedby="now-why" title={n.title}><Md text={n.title} project={n.task.project} /></h1>
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
            <button type="button" class="now-btn primary" title="Done (D)" disabled={busy} onClick={() => onAct('done')}>Done</button>
            <button type="button" class="now-btn" title="Defer (N)" disabled={busy} onClick={() => onAct('defer')}>Defer</button>
          </div>
        )}
        {n && chat && <NowChat key={n.task.ref} taskRef={n.task.ref} busy={busy} {...chat} />}
      </div>

      <div class="now-side" data-testid="now-side">
        <NowNext meetings={b.meetings} layer={layer} cal={cal} now={now} />
      </div>
      {pri && <PrioritiesTables v={pri} />}
    </section>
  );
}
