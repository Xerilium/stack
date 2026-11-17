/**
 * Tailnet access for `stack web`: Tailscale address detection, local or remote requests, the remote Host rule,
 * trusted proxy headers (loopback only), the device cookie, and the pairing page.
 * @req FR:tailnet-access/bind.detect @req FR:tailnet-access/gate.classify @req FR:tailnet-access/gate.host @req FR:tailnet-access/proxy.trust
 * @req NFR:tailnet-access/security: no new dependency; cookies and codes are never logged.
 */
import { networkInterfaces, type NetworkInterfaceInfo } from 'os';
import { isIP } from 'net';
import { UsageError } from './args';

export type BindMode = 'loopback' | 'tailnet';

/** The flag wins over user config `bind`; default `loopback`. @req FR:tailnet-access/bind.@cli */
export function bindMode(flag: string | true | undefined, config: unknown): BindMode {
  if (flag === true) throw new UsageError('--bind needs a value: loopback or tailnet');
  const v = flag ?? config;
  if (v === undefined) return 'loopback';
  if (v === 'loopback' || v === 'tailnet') return v;
  throw new UsageError(`${flag === undefined ? 'user config "bind"' : '--bind'} must be loopback or tailnet`);
}

export const NO_TAILSCALE = 'No Tailscale address found. Start Tailscale and sign in, then retry.';

const v4 = (a: string): number | null => {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(a);
  if (!m) return null;
  const p = m.slice(1).map(Number);
  return p.some((n) => n > 255) ? null : ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
};
/** 100.64.0.0/10 (Tailscale IPv4). */
const inCgnat = (a: string) => { const n = v4(a); return n !== null && (n & 0xffc00000) >>> 0 === 0x64400000; };
/** fd7a:115c:a1e0::/48 (Tailscale IPv6). */
const inTsV6 = (a: string) => isIP(a) === 6 && /^fd7a:115c:a1e0(:|$)/i.test(a.split('%')[0]);

/**
 * The machine's Tailscale addresses from the OS interface list. No network call, no `tailscale` CLI.
 * Never returns an unspecified address. @req FR:tailnet-access/bind.detect @req NFR:tailnet-access/test
 */
export function tailnetAddresses(ifaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): string[] {
  const out: string[] = [];
  for (const list of Object.values(ifaces)) for (const i of list ?? []) {
    if (i.internal) continue;
    if (inCgnat(i.address) || inTsV6(i.address)) if (!out.includes(i.address)) out.push(i.address);
  }
  return out;
}

/** An address a server may listen on in tailnet mode: a concrete IP, never `0.0.0.0` or `::`. @req FR:tailnet-access/bind.tailnet */
export const listenable = (a: string): boolean => isIP(a) !== 0 && a !== '0.0.0.0' && !/^[0:]+$/.test(a);

/** Loopback peer: 127.0.0.0/8, ::1, or an IPv4-mapped loopback. */
export function isLoopback(addr: string | undefined): boolean {
  if (!addr) return false;
  const a = addr.replace(/^::ffff:/i, '');
  return a === '::1' || (v4(a) !== null && a.startsWith('127.'));
}

/** Headers a proxy adds; any of them makes a loopback request remote (`tailscale serve`). @req FR:tailnet-access/gate.classify */
export const PROXY_HEADERS = ['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto', 'forwarded', 'tailscale-user-login'] as const;
type Headers = Record<string, string | string[] | undefined>;
const first = (v: string | string[] | undefined): string | undefined => { const s = Array.isArray(v) ? v[0] : v; return s?.split(',')[0].trim() || undefined; };

/** Local = loopback peer with no proxy header. Every other request is remote. @req FR:tailnet-access/gate.classify */
export const isLocal = (peer: string | undefined, h: Headers): boolean => isLoopback(peer) && PROXY_HEADERS.every((k) => h[k] === undefined);

/** Proxy headers count only from a loopback peer. @req FR:tailnet-access/proxy.trust @req FR:tailnet-access/proxy.host */
export function requestHost(peer: string | undefined, h: Headers): string | undefined {
  return (isLoopback(peer) ? first(h['x-forwarded-host']) : undefined) ?? first(h.host);
}
/** @req FR:tailnet-access/proxy.trust @req FR:tailnet-access/proxy.secure */
export const requestSecure = (peer: string | undefined, h: Headers): boolean => isLoopback(peer) && first(h['x-forwarded-proto'])?.toLowerCase() === 'https';

const TS_NET = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+ts\.net$/i;

