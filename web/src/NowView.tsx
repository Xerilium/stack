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
import type { NextAction } from './types';
import { NowChat, type NowChatProps } from './NowChat';
import { NowNext, type CalCtl, type Layer } from './NowNext';
import type { PrioritiesView } from './priorities';
import { PrioritiesTables, type SendToSession } from './PrioritiesTables';
import { TaskContext } from './TaskContext';
import './nowscreen.css';

export type NowAct = 'done' | 'defer';
export type { Layer };
export function NowScreen({ n: task, action = null, done = false, b, layer, busy, onAct, pri, send, cal, now, chat }: {
  n: NowTask | null;
  /** The first priority action of `GET /next`: it shows in place of the task, as `stack next` prints it first. @req FR:now-screen/now.action */ action?: NextAction | null;
  /** Done just ran on this task: the card plays the check, then the next task replaces it. @req FR:product-reset/ui.done */ done?: boolean; b: Brief; layer: Layer; busy: boolean; onAct: (a: NowAct) => void;
  /** The message composer under the task. */ chat?: Omit<NowChatProps, 'taskRef' | 'busy'>;
  /** The priorities tables; null hides them (loading, or no store on this host). */ pri: PrioritiesView | null;
  /** Sends a message to an agent session from the priorities report. @req FR:priorities-tables/web.message */ send: SendToSession;
  /** The calendar source; fixes live in Settings. */ cal: Pick<CalCtl, 'source'>;
  now: Date;
}) {
  // With a priority action the task waits: no Done, no Defer, no composer for it. @req FR:now-screen/now.action.none @req FR:now-screen/now.action.then
  const n = action ? null : task;
  return (
    <section class="now" aria-label="Now" data-testid="now">
      <div class="now-focus" data-testid="now-focus">
        {/* The live region stays mounted, so a swap to the next task is announced. */}
        <div class="now-stage" aria-live="polite">
          {action ? (
            <article class="now-card" key={`pri:${action.pri.id}`} data-pri={action.pri.id}>
              <h1 class="now-title" id="now-title" aria-describedby="now-why" title={action.text}><Md text={action.text} /></h1>
              <p class="now-why" id="now-why" data-testid="now-why">priority {action.pri.rank}: {action.pri.title}</p>
              {task && <p class="now-why now-then" data-testid="now-then">Then: <Md text={task.title} links={false} /></p>}
            </article>
          ) : n ? (
            <article class={`now-card${done ? ' done-anim' : ''}`} key={n.task.ref} data-ref={n.task.ref}>
              {done && <span class="now-done-check" aria-hidden="true">✓</span>}
              {n.context && <TaskContext title={n.context} project={n.task.project} id="now-context" />}
              <h1 class="now-title" id="now-title" aria-describedby={n.context ? 'now-context now-why' : 'now-why'} title={n.title}><Md text={n.title} project={n.task.project} /></h1>
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
      {pri && <PrioritiesTables v={pri} send={send} />}
    </section>
  );
}
