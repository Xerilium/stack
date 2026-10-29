/**
 * Host wiring: settings -> storage, tokens, auth, API, MCP, bots, and the /api router.
 * @req FR:azure-host/routes.map @req FR:azure-host/routes.errors @req FR:azure-host/health.shape
 * @req FR:azure-host/git.lazy @req FR:azure-host/auth.api @req FR:azure-host/auth.mcp @req FR:azure-host/auth.bots @req FR:azure-host/auth.logs @req FR:azure-host/routes.paths
 */
import { apiClient, createBotHandler } from '../bots';
import { createApiHandler, createAuth, createGitHubPrs, createTokenService, FileTokenStore, type Authorize, type TokenStore } from '../api';
import { createMcpHandler } from '../mcp';
import { createIcsCalendar, IcsError, icsUrls } from '../calendar/ics';
import type { CalendarProvider } from '../calendar';
import { writeAll, type FileWrite, type Storage } from '../core/storage';
import { openGitStorage, type GitDeps } from './git-repo';
import { GitHubStorage, parseGitHubRepo } from './github-storage';
import { GitTokenStore, needAux, type HostStorage } from './token-store';
import { parseSettings, SettingsError, type Env, type HostSettings } from './settings';

export interface HostDeps {
  /** Opens task storage; default clones the configured repo. */
  openStorage?: (s: HostSettings) => Promise<Storage>;
  tokenStore?: TokenStore;
  /** Receives event fields and error class names only. */
  log?: (line: string) => void;
  /** Clock for the open-failure cooldown. */
  now?: () => number;
  /** After a failed open, later calls fail fast for this long. Default 30000. */
  cooldownMs?: number;
  /** fetch for the GitHub API adapter (tests). */
  fetch?: typeof fetch;
  /** GitHub adapter: minimum ms between ref checks. Default 5000. */
  freshMs?: number;
}

/**
 * github.com repos use the REST adapter (no git binary, no clone); any other host is cloned with git.
 * @req FR:live-deploy/gh.select
 */
export async function openRepoStorage(s: HostSettings, deps: GitDeps & { fetch?: typeof fetch; freshMs?: number } = {}): Promise<Storage> {
  const gh = parseGitHubRepo(s.repoUrl);
  if (!gh) return openGitStorage(s, deps);
  const storage = new GitHubStorage({ ...gh, branch: s.branch, token: s.repoToken, path: s.path, fetch: deps.fetch, freshMs: deps.freshMs, author: { name: s.gitName, email: s.gitEmail } });
  // Fail on open (bad token, missing repo) so the cooldown applies instead of failing every read.
  await storage.sync();
  return storage;
}

const BOT_ROUTES = new Set(['next', 'tasks.add', 'tasks.start', 'tasks.complete', 'tasks.skip']);
/** In-process gate for bots: the five command routes and nothing else. @req FR:azure-host/auth.bots */
export const botGate: Authorize = (_req, route) => BOT_ROUTES.has(route.name);

const reply = (status: number, body: unknown, extra: Record<string, string> = {}) => new Response(
  body === null ? null : JSON.stringify(body),
  { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra } });
const fail = (status: number, code: string, message: string, extra: Record<string, string> = {}) => reply(status, { error: { code, message } }, extra);
const notFound = () => fail(404, 'not_found', 'Not found');

/** Opens storage on first use only; concurrent callers share one open; a failure is not cached. @req FR:azure-host/git.lazy @req FR:azure-host/git.clone @req FR:azure-host/git.timeout */
function lazyStorage(open: () => Promise<Storage>, now: () => number, cooldownMs: number): HostStorage {
  let p: Promise<Storage> | null = null;
  let failed: { at: number; err: unknown } | null = null;
  const get = () => {
    if (failed && now() - failed.at < cooldownMs) return Promise.reject(failed.err);
    if (!p) { p = open(); p.then(() => { failed = null; }, (err) => { p = null; failed = { at: now(), err }; }); }
    return p;
  };
  return {
    list: async () => (await get()).list(),
    read: async (path) => (await get()).read(path),
    write: async (path, content, opts) => (await get()).write(path, content, opts),
    writeMany: async (writes: FileWrite[], opts) => writeAll(await get(), writes, opts?.message),
    readAux: async (path) => needAux(await get()).readAux(path),
    writeAux: async (path, content, opts) => needAux(await get()).writeAux(path, content, opts),
    sync: async () => { const s = (await get()) as { sync?: () => Promise<void> }; if (s.sync) await s.sync(); },
    rev: async () => { const s = (await get()) as { rev?: () => Promise<string> }; return s.rev ? s.rev() : null; },
  };
}

