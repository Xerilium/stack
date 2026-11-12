/**
 * The sources panel inside Inbox: every source with its state and last sync, the exact step to connect it, and Check connection.
 * The server writes each step; the page only shows it. No token ever reaches the page.
 * @req FR:inbox-page/web.sources @req FR:inbox-page/web.check @req FR:inbox-page/web.phone
 */
import { useEffect, useState } from 'preact/hooks';
import { lastSync, MODE_TEXT, panelOpen, progressLine, SOURCE, STATE_TEXT, stepLabel, type SourceRow, type SourcesSummary } from './inbox';
import { CopyCommand } from './parts';
import { ConnectAccounts } from './ConnectAccounts';
import type { ConnectApi } from './connect';
import './onboarding.css';

const key = (s: SourceRow) => `${s.kind}:${s.account}`;
const name = (s: SourceRow) => `${SOURCE[s.kind]}${s.account ? ` ${s.account}` : ''}`;

function Source({ s, open, toggle, api, onConnected }: { s: SourceRow; open: boolean; toggle: () => void; api?: ConnectApi; onConnected?: () => void }) {
  const id = `src-${key(s).replace(/[^a-z0-9]/gi, '-')}`;
  // A healthy mail account keeps a way in to the accounts panel: add another, drafts, disconnect. @req FR:connect-accounts/web.where
  const manage = !!api && s.kind === 'email' && s.state === 'ok' && !s.planned;
  return (
    <li class={`src-row ${s.state}${s.planned ? ' planned' : ''}`} data-kind={s.kind} data-state={s.state} data-account={s.account}>
      <div class="src-top">
        <span class="in-src">{SOURCE[s.kind]}</span>
        <span class="src-acct">{s.account || (s.kind === 'email' ? 'No account yet' : '')}</span>
        <span class={`src-state ${s.state}`}>{s.planned ? (s.state === 'connecting' ? 'Signed in' : s.kind === 'github' ? 'Not signed in' : 'Not available yet') : STATE_TEXT[s.state]}</span>
      </div>
      {!s.planned && <p class="src-meta">{lastSync(s.lastSyncAt)}{s.mode ? ` · ${MODE_TEXT[s.mode]}` : ''}</p>}
      {s.error && <p class="src-err">{s.error}</p>}
      {s.state !== 'ok' && s.needs && (
        <button type="button" class="btn src-go" aria-expanded={open} aria-controls={id} aria-label={`${stepLabel(s)}: ${name(s)}`} onClick={toggle}>{stepLabel(s)}</button>
      )}
      {manage && <button type="button" class="btn src-go" aria-expanded={open} aria-controls={id} aria-label={`Manage accounts: ${name(s)}`} onClick={toggle}>Manage accounts</button>}
      {open && manage && api && <div class="src-step" id={id}><ConnectAccounts api={api} {...(onConnected ? { onChange: onConnected } : {})} /></div>}
      {open && s.needs && (
        <div class="src-step" id={id}>
          <p>{s.needs}</p>
          {/* Email sign-in runs in the app: no command. @req FR:connect-accounts/web.where */}
          {s.connect && api ? <ConnectAccounts api={api} {...(onConnected ? { onChange: onConnected } : {})} /> : s.command && <CopyCommand cmd={s.command} label={`Copy command for ${name(s)}`} />}
          {s.doc && <p class="src-doc"><a href={s.doc} target="_blank" rel="noopener noreferrer">How to connect {SOURCE[s.kind]}</a></p>}
        </div>
      )}
    </li>
  );
}

export function InboxSources({ sources, summary, checking, onCheck, api }: { sources: SourceRow[]; summary: SourcesSummary; checking: boolean; onCheck: () => void; api?: ConnectApi }) {
  const [open, setOpen] = useState(panelOpen(summary));
  const [shown, setShown] = useState<string | null>(null);
  // A check that finds a new problem opens the panel again.
  useEffect(() => { if (panelOpen(summary)) setOpen(true); }, [summary]);
  const counted = sources.filter((s) => !s.planned);
  const planned = sources.filter((s) => s.planned);
  const row = (s: SourceRow) => <Source key={key(s)} s={s} open={shown === key(s)} toggle={() => setShown(shown === key(s) ? null : key(s))} {...(api ? { api } : {})} onConnected={onCheck} />;
  return (
    <section class="src-panel" aria-labelledby="src-h" data-testid="inbox-sources">
      <div class="src-head">
        <h2 class="src-title" id="src-h">Inbox sources</h2>
        <p class="src-progress" role="status" aria-live="polite" data-testid="src-progress">{progressLine(summary)}</p>
        <button type="button" class="btn src-toggle" aria-expanded={open} aria-controls="src-body" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Manage'}</button>
      </div>
      {open && (
        <div id="src-body">
          <p class="src-note">Stack reads your inboxes and can write reply drafts. Stack never sends.</p>
          <ul class="src-list">{counted.map(row)}</ul>
          {planned.length > 0 && (
            <>
              <h3 class="src-sub">Coming later</h3>
              <ul class="src-list">{planned.map(row)}</ul>
            </>
          )}
          <div class="src-actions">
            <button type="button" class="btn primary" disabled={checking} onClick={onCheck}>{checking ? 'Checking…' : 'Check connection'}</button>
          </div>
        </div>
      )}
    </section>
  );
}
