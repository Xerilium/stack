/**
 * Test servers for PRs on the local host: fetch the PR into a worktree of the local clone, build it, run it on a free port, and stop it.
 * Git runs with fixed args and no shell. The setup and run commands run with `sh -c` in the worktree, in their own process group.
 * @req FR:pr-page/server.host @req FR:pr-page/server.clone @req FR:pr-page/server.checkout @req FR:pr-page/server.run @req FR:pr-page/server.stop
 */
import { execFile, spawn } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { connect, createServer } from 'net';
import { join } from 'path';
import { serverPlan, type PackageManager, type PrServerView, type ServerStep } from '../core/pr-server';
import { ApiError } from './errors';

export interface PrServers {
  /** The server of a PR, when the host holds one. */
  view(repo: string, number: number): PrServerView | undefined;
  /** Starts a server, or returns the one that starts or runs. `server` is the check file `Server` line. */
  start(repo: string, number: number, server?: string): Promise<PrServerView>;
  stop(repo: string, number: number): Promise<void>;
  /** Stops every server (host exit). */
  stopAll(): Promise<void>;
}
export interface PrServersOptions {
  /** Folders that hold local clones (`<root>/<repo name>`). @req FR:pr-page/server.clone */
  roots: string[];
  onChange?: () => void;
  now?: () => number;
  /** Servers at one time; default 3. */
  max?: number;
  /** How long the port may stay shut; default 3 minutes. */
  waitMs?: number;
  env?: NodeJS.ProcessEnv;
}

const NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const KILL_MS = 5_000;
const TAIL = 4_096;
interface Proc { done: Promise<{ code: number; last: string }>; kill(): void }
interface Entry { key: string; repo: string; number: number; state: PrServerView['state']; step?: ServerStep; port?: number; error?: string; at: number; proc?: Proc; stopped: boolean }

const git = (args: string[], cwd: string): Promise<{ code: number; out: string }> => new Promise((ok) => {
  execFile('git', args, { cwd, timeout: 120_000, maxBuffer: 1 << 20, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }, (e, out) => ok({ code: e ? 1 : 0, out: String(out).trim() }));
});
const lastLine = (t: string) => t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).pop()?.slice(0, 200) ?? '';

/** Runs one shell command in its own process group; keeps only the output tail. */
function sh(cmd: string, cwd: string, env: NodeJS.ProcessEnv): Proc {
  const p = spawn('/bin/sh', ['-c', cmd], { cwd, env, detached: true, stdio: ['ignore', 'pipe', 'pipe'] });
  let tail = '';
  const keep = (d: Buffer) => { tail = (tail + d.toString('utf8')).slice(-TAIL); };
  p.stdout.on('data', keep); p.stderr.on('data', keep);
  const done = new Promise<{ code: number; last: string }>((ok) => { p.on('error', (e) => ok({ code: 1, last: e.message })); p.on('close', (code) => ok({ code: code ?? 1, last: lastLine(tail) })); });
  const signal = (s: NodeJS.Signals) => { try { if (p.pid) process.kill(-p.pid, s); } catch { /* gone */ } };
  return { done, kill() { signal('SIGTERM'); const t = setTimeout(() => signal('SIGKILL'), KILL_MS); t.unref?.(); void done.then(() => clearTimeout(t)); } };
}
const freePort = (): Promise<number> => new Promise((ok, no) => {
  const s = createServer();
  s.on('error', no);
  s.listen(0, '127.0.0.1', () => { const a = s.address(); const port = typeof a === 'object' && a ? a.port : 0; s.close(() => ok(port)); });
});
const isOpen = (port: number): Promise<boolean> => new Promise((ok) => {
  const c = connect({ port, host: '127.0.0.1' });
  const end = (v: boolean) => { c.destroy(); ok(v); };
  c.setTimeout(1_000, () => end(false)); c.on('connect', () => end(true)); c.on('error', () => end(false));
});
interface Pkg { scripts?: Record<string, string>; dependencies?: object; devDependencies?: object }
const readPackage = (dir: string): Pkg | null => { try { const v = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as unknown; return v && typeof v === 'object' ? (v as Pkg) : null; } catch { return null; } };
const sleep = (ms: number) => new Promise<void>((ok) => { setTimeout(ok, ms); });

