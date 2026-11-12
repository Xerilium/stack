/**
 * Connect accounts: one click signs in a Microsoft account in the browser; Stack runs every step. No command to copy.
 * Lists each account with what Stack reads, a drafts switch, and its state. Shown in Inbox and in Now.
 * @req FR:connect-accounts/web.panel @req FR:connect-accounts/web.setup @req FR:connect-accounts/web.signin @req FR:connect-accounts/web.where @req FR:connect-accounts/web.nocmd
 */
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  DRAFTS_TEXT, needsSignIn, READ_TEXT, readsText, sessionText, SETUP_RESULT, SETUP_TEXT, STATE_TEXT, typeText, waitFor,
  type AccountRow, type ConnectApi, type ConnectInfo, type ConnectSession, type SetupState,
} from './connect';
import './onboarding.css';

function Session({ s, onCode }: { s: ConnectSession; onCode: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(s.userCode ?? ''); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* the code stays selectable */ } };
  return (
    <div class="cx-session" data-testid="connect-session" data-state={s.state}>
      <p role="status" aria-live="polite">{sessionText(s)}</p>
      {s.state === 'waiting' && s.method === 'browser' && s.url && (
        <p class="cx-links"><a href={s.url} target="_blank" rel="noopener noreferrer">Open the sign-in page</a> · <button type="button" class="cx-link" onClick={onCode}>Use a code instead</button></p>
      )}
      {s.state === 'waiting' && s.method === 'device' && (
        <div class="cx-code">
          <code data-testid="connect-code">{s.userCode}</code>
          <button type="button" class="btn" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy code'}</button>
          {s.verificationUri && <a href={s.verificationUri} target="_blank" rel="noopener noreferrer">Open {s.verificationUri.replace(/^https:\/\/(www\.)?/, '')}</a>}
        </div>
      )}
    </div>
  );
}

function Account({ a, busy, onSignIn, onDrafts, onRemove }: { a: AccountRow; busy: boolean; onSignIn: () => void; onDrafts: (on: boolean) => void; onRemove: () => void }) {
  const id = `cx-drafts-${a.account.replace(/[^a-z0-9]/gi, '-')}`;
  return (
    <li class={`cx-row ${a.state}`} data-account={a.account} data-state={a.state}>
      <div class="src-top">
        <span class="src-acct">{a.account || 'Earlier sign-in'}</span>
        <span class={`src-state ${a.state === 'connected' ? 'ok' : 'error'}`}>{STATE_TEXT[a.state]}</span>
      </div>
      <p class="src-meta">{typeText(a)} · Reads {readsText(a)}</p>
      {a.mail && a.account && (
        <label class="cx-switch" for={id}>
          <input id={id} type="checkbox" role="switch" checked={a.drafts} disabled={busy} onChange={(e) => onDrafts((e.target as HTMLInputElement).checked)} aria-describedby={`${id}-help`} />
          Reply drafts
          <span class="src-note" id={`${id}-help`}>{DRAFTS_TEXT}</span>
        </label>
      )}
      <div class="src-actions">
        {needsSignIn(a) && <button type="button" class="btn primary" disabled={busy} onClick={onSignIn}>Sign in again</button>}
        <button type="button" class="btn" disabled={busy} onClick={onRemove} aria-label={`Disconnect ${a.account || 'earlier sign-in'}`}>Disconnect</button>
      </div>
    </li>
  );
}

/** `onChange` runs after an account is added, signed in again, changed or removed, so the caller re-reads its sources. */
export function ConnectAccounts({ api, onChange }: { api: ConnectApi; onChange?: () => void }) {
  const [info, setInfo] = useState<ConnectInfo | null>(null);
  const [missing, setMissing] = useState(false);
  const [session, setSession] = useState<ConnectSession | null>(null);
  const [setup, setSetup] = useState<SetupState | 'running' | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const gone = useRef(false);
  /** The last sign-in asked for, so "Use a code instead" keeps its account. */
  const last = useRef<{ account?: string }>({});
  useEffect(() => () => { gone.current = true; }, []);

  const load = async () => {
    try { setInfo(await api.connect()); } catch { setMissing(true); }
  };
  useEffect(() => { void load(); }, []);

  const current = useRef('');
  const follow = async (s: ConnectSession) => {
    current.current = s.id;
    setSession(s);
    // A replaced sign-in stops polling and never paints over the new one.
    const mine = () => current.current === s.id && !gone.current;
    const end = await waitFor(api, s, { onUpdate: (x) => { if (mine()) setSession(x); }, stop: () => !mine() });
    if (!mine()) return;
    if (end.state === 'done') { await load(); onChange?.(); }
  };
  const run = async (f: () => Promise<ConnectSession | { ok: true } | void>) => {
    if (busy) return;
    setBusy(true); setMsg('');
    try {
      const r = await f();
      if (r && 'id' in r) void follow(r);
      else { await load(); onChange?.(); }
    } catch (e) { setMsg(e instanceof Error && e.message ? e.message : 'That did not work. Try again.'); } finally { setBusy(false); }
  };
  const start = (o: { account?: string; method?: 'browser' | 'device' } = {}) => { last.current = o.account ? { account: o.account } : {}; return run(() => api.connectStart(o)); };
  const runSetup = async () => {
    setSetup('running');
    try { const r = await api.connectSetup(); setSetup(r.state); if (r.state === 'done') await load(); } catch { setSetup('failed'); }
  };

  if (missing) return <p class="src-note" data-testid="connect-accounts">Connect accounts from Stack on your computer.</p>;
  if (!info) return <p class="src-note" data-testid="connect-accounts">Loading accounts…</p>;
  const waiting = session?.state === 'waiting';
  return (
    <div class="cx-panel" data-testid="connect-accounts">
      <h3 class="src-sub">Microsoft accounts</h3>
      <p class="src-note">{READ_TEXT}</p>
      {!info.setup.clientId ? (
        <div class="cx-setup" data-testid="connect-setup">
          <p><strong>One-time setup.</strong> {SETUP_TEXT}</p>
          <button type="button" class="btn primary" disabled={setup === 'running'} onClick={() => void runSetup()}>{setup === 'running' ? 'Running setup…' : 'Run setup'}</button>
          {setup && setup !== 'running' && <p role="status" aria-live="polite">{SETUP_RESULT[setup]}</p>}
        </div>
      ) : (
        <>
          {info.accounts.length > 0 && (
            <ul class="src-list">
              {info.accounts.map((a) => (
                <Account key={a.account} a={a} busy={busy || waiting}
                  onSignIn={() => void start(a.account ? { account: a.account } : {})}
                  onDrafts={(on) => void run(() => api.connectDrafts(a.account, on))}
                  onRemove={() => void run(async () => { await api.connectRemove(a.account); })} />
              ))}
            </ul>
          )}
          {session && <Session s={session} onCode={() => void start({ ...last.current, method: 'device' })} />}
          <div class="src-actions">
            <button type="button" class="btn primary" disabled={busy || waiting} onClick={() => void start()}>{info.accounts.length ? 'Add another account' : 'Connect a Microsoft account'}</button>
          </div>
        </>
      )}
      {msg && <p class="src-err" role="alert">{msg}</p>}
    </div>
  );
}
