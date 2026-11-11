/**
 * Web Push sender on node:crypto: RFC 8291 (aes128gcm message encryption) and RFC 8292 (VAPID).
 * No `web-push` dependency; the transport is injected, so tests never touch the network.
 * @req FR:iphone-access/send.@function @req NFR:iphone-access/security
 */
import { createCipheriv, createECDH, createHmac, createPrivateKey, randomBytes, sign, type KeyObject } from 'crypto';
import { parsePushSubscription, type PushSender, type PushSubscriptionRecord } from '../api';

export interface PushRequest { url: string; headers: Record<string, string>; body: Buffer }
export type PushTransport = (req: PushRequest) => Promise<{ status: number }>;
export interface VapidKeys { publicKey: string; privateKey: string; subject: string }

/** Config problem; the message never holds a key or the subject. */
export class PushConfigError extends Error {}

const RS = 4096;
/** One record: 4096 minus the 86-byte header, the delimiter and the 16-byte tag. @req FR:iphone-access/send.size */
export const MAX_PAYLOAD = RS - 86 - 1 - 16;
const JWT_LIFE_S = 12 * 3600;

const hmac = (key: Buffer, data: Buffer) => createHmac('sha256', key).update(data).digest();
const b64u = (s: string) => Buffer.from(s, 'base64url');
const B64U = /^[A-Za-z0-9_-]+$/;

/**
 * RFC 8291 section 3.4 and RFC 8188: one aes128gcm record keyed to the subscription.
 * `salt` and `senderPrivate` are for the RFC test vector only; real sends use fresh random values.
 * @req FR:iphone-access/send.encrypt
 */
export function encryptPayload(plain: Buffer, sub: Pick<PushSubscriptionRecord, 'p256dh' | 'auth'>, fixed: { salt?: Buffer; senderPrivate?: Buffer } = {}): Buffer {
  const uaPublic = b64u(sub.p256dh);
  const authSecret = b64u(sub.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 4 || authSecret.length !== 16) throw new Error('Invalid subscription keys');
  const ecdh = createECDH('prime256v1');
  if (fixed.senderPrivate) ecdh.setPrivateKey(fixed.senderPrivate); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const secret = ecdh.computeSecret(uaPublic);
  const salt = fixed.salt ?? randomBytes(16);
  const prkKey = hmac(authSecret, secret);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic, Buffer.from([1])]);
  const ikm = hmac(prkKey, keyInfo);
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(RS, 16);
  header[20] = asPublic.length;
  const c = createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([c.update(Buffer.concat([plain, Buffer.from([2])])), c.final(), c.getAuthTag()]);
  return Buffer.concat([header, asPublic, body]);
}

/** @req FR:iphone-access/send.keys */
function vapidKey(v: VapidKeys): KeyObject {
  const ok = (s: unknown): s is string => typeof s === 'string' && B64U.test(s);
  if (!ok(v.publicKey) || !ok(v.privateKey)) throw new PushConfigError('VAPID keys must be base64url');
  const pub = b64u(v.publicKey);
  const priv = b64u(v.privateKey);
  if (pub.length !== 65 || pub[0] !== 4 || priv.length !== 32) throw new PushConfigError('VAPID keys have the wrong length');
  const ecdh = createECDH('prime256v1');
  try { ecdh.setPrivateKey(priv); } catch { throw new PushConfigError('VAPID private key is not a P-256 key'); }
  if (!ecdh.getPublicKey().equals(pub)) throw new PushConfigError('VAPID private key does not match the public key');
  if (typeof v.subject !== 'string' || !/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/.test(v.subject)) throw new PushConfigError('VAPID subject must be mailto: or https:');
  return createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', d: v.privateKey, x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') } });
}

/** Default transport: plain POST, no redirects, 10 s limit. */
export const fetchTransport: PushTransport = async (r) => {
  const res = await fetch(r.url, { method: 'POST', headers: r.headers, body: new Uint8Array(r.body), redirect: 'error', signal: AbortSignal.timeout(10_000) });
  // Drain so the socket is freed; the body is never read or logged.
  await res.arrayBuffer().catch(() => undefined);
  return { status: res.status };
};

/** @req FR:iphone-access/send.vapid @req FR:iphone-access/send.allow @req FR:iphone-access/send.status @req FR:iphone-access/send.private */
export function createWebPushSender(opts: { vapid: VapidKeys; transport?: PushTransport; now?: () => Date; ttl?: number }): PushSender {
  const key = vapidKey(opts.vapid);
  const transport = opts.transport ?? fetchTransport;
  const ttl = String(opts.ttl ?? 3600);
  const enc = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  const jwt = (aud: string) => {
    const exp = Math.floor((opts.now ?? (() => new Date()))().getTime() / 1000) + JWT_LIFE_S;
    const unsigned = `${enc({ typ: 'JWT', alg: 'ES256' })}.${enc({ aud, exp, sub: opts.vapid.subject })}`;
    return `${unsigned}.${sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
  };
  return {
    async send(sub, payload) {
      // Re-check the allow-list: a bad stored record must never make the host post elsewhere.
      const ok = parsePushSubscription({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } });
      if (!ok) throw new Error('Endpoint is not an allowed push service');
      const plain = Buffer.from(payload, 'utf8');
      if (plain.length > MAX_PAYLOAD) throw new Error('Payload too large');
      const url = new URL(ok.endpoint);
      return transport({
        url: ok.endpoint,
        body: encryptPayload(plain, sub),
        headers: {
          authorization: `vapid t=${jwt(url.origin)}, k=${opts.vapid.publicKey}`,
          ttl, urgency: 'high', 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream',
        },
      });
    },
  };
}
