// Unsigned (ad-hoc) Mac build: Stack.app, zip, dmg in desktop/out. Plan in src/pack.ts. @req FR:desktop-app/package.build
import { packager } from '@electron/packager';
import { spawnSync } from 'child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'fs';
import { createRequire } from 'module';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const desktop = join(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(desktop, '..');
const json = (p) => JSON.parse(readFileSync(p, 'utf8'));
const run = (cmd, args, cwd = root) => { const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' }); if (r.status !== 0) process.exit(r.status ?? 1); };

if (process.platform !== 'darwin') { console.error('Packaging is macOS only'); process.exit(1); }
run('pnpm', ['--filter', '@xerilium/stack-desktop', 'build']);
const { packPlan } = createRequire(import.meta.url)(join(desktop, 'dist/desktop/src/pack.js'));
const p = packPlan({ root, rootPkg: json(join(root, 'package.json')), desktopPkg: json(join(desktop, 'package.json')) });

for (const [cmd, args] of p.build) run(cmd, args);
rmSync(join(root, 'desktop/out'), { recursive: true, force: true });
for (const [from, to] of p.copies) cpSync(from, to, { recursive: true });
writeFileSync(join(p.stageDir, 'package.json'), JSON.stringify(p.manifest, null, 2) + '\n');
run(...p.install);
mkdirSync(p.icon.iconset, { recursive: true });
for (const [cmd, args] of p.icon.commands) run(cmd, args);

await packager(p.packager);
run(...p.sign);
run(...p.zip);
mkdirSync(p.dmg.dir, { recursive: true });
run(...p.dmg.copy);
const [at, to] = p.dmg.link;
symlinkSync(to, at);
run(...p.dmg.create);
console.log(`Built:\n  ${p.appPath}\n  ${p.zipPath}\n  ${p.dmgPath}`);
