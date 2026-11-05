import { setup, ENV } from './helpers';

// @req FR:iphone-access/device.@http @req FR:iphone-access/sub.key
describe('host wires devices', () => {
  it('owner pairs a device; the device saves a subscription; state lands in .stack/devices.json', async () => {
    const s = await setup({ ...ENV, STACK_VAPID_PUBLIC_KEY: 'BPublic_-1' });
    const c = await s.owner('/api/auth/devices', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'iPhone' }) });
    expect(c.status).toBe(201);
    const { token } = (await c.json()) as { token: string };
    const h = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
    const put = await s.req('/api/auth/devices/me/push', { method: 'PUT', headers: h, body: JSON.stringify({ endpoint: 'https://web.push.apple.com/x', keys: { p256dh: 'BKey', auth: 'sec' } }) });
    expect(put.status).toBe(200);
    expect(await (await s.req('/api/auth/devices/me/push-key', { headers: h })).json()).toEqual({ key: 'BPublic_-1' });
    const file = await s.storage.readAux('.stack/devices.json');
    expect(file?.content).toContain('web.push.apple.com');
    expect(file?.content).not.toContain(token.split('.')[1]);
    expect(s.logs.join('\n')).not.toContain('web.push.apple.com');
  });
});
