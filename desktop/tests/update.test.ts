import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import type { HelperJob } from '../../src/core/app-update';
import { createShell } from '../src/shell';
import { desktopUpdater } from '../src/update';
import { fakeElectron, item } from './fakes';

const URL_ = 'http://127.0.0.1:4242';

function setup(o: { onQuit?: () => boolean; idleCheck?: (s: number, f: boolean) => boolean; idle?: number; closeLog?: string[] } = {}) {
  const e = fakeElectron();
  const order: string[] = o.closeLog ?? [];
  const update = { onQuit: o.onQuit ?? (() => { order.push('helper'); return true; }), idleCheck: o.idleCheck ?? (() => false) };
  const shell = createShell({
    electron: { ...e, powerMonitor: { getSystemIdleTime: () => o.idle ?? 0 } }, assetsDir: '/a', log: () => undefined, closeTimeoutMs: 50, needsCount: async () => 0,
    startHost: async () => ({ url: URL_, close: async () => { order.push('host closed'); } }),
    update, idleMs: 10,
  });
  return { e, shell, order };
}

describe('shell: install on quit', () => {
  // @req FR:devops-installer/quit.flush @req FR:devops-installer/quit.spawn
  it('stops the host (which commits the batch) before it starts the helper, then quits', async () => {
    const { e, shell, order } = setup();
    await shell.start();
    e.app.quit();
    await shell.stopped();
    expect(order).toEqual(['host closed', 'helper']);
    await new Promise((r) => setImmediate(r));
    expect(e.quitCount).toBe(1);
  });
  // @req FR:devops-installer/quit.fast
  it('a hook that throws never blocks quit', async () => {
    const { e, shell } = setup({ onQuit: () => { throw new Error('boom'); } });
    await shell.start();
    e.app.quit();
    await shell.stopped();
    await new Promise((r) => setImmediate(r));
    expect(e.quitCount).toBe(1);
  });
});

describe('shell: idle check', () => {
  // @req FR:devops-installer/idle.check
  it('asks the updater once per interval with the system idle seconds and whether the window shows', async () => {
    let first: (v: [number, boolean]) => void = () => undefined;
    const checked = new Promise<[number, boolean]>((ok) => { first = ok; });
    const { e, shell } = setup({ idle: 1800, idleCheck: (s, f) => { first([s, f]); return false; } });
    await shell.start();
    e.windows[0].hide();
    expect(await checked).toEqual([1800, false]);
    e.app.quit();
    await shell.stopped();
  });
});

describe('shell: Updates menu', () => {
  // @req FR:devops-installer/notice.menu
  it('Stack > Updates… shows the window on the updates page', async () => {
    const { e, shell } = setup();
    await shell.start();
    const stack = item(e.appMenu, 'Stack');
    item(stack.submenu, 'Updates…').click?.();
    expect(e.windows[0].isVisible()).toBe(true);
    expect(e.windows[0].loaded.at(-1)).toBe(`${URL_}/#/updates`);
    e.app.quit();
    await shell.stopped();
  });
});

describe('desktop updater wiring', () => {
  const stamp = { version: '0.0.1', sha: 'bbbbbbbbbbbb', dirty: false, builtAt: '2026-11-12T10:00:00.000Z' };
  function world() {
    const home = mkdtempSync(join(tmpdir(), 'stack-dupd-'));
    const appRoot = join(home, 'Stack.app/Contents/Resources/app');
    mkdirSync(appRoot, { recursive: true });
    writeFileSync(join(appRoot, 'package.json'), JSON.stringify({ stackBuild: { ...stamp, sha: 'aaaaaaaaaaaa', builtAt: '2026-11-01T00:00:00.000Z' } }));
    const build = join(home, 'src/desktop/out/Stack-darwin-arm64/Stack.app/Contents/Resources/app');
    mkdirSync(build, { recursive: true });
    writeFileSync(join(build, 'package.json'), JSON.stringify({ stackBuild: stamp }));
    return { home, appRoot };
  }
  // @req FR:devops-installer/arch.core @req FR:devops-installer/mode.setting @req FR:devops-installer/quit.spawn
  it('reads its own stamp, the source build, and the user config; saves the mode there', () => {
    const w = world();
    const jobs: HelperJob[] = []; let quits = 0;
    const u = desktopUpdater({
      home: w.home, env: { STACK_SOURCE: join(w.home, 'src') }, execPath: join(w.home, 'Stack.app/Contents/MacOS/Stack'), appRoot: w.appRoot, pid: 7,
      quit: () => { quits++; }, spawn: (j) => { jobs.push(j); },
    });
    expect(u.state()).toMatchObject({ ready: true, canRestart: true, mode: 'on-quit', available: stamp });
    u.setMode('ask');
    expect(JSON.parse(readFileSync(join(w.home, '.config/stack/config.json'), 'utf8'))).toEqual({ update: { mode: 'ask', idleMinutes: 30 } });
    u.restart();
    expect(jobs).toEqual([expect.objectContaining({ target: join(w.home, 'Stack.app'), stateDir: join(w.home, '.stack'), pid: 7, relaunch: true })]);
    expect(quits).toBe(1);
  });
  // @req FR:devops-installer/arch.inject
  it('a dev run (no stamp, the Electron.app in node_modules) never swaps itself', () => {
    const w = world();
    const u = desktopUpdater({ home: w.home, env: { STACK_SOURCE: join(w.home, 'src') }, execPath: '/r/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron', appRoot: join(w.home, 'none'), pid: 7, quit: () => undefined, spawn: () => { throw new Error('no'); } });
    expect(u.state()).toMatchObject({ running: null, canRestart: false });
    expect(u.onQuit()).toBe(false);
  });
});
