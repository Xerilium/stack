/**
 * First-run setup for the local hosts (`stack web`, desktop): the setup state in the user config, the `/setup` routes,
 * a setup-only server for when no repo is set, and `runLocal`, which restarts the host on the same port when setup changes it.
 * @req FR:first-run-onboarding/state.store @req FR:first-run-onboarding/host.setup
 */
import { execFileSync } from 'child_process';
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, renameSync, statSync, writeFileSync } from 'fs';
import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import { extname, join, normalize, resolve, sep } from 'path';
import { defaultCachePath } from '../graph/auth';

/** The steps, in order. @req FR:first-run-onboarding/step.max */
export const STEPS = ['repo', 'mode', 'calendar', 'email', 'phone'] as const;
export type StepId = (typeof STEPS)[number];
/** What the email step shows; Stack never asks for a send scope (`FR:graph-signin/scope.never`). @req FR:first-run-onboarding/step.email */
export const SIGN_IN = 'stack graph login --client-id <app id> --with calendar,mail,drafts';

export interface Onboarding { step: StepId; done?: boolean }
export type UserCfg = Record<string, unknown> & { repo?: string; dir?: string; mode?: string; ics?: string; onboarding?: Onboarding };
export type Reason = 'no-repo' | 'empty' | 'resume' | 'broken' | null;
export interface SetupStatus {
  needed: boolean; reason: Reason; step: StepId; steps: readonly StepId[];
  repo: string | null; mode: 'demo' | 'live';
  /** What sets the repo or the mode outside setup (a flag, the current folder, an env var); setup cannot change it then. */
  repoLock: string | null; modeLock: string | null; calendar: boolean; email: boolean; signIn: string; error?: string;
}

const cfgPath = (home: string) => join(home, '.config/stack/config.json');
const isStep = (s: unknown): s is StepId => typeof s === 'string' && (STEPS as readonly string[]).includes(s);
const isUrl = (s: string) => /^(https?:\/\/|ssh:\/\/|file:\/\/|git@)/.test(s);
const redact = (spec: string): string => spec.replace(/\/\/[^/@]*@/, '//');

/** The user config, or `{}` when missing or broken. */
export function readConfig(home: string): UserCfg {
  try { const j = JSON.parse(readFileSync(cfgPath(home), 'utf8')) as unknown; return j && typeof j === 'object' && !Array.isArray(j) ? j as UserCfg : {}; } catch { return {}; }
}

