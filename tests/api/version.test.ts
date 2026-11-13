import { createApiHandler } from '../../src/api/handler';
import { UpdateRefused, type AppUpdater, type UpdateMode, type VersionState } from '../../src/core/app-update';
import { MemoryStorage } from '../../src/core/storage';

const OWNER = Buffer.from(JSON.stringify({ identityProvider: 'github', userId: 'o', userRoles: ['authenticated'] })).toString('base64');
const STAMP = { version: '0.0.1', sha: 'bbbbbbbbbbbb', dirty: false, builtAt: '2026-11-12T10:00:00.000Z' };

class Batching extends MemoryStorage {
  count = 0; fail: Error | null = null; flushes = 0;
  pending() { return { count: this.count, since: null, paths: [] as string[] }; }
  async flush(): Promise<string | null> { this.flushes++; if (this.fail) throw this.fail; this.count = 0; return 'abc'; }
}

function fakeApp(o: Partial<VersionState> = {}) {
  let s: VersionState = { running: null, available: STAMP, ready: true, mode: 'on-quit', idleMinutes: 30, canRestart: true, last: null, ...o };
  const calls: string[] = [];
  const app: AppUpdater = {
    state: () => s,
    setMode: (mode: UpdateMode, idleMinutes?: number) => { s = { ...s, mode, ...(idleMinutes !== undefined ? { idleMinutes } : {}) }; return s; },
    restart: () => { if (!s.ready) throw new UpdateRefused('No update ready'); calls.push('restart'); },
    onQuit: () => false,
    idleCheck: () => false,
  };
  return { app, calls };
}

const mk = (o: { storage?: MemoryStorage; app?: AppUpdater } = {}) => {
  const h = createApiHandler({ storage: o.storage ?? new MemoryStorage(), authorize: () => true, ...(o.app ? { app: o.app } : {}) });
  return async (method: string, path: string, body?: unknown, owner = true) => {
    const headers: Record<string, string> = { ...(owner ? { 'x-ms-client-principal': OWNER } : {}), ...(body ? { 'content-type': 'application/json' } : {}) };
    const res = await h(new Request(`https://x.test${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) }));
    const text = await res.text();
    return { status: res.status, headers: res.headers, json: text ? JSON.parse(text) : undefined };
  };
};

describe('GET /api/version', () => {
  // @req FR:devops-installer/version.@api @req FR:devops-installer/version.get @req FR:devops-installer/$version-state
  it('answers the version state, not cached', async () => {
    const { app } = fakeApp();
    const r = await mk({ app })('GET', '/api/version');
    expect(r.status).toBe(200);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.json).toEqual(app.state());
  });
  // @req FR:devops-installer/version.get
  it('is 404 on a host with no installer', async () => {
    expect((await mk()('GET', '/api/version')).status).toBe(404);
  });
});

describe('POST /api/version/mode', () => {
  // @req FR:devops-installer/version.mode
  it('saves the mode (owner only) and rejects bad values', async () => {
    const { app } = fakeApp();
    const call = mk({ app });
    const r = await call('POST', '/api/version/mode', { mode: 'auto-idle', idleMinutes: 15 });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ mode: 'auto-idle', idleMinutes: 15 });
    expect((await call('POST', '/api/version/mode', { mode: 'sometimes' })).status).toBe(422);
    expect((await call('POST', '/api/version/mode', { mode: 'ask', idleMinutes: 1 })).status).toBe(422);
    expect((await call('POST', '/api/version/mode', { mode: 'ask' }, false)).status).toBe(403);
  });
});

describe('POST /api/version/restart', () => {
  // @req FR:devops-installer/restart.@api @req FR:devops-installer/restart.owner @req FR:devops-installer/restart.flush @req FR:devops-installer/restart.spawn
  it('commits the live batch first, then restarts (owner only)', async () => {
    const s = new Batching(); s.count = 2;
    const { app, calls } = fakeApp();
    const call = mk({ storage: s, app });
    expect((await call('POST', '/api/version/restart', undefined, false)).status).toBe(403);
    expect(calls).toEqual([]);
    const r = await call('POST', '/api/version/restart');
    expect(r).toMatchObject({ status: 200, json: { restarting: true } });
    expect(s.flushes).toBe(1);
    expect(calls).toEqual(['restart']);
  });
  // @req FR:devops-installer/restart.flush
  it('a failed commit restarts nothing', async () => {
    const s = new Batching(); s.count = 1; s.fail = new Error('push rejected');
    const { app, calls } = fakeApp();
    const r = await mk({ storage: s, app })('POST', '/api/version/restart');
    expect(r.status).toBe(500);
    expect(calls).toEqual([]);
  });
  // @req FR:devops-installer/restart.ready
  it('is 409 when no update is ready or the host cannot restart', async () => {
    expect((await mk({ app: fakeApp({ ready: false }).app })('POST', '/api/version/restart')).json).toMatchObject({ error: { code: 'conflict', message: 'No update ready' } });
    const r = await mk({ app: fakeApp({ canRestart: false }).app })('POST', '/api/version/restart');
    expect(r.status).toBe(409);
    expect(r.json.error.message).toBe('Restart is not available on this host');
  });
});
