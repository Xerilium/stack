/** @req FR:pwa/notify.optin @req FR:pwa/notify.new @req FR:pwa/notify.quiet @req FR:pwa/notify.none */
import { describe, expect, it } from 'vitest';
import { loadNotify, noteFor, notifySupported, quiet, saveNotify, TAG } from '../src/notify';

const at = (h: number) => new Date(2026, 9, 28, h, 0);
const ask = (x: Partial<{ ask: string; project: string; by: string; priority: 'crit' | 'high' | 'normal' | 'low' }>) => ({ ask: 'Approve release', priority: 'normal' as const, ...x });

describe('notifications', () => {
  it('stores only stack.notify, on or absent', () => {
    const m = new Map<string, string>();
    const s = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
    expect(loadNotify(s)).toBe(false);
    saveNotify(s, true);
    expect([...m.entries()]).toEqual([['stack.notify', 'on']]);
    saveNotify(s, false);
    expect(m.size).toBe(0);
    expect(loadNotify(undefined)).toBe(false);
  });
  it('one ask: its text and project; several: a count', () => {
    expect(noteFor([ask({ project: 'catalyst' })], at(10))).toEqual({ title: 'Approve release', body: 'catalyst', tag: TAG });
    expect(noteFor([ask({ ask: 'A' }), ask({ ask: 'B' })], at(10))).toEqual({ title: '2 new asks', body: 'A', tag: TAG });
    expect(noteFor([], at(10))).toBeNull();
  });
  it('is quiet at night unless crit or due within 2 h', () => {
    expect(quiet(at(22))).toBe(true);
    expect(quiet(at(7))).toBe(true);
    expect(quiet(at(8))).toBe(false);
    expect(noteFor([ask({})], at(22))).toBeNull();
    expect(noteFor([ask({ priority: 'crit' })], at(22))?.title).toBe('Approve release');
    expect(noteFor([ask({ by: new Date(2026, 9, 28, 23, 0).toISOString() })], at(22))?.title).toBe('Approve release');
  });
  it('needs the Notifications API and service workers', () => {
    expect(notifySupported({} as never)).toBe(false);
    expect(notifySupported({ Notification: {}, navigator: {} } as never)).toBe(false);
    expect(notifySupported({ Notification: {}, navigator: { serviceWorker: {} } } as never)).toBe(true);
  });
});
