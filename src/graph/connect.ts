/**
 * In-app Connect for Outlook.com and work or school Microsoft accounts: browser sign-in (PKCE, loopback), device code fallback,
 * the account list with health, drafts opt-in, disconnect, and the one-time app registration run.
 * Never logs or returns a token, code, verifier or id token. Never sends.
 * @req FR:connect-accounts/flow.browser @req FR:connect-accounts/flow.callback @req FR:connect-accounts/flow.device @req FR:connect-accounts/flow.account
 * @req FR:connect-accounts/flow.save @req FR:connect-accounts/flow.session @req FR:connect-accounts/scope.default @req FR:connect-accounts/scope.drafts
 * @req FR:connect-accounts/acct.list @req FR:connect-accounts/acct.health @req FR:connect-accounts/acct.remove
 * @req FR:connect-accounts/setup.client @req FR:connect-accounts/setup.run
 */
import { execFile } from 'child_process';
import { randomBytes } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { createServer } from 'http';
import { homedir } from 'os';
import { basename, join, resolve } from 'path';
import { MAILBOX } from '../core/config';
import {
  accountCachePath, authorizeUrl, cacheDir as defaultCacheDir, FileTokenCache, GraphSignInError, hasScope, idClaims, listCachePaths, MSA_TENANT,
  pkcePair, pollDeviceCode, redeemAuthCode, startDeviceCode, tenantFor, type Granted,
} from './auth';

// ------------------------------------------------------------------ health

export type AccountMark = 'expired' | 'error';
/** In-memory marks from live reads, shared by the calendar, the accounts list and the inbox probe. @req FR:connect-accounts/acct.health */
export class AccountHealth {
  private marks = new Map<string, AccountMark>();
  mark(account: string, m: AccountMark): void { this.marks.set(account.toLowerCase(), m); }
  clear(account: string): void { this.marks.delete(account.toLowerCase()); }
  get(account: string): AccountMark | undefined { return this.marks.get(account.toLowerCase()); }
}

// ------------------------------------------------------------------ client id and setup

const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const guid = (v: unknown): string | undefined => (typeof v === 'string' && GUID.test(v.trim()) ? v.trim() : undefined);
export const userConfigPath = (home = homedir()) => join(home, '.config', 'stack', 'config.json');

/** The Stack app id: env, then `graph.clientId` in the user config, then an existing token cache. GUIDs only. @req FR:connect-accounts/setup.client */
export function readClientId(o: { env?: NodeJS.ProcessEnv; configPath?: string; cacheDir?: string } = {}): string | undefined {
  const env = guid((o.env ?? process.env).STACK_GRAPH_CLIENT_ID);
  if (env) return env;
  try {
    const cfg = JSON.parse(readFileSync(o.configPath ?? userConfigPath(), 'utf8')) as { graph?: { clientId?: unknown } };
    const id = guid(cfg?.graph?.clientId);
    if (id) return id;
  } catch { /* no config yet */ }
  for (const p of listCachePaths(o.cacheDir ?? defaultCacheDir())) {
    try { const id = guid((JSON.parse(readFileSync(p, 'utf8')) as { clientId?: unknown }).clientId); if (id) return id; } catch { /* skip */ }
  }
  return undefined;
}

export type SetupState = 'done' | 'needs-azure-signin' | 'needs-pwsh' | 'failed';
export type Exec = (file: string, args: string[], o: { timeoutMs: number }) => Promise<{ code?: number | null; missing?: boolean }>;

/** Runs a file with fixed args and no shell; output is dropped (it is never shown or logged). */
export const execQuiet: Exec = (file, args, o) => new Promise((ok) => {
  execFile(file, args, { timeout: o.timeoutMs, windowsHide: true, maxBuffer: 1 << 20 }, (e) => {
    const err = e as (NodeJS.ErrnoException & { code?: number | string }) | null;
    if (err && err.code === 'ENOENT') ok({ missing: true });
    else ok({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0 });
  });
});

/** `scripts/register-stack-app.ps1` from the source layout or a build layout. */
export function setupScriptPath(from = __dirname): string {
  const c = [resolve(from, '../../scripts/register-stack-app.ps1'), resolve(from, '../../../scripts/register-stack-app.ps1'), resolve(from, '../../../../scripts/register-stack-app.ps1')];
  return c.find((p) => existsSync(p)) ?? c[0];
}

/** Runs the one-time app registration. State codes only. @req FR:connect-accounts/setup.run */
export async function runSetup(o: { exec?: Exec; script?: string; clientId?: () => string | undefined } = {}): Promise<{ state: SetupState }> {
  const r = await (o.exec ?? execQuiet)('pwsh', ['-NoProfile', '-NonInteractive', '-File', o.script ?? setupScriptPath()], { timeoutMs: 180_000 }).catch(() => ({ code: 1 }));
  if ('missing' in r && r.missing) return { state: 'needs-pwsh' };
  if (r.code === 3) return { state: 'needs-azure-signin' };
  // 4: the Az modules are missing.
  if (r.code === 4) return { state: 'needs-pwsh' };
  if (r.code === 0 && (o.clientId ?? (() => readClientId()))()) return { state: 'done' };
  return { state: 'failed' };
}