export function createPrServers(o: PrServersOptions): PrServers {
  const now = o.now ?? (() => Date.now());
  const max = o.max ?? 3;
  const waitMs = o.waitMs ?? 180_000;
  const all = new Map<string, Entry>();
  const keyOf = (repo: string, n: number) => `${repo.toLowerCase()}#${n}`;
  const viewOf = (e: Entry): PrServerView => ({ state: e.state, ...(e.state === 'starting' && e.step ? { step: e.step } : {}), ...(e.state === 'running' && e.port ? { url: `http://localhost:${e.port}` } : {}), ...(e.state === 'failed' && e.error ? { error: e.error } : {}), at: new Date(e.at).toISOString() });
  const set = (e: Entry, p: Partial<Entry>) => { if (e.stopped) return; Object.assign(e, p, { at: now() }); o.onChange?.(); };
  const fail = (e: Entry, error: string) => set(e, { state: 'failed', error, proc: undefined });

  /** The local clone: `<root>/<name>` whose origin is the GitHub repo. @req FR:pr-page/server.clone */
  const cloneOf = async (owner: string, name: string): Promise<string | null> => {
    for (const root of o.roots) {
      const dir = join(root, name);
      if (!existsSync(join(dir, '.git'))) continue;
      const url = (await git(['config', '--get', 'remote.origin.url'], dir)).out.toLowerCase().replace(/\.git$/, '').replace(/\/+$/, '');
      if (new RegExp(`github\\.com[:/]${owner.toLowerCase().replace(/[.]/g, '\\.')}/${name.toLowerCase().replace(/[.]/g, '\\.')}$`).test(url)) return dir;
    }
    return null;
  };

  const boot = async (e: Entry, server?: string): Promise<void> => {
    const [owner, name] = e.repo.split('/');
    const clone = await cloneOf(owner, name);
    if (!clone) return fail(e, `No local clone of ${e.repo}`);
    // @req FR:pr-page/server.checkout
    const fetched = await git(['fetch', '--quiet', 'origin', `pull/${e.number}/head`], clone);
    const sha = fetched.code === 0 ? (await git(['rev-parse', '--verify', 'FETCH_HEAD^{commit}'], clone)).out : '';
    if (!/^[0-9a-f]{40,64}$/.test(sha)) return fail(e, `Could not fetch ${e.repo}#${e.number}`);
    const wt = `${clone}.worktrees/pr-${e.number}-live`;
    const out = existsSync(wt) ? await git(['checkout', '--quiet', '--force', '--detach', sha], wt) : await git(['worktree', 'add', '--quiet', '--detach', wt, sha], clone);
    if (out.code !== 0) return fail(e, `Could not check out ${e.repo}#${e.number}`);
    if (e.stopped) return;
    // @req FR:pr-page/server.plan @req FR:pr-page/server.port
    const pkg = readPackage(wt);
    const lock: PackageManager | null = existsSync(join(wt, 'pnpm-lock.yaml')) ? 'pnpm' : existsSync(join(wt, 'yarn.lock')) ? 'yarn' : existsSync(join(wt, 'package-lock.json')) ? 'npm' : null;
    const port = await freePort();
    const scripts = pkg?.scripts && typeof pkg.scripts === 'object' ? pkg.scripts : undefined;
    const plan = serverPlan({ ...(server ? { server } : {}), ...(scripts ? { scripts } : {}), deps: !!pkg && Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).length > 0, lock, port });
    if (!plan) return fail(e, 'No server command: add a Server line to the check file');
    const env = { ...(o.env ?? process.env), PORT: String(port), HOST: '127.0.0.1' };
    // @req FR:pr-page/server.run
    set(e, { step: 'build', port });
    for (const cmd of plan.setup) {
      if (e.stopped) return;
      const p = sh(cmd, wt, env);
      e.proc = p;
      const r = await p.done;
      if (e.stopped) return;
      if (r.code !== 0) return fail(e, `Build failed: ${r.last || cmd}`);
    }
    if (e.stopped) return;
    const run = sh(plan.run, wt, env);
    set(e, { step: 'run', proc: run });
    let exited: { code: number; last: string } | null = null;
    void run.done.then((r) => { exited = r; if (e.proc === run && !e.stopped) fail(e, r.last ? `The server stopped: ${r.last}` : 'The server stopped'); });
    const end = now() + waitMs;
    while (!exited && !e.stopped) {
      if (await isOpen(port)) { if (!exited && !e.stopped) set(e, { state: 'running', step: undefined }); return; }
      if (now() > end) { run.kill(); e.proc = undefined; return fail(e, 'The server did not open its port in time'); }
      await sleep(250);
    }
  };

  const stopEntry = async (e: Entry): Promise<void> => {
    e.stopped = true;
    all.delete(e.key);
    const p = e.proc;
    if (p) { p.kill(); await p.done; }
  };

  return {
    view(repo, number) { const e = all.get(keyOf(repo, number)); return e ? viewOf(e) : undefined; },
    async start(repo, number, server) {
      const parts = repo.split('/');
      if (parts.length !== 2 || !parts.every((p) => NAME.test(p) && !/^\.+$/.test(p)) || !Number.isInteger(number) || number < 1) throw new ApiError('bad_request', 'Not a PR');
      const key = keyOf(repo, number);
      const cur = all.get(key);
      if (cur && cur.state !== 'failed') return viewOf(cur);
      const busy = [...all.values()].filter((x) => x.state !== 'failed').length;
      if (busy >= max) throw new ApiError('conflict', `Stop a test server first: ${busy} run now`);
      const e: Entry = { key, repo, number, state: 'starting', step: 'checkout', at: now(), stopped: false };
      if (cur) cur.stopped = true;
      all.set(key, e);
      o.onChange?.();
      const first = viewOf(e);
      void boot(e, server).catch(() => fail(e, 'Could not start the server'));
      return first;
    },
    async stop(repo, number) {
      const e = all.get(keyOf(repo, number));
      if (!e) return;
      await stopEntry(e);
      o.onChange?.();
    },
    async stopAll() { await Promise.all([...all.values()].map(stopEntry)); },
  };
}
