/**
 * The api `authorize` hook (owner session or scoped token) and the token admin endpoints.
 * @req FR:auth-security/authorize.@function
 */
import { ApiError, errorResponse, invalid, json, toApiError } from '../errors';
import type { Authorize, AuthDecision, RouteInfo } from '../handler';
import { readBody, readQuery, validate } from '../validate';
import { DeviceError, parsePushSubscription, type DeviceService } from './devices';
import { isOwner, parseClientPrincipal, type Owner } from './session';
import { StoreConflict, TokenInputError, type TokenService, type Verified } from './tokens';

const ROUTE_SCOPE = new Map<string, string>([
  ['next', 'tasks:read'], ['tasks.list', 'tasks:read'], ['tasks.get', 'tasks:read'],
  ['tasks.add', 'tasks:write'], ['capture', 'tasks:write'], ['tasks.start', 'tasks:write'], ['tasks.complete', 'tasks:write'], ['tasks.skip', 'tasks:write'],
  ['tasks.resume', 'tasks:write'], ['tasks.suspend', 'tasks:write'], ['tasks.set', 'tasks:write'], ['tasks.edit', 'tasks:write'], ['tasks.move', 'tasks:write'], ['tasks.removeCompleted', 'tasks:write'],
  ['tasks.triage', 'tasks:write'], ['tasks.claim', 'tasks:write'], ['tasks.result', 'tasks:write'],
  ['inbox.send', 'tasks:write'], ['inbox.list', 'tasks:read'], ['inbox.handle', 'tasks:write'], ['agents.list', 'tasks:read'], ['calendar.list', 'tasks:read'], ['meetings.list', 'tasks:read'], ['schedule.get', 'tasks:read'], ['schedule.day', 'tasks:write'], ['sync', 'tasks:read'], ['sync.flush', 'tasks:write'], ['version', 'tasks:read'], ['version.mode', 'tasks:write'], ['version.restart', 'tasks:write'], ['rank', 'tasks:read'], ['needs.list', 'tasks:read'], ['needs.answer', 'tasks:write'], ['inboxItems.list', 'tasks:read'], ['inboxSources.list', 'tasks:read'], ['inboxItems.action', 'tasks:write'],
  ['asks.list', 'tasks:read'], ['brief.summary', 'tasks:read'], ['asks.put', 'tasks:write'], ['asks.answer', 'tasks:write'], ['asks.handle', 'tasks:write'], ['reports.put', 'tasks:write'], ['inventory.list', 'tasks:read'], ['pris.get', 'tasks:read'], ['pris.put', 'tasks:write'], ['feedback', 'tasks:write'],
  // @req FR:pr-priority/api.get @req FR:pr-priority/api.recommend @req FR:pr-priority/api.decisions
  ['prPriority.get', 'tasks:read'], ['prPriority.put', 'tasks:write'], ['prPriority.recommend', 'tasks:write'], ['prPriority.decisions', 'tasks:read'], ['prPriority.decide', 'tasks:write'],
  // @req FR:pr-page/api.get @req FR:pr-page/act.owner
  ['prs.get', 'tasks:read'], ['prs.queue', 'tasks:write'], ['prs.label', 'tasks:write'], ['prs.ack', 'tasks:write'], ['prs.rec', 'tasks:write'],
  ['prReview.get', 'tasks:read'], ['live.get', 'tasks:read'], ['live.item', 'tasks:write'],
  ['sessions.list', 'tasks:read'], ['sessions.messages', 'tasks:read'], ['sessions.cost', 'tasks:read'], ['sessions.prompt', 'tasks:write'], ['sessions.new', 'tasks:write'], ['sessions.cancel', 'tasks:write'],
  ['team.list', 'tasks:read'], ['reviews.list', 'tasks:read'], ['tasks.review', 'tasks:write'],
  ['inbox.reply', 'tasks:write'], ['inbox.delivery', 'tasks:read'], ['inbox.deliveryLogin', 'tasks:write'], ['tasks.thread', 'tasks:read'], ['tasks.assign', 'tasks:write'],
  ['projects.list', 'projects:read'], ['projects.get', 'projects:read'], ['projects.add', 'projects:write'],
  ['summaries.get', 'summaries:read'],
  // @req FR:iphone-access/check.@http
  ['push.check', 'tasks:write'],
]);

