/** Unsigned Mac build: a pure plan of every path and command. `scripts/package.mjs` runs it. No Apple account. */
import { join } from 'path';

export type Cmd = [cmd: string, args: string[]];

export interface PackInput {
  root: string;
  rootPkg: { dependencies?: Record<string, string> };
  desktopPkg: { version: string; devDependencies?: Record<string, string> };
}

const NAME = 'Stack';
const ARCH = 'arm64';
const ICON_SIZES = [16, 32, 128, 256, 512];

/** @req FR:desktop-app/package.build */
export function checkPlatform(platform: string): void {
  if (platform !== 'darwin') throw new Error('Packaging is macOS only');
}

/** @req FR:desktop-app/package.build @req FR:desktop-app/package.stage @req FR:desktop-app/package.app @req FR:desktop-app/package.sign @req FR:desktop-app/package.dmg */
export function packPlan(i: PackInput) {
  const electronVersion = i.desktopPkg.devDependencies?.electron;
  if (!electronVersion) throw new Error('desktop/package.json has no electron devDependency');
  const version = i.desktopPkg.version;
  const out = join(i.root, 'desktop/out');
  const stageDir = join(out, 'stage');
  const appPath = join(out, `${NAME}-darwin-${ARCH}/${NAME}.app`);
  const zipPath = join(out, `${NAME}-${version}-${ARCH}.zip`);
  const dmgPath = join(out, `${NAME}-${version}-${ARCH}.dmg`);
  const iconset = join(out, `${NAME}.iconset`);
  const icns = join(out, `${NAME}.icns`);
  const iconSrc = join(i.root, 'web/public/icons/icon-512.png');
  const dmgDir = join(out, 'dmg');

  const iconCommands: Cmd[] = ICON_SIZES.flatMap((s) => [1, 2].filter((x) => s * x <= 512).map((x): Cmd =>
    ['sips', ['-z', String(s * x), String(s * x), iconSrc, '--out', join(iconset, `icon_${s}x${s}${x === 2 ? '@2x' : ''}.png`)]]));
  iconCommands.push(['iconutil', ['-c', 'icns', iconset, '-o', icns]]);

  return {
    build: [['pnpm', ['--filter', 'stack-web', 'build']], ['pnpm', ['--filter', '@xerilium/stack-desktop', 'build']]] as Cmd[],
    stageDir,
    copies: ['desktop/dist', 'desktop/assets', 'web/dist'].map((p): [string, string] => [join(i.root, p), join(stageDir, p)]),
    manifest: {
      name: 'stack-desktop', productName: NAME, version, private: true,
      main: 'desktop/dist/desktop/src/main.js', dependencies: i.rootPkg.dependencies ?? {},
    },
    install: ['npm', ['install', '--omit=dev', '--no-package-lock', '--no-audit', '--no-fund'], stageDir] as [string, string[], string],
    icon: { src: iconSrc, iconset, icns, commands: iconCommands },
    packager: {
      dir: stageDir, out, name: NAME, platform: 'darwin', arch: ARCH, electronVersion, appVersion: version,
      appBundleId: 'com.xerilium.stack', appCategoryType: 'public.app-category.productivity',
      asar: false, prune: false, overwrite: true, icon: icns,
    },
    appPath,
    sign: ['codesign', ['--force', '--deep', '--sign', '-', appPath]] as Cmd,
    zipPath,
    zip: ['ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', appPath, zipPath]] as Cmd,
    dmgPath,
    dmg: {
      dir: dmgDir,
      copy: ['ditto', [appPath, join(dmgDir, `${NAME}.app`)]] as Cmd,
      link: [join(dmgDir, 'Applications'), '/Applications'] as [string, string],
      create: ['hdiutil', ['create', '-volname', NAME, '-srcfolder', dmgDir, '-ov', '-format', 'UDZO', dmgPath]] as Cmd,
    },
  };
}
