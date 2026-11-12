/**
 * Now's `Next`: the next 2 meetings, and an honest line when the calendar is not connected, failing, or out of date.
 * Connect pastes a published ICS link (local host) or names the other ways in.
 * @req FR:ux-consolidation/one.meetings @req FR:ux-consolidation/cal.ui @req FR:ux-consolidation/cal.connect @req FR:ux-consolidation/cal.check
 */
import { useState } from 'preact/hooks';
import type { BriefMeeting } from './brief';
import { calLine, checkText, GRAPH_CMD, isFresh, type CalSource } from './calsource';
import { icsOk } from './onboarding';
import { clock, span } from './plan';

export type Layer = 'live' | 'weekly' | 'none';
export interface CalCtl {
  source: CalSource | null;
  /** The host has the local setup routes (`stack web`), so a link can be saved from here. */
  canConnect: boolean;
  /** Reads `GET /calendar` again. */
  onCheck: () => Promise<CalSource | null>;
  /** Saves the link; resolves to an error message, or null when saved. */
  onConnect: (ics: string) => Promise<string | null>;
}

function Meetings({ list }: { list: BriefMeeting[] }) {
  return (
    <ul class="now-list" data-testid="now-meetings">
      {list.map((m) => (
        <li key={m.start + m.title} class="now-row">
          <span class="now-when">{clock(m.start)}</span>
          <span class="now-text"><span class="now-main">{m.title}</span>{(m.owner || m.topic) && <span class="now-sub">{m.owner}{m.owner && m.topic && ' · '}{m.topic}</span>}</span>
          <span class={`now-in${m.now ? ' on' : ''}`}>{m.now ? 'now' : `in ${span(m.in)}`}</span>
          {m.join && <a class="now-join" href={m.join} target="_blank" rel="noopener noreferrer">Join</a>}
        </li>
      ))}
    </ul>
  );
}

function Connect({ cal, onChecked, result }: { cal: CalCtl; onChecked: (s: CalSource | null) => void; result: string }) {
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const save = async () => {
    if (saving) return;
    if (!icsOk(link)) { setError('Paste the https or webcal link of a published calendar.'); return; }
    setError(''); setSaving(true);
    try {
      const err = await cal.onConnect(link.trim());
      if (err) { setError(err); return; }
      setLink(''); // the link is a secret: it does not stay in the page
      onChecked(await cal.onCheck());
    } finally { setSaving(false); }
  };
  const copy = async () => { try { await navigator.clipboard.writeText(GRAPH_CMD); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* the command stays selectable */ } };
  return (
    <div class="now-connect" id="now-connect" data-testid="now-connect">
      {cal.source?.via === 'graph' ? <p class="now-connect-note">Your calendar comes from a Microsoft Graph sign-in, which wins over a link. Sign in again:</p> : cal.canConnect ? (
        <form class="now-connect-form" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <label for="now-ics">Published calendar link (ICS)</label>
          <div class="now-connect-row">
            <input id="now-ics" type="text" inputMode="url" autoComplete="off" spellcheck={false} placeholder="https://…/calendar.ics" value={link} aria-invalid={error ? true : undefined} aria-describedby={error ? 'now-ics-err' : undefined}
              onInput={(e) => { setLink((e.target as HTMLInputElement).value); setError(''); }} />
            <button type="submit" class="now-mini primary" disabled={saving}>{saving ? 'Connecting…' : 'Connect'}</button>
          </div>
          {error && <p class="now-cal-err" id="now-ics-err" role="alert">{error}</p>}
        </form>
      ) : <p class="now-connect-note">Connect from <code>stack web</code> on your computer, or set <code>STACK_CALENDAR_ICS</code> on this host.</p>}
      {cal.source?.via !== 'graph' && <ol class="now-steps">
        <li><strong>Outlook:</strong> Settings › Calendar › Shared calendars › Publish a calendar › copy the ICS link.</li>
        <li><strong>Google:</strong> Settings › your calendar › Secret address in iCal format.</li>
      </ol>}
      {cal.source?.via !== 'graph' && <p class="now-connect-note">Or sign in with Microsoft Graph in a terminal:</p>}
      <div class="now-cmd"><code>{GRAPH_CMD}</code><button type="button" class="now-mini" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy'}</button></div>
      <div class="now-connect-foot">
        <button type="button" class="now-mini" onClick={async () => onChecked(await cal.onCheck())}>Check connection</button>
        <span class="now-cal-result" aria-live="polite">{result}</span>
      </div>
    </div>
  );
}

export function NowNext({ meetings, layer, cal, now }: { meetings: BriefMeeting[]; layer: Layer; cal: CalCtl; now: Date }) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState('');
  const fresh = isFresh(cal.source, now);
  const line = calLine(cal.source, now);
  const checked = (s: CalSource | null) => { setResult(s ? checkText(s, new Date()) : 'Could not reach Stack'); if (s && isFresh(s, new Date())) setOpen(false); };
  return (
    <>
      <h2 class="now-h2">Next{layer !== 'none' && (meetings.length > 0 || fresh) && <span class="now-layer" data-testid="now-layer"> · {layer === 'live' ? 'Live calendar' : 'Weekly schedule'}</span>}</h2>
      {line && (
        <div class="now-cal" data-testid="now-cal">
          <p class="now-cal-line"><span class={`now-cal-dot ${cal.source?.state ?? 'checking'}`} aria-hidden="true" />{line.text}</p>
          {line.act && (
            <div class="now-cal-acts">
              {line.act !== 'check' && <button type="button" class="now-mini primary" aria-expanded={open} aria-controls="now-connect" onClick={() => setOpen(!open)}>{open ? 'Close' : line.act === 'connect' ? 'Connect' : 'Fix'}</button>}
              {line.act !== 'connect' && <button type="button" class="now-mini" onClick={async () => checked(await cal.onCheck())}>Check connection</button>}
            </div>
          )}
          {!open && result && <p class="now-cal-result">{result}</p>}
          {/* Mounted before the result arrives, so screen readers announce it. */}
          <span class="sr-only" aria-live="polite">{open ? '' : result}</span>
        </div>
      )}
      {line && open && <Connect cal={cal} onChecked={checked} result={result} />}
      {meetings.length > 0 ? <Meetings list={meetings} /> : fresh && <p class="now-none">No meetings left today.</p>}
    </>
  );
}
