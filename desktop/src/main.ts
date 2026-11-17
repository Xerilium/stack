/** Electron entry. The only file that imports `electron`; no logic of its own. */
import * as electron from 'electron';
import { homedir } from 'os';
import { join } from 'path';
import type { ShellElectron } from './electron-api';
import { startLocalHost } from './local';
import { applyLoginPath } from './login-path';
import { createShell } from './shell';
import { desktopUpdater } from './update';

const home = homedir();
const log = (line: string) => console.log(line);
// The app manifest sits four levels up from desktop/dist/desktop/src. @req FR:devops-installer/quit.spawn
const update = desktopUpdater({ home, env: process.env, execPath: process.execPath, appRoot: join(__dirname, '../../../..'), pid: process.pid, quit: () => electron.app.quit(), log });
const shell = createShell({
  // The real module is wider than the shell's structural type; the shapes agree at runtime.
  electron: electron as unknown as ShellElectron,
  // A Finder launch has the bare system PATH: fix it first so the host and its agents inherit it. @req FR:desktop-shell/host.path
  // @req FR:first-run-onboarding/host.setup: no repo opens the setup flow instead of quitting.
  startHost: async () => { await applyLoginPath(process.env, { home, log }); return startLocalHost({ home, env: process.env, deps: { log, app: update, openUrl: (u: string) => electron.shell.openExternal(u) } }); },
  assetsDir: join(__dirname, '../../../assets'),
  log,
  update,
});
void shell.start();
