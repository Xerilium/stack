/** @req FR:pr-review-lane/panel.chip @req FR:pr-review-lane/panel.check */
import { describe, expect, it } from 'vitest';
import { byWord, CHIP, liveClient, toggleOp } from '../src/live-lane';

describe('live lane helpers', () => {
  it('chip words per lane state', () => {
    expect(CHIP).toEqual({ idle: 'Idle', preparing: 'Preparing', working: 'Agent working', 'ready-for-michael': 'Ready for you', revalidating: 'Recheck' });
  });
  it('a tap toggles passed and open', () => {
    expect(toggleOp({ state: 'passed' })).toBe('uncheck');
    expect(toggleOp({ state: 'open' })).toBe('check');
    expect(toggleOp({ state: 'needs-fix' })).toBe('check');
    expect(byWord('owner')).toBe('you');
    expect(byWord('live-1')).toBe('live-1');
  });
  it('posts item ops to /live/items and surfaces API errors', async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    const ok = liveClient((async (url: string, init?: RequestInit) => { calls.push({ url, init }); return new Response(JSON.stringify({ changed: true, item: { id: 'li-00000001' } }), { status: 200 }); }) as typeof fetch);
    await ok.item({ repo: 'o/r', number: 1 }, 'check', { id: 'li-00000001' });
    expect(calls[0].url).toBe('/api/live/items');
    expect(JSON.parse(String(calls[0].init?.body))).toEqual({ op: 'check', repo: 'o/r', number: 1, id: 'li-00000001' });
    const bad = liveClient((async () => new Response(JSON.stringify({ error: { code: 'not_found', message: 'o/r#1 is not the live PR' } }), { status: 404 })) as typeof fetch);
    await expect(bad.lane()).rejects.toThrow('o/r#1 is not the live PR');
  });
});
