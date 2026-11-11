/** The Stack host inside the shell: user config to options, then `startWeb` on a free loopback port. */
import { existsSync } from 'fs';
import { join, resolve } from 'path';
import { prepareDemo, prepareLive, redact, resolveRepo, startWeb, type RepoInfo, type WebOpts } from '../../src/cli/web';
import { BatchedGitStorage, type BatchedGitStorageOptions } from '../../src/core/storage-batch';

export interface UserConfig { repo?: string; dir?: string; mode?: string; branch?: string; remote?: string; batch?: number }

export interface HostPlan { repo: string; live: boolean; batchMinutes: number; branch?: string; remote?: string; home: string }

export interface HostHandle { url: string; close(): Promise<void> }

/** Seams for tests: every piece that touches git, the file system, or the network can be replaced. */
export interface HostDeps {
  webDir?: string;
  startWeb?: (o: WebOpts) => Promise<{ url: string; close(): Promise<void> }>;
  resolveRepo?: typeof resolveRepo;
  prepareLive?: typeof prepareLive;
  prepareDemo?: typeof prepareDemo;
  storage?: (dir: string, o: BatchedGitStorageOptions) => WebOpts['storage'];
  log?: (line: string) => void;
}

const NO_REPO = 'No content repo. Set "repo" in ~/.config/stack/config.json';

/** @req FR:desktop-shell/host.plan */
export function hostPlan(o: { cfg: UserConfig; env: NodeJS.ProcessEnv; home: string }): HostPlan {
  const repo = o.env.STACK_REPO || o.env.STACK_DIR || o.cfg.repo || o.cfg.dir;
  if (!repo) throw new Error(NO_REPO);
  const b = o.cfg.batch;
  if (b !== undefined && (typeof b !== 'number' || !Number.isFinite(b) || b < 0)) throw new Error('user config "batch" must be a number of minutes, 0 or more');
  return { repo, live: o.cfg.mode === 'live', batchMinutes: b ?? 5, branch: o.cfg.branch, remote: o.cfg.remote, home: o.home };
}

/** `web/dist` from the source layout (`desktop/src`) or the build layout (`desktop/dist/desktop/src`). @req FR:desktop-shell/host.webdir */
export function defaultWebDir(from = __dirname): string {
  const candidates = [resolve(from, '../../web/dist'), resolve(from, '../../../../web/dist')];
  return candidates.find((c) => existsSync(join(c, 'index.html'))) ?? candidates[0];
}

/** @req FR:desktop-shell/host.start @req FR:desktop-shell/host.webdir @req FR:desktop-shell/host.stop */
export async function startHost(plan: HostPlan, deps: HostDeps = {}): Promise<HostHandle> {
  const log = deps.log ?? ((l: string) => console.log(l));
  const webDir = deps.webDir ?? defaultWebDir();
  if (!existsSync(join(webDir, 'index.html'))) throw new Error('Web app not built. Run: pnpm build');
  const repo = (deps.resolveRepo ?? resolveRepo)(plan.repo, join(plan.home, '.config/stack/clones'));
  let dir: string; let info: RepoInfo; let label: string; let storage: WebOpts['storage'];
  if (plan.live) {
    const l = (deps.prepareLive ?? prepareLive)(repo, plan.branch, plan.remote);
    dir = l.dir;
    info = { mode: 'live', repo: redact(repo), branch: l.branch };
    label = `LIVE - ${redact(repo)} on ${l.branch}`;
    const opts: BatchedGitStorageOptions = { idleMs: plan.batchMinutes * 60_000, remote: l.remote, branch: l.branch, onError: (e) => log(`host: commit failed, edits kept and retried: ${e instanceof Error ? e.message : String(e)}`) };
    storage = deps.storage ? deps.storage(dir, opts) : new BatchedGitStorage(dir, opts);
  } else {
    dir = join(plan.home, '.config/stack/demo');
    (deps.prepareDemo ?? prepareDemo)(repo, dir);
    info = { mode: 'demo', repo: redact(repo), branch: 'main' };
    label = `DEMO COPY of ${redact(repo)} - edits stay in the copy`;
  }
  log(`host: ${info.mode} ${redact(repo)}`);
  const s = await (deps.startWeb ?? startWeb)({ dir, port: 0, webDir, label, info, storage });
  const url = `http://127.0.0.1:${new URL(s.url).port}`;
  let closed = false;
  return {
    url,
    close: async () => { if (closed) return; closed = true; await s.close(); },
  };
}
