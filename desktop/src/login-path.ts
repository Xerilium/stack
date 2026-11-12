/**
 * A Finder launch gets the bare system `PATH`. Read the owner's login-shell `PATH` so the host and its agents find
 * `gh`, `claude`, `gemini`, and Node tools. Logs say where the `PATH` came from, never its value.
 * @req FR:desktop-shell/host.path @req NFR:desktop-shell/shell.log
 */
import { execFile } from 'child_process';
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

const defaultExec: ExecFn = (file, args, o) => new Promise((ok, fail) => {
  execFile(file, args, { timeout: o.timeoutMs, encoding: 'utf8', maxBuffer: 1024 * 1024 }, (e, stdout) => (e ? fail(e) : ok(stdout)));
});

const split = (p: string | undefined) => (p ?? '').split(delimiter).filter(Boolean);
const join_ = (...parts: string[][]) => [...new Set(parts.flat())].join(delimiter);

function reason(e: unknown): string {
  const err = e as { killed?: boolean; signal?: string; message?: string };
  if (err?.killed || err?.signal === 'SIGTERM') return 'timed out';
  return String(err?.message ?? e).split('\n')[0].slice(0, 120);
}

export async function resolveLoginPath(o: LoginPathDeps & { env: NodeJS.ProcessEnv }): Promise<LoginPath> {
  const platform = o.platform ?? process.platform;
  if (platform === 'win32') return { path: o.env.PATH ?? '', source: 'unchanged (win32)' };
  const current = split(o.env.PATH);
  const home = o.home ?? homedir();
  const shell = o.env.SHELL || '/bin/zsh';
  try {
    const out = await (o.exec ?? defaultExec)(shell, ['-ilc', `printf '${PATH_MARK}%s${PATH_MARK}' "$PATH"`], { timeoutMs: o.timeoutMs ?? TIMEOUT_MS });
    const m = out.match(new RegExp(`${PATH_MARK}([^]*?)${PATH_MARK}`));
    const found = split(m?.[1]);
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
