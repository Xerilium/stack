/**
 * The test server of a PR: the view the page shows, and the pure plan (setup commands, run command, port). No I/O.
 * @req FR:pr-page/server.plan @req FR:pr-page/server.port @req FR:pr-page/server.view
 */
export type ServerState = 'starting' | 'running' | 'failed';
export type ServerStep = 'checkout' | 'build' | 'run';
/** @req FR:pr-page/server.view */
export interface PrServerView { state: ServerState; step?: ServerStep; url?: string; error?: string; at: string }
export type PackageManager = 'pnpm' | 'yarn' | 'npm';
export interface PlanInput {
  /** The `Server` line of the check file. */
  server?: string;
  /** The `package.json` scripts of the worktree; absent with no `package.json`. */
  scripts?: Record<string, string>;
  /** The package has dependencies to install. */
  deps: boolean;
  /** From the lock file; null with none. */
  lock: PackageManager | null;
  port: number;
}
export interface ServerPlan { setup: string[]; run: string; port: number }

const RUN_SCRIPTS = ['web', 'dev', 'start', 'preview'];
const PORT_FORMS = [/(--port[= ])\d{2,5}\b/g, /(-p )\d{2,5}\b/g, /(\bPORT=)\d{2,5}\b/g, /(\b(?:localhost|127\.0\.0\.1):)\d{2,5}\b/g];

/** The command with each port it names set to `port`. A command with no port stays as it is. @req FR:pr-page/server.port */
export function withPort(cmd: string, port: number): string {
  return PORT_FORMS.reduce((c, re) => c.replace(re, (_m, pre: string) => `${pre}${port}`), cmd);
}

/** Setup (install, then build), the run command, and the port. Null with no command to run. @req FR:pr-page/server.plan */
export function serverPlan(i: PlanInput): ServerPlan | null {
  const pm: PackageManager = i.lock ?? 'npm';
  const scripts = i.scripts ?? {};
  const script = RUN_SCRIPTS.find((s) => typeof scripts[s] === 'string');
  const run = i.server?.trim() ? withPort(i.server.trim(), i.port) : script ? `${pm} run ${script}${pm === 'npm' ? ' --' : ''} --port ${i.port}` : null;
  if (!run) return null;
  const setup: string[] = [];
  if (i.deps) setup.push(pm === 'pnpm' ? 'pnpm install --frozen-lockfile' : pm === 'yarn' ? 'yarn install --frozen-lockfile' : i.lock ? 'npm ci' : 'npm install');
  if (typeof scripts.build === 'string') setup.push(`${pm} run build`);
  return { setup, run, port: i.port };
}
