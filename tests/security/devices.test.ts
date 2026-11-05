import { setup } from './helpers';

const SUB = { endpoint: 'https://web.push.apple.com/abc123', keys: { p256dh: 'BPubKey_-abc', auth: 'authSecret_-1' } };

async function pair(s: ReturnType<typeof setup>, name = 'iPhone') {
  const r = await s.call('POST', '/api/auth/devices', { session: true, body: { name } });
  return { r, h: { authorization: `Bearer ${r.json?.token}` } as Record<string, string> };
}

// @req FR:iphone-access/device.@http @req FR:iphone-access/device.create
describe('device login', () => {
  it('creates a device with a one-time token that logs in', async () => {
    const s = setup();
    const { r, h } = await pair(s);
    expect(r.status).toBe(201);
    expect(r.json.token).toMatch(/^stk_/);
    expect(r.json.device).toMatchObject({ name: 'iPhone', status: 'active', push: false });
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect((await s.call('GET', '/api/tasks', { headers: h })).status).toBe(200);
    const tok = (await s.tokens.list())[0];
    expect(tok.name).toBe('device:iPhone');
    expect(tok.scopes.sort()).toEqual(['projects:read', 'tasks:read', 'tasks:write']);
    expect((await s.call('GET', '/api/projects', { headers: h })).status).toBe(200);
    expect((await s.call('GET', '/api/summaries', { headers: h })).status).not.toBe(200);
  });

  // @req FR:iphone-access/device.list @req FR:iphone-access/device.create.once
  it('lists devices without token, hash, token id or endpoint', async () => {
    const s = setup();
    const { r, h } = await pair(s);
    await s.call('PUT', '/api/auth/devices/me/push', { headers: h, body: SUB });
    const l = await s.call('GET', '/api/auth/devices', { session: true });
    expect(l.status).toBe(200);
    expect(l.json.items).toHaveLength(1);
    expect(l.json.items[0].push).toBe(true);
    const tokenId = (await s.tokens.list())[0].id;
    for (const secret of [r.json.token.split('.')[1], tokenId, 'web.push.apple.com', 'tokenId', 'hash']) expect(l.text).not.toContain(secret);
  });

  // @req FR:iphone-access/device.session
  it('owner session only', async () => {
    const s = setup();
    const { h } = await pair(s);
    expect((await s.call('POST', '/api/auth/devices', { headers: h, body: { name: 'x' } })).status).toBe(403);
    expect((await s.call('GET', '/api/auth/devices', { headers: h })).status).toBe(403);
    expect((await s.call('GET', '/api/auth/devices')).status).toBe(401);
    expect((await s.call('POST', '/api/auth/devices', { session: true, body: { name: 'x' }, headers: { origin: 'https://evil.test' } })).status).toBe(403);
    expect((await s.call('POST', '/api/auth/devices', { session: true, body: { name: '' } })).status).toBe(422);
    expect((await s.call('POST', '/api/auth/devices', { session: true, body: { name: 'x', extra: 1 } })).status).toBe(422);
  });

  // @req FR:iphone-access/device.create.limit
  it('refuses the 11th active device', async () => {
    const s = setup();
    for (let i = 0; i < 10; i++) expect((await pair(s, `p${i}`)).r.status).toBe(201);
    expect((await pair(s, 'p11')).r.status).toBe(409);
    expect(await s.tokens.list()).toHaveLength(10);
  });

  // @req FR:iphone-access/device.create.atomic
  it('revokes the new token when the device record cannot be saved', async () => {
    const s = setup();
    const broken = { read: async () => null, write: async () => { throw new Error('disk'); } };
    const { createDeviceService } = await import('../../src/api/auth');
    const d = createDeviceService({ store: broken, tokens: s.tokens });
    await expect(d.create('x')).rejects.toThrow();
    const list = await s.tokens.list();
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('revoked');
  });

  // @req FR:iphone-access/device.revoke @req FR:iphone-access/device.login
  it('revoke kills the token and drops the subscription', async () => {
    const s = setup();
    const { r, h } = await pair(s);
    await s.call('PUT', '/api/auth/devices/me/push', { headers: h, body: SUB });
    const id = r.json.device.id;
    const rv = await s.call('POST', `/api/auth/devices/${id}/revoke`, { session: true, body: {} });
    expect(rv.status).toBe(200);
    expect(rv.json.result).toBe('revoked');
    expect((await s.call('GET', '/api/tasks', { headers: h })).status).toBe(401);
    expect(await s.devices.subscriptions()).toEqual([]);
    expect((await s.call('POST', `/api/auth/devices/${id}/revoke`, { session: true, body: {} })).json.result).toBe('already');
    expect((await s.call('POST', '/api/auth/devices/0000000000000000/revoke', { session: true, body: {} })).status).toBe(404);
    expect((await s.call('GET', '/api/auth/devices', { session: true })).json.items[0].status).toBe('revoked');
  });
});

