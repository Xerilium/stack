/**
 * `stack web`: serves the web app and the api on localhost over a task repo (loopback only, no sign-in).
 * @req FR:cli/web.serve @req FR:cli/web.demo
 */
import { execFileSync } from 'child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'fs';
import { createServer, type IncomingMessage, type Server } from 'http';
import { extname, join, normalize } from 'path';
import { createApiHandler } from '../api/handler';
import { getDefaults, parseConfig } from '../core/config';
import { GitStorage } from '../core/storage-git';

const git = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, stdio: 'pipe', encoding: 'utf8' });

/** Copies `source` (a tasks folder) into `dest/tasks` as a fresh git repo. Keeps earlier edits unless `reset`. */
export function prepareDemo(source: string, dest: string, reset = false): void {
  if (!existsSync(source)) throw new Error(`Demo source not found: ${source}`);
  if (existsSync(join(dest, '.git')) && !reset) return;
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  cpSync(source, join(dest, 'tasks'), { recursive: true, filter: (p) => !p.split('/').includes('.git') });
  mkdirSync(join(dest, '.xe/config'), { recursive: true });
  writeFileSync(join(dest, '.xe/config/stack.json'), '{}\n');
  git(dest, 'init', '-q', '-b', 'main');
  git(dest, '-c', 'user.name=Stack', '-c', 'user.email=stack@localhost', 'add', '-A');
  git(dest, '-c', 'user.name=Stack', '-c', 'user.email=stack@localhost', 'commit', '-q', '-m', 'Stack demo copy');
}

export interface WebOpts { dir: string; port: number; webDir: string; label?: string }
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
  if (method !== 'GET' && method !== 'HEAD') for await (const c of req) chunks.push(c as Buffer);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (v !== undefined) headers.set(k, Array.isArray(v) ? v.join(', ') : v);
  // The one local user is the owner (loopback only); the api gates agent writes on this marker.
  headers.set('x-ms-client-principal', Buffer.from(JSON.stringify({ identityProvider: 'local', userId: 'local', userDetails: 'local', userRoles: ['authenticated'] })).toString('base64'));
  return new Request(origin + (req.url ?? '/'), { method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined });
}

export async function startWeb(o: WebOpts): Promise<WebServer> {
  const cfgPath = join(o.dir, '.xe/config/stack.json');
  const config = existsSync(cfgPath) ? parseConfig(JSON.parse(readFileSync(cfgPath, 'utf8').replace(/^﻿/, ''))) : getDefaults();
  const api = createApiHandler({ storage: new GitStorage(o.dir), config, authorize: () => true, onError: (e) => console.error(e) });
  const extra = headersFrom(o.webDir);
  const who = o.label ?? 'local';
  let port = o.port;
  const hostOk = (h?: string) => !!h && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(h);

  const server: Server = createServer((req, res) => {
    void (async () => {
      const send = (status: number, body: string | Buffer, type: string, h: Record<string, string> = {}) => {
        res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', ...extra, ...h });
        res.end(body);
      };
      try {
        // DNS-rebinding guard: only loopback host names are served.
        if (!hostOk(req.headers.host)) return send(403, 'forbidden', 'text/plain');
        const path = (req.url ?? '/').split('?')[0];
        if (path === '/.auth/me') return send(200, JSON.stringify({ clientPrincipal: { userDetails: who, identityProvider: 'local', userRoles: ['authenticated'] } }), 'application/json');
        if (path === '/.auth/logout') return send(302, '', 'text/plain', { location: '/' });
        if (path === '/api' || path.startsWith('/api/')) {
          const r = await api(await toRequest(req, `http://localhost:${port}`));
          const h: Record<string, string> = {};
          r.headers.forEach((v, k) => { h[k] = v; });
          res.writeHead(r.status, { ...extra, ...h });
          return void res.end(Buffer.from(await r.arrayBuffer()));
        }
        let file = normalize(join(o.webDir, path === '/' ? 'index.html' : path));
        if (!file.startsWith(normalize(o.webDir)) || !existsSync(file) || !statSync(file).isFile()) file = join(o.webDir, 'index.html');
        send(200, readFileSync(file), TYPES[extname(file)] ?? 'application/octet-stream');
      } catch (e) {
        console.error(e);
        if (!res.headersSent) send(500, 'internal error', 'text/plain'); else res.end();
      }
    })();
  });
  await new Promise<void>((ok, bad) => { server.once('error', bad); server.listen(o.port, '127.0.0.1', ok); });
  port = (server.address() as { port: number }).port;
  return { url: `http://localhost:${port}`, close: () => new Promise((ok) => { server.close(() => ok()); server.closeAllConnections(); }) };
}
