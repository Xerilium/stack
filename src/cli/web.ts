/**
 * `stack web`: serves the web app and the api on localhost over a task repo (loopback only, no sign-in).
 * @req FR:cli/web.serve @req FR:cli/web.demo
 */
import { createHash } from 'crypto';
import { execFileSync } from 'child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'fs';
import { createServer, type IncomingMessage, type Server } from 'http';
import { dirname, extname, join, normalize, relative, resolve, sep } from 'path';
import { createApiHandler } from '../api/handler';
import { createGitHubPrs } from '../api/github';
import { getDefaults, parseConfig } from '../core/config';
import { GitStorage } from '../core/storage-git';
import { ALL_KINDS, watchRepo } from './watch';

const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, stdio: 'pipe', encoding: 'utf8' });

/** Copies the content repo's `tasks/` into `dest` as a fresh git repo (no history, no remote). Keeps earlier edits unless `reset`. */
export function prepareDemo(repo: string, dest: string, reset = false): void {
  const source = join(repo, 'tasks');
  if (!existsSync(source)) throw new Error(`${source} not found (expected a content repo with a tasks/ folder)`);
  const marker = join(dest, '.stack-source');
  if (existsSync(join(dest, '.git')) && !reset && existsSync(marker) && readFileSync(marker, 'utf8') === resolve(repo)) return;
  const inside = (a: string, b: string) => { const r = relative(realpathSync(a), existsSync(b) ? realpathSync(b) : resolve(b)); return r === '' || (!r.startsWith('..') && !r.includes(':')); };
  if (inside(source, dest) || (existsSync(dest) && inside(dest, source))) throw new Error(`Demo source and copy overlap: ${source} / ${dest}`);
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  const cfg = join(repo, '.xe/config/stack.json');
  cpSync(source, join(dest, 'tasks'), { recursive: true, dereference: true, filter: (p) => !p.split(sep).includes('.git') });
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
export interface WebOpts { dir: string; port: number; webDir: string; label?: string; info?: RepoInfo; watch?: { debounceMs?: number; heartbeatMs?: number } }

/** A git url is cloned once into `cacheDir`; a path is used as is. */
export function resolveRepo(spec: string, cacheDir: string): string {
  if (!/^(https?:\/\/|ssh:\/\/|file:\/\/|git@)/.test(spec)) return resolve(spec);
  const dest = join(cacheDir, createHash('sha1').update(spec).digest('hex').slice(0, 12));
  if (!existsSync(join(dest, '.git'))) { mkdirSync(cacheDir, { recursive: true }); git(cacheDir, 'clone', '-q', '--', spec, dest); }
  return dest;
}

/** Repo spec for display: credentials in a url are dropped. */
export const redact = (spec: string): string => spec.replace(/\/\/[^/@]*@/, '//');

/** LIVE: a git worktree of the real repo on a dedicated branch, so its checkout and main are never touched. */
export function prepareLive(repo: string, branch: string, wtDir: string): { dir: string; branch: string } {
  if (/^(main|master|HEAD)$/.test(branch)) throw new Error(`LIVE never commits to ${branch}; pick a dedicated branch`);
  if (branch.startsWith('-')) throw new Error(`Bad branch name: ${branch}`);
  try { git(repo, 'check-ref-format', '--branch', branch); } catch { throw new Error(`Bad branch name: ${branch}`); }
  try { git(repo, 'rev-parse', '--git-dir'); } catch { throw new Error(`${repo} is not a git repo`); }
  if (!existsSync(join(wtDir, '.git'))) {
    mkdirSync(dirname(wtDir), { recursive: true });
    let exists = true;
    try { git(repo, 'rev-parse', '--verify', '-q', `refs/heads/${branch}`); } catch { exists = false; }
    if (exists) git(repo, 'worktree', 'add', wtDir, branch); else git(repo, 'worktree', 'add', '-b', branch, wtDir);
  }
  if (!existsSync(join(wtDir, 'tasks'))) throw new Error(`${wtDir}/tasks not found on branch ${branch}`);
  return { dir: wtDir, branch };
}
export interface WebServer { url: string; close(): Promise<void> }

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
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

export async function startWeb(o: WebOpts): Promise<WebServer> {
  const cfgPath = join(o.dir, '.xe/config/stack.json');
  const config = existsSync(cfgPath) ? parseConfig(JSON.parse(readFileSync(cfgPath, 'utf8').replace(/^﻿/, ''))) : getDefaults();
  // @req FR:agent-inbox/github.wire
  const ghToken = process.env.GITHUB_TOKEN?.trim();
  const api = createApiHandler({ storage: new GitStorage(o.dir), config, authorize: () => true, onError: (e) => console.error(e), prs: ghToken ? createGitHubPrs({ token: ghToken }) : undefined });
  const extra = headersFrom(o.webDir);
  // @req FR:ask-queue/live.watch
  const watcher = watchRepo(o.dir, { debounceMs: o.watch?.debounceMs });
  const beat = o.watch?.heartbeatMs ?? 20_000;
  const who = o.label ?? 'local';
  let port = o.port;
  const hostOk = (h?: string) => !!h && /^(localhost|127\.0\.0\.1)(:\d+)?$/.test(h);

  const server: Server = createServer((req, res) => {
    void (async () => {
      const send = (status: number, body: string | Buffer, type: string, h: Record<string, string> = {}) => {
        res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...extra, ...h });
        res.end(body);
      };
      try {
        // DNS-rebinding guard: only loopback host names are served.
        if (!hostOk(req.headers.host)) return send(403, 'forbidden', 'text/plain');
        // CSRF guard: writes only from this page (a browser always sends Origin or Sec-Fetch-Site on cross-site posts).
        const origin = req.headers.origin;
        const site = req.headers['sec-fetch-site'];
        const unsafe = req.method !== 'GET' && req.method !== 'HEAD';
        if (unsafe && ((origin && !hostOk(new URL(origin).host)) || (site && site !== 'same-origin' && site !== 'none'))) return send(403, 'forbidden', 'text/plain');
        const path = (req.url ?? '/').split('?')[0];
        if (path === '/.auth/me') return send(200, JSON.stringify({ clientPrincipal: { userDetails: who, identityProvider: 'local', userRoles: ['authenticated'] }, local: o.info ?? null, events: watcher.active() }), 'application/json');
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
          const hb = setInterval(() => res.write(': ping\n\n'), beat);
          req.on('close', () => { clearInterval(hb); off(); });
          return;
        }
        if (path === '/api' || path.startsWith('/api/')) {
          const r = await api(await toRequest(req, `http://localhost:${port}`));
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
        send(200, readFileSync(file), TYPES[extname(file)] ?? 'application/octet-stream');
      } catch (e) {
        console.error(e);
        if (!res.headersSent) send(500, 'internal error', 'text/plain'); else res.end();
      }
    })();
  });
  await new Promise<void>((ok, bad) => { server.once('error', bad); server.listen(o.port, '127.0.0.1', ok); });
  port = (server.address() as { port: number }).port;
  return { url: `http://localhost:${port}`, close: () => new Promise((ok) => { watcher.close(); server.close(() => ok()); server.closeAllConnections(); }) };
}
