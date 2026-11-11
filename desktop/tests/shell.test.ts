import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { createShell, HOTKEY, type ShellDeps } from '../src/shell';
import { fakeElectron, item, type FakeElectron } from './fakes';

const URL_ = 'http://127.0.0.1:4242';

function setup(o: { locked?: boolean; shortcutsFree?: boolean; startHost?: ShellDeps['startHost']; closeTimeoutMs?: number } = {}) {
  const e: FakeElectron = fakeElectron({ locked: o.locked, shortcutsFree: o.shortcutsFree });
  const log: string[] = [];
  let closes = 0;
  const startHost: ShellDeps['startHost'] = o.startHost ?? (async () => ({ url: URL_, close: async () => { closes++; } }));
  const shell = createShell({ electron: e, startHost, assetsDir: '/assets', log: (l) => log.push(l), closeTimeoutMs: o.closeTimeoutMs ?? 50 });
  return { e, log, shell, closes: () => closes, win: () => e.windows[0], tray: () => e.trays[0] };
}

describe('instance', () => {
  // @req FR:desktop-shell/instance.lock
  it('quits at once when another instance holds the lock', async () => {
    const { e, shell, win, tray } = setup({ locked: false });
    await shell.start();
    expect(e.quitCount).toBe(1);
    expect(win()).toBeUndefined();
    expect(tray()).toBeUndefined();
    expect(e.shortcuts.size).toBe(0);
  });
  // @req FR:desktop-shell/instance.second
  it('a second launch shows and focuses the window', async () => {
    const { e, shell, win } = setup();
    await shell.start();
    win().hide();
    e.emit('second-instance');
    expect(win().isVisible()).toBe(true);
    expect(win().isFocused()).toBe(true);
    expect(e.windows).toHaveLength(1);
  });
  // @req FR:desktop-shell/instance.early
  it('activate or second-instance before the host starts waits, then shows the window', async () => {
    const { e, shell, win } = setup();
    const started = shell.start();
    expect(() => { e.emit('activate'); e.emit('second-instance'); }).not.toThrow();
    expect(e.windows).toHaveLength(0);
    await started;
    expect(e.windows).toHaveLength(1);
    expect(win().isVisible()).toBe(true);
  });
});

describe('window', () => {
  // @req FR:desktop-shell/window.load @req FR:desktop-shell/safe.prefs @req FR:desktop-shell/safe.remote
  it('loads only the host url into a hardened window', async () => {
    const { shell, win, e } = setup();
    await shell.start();
    expect(e.windows).toHaveLength(1);
    expect(win().loaded).toEqual([URL_]);
    expect(win().options.webPreferences).toMatchObject({ contextIsolation: true, nodeIntegration: false, sandbox: true });
    expect(win().navigate('https://example.com/')).toBe(true);
    expect(e.opened).toEqual(['https://example.com/']);
  });
  // @req FR:desktop-shell/window.hide
  it('closing hides the window and keeps the host', async () => {
    const { shell, win, closes } = setup();
    await shell.start();
    win().show();
    expect(win().close()).toBe(true);
    expect(win().isVisible()).toBe(false);
    expect(win().isDestroyed()).toBe(false);
    expect(closes()).toBe(0);
  });
  // @req FR:desktop-shell/window.toggle
  it('toggle hides a focused window and shows it otherwise', async () => {
    const { shell, win } = setup();
    await shell.start();
    win().show();
    shell.toggle();
    expect(win().isVisible()).toBe(false);
    shell.toggle();
    expect(win().isVisible()).toBe(true);
    expect(win().isFocused()).toBe(true);
    win().focused = false; // visible but behind another app
    shell.toggle();
    expect(win().isFocused()).toBe(true);
  });
  // @req FR:desktop-shell/window.hide
  it('the Dock (activate) shows the window', async () => {
    const { e, shell, win } = setup();
    await shell.start();
    e.emit('activate');
    expect(win().isVisible()).toBe(true);
  });
});

describe('tray and menu', () => {
  // @req FR:desktop-shell/tray.icon
  it('creates one tray from the template image with the Stack tooltip', async () => {
    const { e, shell, tray } = setup();
    await shell.start();
    expect(e.trays).toHaveLength(1);
    expect(e.images).toEqual(['/assets/trayTemplate.png']);
    expect(tray().tooltip).toBe('Stack');
  });
  // @req FR:desktop-shell/tray.menu
  it('tray menu opens, hides and quits; the icon toggles', async () => {
    const { e, shell, tray, win } = setup();
    await shell.start();
    expect(tray().menu?.map((i) => i.label ?? i.type)).toEqual(['Open Stack', 'Hide Stack', 'separator', 'Quit Stack']);
    item(tray().menu, 'Open Stack').click?.();
    expect(win().isVisible()).toBe(true);
    item(tray().menu, 'Hide Stack').click?.();
    expect(win().isVisible()).toBe(false);
    tray().click();
    expect(win().isVisible()).toBe(true);
    item(tray().menu, 'Quit Stack').click?.();
    await shell.stopped();
    expect(e.quitCount).toBe(1);
  });
  // @req FR:desktop-shell/tray.appmenu
  it('the application menu has Edit, View without developer tools, and Window', async () => {
    const { e, shell } = setup();
    await shell.start();
    const labels = e.appMenu?.map((m) => m.role ?? m.label);
    expect(labels).toEqual(expect.arrayContaining(['editMenu', 'windowMenu']));
    const view = e.appMenu?.find((m) => m.label === 'View');
    const roles = view?.submenu?.map((i) => i.role);
    expect(roles).toEqual(expect.arrayContaining(['reload', 'resetZoom', 'zoomIn', 'zoomOut', 'togglefullscreen']));
    expect(roles).not.toContain('toggleDevTools');
  });
});

