import { createPublicKey, verify } from 'crypto';
import { createWebPushSender, encryptPayload, PushConfigError, type PushRequest } from '../../src/host/push-sender';

// RFC 8291 section 5 and Appendix A.
const b64 = (s: string) => Buffer.from(s.replace(/\s+/g, ''), 'base64url');
const RFC = {
  plaintext: 'When I grow up, I want to be a watermelon',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  body: `DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27ml
    mlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPT
    pK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN`,
};
// The RFC sender pair doubles as a valid VAPID pair.
const VAPID = { publicKey: RFC.asPublic, privateKey: RFC.asPrivate, subject: 'mailto:owner@example.test' };
const SUB = { endpoint: 'https://web.push.apple.com/QGp1', p256dh: RFC.uaPublic, auth: RFC.auth };
const NOW = new Date('2026-11-10T18:00:00Z');

function fake(status = 201) {
  const reqs: PushRequest[] = [];
  return { reqs, transport: async (r: PushRequest) => { reqs.push(r); return { status }; } };
}

describe('Web Push sender', () => {
  // @req FR:iphone-access/send.encrypt
  it('matches the RFC 8291 Appendix A vector', () => {
    const out = encryptPayload(Buffer.from(RFC.plaintext), SUB, { salt: b64(RFC.salt), senderPrivate: b64(RFC.asPrivate) });
    expect(out.toString('base64url')).toBe(RFC.body.replace(/\s+/g, ''));
  });

  // @req FR:iphone-access/send.encrypt
  it('uses a fresh salt and sender key per message', () => {
    const a = encryptPayload(Buffer.from('x'), SUB);
    const b = encryptPayload(Buffer.from('x'), SUB);
    expect(a.subarray(0, 16).equals(b.subarray(0, 16))).toBe(false);
    expect(a.readUInt32BE(16)).toBe(4096);
    expect(a[20]).toBe(65);
  });

  // @req FR:iphone-access/send.vapid @req FR:iphone-access/send.@function @req FR:iphone-access/send.status
  it('posts an encrypted body with a signed VAPID header and returns the status', async () => {
    const t = fake(201);
    const send = createWebPushSender({ vapid: VAPID, transport: t.transport, now: () => NOW });
    expect(await send.send(SUB, '{"key":"k","title":"t"}')).toEqual({ status: 201 });
    expect(t.reqs).toHaveLength(1);
    const r = t.reqs[0];
    expect(r.url).toBe(SUB.endpoint);
    expect(r.headers).toMatchObject({ ttl: '3600', urgency: 'high', 'content-encoding': 'aes128gcm', 'content-type': 'application/octet-stream' });
    const m = /^vapid t=([^,]+), k=(.+)$/.exec(r.headers.authorization);
    expect(m?.[2]).toBe(VAPID.publicKey);
    const [h, p, s] = (m?.[1] ?? '').split('.');
    expect(JSON.parse(Buffer.from(h, 'base64url').toString())).toEqual({ typ: 'JWT', alg: 'ES256' });
    expect(JSON.parse(Buffer.from(p, 'base64url').toString())).toEqual({ aud: 'https://web.push.apple.com', exp: NOW.getTime() / 1000 + 12 * 3600, sub: VAPID.subject });
    const pub = b64(VAPID.publicKey);
    const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' });
    expect(verify('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'))).toBe(true);
    expect(r.body.length).toBe(86 + '{"key":"k","title":"t"}'.length + 1 + 16);
  });

  // @req FR:iphone-access/send.status @req FR:iphone-access/notify.prune
  it('passes 404 and 410 through so the notifier prunes', async () => {
    for (const status of [404, 410]) {
      const t = fake(status);
      expect(await createWebPushSender({ vapid: VAPID, transport: t.transport }).send(SUB, '{}')).toEqual({ status });
    }
  });

  // @req FR:iphone-access/send.allow @req FR:iphone-access/send.size
  it('refuses unknown hosts and oversize payloads without a request', async () => {
    const t = fake();
    const send = createWebPushSender({ vapid: VAPID, transport: t.transport });
    await expect(send.send({ ...SUB, endpoint: 'https://evil.example/push' }, '{}')).rejects.toThrow();
    await expect(send.send({ ...SUB, endpoint: 'http://web.push.apple.com/x' }, '{}')).rejects.toThrow();
    await expect(send.send(SUB, 'x'.repeat(3994))).rejects.toThrow();
    expect(t.reqs).toHaveLength(0);
  });

  // @req FR:iphone-access/send.keys @req FR:iphone-access/send.private
  it('rejects bad config without echoing values', () => {
    const bad = [
      { ...VAPID, privateKey: 'short' },
      { ...VAPID, publicKey: RFC.uaPublic },
      { ...VAPID, subject: 'owner@example.test' },
    ];
    for (const vapid of bad) {
      let err: unknown;
      try { createWebPushSender({ vapid, transport: fake().transport }); } catch (e) { err = e; }
      expect(err).toBeInstanceOf(PushConfigError);
      expect(String((err as Error).message)).not.toContain(RFC.asPrivate);
      expect(String((err as Error).message)).not.toContain('owner@example.test');
    }
  });
});
