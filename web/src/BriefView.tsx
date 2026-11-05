/**
 * Brief (Experimental): the Chief of Staff view. Meetings, messages, actions, one task, next 90 minutes.
 * @req FR:cos-view/brief.nav @req FR:cos-view/brief.meetings @req FR:cos-view/brief.messages @req FR:cos-view/brief.actions @req FR:cos-view/brief.one @req FR:cos-view/brief.ninety @req FR:cos-view/brief.empty
 */
import { actionsFor, type AskItem } from './asks';
import type { Brief } from './brief';
import type { Window } from './home';
import { clock, span } from './plan';
import { parseRow } from './row';
import { Md } from './parts';

type Act = 'start' | 'done' | 'delegate';

function Card({ a, onAnswer }: { a: AskItem; onAnswer: (a: AskItem) => void }) {
  const primary = actionsFor(a).find((x) => x.send);
  return (
    <li class="brief-card" data-testid="brief-card">
      <p class="brief-ask">{a.ask}</p>
      {a.why && <p class="brief-why">{a.why}</p>}
      {a.recommend && <p class="brief-rec"><span>Draft</span> {a.recommend}</p>}
      <p class="brief-meta">{a.from}{a.overdue && <> · <span class="late">overdue</span></>}</p>
      {primary && <button type="button" class="btn primary" onClick={() => onAnswer(a)}>{primary.label}</button>}
    </li>
  );
}

export function BriefView({ b, win, busy, onAnswer, onOpenAsks, onAct }: { b: Brief; win: Window; busy: boolean; onAnswer: (a: AskItem) => void; onOpenAsks: () => void; onAct: (a: Act, ref?: string) => void }) {
  const one = b.one, title = one ? parseRow(one.task.text).title || one.task.text : '';
  const more = (n: number) => n > 0 && <button type="button" class="link-btn" onClick={onOpenAsks}>{n} more in Needs you</button>;
  return (
    <section class="brief" aria-label="Brief">
      <p class="brief-tag"><span class="exp">Experimental</span> Chief of Staff · {win.inside ? win.inside.label : `${span(win.minutes)} until ${win.until?.label ?? 'end of day'}`}</p>

      <h2 class="h2">Next meetings</h2>
      {b.meetings.length === 0 ? <p class="brief-empty">No meetings left today.</p> : (
        <ul class="brief-list" data-testid="brief-meetings">
          {b.meetings.map((m) => (
            <li key={m.start + m.title} class="brief-meeting">
              <span class="brief-when">{clock(m.start)}</span><span class="brief-title">{m.title}</span>
              <span class={`brief-in${m.now ? ' on' : ''}`}>{m.now ? 'now' : `in ${span(m.in)}`}</span>
              {m.join && <a class="btn primary" href={m.join} target="_blank" rel="noopener noreferrer">Join</a>}
            </li>
          ))}
        </ul>
      )}

      <h2 class="h2">Reply to</h2>
      {b.messages.length === 0 ? <p class="brief-empty">No messages waiting.</p> : <ul class="brief-list" data-testid="brief-messages">{b.messages.map((a) => <Card key={a.key} a={a} onAnswer={onAnswer} />)}</ul>}
      {more(b.moreMessages)}

      <h2 class="h2">Do next</h2>
      {b.actions.length === 0 ? <p class="brief-empty">Nothing needs you.</p> : <ul class="brief-list" data-testid="brief-actions">{b.actions.map((a) => <Card key={a.key} a={a} onAnswer={onAnswer} />)}</ul>}
      {more(b.moreActions)}

      <h2 class="h2">One task</h2>
      {!one ? <p class="brief-empty">Nothing active.</p> : (
        <div class="focus-block brief-one" data-testid="brief-one">
          <h1><Md text={title} /></h1>
          <p class="context">{one.task.project} · {span(one.minutes)}{one.assumed ? ' (assumed)' : ''}</p>
          <div class="actions">
            <button type="button" class="btn primary" disabled={busy} onClick={() => onAct('start', one.task.ref)}>Start</button>
            <button type="button" class="btn" disabled={busy} onClick={() => onAct('done', one.task.ref)}>Done</button>
            <button type="button" class="btn quiet" disabled={busy} onClick={() => onAct('delegate', one.task.ref)}>Delegate</button>
          </div>
        </div>
      )}

      <h2 class="h2">Next 90 minutes</h2>
      {b.ninety.length === 0 ? <p class="brief-empty">No open time.</p> : (
        <ol class="brief-strip" data-testid="brief-ninety">
          {b.ninety.map((s, i) => (
            <li key={s.start} class={`brief-slot ${s.kind}`}>
              <span class="brief-when">{clock(s.start)}{i === 0 ? ' now' : ''}</span>
              <span class="brief-title">{s.kind === 'meeting' ? s.title : s.task && one ? `Suggest: ${parseRow(one.task.text).title || one.task.text}` : 'Free'}</span>
              <span class="brief-in">{span(s.end - s.start)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
