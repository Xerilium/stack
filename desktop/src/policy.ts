/** Renderer rules: web preferences, navigation guard, new-window handler, CSP fallback, permissions. */
import type { WebPreferences, WindowLike, WindowOptions } from './electron-api';

/** The policy the host serves from `staticwebapp.config.json`; the shell adds it when a response has none. @req FR:desktop-shell/safe.csp */
export const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

/** @req FR:desktop-shell/safe.prefs */
export function webPreferences(): WebPreferences {
  return { contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false };
}

/** @req FR:desktop-shell/safe.prefs */
export function windowOptions(): WindowOptions {
  return { width: 1200, height: 800, minWidth: 360, minHeight: 480, show: false, title: 'Stack', webPreferences: webPreferences() };
}

const origin = (url: string): string | undefined => { try { return new URL(url).origin; } catch { return undefined; } };
const isHttp = (url: string): boolean => /^https?:$/.test((() => { try { return new URL(url).protocol; } catch { return ''; } })());

/**
 * Applies the rules to one window: only `hostOrigin` loads inside it; `http(s)` targets elsewhere open in the default browser;
 * every other target is dropped. New windows are always denied.
 * @req FR:desktop-shell/safe.navigate @req FR:desktop-shell/safe.csp @req FR:desktop-shell/safe.permissions @req FR:desktop-shell/safe.remote
 */
export function harden(win: WindowLike, hostOrigin: string, shell: { openExternal(url: string): Promise<void> }, log: (line: string) => void = () => { /* quiet */ }): void {
  const outside = (url: string) => {
    if (isHttp(url)) void shell.openExternal(url).catch((e: unknown) => log(`open: ${e instanceof Error ? e.message : 'failed'}`));
    else log(`blocked: ${origin(url) ?? 'invalid url'}`);
  };
  win.webContents.on('will-navigate', (e, url) => {
    if (origin(url) === hostOrigin) return;
    e.preventDefault();
    outside(url);
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (origin(url) === hostOrigin) void win.loadURL(url);
    else outside(url);
    return { action: 'deny' };
  });
  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders ?? {};
    const has = Object.keys(headers).some((k) => k.toLowerCase() === 'content-security-policy');
    callback({ responseHeaders: has ? headers : { ...headers, 'Content-Security-Policy': [CSP] } });
  });
  win.webContents.session.setPermissionRequestHandler((_wc, permission, callback, details) => {
    callback(permission === 'notifications' && !!details.requestingUrl && origin(details.requestingUrl) === hostOrigin);
  });
}
