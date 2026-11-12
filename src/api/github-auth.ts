/**
 * The GitHub token for a local host with zero setup: `GITHUB_TOKEN`, else the `gh` CLI sign-in. The in-app sign-in runs
 * `gh auth login --web` (the GitHub device flow) and shows its one-time code. Fixed args, no shell. Never logs or returns a token.
 * @req FR:pr-page/auth.token @req FR:pr-page/auth.state @req FR:pr-page/auth.signin
 */
import { execFile, spawn as nodeSpawn } from 'child_process';

/** Runs `gh` with fixed args and returns stdout. */
export type GhExec = (args: string[], timeoutMs: number) => Promise<string>;
/** Starts a long `gh` run; text is stdout and stderr together. */
export type GhSpawn = (args: string[]) => { onText(fn: (s: string) => void): void; onExit(fn: (code: number | null, err?: NodeJS.ErrnoException) => void): void; kill(): void };

export interface GitHubSignIn { state: 'waiting' | 'done' | 'error'; userCode?: string; verificationUri?: string; error?: 'expired' | 'gh-missing' | 'failed' }
export interface GitHubAuthStatus { state: 'signed-out'; method: 'gh' | 'none'; session?: GitHubSignIn }
export interface GitHubAuth {
  /** The token, or null when the host has none. */
  token(): Promise<string | null>;
  status(): Promise<GitHubAuthStatus>;
  start(): Promise<GitHubSignIn>;
  session(): GitHubSignIn | null;
}

export const GH_LOGIN_ARGS = ['auth', 'login', '--web', '--hostname', 'github.com', '--git-protocol', 'https', '--skip-ssh-key'];
const TOKEN_ARGS = ['auth', 'token', '--hostname', 'github.com'];
const DEVICE = 'https://github.com/login/device';
const TOKEN_RE = /^[A-Za-z0-9_]{20,255}$/;
const FOUND_MS = 10 * 60_000;
const MISS_MS = 15_000;
const SIGNIN_MS = 15 * 60_000;
const CODE_WAIT_MS = 10_000;

/** The one-time code and the device link from `gh auth login --web` output. Only the GitHub device link is kept. */
export function parseGhLogin(text: string): { userCode?: string; verificationUri?: string } {
  const code = /one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i.exec(text) ?? /\b([A-Z0-9]{4}-[A-Z0-9]{4})\b/.exec(text);
  return { ...(code ? { userCode: code[1].toUpperCase() } : {}), ...(text.includes(DEVICE) ? { verificationUri: DEVICE } : {}) };
}

const defaultExec: GhExec = (args, timeoutMs) => new Promise((ok, no) => execFile('gh', args, { timeout: timeoutMs, windowsHide: true }, (e, out) => (e ? no(e) : ok(String(out)))));
const defaultSpawn: GhSpawn = (args) => {
  const c = nodeSpawn('gh', args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let exited = false;
  return {
    onText: (fn) => { c.stdout?.on('data', (b: Buffer) => fn(String(b))); c.stderr?.on('data', (b: Buffer) => fn(String(b))); },
    onExit: (fn) => { c.on('error', (e: NodeJS.ErrnoException) => { if (!exited) { exited = true; fn(null, e); } }); c.on('exit', (code) => { if (!exited) { exited = true; fn(code); } }); },
    kill: () => { try { c.kill(); } catch { /* gone */ } },
  };
};

export function createGitHubAuth(o: {
  env: NodeJS.ProcessEnv; exec?: GhExec; spawn?: GhSpawn; now?: () => number; codeWaitMs?: number;
  timers?: { set: (fn: () => void, ms: number) => unknown; clear: (h: unknown) => void };
}): GitHubAuth {
  const exec = o.exec ?? defaultExec;
  const spawn = o.spawn ?? defaultSpawn;
  const now = o.now ?? (() => Date.now());
  const timers = o.timers ?? { set: (fn: () => void, ms: number) => { const t = setTimeout(fn, ms); t.unref?.(); return t; }, clear: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>) };
  const ghOff = () => o.env.STACK_GH_AUTH === 'off';
  let cached: { value: string | null; at: number } | null = null;
  let reading: Promise<string | null> | null = null;
  let hasGh: Promise<boolean> | null = null;
  let sess: GitHubSignIn | null = null;

  const fromGh = async (): Promise<string | null> => {
    try { const t = (await exec(TOKEN_ARGS, 5000)).trim(); return TOKEN_RE.test(t) ? t : null; } catch { return null; }
  };
  const ghRuns = () => (hasGh ??= ghOff() ? Promise.resolve(false) : exec(['--version'], 5000).then(() => true, () => false));

  return {
    async token() {
      const env = o.env.GITHUB_TOKEN?.trim();
      if (env) return env;
      if (ghOff()) return null;
      if (cached && now() - cached.at < (cached.value ? FOUND_MS : MISS_MS)) return cached.value;
      reading ??= fromGh().then((v) => { cached = { value: v, at: now() }; return v; }).finally(() => { reading = null; });
      return reading;
    },
    async status() {
      return { state: 'signed-out', method: (await ghRuns()) ? 'gh' : 'none', ...(sess ? { session: { ...sess } } : {}) };
    },
    session: () => (sess ? { ...sess } : null),
    async start() {
      if (sess?.state === 'waiting') return { ...sess };
      if (!(await ghRuns())) { sess = { state: 'error', error: 'gh-missing' }; return { ...sess }; }
      const s: GitHubSignIn = { state: 'waiting' };
      sess = s;
      let text = '';
      let ready: () => void = () => {};
      const shown = new Promise<void>((ok) => { ready = ok; });
      const child = spawn(GH_LOGIN_ARGS);
      const end = (p: Partial<GitHubSignIn> & { state: GitHubSignIn['state'] }) => {
        if (s.state !== 'waiting') return;
        timers.clear(expiry);
        delete s.userCode; delete s.verificationUri;
        Object.assign(s, p);
        // A new sign-in: read the token again now, not after the cached miss runs out.
        if (p.state === 'done') cached = null;
        ready();
      };
      const expiry = timers.set(() => { child.kill(); end({ state: 'error', error: 'expired' }); }, SIGNIN_MS);
      child.onText((chunk) => {
        // Keep only enough output to find the code; nothing is logged.
        text = (text + chunk).slice(-4096);
        const p = parseGhLogin(text);
        if (p.userCode) s.userCode = p.userCode;
        if (p.verificationUri) s.verificationUri = p.verificationUri;
        if (s.userCode && s.verificationUri) ready();
      });
      child.onExit((code, err) => end(code === 0 ? { state: 'done' } : { state: 'error', error: err?.code === 'ENOENT' ? 'gh-missing' : 'failed' }));
      const wait = o.codeWaitMs ?? CODE_WAIT_MS;
      await Promise.race([shown, new Promise<void>((ok) => { const t = setTimeout(ok, wait); t.unref?.(); })]);
      if (s.state === 'waiting' && s.userCode && !s.verificationUri) s.verificationUri = DEVICE;
      return { ...s };
    },
  };
}