// @req FR:iphone-access/sub.@http
describe('push subscription', () => {
  // @req FR:iphone-access/sub.put @req FR:iphone-access/sub.delete @req FR:iphone-access/sub.private
  it('device saves, replaces and deletes its subscription', async () => {
    const s = setup();
    const { h } = await pair(s);
    const put = await s.call('PUT', '/api/auth/devices/me/push', { headers: h, body: SUB });
    expect(put.status).toBe(200);
    expect(put.text).not.toContain('web.push.apple.com');
    expect(await s.devices.subscriptions()).toHaveLength(1);
    const next = { ...SUB, endpoint: 'https://web.push.apple.com/zzz' };
    await s.call('PUT', '/api/auth/devices/me/push', { headers: h, body: next });
    const subs = await s.devices.subscriptions();
    expect(subs).toHaveLength(1);
    expect(subs[0].sub.endpoint).toBe(next.endpoint);
    expect((await s.call('DELETE', '/api/auth/devices/me/push', { headers: h })).status).toBe(204);
    expect((await s.call('DELETE', '/api/auth/devices/me/push', { headers: h })).status).toBe(204);
    expect(await s.devices.subscriptions()).toEqual([]);
  });

  // @req FR:iphone-access/sub.put.endpoint
  it.each([
    'http://web.push.apple.com/x', 'https://evil.test/x', 'https://user:pw@web.push.apple.com/x', 'https://web.push.apple.com.evil.test/x',
    'https://127.0.0.1/x', 'not a url', `https://web.push.apple.com/${'a'.repeat(2100)}`,
  ])('rejects endpoint %s', async (endpoint) => {
    const s = setup();
    const { h } = await pair(s);
    expect((await s.call('PUT', '/api/auth/devices/me/push', { headers: h, body: { ...SUB, endpoint } })).status).toBe(422);
    expect(await s.devices.subscriptions()).toEqual([]);
  });

  it.each([
    'https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/abc', 'https://wns2-par02p.notify.windows.com/w/?token=1', 'https://api.push.apple.com/3/device/x',
  ])('accepts push service %s', async (endpoint) => {
    const s = setup();
    const { h } = await pair(s);
    expect((await s.call('PUT', '/api/auth/devices/me/push', { headers: h, body: { ...SUB, endpoint } })).status).toBe(200);
  });

  // @req FR:iphone-access/sub.put.keys
  it('rejects bad keys and extra fields', async () => {
    const s = setup();
    const { h } = await pair(s);
    const put = (body: unknown) => s.call('PUT', '/api/auth/devices/me/push', { headers: h, body });
    expect((await put({ ...SUB, keys: { p256dh: 'has space', auth: 'a' } })).status).toBe(422);
    expect((await put({ ...SUB, keys: { p256dh: 'a'.repeat(129), auth: 'a' } })).status).toBe(422);
    expect((await put({ endpoint: SUB.endpoint })).status).toBe(422);
    expect((await put({ ...SUB, extra: 1 })).status).toBe(422);
  });

  // @req FR:iphone-access/sub.auth
  it('only an active device token may use it', async () => {
    const s = setup();
    const { r, h } = await pair(s);
    const plain = (await s.tokens.create({ name: 'agent', scopes: ['read', 'write'] })).token;
    expect((await s.call('PUT', '/api/auth/devices/me/push', { headers: { authorization: `Bearer ${plain}` }, body: SUB })).status).toBe(403);
    expect((await s.call('PUT', '/api/auth/devices/me/push', { session: true, body: SUB })).status).toBe(403);
    expect((await s.call('PUT', '/api/auth/devices/me/push', { body: SUB })).status).toBe(401);
    await s.call('POST', `/api/auth/devices/${r.json.device.id}/revoke`, { session: true, body: {} });
    expect((await s.call('PUT', '/api/auth/devices/me/push', { headers: h, body: SUB })).status).toBe(401);
  });

  // @req FR:iphone-access/sub.key
  it('serves the VAPID public key only', async () => {
    const s = setup({ vapid: 'BPublicKey_-123' });
    const { h } = await pair(s);
    const k = await s.call('GET', '/api/auth/devices/me/push-key', { headers: h });
    expect(k.json).toEqual({ key: 'BPublicKey_-123' });
    const none = setup();
    const p2 = await pair(none);
    expect((await none.call('GET', '/api/auth/devices/me/push-key', { headers: p2.h })).status).toBe(404);
  });

  // @req FR:iphone-access/sub.private
  it('events carry no subscription data', async () => {
    const events: unknown[] = [];
    const s = setup({ onEvent: (e) => events.push(e) });
    const { h } = await pair(s);
    await s.call('PUT', '/api/auth/devices/me/push', { headers: h, body: SUB });
    expect(JSON.stringify(events)).not.toMatch(/push\.apple|p256dh|authSecret/);
  });
});
