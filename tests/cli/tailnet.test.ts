/** Tailnet access: bind, remote gate, Tailscale Serve proxy headers, device pairing. No network, no Tailscale. */
import http from 'http';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import type { NetworkInterfaceInfo } from 'os';
import { tmpdir } from 'os';
import { join } from 'path';
import { prepareDemo, startWeb, type WebServer } from '../../src/cli/web';
import {
  bindMode, clearCookie, cookieToken, deviceCookie, isLocal, isLoopback, listenable, NO_TAILSCALE, PAIR_HTML, PAIR_JS,
  requestHost, requestSecure, tailnetAddresses, tailnetHostOk,
} from '../../src/cli/tailnet';
import { createDeviceService, createTokenService, MemoryTokenStore } from '../../src/api';
import { UsageError } from '../../src/cli/args';
import { run } from '../../src/cli/run';

Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
jest.setTimeout(30000);
const quiet = { watch: { watchFn: (() => ({ on() { return this; }, close() { /* nothing */ } })) as unknown as typeof import('fs').watch } };
const tmp = () => mkdtempSync(join(tmpdir(), 'stack-tailnet-'));
const nic = (address: string, internal = false): NetworkInterfaceInfo => ({ address, internal, family: address.includes(':') ? 'IPv6' : 'IPv4', netmask: '', mac: '', cidr: null, ...(address.includes(':') ? { scopeid: 0 } : {}) }) as NetworkInterfaceInfo;

describe('bindMode', () => {
  // @req FR:tailnet-access/bind.@cli
  it('defaults to loopback, reads config, lets the flag win, and refuses other values', () => {
    expect(bindMode(undefined, undefined)).toBe('loopback');
    expect(bindMode(undefined, 'tailnet')).toBe('tailnet');
    expect(bindMode('loopback', 'tailnet')).toBe('loopback');
    expect(() => bindMode('lan', undefined)).toThrow(UsageError);
    expect(() => bindMode(undefined, '0.0.0.0')).toThrow(/user config "bind"/);
    expect(() => bindMode(true, undefined)).toThrow(UsageError);
  });
});

describe('tailnetAddresses', () => {
  // @req FR:tailnet-access/bind.detect @req NFR:tailnet-access/test
  it('keeps only non-internal Tailscale addresses (100.64.0.0/10, fd7a:115c:a1e0::/48)', () => {
    const got = tailnetAddresses({
      lo0: [nic('127.0.0.1', true), nic('::1', true)],
      en0: [nic('192.168.1.20'), nic('fe80::1'), nic('100.63.255.255'), nic('100.128.0.1')],
      utun4: [nic('100.101.102.103'), nic('fd7a:115c:a1e0::1234'), nic('100.101.102.103')],
      fake: [nic('100.64.0.1', true), nic('0.0.0.0'), nic('::')],
    });
    expect(got).toEqual(['100.101.102.103', 'fd7a:115c:a1e0::1234']);
    expect(tailnetAddresses({})).toEqual([]);
  });
  // @req FR:tailnet-access/bind.tailnet
  it('never treats an unspecified address as listenable', () => {
    for (const a of ['0.0.0.0', '::', '0:0:0:0:0:0:0:0', '', 'localhost']) expect(listenable(a)).toBe(false);
    expect(listenable('100.101.102.103')).toBe(true);
    expect(listenable('::1')).toBe(true);
  });
});

