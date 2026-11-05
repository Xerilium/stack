/**
 * Devices: one record per phone, bound to one API token, with an optional Web Push subscription.
 * Login, scopes, expiry and revoke are the token's; the device adds a name and the subscription.
 * @req FR:iphone-access/device.@http
 */
import { randomBytes } from 'crypto';
import { StoreConflict, type TokenService, type TokenStore } from './tokens';

/** @req FR:iphone-access/device.create */
export const DEVICE_SCOPES = ['tasks:read', 'tasks:write', 'projects:read'];
const DEVICE_DAYS = 90;
/** @req FR:iphone-access/device.create.limit */
export const MAX_DEVICES = 10;
const RETRIES = 10;
const ID = /^[0-9a-f]{16}$/;
const NAME_BAD = new RegExp("[\\r\\n\\u0085\\u2028\\u2029\\0]");

export interface PushSubscriptionRecord { endpoint: string; p256dh: string; auth: string; updatedAt?: string }
/** @req FR:iphone-access/$device @req NFR:iphone-access/security: no new dependency; the subscription alone cannot send. @req NFR:iphone-access/cost: $0, push services are free. */
interface StoredDevice { id: string; name: string; tokenId: string; createdAt: string; revokedAt: string | null; push?: PushSubscriptionRecord }
/** Never holds the token id or the subscription. @req FR:iphone-access/device.list */
export interface DeviceView { id: string; name: string; createdAt: string; revokedAt: string | null; status: 'active' | 'revoked'; push: boolean }

export class DeviceError extends Error {
  constructor(readonly kind: 'invalid' | 'limit', message: string) { super(message); }
}

export interface DeviceService {
  create(name: string): Promise<{ device: DeviceView; token: string }>;
  list(): Promise<DeviceView[]>;
  revoke(id: string): Promise<'revoked' | 'already' | 'not_found'>;
  /** The active device bound to a token id, or `null`. */
  byTokenId(tokenId: string): Promise<DeviceView | null>;
  /** Replace (or with `null` remove) a device's subscription; `false` when the device is not active. */
  setPush(id: string, sub: PushSubscriptionRecord | null): Promise<boolean>;
  /** Saved subscriptions of active devices. */
  subscriptions(): Promise<{ deviceId: string; sub: PushSubscriptionRecord }[]>;
  /** Remove a subscription only while it still has this endpoint. */
  removePush(id: string, endpoint: string): Promise<void>;
}

