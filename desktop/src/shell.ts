/**
 * Shell lifecycle: lock, host, window, tray, hotkey, quit. Takes an `electron`-shaped object so tests run it with fakes.
 * Logs carry the host url and lifecycle lines only: no tokens, environment, or request bodies.
 * @req NFR:desktop-shell/shell.test @req NFR:desktop-shell/shell.log
 */
import { join } from 'path';
import type { MenuItemTemplate, PreventableEvent, ShellElectron, TrayLike, WindowLike } from './electron-api';
import type { HostHandle } from './host';
import { harden, windowOptions } from './policy';

/** @req FR:desktop-shell/hotkey.register */
export const HOTKEY = 'CommandOrControl+Shift+Space';

export interface ShellDeps {
  electron: ShellElectron;
  startHost: () => Promise<HostHandle>;
  /** Folder with `trayTemplate.png`. */
  assetsDir: string;
  log?: (line: string) => void;
  /** How long quit waits for the host to flush. Default 15 s. */
  closeTimeoutMs?: number;
}

export interface Shell {
  /** Runs the whole startup. Resolves when the window is loading, or after `app.quit()` on a lock or host failure. */
  start(): Promise<void>;
  show(): void;
  hide(): void;
  toggle(): void;
  /** Resolves once a quit in progress has stopped the host (or at once when none is in progress). Test seam. */
  stopped(): Promise<void>;
}

export function createShell(deps: ShellDeps): Shell {
  const { app, BrowserWindow, Tray, Menu, globalShortcut, nativeImage, shell } = deps.electron;
  const log = deps.log ?? ((l: string) => console.log(l));
  const closeTimeoutMs = deps.closeTimeoutMs ?? 15_000;
  let host: HostHandle | undefined;
  let win: WindowLike | undefined;
  let tray: TrayLike | undefined;
  let stopping: Promise<void> | undefined;
  let done = false;

  /** @req FR:desktop-shell/window.load @req FR:desktop-shell/window.hide */
  const window = (): WindowLike => {
    if (win && !win.isDestroyed()) return win;
    const w = new BrowserWindow(windowOptions());
    harden(w, new URL(host!.url).origin, shell, log);
    // Close hides; the host keeps running. Quit (below) closes for real.
    w.on('close', (e: PreventableEvent) => { if (!stopping) { e.preventDefault(); w.hide(); } });
    void w.loadURL(host!.url);
    win = w;
    return w;
  };
  const show = () => { const w = window(); w.show(); w.focus(); };
  const hide = () => { win?.hide(); };
  /** @req FR:desktop-shell/window.toggle */
  const toggle = () => { if (win && win.isVisible() && win.isFocused()) hide(); else show(); };

  /** @req FR:desktop-shell/quit.stop @req FR:desktop-shell/quit.once @req FR:desktop-shell/hotkey.release */
  const stop = (): Promise<void> => {
    if (stopping) return stopping;
    stopping = (async () => {
      globalShortcut.unregisterAll();
      tray?.destroy();
      if (host) {
        const h = host;
        const timeout = new Promise<void>((ok) => setTimeout(() => { log('host: close timed out'); ok(); }, closeTimeoutMs).unref?.());
        await Promise.race([h.close().catch((e: unknown) => log(`host: close failed: ${e instanceof Error ? e.message : String(e)}`)), timeout]);
      }
      done = true;
    })();
    return stopping;
  };

  /** @req FR:desktop-shell/tray.menu */
  const trayMenu = (): MenuItemTemplate[] => [
    { label: 'Open Stack', click: show },
    { label: 'Hide Stack', click: hide },
    { type: 'separator' },
    { label: 'Quit Stack', click: () => app.quit() },
  ];

  /** @req FR:desktop-shell/tray.appmenu */
  const appMenu = (): MenuItemTemplate[] => [
    { label: 'Stack', submenu: [{ label: 'Show Stack', click: show }, { type: 'separator' }, { role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }, { role: 'quit' }] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { type: 'separator' }, { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
    { role: 'windowMenu' },
  ];

  const start = async (): Promise<void> => {
    // @req FR:desktop-shell/instance.lock
    if (!app.requestSingleInstanceLock()) { app.quit(); return; }
    // @req FR:desktop-shell/instance.second
    app.on('second-instance', show);
    app.on('activate', show);
    // @req FR:desktop-shell/quit.stop: a listener here keeps Electron from quitting on its own.
    app.on('window-all-closed', () => { /* tray app: keep running */ });
    app.on('before-quit', (e: PreventableEvent) => { if (!done) { e.preventDefault(); if (!stopping) void stop().then(() => app.quit()); } });
    await app.whenReady();
    // @req FR:desktop-shell/host.fail
    try { host = await deps.startHost(); } catch (e) { log(`host: ${e instanceof Error ? e.message : String(e)}`); done = true; app.quit(); return; }
    log(`shell: ${host.url}`);
    Menu.setApplicationMenu(Menu.buildFromTemplate(appMenu()));
    // @req FR:desktop-shell/tray.icon
    tray = new Tray(nativeImage.createFromPath(join(deps.assetsDir, 'trayTemplate.png')));
    tray.setToolTip('Stack');
    tray.setContextMenu(Menu.buildFromTemplate(trayMenu()));
    tray.on('click', toggle);
    // @req FR:desktop-shell/hotkey.register
    if (!globalShortcut.register(HOTKEY, toggle)) log(`hotkey: ${HOTKEY} is taken`);
    window();
  };

  return { start, show, hide, toggle, stopped: () => stopping ?? Promise.resolve() };
}