// ------------------------------------------------------------------ sessions

export interface ConnectSession {
  id: string; method: 'browser' | 'device'; state: 'waiting' | 'done' | 'error';
  url?: string; userCode?: string; verificationUri?: string; expiresAt?: string; account?: string; error?: string;
}
export interface AccountRow { account: string; type: 'personal' | 'work'; mail: boolean; calendar: boolean; drafts: boolean; state: 'connected' | AccountMark }
export interface StartOptions { account?: string; drafts?: boolean; method?: 'browser' | 'device' }

/** The connect service the API calls. */
export interface Connect {
  hasClientId(): boolean;
  start(o: StartOptions): Promise<ConnectSession>;
  get(id: string): ConnectSession | undefined;
  accounts(): Promise<AccountRow[]>;
  setDrafts(account: string, on: boolean): Promise<ConnectSession | { ok: true }>;
  remove(account: string): Promise<void>;
  setup(): Promise<{ state: SetupState }>;
}

/** A loopback listener: calls `handler` for each request URL; `close` stops it. */
export type Listen = (handler: (url: URL) => Promise<{ status: number; body: string }>) => Promise<{ port: number; close(): void }>;

/**
 * Listens on 127.0.0.1 on a free port, and on ::1 on the same port when the host has IPv6, so `localhost` resolves either way.
 * GET only; small HTML replies with `connection: close`. `close` stops new connections and lets a reply in progress finish.
 */
