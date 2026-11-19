import { describe, expect, it } from 'vitest';
import { ApiFailure, createClient, unreachable } from '../src/api';

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
  // @req FR:perf/client.pages
  it('fetches the pages after the first together', async () => {
    let live = 0, peak = 0;
    const fetchFn = (async (url: string) => {
      live++; peak = Math.max(peak, live);
      await Promise.resolve();
      live--;
      const off = Number(new URL(url, 'http://x').searchParams.get('offset'));
      return res(200, { items: Array.from({ length: Math.min(200, 650 - off) }, (_, i) => ({ ref: `a:${off + i}`, text: 't', project: 'a', section: 's', done: false })), total: 650, offset: off, limit: 200 });
    }) as typeof fetch;
    const all = await createClient(fetchFn).tasks();
    expect(all.map((t) => t.ref)).toEqual(Array.from({ length: 650 }, (_, i) => `a:${i}`));
    expect(peak).toBe(3);
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
  // @req FR:web-app/api.client.errors
  it('turns error bodies into ApiFailure', async () => {
    const { client } = rec(() => res(422, { error: { code: 'invalid', message: 'Bad' } }));
    await expect(client.capture('x')).rejects.toMatchObject({ status: 422, code: 'invalid', message: 'Bad' });
    const { client: c2 } = rec(() => new Response('<html>', { status: 502 }));
    const e = await c2.next().catch((x) => x);
    expect(e).toBeInstanceOf(ApiFailure);
    expect(e.status).toBe(502);
  });
  // @req FR:now-screen/now.action @req FR:pri-first-ranking/api.next
  it('nextStep reads the answer of stack next: the first priority action and the first owner task', async () => {
    const action = { pri: { id: 'fh', rank: 4, title: 'FH 0.11' }, text: 'answer the interview', score: 2400 };
    const { client, calls } = rec(() => res(200, { task: null, action }));
    expect(await client.nextStep()).toEqual({ task: null, action });
    expect(calls.map((c) => c.url)).toEqual(['/api/next']);
    const old = rec(() => res(200, { task: null })); // a host that has no action field yet
    expect(await old.client.nextStep()).toEqual({ task: null, action: null });
  });
  it('covers the other calls', async () => {
    const { client, calls } = rec((url) => res(200, url.includes('/projects') ? { items: [] } : url.includes('/next') ? { task: null } : { changed: true }));
    await client.next(); await client.projects(); await client.action('start', 'a:1'); await client.edit('a:1', 'x');
    await client.move('a:1', 'a:2', 'after'); await client.capture('x', { project: 'a', dryRun: true });
    expect(calls.map((c) => c.url)).toEqual(['/api/next', '/api/projects?fields=name,title,open,done,metadata', '/api/tasks/start', '/api/tasks/edit', '/api/tasks/move', '/api/capture']);
    expect(JSON.parse(calls[5].init.body as string)).toEqual({ text: 'x', project: 'a', dryRun: true });
  });
  it('sends the expected row text with edit and move', async () => {
    const { client, calls } = rec(() => res(200, { changed: true }));
    await client.edit('a:1', 'new', 'old');
    await client.move('a:1', 'a:2', 'after', { ref: 'r', target: 't' });
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ ref: 'a:1', text: 'new', expect: 'old' });
    expect(JSON.parse(calls[1].init.body as string)).toEqual({ ref: 'a:1', target: 'a:2', position: 'after', expect: 'r', expectTarget: 't' });
  });
});

// @req FR:web-shell/state.unreachable
describe('unreachable api', () => {
  it('a rejected fetch says where Stack was expected, not "Network error"', async () => {
    const client = createClient((async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch, 'http://localhost:4190/api');
    const e = await client.next().catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiFailure);
    expect((e as ApiFailure).code).toBe('network');
    expect((e as ApiFailure).message).toBe("Can't reach Stack at localhost:4190. Is stack web still running?");
  });
});

