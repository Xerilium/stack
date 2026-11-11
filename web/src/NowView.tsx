/**
 * Now: the one place. One task, one reason, three actions; then the next meetings and the top messages, one line each.
 * @req FR:now-screen/now.one @req FR:now-screen/now.why @req FR:now-screen/now.actions @req FR:now-screen/now.next @req FR:now-screen/now.empty @req FR:now-screen/now.a11y
 * @req FR:ux-consolidation/one.meetings @req FR:ux-consolidation/one.messages @req FR:ux-consolidation/one.answer @req FR:ux-consolidation/one.focus @req FR:ux-consolidation/one.clamp
 */
import { actionsFor, type AskItem } from './asks';
import type { Brief } from './brief';
import { Md } from './parts';
import { clock, span } from './plan';
import type { NowTask } from './nowscreen';
import './nowscreen.css';

export type NowAct = 'done' | 'defer' | 'delegate';
export type Layer = 'live' | 'weekly' | 'none';
const WAITING = 3;

/** The top 3 of the merged asks: messages first (best score first), then the rest. @req FR:ux-consolidation/one.messages */
export function waitingOf(b: Pick<Brief, 'messages' | 'actions' | 'moreMessages' | 'moreActions'>): { rows: AskItem[]; more: number } {
  const all = [...b.messages, ...b.actions];
  return { rows: all.slice(0, WAITING), more: Math.max(0, all.length - WAITING) + b.moreMessages + b.moreActions };
}

export function NowScreen({ n, b, layer, busy, onAct, onAnswer, onReply, onOpenAsks }: {
  n: NowTask | null; b: Brief; layer: Layer; busy: boolean; onAct: (a: NowAct) => void;
  /** The ask's primary action, answered as Needs you would. */ onAnswer: (a: AskItem) => void;
  /** An ask with no one-tap answer: open it in Needs you with the reply box. */ onReply: (a: AskItem) => void;
  onOpenAsks: () => void;
}) {
  const waiting = waitingOf(b);
  return (
    <section class="now" aria-label="Now" data-testid="now">
      {/* The live region stays mounted, so a swap to the next task is announced. */}
      <div class="now-stage" aria-live="polite">
        {n ? (
          <article class="now-card" key={n.task.ref} data-ref={n.task.ref}>
            <h1 class="now-title" id="now-title" aria-describedby="now-why" title={n.title}><Md text={n.title} /></h1>
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

      <div class="now-side">
        <h2 class="now-h2">Next{layer !== 'none' && <span class="now-layer" data-testid="now-layer"> · {layer === 'live' ? 'Live calendar' : 'Weekly schedule'}</span>}</h2>
        {b.meetings.length === 0 ? <p class="now-none">No meetings left today.</p> : (
          <ul class="now-list" data-testid="now-meetings">
            {b.meetings.map((m) => (
              <li key={m.start + m.title} class="now-row">
                <span class="now-when">{clock(m.start)}</span>
                <span class="now-text"><span class="now-main">{m.title}</span>{(m.owner || m.topic) && <span class="now-sub">{m.owner}{m.owner && m.topic && ' · '}{m.topic}</span>}</span>
                <span class={`now-in${m.now ? ' on' : ''}`}>{m.now ? 'now' : `in ${span(m.in)}`}</span>
                {m.join && <a class="now-join" href={m.join} target="_blank" rel="noopener noreferrer">Join</a>}
              </li>
            ))}
          </ul>
        )}

        <h2 class="now-h2">Waiting on you</h2>
        {waiting.rows.length === 0 ? <p class="now-none">Nothing waiting.</p> : (
          <ul class="now-list" data-testid="now-asks">
            {waiting.rows.map((a) => {
              const primary = actionsFor(a).find((x) => x.send);
              return (
                <li key={a.key} class="now-row">
                  <span class="now-text"><span class="now-main">{a.ask}</span><span class="now-sub">{a.from}{a.overdue && <> · <span class="now-late">overdue</span></>}</span></span>
                  {primary
                    ? <button type="button" class="now-mini" disabled={busy} onClick={() => onAnswer(a)}>{primary.label}</button>
                    : <button type="button" class="now-mini" onClick={() => onReply(a)}>Reply</button>}
                </li>
              );
            })}
          </ul>
        )}
        {waiting.more > 0 && <button type="button" class="now-more" onClick={onOpenAsks}>{waiting.more} more in Needs you</button>}
      </div>
    </section>
  );
}
