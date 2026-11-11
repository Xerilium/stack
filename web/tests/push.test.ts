import { describe, expect, it, vi } from 'vitest';
import { DEVICE_KEY, enablePush, keyBytes, loadDevice, platformOf, readPairing, stepFor } from '../src/push';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const IPHONE_CHROME = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/131.0 Mobile/15E148 Safari/604.1';
const IPAD_DESKTOP = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
const MAC = IPAD_DESKTOP;
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36';

// @req FR:iphone-access/install.detect
describe('platformOf', () => {
  it('finds iPhone Safari, other iOS browsers, and iPadOS', () => {
    expect(platformOf({ userAgent: IPHONE, maxTouchPoints: 5, standalone: false, push: false })).toEqual({ ios: true, safari: true, standalone: false, push: false });
    expect(platformOf({ userAgent: IPHONE_CHROME, maxTouchPoints: 5, standalone: false, push: false })).toMatchObject({ ios: true, safari: false });
    expect(platformOf({ userAgent: IPAD_DESKTOP, maxTouchPoints: 5, standalone: false, push: true })).toMatchObject({ ios: true, safari: true });
    expect(platformOf({ userAgent: MAC, maxTouchPoints: 0, standalone: false, push: true })).toMatchObject({ ios: false });
    expect(platformOf({ userAgent: ANDROID, maxTouchPoints: 5, standalone: true, push: true })).toEqual({ ios: false, safari: false, standalone: true, push: true });
  });
});

// @req FR:iphone-access/install.steps @req FR:iphone-access/install.pair
describe('stepFor', () => {
  const ios = { ios: true, safari: true, standalone: false, push: false };
  const st = { permission: 'default' as NotificationPermission, paired: true, subscribed: false };
  it('walks iOS from Safari tab to notifications on', () => {
    expect(stepFor(ios, st)).toBe('add-to-home');
    expect(stepFor({ ...ios, safari: false }, st)).toBe('open-in-safari');
    expect(stepFor({ ...ios, standalone: true }, st)).toBe('update-ios');
    const app = { ...ios, standalone: true, push: true };
    expect(stepFor(app, { ...st, paired: false })).toBe('pair');
    expect(stepFor(app, st)).toBe('enable');
    expect(stepFor(app, { ...st, permission: 'denied' })).toBe('blocked');
    expect(stepFor(app, { ...st, permission: 'granted', subscribed: true })).toBe('on');
    expect(stepFor(app, { ...st, permission: 'granted' })).toBe('enable');
  });
  it('sends other platforms to the browser install', () => {
    expect(stepFor({ ios: false, safari: false, standalone: false, push: true }, st)).toBe('desktop-install');
    expect(stepFor({ ios: false, safari: false, standalone: true, push: true }, st)).toBe('desktop-done');
  });
});

// @req FR:iphone-access/install.pair
describe('readPairing', () => {
  it('takes the token from the hash and clears it', () => {
    expect(readPairing('#/install?device=sk_abc.def')).toEqual({ token: 'sk_abc.def', hash: '#/install' });
    expect(readPairing('#/install')).toEqual({ hash: '#/install' });
    expect(readPairing('#/install?device=')).toEqual({ hash: '#/install' });
  });
  it('keeps the token in stack.device', () => {
    const m = new Map<string, string>();
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    expect(loadDevice(s)).toBeNull();
    m.set(DEVICE_KEY, 't');
    expect(DEVICE_KEY).toBe('stack.device');
    expect(loadDevice(s)).toBe('t');
  });
});

describe('keyBytes', () => {
  it('decodes base64url', () => {
    expect([...keyBytes('AQID_-8')]).toEqual([1, 2, 3, 255, 239]);
  });
});

// @req FR:iphone-access/install.gesture @req FR:iphone-access/install.subscribe
describe('enablePush', () => {
  const deps = (perm: NotificationPermission) => ({
    requestPermission: vi.fn().mockResolvedValue(perm),
    getKey: vi.fn().mockResolvedValue('AQID'),
    subscribe: vi.fn().mockResolvedValue({ endpoint: 'https://web.push.apple.com/x', keys: { p256dh: 'P', auth: 'A' } }),
    save: vi.fn().mockResolvedValue(undefined),
  });
  it('asks, subscribes with the server key, and saves', async () => {
    const d = deps('granted');
    expect(await enablePush(d)).toBe('on');
    expect(d.requestPermission).toHaveBeenCalledTimes(1);
    expect([...d.subscribe.mock.calls[0][0]]).toEqual([1, 2, 3]);
    expect(d.save).toHaveBeenCalledWith({ endpoint: 'https://web.push.apple.com/x', keys: { p256dh: 'P', auth: 'A' } });
  });
  it('stops on denied or dismissed', async () => {
    const d = deps('denied');
    expect(await enablePush(d)).toBe('blocked');
    expect(d.subscribe).not.toHaveBeenCalled();
    expect(await enablePush(deps('default'))).toBe('dismissed');
  });
  it('reports an error when the key or save fails', async () => {
    const d = deps('granted');
    d.save.mockRejectedValue(new Error('401'));
    expect(await enablePush(d)).toBe('error');
  });
});
