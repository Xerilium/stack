/**
 * `stack app install|update|status`: build Stack.app from the source checkout and swap it into /Applications through the helper.
 * Never quits a running app unless asked (`--install`). @req FR:devops-installer/arch.core @req FR:devops-installer/arch.inject
 */
import { spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import {
  APP_TARGET, buildPath, isNewer, manifestPath, parseResult, parseStamp, pin, readSettings, readText, runHelperSync, sourceDir,
  type BuildStamp, type HelperJob, type UpdateMode, type UpdateResult,
} from '../core/app-update';
import { stackHome } from '../core/reports';
import { readConfig } from './setup';
import { UsageError } from './args';

export interface AppCliDeps {
  platform: string;
  home: string;
  env: NodeJS.ProcessEnv;
  /** Runs one build step with inherited stdio; answers the exit code. */
  run(cmd: string, args: string[], cwd: string): number;
  readText(p: string): string | null;
  exists(p: string): boolean;
  /** Whether an app runs from this bundle. */
  isRunning(target: string): boolean;
  /** Runs the helper and waits; answers what it recorded. */
  runHelper(j: HelperJob): UpdateResult | null;
  readConfig(): Record<string, unknown>;
}

/** @req FR:devops-installer/build.steps */
export const BUILD_STEPS: [string, string[]][] = [
  ['git', ['pull', '--ff-only']], ['pnpm', ['install', '--frozen-lockfile']], ['pnpm', ['build']], ['pnpm', ['desktop:package']],
];

const USAGE = 'Use: stack app install [--no-build] | update [--check | --install] [--no-build] | status [--source dir]';

/** @req FR:devops-installer/update.running */
const LANDS: Record<UpdateMode, string> = {
  'on-quit': 'Update ready: installs when you quit Stack',
  ask: 'Update ready: select Restart in Stack',
  'auto-idle': 'Update ready: installs when Stack is idle',
  off: 'Update built; updates are off. Run: stack app update --install',
};

const short = (s: BuildStamp | null) => (s ? `${s.sha}${s.dirty ? '+dirty' : ''} (${s.version}, built ${s.builtAt})` : 'none');

interface Out { json: Record<string, unknown>; text: string; code: number }

/**
 * @req FR:devops-installer/$install-result @req FR:devops-installer/install.output @req FR:devops-installer/update.output
 * @req FR:devops-installer/install.@cli @req FR:devops-installer/install.place @req FR:devops-installer/update.@cli @req FR:devops-installer/update.closed
 * @req FR:devops-installer/update.install @req FR:devops-installer/status.@cli
 */
export async function appCmd(action: string | undefined, f: Record<string, string | true>, d: AppCliDeps): Promise<Out> {
  if (action !== 'install' && action !== 'update' && action !== 'status') throw new UsageError(USAGE);
  if (f.check && f.install) throw new UsageError('Use --check or --install, not both');
  if (action !== 'update' && (f.check || f.install)) throw new UsageError(`--check and --install are for stack app update`);
  if (f.source === true) throw new UsageError('--source needs a folder');
  const cfg = d.readConfig();
  const source = typeof f.source === 'string' ? f.source : sourceDir(d.env, d.home, cfg);
  /** Where the app looks for builds: no shell env on a Finder launch. */
  const appSource = sourceDir({}, d.home, cfg);
  const build = buildPath(source);
  const stateDir = stackHome(d.env, d.home);
  const settings = readSettings(cfg);
  const installed = () => parseStamp(d.readText(manifestPath(APP_TARGET)));
  const available = () => parseStamp(d.readText(manifestPath(build)));
  const base = (outcome: string, extra: Record<string, unknown> = {}) => {
    const i = installed(); const a = available();
    return { ok: true, action, installed: i, available: a, ready: isNewer(a, i), mode: settings.mode, outcome, ...extra };
  };

  // @req FR:devops-installer/status.show
  if (action === 'status' || f.check) {
    const last = parseResult(d.readText(join(stateDir, 'update-result.json')));
    const j = base('checked', { last });
    const lastText = last ? `${last.ok ? 'done' : `failed at ${last.step}`} (${last.at})` : 'none';
    const text = [`installed: ${short(j.installed)}`, `available: ${short(j.available)}`, `ready: ${j.ready ? 'yes' : 'no'}`, `mode: ${settings.mode}`, `last update: ${lastText}`].join('\n');
    // @req FR:devops-installer/update.check
    return { json: j, text, code: action === 'update' && !j.ready ? 4 : 0 };
  }
  // @req FR:devops-installer/install.mac
  if (d.platform !== 'darwin') return { json: { ok: false, action, error: 'Stack.app is macOS only' }, text: 'Stack.app is macOS only', code: 1 };

  // @req FR:devops-installer/install.build @req FR:devops-installer/update.build @req FR:devops-installer/build.steps
  if (!f['no-build']) {
    for (const [cmd, args] of BUILD_STEPS) {
      if (d.run(cmd, args, source) !== 0) { const step = `${cmd} ${args.join(' ')}`; return { json: { ok: false, action, error: `Build failed: ${step}` }, text: `Build failed: ${step}`, code: 1 }; }
    }
  }
  // @req FR:devops-installer/install.nobuild
  if (!d.exists(build)) { const msg = `No build at ${build}. Run: stack app install`; return { json: { ok: false, action, error: msg }, text: msg, code: 1 }; }

  let relaunch: boolean; let quit: boolean;
  if (action === 'install') { relaunch = true; quit = true; } // @req FR:devops-installer/install.place
  else {
    const i = installed();
    // @req FR:devops-installer/update.current
    if (!isNewer(available(), i)) return { json: base('current'), text: `Up to date (${i?.sha ?? 'none'})`, code: 4 };
    if (f.install) { relaunch = true; quit = true; } // @req FR:devops-installer/update.install
    else if (d.isRunning(APP_TARGET)) {
      // @req FR:devops-installer/update.running @req FR:devops-installer/source.local: the running app must see this build.
      // An app from before build stamps cannot install an update itself. @req FR:devops-installer/update.running
      if (!i) return { json: base('manual'), text: 'The running Stack cannot install updates itself. Quit Stack and run: stack app update, or run: stack app update --install', code: 0 };
      if (appSource !== source) return { json: { ...base('elsewhere'), appSource }, text: `Stack reads builds from ${appSource}, not ${source}. Set "update.source" in ~/.config/stack/config.json, or run: stack app update --install`, code: 0 };
      return { json: base('staged'), text: LANDS[settings.mode], code: 0 };
    }
    else { relaunch = false; quit = false; } // @req FR:devops-installer/update.closed
  }
  const result = d.runHelper({ source: build, target: APP_TARGET, stateDir, relaunch, quit, ...pin(available()) });
  // @req FR:devops-installer/swap.result
  if (!result?.ok) {
    const msg = `Update failed at ${result?.step ?? 'start'}; rolled back. Log: ${join(stateDir, 'update.log')}`;
    return { json: { ...base('failed'), ok: false, result }, text: msg, code: 1 };
  }
  const j = base('installed', { result });
  const lines = [`Installed ${short(j.installed)}${relaunch ? ' and opened it' : ''}`];
  // @req FR:devops-installer/install.config
  if (action === 'install' && !d.env.STACK_REPO && !d.env.STACK_DIR && !cfg.repo && !cfg.dir) lines.push('First launch opens setup');
  return { json: j, text: lines.join('\n'), code: 0 };
}

/** The real deps. */
export function realAppDeps(home: string, env: NodeJS.ProcessEnv = process.env): AppCliDeps {
  return {
    platform: process.platform, home, env,
    run: (cmd, args, cwd) => spawnSync(cmd, args, { cwd, stdio: ['ignore', process.stderr, process.stderr] }).status ?? 1, // build output on stderr keeps --json stdout clean
    readText, exists: existsSync,
    isRunning: (target) => spawnSync('pgrep', ['-f', `${target}/Contents/MacOS/`], { stdio: 'ignore' }).status === 0,
    runHelper: runHelperSync,
    readConfig: () => readConfig(home) as Record<string, unknown>,
  };
}