/** Merges `patch` into the user config (an `undefined` value removes the key); atomic, mode 0600. @req FR:first-run-onboarding/state.store */
export function writeConfig(home: string, patch: Partial<UserCfg>): UserCfg {
  const next: UserCfg = { ...readConfig(home) };
  for (const [k, v] of Object.entries(patch)) { if (v === undefined) delete next[k]; else next[k] = v; }
  const file = cfgPath(home);
  mkdirSync(join(home, '.config/stack'), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
  return next;
}

/** True when a `tasks/*.md` file in `dir` has a checkbox row. @req FR:first-run-onboarding/state.needed */
export function hasTaskRows(dir: string | null): boolean {
  if (!dir) return false;
  try {
    return readdirSync(join(dir, 'tasks')).filter((f) => f.endsWith('.md')).some((f) => /^\s*[-*] \[[ xX]\]/m.test(readFileSync(join(dir, 'tasks', f), 'utf8')));
  } catch { return false; }
}

const repoSpec = (cfg: UserCfg, env: NodeJS.ProcessEnv): string | undefined => env.STACK_REPO || env.STACK_DIR || cfg.repo || cfg.dir || undefined;
/** Sources that win over the user config. Hosts pass their own (flags, the current folder); env vars always count. */
export interface Locks { repo?: string; mode?: string }
const envLock = (env: NodeJS.ProcessEnv): string | undefined => (env.STACK_REPO ? 'STACK_REPO' : env.STACK_DIR ? 'STACK_DIR' : undefined);

/** @req FR:first-run-onboarding/state.needed @req FR:first-run-onboarding/state.status @req FR:first-run-onboarding/host.broken */
export function setupStatus(o: { cfg: UserCfg; env: NodeJS.ProcessEnv; dir: string | null; email: boolean; spec?: string; error?: string; locks?: Locks }): SetupStatus {
  const spec = o.spec ?? repoSpec(o.cfg, o.env);
  const ob = o.cfg.onboarding;
  const reason: Reason = o.error ? 'broken' : !spec ? 'no-repo' : ob?.done ? null : o.dir && !hasTaskRows(o.dir) ? 'empty' : ob ? 'resume' : null;
  const step: StepId = reason === 'broken' || reason === 'no-repo' ? 'repo' : isStep(ob?.step) ? ob.step : 'repo';
  return {
    needed: reason !== null, reason, step, steps: STEPS,
    repo: spec ? redact(spec) : null, mode: o.locks?.mode ? 'live' : o.cfg.mode === 'live' ? 'live' : 'demo',
    repoLock: o.locks?.repo ?? envLock(o.env) ?? null, modeLock: o.locks?.mode ?? null,
    calendar: !!(o.env.STACK_CALENDAR_ICS || o.cfg.ics || o.env.STACK_CALENDAR_FIXTURE), email: o.email, signIn: SIGN_IN,
    ...(o.error ? { error: o.error } : {}),
  };
}

export type ApplyResult = { ok: true; restart: boolean } | { ok: false; error: string };
const fail = (error: string): ApplyResult => ({ ok: false, error });
const nextOf = (s: StepId): StepId => STEPS[Math.min(STEPS.indexOf(s) + 1, STEPS.length - 1)];
const insideGit = (dir: string) => { try { execFileSync('git', ['rev-parse', '--git-dir'], { cwd: dir, stdio: 'pipe' }); return true; } catch { return false; } };
const localPath = (spec: string | undefined) => (spec && !isUrl(spec) ? resolve(spec) : undefined);

/**
 * Validates and saves one step. `restart` is true when the host must restart to apply it (repo, mode, or calendar changed).
 * @req FR:first-run-onboarding/host.apply @req FR:first-run-onboarding/step.repo @req FR:first-run-onboarding/step.mode
 * @req FR:first-run-onboarding/step.mode.tasks @req FR:first-run-onboarding/step.calendar @req FR:first-run-onboarding/step.email @req FR:first-run-onboarding/step.phone
 */
export function applySetup(o: { home: string; env: NodeJS.ProcessEnv; body: unknown; locks?: Locks; spec?: string }): ApplyResult {
  const b = (o.body && typeof o.body === 'object' ? o.body : null) as Record<string, unknown> | null;
  if (!b) return fail('Send a step.');
  const cfg = readConfig(o.home);
  // @req FR:first-run-onboarding/state.resume (Back: an earlier step, saved so a reopen lands there)
  if (b.go !== undefined) {
    if (!isStep(b.go)) return fail('Unknown step.');
    writeConfig(o.home, { onboarding: { step: b.go } });
    return { ok: true, restart: false };
  }
  if (!isStep(b.step)) return fail('Unknown step.');
  // The host repo (flags and the current folder win over env and config), as in setupStatus.
  const spec = o.spec ?? repoSpec(cfg, o.env);
  if (b.step !== 'repo' && !spec) return fail('Pick a repo first.');
  const save = (patch: Partial<UserCfg>, restart: boolean, done = false): ApplyResult => {
    writeConfig(o.home, { ...patch, onboarding: done ? { step: 'phone', done: true } : { step: nextOf(b.step as StepId) } });
    return { ok: true, restart };
  };
  switch (b.step) {
    case 'repo': {
      // A flag, the current folder, or an env var sets the repo: confirm and move on, save nothing.
      if (o.locks?.repo ?? envLock(o.env)) return save({}, false);
      const raw = typeof b.repo === 'string' ? b.repo.trim() : '';
      if (!raw || raw.length > 2048) return fail('Type a folder path or a git url.');
      if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) && !isUrl(raw)) return fail('Use an https, ssh, file, or git@ url.');
      // The page shows the url redacted; sending it back unchanged keeps the saved url and its credentials.
      let value = cfg.repo && raw === redact(cfg.repo) ? cfg.repo : raw;
      if (!isUrl(value)) {
        value = resolve(raw.replace(/^~(?=$|[/\\])/, o.home));
        if (!existsSync(value) || !statSync(value).isDirectory()) return fail(`Folder not found: ${value}`);
        if (!insideGit(value)) return fail(`${value} is not a git repo. Run git init there first.`);
      }
      const changed = value !== cfg.repo;
      // A folder with no tasks/ cannot serve yet (demo copies tasks/): wait for the mode step.
      const ready = isUrl(value) || existsSync(join(value, 'tasks')) || cfg.mode === 'live' || !!o.locks?.mode;
      return save({ repo: value }, changed && ready);
    }
    case 'mode': {
      if (b.mode !== 'demo' && b.mode !== 'live' && !o.locks?.mode) return fail('Pick Demo or Live.');
      const local = localPath(spec);
      const noTasks = !!local && !existsSync(join(local, 'tasks'));
      // --live sets the mode: save nothing, but start the list it will serve. @req FR:first-run-onboarding/step.mode.tasks
      if (o.locks?.mode) { if (noTasks) mkdirSync(join(local, 'tasks')); return save({}, noTasks); }
      const was = cfg.mode === 'live' ? 'live' : 'demo';
      if (b.mode === 'demo') {
        if (noTasks) return fail('This repo has no tasks/ folder, so there is nothing to copy. Pick Live to start a new list here.');
        return save({ mode: 'demo' }, was !== 'demo');
      }
      if (b.ack !== true) return fail('Check "I understand" to use Live.');
      if (noTasks) mkdirSync(join(local, 'tasks'));
      return save({ mode: 'live' }, was !== 'live' || noTasks);
    }
    case 'calendar': {
      if (b.skip === true) return save({}, false);
      const ics = typeof b.ics === 'string' ? b.ics.trim() : '';
      let ok = false;
      try { const u = new URL(ics); ok = (u.protocol === 'https:' || u.protocol === 'webcal:') && !!u.hostname; } catch { /* not a url */ }
      if (!ok || ics.length > 4096) return fail('Paste the https or webcal link of a published calendar.');
      return save({ ics }, ics !== cfg.ics);
    }
    case 'email': return save({}, false);
    case 'phone': return save({}, false, true);
  }
}

