/**
 * Settings > Accounts: one compact list, one row per account (kind, address, status dot and one word), one Fix when a sign-in can help,
 * and a row menu for drafts, sign in again and disconnect. Add account sits on top; setup and other ways to connect sit behind one link.
 * Stack runs every step; no command to copy.
 * @req FR:connect-accounts/web.panel @req FR:connect-accounts/web.row @req FR:connect-accounts/web.fix @req FR:connect-accounts/web.menu
 * @req FR:connect-accounts/web.manual @req FR:connect-accounts/web.setup @req FR:connect-accounts/web.signin @req FR:connect-accounts/web.nocmd
 */
import type { ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  DRAFTS_HINT, DRAFTS_LABEL, needsFix, sessionText, SETUP_RESULT, SETUP_TEXT, STATE_TEXT, statusTip, waitFor,
  type AccountRow, type ConnectApi, type ConnectInfo, type ConnectSession, type SetupState,
} from './connect';

function Session({ s, onCode }: { s: ConnectSession; onCode: () => void }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => { try { await navigator.clipboard.writeText(s.userCode ?? ''); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { /* the code stays selectable */ } };
  return (
    <div class="acct-session" data-testid="connect-session" data-state={s.state}>
      <p role="status" aria-live="polite">{sessionText(s)}</p>
      {s.state === 'waiting' && s.method === 'browser' && s.url && (
        <p class="acct-links"><a href={s.url} target="_blank" rel="noopener noreferrer">Open the sign-in page</a> · <button type="button" class="acct-link" onClick={onCode}>Use a code instead</button></p>
      )}
      {s.state === 'waiting' && s.method === 'device' && (
        <div class="acct-code">
          <code data-testid="connect-code">{s.userCode}</code>
          <button type="button" class="fl-btn" onClick={() => void copy()}>{copied ? 'Copied' : 'Copy code'}</button>
          {s.verificationUri && <a href={s.verificationUri} target="_blank" rel="noopener noreferrer">Open {s.verificationUri.replace(/^https:\/\/(www\.)?/, '')}</a>}
        </div>
      )}
    </div>
  );
}

const WORK = 'M4 8h16v11H4zM9 8V5.5h6V8';
const PERSONAL = 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8c0-3.3 3.1-5.5 7-5.5s7 2.2 7 5.5';
/** Work (briefcase) or Personal (person); the word is the accessible name. */
function Kind({ type }: { type: AccountRow['type'] }) {
  const word = type === 'personal' ? 'Personal' : 'Work';
  return (
    <span class="acct-kind" role="img" aria-label={word} title={word}>
      <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d={type === 'personal' ? PERSONAL : WORK} fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" /></svg>
    </span>
  );
}

/** The row menu: drafts, sign in again, disconnect (asks first). Arrows move, Escape closes and returns focus. @req FR:connect-accounts/web.menu */
function RowMenu({ a, busy, onDrafts, onSignIn, onRemove }: { a: AccountRow; busy: boolean; onDrafts: (on: boolean) => void; onSignIn: () => void; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const btn = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const name = a.account || 'earlier sign-in';
  const id = `acct-menu-${(a.account || 'default').replace(/[^a-z0-9]/gi, '-')}`;
  const close = (focus = true) => { setOpen(false); setConfirm(false); if (focus) btn.current?.focus(); };
  const items = () => [...(menu.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])];
  useEffect(() => { if (open) items()[0]?.focus(); }, [open, confirm]);
  useEffect(() => {
    if (!open) return;
    const out = (e: MouseEvent) => { if (!menu.current?.contains(e.target as Node) && e.target !== btn.current) close(false); };
    document.addEventListener('mousedown', out);
    return () => document.removeEventListener('mousedown', out);
  }, [open]);
  const onKey = (e: KeyboardEvent) => {
    const list = items(), i = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
    else if (e.key === 'Tab') close(false);
  };
  const pick = (f: () => void) => () => { close(); f(); };
  return (
    <span class="fl-pop-wrap acct-more">
      <button ref={btn} type="button" class="fl-btn subtle acct-kebab" aria-label={`More for ${name}`} aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} disabled={busy} onClick={() => (open ? close() : setOpen(true))}>
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 12h.01M12 12h.01M19 12h.01" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" /></svg>
      </button>
      {open && (
        <div ref={menu} id={id} class="fl-popover acct-menu" role="menu" aria-label={`Account ${name}`} onKeyDown={onKey}>
          {confirm ? (
            <>
              <p class="acct-confirm" id={`${id}-q`}>Disconnect {name}? Stack stops reading it.</p>
              <button type="button" role="menuitem" class="fl-option danger" aria-describedby={`${id}-q`} onClick={pick(onRemove)}>Disconnect</button>
              <button type="button" role="menuitem" class="fl-option" onClick={() => setConfirm(false)}>Cancel</button>
            </>
          ) : (
            <>
              {a.mail && a.account && (
                <button type="button" role="menuitemcheckbox" aria-checked={a.drafts} class="fl-option acct-check" aria-describedby={`${id}-hint`} onClick={pick(() => onDrafts(!a.drafts))}>
                  <span class="acct-box" aria-hidden="true">{a.drafts ? '✓' : ''}</span>
                  <span>{DRAFTS_LABEL}<small id={`${id}-hint`} class="acct-hint">{DRAFTS_HINT}</small></span>
                  <span class="acct-onoff">{a.drafts ? 'On' : 'Off'}</span>
                </button>
              )}
              <button type="button" role="menuitem" class="fl-option" onClick={pick(onSignIn)}>Sign in again</button>
              <button type="button" role="menuitem" class="fl-option" onClick={() => setConfirm(true)}>Disconnect</button>
            </>
          )}
        </div>
      )}
    </span>
  );
}

