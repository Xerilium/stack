/** Fake `electron` objects for the shell tests. No Electron, no processes. @req NFR:desktop-shell/shell.test */
import type { AppLike, HeadersDetails, HeadersCallback, MenuItemTemplate, PermissionCheckHandler, PermissionHandler, PreventableEvent, ShellElectron, TrayLike, WindowLike, WindowOptions } from '../src/electron-api';

type Fn = (...args: any[]) => void;

class Emitter {
  private listeners = new Map<string, Fn[]>();
  on(event: string, fn: Fn): this { this.listeners.set(event, [...(this.listeners.get(event) ?? []), fn]); return this; }
  emit(event: string, ...args: unknown[]): number { const l = this.listeners.get(event) ?? []; for (const f of l) f(...args); return l.length; }
  has(event: string): boolean { return (this.listeners.get(event) ?? []).length > 0; }
}

export interface FakeWindow extends WindowLike {
  options: WindowOptions;
  loaded: string[];
  visible: boolean;
  focused: boolean;
  destroyed: boolean;
  /** Emits `close`; returns true when the shell prevented it (hid the window instead). */
  close(): boolean;
  /** Emits `will-navigate`; returns true when prevented. */
  navigate(url: string): boolean;
  open(url: string): { action: 'deny' } | { action: 'allow' };
  headers(d: HeadersDetails): Record<string, string[]> | undefined;
  permission(name: string, requestingUrl: string | undefined): boolean;
  /** Calls the permission check handler; true when no handler is set (Electron's default). */
  check(name: string, requestingOrigin: string): boolean;
  /** Emits `will-redirect`; returns true when prevented. */
  redirect(url: string): boolean;
}

export function fakeWindow(options: WindowOptions = windowDefaults()): FakeWindow {
  const em = new Emitter();
  const nav: Record<string, (e: PreventableEvent, url: string) => void> = {};
  let check: PermissionCheckHandler | null = null;
  let opener: ((d: { url: string }) => { action: 'deny' } | { action: 'allow' }) | undefined;
  let headers: ((d: HeadersDetails, cb: HeadersCallback) => void) | undefined;
  let perm: PermissionHandler | null = null;
  const w: FakeWindow = {
    options, loaded: [], visible: false, focused: false, destroyed: false,
    loadURL: async (url) => { w.loaded.push(url); },
    show: () => { w.visible = true; w.focused = true; },
    hide: () => { w.visible = false; w.focused = false; },
    focus: () => { w.focused = true; },
    isVisible: () => w.visible,
    isFocused: () => w.focused,
    isDestroyed: () => w.destroyed,
    on: (event, fn) => em.on(event, fn),
    webContents: {
      on: (event, fn) => { nav[event] = fn; },
      setWindowOpenHandler: (fn) => { opener = fn; },
      session: {
        webRequest: { onHeadersReceived: (fn) => { headers = fn; } },
        setPermissionRequestHandler: (fn) => { perm = fn; },
        setPermissionCheckHandler: (fn) => { check = fn; },
      },
    },
    close: () => { let prevented = false; em.emit('close', { preventDefault: () => { prevented = true; } }); if (!prevented) w.destroyed = true; return prevented; },
    navigate: (url) => { let prevented = false; nav['will-navigate']?.({ preventDefault: () => { prevented = true; } }, url); return prevented; },
    redirect: (url) => { let prevented = false; nav['will-redirect']?.({ preventDefault: () => { prevented = true; } }, url); return prevented; },
    check: (name, requestingOrigin) => check ? check({}, name, requestingOrigin) : true,
    open: (url) => opener?.({ url }) ?? { action: 'allow' },
    headers: (d) => { let out: Record<string, string[]> | undefined = d.responseHeaders; headers?.(d, (r) => { out = r.responseHeaders; }); return out; },
    permission: (name, requestingUrl) => { let ok = true; perm?.({}, name, (v) => { ok = v; }, { requestingUrl }); return ok; },
  };
  return w;
}

export function windowDefaults(): WindowOptions {
  return { width: 1, height: 1, minWidth: 1, minHeight: 1, show: false, title: 't', webPreferences: { contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false } };
}

export interface FakeTray extends TrayLike { tooltip?: string; title?: string; menu?: MenuItemTemplate[]; destroyed: boolean; click(): void }

export interface FakeElectron extends ShellElectron {
  /** Emits an app event. */
  emit(event: string, ...args: unknown[]): number;
  /** Emits `before-quit`; when nothing prevents it the quit counts. Mirrors `app.quit()`. */
  quitCount: number;
  locked: boolean;
  windows: FakeWindow[];
  trays: FakeTray[];
  shortcuts: Map<string, () => void>;
  shortcutsFree: boolean;
  appMenu?: MenuItemTemplate[];
  /** Last dock badge count. */
  badge?: number;
  opened: string[];
  images: string[];
}

export function fakeElectron(o: { locked?: boolean; shortcutsFree?: boolean } = {}): FakeElectron {
  const em = new Emitter();
  const app: AppLike = {
    requestSingleInstanceLock: () => e.locked,
    quit: () => { let prevented = false; em.emit('before-quit', { preventDefault: () => { prevented = true; } }); if (!prevented) { e.quitCount++; em.emit('will-quit', { preventDefault: () => { /* too late */ } }); } },
    whenReady: async () => { /* ready at once */ },
    setBadgeCount: (n) => { e.badge = n; return true; },
    on: (event, fn) => em.on(event, fn),
  };
  const e: FakeElectron = {
    app,
    emit: (event, ...args) => em.emit(event, ...args),
    quitCount: 0,
    locked: o.locked ?? true,
    windows: [],
    trays: [],
    shortcuts: new Map(),
    shortcutsFree: o.shortcutsFree ?? true,
    opened: [],
    images: [],
    BrowserWindow: class { constructor(options: WindowOptions) { const w = fakeWindow(options); e.windows.push(w); return w; } } as unknown as new (options: WindowOptions) => WindowLike,
    Tray: class {
      constructor(image: unknown) {
        const tem = new Emitter();
        const t: FakeTray = {
          destroyed: false,
          setToolTip: (text) => { t.tooltip = text; },
          setTitle: (text) => { t.title = text; },
          setContextMenu: (menu) => { t.menu = menu as MenuItemTemplate[]; },
          on: (event, fn) => tem.on(event, fn),
          destroy: () => { t.destroyed = true; },
          click: () => { tem.emit('click'); },
        };
        void image;
        e.trays.push(t);
        return t;
      }
    } as unknown as new (image: unknown) => TrayLike,
    Menu: { buildFromTemplate: (t) => t, setApplicationMenu: (m) => { e.appMenu = m as MenuItemTemplate[]; } },
    globalShortcut: { register: (acc, fn) => { if (!e.shortcutsFree) return false; e.shortcuts.set(acc, fn); return true; }, unregisterAll: () => { e.shortcuts.clear(); } },
    nativeImage: { createFromPath: (p) => { e.images.push(p); return { path: p }; } },
    shell: { openExternal: async (url) => { e.opened.push(url); } },
  };
  return e;
}

/** Finds a menu item by label in a flat template. */
export const item = (menu: MenuItemTemplate[] | undefined, label: string): MenuItemTemplate => {
  const m = menu?.find((i) => i.label === label);
  if (!m) throw new Error(`no menu item ${label}`);
  return m;
};
