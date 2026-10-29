/**
 * Owner sign-in to Microsoft Graph with the device code flow, a token cache outside the task repo, and refresh on demand.
 * Read scopes only (plus reply drafts when asked); nothing here can send mail or write a calendar.
 * @req FR:graph-signin/scope.sets @req FR:graph-signin/scope.never @req FR:graph-signin/flow.start @req FR:graph-signin/flow.poll @req FR:graph-signin/flow.host
 * @req FR:graph-signin/cache.file @req FR:graph-signin/cache.provider
 */
import { existsSync, promises as fs, statSync } from 'fs';
import { homedir } from 'os';
import { dirname, join, resolve } from 'path';

export const FEATURES = { calendar: 'Calendars.Read', mail: 'Mail.Read', drafts: 'Mail.ReadWrite' } as const;
export type Feature = keyof typeof FEATURES;

/** Least-privilege scopes for the features asked for, plus `offline_access`. @req FR:graph-signin/scope.sets */
export function scopesFor(features: Feature[]): string[] {
  const out: string[] = [];
  for (const f of features) {
    const s = (FEATURES as Record<string, string>)[f];
    if (!s) throw new Error(`Unknown Graph feature: ${String(f)}`);
    if (!out.includes(s)) out.push(s);
  }
  return [...out.sort(), 'offline_access'];
}

