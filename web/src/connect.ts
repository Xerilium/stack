/**
 * Connect accounts: the words the panel shows and the API it calls. Pure, so it is tested without a browser.
 * No token, code or command ever reaches the page; the server runs every step.
 * @req FR:connect-accounts/web.panel @req FR:connect-accounts/web.setup @req FR:connect-accounts/web.signin @req FR:connect-accounts/web.nocmd
 * @req FR:connect-accounts/web.row @req FR:connect-accounts/web.fix @req FR:connect-accounts/web.menu @req FR:connect-accounts/web.learn
 */
import { freshness } from './asks';

export interface AccountRow { account: string; type: 'personal' | 'work'; mail: boolean; calendar: boolean; drafts: boolean; state: 'connected' | 'expired' | 'down' | 'error'; lastOkAt?: string; retryAt?: string }
export interface ConnectInfo { setup: { clientId: boolean }; accounts: AccountRow[] }
export interface ConnectSession {
  id: string; method: 'browser' | 'device'; state: 'waiting' | 'done' | 'error';
  url?: string; userCode?: string; verificationUri?: string; expiresAt?: string; account?: string; error?: string;
}
export type SetupState = 'done' | 'needs-azure-signin' | 'needs-pwsh' | 'failed';

/** The calls the panel needs; the app client provides them. */
export interface ConnectApi {
  connect(): Promise<ConnectInfo>;
  connectSetup(): Promise<{ state: SetupState }>;
  connectStart(body: { account?: string; drafts?: boolean; method?: 'browser' | 'device' }): Promise<ConnectSession>;
  connectPoll(id: string): Promise<ConnectSession>;
  connectDrafts(account: string, on: boolean): Promise<ConnectSession | { ok: true }>;
  connectRemove(account: string): Promise<{ ok: true }>;
}

export const POLL_MS = 2000;
export const DRAFTS_TEXT = 'Drafts lets Stack save reply drafts in your mailbox. Stack never sends.';
export const READ_TEXT = 'Stack reads mail and calendar. It never sends.';
/** The one-line hint on the drafts menu item. @req FR:connect-accounts/web.menu */
export const DRAFTS_LABEL = 'Let Stack save reply drafts in my mailbox';
export const DRAFTS_HINT = 'Stack writes drafts for you to review. It never sends.';
/** The Learn more popover. @req FR:connect-accounts/web.learn */
export const LEARN_TEXT = [
  'Stack reads mail and calendar from each account. It signs in on Microsoft pages only and never sees your password.',
  'Reply drafts is off by default. Turn it on for an account and Stack saves reply drafts in that mailbox for you to review.',
  'Stack never sends mail and never changes your calendar.',
] as const;
export const SETUP_TEXT = 'One-time setup: Stack registers its own sign-in app in your Azure account. You do this once for all your accounts.';

/** @req FR:connect-accounts/web.setup */
export const SETUP_RESULT: Record<SetupState, string> = {
  done: 'Setup is done. Add your first account.',
  'needs-azure-signin': 'Sign in to Azure once: open PowerShell, run Connect-AzAccount, then click Run setup again.',
  'needs-pwsh': 'Setup needs PowerShell 7 and the Az module. Install PowerShell, then click Run setup again.',
  failed: 'Setup did not finish. Click Run setup to try again. See docs/connect-accounts.md if it keeps failing.',
};

export const typeText = (a: AccountRow) => (a.type === 'personal' ? 'Personal' : 'Work or school');
export const readsText = (a: AccountRow) => [a.mail && 'mail', a.calendar && 'calendar'].filter(Boolean).join(' and ') || 'nothing yet';
/** One short word per state. @req FR:connect-accounts/web.row */
export const STATE_TEXT: Record<AccountRow['state'], string> = { connected: 'Connected', expired: 'Needs sign-in', down: 'Microsoft not responding', error: 'Not working' };
/** An account that a sign-in can fix. An outage (`down`) is not one: Stack retries on its own. @req FR:connect-accounts/web.fix */
export const needsFix = (a: AccountRow) => a.state === 'expired' || a.state === 'error';
/** @deprecated use needsFix */
export const needsSignIn = needsFix;

const clockAt = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
/** The status tooltip: the last good read, and the next try while Microsoft is not responding. @req FR:connect-accounts/web.row */
export function statusTip(a: AccountRow, now: Date): string {
  const ok = a.lastOkAt && Number.isFinite(Date.parse(a.lastOkAt)) ? `Last synced ${now.getTime() - Date.parse(a.lastOkAt) < 12 * 3600_000 ? clockAt(a.lastOkAt) : freshness(a.lastOkAt, now)}` : 'Never synced';
  if (a.state !== 'down' || !a.retryAt) return ok;
  const ms = Date.parse(a.retryAt) - now.getTime();
  return `${ok} · ${ms <= 0 ? 'Retrying now' : `Retrying in ${ms < 60_000 ? `${Math.ceil(ms / 1000)} s` : `${Math.round(ms / 60_000)} min`}`}`;
}

const ERROR_TEXT: Record<string, string> = {
  expired_token: 'The sign-in timed out. Try again.',
  no_account: 'Microsoft did not name the account. Try again.',
  unsafe_scope: 'The Stack app asks for a permission Stack refuses. Run setup again.',
  account_mismatch: 'You signed in with a different account. Try again and pick the same account.',
  lost: 'Stack restarted during the sign-in. Try again.',
};
/** What the panel says while a sign-in runs, and when it ends. @req FR:connect-accounts/web.signin */
export function sessionText(s: ConnectSession): string {
  if (s.state === 'done') return `Connected ${s.account ?? ''}`.trim();
  if (s.state === 'error') return /denied|declined/.test(s.error ?? '') ? 'You declined the sign-in. Nothing was connected.' : ERROR_TEXT[s.error ?? ''] ?? 'Sign-in did not finish. Try again.';
  return s.method === 'device' ? 'Open the Microsoft page, enter this code, and pick your account.' : 'Finish signing in in your browser.';
}

/** Polls a session until it ends. `wait` is injectable for tests. */
export async function waitFor(api: Pick<ConnectApi, 'connectPoll'>, s: ConnectSession, o: { wait?: (ms: number) => Promise<void>; onUpdate?: (s: ConnectSession) => void; stop?: () => boolean } = {}): Promise<ConnectSession> {
  const wait = o.wait ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let cur = s;
  while (cur.state === 'waiting' && !o.stop?.()) {
    await wait(POLL_MS);
    if (o.stop?.()) break;
    try { cur = await api.connectPoll(s.id); } catch (e) {
      // The host restarted and the session is gone: end it. Any other failure is a missed poll: try again.
      if ((e as { status?: number } | null)?.status === 404) cur = { ...cur, state: 'error', error: 'lost' };
    }
    o.onUpdate?.(cur);
  }
  return cur;
}
