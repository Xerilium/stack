import { CSP, harden, webPreferences, windowOptions } from '../src/policy';
import { fakeWindow } from './fakes';

const ORIGIN = 'http://127.0.0.1:4242';

function setup() {
  const opened: string[] = [];
  const log: string[] = [];
  const win = fakeWindow();
  harden(win, ORIGIN, { openExternal: async (u) => { opened.push(u); } }, (l) => log.push(l));
  return { win, opened, log };
}

describe('webPreferences', () => {
  // @req FR:desktop-shell/safe.prefs
  it('isolates the renderer and loads no preload', () => {
    const p = webPreferences();
    expect(p).toEqual({ contextIsolation: true, nodeIntegration: false, nodeIntegrationInWorker: false, sandbox: true, webSecurity: true, allowRunningInsecureContent: false, webviewTag: false });
    expect('preload' in p).toBe(false);
    expect(windowOptions().webPreferences).toEqual(p);
    expect(windowOptions().title).toBe('Stack');
  });
});

describe('harden: navigation', () => {
  // @req FR:desktop-shell/safe.navigate @req FR:desktop-shell/safe.remote
  it('lets the host origin navigate and blocks every other origin', () => {
    const { win, opened } = setup();
    expect(win.navigate(`${ORIGIN}/#/asks`)).toBe(false);
    expect(win.navigate('https://example.com/x')).toBe(true);
    expect(win.navigate('http://localhost:4242/')).toBe(true); // a different origin string, even if it is the same machine
    expect(opened).toEqual(['https://example.com/x', 'http://localhost:4242/']);
  });
  // @req FR:desktop-shell/safe.navigate @req FR:desktop-shell/safe.remote
  it('blocks redirects off the host origin', () => {
    const { win, opened } = setup();
    expect(win.redirect(`${ORIGIN}/#/now`)).toBe(false);
    expect(win.redirect('https://example.com/r')).toBe(true);
    expect(win.redirect('file:///etc/passwd')).toBe(true);
    expect(opened).toEqual(['https://example.com/r']);
  });
  // @req FR:desktop-shell/safe.navigate
  it('drops non-http schemes and bad urls', () => {
    const { win, opened } = setup();
    expect(win.navigate('file:///etc/passwd')).toBe(true);
    expect(win.navigate('javascript:alert(1)')).toBe(true);
    expect(win.navigate('not a url')).toBe(true);
    expect(opened).toEqual([]);
  });
  // @req FR:desktop-shell/safe.navigate @req FR:desktop-shell/window.load
  it('denies new windows: same origin loads in the window, http(s) opens outside, the rest is dropped', () => {
    const { win, opened } = setup();
    expect(win.open(`${ORIGIN}/#/today`)).toEqual({ action: 'deny' });
    expect(win.loaded).toEqual([`${ORIGIN}/#/today`]);
    expect(win.open('https://github.com/Xerilium/stack')).toEqual({ action: 'deny' });
    expect(win.open('file:///tmp/x')).toEqual({ action: 'deny' });
    expect(opened).toEqual(['https://github.com/Xerilium/stack']);
    expect(win.loaded).toHaveLength(1);
  });
});

describe('harden: headers and permissions', () => {
  // @req FR:desktop-shell/safe.csp
  it('adds the CSP when the host sent none and keeps the one it sent', () => {
    const { win } = setup();
    expect(win.headers({ url: `${ORIGIN}/`, responseHeaders: { 'content-type': ['text/html'] } })).toEqual({ 'content-type': ['text/html'], 'Content-Security-Policy': [CSP] });
    expect(win.headers({ url: `${ORIGIN}/` })).toEqual({ 'Content-Security-Policy': [CSP] });
    const sent = { 'content-security-policy': ["default-src 'none'"] };
    expect(win.headers({ url: `${ORIGIN}/`, responseHeaders: sent })).toEqual(sent);
    expect(CSP).toBe("default-src 'self'; img-src 'self' data:; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
  });
  // @req FR:desktop-shell/safe.permissions
  it('allows notifications from the host only; everything else is denied', () => {
    const { win } = setup();
    expect(win.permission('notifications', `${ORIGIN}/`)).toBe(true);
    expect(win.permission('notifications', 'https://example.com/')).toBe(false);
    expect(win.permission('media', `${ORIGIN}/`)).toBe(false);
    expect(win.permission('geolocation', `${ORIGIN}/`)).toBe(false);
    expect(win.permission('notifications', undefined)).toBe(false);
    expect(win.check('notifications', ORIGIN)).toBe(true);
    expect(win.check('notifications', 'https://example.com')).toBe(false);
    expect(win.check('media', ORIGIN)).toBe(false);
    expect(win.check('clipboard-read', ORIGIN)).toBe(false);
  });
});