const className = (e: unknown) => (e instanceof Error ? e.constructor.name : 'Error');
const pathOf = (req: Request) => new URL(req.url).pathname.replace(/\/+$/, '');
const inApi = (req: Request) => { const p = pathOf(req); return p === '/api' || p.startsWith('/api/'); };

/** Providers may append a slash to webhook URLs: dispatch on the canonical path. @req FR:azure-host/routes.paths */
async function stripSlash(req: Request, path: string): Promise<Request> {
  const u = new URL(req.url);
  if (u.pathname === path) return req;
  u.pathname = path;
  const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
  return new Request(u, { method: req.method, headers: req.headers, body: hasBody ? await req.arrayBuffer() : undefined });
}

/** @req FR:azure-host/health.shape */
function health(req: Request, degraded: boolean): Response | null {
  if (pathOf(req) !== '/api/health') return null;
  const m = req.method.toUpperCase();
  if (m !== 'GET' && m !== 'HEAD') return fail(405, 'method_not_allowed', 'Method not allowed', { allow: 'GET, HEAD' });
  return reply(200, m === 'HEAD' ? null : { status: degraded ? 'degraded' : 'ok' });
}

export function createHost(env: Env, deps: HostDeps = {}): (req: Request) => Promise<Response> {
  const log = (line: string) => { try { deps.log?.(line); } catch { /* logging never changes a result */ } };
  let s: HostSettings;
  try { s = parseSettings(env); } catch (e) {
    // Names only; SettingsError never holds values.
    log(e instanceof SettingsError ? `host: ${e.message}` : `host: ${className(e)}`);
    return async (req) => health(req, true) ?? (inApi(req) ? fail(503, 'unavailable', 'Service unavailable') : notFound());
  }

  const settings = s;
  const onName = (n: string) => log(`error: ${n}`);
  const storage = lazyStorage(() => (deps.openStorage ?? ((x) => openRepoStorage(x, { fetch: deps.fetch, freshMs: deps.freshMs })))(settings), deps.now ?? Date.now, deps.cooldownMs ?? 30_000);
  const tokens = createTokenService({ store: deps.tokenStore ?? (settings.tokenStore ? new FileTokenStore(settings.tokenStore) : new GitTokenStore(async () => storage, { onError: onName })), pepper: settings.pepper });
  const event = (e: object) => log(JSON.stringify(e));
  const onError = (e: unknown) => log(`error: ${className(e)}`);
  const auth = createAuth({ owners: settings.owners, tokens, onEvent: event });
  // @req FR:agent-inbox/github.wire
  const ghToken = env.GITHUB_TOKEN?.trim();
  const prs = ghToken ? createGitHubPrs({ token: ghToken }) : undefined;
  // @req FR:schedule/ics.wire: the feed URLs are secrets; a bad value logs a URL-free reason and leaves the calendar off.
  let calendar: CalendarProvider | undefined;
  try { const urls = icsUrls(env.STACK_CALENDAR_ICS); calendar = urls.length ? createIcsCalendar({ urls }) : undefined; } catch (e) { log(`host: STACK_CALENDAR_ICS ${e instanceof IcsError ? e.message : className(e)}`); }
  const api = auth.wrap(createApiHandler({ storage, config: settings.config, authorize: auth.authorize, onError, prs, calendar }));
  const mcp = createMcpHandler({ api, tokens, basePath: '/api/mcp', onEvent: event, onError: onName });
  const botApi = createApiHandler({ storage, config: settings.config, authorize: botGate, onError });
  const bots = createBotHandler({
    client: apiClient(botApi, {}, '/api'), basePath: '/api/bots', onError: onName,
    slack: settings.bots.slack, imessage: settings.bots.imessage, webhook: settings.bots.webhook, github: settings.bots.github,
  });

  return async (req) => {
    try {
      const h = health(req, false);
      if (h) return h;
      const path = pathOf(req);
      if (path === '/api/mcp') return await mcp(req);
      if (path.startsWith('/api/bots/')) return await bots(await stripSlash(req, path));
      if (inApi(req)) return await api(req);
      return notFound();
    } catch (e) {
      onError(e);
      return fail(500, 'internal', 'Internal error');
    }
  };
}
