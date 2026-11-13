/**
 * `stack web`: serves the web app and the api on localhost over a task repo (loopback only, no sign-in).
 * @req FR:cli/web.serve @req FR:cli/web.demo
 */
import { createHash } from 'crypto';
import { ReportStore, stackHome } from '../core/reports';
import { runInventory, type Inventory } from '../core/session-inventory';
import { scanAgents } from '../core/agent-scan';
import { projectRepos } from '../core/repos';
import { homedir } from 'os';
import { PriStore } from '../core/pris';
import { PrPriorityStore } from '../core/pr-priority';
import { FeedbackStore } from '../core/feedback';
import { LiveStore } from '../core/live-lane';
import { BriefStore, FactsStore } from '../core/pr-review';
import { execFileSync } from 'child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'fs';
import { createServer, type IncomingMessage, type Server } from 'http';
import { dirname, extname, join, normalize, relative, resolve, sep } from 'path';
import { createApiHandler } from '../api/handler';
import type { AppUpdater } from '../core/app-update';
import { createClaudeJson } from '../email/llm';
import { createGitHubPrs, githubRepos } from '../api/github';
import { createLazyPrPage, createPrPage } from '../api/pr-page';
import { createGitHubAuth, type GitHubAuth } from '../api/github-auth';
import type { PrStatusProvider } from '../core/activity';
import { storePrQueue } from '../api/pr-queue';
import { fixtureCalendar, type CalendarEvent, type CalendarProvider } from '../calendar';
import { createIcsCalendar, icsUrls } from '../calendar/ics';
import { cachePathsWith, defaultCachePath, FileTokenCache, hasScope } from '../graph/auth';
import { AccountHealth, createConnect, readClientId, type Connect } from '../graph/connect';
import { createAccountsCalendar } from '../calendar/accounts';
import { cachedProbe } from '../inbox/probe';
import type { SourceProbe } from '../inbox/sources';
import { getDefaults, parseConfig } from '../core/config';
import type { Storage } from '../core/storage';
import { GitStorage } from '../core/storage-git';
import { ALL_KINDS, watchRepo, type WatchOptions } from './watch';
import { createRunManager, createSdkDriver, type AgentRuns } from '../agents';
import { serveSetup, withSetupMeta, type SetupHandler } from './setup';
import { deliverySettings, deliveryStatus, DeliveryStore, startDeliveryLoop, startLogin, type DeliveryDeps } from '../agents/delivery';

const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, stdio: 'pipe', encoding: 'utf8' });

/**
 * Copies the content repo's `tasks/` into `dest` as a fresh git repo (no history, no remote). Keeps earlier edits unless `reset`.
 * The real repo is only read, never written.
 * @req FR:cli/web.demo.untouched @req FR:cli/web.demo.reset
 */
export function prepareDemo(repo: string, dest: string, reset = false): void {
  const source = join(repo, 'tasks');
  if (!existsSync(source)) throw new Error(`${source} not found (expected a content repo with a tasks/ folder)`);
  const marker = join(dest, '.stack-source');
  // @req FR:cli/web.demo.reset
  if (existsSync(join(dest, '.git')) && !reset && existsSync(marker) && readFileSync(marker, 'utf8') === resolve(repo)) return;
  const inside = (a: string, b: string) => { const r = relative(realpathSync(a), existsSync(b) ? realpathSync(b) : resolve(b)); return r === '' || (!r.startsWith('..') && !r.includes(':')); };
  if (inside(source, dest) || (existsSync(dest) && inside(dest, source))) throw new Error(`Demo source and copy overlap: ${source} / ${dest}`);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const cfg = join(repo, '.xe/config/stack.json');
  cpSync(source, join(dest, 'tasks'), { recursive: true, dereference: true, filter: (p) => !p.split(sep).includes('.git') });
  // The team reads Claude's agent definitions too; the copy carries them so the demo shows the real team. @req FR:agent-team/agent.path.claude
  const claudeAgents = join(repo, '.claude/agents');
  if (existsSync(claudeAgents)) cpSync(claudeAgents, join(dest, '.claude/agents'), { recursive: true, dereference: true, filter: (p) => !p.split(sep).includes('.git') });
  mkdirSync(join(dest, '.xe/config'), { recursive: true });
  writeFileSync(join(dest, '.xe/config/stack.json'), existsSync(cfg) ? readFileSync(cfg) : '{}\n');
  writeFileSync(marker, resolve(repo));
  git(dest, 'init', '-q', '-b', 'main');
  writeFileSync(join(dest, '.git/info/exclude'), '.stack-source\n', { flag: 'a' });
  git(dest, '-c', 'user.name=Stack', '-c', 'user.email=stack@localhost', 'add', '-A');
  git(dest, '-c', 'user.name=Stack', '-c', 'user.email=stack@localhost', 'commit', '-q', '-m', 'Stack demo copy');
}

