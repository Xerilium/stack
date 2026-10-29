/** @req FR:pwa/offline.sw @req FR:pwa/offline.private @req FR:pwa/notify.click */
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { describe, expect, it } from 'vitest';

const src = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const handlers: Record<string, (e: unknown) => void> = {};
const self: Record<string, unknown> = { location: { origin: 'https://stack.test' }, addEventListener: (t: string, f: (e: unknown) => void) => { handlers[t] = f; } };
runInNewContext(src, { self, URL, caches: {}, fetch: () => Promise.reject(new Error('offline')), Response, Headers });
const route = self.stackRoute as (u: string, m: string, o: string, mode?: string) => string;
const o = 'https://stack.test';

describe('service worker routes', () => {
  it('caches read-only data network-first', () => {
    for (const p of ['/api/next', '/api/tasks?state=all&limit=200', '/api/projects', '/api/asks?state=open', '/.auth/me']) expect(route(o + p, 'GET', o)).toBe('data');
  });
  it('caches the shell', () => {
    expect(route(o + '/', 'GET', o, 'navigate')).toBe('shell');
    expect(route(o + '/assets/index-abc.js', 'GET', o)).toBe('shell');
    expect(route(o + '/manifest.webmanifest', 'GET', o)).toBe('shell');
  });
  it('never touches writes, events, other api paths, or other origins', () => {
    expect(route(o + '/api/tasks', 'POST', o)).toBe('pass');
    expect(route(o + '/events', 'GET', o)).toBe('pass');
    expect(route(o + '/api/asks/x/answer', 'GET', o)).toBe('pass');
    expect(route(o + '/.auth/logout', 'GET', o, 'navigate')).toBe('pass');
    expect(route(o + '/somewhere', 'GET', o, 'navigate')).toBe('pass');
    expect(route('https://evil.test/api/tasks', 'GET', o)).toBe('pass');
  });
  it('handles install, activate, fetch, message, and notification clicks', () => {
    expect(Object.keys(handlers).sort()).toEqual(['activate', 'fetch', 'install', 'message', 'notificationclick']);
    expect(src).not.toMatch(/skipWaiting/);
  });
});