// @req FR:live-deploy/web.unsaved @req FR:live-deploy/web.unsaved.hide
describe('sync state and flush', () => {
  it('syncState reads rev, pending and since', async () => {
    const { client, calls } = rec(() => res(200, { rev: null, pending: 2, since: '2026-10-31T10:00:00.000Z' }));
    expect(await client.syncState()).toEqual({ rev: null, pending: 2, since: '2026-10-31T10:00:00.000Z' });
    expect(calls[0].url).toBe('/api/sync');
    expect(calls[0].init.method ?? 'GET').toBe('GET');
  });
  it('flush posts to /sync, with keepalive when the page is going away', async () => {
    const { client, calls } = rec(() => res(200, { flushed: 1, rev: 'abc' }));
    expect(await client.flush()).toEqual({ flushed: 1, rev: 'abc' });
    expect(calls[0].init.method).toBe('POST');
    expect(calls[0].init.keepalive).toBeUndefined();
    await client.flush(true);
    expect(calls[1].init.keepalive).toBe(true);
  });
});

describe('sync', () => {
  // @req FR:pr-priority/needs.poll
  it('joins rev and the live token; a null rev stays null', async () => {
    const one = (body: unknown) => createClient((async () => new Response(JSON.stringify(body), { status: 200 })) as typeof fetch);
    expect(await one({ rev: 'abc', live: '1.2' }).sync()).toBe('abc~1.2');
    expect(await one({ rev: 'abc' }).sync()).toBe('abc');
    expect(await one({ rev: null, live: '1.2' }).sync()).toBeNull();
  });
  // @req FR:pr-priority/needs.actions
  it('posts a PR priority decision to its decide path under the API base', async () => {
    const { client, calls } = rec(() => res(200, {}));
    await client.decideRec('/api/pr-priority/recommendations/r1', { decision: 'reject', reason: 'not now' });
    expect(calls[0].url).toBe('/api/pr-priority/recommendations/r1');
    expect(JSON.parse(calls[0].init.body as string)).toEqual({ decision: 'reject', reason: 'not now' });
  });
});

// @req FR:web-app/api.client
describe('api client: QM plan and live lane', () => {
  const html = () => new Response('<html><body>502 Bad Gateway</body></html>', { status: 502, headers: { 'content-type': 'text/html' } });
  it('reads /qm and /live, and posts /live/items', async () => {
    const { client, calls } = rec((url) => res(200, url.endsWith('/qm') ? { plan: null } : url.endsWith('/live') ? { state: 'idle', rev: 1, items: [], done: [] } : { changed: true, item: { id: 'li-00000001' } }));
    expect(await client.qm()).toEqual({ plan: null });
    expect((await client.live()).rev).toBe(1);
    await client.liveItem({ repo: 'o/r', number: 1 }, 'check', { id: 'li-00000001' });
    expect(calls.map((c) => c.url)).toEqual(['/api/qm', '/api/live', '/api/live/items']);
    expect(JSON.parse(String(calls[2].init.body))).toEqual({ op: 'check', repo: 'o/r', number: 1, id: 'li-00000001' });
  });
  // @req FR:web-app/api.client.errors
  it('a 502 text/html body rejects with ApiFailure 502, not SyntaxError', async () => {
    for (const read of [(c: ReturnType<typeof createClient>) => c.qm(), (c: ReturnType<typeof createClient>) => c.live()]) {
      const err = await read(rec(() => html()).client).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiFailure);
      expect((err as ApiFailure).status).toBe(502);
    }
  });
  // @req FR:web-app/api.client.errors
  it('a rejected fetch gives ApiFailure network with the unreachable text', async () => {
    const client = createClient((async () => { throw new TypeError('Failed to fetch'); }) as typeof fetch);
    for (const p of [client.qm(), client.live()]) {
      const err = await p.catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ApiFailure);
      expect((err as ApiFailure).code).toBe('network');
      expect((err as ApiFailure).message).toBe(unreachable());
    }
  });
  it('keeps the API error message for the live lane', async () => {
    const err = await rec(() => res(404, { error: { code: 'not_found', message: 'o/r#1 is not the live PR' } })).client.liveItem({ repo: 'o/r', number: 1 }, 'check').catch((e: unknown) => e);
    expect((err as ApiFailure).message).toBe('o/r#1 is not the live PR');
  });
  it('a live write while offline rejects with code offline and sends nothing', async () => {
    const { client, calls } = rec(() => res(200, {}));
    const was = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'navigator', { value: { onLine: false }, configurable: true });
    try {
      const err = await client.liveItem({ repo: 'o/r', number: 1 }, 'check').catch((e: unknown) => e);
      expect((err as ApiFailure).code).toBe('offline');
      expect(calls).toHaveLength(0);
    } finally { if (was) Object.defineProperty(globalThis, 'navigator', was); else delete (globalThis as { navigator?: unknown }).navigator; }
  });
});
