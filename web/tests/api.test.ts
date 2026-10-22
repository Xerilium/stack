import { describe, expect, it } from 'vitest';
import { ApiFailure, createClient } from '../src/api';

const res = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const rec = (handler: (url: string, init: RequestInit) => Response) => {
  const calls: { url: string; init: RequestInit }[] = [];
  const fetchFn = (async (url: string, init: RequestInit = {}) => { calls.push({ url, init }); return handler(url, init); }) as typeof fetch;
  return { calls, client: createClient(fetchFn) };
};

// @req FR:web-app/api.client
describe('api client', () => {
  it('pages through tasks until total', async () => {
    const { client, calls } = rec((url) => {
      const off = Number(new URL(url, 'http://x').searchParams.get('offset'));
      return res(200, { items: Array.from({ length: off === 0 ? 200 : 5 }, (_, i) => ({ ref: `a:${off + i}`, text: 't', project: 'a', section: 's', done: false })), total: 205, offset: off, limit: 200 });
    });
    const all = await client.tasks();
    expect(all).toHaveLength(205);
    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain('state=all');
    expect(calls[0].url).toContain('fields=ref,text,project,section,done,depth,notes');
  });
  it('sends JSON bodies and only that header', async () => {
    const { client, calls } = rec(() => res(200, { changed: true, ref: 'a:1' }));
    await client.set('a:1', { priority: '‼️' });
    expect(calls[0].url).toBe('/api/tasks/set');
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.headers).toEqual({ 'content-type': 'application/json' });
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ ref: 'a:1', priority: '‼️' });
    expect(calls[0].init.credentials).toBe('same-origin');
  });
  it('turns error bodies into ApiFailure', async () => {
    const { client } = rec(() => res(422, { error: { code: 'invalid', message: 'Bad' } }));
    await expect(client.capture('x')).rejects.toMatchObject({ status: 422, code: 'invalid', message: 'Bad' });
    const { client: c2 } = rec(() => new Response('<html>', { status: 502 }));
    const e = await c2.next().catch((x) => x);
    expect(e).toBeInstanceOf(ApiFailure);
    expect(e.status).toBe(502);
  });
  it('covers the other calls', async () => {
    const { client, calls } = rec((url) => res(200, url.includes('/projects') ? { items: [] } : url.includes('/next') ? { task: null } : { changed: true }));
    await client.next(); await client.projects(); await client.action('start', 'a:1'); await client.edit('a:1', 'x');
    await client.move('a:1', 'a:2', 'after'); await client.capture('x', { project: 'a', dryRun: true });
    expect(calls.map((c) => c.url)).toEqual(['/api/next', '/api/projects?fields=name,title,open,done,metadata', '/api/tasks/start', '/api/tasks/edit', '/api/tasks/move', '/api/capture']);
    expect(JSON.parse(calls[5].init.body as string)).toEqual({ text: 'x', project: 'a', dryRun: true });
  });
});