/** What the UI header shows at all times. */
export interface RepoInfo { mode: 'demo' | 'live'; repo: string; branch: string }
export interface WebOpts {
  dir: string; port: number; webDir: string; label?: string; info?: RepoInfo; watch?: { debounceMs?: number; heartbeatMs?: number; onRaw?: (file: string) => void; watchFn?: WatchOptions['watchFn'] };
  /** First-run setup routes (`/setup`) on a local host. @req FR:first-run-onboarding/host.live */
  setup?: SetupHandler;
  /** A published calendar link from the user config; `STACK_CALENDAR_ICS` wins. @req FR:first-run-onboarding/step.calendar */
  ics?: string;
  /** The task storage; default a direct-commit `GitStorage` on `dir`. A storage with `close()` (batched live mode) is closed, and so flushed, on shutdown. @req FR:cli/web.batch */
  storage?: Storage & { close?(): Promise<void> };
  /** Agent runs for the sessions routes; omitted means the Claude Agent SDK driver, `false` means none (the routes are 404). @req FR:agent-sessions/driver.interface */
  agents?: AgentRuns | false;
  /** Opens a URL in the system browser for Connect; default the OS opener. The desktop shell passes `shell.openExternal`. @req FR:connect-accounts/flow.browser */
  openUrl?: (url: string) => Promise<void>;
  /** In-app Connect; default the local service; `false` means none. @req FR:connect-accounts/api.get */
  connect?: Connect | false;
  /** The GitHub token source; default `GITHUB_TOKEN`, then the `gh` sign-in. @req FR:pr-page/auth.token */
  githubAuth?: GitHubAuth;
  /** Agent delivery: overrides for tests (runner, home); `false` turns it off. Always off in demo mode (`info.mode`). The loop runs only when `inbox.delivery` is `claude`. @req FR:agent-delivery/host.loop */
  delivery?: Partial<Pick<DeliveryDeps, 'run' | 'isRepo' | 'store'>> & { intervalMs?: number; login?: () => Promise<{ started: boolean; step?: string }> | { started: boolean; step?: string } } | false;
  /** This machine's inbox sign-ins for `GET /inbox-sources`; default the cached local probe. @req FR:inbox-page/api.sources */
  inboxProbe?: (o?: { fresh: true }) => Promise<SourceProbe>;
  /** The live report store; default `~/.stack` (or `STACK_HOME`). @req FR:status-ingest/api.put */
  reports?: ReportStore;
  /** The session inventory; default reads the Claude app store into `~/.stack`; `false` means none (demo). @req FR:session-inventory/api.inventory */
  inventory?: (() => Inventory) | false;
  /** The priorities store; default `~/.stack/pris.json`. @req FR:session-inventory/api.pris.get */
  pris?: PriStore;
  /** The PR priority store; default `~/.stack/pr-priority.json`. @req FR:pr-priority/api.get */
  prPriority?: PrPriorityStore;
  /** The desktop installer for `/api/version`; absent (plain `stack web`) means 404. @req FR:devops-installer/version.get */
  app?: AppUpdater;
  /** Home of the live lane, briefs and PR facts; default `~/.stack`. @req FR:pr-review-lane/lane.api */
  laneHome?: string;
  /** The owner feedback store; default `~/.stack/feedback.jsonl` (or `STACK_HOME`), in demo mode too. @req FR:feedback-button/store.path */
  feedback?: FeedbackStore;
}

