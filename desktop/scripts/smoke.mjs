// Builds and launches the shell with the local Electron binary. Not run in CI. @req FR:desktop-shell/dev.smoke
// pnpm blocks electron's install script, so the binary is downloaded once by hand (see the message below).
import { spawn, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(desktop, '..');
const require = createRequire(import.meta.url);

if (!existsSync(join(desktop, 'node_modules/electron/path.txt'))) {
  console.error('Electron binary missing. Run: node desktop/node_modules/electron/install.js');
  process.exit(1);
}
const electron = require(join(desktop, 'node_modules/electron'));

const run = (cmd, args, cwd) => { const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' }); if (r.status !== 0) process.exit(r.status ?? 1); };
if (!existsSync(join(root, 'web/dist/index.html'))) run('pnpm', ['--filter', 'stack-web', 'build'], root);
run('pnpm', ['--filter', '@xerilium/stack-desktop', 'build'], root);

const child = spawn(electron, [desktop], { cwd: root, stdio: 'inherit' });
child.on('exit', (code) => process.exit(code ?? 0));