const UNSAFE = /^(?:Mail\.Send|Calendars\.ReadWrite)|\.default$|All|Shared/;
/** Throws for any scope that could send mail, write a calendar, or reach beyond the owner's own mailbox. @req FR:graph-signin/scope.never */
export function assertSafeScopes(scopes: string[]): void {
  for (const s of scopes) if (typeof s !== 'string' || UNSAFE.test(s.replace(/^https:\/\/graph\.microsoft\.com\//, ''))) throw new Error(`Refusing Graph scope: ${String(s)}`);
}

/** Sign-in failed; `code` is the OAuth error code only (no response body, no token). */
export class GraphSignInError extends Error {
  constructor(readonly code: string) { super(`Graph sign-in failed: ${code}`); this.name = 'GraphSignInError'; }
}
/** No usable sign-in: run `stack graph login`. */
export class GraphSignInRequired extends Error {
  constructor() { super('Not signed in to Microsoft Graph: run `stack graph login`'); this.name = 'GraphSignInRequired'; }
}

const LOGIN = 'https://login.microsoftonline.com';
const TENANT = /^(?:organizations|consumers|common|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+)$/i;
const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CODE = /^[a-z_]{1,64}$/;

export interface SignInOptions { tenant: string; clientId: string; fetch?: typeof fetch }

function check(o: SignInOptions, scopes: string[]): void {
  if (!TENANT.test(o.tenant)) throw new GraphSignInError('invalid_tenant');
  if (!GUID.test(o.clientId)) throw new GraphSignInError('invalid_client_id');
  assertSafeScopes(scopes);
}

/** POSTs form data to the login host; returns the JSON body and whether the status was 2xx. @req FR:graph-signin/flow.host */
async function post(o: SignInOptions, path: string, form: Record<string, string>): Promise<{ ok: boolean; body: Record<string, unknown> }> {
  const get = o.fetch ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const res = await get(`${LOGIN}/${encodeURIComponent(o.tenant)}/oauth2/v2.0/${path}`, {
    method: 'POST', redirect: 'error', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: new URLSearchParams(form).toString(),
  });
  let body: Record<string, unknown> = {};
  try { body = (await res.json()) as Record<string, unknown>; } catch { body = {}; }
  return { ok: res.ok, body };
}
const errorCode = (b: Record<string, unknown>) => (typeof b.error === 'string' && CODE.test(b.error) ? b.error : 'server_error');

export interface DeviceCode { deviceCode: string; userCode: string; verificationUri: string; expiresIn: number; interval: number; message: string }

/** @req FR:graph-signin/flow.start */
export async function startDeviceCode(o: SignInOptions & { scopes: string[] }): Promise<DeviceCode> {
  check(o, o.scopes);
  const r = await post(o, 'devicecode', { client_id: o.clientId, scope: o.scopes.join(' ') });
  const b = r.body;
  if (!r.ok || typeof b.device_code !== 'string') throw new GraphSignInError(errorCode(b));
  return {
    deviceCode: b.device_code, userCode: String(b.user_code ?? ''), verificationUri: String(b.verification_uri ?? ''),
    expiresIn: Number(b.expires_in) || 900, interval: Math.max(0, Number(b.interval ?? 5)), message: String(b.message ?? ''),
  };
}

export interface Granted { accessToken: string; refreshToken: string; expiresAt: number; scopes: string[] }
const STOP = new Set(['access_denied', 'expired_token', 'authorization_declined', 'bad_verification_code']);

function granted(b: Record<string, unknown>, now: number): Granted {
  if (typeof b.access_token !== 'string') throw new GraphSignInError('server_error');
  if (typeof b.refresh_token !== 'string') throw new GraphSignInError('no_refresh_token');
  const scopes = typeof b.scope === 'string' ? b.scope.split(/\s+/).filter(Boolean) : [];
  return { accessToken: b.access_token, refreshToken: b.refresh_token, expiresAt: now + (Number(b.expires_in) || 3600) * 1000, scopes };
}

/** Polls until the owner finishes signing in, declines, or the code expires. @req FR:graph-signin/flow.poll */
export async function pollDeviceCode(o: SignInOptions & { code: DeviceCode; sleep?: (seconds: number) => Promise<void>; now?: () => number }): Promise<Granted> {
  check(o, []);
  const now = o.now ?? (() => Date.now());
  const sleep = o.sleep ?? ((s: number) => new Promise<void>((r) => setTimeout(r, s * 1000)));
  const deadline = now() + o.code.expiresIn * 1000;
  let interval = o.code.interval;
  for (;;) {
    await sleep(interval);
    if (now() > deadline) throw new GraphSignInError('expired_token');
    const r = await post(o, 'token', { grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: o.clientId, device_code: o.code.deviceCode });
    if (r.ok) return granted(r.body, now());
    const code = errorCode(r.body);
    if (code === 'authorization_pending') continue;
    if (code === 'slow_down') { interval += 5; continue; }
    throw new GraphSignInError(STOP.has(code) ? code : code);
  }
}

// ------------------------------------------------------------------ cache

export interface CachedToken {
  version: 1; tenant: string; clientId: string; scopes: string[]; refreshToken: string; accessToken?: string; expiresAt?: number; account?: string;
}
export const defaultCachePath = (home = homedir()) => join(home, '.config', 'stack', 'graph-token.json');

/** True when `dir` or a parent holds a `tasks/` folder: a Stack task repo, which a token must never enter. */
function inTaskRepo(path: string): boolean {
  for (let d = dirname(resolve(path)); ; d = dirname(d)) {
    if (existsSync(join(d, 'tasks')) && statSync(join(d, 'tasks')).isDirectory()) return true;
    if (dirname(d) === d) return false;
  }
}

/** JSON token file, mode 0600, written atomically, never inside a task repo. @req FR:graph-signin/cache.file */
export class FileTokenCache {
  constructor(readonly path: string = defaultCachePath()) {
    if (inTaskRepo(path)) throw new Error('Refusing to keep a Graph token inside a Stack task repo');
  }
  async read(): Promise<CachedToken | null> {
    let st;
    try { st = await fs.stat(this.path); } catch { return null; }
    if ((st.mode & 0o077) !== 0) throw new Error(`Graph token file has loose permissions; run: chmod 600 ${this.path}`);
    const v = JSON.parse(await fs.readFile(this.path, 'utf8')) as Partial<CachedToken>;
    if (v.version !== 1 || typeof v.refreshToken !== 'string' || typeof v.tenant !== 'string' || typeof v.clientId !== 'string' || !Array.isArray(v.scopes)) throw new Error('Graph token file is not valid');
    return v as CachedToken;
  }
  async write(t: CachedToken): Promise<void> {
    await fs.mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const tmp = `${this.path}.${process.pid}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(t), { mode: 0o600 });
    await fs.chmod(tmp, 0o600);
    await fs.rename(tmp, this.path);
  }
  async clear(): Promise<void> { await fs.rm(this.path, { force: true }); }
}

const SKEW = 5 * 60_000;

/** A token function for `graphTransport`: cached while fresh, refreshed (once, shared) when not. @req FR:graph-signin/cache.provider */
export function graphToken(cache: FileTokenCache, o: { fetch?: typeof fetch; now?: () => number } = {}): () => Promise<string> {
  const now = o.now ?? (() => Date.now());
  let inflight: Promise<string> | null = null;
  const refresh = async (): Promise<string> => {
    const t = await cache.read();
    if (!t) throw new GraphSignInRequired();
    if (t.accessToken && (t.expiresAt ?? 0) - now() > SKEW) return t.accessToken;
    assertSafeScopes(t.scopes);
    const r = await post({ tenant: t.tenant, clientId: t.clientId, fetch: o.fetch }, 'token', {
      grant_type: 'refresh_token', client_id: t.clientId, refresh_token: t.refreshToken, scope: t.scopes.join(' '),
    });
    if (!r.ok) { const code = errorCode(r.body); if (code === 'invalid_grant' || code === 'interaction_required') throw new GraphSignInRequired(); throw new GraphSignInError(code); }
    const g = granted({ refresh_token: t.refreshToken, ...r.body }, now());
    await cache.write({ ...t, accessToken: g.accessToken, refreshToken: g.refreshToken, expiresAt: g.expiresAt });
    return g.accessToken;
  };
  return () => {
    if (!inflight) inflight = refresh().finally(() => { inflight = null; });
    return inflight;
  };
}