/** A git url is cloned once into `cacheDir`; a path is used as is. */
export function resolveRepo(spec: string, cacheDir: string): string {
  if (!/^(https?:\/\/|ssh:\/\/|file:\/\/|git@)/.test(spec)) return resolve(spec);
  const dest = join(cacheDir, createHash('sha1').update(spec).digest('hex').slice(0, 12));
  if (!existsSync(join(dest, '.git'))) { mkdirSync(cacheDir, { recursive: true }); git(cacheDir, 'clone', '-q', '--', spec, dest); }
  return dest;
}

/** Repo spec for display: credentials in a url are dropped. */
export const redact = (spec: string): string => spec.replace(/\/\/[^/@]*@/, '//');

/**
 * LIVE: the owner's own checkout on the branch it has checked out (`main` included); the files are the source of truth.
 * `branch` only asserts which branch must be checked out; `remote` (user config) wins over an `origin` found in the repo.
 * @req FR:cli/web.live @req FR:cli/web.live.branch @req FR:cli/web.live.refuse @req FR:cli/web.live.remote
 */
export function prepareLive(repo: string, branch?: string, remote?: string): { dir: string; branch: string; remote: string | undefined } {
  try { git(repo, 'rev-parse', '--git-dir'); } catch { throw new Error(`${repo} is not a git repo`); }
  let current = '';
  try { current = git(repo, 'symbolic-ref', '--short', '-q', 'HEAD').trim(); } catch { /* detached */ }
  if (!current) throw new Error(`${repo} has a detached HEAD; check out a branch first`);
  if (branch && branch !== current) throw new Error(`Branch ${branch} is not checked out in ${repo} (current branch: ${current})`);
  if (!existsSync(join(repo, 'tasks'))) throw new Error(`${repo}/tasks not found (expected a content repo with a tasks/ folder)`);
  let r = remote;
  if (r) { try { git(repo, 'remote', 'get-url', r); } catch { throw new Error(`Remote ${r} (user config "remote") not found in ${repo}`); } }
  else { try { git(repo, 'remote', 'get-url', 'origin'); r = 'origin'; } catch { r = undefined; } }
  return { dir: repo, branch: current, remote: r };
}

/** The live-mode startup line: where edits go and when they commit. @req FR:cli/web.batch.startup */
export function liveLine(repo: string, branch: string, minutes: number, remote?: string): string {
  const when = minutes === 0 ? 'committed on every edit' : `committed after ${minutes} min idle`;
  return `LIVE MODE: edits land in ${repo}/tasks on ${branch}; ${when}${remote ? `, then pushed to ${remote}` : ''}`;
}
export interface WebServer { url: string; close(): Promise<void> }

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};

function headersFrom(webDir: string): Record<string, string> {
  try { return (JSON.parse(readFileSync(join(webDir, 'staticwebapp.config.json'), 'utf8')) as { globalHeaders?: Record<string, string> }).globalHeaders ?? {}; } catch { return {}; }
}

