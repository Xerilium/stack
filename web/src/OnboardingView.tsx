/**
 * First-run setup: one step per screen, at most 5, resumable. Replaces the app shell until done.
 * @req FR:first-run-onboarding/web.gate @req FR:first-run-onboarding/web.a11y @req FR:first-run-onboarding/web.phone
 * @req FR:first-run-onboarding/step.repo @req FR:first-run-onboarding/step.mode @req FR:first-run-onboarding/step.calendar
 * @req FR:first-run-onboarding/step.email @req FR:first-run-onboarding/step.phone @req FR:first-run-onboarding/state.resume
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { createClient } from './api';
import { ConnectAccounts } from './ConnectAccounts';
import { icsOk, postStep, prevStep, stepLine, TITLES, waitForHost, type Fetch, type SetupStatus } from './onboarding';
import './onboarding.css';

/** The app API for in-app Connect on the email step. */
const connectApi = createClient();

export interface OnboardingProps { initial: SetupStatus; fetch?: Fetch; onDone: (hash: string) => void }

export function Onboarding({ initial, fetch: f = (u, i) => fetch(u, i), onDone }: OnboardingProps) {
  const [s, setS] = useState(initial);
  const [busy, setBusy] = useState<'' | 'saving' | 'restarting'>('');
  const [error, setError] = useState(initial.error ? `Stack could not open this repo: ${initial.error}` : '');
  const [repo, setRepo] = useState(initial.repo ?? '');
  const [mode, setMode] = useState<'demo' | 'live'>(initial.mode);
  const [ack, setAck] = useState(false);
  const [ics, setIcs] = useState('');
  const title = useRef<HTMLHeadingElement>(null);
  // A new step moves focus to its title, so a screen reader reads the new screen.
  useEffect(() => { title.current?.focus(); }, [s.step]);

  const send = async (body: Record<string, unknown>, doneHash = '#/now') => {
    if (busy) return;
    setBusy('saving'); setError('');
    const r = await postStep(f, body);
    if (!r.ok) { setBusy(''); setError(r.error); return; }
    let next = r.status;
    if (r.restart) { setBusy('restarting'); next = await waitForHost(f); }
    setBusy('');
    if (!next) { setError('Stack did not come back. Check the terminal or restart the app.'); return; }
    if (next.error) setError(`Stack could not open this repo: ${next.error}`);
    if (!next.needed) { onDone(doneHash); return; }
    setS(next); setMode(next.mode);
  };
  const back = () => { const p = prevStep(s.step, s.steps); if (p) { setError(''); void send({ go: p }); } };

  const working = busy !== '';
  const label = busy === 'restarting' ? 'Restarting Stack…' : busy === 'saving' ? 'Saving…' : '';
  const errLine = error ? <p class="ob-err" role="alert">{error}</p> : null;
  const backBtn = prevStep(s.step, s.steps) ? <button type="button" class="ob-btn quiet" disabled={working} onClick={back}>Back</button> : <span />;

  let body;
  switch (s.step) {
    case 'repo':
      body = (
        <form class="ob-form" onSubmit={(e) => { e.preventDefault(); void send({ step: 'repo', repo }); }}>
          <p class="ob-lede">Stack keeps tasks as markdown files in a git repo. Point it at yours.</p>
          <label class="ob-label" for="ob-repo">Folder path or git url</label>
          <input id="ob-repo" class="ob-input" type="text" readOnly={!!s.repoLock} autoComplete="off" spellcheck={false} autoCapitalize="off" placeholder="~/tasks or https://github.com/you/tasks.git" value={repo} onInput={(e) => setRepo((e.target as HTMLInputElement).value)} aria-describedby="ob-repo-hint" aria-invalid={!!error} />
          <p class="ob-hint" id="ob-repo-hint">{s.repoLock ? <>Set by <code>{s.repoLock}</code>. Change it there.</> : s.repo ? <>Now set to <code>{s.repo}</code>. Continue to keep it.</> : 'A folder on this computer that is a git repo, or a url to clone.'}</p>
          {errLine}
          <div class="ob-actions">{backBtn}<button type="submit" class="ob-btn primary" disabled={working || !repo.trim()}>Continue</button></div>
        </form>
      );
      break;
    case 'mode':
      if (s.modeLock) {
        body = (
          <form class="ob-form" onSubmit={(e) => { e.preventDefault(); void send({ step: 'mode', mode: 'live' }); }}>
            <div class="ob-note" data-testid="live-warning">
              <p><span aria-hidden="true">⚠︎ </span>Live is on: set by <code>{s.modeLock}</code>. Stack writes task files in <code>tasks/</code>, commits them, and pushes to your remote.</p>
              <p>For a demo copy, start Stack without <code>{s.modeLock}</code>.</p>
            </div>
            {errLine}
            <div class="ob-actions">{backBtn}<button type="submit" class="ob-btn primary" disabled={working}>Continue</button></div>
          </form>
        );
        break;
      }
      body = (
        <form class="ob-form" onSubmit={(e) => { e.preventDefault(); void send({ step: 'mode', mode, ...(mode === 'live' ? { ack } : {}) }); }}>
          <fieldset class="ob-choices">
            <legend class="ob-lede">Start with a demo copy. Switch to live when you trust it.</legend>
            <label class={`ob-choice${mode === 'demo' ? ' on' : ''}`}>
              <input type="radio" name="ob-mode" value="demo" checked={mode === 'demo'} onChange={() => setMode('demo')} />
              <span><b>Demo</b> <span class="ob-tag">Recommended</span><br /><span class="ob-sub">Works on a copy. Your repo is never written.</span></span>
            </label>
            <label class={`ob-choice${mode === 'live' ? ' on' : ''}`}>
              <input type="radio" name="ob-mode" value="live" checked={mode === 'live'} onChange={() => setMode('live')} />
              <span><b>Live</b><br /><span class="ob-sub">Works on your repo. Your edits are real.</span></span>
            </label>
          </fieldset>
          {mode === 'live' && (
            <div class="ob-note" data-testid="live-warning">
              <p><span aria-hidden="true">⚠︎ </span>Live edits your repo. Stack writes task files in <code>tasks/</code>, commits them, and pushes to your remote.</p>
              <label class="ob-check"><input type="checkbox" checked={ack} onChange={(e) => setAck((e.target as HTMLInputElement).checked)} /> I understand</label>
            </div>
          )}
          {errLine}
          <div class="ob-actions">{backBtn}<button type="submit" class="ob-btn primary" disabled={working || (mode === 'live' && !ack)}>Continue</button></div>
        </form>
      );
      break;
    case 'calendar':
      body = (
        <form class="ob-form" onSubmit={(e) => { e.preventDefault(); if (!icsOk(ics)) { setError('Paste the https or webcal link of a published calendar.'); return; } void send({ step: 'calendar', ics: ics.trim() }); }}>
          <p class="ob-lede">Optional. Stack reads busy time so your day plan fits around meetings. It never writes to your calendar.</p>
          <label class="ob-label" for="ob-ics">Published calendar link (ICS)</label>
          <input id="ob-ics" class="ob-input" type="url" inputMode="url" autoComplete="off" spellcheck={false} autoCapitalize="off" placeholder="https://…/calendar.ics" value={ics} onInput={(e) => setIcs((e.target as HTMLInputElement).value)} aria-describedby="ob-ics-hint" aria-invalid={!!error} />
          <p class="ob-hint" id="ob-ics-hint">{s.calendar ? 'A calendar is already set. A new link replaces it. ' : ''}Outlook: Settings, Calendar, Shared calendars, Publish. Google: calendar settings, Secret address in iCal format.</p>
          {errLine}
          <div class="ob-actions">{backBtn}<span class="ob-pair"><button type="button" class="ob-btn quiet" disabled={working} onClick={() => void send({ step: 'calendar', skip: true })}>Skip</button><button type="submit" class="ob-btn primary" disabled={working || !ics.trim()}>Save link</button></span></div>
        </form>
      );
      break;
    case 'email':
      body = (
        <div class="ob-form">
          <p class="ob-lede">Optional. Stack reads mail and writes reply drafts. It never sends mail.</p>
          {/* The sign-in runs in the app; no command. @req FR:connect-accounts/web.where @req FR:connect-accounts/web.nocmd */}
          <ConnectAccounts api={connectApi} />
          {s.email && <p class="ob-ok" role="status"><span aria-hidden="true">✓ </span>Signed in</p>}
          {errLine}
          <div class="ob-actions">{backBtn}<span class="ob-pair"><button type="button" class="ob-btn quiet" disabled={working} onClick={() => void send({ step: 'email', skip: true })}>Skip</button><button type="button" class="ob-btn primary" disabled={working} onClick={() => void send({ step: 'email' })}>Continue</button></span></div>
        </div>
      );
      break;
    case 'phone':
      body = (
        <div class="ob-form">
          <p class="ob-lede">Optional. Stack pings your phone only when an ask is due within 1 hour. Open Stack on your iPhone to set it up.</p>
          {errLine}
          <div class="ob-actions">{backBtn}<span class="ob-pair"><button type="button" class="ob-btn quiet" disabled={working} onClick={() => void send({ step: 'phone' }, '#/install')}>Set up iPhone</button><button type="button" class="ob-btn primary" disabled={working} onClick={() => void send({ step: 'phone' })}>Finish</button></span></div>
        </div>
      );
      break;
  }

  return (
    <main class="ob" aria-labelledby="ob-h" data-testid="onboarding" data-step={s.step}>
      <p class="ob-step"><span class="ob-brand">Stack</span><span aria-hidden="true"> · </span>{stepLine(s.step, s.steps)}</p>
      <h1 id="ob-h" ref={title} tabIndex={-1}>{TITLES[s.step]}</h1>
      {body}
      <p class="ob-status" role="status" aria-live="polite">{label}</p>
    </main>
  );
}