/** A remote Host must be a bound Tailscale address (port optional) or a `*.ts.net` name. @req FR:tailnet-access/gate.host */
export function tailnetHostOk(host: string | undefined, addrs: string[]): boolean {
  if (!host) return false;
  const m = /^(?:\[([0-9a-f:.%]+)\]|([^:[\]]+))(?::(\d{1,5}))?$/i.exec(host);
  if (!m) return false;
  const name = (m[1] ?? m[2]).toLowerCase();
  if (m[1] !== undefined) return addrs.some((a) => a.toLowerCase() === name);
  return addrs.includes(name) || (isIP(name) === 0 && TS_NET.test(name));
}

export const COOKIE = 'stack_device';
/** 90 days, the device token life. */
const MAX_AGE = 90 * 24 * 3600;
const TOKEN_CHARS = /^[A-Za-z0-9._~-]{1,512}$/;

/** The device cookie; `Secure` on HTTPS (`tailscale serve`). @req FR:tailnet-access/pair.cookie @req FR:tailnet-access/proxy.secure */
export function deviceCookie(token: string, secure: boolean): string {
  if (!TOKEN_CHARS.test(token)) throw new Error('token has characters a cookie cannot hold');
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE}${secure ? '; Secure' : ''}`;
}
/** @req FR:tailnet-access/pair.logout */
export const clearCookie = (secure: boolean): string => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;

/** The device token from a `Cookie` header, or `null`. */
export function cookieToken(header: string | string[] | undefined): string | null {
  const s = Array.isArray(header) ? header.join('; ') : header;
  if (!s) return null;
  for (const part of s.split(';')) {
    const i = part.indexOf('=');
    if (i > 0 && part.slice(0, i).trim() === COOKIE) { const v = part.slice(i + 1).trim(); return TOKEN_CHARS.test(v) ? v : null; }
  }
  return null;
}

/** Paths a remote caller reaches with no token; none holds task data. @req FR:tailnet-access/gate.public */
export const PUBLIC_PATHS = new Set(['/pair', '/pair.js']);
/** Built files a remote caller gets with no token, so Add to Home Screen works before pairing. No data. @req FR:tailnet-access/gate.public */
export const PUBLIC_STATIC = new Set(['/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png']);
/** Remote paths that answer 401 instead of the pairing redirect. @req FR:tailnet-access/gate.token.page */
export const isDataPath = (p: string): boolean => p === '/api' || p.startsWith('/api/') || p === '/events' || p.startsWith('/sessions/') || p.startsWith('/.auth/');

/** Pairing page: no inline script or style, so the CSP stays `default-src 'self'`. @req FR:tailnet-access/pair.page */
export const PAIR_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Pair this phone - Stack</title>
<link rel="manifest" href="/manifest.webmanifest" crossorigin="use-credentials">
<link rel="icon" href="/icons/icon.svg" type="image/svg+xml">
<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Stack">
<script src="/pair.js" defer></script>
</head>
<body>
<main>
<h1>Pair this phone</h1>
<p>On the Mac, run <code>stack devices add iPhone</code>. Paste the code here.</p>
<form id="pair">
<label for="code">Pairing code</label>
<input id="code" name="code" autocomplete="off" autocapitalize="off" spellcheck="false" required>
<button type="submit">Pair</button>
</form>
<p id="msg" role="status"></p>
</main>
</body>
</html>
`;

/** Saves the code as `stack.device` (install screen), posts it, then opens the install screen. @req FR:tailnet-access/pair.page */
export const PAIR_JS = `(() => {
  const msg = document.getElementById('msg');
  const pair = async (raw) => {
    const code = raw.trim();
    if (!code) return;
    msg.textContent = 'Pairing...';
    let ok = false;
    try {
      const r = await fetch('/.auth/pair', { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ token: code }) });
      ok = r.status === 204;
    } catch { ok = false; }
    if (!ok) { msg.textContent = 'That code did not work. Make a new one on the Mac and try again.'; return; }
    try { localStorage.setItem('stack.device', code); } catch { /* storage off: the cookie still signs in */ }
    location.replace('/#/install');
  };
  let fromHash = '';
  try { fromHash = decodeURIComponent(location.hash.slice(1)); } catch { fromHash = ''; }
  if (fromHash) { history.replaceState(null, '', '/pair'); void pair(fromHash); }
  document.getElementById('pair').addEventListener('submit', (e) => { e.preventDefault(); void pair(document.getElementById('code').value); });
})();
`;
