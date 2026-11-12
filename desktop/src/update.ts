/** The installer inside the app: real files, user config, and the detached helper wired into the shared updater. @req FR:devops-installer/arch.core */
import { join } from 'path';
import { buildPath, bundleOf, createAppUpdater, parseStamp, readSettings, readText, sourceDir, spawnHelperDetached, type AppUpdater, type HelperJob } from '../../src/core/app-update';
import { stackHome } from '../../src/core/reports';
import { readConfig, writeConfig } from '../../src/cli/setup';

export interface DesktopUpdaterOpts {
  home: string;
  env: NodeJS.ProcessEnv;
  /** `process.execPath`: the bundle the app runs from. */
  execPath: string;
  /** The folder with the app manifest (`package.json` with `stackBuild`). */
  appRoot: string;
  pid: number;
  /** Quits the app (Electron `app.quit`), which stops the host and commits the batch first. */
  quit: () => void;
  spawn?: (j: HelperJob) => void;
  log?: (line: string) => void;
}

export function desktopUpdater(o: DesktopUpdaterOpts): AppUpdater {
  const running = parseStamp(readText(join(o.appRoot, 'package.json')));
  return createAppUpdater({
    running,
    // Only a stamped Stack bundle swaps itself: a dev run (the Electron.app in node_modules) never does.
    target: running ? bundleOf(o.execPath) : null,
    // A Finder launch has no STACK_SOURCE: user config `update.source` is what the CLI and the app share.
    source: buildPath(sourceDir(o.env, o.home, readConfig(o.home))),
    stateDir: stackHome(o.env, o.home),
    pid: o.pid,
    readText,
    settings: () => readSettings(readConfig(o.home)),
    // @req FR:devops-installer/mode.setting
    saveSettings: (s) => { writeConfig(o.home, { update: { mode: s.mode, idleMinutes: s.idleMinutes } }); },
    spawnHelper: o.spawn ?? spawnHelperDetached,
    quit: o.quit,
    log: o.log,
  });
}
