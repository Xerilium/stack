import { createApiHandler } from '../../src/api/handler';
import { MemoryStorage } from '../../src/core/storage';

const NOW = new Date('2026-10-22T18:00:00Z');
const mk = () => {
  const storage = new MemoryStorage();
  const h = createApiHandler({ storage, authorize: () => true, now: () => NOW });
  const call = async (method: string, path: string, body?: unknown) => {
    const init: RequestInit = { method, headers: body !== undefined ? { 'content-type': 'application/json' } : {} };
    if (body !== undefined) init.body = JSON.stringify(body);
    const res = await h(new Request(`https://x.test${path}`, init));
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : undefined };
  };
  return { call, storage };
};

// @req FR:quick-capture/api.route
describe('POST /capture', () => {
  it('adds a parsed task (201)', async () => {
    const { call, storage } = mk();
    await call('POST', '/api/projects', { name: 'Alpha' });
    const r = await call('POST', '/api/capture', { text: 'call dentist tomorrow 30m #alpha' });
    expect(r.status).toBe(201);
    expect(r.json.changed).toBe(true);
    expect(r.json.ref).toBe('alpha:' + r.json.ref.split(':')[1]);
    expect(r.json.spec).toMatchObject({ title: 'Call dentist', due: '2026-10-23', project: 'alpha' });
    expect((await storage.read('tasks/alpha.md')).content).toContain('📅 Oct 23: Call dentist 🟢');
  });

  it('uses the project option and supports dryRun', async () => {
    const { call, storage } = mk();
    await call('POST', '/api/projects', { name: 'Alpha' });
    const before = (await storage.read('tasks/alpha.md')).content;
    const r = await call('POST', '/api/capture', { text: 'x every monday', project: 'alpha', dryRun: true });
    expect(r.status).toBe(200);
    expect(r.json.after).toContain('🔄 Weekly: X');
    expect((await storage.read('tasks/alpha.md')).content).toBe(before);
  });

  it('validates', async () => {
    const { call } = mk();
    await call('POST', '/api/projects', { name: 'Alpha' });
    expect((await call('POST', '/api/capture', {})).status).toBe(422);
    expect((await call('POST', '/api/capture', { text: 'a', nope: 1 })).status).toBe(422);
    expect((await call('POST', '/api/capture', { text: 'a\nb', project: 'alpha' })).status).toBe(422);
    expect((await call('POST', '/api/capture', { text: 'tomorrow', project: 'alpha' })).status).toBe(422);
    expect((await call('POST', '/api/capture', { text: 'a b' })).status).toBe(422);
    expect((await call('POST', '/api/capture', { text: 'a b', project: 'ghost' })).status).toBe(404);
    expect((await call('GET', '/api/capture')).status).toBe(405);
  });

  it('is denied without authorization', async () => {
    const h = createApiHandler({ storage: new MemoryStorage() });
    expect((await h(new Request('https://x.test/api/capture', { method: 'POST' }))).status).toBe(401);
  });
});
