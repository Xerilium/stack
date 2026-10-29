/**
 * The one outbound call that is not Graph: an RFC 8058 one-click unsubscribe POST, only to port 443 on a host whose every
 * address is public, connected to the address that was checked (no second lookup, so no DNS rebinding), no redirects.
 * @req FR:email-runner/http.safe
 */
import { lookup } from 'dns/promises';
import { request } from 'https';
import { BlockList, isIP } from 'net';
import type { Http } from './hygiene';

export const HTTP_TIMEOUT_MS = 10_000;

// Separate lists: an IPv6 rule such as ::ffff:0:0/96 would otherwise match every IPv4 address.
const blocked4 = new BlockList();
const blocked6 = new BlockList();
for (const [net, bits] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 3]] as const) blocked4.addSubnet(net, bits, 'ipv4');
for (const [net, bits] of [['::', 128], ['::1', 128], ['::ffff:0:0', 96], ['64:ff9b::', 96], ['100::', 64], ['2001:db8::', 32], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]] as const) blocked6.addSubnet(net, bits, 'ipv6');

/** Private, loopback, link-local, CGNAT, multicast, unique-local, mapped, NAT64 and documentation ranges, in any written form. */
export function isPrivateAddress(a: string): boolean {
  const v = a.replace(/^\[|\]$/g, '');
  const fam = isIP(v);
  if (!fam) return true;
  if (fam === 6) {
    // An IPv4-mapped address is judged by its IPv4 part, whatever its spelling.
    const m = /^(?:0{0,4}:){0,5}:?ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(v);
    if (m) return blocked4.check(m[1], 'ipv4');
    return blocked6.check(v, 'ipv6');
  }
  return blocked4.check(v, 'ipv4');
}

export type Resolve = (host: string) => Promise<{ address: string; family: number }[]>;
const resolveAll: Resolve = (host) => lookup(host, { all: true, verbatim: true });
/** POSTs to `url`, connecting only to `address`. Never follows redirects. */
export type Send = (url: URL, address: { address: string; family: number }, body: string, headers: Record<string, string>, timeoutMs: number) => Promise<number>;

const send: Send = (url, address, body, headers, timeoutMs) => new Promise((resolve) => {
  const req = request(url, {
    method: 'POST', headers: { ...headers, 'Content-Length': Buffer.byteLength(body) }, timeout: timeoutMs,
    lookup: (_h, _o, cb) => (cb as (e: null, a: string, f: number) => void)(null, address.address, address.family),
  }, (res) => { res.resume(); resolve(res.statusCode ?? 0); });
  req.on('timeout', () => req.destroy());
  req.on('error', () => resolve(0));
  req.end(body);
});

export function createSafeHttp(o: { resolve?: Resolve; send?: Send; timeoutMs?: number } = {}): Http {
  const resolve = o.resolve ?? resolveAll;
  const post = o.send ?? send;
  return {
    async post(url, body, headers) {
      let u: URL;
      try { u = new URL(url); } catch { return { status: 0 }; }
      if (u.protocol !== 'https:' || u.username || u.password || (u.port && u.port !== '443') || isIP(u.hostname.replace(/^\[|\]$/g, ''))) return { status: 0 };
      const addrs = await resolve(u.hostname).catch(() => []);
      if (!addrs.length || addrs.some((a) => isPrivateAddress(a.address))) return { status: 0 };
      const status = await post(u, addrs[0], body, headers, o.timeoutMs ?? HTTP_TIMEOUT_MS);
      // A redirect is not a confirmed unsubscribe.
      return { status: status >= 300 && status < 400 ? 0 : status };
    },
  };
}