/** Required scope for a route name, or `null` (deny) when the route is unmapped. @req FR:auth-security/authorize.scope.table */
export const routeScope = (name: string): string | null => ROUTE_SCOPE.get(name) ?? null;

export interface AuthEvent { kind: 'allow' | 'deny'; route: string; status: number; tokenId?: string }
export interface AuthOptions {
  owners: Owner[];
  tokens: TokenService;
  /** Receives only `{ kind, route, status, tokenId? }`. */
  onEvent?: (e: AuthEvent) => void;
  basePath?: string;
  /** Enables the device endpoints (`FR:iphone-access`). */
  devices?: DeviceService;
  /** VAPID public key served to devices; never the private key. */
  vapidPublicKey?: string;
}

const DENY401: AuthDecision = { allow: false, status: 401 };
const DENY403: AuthDecision = { allow: false, status: 403 };

/** Token from `Authorization: Bearer` or `X-Stack-Token`; `null` when none was presented. */
export function presentedToken(req: Request): string | null {
  const auth = req.headers.get('authorization');
  if (auth !== null) {
    const m = /^bearer[ \t]+(.*)$/i.exec(auth.trim());
    if (m) return m[1].trim();
  }
  const x = req.headers.get('x-stack-token');
  return x === null ? null : x.trim();
}

/** @req FR:auth-security/session.csrf */
function sameOrigin(req: Request): boolean {
  const site = req.headers.get('sec-fetch-site');
  const origin = req.headers.get('origin');
  // Browsers always send Origin on writes; a write with neither signal is not a browser, so it must use a token.
  if (site === null && origin === null) return false;
  if (site !== null && site !== 'same-origin' && site !== 'none') return false;
  if (origin === null) return true;
  try {
    const host = new URL(origin).host;
    const fwd = req.headers.get('x-forwarded-host')?.split(',')[0].trim();
    return host === new URL(req.url).host || (fwd !== undefined && fwd !== '' && host === fwd);
  } catch {
    return false;
  }
}

export const scopeCovers = (scopes: string[], need: string) => scopes.includes(need) || scopes.includes(need.split(':')[1]);