export function createDeviceService(opts: { store: TokenStore; tokens: TokenService; now?: () => Date }): DeviceService {
  const { store, tokens } = opts;
  const now = () => (opts.now ?? (() => new Date()))();

  async function load(): Promise<{ devices: StoredDevice[]; version: string | null }> {
    const f = await store.read();
    if (!f) return { devices: [], version: null };
    let v: { version?: unknown; devices?: unknown };
    try { v = JSON.parse(f.content); } catch { throw new DeviceError('invalid', 'Device file is not valid JSON'); }
    if (typeof v !== 'object' || v === null || v.version !== 1 || !Array.isArray(v.devices)) throw new DeviceError('invalid', 'Device file has an unknown shape');
    return { devices: (v.devices as unknown[]).filter(valid), version: f.version };
  }
  const valid = (d: unknown): d is StoredDevice => {
    if (typeof d !== 'object' || d === null) return false;
    const r = d as Record<string, unknown>;
    return typeof r.id === 'string' && ID.test(r.id) && typeof r.name === 'string' && typeof r.tokenId === 'string' && typeof r.createdAt === 'string'
      && (r.revokedAt === null || typeof r.revokedAt === 'string');
  };
  const dump = (devices: StoredDevice[]) => JSON.stringify({ version: 1, devices }, null, 2) + '\n';
  const view = (d: StoredDevice): DeviceView => ({ id: d.id, name: d.name, createdAt: d.createdAt, revokedAt: d.revokedAt, status: d.revokedAt ? 'revoked' : 'active', push: !!d.push });

  /** Read-modify-write; a lost version race reloads and retries. */
  async function mutate<T>(fn: (devices: StoredDevice[]) => { result: T; save: boolean }): Promise<T> {
    for (let i = 0; ; i++) {
      const { devices, version } = await load();
      const out = fn(devices);
      if (!out.save) return out.result;
      try {
        await store.write(dump(devices), version);
        return out.result;
      } catch (e) {
        if (!(e instanceof StoreConflict) || i + 1 >= RETRIES) throw e;
      }
    }
  }

  async function create(name: string) {
    if (typeof name !== 'string' || name.trim() === '' || name.length > 80 || NAME_BAD.test(name)) throw new DeviceError('invalid', 'Invalid device name');
    const active = (await load()).devices.filter((d) => !d.revokedAt).length;
    if (active >= MAX_DEVICES) throw new DeviceError('limit', 'Too many active devices');
    const made = await tokens.create({ name: `device:${name}`.slice(0, 80), scopes: DEVICE_SCOPES, days: DEVICE_DAYS });
    const dev: StoredDevice = { id: randomBytes(8).toString('hex'), name, tokenId: made.record.id, createdAt: now().toISOString(), revokedAt: null };
    try {
      await mutate((devices) => {
        if (devices.filter((d) => !d.revokedAt).length >= MAX_DEVICES) throw new DeviceError('limit', 'Too many active devices');
        devices.push(dev);
        return { result: undefined, save: true };
      });
    } catch (e) {
      // @req FR:iphone-access/device.create.atomic: no token survives without its device.
      await tokens.revoke(made.record.id).catch(() => undefined);
      throw e;
    }
    return { device: view(dev), token: made.token };
  }

  async function revoke(id: string) {
    if (typeof id !== 'string' || !ID.test(id)) return 'not_found' as const;
    const found = await mutate<{ r: 'revoked' | 'already' | 'not_found'; tokenId?: string }>((devices) => {
      const d = devices.find((x) => x.id === id);
      if (!d) return { result: { r: 'not_found' }, save: false };
      // @req FR:iphone-access/device.revoke.retry: a repeat still revokes the token, so a failed token revoke never leaves it live.
      if (d.revokedAt) return { result: { r: 'already', tokenId: d.tokenId }, save: false };
      d.revokedAt = now().toISOString();
      delete d.push;
      return { result: { r: 'revoked', tokenId: d.tokenId }, save: true };
    });
    if (found.tokenId) await tokens.revoke(found.tokenId);
    return found.r;
  }

  return {
    create,
    list: async () => (await load()).devices.map(view),
    revoke,
    byTokenId: async (tokenId) => {
      const d = (await load()).devices.find((x) => x.tokenId === tokenId && !x.revokedAt);
      return d ? view(d) : null;
    },
    setPush: (id, sub) => mutate((devices) => {
      const d = devices.find((x) => x.id === id && !x.revokedAt);
      if (!d) return { result: false, save: false };
      if (sub) d.push = { ...sub, updatedAt: now().toISOString() }; else delete d.push;
      return { result: true, save: true };
    }),
    subscriptions: async () => (await load()).devices.filter((d) => !d.revokedAt && d.push).map((d) => ({ deviceId: d.id, sub: d.push as PushSubscriptionRecord })),
    removePush: (id, endpoint) => mutate((devices) => {
      const d = devices.find((x) => x.id === id);
      if (!d?.push || d.push.endpoint !== endpoint) return { result: undefined, save: false };
      delete d.push;
      return { result: undefined, save: true };
    }),
  };
}

const KEY = /^[A-Za-z0-9_-]{1,128}$/;
const PUSH_HOSTS = ['web.push.apple.com', 'fcm.googleapis.com', 'updates.push.services.mozilla.com'];
const PUSH_SUFFIXES = ['.push.apple.com', '.notify.windows.com'];

/**
 * Accepts only https endpoints of the known push services, so the host never posts to an arbitrary URL.
 * @req FR:iphone-access/sub.put.endpoint @req FR:iphone-access/sub.put.keys
 */
export function parsePushSubscription(body: Record<string, unknown>): PushSubscriptionRecord | null {
  const keys = Object.keys(body);
  if (keys.length !== 2 || !keys.includes('endpoint') || !keys.includes('keys')) return null;
  const { endpoint, keys: k } = body as { endpoint: unknown; keys: unknown };
  if (typeof endpoint !== 'string' || endpoint.length > 2048 || typeof k !== 'object' || k === null || Array.isArray(k)) return null;
  const kk = k as Record<string, unknown>;
  if (Object.keys(kk).length !== 2 || typeof kk.p256dh !== 'string' || typeof kk.auth !== 'string' || !KEY.test(kk.p256dh) || !KEY.test(kk.auth)) return null;
  let u: URL;
  try { u = new URL(endpoint); } catch { return null; }
  const host = u.hostname.toLowerCase();
  const ok = PUSH_HOSTS.includes(host) || PUSH_SUFFIXES.some((s) => host.endsWith(s));
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !ok) return null;
  return { endpoint: u.href, p256dh: kk.p256dh, auth: kk.auth };
}
