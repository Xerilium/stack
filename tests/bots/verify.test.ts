import { createHmac } from 'crypto';
import { verifyGithub, verifySlack, verifyWebhook } from '../../src/bots/verify';

const hmac = (s: string, m: string) => createHmac('sha256', s).update(m).digest('hex');
const NOW = 1_800_000_000_000;
const ts = String(NOW / 1000);

// @req FR:chat-bots/sig.slack @req FR:chat-bots/sig.replay @req FR:chat-bots/sig.compare
describe('verifySlack', () => {
  const sign = (body: string, t = ts, secret = 's3') => `v0=${hmac(secret, `v0:${t}:${body}`)}`;
  it('accepts a valid signature', () => {
    expect(verifySlack('s3', 'a=b', ts, sign('a=b'), NOW)).toBe(true);
  });
  it('rejects wrong secret, tampered body, bad format, missing parts', () => {
    expect(verifySlack('s3', 'a=b', ts, sign('a=b', ts, 'other'), NOW)).toBe(false);
    expect(verifySlack('s3', 'a=c', ts, sign('a=b'), NOW)).toBe(false);
    expect(verifySlack('s3', 'a=b', ts, 'v0=zz', NOW)).toBe(false);
    expect(verifySlack('s3', 'a=b', ts, sign('a=b').slice(3), NOW)).toBe(false);
    expect(verifySlack('s3', 'a=b', ts, null, NOW)).toBe(false);
    expect(verifySlack('s3', 'a=b', null, sign('a=b'), NOW)).toBe(false);
    expect(verifySlack('', 'a=b', ts, sign('a=b', ts, ''), NOW)).toBe(false);
  });
  it('enforces the replay window both ways', () => {
    const old = String(NOW / 1000 - 301);
    expect(verifySlack('s3', 'x', old, sign('x', old), NOW)).toBe(false);
    const fut = String(NOW / 1000 + 301);
    expect(verifySlack('s3', 'x', fut, sign('x', fut), NOW)).toBe(false);
    const edge = String(NOW / 1000 - 300);
    expect(verifySlack('s3', 'x', edge, sign('x', edge), NOW)).toBe(true);
    expect(verifySlack('s3', 'x', old, sign('x', old), NOW, 400)).toBe(true);
  });
  it('rejects non-integer timestamps', () => {
    for (const t of ['1e9', '1800000000.5', ' 1800000000', 'abc', '']) expect(verifySlack('s3', 'x', t, sign('x', t), NOW)).toBe(false);
  });
});

// @req FR:chat-bots/sig.webhook @req FR:chat-bots/sig.replay
describe('verifyWebhook', () => {
  const sign = (body: string, t = ts) => `sha256=${hmac('sec', `${t}.${body}`)}`;
  it('accepts valid and rejects invalid/stale', () => {
    expect(verifyWebhook('sec', '{}', ts, sign('{}'), NOW)).toBe(true);
    expect(verifyWebhook('sec', '{ }', ts, sign('{}'), NOW)).toBe(false);
    expect(verifyWebhook('sec', '{}', ts, sign('{}').replace('sha256=', ''), NOW)).toBe(false);
    expect(verifyWebhook('sec', '{}', ts, `sha256=${'0'.repeat(10)}`, NOW)).toBe(false);
    const old = String(NOW / 1000 - 1000);
    expect(verifyWebhook('sec', '{}', old, sign('{}', old), NOW)).toBe(false);
    expect(verifyWebhook('', '{}', ts, `sha256=${hmac('', `${ts}.{}`)}`, NOW)).toBe(false);
  });
});

// @req FR:chat-bots/sig.github
describe('verifyGithub', () => {
  it('checks X-Hub-Signature-256 over the raw body', () => {
    const sig = `sha256=${hmac('gh', 'body')}`;
    expect(verifyGithub('gh', 'body', sig)).toBe(true);
    expect(verifyGithub('gh', 'body2', sig)).toBe(false);
    expect(verifyGithub('gh', 'body', sig.toUpperCase())).toBe(false);
    expect(verifyGithub('gh', 'body', null)).toBe(false);
    expect(verifyGithub('', 'body', `sha256=${hmac('', 'body')}`)).toBe(false);
  });
});
