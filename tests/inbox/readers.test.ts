import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createMailReaders } from '../../src/inbox/readers';
import { accountCachePath, FileTokenCache } from '../../src/graph/auth';

const tok = { version: 1 as const, tenant: 'organizations', clientId: '11111111-1111-1111-1111-111111111111', refreshToken: 'r', accessToken: 'a', expiresAt: Date.now() + 3600_000 };

// @req FR:inbox-page/detail.read @req FR:inbox-page/detail.offline.cause
describe('createMailReaders', () => {
  it('gives a reader only for an account with a mail sign-in, and reads with GET', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'readers-'));
    await new FileTokenCache(accountCachePath('me@example.test', dir)).write({ ...tok, scopes: ['Mail.ReadWrite', 'offline_access'], account: 'me@example.test' });
    await new FileTokenCache(accountCachePath('cal@example.test', dir)).write({ ...tok, scopes: ['Calendars.Read', 'offline_access'], account: 'cal@example.test' });
    const calls: { method: string; url: string }[] = [];
    const fetch = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ method: init?.method ?? 'GET', url: String(url) });
      const body = new URL(String(url)).pathname.endsWith('/messages') ? { value: [] } : { id: 'AAMk1', conversationId: 'c1', subject: 'Hi', from: { emailAddress: { address: 'ann@x.test' } }, receivedDateTime: '2026-10-28T09:00:00Z', body: { contentType: 'text', content: 'Hello' } };
      return new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as typeof globalThis.fetch;
    const readers = createMailReaders({ dir, fetch });
    expect(await readers('cal@example.test')).toBeUndefined();
    expect(await readers('nobody@example.test')).toBeUndefined();
    expect(await readers('not an address')).toBeUndefined();
    const r = await (await readers('me@example.test'))!.thread('AAMk1');
    expect(r.message.body).toBe('Hello');
    expect(calls.length).toBe(4);
    expect(calls.every((c) => c.method === 'GET' && c.url.startsWith('https://graph.microsoft.com/v1.0/me/'))).toBe(true);
  });
});
