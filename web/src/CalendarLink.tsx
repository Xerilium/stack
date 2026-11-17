/**
 * Settings > Accounts > Other ways to connect: a published calendar link (ICS) and Check connection.
 * The link is a secret: it never stays in the page once saved.
 * @req FR:ux-consolidation/cal.connect @req FR:ux-consolidation/cal.save @req FR:ux-consolidation/cal.check @req FR:connect-accounts/web.manual
 */
import { useState } from 'preact/hooks';
import { checkText, type CalSource } from './calsource';
import { icsOk } from './onboarding';
import { accountBadge } from './settings';
import './settings.css';

export interface CalCtl {
  source: CalSource | null;
  /** The host has the local setup routes (`stack web`), so a link can be saved from here. */
  canConnect: boolean;
  /** Reads `GET /calendar` again. */
  onCheck: () => Promise<CalSource | null>;
  /** Saves the link; resolves to an error message, or null when saved. */
  onConnect: (ics: string) => Promise<string | null>;
}

export function CalendarLink({ cal }: { cal: CalCtl }) {
  const [link, setLink] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState('');
  const check = async () => { const s = await cal.onCheck(); setResult(s ? checkText(s, new Date()) : 'Could not reach Stack'); };
  const save = async () => {
    if (saving) return;
    if (!icsOk(link)) { setError('Paste the https or webcal link of a published calendar.'); return; }
    setError(''); setSaving(true);
    try {
      const err = await cal.onConnect(link.trim());
      if (err) { setError(err); return; }
      setLink(''); // the link is a secret: it does not stay in the page
      await check();
    } finally { setSaving(false); }
  };
  return (
    <div class="cal-link" data-testid="cal-link">
      {cal.source?.via === 'graph' ? (
        // A link is read only when no account has a calendar: saving one now would show nothing. @req FR:connect-accounts/cal.fallback
        <p class="acct-note" data-testid="cal-link-graph">Your connected accounts feed the calendar. A calendar link is used only when no account has a calendar.</p>
      ) : cal.canConnect ? (
        <form class="cal-link-form" noValidate onSubmit={(e) => { e.preventDefault(); void save(); }}>
          <label for="cal-ics">Published calendar link (ICS)</label>
          <div class="cal-link-row">
            <input id="cal-ics" class="fl-input" type="text" inputMode="url" autoComplete="off" spellcheck={false} placeholder="https://…/calendar.ics" value={link} aria-invalid={error ? true : undefined} aria-describedby={error ? 'cal-ics-err' : undefined}
              onInput={(e) => { setLink((e.target as HTMLInputElement).value); setError(''); }} />
            <button type="submit" class="fl-btn" disabled={saving}>{saving ? 'Connecting…' : 'Connect'}</button>
          </div>
          {error && <p class="acct-err" id="cal-ics-err" role="alert">{error}</p>}
        </form>
      ) : <p class="acct-note">Connect a calendar link from Stack on your Mac.</p>}
      <ol class="cal-link-steps">
        <li><strong>Outlook:</strong> Settings › Calendar › Shared calendars › Publish a calendar › copy the ICS link.</li>
        <li><strong>Google:</strong> Settings › your calendar › Secret address in iCal format.</li>
      </ol>
      <div class="cal-link-foot">
        <button type="button" class="fl-btn" onClick={() => void check()}>Check connection</button>
        <span class="cal-link-result" role="status" aria-live="polite">{result}</span>
      </div>
    </div>
  );
}

/** A meeting's account: its first letter in a color fixed per account; the address is its name. @req FR:connect-accounts/web.label */
export function AcctBadge({ account }: { account: string }) {
  const b = accountBadge(account);
  return <span class={`acct-badge ${b.tone}`} role="img" aria-label={account} title={account}>{b.letter}</span>;
}