describe('request classification', () => {
  // @req FR:tailnet-access/gate.classify
  it('a loopback peer with no proxy header is local; anything else is remote', () => {
    expect(isLoopback('127.0.0.1')).toBe(true);
    expect(isLoopback('::ffff:127.0.0.1')).toBe(true);
    expect(isLoopback('::1')).toBe(true);
    expect(isLoopback('100.101.102.103')).toBe(false);
    expect(isLocal('127.0.0.1', { host: 'localhost:4173' })).toBe(true);
    for (const h of ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'forwarded', 'tailscale-user-login']) expect(isLocal('127.0.0.1', { [h]: 'x' })).toBe(false);
    expect(isLocal('100.101.102.103', {})).toBe(false);
    expect(isLocal(undefined, {})).toBe(false);
  });
  // @req FR:tailnet-access/proxy.trust @req FR:tailnet-access/proxy.host @req FR:tailnet-access/proxy.secure
  it('trusts X-Forwarded-Host and X-Forwarded-Proto from loopback only', () => {
    const h = { host: '127.0.0.1:4173', 'x-forwarded-host': 'mac.tail1.ts.net, other', 'x-forwarded-proto': 'https' };
    expect(requestHost('127.0.0.1', h)).toBe('mac.tail1.ts.net');
    expect(requestSecure('127.0.0.1', h)).toBe(true);
    expect(requestHost('100.101.102.103', h)).toBe('127.0.0.1:4173');
    expect(requestSecure('100.101.102.103', h)).toBe(false);
    expect(requestHost('127.0.0.1', { host: 'mac.tail1.ts.net' })).toBe('mac.tail1.ts.net');
  });
  // @req FR:tailnet-access/gate.host
  it('a remote Host must be a bound Tailscale address or a ts.net name', () => {
    const addrs = ['100.101.102.103', 'fd7a:115c:a1e0::1234'];
    for (const ok of ['100.101.102.103', '100.101.102.103:4173', '[fd7a:115c:a1e0::1234]:4173', 'mac.tail1234.ts.net', 'MAC.tail1234.TS.NET:443']) expect(tailnetHostOk(ok, addrs)).toBe(true);
    for (const bad of [undefined, '', 'localhost:4173', '127.0.0.1:4173', 'evil.example', 'ts.net.evil.example', 'ts.net', '100.101.102.104', 'evil.example:80@mac.ts.net', '[::1]:4173']) expect(tailnetHostOk(bad, addrs)).toBe(false);
  });
});

describe('device cookie', () => {
  // @req FR:tailnet-access/pair.cookie @req FR:tailnet-access/proxy.secure @req FR:tailnet-access/pair.logout
  it('is HttpOnly, Lax, 90 days, Secure on https, and parses back', () => {
    expect(deviceCookie('stk_0123.abc', false)).toBe('stack_device=stk_0123.abc; Path=/; HttpOnly; SameSite=Lax; Max-Age=7776000');
    expect(deviceCookie('stk_0123.abc', true)).toMatch(/; Secure$/);
    expect(() => deviceCookie('a;b', false)).toThrow();
    expect(clearCookie(true)).toContain('Max-Age=0');
    expect(cookieToken('a=1; stack_device=stk_0123.abc; b=2')).toBe('stk_0123.abc');
    expect(cookieToken('stack_device=bad value')).toBeNull();
    expect(cookieToken(undefined)).toBeNull();
  });
  // @req FR:tailnet-access/pair.page
  it('the pairing page has no inline script or style and saves the code as stack.device', () => {
    expect(PAIR_HTML).toContain('<script src="/pair.js" defer></script>');
    expect(PAIR_HTML).not.toMatch(/<script>|<style|\sstyle=|\son\w+=/);
    expect(PAIR_JS).toContain("localStorage.setItem('stack.device'");
    expect(PAIR_JS).toContain("'/.auth/pair'");
    expect(PAIR_JS).toContain("location.replace('/#/install')");
  });
});

