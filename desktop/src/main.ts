/** Electron entry. The only file that imports `electron`; no logic of its own. */
import * as electron from 'electron';
import { homedir } from 'os';
import { join } from 'path';
import { userConfig } from '../../src/cli/discover';
import type { ShellElectron } from './electron-api';
import { hostPlan, startHost } from './host';
import { createShell } from './shell';

const home = homedir();
const log = (line: string) => console.log(line);
const shell = createShell({
  // The real module is wider than the shell's structural type; the shapes agree at runtime.
  electron: electron as unknown as ShellElectron,
  startHost: () => startHost(hostPlan({ cfg: userConfig(home), env: process.env, home }), { log }),
  assetsDir: join(__dirname, '../../../assets'),
  log,
});
void shell.start();
