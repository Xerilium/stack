/**
 * A Finder launch gets the bare system `PATH`. Read the owner's login-shell `PATH` so the host and its agents find
 * `gh`, `claude`, `gemini`, and Node tools. Logs say where the `PATH` came from, never its value.
 * @req FR:desktop-shell/host.path @req NFR:desktop-shell/shell.log
 */
import { spawn } from 'child_process';
import { homedir } from 'os';
import { delimiter, join } from 'path';

/** Runs `file args` and resolves stdout. Rejects on a non-zero exit or when `timeoutMs` passes. */
export type ExecFn = (file: string, args: string[], o: { timeoutMs: number }) => Promise<string>;

export interface LoginPathDeps {
  home?: string;
  exec?: ExecFn;
  platform?: NodeJS.Platform;
  timeoutMs?: number;
}

export interface LoginPath { path: string; source: string }

/** Wraps the `PATH` in shell output so rc-file noise (banners, prompts) is ignored. */
export const PATH_MARK = '__STACK_PATH__';
const TIMEOUT_MS = 5000;
/** What launchd gives a Finder launch. */
const SYSTEM_PATH = ['/usr/bin', '/bin', '/usr/sbin', '/sbin'];

const MAX_OUT = 1024 * 1024;

/**
 * Spawns with stdin closed (a start-up file that reads input gets EOF) in its own process group, and SIGKILLs the
 * group once the `PATH` is read or on timeout: an interactive shell ignores SIGTERM, and rc files may start children
 * that hold stdout open.
 */
export const spawnExec: ExecFn = (file, args, o) => new Promise((ok, fail) => {
  const child = spawn(file, args, { stdio: ['ignore', 'pipe', 'ignore'], detached: process.platform !== 'win32' });
  let out = '';
  let settled = false;
  const kill = () => { try { if (child.pid && process.platform !== 'win32') process.kill(-child.pid, 'SIGKILL'); else child.kill('SIGKILL'); } catch { /* already gone */ } };
  // The group outlives the app: kill it if the app exits mid-read.
  process.once('exit', kill);
  const end = (e?: Error) => { if (settled) return; settled = true; clearTimeout(timer); process.off('exit', kill); kill(); if (e) fail(e); else ok(out); };
  const timer = setTimeout(() => end(new Error('timed out')), o.timeoutMs);
  child.stdout!.setEncoding('utf8');
  child.stdout!.on('data', (d: string) => { out += d; if (out.split(PATH_MARK).length > 2) end(); else if (out.length > MAX_OUT) end(new Error('shell output too large')); });
  child.on('error', (e) => end(new Error(`cannot start shell (${(e as NodeJS.ErrnoException).code ?? 'error'})`)));
  child.on('close', (code) => end(code === 0 ? undefined : new Error(`shell exited ${code ?? 'by signal'}`)));
});

const split = (p: string | undefined) => (p ?? '').split(delimiter).filter(Boolean);
const join_ = (...parts: string[][]) => [...new Set(parts.flat())].join(delimiter);

const reason = (e: unknown) => String((e as Error)?.message ?? e).split('\n')[0].slice(0, 120);

export async function resolveLoginPath(o: LoginPathDeps & { env: NodeJS.ProcessEnv }): Promise<LoginPath> {
  const platform = o.platform ?? process.platform;
  if (platform === 'win32') return { path: o.env.PATH ?? '', source: 'unchanged (win32)' };
  const current = split(o.env.PATH);
  // A terminal launch (`pnpm desktop`, the binary from a shell) already has the owner's PATH: keep its order, skip the shell.
  if (current.some((p) => !SYSTEM_PATH.includes(p))) return { path: o.env.PATH!, source: 'unchanged (not a bare system PATH)' };
  const home = o.home ?? homedir();
  const shell = o.env.SHELL || '/bin/zsh';
  try {
    // printenv, not "$PATH": fish expands $PATH to a space-joined list. Works the same in sh, bash, zsh, and fish.
    const out = await (o.exec ?? spawnExec)(shell, ['-ilc', `printf ${PATH_MARK}; /usr/bin/printenv PATH; printf ${PATH_MARK}`], { timeoutMs: o.timeoutMs ?? TIMEOUT_MS });
    const m = out.match(new RegExp(`${PATH_MARK}([^]*?)${PATH_MARK}`));
    const found = split(m?.[1].trim());
    if (!found.length) throw new Error('no PATH in shell output');
    return { path: join_(found, current), source: 'login shell' };
  } catch (e) {
    return { path: join_(['/opt/homebrew/bin', '/usr/local/bin', join(home, '.local/bin')], current), source: `fallback (${reason(e)})` };
  }
}

/** Sets `env.PATH` from the login shell. Call before the host starts so every child process inherits it. */
export async function applyLoginPath(env: NodeJS.ProcessEnv, deps: LoginPathDeps & { log?: (line: string) => void } = {}): Promise<void> {
  const r = await resolveLoginPath({ env, ...deps });
  env.PATH = r.path;
  (deps.log ?? ((l: string) => console.log(l)))(`path: ${r.source}`);
}
