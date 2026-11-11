import { readFileSync } from 'fs';
import { join } from 'path';
import { checkPlatform, packPlan } from '../src/pack';

const root = '/repo';
const plan = () => packPlan({
  root,
  rootPkg: { dependencies: { yaml: '^2.9.1', zod: '4.6.7' }, devDependencies: { jest: '30.2.0' } },
  desktopPkg: { version: '1.2.3', devDependencies: { electron: '45.3.0' } },
});
const out = join(root, 'desktop/out');

describe('desktop packaging plan', () => {
  /** @req FR:desktop-app/package.build */
  it('runs on macOS only', () => {
    expect(() => checkPlatform('darwin')).not.toThrow();
    expect(() => checkPlatform('linux')).toThrow('Packaging is macOS only');
  });

  /** @req FR:desktop-app/package.build */
  it('builds web, then writes the app, zip, and dmg under desktop/out', () => {
    const p = plan();
    expect(p.build).toEqual([['pnpm', ['--filter', 'stack-web', 'build']]]);
    expect(p.cleanup).toEqual([p.stageDir, p.dmg.dir, p.icon.iconset, p.icon.icns]);
    expect(p.appPath).toBe(join(out, 'Stack-darwin-arm64/Stack.app'));
    expect(p.zipPath).toBe(join(out, 'Stack-1.2.3-arm64.zip'));
    expect(p.dmgPath).toBe(join(out, 'Stack-1.2.3-arm64.dmg'));
  });

  /** @req FR:desktop-app/package.stage */
  it('stages the built shell, assets, and web app with the root dependencies', () => {
    const p = plan();
    expect(p.copies).toEqual([
      [join(root, 'desktop/dist'), join(p.stageDir, 'desktop/dist')],
      [join(root, 'desktop/assets'), join(p.stageDir, 'desktop/assets')],
      [join(root, 'web/dist'), join(p.stageDir, 'web/dist')],
      [join(root, 'pnpm-lock.yaml'), join(p.stageDir, 'pnpm-lock.yaml')],
    ]);
    expect(p.manifest).toEqual({
      name: 'stack-desktop', productName: 'Stack', version: '1.2.3', private: true,
      main: 'desktop/dist/desktop/src/main.js', dependencies: { yaml: '^2.9.1', zod: '4.6.7' }, devDependencies: { jest: '30.2.0' },
    });
  });

  /** @req FR:desktop-app/package.stage */
  it('installs production dependencies flat from the repo lockfile, outside the workspace', () => {
    const [cmd, args, cwd] = plan().install;
    expect(cmd).toBe('pnpm');
    expect(args).toEqual(['install', '--prod', '--frozen-lockfile', '--ignore-workspace', '--config.node-linker=hoisted']);
    expect(cwd).toBe(plan().stageDir);
  });

  /** @req FR:desktop-app/package.app */
  it('packages an arm64 Stack bundle without asar, with the Stack icon', () => {
    const p = plan();
    expect(p.packager).toMatchObject({
      dir: p.stageDir, out, name: 'Stack', platform: 'darwin', arch: 'arm64', electronVersion: '45.3.0',
      appVersion: '1.2.3', appBundleId: 'com.xerilium.stack', appCategoryType: 'public.app-category.productivity',
      asar: false, prune: false, overwrite: true, icon: p.icon.icns,
    });
    expect(p.icon.src).toBe(join(root, 'web/public/icons/icon-512.png'));
    expect(p.icon.commands.at(-1)).toEqual(['iconutil', ['-c', 'icns', p.icon.iconset, '-o', p.icon.icns]]);
  });

  /** @req FR:desktop-app/package.sign */
  it('ad-hoc signs and never uses an Apple identity or notarization', () => {
    const p = plan();
    expect(p.sign).toEqual(['codesign', ['--force', '--deep', '--sign', '-', p.appPath]]);
    expect(p.packager).not.toHaveProperty('osxSign');
    expect(p.packager).not.toHaveProperty('osxNotarize');
  });

  /** @req FR:desktop-app/package.dmg */
  it('zips with ditto and builds a drag-to-Applications dmg', () => {
    const p = plan();
    expect(p.zip).toEqual(['ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', p.appPath, p.zipPath]]);
    expect(p.dmg.link).toEqual([join(p.dmg.dir, 'Applications'), '/Applications']);
    expect(p.dmg.copy).toEqual(['ditto', [p.appPath, join(p.dmg.dir, 'Stack.app')]]);
    expect(p.dmg.create).toEqual(['hdiutil', ['create', '-volname', 'Stack', '-srcfolder', p.dmg.dir, '-ov', '-format', 'UDZO', p.dmgPath]]);
  });
});

describe('desktop install doc', () => {
  /** @req FR:desktop-app/package.docs */
  it('gives the build command, install steps, first launch, and how the host is found', () => {
    const doc = readFileSync(join(__dirname, '../../docs/desktop-install.md'), 'utf8');
    for (const s of ['pnpm desktop:package', '/Applications', 'Open Anyway', 'macOS 14', 'xattr -dr com.apple.quarantine', '`gh`', '~/.config/stack/config.json', '127.0.0.1']) expect(doc).toContain(s);
  });
});
