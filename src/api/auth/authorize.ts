/**
 * The api `authorize` hook (owner session or scoped token) and the token admin endpoints.
 * @req FR:auth-security/authorize.@function
 */
import { ApiError, errorResponse, json, toApiError } from '../errors';
import type { Authorize, AuthDecision, RouteInfo } from '../handler';
import { readBody, readQuery, validate } from '../validate';
import { isOwner, parseClientPrincipal, type Owner } from './session';
import { StoreConflict, TokenInputError, type TokenService, type Verified } from './tokens';

const ROUTE_SCOPE = new Map<string, string>([
  ['next', 'tasks:read'], ['tasks.list', 'tasks:read'], ['tasks.get', 'tasks:read'],
  ['tasks.add', 'tasks:write'], ['capture', 'tasks:write'], ['tasks.start', 'tasks:write'], ['tasks.complete', 'tasks:write'], ['tasks.skip', 'tasks:write'],
  ['tasks.resume', 'tasks:write'], ['tasks.suspend', 'tasks:write'], ['tasks.set', 'tasks:write'], ['tasks.edit', 'tasks:write'], ['tasks.move', 'tasks:write'], ['tasks.removeCompleted', 'tasks:write'],
  ['tasks.triage', 'tasks:write'], ['tasks.claim', 'tasks:write'], ['tasks.result', 'tasks:write'],
  ['inbox.send', 'tasks:write'], ['inbox.list', 'tasks:read'], ['inbox.handle', 'tasks:write'], ['agents.list', 'tasks:read'], ['calendar.list', 'tasks:read'], ['schedule.get', 'tasks:read'], ['schedule.day', 'tasks:write'], ['sync', 'tasks:read'],
  ['asks.list', 'tasks:read'], ['asks.put', 'tasks:write'], ['asks.answer', 'tasks:write'], ['asks.handle', 'tasks:write'],
  ['sessions.list', 'tasks:read'], ['sessions.messages', 'tasks:read'], ['sessions.cost', 'tasks:read'], ['sessions.prompt', 'tasks:write'], ['sessions.new', 'tasks:write'], ['sessions.cancel', 'tasks:write'],
  ['team.list', 'tasks:read'], ['reviews.list', 'tasks:read'], ['tasks.review', 'tasks:write'],
  ['projects.list', 'projects:read'], ['projects.get', 'projects:read'], ['projects.add', 'projects:write'],
  ['summaries.get', 'summaries:read'],
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

  /** Everything outside `/auth/tokens` goes to the api handler unchanged. @req FR:auth-security/admin.rest */
  const wrap = (api: (req: Request) => Promise<Response>) => async (req: Request): Promise<Response> => {
    let segs: string[] = [];
    try {
      const path = new URL(req.url).pathname;
      if (path.startsWith(`${base}/`)) segs = path.slice(base.length).split('/').filter(Boolean).map(decodeURIComponent);
    } catch { return api(req); }
    if (segs[0] === 'auth' && segs[1] === 'tokens') return admin(req, segs);
    return api(req);
  };

  return { authorize, wrap };
}
