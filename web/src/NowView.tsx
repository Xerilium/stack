/**
 * Now: the one place. One task, one reason, two actions, a message to its agent; beside it on wide screens (under it on
 * phones) the next meetings and the top asks.
 * @req FR:now-screen/now.one @req FR:now-screen/now.why @req FR:now-screen/now.actions @req FR:now-screen/now.compose @req FR:now-screen/now.next @req FR:now-screen/now.empty @req FR:now-screen/now.a11y @req FR:now-screen/now.layout
 * @req FR:ux-consolidation/one.meetings @req FR:ux-consolidation/one.messages @req FR:ux-consolidation/one.answer @req FR:ux-consolidation/one.focus @req FR:ux-consolidation/one.clamp @req FR:ux-consolidation/one.layout
 * @req FR:product-reset/ui.done @req FR:product-reset/ia.now
 */
import type { AskItem } from './asks';
import type { Brief } from './brief';
import { Md } from './parts';
import type { NowTask } from './nowscreen';
import { NowAsks, type AskCtl } from './NowAsks';
import { NowChat, type NowChatProps } from './NowChat';
import { NowNext, type CalCtl, type Layer } from './NowNext';
import './nowscreen.css';

export type NowAct = 'done' | 'defer';
export type { Layer };
const WAITING = 3;

/** The top 3 of the merged asks: messages first (best score first), then the rest. @req FR:ux-consolidation/one.messages */
export function waitingOf(b: Pick<Brief, 'messages' | 'actions' | 'moreMessages' | 'moreActions'>): { rows: AskItem[]; more: number } {
  const all = [...b.messages, ...b.actions];
  return { rows: all.slice(0, WAITING), more: Math.max(0, all.length - WAITING) + b.moreMessages + b.moreActions };
}

export function NowScreen({ n, done = false, b, layer, busy, onAct, asks, cal, now, onOpenAsks, chat }: {
  n: NowTask | null; /** Done just ran on this task: the card plays the check, then the next task replaces it. @req FR:product-reset/ui.done */ done?: boolean; b: Brief; layer: Layer; busy: boolean; onAct: (a: NowAct) => void;
  /** The message composer under the task. */ chat?: Omit<NowChatProps, 'taskRef' | 'busy'>;
  /** Answers on the ask cards, as Needs you answers them. */ asks: Omit<AskCtl, 'busy' | 'now'>;
  /** The calendar source; fixes live in Settings. */ cal: Pick<CalCtl, 'source'>;
  now: Date;
  onOpenAsks: () => void;
}) {
  const waiting = waitingOf(b);
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
        <NowAsks rows={waiting.rows} more={waiting.more} ctl={{ ...asks, busy, now }} onOpenAsks={onOpenAsks} />
      </div>
    </section>
  );
}