function Row({ a, busy, now, onSignIn, onDrafts, onRemove }: { a: AccountRow; busy: boolean; now: Date; onSignIn: () => void; onDrafts: (on: boolean) => void; onRemove: () => void }) {
  const tip = statusTip(a, now);
  const name = a.account || 'Earlier sign-in';
  return (
    <li class="acct-row" data-account={a.account} data-state={a.state}>
      <Kind type={a.type} />
      <span class="acct-addr" title={name}>{name}</span>
      <span class="acct-status" title={tip}>
        <span class={`acct-dot ${a.state}`} aria-hidden="true" />
        <span class="acct-word">{STATE_TEXT[a.state]}</span>
        <span class="sr-only">. {tip}</span>
      </span>
      {needsFix(a) ? <button type="button" class="fl-btn primary acct-fix" disabled={busy} aria-label={`Fix ${name}`} onClick={onSignIn}>Fix</button> : <span class="acct-fix-gap" aria-hidden="true" />}
      <RowMenu a={a} busy={busy} onDrafts={onDrafts} onSignIn={onSignIn} onRemove={onRemove} />
    </li>
  );
}

/**
 * `onChange` runs after an account is added, signed in again, changed or removed, so the caller re-reads its sources.
 * `other` is the published calendar link block shown inside `Other ways to connect`.
 */
export function ConnectAccounts({ api, onChange, other, now = new Date() }: { api: ConnectApi; onChange?: () => void; other?: ComponentChildren; now?: Date }) {
  const [info, setInfo] = useState<ConnectInfo | null>(null);
  const [missing, setMissing] = useState(false);
  const [session, setSession] = useState<ConnectSession | null>(null);
  const [setup, setSetup] = useState<SetupState | 'running' | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [manual, setManual] = useState<boolean | null>(null);
  const gone = useRef(false);
  /** The last sign-in asked for, so "Use a code instead" keeps its account and drafts. */
  const last = useRef<{ account?: string; drafts?: boolean }>({});
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
  const remember = (o: { account?: string; drafts?: boolean }) => { last.current = { ...(o.account ? { account: o.account } : {}), ...(o.drafts ? { drafts: true } : {}) }; };
  const start = (o: { account?: string; drafts?: boolean; method?: 'browser' | 'device' } = {}) => { remember(o); return run(() => api.connectStart(o)); };
  const runSetup = async () => {
    setSetup('running');
    try { const r = await api.connectSetup(); setSetup(r.state); if (r.state === 'done') await load(); } catch { setSetup('failed'); }
  };

  const needSetup = !!info && !info.setup.clientId;
  // Closed by default; open by default only while setup is needed. @req FR:connect-accounts/web.manual
  const showManual = manual ?? needSetup;
  const waiting = session?.state === 'waiting';
  const otherWays = (
    <div class="acct-other">
      <button type="button" class="acct-link" aria-expanded={showManual} aria-controls="acct-manual" onClick={() => setManual(!showManual)}>Other ways to connect</button>
      {showManual && (
        <div id="acct-manual" class="acct-manual" data-testid="connect-manual">
          {needSetup && (
            <div class="acct-setup" data-testid="connect-setup">
              <p><strong>One-time setup.</strong> {SETUP_TEXT}</p>
              <button type="button" class="fl-btn primary" disabled={setup === 'running'} onClick={() => void runSetup()}>{setup === 'running' ? 'Running setup…' : 'Run setup'}</button>
              {setup && setup !== 'running' && <p role="status" aria-live="polite">{SETUP_RESULT[setup]}</p>}
            </div>
          )}
          {other}
        </div>
      )}
    </div>
  );

  if (missing) return <div class="acct-panel" data-testid="connect-accounts"><p class="acct-note">Connect accounts from Stack on your Mac.</p>{otherWays}</div>;
  if (!info) return <p class="acct-note" data-testid="connect-accounts" role="status">Loading accounts…</p>;
  return (
    <div class="acct-panel" data-testid="connect-accounts">
      <div class="acct-top">
        <button type="button" class="fl-btn primary" disabled={busy || waiting || needSetup} onClick={() => void start()}>Add account</button>
        {info.accounts.length > 0 && <span class="acct-count">{info.accounts.length} {info.accounts.length === 1 ? 'account' : 'accounts'}</span>}
      </div>
      {session && <Session s={session} onCode={() => void start({ ...last.current, method: 'device' })} />}
      {info.accounts.length > 0 && (
        <ul class="acct-list" aria-label="Microsoft accounts">
          {info.accounts.map((a, i) => (
            <Row key={`${a.account}|${i}`} a={a} busy={busy || waiting} now={now}
              // Signing in again keeps drafts on when they were on.
              onSignIn={() => void start(a.account ? { account: a.account, ...(a.drafts ? { drafts: true } : {}) } : {})}
              onDrafts={(on) => { if (on) remember({ account: a.account, drafts: true }); void run(() => api.connectDrafts(a.account, on)); }}
              onRemove={() => void run(async () => { await api.connectRemove(a.account); })} />
          ))}
        </ul>
      )}
      {msg && <p class="acct-err" role="alert">{msg}</p>}
      {otherWays}
    </div>
  );
}
