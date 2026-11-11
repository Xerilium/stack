/**
 * iOS install and Web Push opt-in: pure helpers plus a thin browser layer.
 * @req FR:iphone-access/install.detect @req FR:iphone-access/install.steps @req FR:iphone-access/install.pair @req FR:iphone-access/install.subscribe
 */
export const DEVICE_KEY = 'stack.device';
type Store = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

export interface Platform { ios: boolean; safari: boolean; standalone: boolean; push: boolean }
export type Step = 'add-to-home' | 'open-in-safari' | 'update-ios' | 'pair' | 'enable' | 'blocked' | 'on' | 'desktop-install' | 'desktop-done';

const IOS = /\b(iPhone|iPod|iPad)\b/;
const OTHER_IOS_BROWSER = /\b(CriOS|FxiOS|EdgiOS|OPiOS)\//;

/** iPadOS reports a Mac user agent; touch points tell it apart. @req FR:iphone-access/install.detect */
export function platformOf(e: { userAgent: string; maxTouchPoints: number; standalone: boolean; push: boolean }): Platform {
  const ios = IOS.test(e.userAgent) || (/\bMacintosh\b/.test(e.userAgent) && e.maxTouchPoints > 1);
  return { ios, safari: ios && !OTHER_IOS_BROWSER.test(e.userAgent), standalone: e.standalone, push: e.push };
}

/** The one step to show. @req FR:iphone-access/install.steps */
export function stepFor(p: Platform, s: { permission: NotificationPermission; paired: boolean; subscribed: boolean }): Step {
  if (!p.ios) return p.standalone ? 'desktop-done' : 'desktop-install';
  if (!p.standalone) return p.safari ? 'add-to-home' : 'open-in-safari';
  if (!p.push) return 'update-ios';
  if (!s.paired) return 'pair';
  if (s.permission === 'denied') return 'blocked';
  if (s.permission === 'granted' && s.subscribed) return 'on';
  return 'enable';
}

/** `#/install?device=<token>` -> the token and the clean hash. @req FR:iphone-access/install.pair */
export function readPairing(hash: string): { token?: string; hash: string } {
  const m = /^#\/install(?:\?(.*))?$/.exec(hash);
  if (!m) return { hash };
  const token = new URLSearchParams(m[1] ?? '').get('device') ?? '';
  return token ? { token, hash: '#/install' } : { hash: '#/install' };
}

export const loadDevice = (s: Store | undefined): string | null => { try { return s?.getItem(DEVICE_KEY) || null; } catch { return null; } };
export function saveDevice(s: Store | undefined, token: string): void { try { s?.setItem(DEVICE_KEY, token); } catch { /* storage is a convenience */ } }
/** The one place the client keeps the device token. @req FR:iphone-access/install.pair */
export const deviceStore = (): Store | undefined => { try { return localStorage; } catch { return undefined; } };

/** base64url -> bytes for `applicationServerKey`. */
export function keyBytes(b64u: string): Uint8Array {
  const b64 = b64u.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (b64u.length % 4)) % 4);
  const bin = atob(b64);
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
}

export interface SubJson { endpoint: string; keys: { p256dh: string; auth: string } }
export interface EnableDeps {
  requestPermission: () => Promise<NotificationPermission>;
  getKey: () => Promise<string>;
  subscribe: (key: Uint8Array) => Promise<SubJson>;
  save: (sub: SubJson) => Promise<void>;
}

/** Call only from a click handler: iOS allows the prompt only from a user gesture. @req FR:iphone-access/install.gesture @req FR:iphone-access/install.subscribe */
export async function enablePush(d: EnableDeps): Promise<'on' | 'blocked' | 'dismissed' | 'error'> {
  const perm = await d.requestPermission();
  if (perm === 'denied') return 'blocked';
  if (perm !== 'granted') return 'dismissed';
  try {
    const sub = await d.subscribe(keyBytes(await d.getKey()));
    await d.save({ endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } });
    return 'on';
  } catch {
    return 'error';
  }
}

/** The browser side of `enablePush`; the token goes only to the device endpoints. */
export function browserDeps(token: string): EnableDeps {
  const h = { authorization: `Bearer ${token}` };
  return {
    requestPermission: () => Notification.requestPermission(),
    getKey: async () => {
      const r = await fetch('/api/auth/devices/me/push-key', { headers: h, credentials: 'omit' });
      if (!r.ok) throw new Error(`push-key ${r.status}`);
      return ((await r.json()) as { key: string }).key;
    },
    subscribe: async (key) => {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key as BufferSource });
      return sub.toJSON() as SubJson;
    },
    save: async (sub) => {
      const r = await fetch('/api/auth/devices/me/push', { method: 'PUT', headers: { ...h, 'content-type': 'application/json' }, credentials: 'omit', body: JSON.stringify(sub) });
      if (!r.ok) throw new Error(`push ${r.status}`);
    },
  };
}
