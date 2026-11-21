import { createApiHandler } from '../../src/api/handler';
import { ConflictError, MemoryStorage, StorageError } from '../../src/core/storage';

const OWNER = Buffer.from(JSON.stringify({ identityProvider: 'github', userId: 'o', userRoles: ['authenticated'] })).toString('base64');
const TOKEN = 'stk_0123456789abcdef.secret';

/** A storage that batches: what the sync routes discover by duck typing. */
class Batching extends MemoryStorage {
  count = 0;
  since: Date | null = null;
  fail: Error | null = null;
  flushes = 0;
  pending() { return { count: this.count, since: this.since, paths: [] as string[] }; }
  async flush(): Promise<string | null> {
    this.flushes++;
    if (this.fail) throw this.fail;
    const n = this.count; this.count = 0; this.since = null;
    return n ? 'abc123' : null;
  }
}

const mk = (storage: MemoryStorage) => {
  const h = createApiHandler({ storage, authorize: () => true });
  return async (method: string, path: string, who: 'owner' | 'agent' | 'api' = 'owner') => {
    const headers: Record<string, string> = who === 'owner' ? { 'x-ms-client-principal': OWNER } : who === 'agent' ? { authorization: `Bearer ${TOKEN}` } : {};
    const res = await h(new Request(`https://x.test${path}`, { method, headers }));
    const text = await res.text();
    return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : undefined };
  };
};

describe('GET /api/sync', () => {
  // @req FR:live-deploy/sync.pending @req FR:live-deploy/$sync-state @req FR:live-deploy/sync.@api
  it('adds pending and since when the storage batches', async () => {
    const s = new Batching(); s.count = 2; s.since = new Date('2026-10-31T10:00:00Z');
    const call = mk(s);
    const r = await call('GET', '/api/sync');
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ rev: null, pending: 2, since: '2026-10-31T10:00:00.000Z' });
    expect(r.headers.get('cache-control')).toBe('no-store');
    s.count = 0; s.since = null;
    expect((await call('GET', '/api/sync')).json).toEqual({ rev: null, pending: 0, since: null });
  });
  // @req FR:live-deploy/sync.pending @req FR:live-deploy/sync.route
  it('omits both for a storage that does not batch', async () => {
    const call = mk(new MemoryStorage());
    expect((await call('GET', '/api/sync')).json).toEqual({ rev: null });
  });
});

describe('POST /api/sync', () => {
  // @req FR:live-deploy/sync.flush @req FR:live-deploy/$flush-result
  it('commits what is pending and answers flushed and rev', async () => {
    const s = new Batching(); s.count = 3; s.since = new Date();
    const call = mk(s);
    const r = await call('POST', '/api/sync');
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ flushed: 3, rev: 'abc123' });
    expect(s.flushes).toBe(1);
    expect((await call('GET', '/api/sync')).json).toMatchObject({ pending: 0 });
  });
  // @req FR:live-deploy/sync.flush.none
  it('answers flushed 0 and changes nothing when nothing is pending or the storage does not batch', async () => {
    const s = new Batching();
    const call = mk(s);
    expect((await call('POST', '/api/sync')).json).toEqual({ flushed: 0, rev: null });
    expect(s.flushes).toBe(0);
    expect((await mk(new MemoryStorage())('POST', '/api/sync')).json).toEqual({ flushed: 0, rev: null });
  });
  // @req FR:live-deploy/sync.flush
  it('is owner only', async () => {
    const s = new Batching(); s.count = 1;
    const call = mk(s);
    expect((await call('POST', '/api/sync', 'agent')).status).toBe(403);
    expect((await call('POST', '/api/sync', 'api')).status).toBe(403);
    expect(s.flushes).toBe(0);
    expect(s.count).toBe(1);
  });
  // @req FR:live-deploy/sync.flush.error
  it('reports a conflict as 409 and another failure as 500, with the storage message, and keeps the batch', async () => {
    const s = new Batching(); s.count = 1; s.since = new Date();
    const call = mk(s);
    s.fail = new ConflictError('Conflict on tasks/a.md: remote changed it concurrently');
    const c = await call('POST', '/api/sync');
    expect(c.status).toBe(409);
    expect(c.json.error).toMatchObject({ code: 'conflict', message: 'Conflict on tasks/a.md: remote changed it concurrently' });
    s.fail = new StorageError('git push failed: could not read from https://user:tok@github.com/x/y.git');
    const f = await call('POST', '/api/sync');
    expect(f.status).toBe(500);
    expect(f.json.error).toMatchObject({ code: 'internal', message: 'git push failed: could not read from <url>' });
    expect(s.count).toBe(1);
    expect((await call('GET', '/api/sync')).json).toMatchObject({ pending: 1 });
  });
});

describe('GET /api/sync drift', () => {
  const drift = { base: 'origin/main', state: 'conflict' as const, behind: 3, files: ['tasks/b.md'], at: '2026-11-20T12:00:00.000Z' };
  // @req FR:store-sync/host.api @req FR:store-sync/$drift-state
  it('adds drift when the host runs the store sync and it has a state', async () => {
    const h = createApiHandler({ storage: new MemoryStorage(), authorize: () => true, storeSync: { state: () => drift } });
    const r = await h(new Request('https://x.test/api/sync', { headers: { 'x-ms-client-principal': OWNER } }));
    expect(await r.json()).toEqual({ rev: null, drift });
  });
  // @req FR:store-sync/host.api
  it('omits drift before the first state', async () => {
    const h = createApiHandler({ storage: new MemoryStorage(), authorize: () => true, storeSync: { state: () => null } });
    const r = await h(new Request('https://x.test/api/sync', { headers: { 'x-ms-client-principal': OWNER } }));
    expect(await r.json()).toEqual({ rev: null });
  });
});
