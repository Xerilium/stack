/**
 * Signature checks for inbound bot requests. Pure; fail closed on any malformed input.
 * @req FR:chat-bots/sig.compare @req FR:chat-bots/sig.replay
 */
import { createHmac, timingSafeEqual } from 'crypto';

export const DEFAULT_REPLAY_SECONDS = 300;

const hex = (secret: string, msg: string) => createHmac('sha256', secret).update(msg).digest('hex');

/** Timing-safe string compare; lengths are checked first (timingSafeEqual throws on mismatch). */
function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Integer epoch seconds within `window` of `nowMs`. */
function fresh(ts: string | null, nowMs: number, window: number): ts is string {
  if (ts === null || !/^\d{1,12}$/.test(ts)) return false;
  return Math.abs(Math.floor(nowMs / 1000) - Number(ts)) <= window;
}

function check(secret: string, prefix: string, message: string, header: string | null): boolean {
  if (!secret || header === null || !header.startsWith(prefix)) return false;
  return safeEqual(header.slice(prefix.length), hex(secret, message));
}

/** @req FR:chat-bots/sig.slack */
export function verifySlack(secret: string, body: string, ts: string | null, sig: string | null, nowMs: number, window = DEFAULT_REPLAY_SECONDS): boolean {
  if (!fresh(ts, nowMs, window)) return false;
  return check(secret, 'v0=', `v0:${ts}:${body}`, sig);
}

/** @req FR:chat-bots/sig.webhook */
export function verifyWebhook(secret: string, body: string, ts: string | null, sig: string | null, nowMs: number, window = DEFAULT_REPLAY_SECONDS): boolean {
  if (!fresh(ts, nowMs, window)) return false;
  return check(secret, 'sha256=', `${ts}.${body}`, sig);
}

/** @req FR:chat-bots/sig.github */
export function verifyGithub(secret: string, body: string, sig: string | null): boolean {
  return check(secret, 'sha256=', body, sig);
}