/** Raw HTTP so the test can set Host (fetch cannot). */
function call(url: string, path: string, o: { method?: string; headers?: Record<string, string>; body?: string } = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  const u = new URL(url);
  return new Promise((ok, bad) => {
    const r = http.request({ host: u.hostname.replace(/^\[|\]$/g, ''), port: Number(u.port), path, method: o.method ?? 'GET', headers: o.headers }, (res) => {
      let body = ''; res.setEncoding('utf8'); res.on('data', (c) => { body += c; }); res.on('end', () => ok({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    r.on('error', bad);
    r.end(o.body);
  });
}

async function fixture() {
  const src = tmp(); mkdirSync(join(src, 'tasks'));
  writeFileSync(join(src, 'tasks/alpha.md'), '# Alpha\n\n## Active\n\n- [ ] Write the plan\n');
  const dir = join(tmp(), 'demo'); prepareDemo(src, dir);
  const web = tmp(); writeFileSync(join(web, 'index.html'), '<html>app</html>');
  const tokens = createTokenService({ store: new MemoryTokenStore() });
  const devices = createDeviceService({ store: new MemoryTokenStore(), tokens });
  const phone = await devices.create('iPhone');
  return { dir, web, tokens, devices, phone };
}

const REMOTE = '100.101.102.103';
const TS_HOST = 'mac.tail1234.ts.net';
const json = { 'content-type': 'application/json' };

describe('startWeb bind', () => {
  // @req FR:tailnet-access/bind.refuse
  it('refuses to start in tailnet mode with no Tailscale address', async () => {
    const f = await fixture();
    await expect(startWeb({ ...quiet, dir: f.dir, port: 0, webDir: f.web, agents: false, bind: 'tailnet', tailnet: () => [], auth: f })).rejects.toThrow(NO_TAILSCALE);
    await expect(startWeb({ ...quiet, dir: f.dir, port: 0, webDir: f.web, agents: false, bind: 'tailnet', tailnet: () => ['0.0.0.0', '::'], auth: f })).rejects.toThrow(NO_TAILSCALE);
  });
  // @req FR:tailnet-access/bind.tailnet @req FR:tailnet-access/bind.startup @req FR:tailnet-access/bind.loopback
  it('listens on loopback plus each Tailscale address, on one port; loopback mode stays one address', async () => {
    const f = await fixture();
    const one = await startWeb({ ...quiet, dir: f.dir, port: 0, webDir: f.web, agents: false });
    try { expect(one.urls).toEqual([one.url]); expect(one.addresses).toEqual(['127.0.0.1']); } finally { await one.close(); }
    // ::1 stands in for a Tailscale address: it is the only second address every test machine has.
    const s = await startWeb({ ...quiet, dir: f.dir, port: 0, webDir: f.web, agents: false, bind: 'tailnet', tailnet: () => ['::1'], auth: f, peer: () => REMOTE });
    try {
      const port = new URL(s.url).port;
      expect(s.addresses).toEqual(['127.0.0.1', '::1']);
      expect(s.urls).toEqual([s.url, `http://[::1]:${port}`]);
      expect(s.addresses).not.toContain('0.0.0.0');
      expect((await call(`http://[::1]:${port}`, '/api/tasks', { headers: { host: `[::1]:${port}`, authorization: `Bearer ${f.phone.token}` } })).status).toBe(200);
    } finally { await s.close(); }
  });
});

describe('remote gate', () => {
  let f: Awaited<ReturnType<typeof fixture>>;
  let s: WebServer;
  /** Every request looks like it comes from the phone on the tailnet. */
  beforeEach(async () => {
    f = await fixture();
    s = await startWeb({ ...quiet, dir: f.dir, port: 0, webDir: f.web, agents: false, bind: 'tailnet', tailnet: () => ['::1'], auth: f, peer: () => REMOTE });
  });
  afterEach(() => s.close());
  const host = { host: `[::1]:4173` };

  // @req FR:tailnet-access/gate.token @req FR:tailnet-access/gate.token.deny @req FR:tailnet-access/gate.token.page @req FR:tailnet-access/gate.public @req FR:tailnet-access/pair.page
  it('serves only the pairing page without a token', async () => {
    expect((await call(s.url, '/api/tasks', { headers: host })).status).toBe(401);
    expect((await call(s.url, '/events', { headers: host })).status).toBe(401);
    expect((await call(s.url, '/.auth/me', { headers: host })).status).toBe(401);
    const page = await call(s.url, '/', { headers: host });
    expect(page.status).toBe(302);
    expect(page.headers.location).toBe('/pair');
    expect((await call(s.url, '/today', { headers: host })).headers.location).toBe('/pair');
    const pair = await call(s.url, '/pair', { headers: host });
    expect(pair.status).toBe(200);
    expect(pair.headers['content-type']).toContain('text/html');
    expect(pair.body).not.toContain('Write the plan');
    const js = await call(s.url, '/pair.js', { headers: host });
    expect(js.status).toBe(200);
    expect(js.headers['content-type']).toContain('javascript');
    expect((await call(s.url, '/api/tasks', { headers: { ...host, authorization: 'Bearer stk_0000000000000000.nope' } })).status).toBe(401);
  });

  // @req FR:tailnet-access/gate.host
  it('refuses a Host that is not on the tailnet', async () => {
    for (const h of ['localhost:4173', '127.0.0.1:4173', 'evil.example']) {
      expect((await call(s.url, '/pair', { headers: { host: h } })).status).toBe(403);
      expect((await call(s.url, '/api/tasks', { headers: { host: h, authorization: `Bearer ${f.phone.token}` } })).status).toBe(403);
    }
    expect((await call(s.url, '/pair', { headers: { host: TS_HOST } })).status).toBe(200);
  });

  // @req FR:tailnet-access/pair.cookie @req FR:tailnet-access/pair.me @req FR:tailnet-access/gate.token @req FR:tailnet-access/gate.scope @req NFR:tailnet-access/security
  it('pairs with a device token, then the cookie signs every request in as the device', async () => {
    const logs: string[] = [];
    const spies = (['log', 'error', 'warn'] as const).map((k) => jest.spyOn(console, k).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')); }));
    try {
      const bad = await call(s.url, '/.auth/pair', { method: 'POST', headers: { ...host, ...json }, body: JSON.stringify({ token: 'stk_0000000000000000.nope' }) });
      expect(bad.status).toBe(401);
      expect(bad.headers['set-cookie']).toBeUndefined();
      expect((await call(s.url, '/.auth/pair', { method: 'POST', headers: { ...host, ...json }, body: JSON.stringify({ token: f.phone.token, extra: 1 }) })).status).toBe(400);
      expect((await call(s.url, '/.auth/pair', { method: 'POST', headers: { ...host, ...json }, body: 'x'.repeat(5000) })).status).toBe(413);
      expect((await call(s.url, '/.auth/pair', { headers: host })).status).toBe(405);
      const ok = await call(s.url, '/.auth/pair', { method: 'POST', headers: { ...host, ...json }, body: JSON.stringify({ token: f.phone.token }) });
      expect(ok.status).toBe(204);
      const cookie = ok.headers['set-cookie']?.[0] ?? '';
      expect(cookie).toBe(`stack_device=${f.phone.token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=7776000`);
      const c = { ...host, cookie: cookie.split(';')[0] };
      const tasks = await call(s.url, '/api/tasks', { headers: c });
      expect(tasks.status).toBe(200);
      expect(tasks.body).toContain('Write the plan');
      expect((await call(s.url, '/', { headers: c })).body).toContain('app');
      const me = JSON.parse((await call(s.url, '/.auth/me', { headers: c })).body) as { clientPrincipal: { userDetails: string } };
      expect(me.clientPrincipal.userDetails).toBe('device:iPhone');
      // The paired phone acts as the owner, but never mints or revokes tokens or devices; its self endpoints run as its device token.
      expect((await call(s.url, '/api/auth/tokens', { headers: c })).status).toBe(403);
      expect((await call(s.url, '/api/auth/devices', { headers: c })).status).toBe(403);
      expect((await call(s.url, '/api/auth/devices/me/push-key', { headers: c })).status).toBe(404);
      // A spoofed owner principal changes nothing.
      const spoof = Buffer.from(JSON.stringify({ identityProvider: 'local', userId: 'local', userDetails: 'local', userRoles: ['authenticated'] })).toString('base64');
      expect((await call(s.url, '/api/auth/tokens', { headers: { ...host, 'x-ms-client-principal': spoof } })).status).toBe(401);
      const write = await call(s.url, '/api/tasks/complete', { method: 'POST', headers: { ...c, ...json, origin: `http://[::1]:4173`, 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ ref: 'alpha:4' }) });
      expect(write.status).toBe(200);
      expect(logs.join('\n')).not.toContain(f.phone.token.split('.')[1]);
    } finally { for (const sp of spies) sp.mockRestore(); }
  });

  // @req FR:tailnet-access/gate.token.deny
  it('a valid API token that is not a paired device is 403', async () => {
    const agent = await f.tokens.create({ name: 'agent', scopes: ['tasks:read'] });
    expect((await call(s.url, '/api/tasks', { headers: { ...host, authorization: `Bearer ${agent.token}` } })).status).toBe(403);
    expect((await call(s.url, '/.auth/pair', { method: 'POST', headers: { ...host, ...json }, body: JSON.stringify({ token: agent.token }) })).status).toBe(401);
  });

  // @req FR:tailnet-access/gate.csrf
  it('refuses cross-site remote writes', async () => {
    const c = { ...host, ...json, authorization: `Bearer ${f.phone.token}` };
    const body = JSON.stringify({ ref: 'alpha:4' });
    expect((await call(s.url, '/api/tasks/complete', { method: 'POST', headers: { ...c, origin: 'https://evil.example' }, body })).status).toBe(403);
    expect((await call(s.url, '/api/tasks/complete', { method: 'POST', headers: { ...c, 'sec-fetch-site': 'cross-site' }, body })).status).toBe(403);
    expect((await call(s.url, '/.auth/pair', { method: 'POST', headers: { ...host, ...json, origin: 'https://evil.example' }, body: JSON.stringify({ token: f.phone.token }) })).status).toBe(403);
  });

  // @req FR:tailnet-access/pair.@cli.revoke @req FR:tailnet-access/pair.logout
  it('a revoked device is 401 at once; logout clears the cookie', async () => {
    const c = { ...host, cookie: `stack_device=${f.phone.token}` };
    const out = await call(s.url, '/.auth/logout', { headers: c });
    expect(out.status).toBe(302);
    expect(out.headers.location).toBe('/pair');
    expect(out.headers['set-cookie']?.[0]).toContain('Max-Age=0');
    expect((await call(s.url, '/api/tasks', { headers: c })).status).toBe(200);
    await f.devices.revoke(f.phone.device.id);
    expect((await call(s.url, '/api/tasks', { headers: c })).status).toBe(401);
  });
});

describe('local and proxied requests', () => {
  // @req FR:tailnet-access/gate.local @req FR:tailnet-access/gate.loopback
  it('loopback requests behave as before; loopback mode refuses every remote request', async () => {
    const f = await fixture();
    const t = await startWeb({ ...quiet, dir: f.dir, port: 0, webDir: f.web, agents: false, bind: 'tailnet', tailnet: () => ['::1'], auth: f });
    try {
      expect((await call(t.url, '/api/tasks', { headers: { host: 'localhost' } })).status).toBe(200);
      const me = JSON.parse((await call(t.url, '/.auth/me', { headers: { host: 'localhost' } })).body) as { clientPrincipal: { userDetails: string } };
      expect(me.clientPrincipal.userDetails).toBe('local');
      expect((await call(t.url, '/api/tasks', { headers: { host: 'evil.example' } })).status).toBe(403);
    } finally { await t.close(); }
    const l = await startWeb({ ...quiet, dir: f.dir, port: 0, webDir: f.web, agents: false, auth: f, peer: () => REMOTE });
    try {
      for (const p of ['/pair', '/api/tasks', '/']) expect((await call(l.url, p, { headers: { host: `[::1]:4173`, authorization: `Bearer ${f.phone.token}` } })).status).toBe(403);
    } finally { await l.close(); }
    // A proxied request in loopback mode is remote, so it is refused too (tailscale serve needs bind tailnet).
    const p = await startWeb({ ...quiet, dir: f.dir, port: 0, webDir: f.web, agents: false, auth: f });
    try { expect((await call(p.url, '/api/tasks', { headers: { host: 'localhost', 'x-forwarded-for': REMOTE } })).status).toBe(403); } finally { await p.close(); }
  });

  // @req FR:tailnet-access/proxy.trust @req FR:tailnet-access/proxy.host @req FR:tailnet-access/proxy.secure
  it('tailscale serve: a proxied loopback request is remote, uses the forwarded host, and gets a Secure cookie', async () => {
    const f = await fixture();
    const s = await startWeb({ ...quiet, dir: f.dir, port: 0, webDir: f.web, agents: false, bind: 'tailnet', tailnet: () => ['::1'], auth: f });
    try {
      const fwd = { host: `127.0.0.1:${new URL(s.url).port}`, 'x-forwarded-host': TS_HOST, 'x-forwarded-proto': 'https', 'x-forwarded-for': REMOTE, 'tailscale-user-login': 'owner@example.com' };
      expect((await call(s.url, '/api/tasks', { headers: fwd })).status).toBe(401);
      const ok = await call(s.url, '/.auth/pair', { method: 'POST', headers: { ...fwd, ...json, origin: `https://${TS_HOST}`, 'sec-fetch-site': 'same-origin' }, body: JSON.stringify({ token: f.phone.token }) });
      expect(ok.status).toBe(204);
      expect(ok.headers['set-cookie']?.[0]).toMatch(/; Secure$/);
      expect((await call(s.url, '/api/tasks', { headers: { ...fwd, cookie: `stack_device=${f.phone.token}` } })).status).toBe(200);
      expect((await call(s.url, '/api/tasks', { headers: { ...fwd, 'x-forwarded-host': 'evil.example', cookie: `stack_device=${f.phone.token}` } })).status).toBe(403);
    } finally { await s.close(); }
    // From a tailnet peer the same headers are ignored: Host 127.0.0.1 is not a tailnet host.
    const r = await startWeb({ ...quiet, dir: f.dir, port: 0, webDir: f.web, agents: false, bind: 'tailnet', tailnet: () => ['::1'], auth: f, peer: () => REMOTE });
    try {
      const spoof = { host: '127.0.0.1:4173', 'x-forwarded-host': TS_HOST, 'x-forwarded-proto': 'https', authorization: `Bearer ${f.phone.token}` };
      expect((await call(r.url, '/api/tasks', { headers: spoof })).status).toBe(403);
      const pair = await call(r.url, '/.auth/pair', { method: 'POST', headers: { host: `[::1]:4173`, 'x-forwarded-proto': 'https', ...json }, body: JSON.stringify({ token: f.phone.token }) });
      expect(pair.headers['set-cookie']?.[0]).not.toContain('Secure');
    } finally { await r.close(); }
  });
});

describe('phone access doc', () => {
  const read = (p: string) => readFileSync(join(__dirname, '../..', p), 'utf8');
  // @req FR:tailnet-access/docs.phone
  it('gives the human steps as one short numbered list', () => {
    const doc = read('docs/phone-access.md');
    const steps = doc.split('## Steps')[1].split('\n## ')[0].split('\n').filter((l) => /^\d+\. /.test(l));
    expect(steps.length).toBeGreaterThanOrEqual(7);
    expect(steps.length).toBeLessThanOrEqual(10);
    const text = steps.join('\n');
    for (const s of ['Tailscale', 'iPhone', 'MagicDNS', 'HTTPS', 'tailscale serve', '--bind tailnet', 'stack devices add', 'Pair this phone', 'Add to Home Screen']) expect(text).toContain(s);
  });
  // @req FR:tailnet-access/docs.threat
  it('keeps the threat notes to 10 lines and lists the tailnet boundary in the threat model', () => {
    const notes = read('docs/phone-access.md').split('## Threat notes')[1].trim().split('\n').filter((l) => l.trim());
    expect(notes.length).toBeLessThanOrEqual(10);
    expect(read('docs/security/threat-model.md')).toMatch(/Tailnet to Mac host/);
  });
});

describe('remote gate, review round 1', () => {
  const host = { host: '[::1]:4173' };
  async function server() {
    const f = await fixture();
    mkdirSync(join(f.web, 'icons'));
    writeFileSync(join(f.web, 'manifest.webmanifest'), '{"name":"Stack"}');
    writeFileSync(join(f.web, 'icons/apple-touch-icon.png'), 'png');
    const s = await startWeb({ ...quiet, dir: f.dir, port: 0, webDir: f.web, agents: false, bind: 'tailnet', tailnet: () => ['::1'], auth: f, peer: () => REMOTE });
    return { f, s };
  }
  // @req FR:tailnet-access/gate.public
  it('serves the manifest and icons without a token, so Add to Home Screen works before pairing', async () => {
    const { s } = await server();
    try {
      const m = await call(s.url, '/manifest.webmanifest', { headers: host });
      expect([m.status, m.headers['content-type']]).toEqual([200, 'application/manifest+json']);
      expect((await call(s.url, '/icons/apple-touch-icon.png', { headers: host })).status).toBe(200);
      expect((await call(s.url, '/icons/icon-192.png', { headers: host })).status).toBe(404);
      expect((await call(s.url, '/index.html', { headers: host })).status).toBe(302);
      expect(PAIR_HTML).toContain('<link rel="manifest" href="/manifest.webmanifest"');
    } finally { await s.close(); }
  });
  // @req FR:tailnet-access/gate.scope
  it('device self endpoints run as the device token: the phone saves its push subscription', async () => {
    const { f, s } = await server();
    try {
      const sub = JSON.stringify({ endpoint: 'https://web.push.apple.com/abc', keys: { p256dh: 'BAAA', auth: 'AAAA' } });
      const put = await call(s.url, '/api/auth/devices/me/push', { method: 'PUT', headers: { ...host, ...json, cookie: `stack_device=${f.phone.token}`, 'sec-fetch-site': 'same-origin' }, body: sub });
      expect(put.status).toBe(200);
      expect((await f.devices.list())[0].push).toBe(true);
      // Dot segments cannot sneak past the admin guard.
      expect((await call(s.url, '/api/auth/devices/me/../../tokens', { headers: { ...host, cookie: `stack_device=${f.phone.token}` } })).status).toBe(403);
    } finally { await s.close(); }
  });
  // @req FR:tailnet-access/gate.csrf
  it('refuses a same-site write (another *.ts.net node is same-site)', async () => {
    const { f, s } = await server();
    try {
      expect((await call(s.url, '/api/tasks/complete', { method: 'POST', headers: { ...host, ...json, authorization: `Bearer ${f.phone.token}`, 'sec-fetch-site': 'same-site' }, body: JSON.stringify({ ref: 'alpha:4' }) })).status).toBe(403);
    } finally { await s.close(); }
  });
  // @req FR:tailnet-access/pair.logout
  it('logout clears a revoked cookie too', async () => {
    const { f, s } = await server();
    try {
      await f.devices.revoke(f.phone.device.id);
      const out = await call(s.url, '/.auth/logout', { headers: { ...host, cookie: `stack_device=${f.phone.token}` } });
      expect(out.status).toBe(302);
      expect(out.headers['set-cookie']?.[0]).toContain('Max-Age=0');
    } finally { await s.close(); }
  });
  // @req FR:tailnet-access/bind.@cli
  it('stack web refuses a bad --bind with exit 2', async () => {
    let err = '';
    const code = await run(['web', '--bind', 'lan'], { out: () => undefined, err: (x) => { err += x; } });
    expect(code).toBe(2);
    expect(err).toContain('--bind must be loopback or tailnet');
  });
});