/** 401 when nothing valid is presented, 403 when not allowed; events carry route, status and token id only. @req FR:auth-security/session.output @req FR:auth-security/safe.hash @req FR:auth-security/safe.tasks */
export function createAuth(opts: AuthOptions): { authorize: Authorize; wrap: (api: (req: Request) => Promise<Response>) => (req: Request) => Promise<Response> } {
  const emit = (kind: AuthEvent['kind'], route: string, status: number, tokenId?: string) => {
    try { opts.onEvent?.({ kind, route, status, ...(tokenId ? { tokenId } : {}) }); } catch { /* a broken logger never changes the decision */ }
  };
  const deny = (d: AuthDecision, route: string, tokenId?: string): AuthDecision => {
    emit('deny', route, (d as { status: number }).status, tokenId);
    return d;
  };

  /** Owner session check shared by the hook and the admin endpoints. */
  function session(req: Request, route: RouteInfo): AuthDecision {
    const p = parseClientPrincipal(req.headers.get('x-ms-client-principal'));
    if (!p) return deny(DENY401, route.name);
    if (!isOwner(p, opts.owners)) return deny(DENY403, route.name);
    if (route.write && !sameOrigin(req)) return deny(DENY403, route.name);
    emit('allow', route.name, 200);
    return { allow: true };
  }

  /** @req FR:auth-security/authorize.@function @req FR:auth-security/authorize.deny @req FR:auth-security/authorize.bearer @req FR:auth-security/authorize.bearer.invalid @req FR:auth-security/authorize.scope @req FR:auth-security/authorize.scope.deny @req FR:auth-security/authorize.session @req FR:auth-security/authorize.fail @req FR:auth-security/authorize.events */
  const authorize: Authorize = async (req, route) => {
    try {
      const token = presentedToken(req);
      if (token === null) return session(req, route);
      const v: Verified | null = await opts.tokens.verify(token);
      if (!v) return deny(DENY401, route.name);
      const need = routeScope(route.name);
      if (!need || !scopeCovers(v.scopes, need)) return deny(DENY403, route.name, v.id);
      emit('allow', route.name, 200, v.id);
      return { allow: true, token: { id: v.id, name: v.name } };
    } catch {
      return deny(DENY403, route.name);
    }
  };

  // ---------------------------------------------------------------- token admin

  const base = (opts.basePath ?? '/api').replace(/\/+$/, '');
  const ADMIN = { name: 'auth.tokens', method: '', write: false };

  /** Token admin endpoints. @req FR:auth-security/admin.@http @req FR:auth-security/admin.create @req FR:auth-security/admin.session @req FR:auth-security/admin.shape @req FR:auth-security/safe.secret */
  async function admin(req: Request, segs: string[]): Promise<Response> {
    const method = req.method.toUpperCase();
    const route: RouteInfo = { ...ADMIN, name: `auth.tokens.${segs.length === 2 ? (method === 'GET' ? 'list' : 'create') : 'revoke'}`, method, write: method !== 'GET' && method !== 'HEAD' };
    // Owner session only: a leaked token must not be able to mint or revoke tokens.
    let d: AuthDecision;
    if (presentedToken(req) !== null) d = deny(DENY403, route.name);
    else d = session(req, route);
    if (!(d as { allow: boolean }).allow) return errorResponse(new ApiError((d as { status: number }).status === 401 ? 'unauthorized' : 'forbidden', (d as { status: number }).status === 401 ? 'Authentication required' : 'Forbidden'));

    try {
      const url = new URL(req.url);
      const allowed = segs.length === 2 ? ['GET', 'POST'] : ['POST'];
      if (segs.length !== 2 && !(segs.length === 4 && segs[3] === 'revoke')) throw new ApiError('not_found', 'Not found');
      if (!allowed.includes(method)) throw new ApiError('method_not_allowed', 'Method not allowed', undefined, { allow: allowed.join(', ') });
      readQuery(url, []);
      if (segs.length === 2 && method === 'GET') return json(200, { items: await opts.tokens.list() });
      const body = await readBody(req);
      if (segs.length === 4) {
        validate(body, {});
        const result = await opts.tokens.revoke(segs[2]);
        if (result === 'not_found') throw new ApiError('not_found', 'Token not found');
        return json(200, { id: segs[2], result });
      }
      const b = validate<{ name: string; scopes: string[]; days?: number }>(body, {
        name: { t: 'str', required: true, max: 80, line: true }, scopes: { t: 'strs', max: 20 }, days: { t: 'int', min: 1, max: 365 },
      }, ['name', 'scopes']);
      return json(201, await opts.tokens.create(b));
    } catch (e) {
      if (e instanceof TokenInputError) {
        return errorResponse(e.kind === 'limit' ? new ApiError('conflict', 'Too many active tokens') : new ApiError('invalid', 'Validation failed', [{ field: 'scopes', message: 'Must be known, unique scopes' }]));
      }
      if (e instanceof StoreConflict) return errorResponse(new ApiError('conflict', 'Conflict'));
      return errorResponse(toApiError(e));
    }
  }

  // ---------------------------------------------------------------- devices

  const NO_STORE = { 'cache-control': 'no-store' };
  const statusOf = (d: AuthDecision) => (d as { status: number }).status;
  const denyResponse = (status: number) => errorResponse(new ApiError(status === 401 ? 'unauthorized' : 'forbidden', status === 401 ? 'Authentication required' : 'Forbidden'));
  const VAPID = /^[A-Za-z0-9_-]{1,200}$/;

  /** Owner-session device endpoints. @req FR:iphone-access/device.session */
  async function deviceAdmin(req: Request, segs: string[], devices: DeviceService): Promise<Response> {
    const method = req.method.toUpperCase();
    const route: RouteInfo = { name: `auth.devices.${segs.length === 2 ? (method === 'GET' ? 'list' : 'create') : 'revoke'}`, method, write: method !== 'GET' && method !== 'HEAD' };
    const d = presentedToken(req) !== null ? deny(DENY403, route.name) : session(req, route);
    if (!(d as { allow: boolean }).allow) return denyResponse((d as { status: number }).status);
    try {
      const allowed = segs.length === 2 ? ['GET', 'POST'] : ['POST'];
      if (segs.length !== 2 && !(segs.length === 4 && segs[3] === 'revoke')) throw new ApiError('not_found', 'Not found');
      if (!allowed.includes(method)) throw new ApiError('method_not_allowed', 'Method not allowed', undefined, { allow: allowed.join(', ') });
      readQuery(new URL(req.url), []);
      if (method === 'GET') return json(200, { items: await devices.list() });
      const body = await readBody(req);
      if (segs.length === 4) {
        validate(body, {});
        const result = await devices.revoke(segs[2]);
        if (result === 'not_found') throw new ApiError('not_found', 'Device not found');
        return json(200, { id: segs[2], result });
      }
      const b = validate<{ name: string }>(body, { name: { t: 'str', required: true, max: 80, line: true } }, ['name']);
      return json(201, await devices.create(b.name));
    } catch (e) {
      if (e instanceof DeviceError) return errorResponse(e.kind === 'limit' ? new ApiError('conflict', 'Too many active devices') : invalid([{ field: 'name', message: 'Invalid device name' }]));
      if (e instanceof StoreConflict) return errorResponse(new ApiError('conflict', 'Conflict'));
      return errorResponse(toApiError(e));
    }
  }

  /** Device-token endpoints under `/auth/devices/me`. @req FR:iphone-access/sub.auth @req FR:iphone-access/sub.put @req FR:iphone-access/sub.delete @req FR:iphone-access/sub.key */
  async function deviceSelf(req: Request, segs: string[], devices: DeviceService): Promise<Response> {
    const method = req.method.toUpperCase();
    const name = `auth.devices.me.${segs[3]}`;
    try {
      const token = presentedToken(req);
      if (token === null) return denyResponse(statusOf(deny(parseClientPrincipal(req.headers.get('x-ms-client-principal')) ? DENY403 : DENY401, name)));
      const v = await opts.tokens.verify(token);
      if (!v) return denyResponse(statusOf(deny(DENY401, name)));
      const dev = await devices.byTokenId(v.id);
      if (!dev) return denyResponse(statusOf(deny(DENY403, name, v.id)));
      const allowed = segs[3] === 'push' ? ['PUT', 'DELETE'] : segs[3] === 'push-key' ? ['GET'] : null;
      if (!allowed || segs.length !== 4) throw new ApiError('not_found', 'Not found');
      if (!allowed.includes(method)) throw new ApiError('method_not_allowed', 'Method not allowed', undefined, { allow: allowed.join(', ') });
      readQuery(new URL(req.url), []);
      emit('allow', name, 200, v.id);
      if (method === 'GET') {
        if (!opts.vapidPublicKey || !VAPID.test(opts.vapidPublicKey)) throw new ApiError('not_found', 'Push is not configured');
        return json(200, { key: opts.vapidPublicKey });
      }
      if (method === 'DELETE') {
        await devices.setPush(dev.id, null);
        return new Response(null, { status: 204, headers: NO_STORE });
      }
      const sub = parsePushSubscription(await readBody(req));
      if (!sub) throw invalid([{ field: 'endpoint', message: 'Must be a push service https endpoint with p256dh and auth keys' }]);
      await devices.setPush(dev.id, sub);
      return json(200, { id: dev.id, push: true });
    } catch (e) {
      if (e instanceof StoreConflict) return errorResponse(new ApiError('conflict', 'Conflict'));
      return errorResponse(toApiError(e));
    }
  }

  /** Everything outside `/auth/tokens` and `/auth/devices` goes to the api handler unchanged. @req FR:auth-security/admin.rest */
  const wrap = (api: (req: Request) => Promise<Response>) => async (req: Request): Promise<Response> => {
    let segs: string[] = [];
    try {
      const path = new URL(req.url).pathname;
      if (path.startsWith(`${base}/`)) segs = path.slice(base.length).split('/').filter(Boolean).map(decodeURIComponent);
    } catch { return api(req); }
    if (segs[0] === 'auth' && segs[1] === 'tokens') return admin(req, segs);
    if (segs[0] === 'auth' && segs[1] === 'devices' && opts.devices) return segs[2] === 'me' ? deviceSelf(req, segs, opts.devices) : deviceAdmin(req, segs, opts.devices);
    return api(req);
  };

  return { authorize, wrap };
}
