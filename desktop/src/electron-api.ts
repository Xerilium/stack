/**
 * The slice of Electron the shell uses, as structural types.
 * `main.ts` passes the real `electron` module; tests pass fakes. Nothing else imports `electron`.
 */

export type Listener = (...args: never[]) => void;

export interface PreventableEvent { preventDefault(): void }

export interface AppLike {
  requestSingleInstanceLock(): boolean;
  quit(): void;
  whenReady(): Promise<void>;
  /** Dock badge (macOS) and launcher count (Linux). @req FR:pris-sessions-ui/tray.badge */
  setBadgeCount?(count: number): boolean;
  on(event: string, fn: (...args: any[]) => void): unknown; // eslint-disable-line @typescript-eslint/no-explicit-any -- Electron's own listener shape
}

/** @req FR:desktop-shell/safe.prefs */
export interface WebPreferences {
  contextIsolation: boolean;
  nodeIntegration: boolean;
  nodeIntegrationInWorker: boolean;
  sandbox: boolean;
  webSecurity: boolean;
  allowRunningInsecureContent: boolean;
  webviewTag: boolean;
  preload?: string;
}

export interface WindowOptions { width: number; height: number; minWidth: number; minHeight: number; show: boolean; title: string; webPreferences: WebPreferences }

export interface HeadersDetails { url: string; responseHeaders?: Record<string, string[]> }
export type HeadersCallback = (r: { responseHeaders?: Record<string, string[]> }) => void;
export type PermissionHandler = (webContents: unknown, permission: string, callback: (ok: boolean) => void, details: { requestingUrl?: string }) => void;

export type PermissionCheckHandler = (webContents: unknown, permission: string, requestingOrigin: string) => boolean;

export interface SessionLike {
  webRequest: { onHeadersReceived(fn: (details: HeadersDetails, callback: HeadersCallback) => void): void };
  setPermissionRequestHandler(fn: PermissionHandler | null): void;
  setPermissionCheckHandler(fn: PermissionCheckHandler | null): void;
}

export interface WebContentsLike {
  on(event: 'will-navigate' | 'will-redirect', fn: (e: PreventableEvent, url: string) => void): unknown;
  setWindowOpenHandler(fn: (details: { url: string }) => { action: 'deny' } | { action: 'allow' }): void;
  session: SessionLike;
}

export interface WindowLike {
  loadURL(url: string): Promise<void>;
  show(): void;
  hide(): void;
  focus(): void;
  isVisible(): boolean;
  isFocused(): boolean;
  isDestroyed(): boolean;
  on(event: string, fn: (...args: any[]) => void): unknown; // eslint-disable-line @typescript-eslint/no-explicit-any -- Electron's own listener shape
  webContents: WebContentsLike;
}

export interface TrayLike {
  setToolTip(text: string): void;
  /** Text beside the icon (macOS). @req FR:pris-sessions-ui/tray.badge */
  setTitle?(title: string): void;
  setContextMenu(menu: unknown): void;
  on(event: string, fn: () => void): unknown;
  destroy(): void;
}

export interface MenuItemTemplate { label?: string; type?: 'separator'; role?: string; click?: () => void; submenu?: MenuItemTemplate[] }

export interface ShellElectron {
  app: AppLike;
  BrowserWindow: new (options: WindowOptions) => WindowLike;
  Tray: new (image: unknown) => TrayLike;
  Menu: { buildFromTemplate(template: MenuItemTemplate[]): unknown; setApplicationMenu(menu: unknown | null): void };
  globalShortcut: { register(accelerator: string, fn: () => void): boolean; unregisterAll(): void };
  nativeImage: { createFromPath(path: string): unknown };
  shell: { openExternal(url: string): Promise<void> };
  /** System idle seconds for the idle restart. @req FR:devops-installer/idle.check */
  powerMonitor?: { getSystemIdleTime(): number };
}
