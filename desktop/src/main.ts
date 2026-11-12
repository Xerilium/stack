/** Electron entry. The only file that imports `electron`; no logic of its own. */
import * as electron from 'electron';
import { homedir } from 'os';
import { join } from 'path';
import type { ShellElectron } from './electron-api';
import { startLocalHost } from './local';
import { createShell } from './shell';

const home = homedir();
const log = (line: string) => console.log(line);
const shell = createShell({
  // The real module is wider than the shell's structural type; the shapes agree at runtime.
  electron: electron as unknown as ShellElectron,
  // @req FR:first-run-onboarding/host.setup: no repo opens the setup flow instead of quitting.
  startHost: () => startLocalHost({ home, env: process.env, deps: { log } }),
  assetsDir: join(__dirname, '../../../assets'),
  log,
});
void shell.start();