export const loopbackListen: Listen = (handler) => new Promise((ok, fail) => {
  const serve = () => createServer((req, res) => {
    if (req.method !== 'GET') { res.writeHead(405, { connection: 'close' }).end(); return; }
    void handler(new URL(req.url ?? '/', 'http://localhost')).then((r) => {
      res.writeHead(r.status, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', connection: 'close' }).end(r.body);
    }, () => res.writeHead(500, { connection: 'close' }).end());
  });
  const v4 = serve();
  v4.once('error', fail);
  v4.listen(0, '127.0.0.1', () => {
    const a = v4.address();
    const port = typeof a === 'object' && a ? a.port : 0;
    const all = [v4];
    const done = () => ok({ port, close: () => { for (const s of all) { s.close(); s.closeIdleConnections?.(); } } });
    const v6 = serve();
    v6.once('error', () => done()); // no IPv6 loopback, or the port is taken there: 127.0.0.1 alone
    v6.listen(port, '::1', () => { all.push(v6); done(); });
  });
});

/** Opens a URL in the system browser with the OS opener: fixed args, no shell. */
export function osOpen(url: string): Promise<void> {
  if (!/^https:\/\//.test(url)) return Promise.reject(new Error('https only'));
  const [file, args] = process.platform === 'darwin' ? ['open', [url]] : process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : ['xdg-open', [url]];
  return new Promise((ok, fail) => { execFile(file, args as string[], { timeout: 10_000, windowsHide: true }, (e) => (e ? fail(new Error('open failed')) : ok())); });
}

export interface ConnectDeps {
  clientId: () => string | undefined;
  fetch?: typeof fetch;
  openUrl?: (url: string) => Promise<void>;
  listen?: Listen;
  cacheDir?: string;
  health?: AccountHealth;
  now?: () => number;
  sleep?: (seconds: number) => Promise<void>;
  setup?: () => Promise<{ state: SetupState }>;
}

const SESSION_MS = 30 * 60_000;
const LISTEN_MS = 10 * 60_000;
const CODE = /^[a-z_]{1,64}$/;
const DONE_HTML = '<!doctype html><meta charset="utf-8"><title>Stack</title><body style="font-family:system-ui;padding:2rem"><h1>Stack is connected. You can close this tab.</h1></body>';
const FAIL_HTML = '<!doctype html><meta charset="utf-8"><title>Stack</title><body style="font-family:system-ui;padding:2rem"><h1>Sign-in did not finish. Go back to Stack and try again.</h1></body>';

/** The scopes Connect asks for. @req FR:connect-accounts/scope.default @req FR:connect-accounts/scope.drafts */
export const connectScopes = (drafts: boolean): string[] => ['Calendars.Read', drafts ? 'Mail.ReadWrite' : 'Mail.Read', 'offline_access', 'openid', 'profile'];

export function createConnect(d: ConnectDeps): Connect {
  const sessions = new Map<string, { s: ConnectSession; at: number }>();
  /** Open browser listeners by session: a new sign-in closes them, so only one waits at a time. */
  const listeners = new Map<string, () => void>();
  const now = d.now ?? (() => Date.now());
  const dir = () => d.cacheDir ?? defaultCacheDir();
  const health = d.health ?? new AccountHealth();
  const put = (s: ConnectSession) => {
    for (const [k, v] of sessions) if (now() - v.at > SESSION_MS) sessions.delete(k);
    sessions.set(s.id, { s, at: now() });
    return s;
  };
  const fail = (s: ConnectSession, e: unknown) => { s.state = 'error'; s.error = e instanceof GraphSignInError && CODE.test(e.code) ? e.code : 'server_error'; };

  /** Names the account from the id token and saves its cache. @req FR:connect-accounts/flow.account @req FR:connect-accounts/flow.save */
  async function finish(s: ConnectSession, g: Granted, clientId: string, scopes: string[], hint?: string): Promise<void> {
    const c = g.idToken ? idClaims(g.idToken) : {};
    if (!c.account || !MAILBOX.test(c.account)) throw new GraphSignInError('no_account');
    // A sign-in for one account (drafts, sign in again) must not save another one picked in the Microsoft page.
    if (hint && c.account !== hint) throw new GraphSignInError('account_mismatch');
    const tenant = c.tid === MSA_TENANT ? 'consumers' : c.tid && GUID.test(c.tid) ? c.tid : tenantFor(c.account);
    // Microsoft returns every scope ever consented: Mail.ReadWrite stays only when this sign-in asked for drafts.
    const drafts = hasScope(scopes, 'Mail.ReadWrite');
    let kept = (g.scopes.length ? g.scopes : scopes).filter((x) => drafts || !hasScope([x], 'Mail.ReadWrite'));
    if (!drafts && hasScope(g.scopes, 'Mail.ReadWrite') && !hasScope(kept, 'Mail.Read')) kept = [...kept, 'Mail.Read'];
    await new FileTokenCache(accountCachePath(c.account, dir())).write({ version: 1, tenant, clientId, scopes: kept, refreshToken: g.refreshToken, accessToken: g.accessToken, expiresAt: g.expiresAt, account: c.account });
    // An older default file for this account would list it twice: the new file replaces it.
    const old = join(dir(), 'graph-token.json');
    const prev = await new FileTokenCache(old).read().catch(() => null);
    if (prev?.account?.toLowerCase() === c.account) await new FileTokenCache(old).clear();
    health.clear(c.account);
    s.state = 'done';
    s.account = c.account;
  }

  /** @req FR:connect-accounts/flow.device */
  async function device(s: ConnectSession, clientId: string, scopes: string[], account?: string): Promise<ConnectSession> {
    // `common`, as the browser flow: a personal account outside the known Outlook domains still signs in.
    const tenant = 'common';
    const code = await startDeviceCode({ tenant, clientId, scopes, ...(d.fetch ? { fetch: d.fetch } : {}) });
    Object.assign(s, { method: 'device', userCode: code.userCode, verificationUri: code.verificationUri, expiresAt: new Date(now() + code.expiresIn * 1000).toISOString() });
    delete s.url;
    // A newer sign-in stops this poll at its next wait.
    let stopped = false;
    listeners.set(s.id, () => { stopped = true; listeners.delete(s.id); });
    const base = d.sleep ?? ((sec: number) => new Promise<void>((r) => setTimeout(r, sec * 1000)));
    const sleep = async (sec: number) => { await base(sec); if (stopped) throw new GraphSignInError('replaced'); };
    void pollDeviceCode({ tenant, clientId, code, ...(d.fetch ? { fetch: d.fetch } : {}), sleep, now })
      .then((g) => finish(s, g, clientId, scopes, account)).catch((e: unknown) => fail(s, e)).finally(() => listeners.delete(s.id));
    return s;
  }

  /** @req FR:connect-accounts/flow.browser @req FR:connect-accounts/flow.callback */
  async function browser(s: ConnectSession, clientId: string, scopes: string[], account?: string): Promise<ConnectSession | null> {
    const { verifier, challenge } = pkcePair();
    const state = randomBytes(16).toString('hex');
    let redirectUri = '';
    let used = false;
    const h: { stop?: () => void; timer?: ReturnType<typeof setTimeout> } = {};
    const close = () => { if (h.timer) clearTimeout(h.timer); h.stop?.(); };
    let l: { port: number; close(): void };
    try {
      l = await (d.listen ?? loopbackListen)(async (u) => {
        if (u.pathname !== '/') return { status: 404, body: '' };
        if (used || u.searchParams.get('state') !== state) return { status: 400, body: FAIL_HTML };
        used = true;
        close();
        const err = u.searchParams.get('error');
        if (err) { fail(s, new GraphSignInError(CODE.test(err) ? err : 'server_error')); return { status: 200, body: FAIL_HTML }; }
        try {
          const g = await redeemAuthCode({ tenant: 'common', clientId, code: u.searchParams.get('code') ?? '', verifier, redirectUri, ...(d.fetch ? { fetch: d.fetch } : {}), now });
          await finish(s, g, clientId, scopes, account);
          return { status: 200, body: DONE_HTML };
        } catch (e) { fail(s, e); return { status: 200, body: FAIL_HTML }; }
      });
    } catch { return null; }
    h.stop = () => { listeners.delete(s.id); l.close(); };
    listeners.set(s.id, close);
    redirectUri = `http://localhost:${l.port}`;
    s.url = authorizeUrl({ tenant: 'common', clientId, scopes, redirectUri, challenge, state, ...(account ? { loginHint: account } : {}) });
    try { await (d.openUrl ?? osOpen)(s.url); } catch { close(); return null; }
    h.timer = setTimeout(() => { if (!used) { used = true; close(); fail(s, new GraphSignInError('expired_token')); } }, LISTEN_MS);
    h.timer.unref?.();
    return s;
  }

  async function start(o: StartOptions): Promise<ConnectSession> {
    const clientId = d.clientId();
    if (!clientId) throw Object.assign(new Error('One-time setup needed: no Stack app registration yet'), { code: 'setup_needed' });
    const account = o.account?.trim().toLowerCase();
    if (account !== undefined && !MAILBOX.test(account)) throw new Error('Invalid account address');
    const scopes = connectScopes(!!o.drafts);
    for (const [id, stop] of [...listeners]) { stop(); const old = sessions.get(id)?.s; if (old?.state === 'waiting') { old.state = 'error'; old.error = 'replaced'; } }
    // The hinted account rides on the session, so "Use a code instead" keeps it.
    const s = put({ id: randomBytes(12).toString('hex'), method: 'browser', state: 'waiting', ...(account ? { account } : {}) });
    if (o.method !== 'device' && (await browser(s, clientId, scopes, account))) return s;
    return device(s, clientId, scopes, account);
  }

  /** @req FR:connect-accounts/acct.list */
  async function accounts(): Promise<AccountRow[]> {
    const out: AccountRow[] = [];
    for (const p of listCachePaths(dir())) {
      const named = /^graph-token-(.+)\.json$/.exec(basename(p))?.[1]?.toLowerCase() ?? '';
      try {
        const t = await new FileTokenCache(p).read();
        if (!t) continue;
        const account = (t.account ?? named).toLowerCase();
        const drafts = hasScope(t.scopes, 'Mail.ReadWrite');
        out.push({ account, type: t.tenant === 'consumers' ? 'personal' : 'work', mail: drafts || hasScope(t.scopes, 'Mail.Read'), calendar: hasScope(t.scopes, 'Calendars.Read'), drafts, state: health.get(account) ?? 'connected' });
      } catch {
        out.push({ account: named, type: tenantFor(named) === 'consumers' ? 'personal' : 'work', mail: false, calendar: false, drafts: false, state: 'error' });
      }
    }
    return out.sort((a, b) => a.account.localeCompare(b.account));
  }

  /** The cache file that holds `account`: its own file, or an older default file that names it (or names no one, for ''). */
  async function cacheFor(account: string): Promise<FileTokenCache> {
    for (const p of listCachePaths(dir())) {
      const named = /^graph-token-(.+)\.json$/.exec(basename(p))?.[1]?.toLowerCase() ?? '';
      const t = await new FileTokenCache(p).read().catch(() => null);
      if (((t?.account ?? named).toLowerCase()) === account) return new FileTokenCache(p);
    }
    return new FileTokenCache(account ? accountCachePath(account, dir()) : join(dir(), 'graph-token.json'));
  }

  return {
    hasClientId: () => !!d.clientId(),
    start,
    get: (id) => sessions.get(id)?.s,
    accounts,
    /** @req FR:connect-accounts/scope.drafts */
    async setDrafts(account, on) {
      if (on) return start({ account, drafts: true });
      const c = await cacheFor(account);
      const t = await c.read();
      if (!t) throw new Error('Account not connected');
      const had = hasScope(t.scopes, 'Mail.ReadWrite');
      const scopes = t.scopes.filter((x) => !hasScope([x], 'Mail.ReadWrite'));
      if (had && !hasScope(scopes, 'Mail.Read')) scopes.push('Mail.Read');
      const { accessToken: _a, expiresAt: _e, ...rest } = t;
      void _a; void _e;
      await c.write({ ...rest, scopes });
      return { ok: true };
    },
    /** @req FR:connect-accounts/acct.remove */
    async remove(account) { await (await cacheFor(account)).clear(); health.clear(account); },
    setup: d.setup ?? (() => runSetup()),
  };
}