/** The `/setup` routes, shared by the setup server and the real server. */
export interface SetupHandler {
  status(): SetupStatus;
  post(body: unknown): { code: number; body: unknown; restart: boolean };
  /** Called once the reply that asked for it is on the wire. */
  restart(): void;
}

export function createSetup(o: {
  home: string; env: NodeJS.ProcessEnv; spec: () => string | undefined; dir: () => string | null; restart: () => void;
  error?: () => string | undefined; email?: () => boolean; locks?: () => Locks;
}): SetupHandler {
  const email = o.email ?? (() => existsSync(o.env.STACK_GRAPH_CACHE ?? defaultCachePath(o.home)));
  const status = () => setupStatus({ cfg: readConfig(o.home), env: o.env, dir: o.dir(), email: email(), spec: o.spec(), error: o.error?.(), locks: o.locks?.() });
  return {
    status,
    post(body) {
      const r = applySetup({ home: o.home, env: o.env, body, locks: o.locks?.(), spec: o.spec() });
      if (!r.ok) return { code: 400, body: { error: { code: 'invalid', message: r.error } }, restart: false };
      return { code: 200, body: { restart: r.restart, status: status() }, restart: r.restart };
    },
    restart: o.restart,
  };
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
};
/** @req FR:cli/web.serve.loopback */
export const loopbackHost = (h?: string) => !!h && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(h);
/** A write from another site (CSRF). @req FR:cli/web.serve.loopback */
export function crossSite(req: IncomingMessage): boolean {
  const unsafe = req.method !== 'GET' && req.method !== 'HEAD';
  const origin = req.headers.origin; const site = req.headers['sec-fetch-site'];
  let foreign = false;
  try { foreign = !!origin && !loopbackHost(new URL(origin).host); } catch { foreign = true; }
  return unsafe && (foreign || (!!site && site !== 'same-origin' && site !== 'none'));
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []; let n = 0;
  for await (const c of req) { n += (c as Buffer).length; if (n > 64_000) throw new Error('body too large'); chunks.push(c as Buffer); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return null; }
}

/** Serves `GET|POST /setup`; true when it handled the request. Restarts after the reply is sent. @req FR:first-run-onboarding/host.apply */
export async function serveSetup(setup: SetupHandler, req: IncomingMessage, res: ServerResponse, extra: Record<string, string> = {}): Promise<boolean> {
  const path = (req.url ?? '/').split('?')[0];
  if (path !== '/setup') return false;
  const send = (code: number, body: unknown) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra }); res.end(JSON.stringify(body)); };
  if (req.method === 'GET') { send(200, setup.status()); return true; }
  if (req.method !== 'POST') { send(405, { error: { code: 'method', message: 'GET or POST' } }); return true; }
  const r = setup.post(await readJson(req));
  if (r.restart) res.once('finish', () => setup.restart());
  send(r.code, r.body);
  return true;
}

/** Marks the app page as needing setup: `<meta name="stack-setup">` right after `<head>`. @req FR:first-run-onboarding/web.gate */
export function withSetupMeta(html: Buffer | string): string {
  const t = html.toString();
  const tag = '<meta name="stack-setup" content="1">';
  return /<head[^>]*>/i.test(t) ? t.replace(/<head[^>]*>/i, (h) => h + tag) : tag + t;
}

export interface LocalServer { url: string; close(): Promise<void> }