describe('hotkey', () => {
  // @req FR:desktop-shell/hotkey.register
  it('registers CommandOrControl+Shift+Space bound to toggle', async () => {
    const { e, shell, win } = setup();
    await shell.start();
    expect(HOTKEY).toBe('CommandOrControl+Shift+Space');
    expect([...e.shortcuts.keys()]).toEqual([HOTKEY]);
    e.shortcuts.get(HOTKEY)?.();
    expect(win().isVisible()).toBe(true);
    e.shortcuts.get(HOTKEY)?.();
    expect(win().isVisible()).toBe(false);
  });
  // @req FR:desktop-shell/hotkey.register
  it('a taken hotkey is logged and the app goes on', async () => {
    const { shell, log, win } = setup({ shortcutsFree: false });
    await shell.start();
    expect(log).toContain(`hotkey: ${HOTKEY} is taken`);
    expect(win().loaded).toEqual([URL_]);
  });
});

describe('quit', () => {
  // @req FR:desktop-shell/quit.stop @req FR:desktop-shell/hotkey.release
  it('the first before-quit is held until the host is closed, shortcuts released and the tray gone', async () => {
    const { e, shell, closes, tray } = setup();
    await shell.start();
    e.app.quit();
    expect(e.quitCount).toBe(0); // held
    await shell.stopped();
    expect(closes()).toBe(1);
    expect(e.shortcuts.size).toBe(0);
    expect(tray().destroyed).toBe(true);
    expect(e.quitCount).toBe(1);
  });
  // @req FR:desktop-shell/quit.stop
  it('window-all-closed never quits', async () => {
    const { e, shell } = setup();
    await shell.start();
    e.emit('window-all-closed');
    expect(e.quitCount).toBe(0);
  });
  // @req FR:desktop-shell/quit.once
  it('a second quit while closing adds nothing; a host that throws still lets the app quit', async () => {
    let release: () => void = () => { /* set below */ };
    let closes = 0;
    const { e, shell } = setup({ startHost: async () => ({ url: URL_, close: () => { closes++; return new Promise<void>((ok) => { release = ok; }); } }) });
    await shell.start();
    e.app.quit();
    e.app.quit();
    expect(closes).toBe(1);
    expect(e.quitCount).toBe(0);
    release();
    await shell.stopped();
    expect(e.quitCount).toBe(1);

    const bad = setup({ startHost: async () => ({ url: URL_, close: async () => { throw new Error('flush failed'); } }) });
    await bad.shell.start();
    bad.e.app.quit();
    await bad.shell.stopped();
    expect(bad.e.quitCount).toBe(1);
    expect(bad.log.some((l) => l.includes('flush failed'))).toBe(true);
  });
  // @req FR:desktop-shell/quit.stop
  it('a host that hangs on close is abandoned after the timeout', async () => {
    const { e, shell } = setup({ startHost: async () => ({ url: URL_, close: () => new Promise<void>(() => { /* never */ }) }), closeTimeoutMs: 20 });
    await shell.start();
    e.app.quit();
    await shell.stopped();
    expect(e.quitCount).toBe(1);
  });
});

describe('host failure', () => {
  // @req FR:desktop-shell/host.fail
  it('logs and quits without a window or tray', async () => {
    const { e, shell, log } = setup({ startHost: async () => { throw new Error('No content repo. Set "repo" in ~/.config/stack/config.json'); } });
    await shell.start();
    expect(log).toContain('host: No content repo. Set "repo" in ~/.config/stack/config.json');
    expect(e.windows).toHaveLength(0);
    expect(e.trays).toHaveLength(0);
    expect(e.quitCount).toBe(1);
  });
  // @req NFR:desktop-shell/shell.log
  it('logs the host url on start', async () => {
    const { shell, log } = setup();
    await shell.start();
    expect(log).toContain(`shell: ${URL_}`);
  });
});

describe('test seam', () => {
  // @req NFR:desktop-shell/shell.test
  it('only main.ts imports electron', () => {
    const src = join(__dirname, '../src');
    const imports = (dir: string) => readdirSync(dir).filter((f) => f !== 'shell.test.ts' && /from ['"]electron['"]|require\(['"]electron['"]\)/.test(readFileSync(join(dir, f), 'utf8')));
    expect(imports(src)).toEqual(['main.ts']);
    expect(imports(__dirname)).toEqual([]);
  });
});