async function toRequest(req: IncomingMessage, origin: string): Promise<Request> {
  const method = req.method ?? 'GET';
  const chunks: Buffer[] = [];
  if (method !== 'GET' && method !== 'HEAD') { let n = 0; for await (const c of req) { n += (c as Buffer).length; if (n > 1_000_000) throw new Error('body too large'); chunks.push(c as Buffer); } }
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  // The one local user is the owner (loopback only); the api gates agent writes on this marker.
  headers.set('x-ms-client-principal', Buffer.from(JSON.stringify({ identityProvider: 'local', userId: 'local', userDetails: 'local', userRoles: ['authenticated'] })).toString('base64'));
  return new Request(origin + (req.url ?? '/'), { method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
}

/** Demo calendar from a JSON file of events; there is no live calendar until owner sign-in exists. @req FR:day-inputs/api.wire */
export function calendarFixture(path: string | undefined = process.env.STACK_CALENDAR_FIXTURE): ReturnType<typeof fixtureCalendar> | undefined {
  if (!path) return undefined;
  const list = JSON.parse(readFileSync(path, 'utf8')) as CalendarEvent[];
  if (!Array.isArray(list)) throw new Error('STACK_CALENDAR_FIXTURE must be a JSON array of events');
  return fixtureCalendar(list);
}

/** Published calendar feeds (`STACK_CALENDAR_ICS`, separated by whitespace or commas); the URLs are secrets and never logged. @req FR:schedule/ics.wire */
export function icsCalendar(env = process.env.STACK_CALENDAR_ICS): CalendarProvider | undefined {
  const urls = icsUrls(env);
  return urls.length ? createIcsCalendar({ urls }) : undefined;
}

/**
 * Where Today's meetings come from: a fixture file wins; else the live accounts calendar over every Graph sign-in with Calendars.Read
 * (read at each request, so an account connected later shows at once), with published ICS feeds as its fallback.
 * `source` names what is there at start, for the log line. Never logs a token or a feed URL.
 * @req FR:graph-signin/web.calendar @req FR:schedule/ics.wire @req FR:connect-accounts/cal.live @req FR:connect-accounts/cal.fallback
 */
export async function calendarSource(o: { cachePath?: string; fixture?: string; ics?: string; log?: (line: string) => void; health?: AccountHealth } = {}): Promise<{ source: 'fixture' | 'graph' | 'ics' | 'none'; provider?: CalendarProvider }> {
  const fx = calendarFixture(o.fixture);
  if (fx) { o.log?.('calendar: fixture'); return { source: 'fixture', provider: fx }; }
  const dir = dirname(o.cachePath ?? defaultCachePath());
  const ics = icsCalendar(o.ics);
  const provider = createAccountsCalendar({ dir, ...(o.cachePath ? { cachePath: o.cachePath } : {}), ...(ics ? { fallback: ics } : {}), ...(o.health ? { health: o.health } : {}) });
  // A broken token file must not hide the ICS feeds: it is skipped.
  let graph = false;
  for (const p of cachePathsWith(dir, o.cachePath)) { const t = await new FileTokenCache(p).read().catch(() => null); if (t && hasScope(t.scopes, 'Calendars.Read')) { graph = true; break; } }
  const source = graph ? 'graph' : ics ? 'ics' : 'none';
  o.log?.(graph ? 'calendar: Graph' : ics ? 'calendar: ICS feeds' : 'calendar: none yet');
  return { source, provider };
}

export async function startWeb(o: WebOpts): Promise<WebServer> {
  const cfgPath = join(o.dir, '.xe/config/stack.json');
  const config = existsSync(cfgPath) ? parseConfig(JSON.parse(readFileSync(cfgPath, 'utf8').replace(/^﻿/, ''))) : getDefaults();
  // @req FR:github-pr-status/wire.token @req FR:github-pr-status/repos.invalid @req FR:pr-page/auth.token: the token is GITHUB_TOKEN, else the gh sign-in,
  // read when needed, so a Dock-launched app (no shell environment) and a later sign-in both work. A bad repo list leaves PR status off.
  const ghAuth = o.githubAuth ?? createGitHubAuth({ env: process.env });
  let ghRepos: string[] | undefined;
  let reposOk = true;
  try { ghRepos = githubRepos(process.env.STACK_GITHUB_REPOS); } catch (e) { reposOk = false; console.error(`github: STACK_GITHUB_REPOS ${e instanceof Error ? e.message : 'is invalid'}; PR status off`); }
  let prsFor: { token: string; p: PrStatusProvider } | null = null;
  const prs: PrStatusProvider | undefined = reposOk ? async (refs) => {
    const t = await ghAuth.token();
    if (!t) return new Map();
    if (prsFor?.token !== t) prsFor = { token: t, p: createGitHubPrs({ token: t, repos: ghRepos }) };
    return prsFor.p(refs);
  } : undefined;
  // Marks from live reads (expired, error), shared by the calendar, Connect and the inbox probe. @req FR:connect-accounts/acct.health
  const health = new AccountHealth();
  const cal = await calendarSource({ cachePath: process.env.STACK_GRAPH_CACHE, fixture: process.env.STACK_CALENDAR_FIXTURE, ics: process.env.STACK_CALENDAR_ICS || o.ics, log: (l) => console.log(l), health }).catch((e: unknown) => { console.error(`calendar: unavailable (${e instanceof Error ? e.message : 'error'})`); return { source: 'none' as const, provider: undefined }; });
  const storage: Storage & { close?(): Promise<void>; onPending?(fn: (n: number) => void): () => void } = o.storage ?? new GitStorage(o.dir);
  /** Open event streams; a batched storage tells them when its pending count changes (an idle flush leaves no file change for the watcher to see). @req FR:live-deploy/web.unsaved.refresh */
  const sinks = new Set<(event: string, data: unknown) => void>();
  const offPending = storage.onPending?.(() => { for (const f of sinks) f('change', { rev: watcher.rev(), kinds: ['sync'] }); });
  // @req FR:agent-sessions/driver.sdk (the SDK and its binary load on the first sessions request, not here)
  const agents: AgentRuns | undefined = o.agents === false ? undefined : o.agents ?? createRunManager({ driver: createSdkDriver(), ctx: { storage, config }, cwd: o.dir });
  const reports = o.reports ?? new ReportStore(stackHome());
  // reports.json is outside the watched repo: a report write tells open pages to refresh (Needs you reloads on `tasks`).
  // @req FR:status-ingest/store.live
  const offReports = reports.onWrite(() => { for (const f of sinks) f('change', { rev: watcher.rev(), kinds: ['tasks'] }); });
  const inventory = o.inventory === false ? undefined : o.inventory ?? (() => runInventory({ home: stackHome() }));
  // The whole team: agents in every repo under the scan roots and at user level (not in the demo). @req FR:agent-team/agent.team.scan
  // One scan serves every /team read for 15 s (files are mtime-cached too); a failed scan is logged, never fatal.
  let scanned: { at: number; p: ReturnType<typeof scanAgents> } | undefined;
  const agentScan = o.inventory === false ? undefined : () => {
    if (!scanned || Date.now() - scanned.at > 15_000) scanned = { at: Date.now(), p: projectRepos({ storage }).then((repos) => scanAgents({ home: homedir(), roots: config.agents?.scanRoots, skip: [o.dir], repos })).catch((e: unknown) => { console.error(`agents: scan failed (${e instanceof Error ? e.message : 'error'})`); scanned = undefined; return []; }) };
    return scanned.p;
  };
  const pris = o.pris ?? new PriStore(stackHome());
  // pris.json is outside the repo too: a write tells open pages to re-read it. @req FR:pris-sessions-ui/live.event
  const offPris = pris.onWrite(() => { for (const f of sinks) f('change', { rev: watcher.rev(), kinds: ['pris'] }); });
  const prPriority = o.prPriority ?? new PrPriorityStore(stackHome());
  const feedback = o.feedback ?? new FeedbackStore(stackHome(), { app: appInfo() });
  // The queue and recommendations change from the CLI too (agents): a write tells open pages to reload Needs you and the PR page.
  const tellPr = () => { for (const f of sinks) f('change', { rev: watcher.rev(), kinds: ['tasks', 'pr-priority'] }); };
  // The file poll also sees this host's own writes: skip a file whose mtime is the one this host wrote, so a page gets one event per write.
  const own = new Map<string, number>();
  const mtime = (f: string) => { try { return statSync(f).mtimeMs; } catch { return 0; } };
  const offPrPri = prPriority.onWrite(() => { for (const f of [prPriority.file, prPriority.stateFile]) own.set(f, mtime(f)); tellPr(); });
  const unwatchPrPri = prPriority.watch((f, m) => { if (own.get(f) !== m) tellPr(); });
  // The PR page polls GitHub only while a page holds a lease; a changed board tells open pages. @req FR:pr-page/live.event
  // Built on the first read that finds a token; signed out, GET /prs answers the sign-in state. @req FR:pr-page/auth.state
  const prQueue = storePrQueue(prPriority);
  const prPage: ReturnType<typeof createLazyPrPage> | undefined = reposOk ? createLazyPrPage({ auth: ghAuth, queue: prQueue, make: (token) => createPrPage({ token, repos: ghRepos, config, home: stackHome(), inventory, queue: prQueue, adminOrgs: true, live: () => live.view(), onChange: () => { for (const f of sinks) f('change', { rev: watcher.rev(), kinds: ['prs'] }); } }) }) : undefined;
  // The live lane, briefs and PR facts live outside the repo too; a lane write tells open pages (`tasks` reloads Needs you for blocked checks). @req FR:pr-review-lane/lane.api
  const laneHome = o.laneHome ?? stackHome();
  const live = new LiveStore(laneHome);
  const offLive = live.onWrite(() => { for (const f of sinks) f('change', { rev: watcher.rev(), kinds: ['tasks', 'live'] }); });
  // @req FR:connect-accounts/flow.browser
  const connect = o.connect === false ? undefined : o.connect ?? createConnect({ clientId: () => readClientId(), health, ...(o.openUrl ? { openUrl: o.openUrl } : {}) });
  // @req FR:agent-delivery/host.loop @req FR:agent-delivery/state.api: state is always readable here; the loop starts only when the config opts in.
  // A demo copy never runs agents on copied messages or writes the live delivery state.
  const dd: DeliveryDeps | undefined = o.delivery === false || o.info?.mode === 'demo' ? undefined : { ctx: { storage, config }, settings: deliverySettings(config, o.dir), store: o.delivery?.store ?? new DeliveryStore(stackHome()), repoDir: o.dir, ...(o.delivery?.run ? { run: o.delivery.run } : {}), ...(o.delivery?.isRepo ? { isRepo: o.delivery.isRepo } : {}) };
  const deliveryLoop = dd && dd.settings.mode === 'claude' ? startDeliveryLoop(dd, { intervalMs: o.delivery ? o.delivery.intervalMs : undefined, onError: (e) => console.error(`delivery: ${e instanceof Error ? e.message : 'error'}`) }) : undefined;
  const delivery = dd ? { status: (ref: string) => deliveryStatus(dd, ref, inventory), summary: () => ({ mode: dd.settings.mode, login: dd.store.read().login.state }), login: () => (o.delivery && o.delivery.login ? o.delivery.login() : startLogin()) } : undefined;
  const api = createApiHandler({ storage, config, reports, inventory, agentScan, delivery, pris, prPriority, feedback, ...(prPage ?? {}), live, briefs: new BriefStore(laneHome), facts: new FactsStore(laneHome), authorize: () => true, onError: (e) => console.error(e), prs, calendar: cal.provider, agents, brief: createClaudeJson(), inboxProbe: o.inboxProbe ?? cachedProbe({ health }), ...(o.app ? { app: o.app } : {}), ...(connect ? { connect } : {}) });
  const extra = headersFrom(o.webDir);
  // @req FR:ask-queue/live.watch
  const watcher = watchRepo(o.dir, { debounceMs: o.watch?.debounceMs, onRaw: o.watch?.onRaw, watchFn: o.watch?.watchFn });
  // A new message is a task file change (tasks/inbox): deliver it now instead of at the next tick.
  const offDelivery = deliveryLoop ? watcher.on((c) => { if (c.kinds.includes('tasks')) deliveryLoop.kick(); }) : undefined;
  const beat = o.watch?.heartbeatMs ?? 20_000;
  const who = o.label ?? 'local';
  let port = o.port;
  /** @req FR:cli/web.serve.loopback */
  const hostOk = (h?: string) => !!h && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(h);
  /** API requests in flight (until the reply is sent), so shutdown can let a mutation land before the storage flushes. @req FR:test-reliability/shutdown.reply */
  const inflight = new Set<Promise<unknown>>();

  const server: Server = createServer((req, res) => {
    void (async () => {
      const send = (status: number, body: string | Buffer, type: string, h: Record<string, string> = {}) => {
        res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...extra, ...h });
        res.end(body);
      };
      try {
        // DNS-rebinding guard: only loopback host names are served.
        // @req FR:cli/web.serve.loopback
        if (!hostOk(req.headers.host)) return send(403, 'forbidden', 'text/plain');
        // CSRF guard: writes only from this page (a browser always sends Origin or Sec-Fetch-Site on cross-site posts).
        const origin = req.headers.origin;
        const site = req.headers['sec-fetch-site'];
        const unsafe = req.method !== 'GET' && req.method !== 'HEAD';
        // @req FR:cli/web.serve.loopback
        if (unsafe && ((origin && !hostOk(new URL(origin).host)) || (site && site !== 'same-origin' && site !== 'none'))) return send(403, 'forbidden', 'text/plain');
        const path = (req.url ?? '/').split('?')[0];
        // @req FR:cli/web.serve.local
        if (path === '/.auth/me') return send(200, JSON.stringify({ clientPrincipal: { userDetails: who, identityProvider: 'local', userRoles: ['authenticated'] }, local: o.info ?? null, events: watcher.active(), agents: !!agents, ...(o.setup?.status().needed ? { setup: true } : {}) }), 'application/json');
        // @req FR:first-run-onboarding/host.live
        if (o.setup && path === '/setup') { await serveSetup(o.setup, req, res, extra); return; }
        if (path === '/.auth/logout') return send(302, '', 'text/plain', { location: '/' });
        // @req FR:ask-queue/live.sse
        if (path === '/events' && req.method === 'GET') {
          // No watcher: refuse the stream so EventSource closes and the page polls, instead of a silent Live.
          if (!watcher.active()) return send(503, 'no file watcher; poll instead', 'text/plain');
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no', ...extra });
          const frame = (event: string, data: unknown, id?: number) => res.write(`${id === undefined ? '' : `id: ${id}\n`}event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
          res.write('retry: 3000\n\n');
          const last = Number(req.headers['last-event-id']);
          frame('hello', { rev: watcher.rev() });
          if (Number.isInteger(last) && last >= 0 && last < watcher.rev()) frame('change', { rev: watcher.rev(), kinds: ALL_KINDS }, watcher.rev());
          const off = watcher.on((c) => frame('change', c, c.rev));
          const sink = (event: string, data: unknown) => frame(event, data);
          sinks.add(sink);
          const hb = setInterval(() => res.write(': ping\n\n'), beat);
          req.on('close', () => { clearInterval(hb); off(); sinks.delete(sink); });
          return;
        }
        // @req FR:agent-sessions/run.events
        const runEvents = /^\/sessions\/([A-Za-z0-9-]{1,64})\/events$/.exec(path);
        if (runEvents && req.method === 'GET') {
          if (!agents) return send(404, 'not found', 'text/plain');
          // One subscription: replayed updates are held until the headers are out, then every update is written as it comes.
          // Updates are numbered so a reconnecting EventSource (Last-Event-ID) skips what it already has.
          const after = Number(req.headers['last-event-id']);
          let n = 0;
          const write = (u: unknown) => { n++; if (Number.isInteger(after) && n <= after) return; res.write(`id: ${n}\nevent: update\ndata: ${JSON.stringify(u)}\n\n`); };
          const held: unknown[] = [];
          let sink: (u: unknown) => void = (u) => { held.push(u); };
          let closed = false;
          const off = agents.subscribe(runEvents[1], (u) => sink(u), () => { closed = true; if (res.headersSent) res.end(); });
          if (!off) return send(204, '', 'text/plain');
          res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no', ...extra });
          res.write('retry: 3000\n\n');
          for (const u of held) write(u);
          sink = write;
          if (closed) return void res.end();
          const hb = setInterval(() => res.write(': ping\n\n'), beat);
          req.on('close', () => { clearInterval(hb); off(); });
          return;
        }
        if (path === '/api' || path.startsWith('/api/')) {
          const work = toRequest(req, `http://localhost:${port}`).then(api);
          // In flight until the reply is on the wire (res 'close'), not just until the api settles: shutdown must not cut the answer off.
          const replied = new Promise<void>((ok) => res.once('close', ok));
          inflight.add(replied); void replied.finally(() => inflight.delete(replied));
          const r = await work;
          const h: Record<string, string> = {};
          r.headers.forEach((v, k) => { h[k] = v; });
          res.writeHead(r.status, { ...extra, ...h });
          return void res.end(Buffer.from(await r.arrayBuffer()));
        }
        const root = realpathSync(o.webDir);
        let file = join(root, 'index.html');
        try {
          const cand = realpathSync(join(root, normalize(decodeURIComponent(path))));
          if (path !== '/' && cand.startsWith(root + sep) && statSync(cand).isFile()) file = cand;
        } catch { /* unknown path: single-page app fallback */ }
        // @req FR:perf/serve.assets — built files carry a content hash in their name, so the browser may keep them.
        const hashed = file.startsWith(join(root, 'assets') + sep);
        // The page learns it needs setup from a meta tag, so a normal start pays no extra round trip. @req FR:first-run-onboarding/web.gate
        const body = o.setup && file === join(root, 'index.html') && o.setup.status().needed ? withSetupMeta(readFileSync(file)) : readFileSync(file);
        send(200, body, TYPES[extname(file)] ?? 'application/octet-stream', hashed ? { 'cache-control': 'public, max-age=31536000, immutable' } : {});
      } catch (e) {
        console.error(e);
        if (!res.headersSent) send(500, 'internal error', 'text/plain'); else res.end();
      }
    })();
  });
  await new Promise<void>((ok, bad) => { server.once('error', bad); server.listen(o.port, '127.0.0.1', ok); });
  port = (server.address() as { port: number }).port;
  // @req FR:cli/web.batch.shutdown
  const close = async () => {
    offPending?.();
    offReports(); offPrPri(); unwatchPrPri();
    offPris();
    prPage?.prBoard.stop();
    offLive();
    offDelivery?.();
    watcher.close();
    await deliveryLoop?.close();
    const closed = new Promise<void>((ok) => server.close(() => ok())); // stop accepting; open sockets stay until below
    server.closeIdleConnections();
    // Let api requests already being handled finish (bounded), so their writes join the final flush.
    await Promise.race([Promise.allSettled([...inflight]), new Promise((ok) => setTimeout(ok, 10_000).unref())]);
    server.closeAllConnections(); // ends the event streams
    await closed;
    await storage.close?.();
  };
  return { url: `http://localhost:${port}`, close };
}

/** The running code's version and short sha, read once at start; never from the client. @req FR:feedback-button/store.line */
export function appInfo(from = __dirname): { appVersion?: string; sha?: string } {
  for (let d = from; ; d = join(d, '..')) {
    const p = join(d, 'package.json');
    if (existsSync(p)) {
      try {
        const j = JSON.parse(readFileSync(p, 'utf8')) as { name?: string; version?: string };
        if (j.name === 'stack') {
          let sha: string | undefined;
          try { sha = execFileSync('git', ['-C', d, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 3000 }).trim() || undefined; } catch { sha = undefined; }
          return { appVersion: j.version, ...(sha ? { sha } : {}) };
        }
      } catch { /* not ours */ }
    }
    if (resolve(d, '..') === resolve(d)) return {};
  }
}