/** The setup-only server: loopback, the guards, the built app, `/.auth/me`, and `/setup`. @req FR:first-run-onboarding/host.setup */
export async function startSetupServer(o: { port: number; webDir: string; setup: SetupHandler; headers?: Record<string, string> }): Promise<LocalServer> {
  const extra = o.headers ?? (() => { try { return (JSON.parse(readFileSync(join(o.webDir, 'staticwebapp.config.json'), 'utf8')) as { globalHeaders?: Record<string, string> }).globalHeaders ?? {}; } catch { return {}; } })();
  const server = createServer((req, res) => {
    void (async () => {
      const send = (status: number, body: string | Buffer, type: string) => { res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...extra }); res.end(body); };
      try {
        if (!loopbackHost(req.headers.host) || crossSite(req)) return send(403, 'forbidden', 'text/plain');
        const path = (req.url ?? '/').split('?')[0];
        if (path === '/.auth/me') return send(200, JSON.stringify({ clientPrincipal: { userDetails: 'local', identityProvider: 'local', userRoles: ['authenticated'] }, local: null, setup: true, events: false, agents: false }), 'application/json');
        if (await serveSetup(o.setup, req, res, extra)) return;
        if (path === '/api' || path.startsWith('/api/') || path === '/events') return send(404, JSON.stringify({ error: { code: 'setup', message: 'Finish setup first' } }), 'application/json');
        const root = realpathSync(o.webDir);
        let file = join(root, 'index.html');
        try {
          const cand = realpathSync(join(root, normalize(decodeURIComponent(path))));
          if (path !== '/' && cand.startsWith(root + sep) && statSync(cand).isFile()) file = cand;
        } catch { /* single-page app fallback */ }
        send(200, file === join(root, 'index.html') ? withSetupMeta(readFileSync(file)) : readFileSync(file), TYPES[extname(file)] ?? 'application/octet-stream');
      } catch {
        if (!res.headersSent) send(500, 'internal error', 'text/plain'); else res.end();
      }
    })();
  });
  await new Promise<void>((ok, bad) => { server.once('error', bad); server.listen(o.port, '127.0.0.1', ok); });
  const port = (server.address() as { port: number }).port;
  return {
    url: `http://localhost:${port}`,
    close: () => new Promise<void>((ok) => { server.close(() => ok()); server.closeAllConnections(); }),
  };
}

export interface RunLocalOpts {
  port: number; home: string; env: NodeJS.ProcessEnv; webDir: string; log: (line: string) => void;
  /** The repo spec the real server would use (flags, discovery, env, config); undefined = none. */
  spec: () => string | undefined;
  /** Sources that win over setup (flags, the current folder). */
  locks?: () => Locks;
  /** Starts the real server on `port` with the `/setup` routes; `dir` is the folder it serves (for the empty check). */
  startReal: (port: number, setup: SetupHandler) => Promise<{ server: LocalServer; dir: string }>;
}
export interface LocalHost extends LocalServer { /** Resolves when restarts asked for so far are done. Test seam. */ settled(): Promise<void> }

/**
 * Runs the real server when a repo is set, else the setup server; a setup change restarts it on the same port.
 * A real server that fails to start falls back to setup with the error.
 * @req FR:first-run-onboarding/host.setup @req FR:first-run-onboarding/host.apply @req FR:first-run-onboarding/host.broken
 */
export async function runLocal(o: RunLocalOpts): Promise<LocalHost> {
  let cur: LocalServer | undefined; let port = o.port; let dir: string | null = null; let error: string | undefined;
  let chain: Promise<void> = Promise.resolve(); let closed = false;
  const setup = createSetup({ home: o.home, env: o.env, spec: o.spec, locks: o.locks, dir: () => dir, error: () => error, restart: () => { chain = chain.then(reboot).catch((e: unknown) => o.log(`setup: restart failed (${redact(e instanceof Error ? e.message : String(e))})`)); } });
  const boot = async () => {
    error = undefined; dir = null; cur = undefined;
    const spec = o.spec();
    const local = localPath(spec);
    // A folder with no tasks/ waits in setup for the Live choice (FR:step.mode.tasks); that is not an error.
    const waiting = !!local && existsSync(local) && !existsSync(join(local, 'tasks')) && readConfig(o.home).mode !== 'live' && !o.locks?.().mode;
    if (spec && !waiting) {
      try { const r = await o.startReal(port, setup); cur = r.server; dir = r.dir; }
      catch (e) { error = redact(e instanceof Error ? e.message : String(e)); o.log(`setup: host did not start (${error})`); }
    }
    if (!cur) { cur = await startSetupServer({ port, webDir: o.webDir, setup }); o.log(`setup: ${cur.url}`); }
    port = Number(new URL(cur.url).port);
  };
  async function reboot() {
    if (closed) return;
    await cur?.close();
    await boot();
  }
  await boot();
  return {
    get url() { return `http://localhost:${port}`; },
    settled: () => chain,
    close: async () => { closed = true; await chain.catch(() => undefined); await cur?.close(); },
  };
}
