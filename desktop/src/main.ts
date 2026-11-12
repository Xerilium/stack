/** Electron entry. The only file that imports `electron`; no logic of its own. */
import * as electron from 'electron';
import { homedir } from 'os';
import { join } from 'path';
import type { ShellElectron } from './electron-api';
import { startLocalHost } from './local';
import { applyLoginPath } from './login-path';
import { createShell } from './shell';

const home = homedir();
const log = (line: string) => console.log(line);
const shell = createShell({
  // The real module is wider than the shell's structural type; the shapes agree at runtime.
  electron: electron as unknown as ShellElectron,
  // A Finder launch has the bare system PATH: fix it first so the host and its agents inherit it. @req FR:desktop-shell/host.path
  // @req FR:first-run-onboarding/host.setup: no repo opens the setup flow instead of quitting.
  startHost: async () => { await applyLoginPath(process.env, { home, log }); return startLocalHost({ home, env: process.env, deps: { log } }); },
  assetsDir: join(__dirname, '../../../assets'),
  log,
});
void shell.start();
