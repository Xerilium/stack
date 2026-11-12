import { describe, expect, it } from 'vitest';
import { b64Bytes, isDesktopApp, pageContext } from '../src/feedback';

describe('feedback helpers', () => {
  // @req FR:feedback-button/ui.shot
  it('knows the desktop app by its user agent', () => {
    expect(isDesktopApp('Mozilla/5.0 Chrome/130 Electron/33.0.0 Safari/537.36')).toBe(true);
    expect(isDesktopApp('Mozilla/5.0 Chrome/130 Safari/537.36')).toBe(false);
  });
  // @req FR:feedback-button/store.line @req FR:feedback-button/store.redact
  it('sends route without the query, viewport and theme', () => {
    const w = { location: { pathname: '/', hash: '#list', search: '?token=x' }, innerWidth: 375, innerHeight: 812, matchMedia: () => ({ matches: true }) } as unknown as Window;
    expect(pageContext(w)).toEqual({ route: '/#list', viewport: '375x812', theme: 'dark' });
  });
  it('counts decoded base64 bytes', () => { expect(b64Bytes(btoa('abcd'))).toBe(4); expect(b64Bytes(btoa('abcde'))).toBe(5); });
});
