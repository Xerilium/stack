/**
 * Now's `Next`: the next 2 meetings, and at most one quiet line when the calendar is not connected, failing, or out of date.
 * The line links to Settings > Accounts; Now never manages accounts.
 * @req FR:connect-accounts/web.now @req FR:connect-accounts/web.where @req FR:connect-accounts/web.label @req FR:ux-consolidation/one.meetings @req FR:ux-consolidation/cal.ui
 */
import type { BriefMeeting } from './brief';
import { AcctBadge, type CalCtl } from './CalendarLink';
import { calLine, isFresh } from './calsource';
import { clock, span } from './plan';

export type { CalCtl } from './CalendarLink';
export type Layer = 'live' | 'weekly' | 'none';

function Meetings({ list }: { list: BriefMeeting[] }) {
  return (
    <ul class="now-list" data-testid="now-meetings">
      {list.map((m) => (
        <li key={m.start + m.title} class="now-row">
          <span class="now-when">{clock(m.start)}</span>
          <span class="now-text"><span class="now-main">{m.account && <AcctBadge account={m.account} />}{m.title}</span>{(m.owner || m.topic) && <span class="now-sub">{m.owner}{m.owner && m.topic && ' · '}{m.topic}</span>}</span>
          <span class={`now-in${m.now ? ' on' : ''}`}>{m.now ? 'now' : `in ${span(m.in)}`}</span>
          {m.join && <a class="now-join" href={m.join} target="_blank" rel="noopener noreferrer">Join</a>}
        </li>
      ))}
    </ul>
  );
}

export function NowNext({ meetings, layer, cal, now }: { meetings: BriefMeeting[]; layer: Layer; cal: Pick<CalCtl, 'source'>; now: Date }) {
  const fresh = isFresh(cal.source, now);
  const line = calLine(cal.source, now);
  return (
    <>
      <h2 class="now-h2">Next{layer !== 'none' && (meetings.length > 0 || fresh) && <span class="now-layer" data-testid="now-layer"> · {layer === 'live' ? 'Live calendar' : 'Weekly schedule'}</span>}</h2>
      {line && (
        <p class="now-cal" data-testid="now-cal">
          <a class="now-cal-link" href="#/settings/accounts"><span class={`now-cal-dot ${cal.source?.state ?? 'checking'}`} aria-hidden="true" />{line.text}<span class="now-cal-go" aria-hidden="true">›</span><span class="sr-only">: open Settings, Accounts</span></a>
        </p>
      )}
      {meetings.length > 0 ? <Meetings list={meetings} /> : fresh && <p class="now-none">No meetings left today.</p>}
    </>
  );
}
