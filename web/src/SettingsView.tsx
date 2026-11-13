/**
 * Settings: the one place for things the owner sets once. Accounts first, then Agents delivery, then Updates.
 * Fluent 2 (`.fl`); one line of summary per section; no empty sections.
 * @req FR:settings/view.route @req FR:settings/view.sections @req FR:settings/view.fit
 * @req FR:settings/agents.state @req FR:settings/agents.off @req FR:settings/updates.modes @req FR:settings/updates.builds @req FR:settings/updates.none
 * @req FR:connect-accounts/web.where @req FR:connect-accounts/web.learn
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import { CalendarLink, type CalCtl } from './CalendarLink';
import { ConnectAccounts } from './ConnectAccounts';
import { LEARN_TEXT, READ_TEXT, type ConnectApi } from './connect';
import { agentsLines, settingsSection, type DeliverySummary } from './settings';
import { MODE_WORDS, UPDATE_MODES, type BuildStamp, type UpdateMode, type VersionState } from './update';
import './settings.css';

export interface SettingsUpdates { state: VersionState | null; setMode: (m: UpdateMode) => Promise<void>; restart: () => Promise<void>; restarting: boolean }
export interface SettingsApi extends ConnectApi {
  deliverySummary: () => Promise<DeliverySummary>;
  deliveryLogin: () => Promise<{ started: boolean; step?: string }>;
}

/** `Learn more`: what Stack reads and what drafts do, in a popover. Escape closes it. @req FR:connect-accounts/web.learn */
function LearnMore() {
  const [open, setOpen] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  return (
    <span class="fl-pop-wrap" onKeyDown={(e) => { if (open && e.key === 'Escape') { e.stopPropagation(); setOpen(false); btn.current?.focus(); } }}>
      <button ref={btn} type="button" class="set-link" aria-expanded={open} aria-controls="set-learn" onClick={() => setOpen(!open)}>Learn more</button>
      {open && (
        <div id="set-learn" class="fl-popover set-learn" role="note">
          {LEARN_TEXT.map((t) => <p key={t}>{t}</p>)}
          <button type="button" class="fl-btn" onClick={() => { setOpen(false); btn.current?.focus(); }}>Close</button>
        </div>
      )}
    </span>
  );
}

function Agents({ api }: { api: SettingsApi }) {
  const [s, setS] = useState<DeliverySummary | null | 'none'>(null);
  const [note, setNote] = useState('');
  useEffect(() => { api.deliverySummary().then(setS, () => setS('none')); }, []);
  if (s === null) return <p class="set-note" role="status">Loading…</p>;
  if (s === 'none') return <p class="set-note">Agents answer from Stack on your Mac.</p>;
  const l = agentsLines(s);
  const signIn = async () => {
    setNote('');
    try { const r = await api.deliveryLogin(); setNote(r.started ? 'Finish signing in in your browser.' : 'Could not start the sign-in. Try again.'); } catch { setNote('Could not start the sign-in. Try again.'); }
  };
  return (
    <>
      <dl class="set-facts" data-testid="settings-agents">
        <div><dt>Delivery</dt><dd>{l.delivery}</dd></div>
        <div><dt>Claude sign-in</dt><dd>{l.login}</dd></div>
      </dl>
      {l.note && <p class="set-note">{l.note}</p>}
      {l.signIn && <button type="button" class="fl-btn" onClick={() => void signIn()}>Sign in to Claude</button>}
      <p class="set-note" role="status" aria-live="polite">{note}</p>
    </>
  );
}

const build = (s: BuildStamp | null) => (s ? `${s.sha}${s.dirty ? '+dirty' : ''} · ${new Date(s.builtAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}` : 'none');

function Updates({ u }: { u: SettingsUpdates }) {
  const [saved, setSaved] = useState('');
  if (!u.state) return <p class="set-note">Updates come with the desktop app.</p>;
  const st = u.state;
  const [want, setWant] = useState<UpdateMode | null>(null);
  // `Saved` only once the host reports the new mode; a failed save shows as a toast.
  useEffect(() => { if (want && st.mode === want) { setSaved('Saved'); setWant(null); } }, [want, st.mode]);
  const pick = async (m: UpdateMode) => { setSaved(''); setWant(m); await u.setMode(m); };
  return (
    <>
      <fieldset class="set-modes" data-testid="settings-updates">
        <legend>Install updates</legend>
        {UPDATE_MODES.map((m) => (
          <label key={m}>
            <input type="radio" name="set-update-mode" value={m} checked={st.mode === m} onChange={() => void pick(m)} />
            {MODE_WORDS[m](st.idleMinutes)}
          </label>
        ))}
      </fieldset>
      <p class="fl-saved" role="status" aria-live="polite">{saved}</p>
      <dl class="set-facts">
        <div><dt>Running</dt><dd>{build(st.running)}</dd></div>
        <div><dt>Ready</dt><dd>{st.ready ? `Update ready · ${build(st.available)}` : 'Up to date'}</dd></div>
      </dl>
      {st.ready && st.canRestart && <button type="button" class="fl-btn primary" disabled={u.restarting} onClick={() => void u.restart()}>{u.restarting ? 'Restarting…' : 'Restart now'}</button>}
    </>
  );
}

export function SettingsView({ api, cal, updates, onAccounts, now }: { api: SettingsApi; cal: CalCtl; updates: SettingsUpdates; onAccounts?: () => void; now: Date }) {
  // `#/settings/<section>` scrolls to it once. @req FR:settings/view.route
  useEffect(() => {
    const s = settingsSection(location.hash);
    if (s) document.getElementById(`settings-${s}`)?.scrollIntoView?.({ block: 'start' });
  }, []);
  return (
    <div class="settings fl" data-testid="settings">
      <h1 class="set-title">Settings</h1>
      <section id="settings-accounts" class="set-sec" aria-labelledby="set-h-accounts">
        <h2 id="set-h-accounts">Accounts</h2>
        <p class="set-sum">{READ_TEXT} <LearnMore /></p>
        <ConnectAccounts api={api} now={now} {...(onAccounts ? { onChange: onAccounts } : {})} other={<CalendarLink cal={cal} />} />
      </section>
      <section id="settings-agents" class="set-sec" aria-labelledby="set-h-agents">
        <h2 id="set-h-agents">Agents</h2>
        <p class="set-sum">Agents answer your messages in task threads.</p>
        <Agents api={api} />
      </section>
      <section id="settings-updates" class="set-sec" aria-labelledby="set-h-updates">
        <h2 id="set-h-updates">Updates</h2>
        <p class="set-sum">When Stack installs a new build.</p>
        <Updates u={updates} />
      </section>
    </div>
  );
}
