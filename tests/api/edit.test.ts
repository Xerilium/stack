import { createApiHandler } from '../../src/api/handler';
import { MemoryStorage } from '../../src/core/storage';

const FILE = [
  '# Alpha', '', '- **Work capacity:** 10h', '',
  '## 🔄 Active', '',
  '- [ ] First 🟢',
  '  - [ ] Child of first',
  '  note under first',
  '- [ ] Second 🔴',
  '',
  '## 📋 Backlog', '',
  '- [ ] Third',
  '',
].join('\n');

const mk = async () => {
  const storage = new MemoryStorage();
  await storage.write('tasks/alpha.md', FILE);
  await storage.write('tasks/beta.md', '# Beta\n\n## 🔄 Active\n\n- [ ] Other\n');
  const h = createApiHandler({ storage, authorize: () => true });
  const call = async (path: string, body: unknown) => {
    const res = await h(new Request(`https://x.test/api${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }));
    return { status: res.status, json: await res.json() as any };
  };
  const rows = async () => (await storage.read('tasks/alpha.md')).content.split('\n').filter((l) => l.startsWith('- [') || l.startsWith('  ')).map((l) => l.trim());
  return { storage, call, rows };
};

// @req FR:web-app/api.edit
describe('POST /tasks/edit', () => {
  it('replaces the row text and keeps checkbox and indent', async () => {
    const { call, rows } = await mk();
    const r = await call('/tasks/edit', { ref: 'alpha:7', text: 'Child renamed 🟡' });
    expect(r.status).toBe(200);
    expect(r.json.changed).toBe(true);
    expect((await rows())[1]).toBe('- [ ] Child renamed 🟡');
  });
  it('keeps CRLF endings and done state', async () => {
    const storage = new MemoryStorage();
    await storage.write('tasks/a.md', '# A\r\n\r\n## Active\r\n\r\n- [x] Old\r\n');
    const h = createApiHandler({ storage, authorize: () => true });
    const res = await h(new Request('https://x.test/api/tasks/edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ref: 'a:4', text: 'New' }) }));
    expect(res.status).toBe(200);
    expect((await storage.read('tasks/a.md')).content).toBe('# A\r\n\r\n## Active\r\n\r\n- [x] New\r\n');
  });
  it('is a no-op for equal text', async () => {
    const { call } = await mk();
    expect((await call('/tasks/edit', { ref: 'alpha:6', text: 'First 🟢' })).json.changed).toBe(false);
  });
  it('rejects empty, multi-line, long, unknown, and non-task rows', async () => {
    const { call } = await mk();
    expect((await call('/tasks/edit', { ref: 'alpha:6', text: '  ' })).status).toBe(422);
    expect((await call('/tasks/edit', { ref: 'alpha:6', text: 'a\nb' })).status).toBe(422);
    expect((await call('/tasks/edit', { ref: 'alpha:6', text: 'x'.repeat(2001) })).status).toBe(422);
    expect((await call('/tasks/edit', { ref: 'alpha:6', text: 'x', extra: 1 })).status).toBe(422);
    expect((await call('/tasks/edit', { ref: 'alpha:4', text: 'x' })).status).toBe(404);
    expect((await call('/tasks/edit', { ref: 'alpha:999', text: 'x' })).status).toBe(404);
    expect((await call('/tasks/edit', { ref: 'nope:1', text: 'x' })).status).toBe(404);
  });
});

// @req FR:web-app/api.move
describe('POST /tasks/move', () => {
  it('moves a block (row, child, note) after a target', async () => {
    const { call, rows } = await mk();
    const r = await call('/tasks/move', { ref: 'alpha:6', target: 'alpha:9', position: 'after' });
    expect(r.status).toBe(200);
    expect(r.json.changed).toBe(true);
    expect(await rows()).toEqual(['- [ ] Second 🔴', '- [ ] First 🟢', '- [ ] Child of first', 'note under first', '- [ ] Third']);
    expect(r.json.ref).toBe('alpha:7');
  });
  it('moves before a target in another section', async () => {
    const { call, rows } = await mk();
    const r = await call('/tasks/move', { ref: 'alpha:9', target: 'alpha:13', position: 'before' });
    expect(r.status).toBe(200);
    expect((await rows()).slice(-2)).toEqual(['- [ ] Second 🔴', '- [ ] Third']);
  });
  it('is a no-op when the order would not change', async () => {
    const { call } = await mk();
    expect((await call('/tasks/move', { ref: 'alpha:6', target: 'alpha:9', position: 'before' })).json.changed).toBe(false);
  });
  it('rejects self, own subtree, other files, bad position', async () => {
    const { call } = await mk();
    expect((await call('/tasks/move', { ref: 'alpha:6', target: 'alpha:6', position: 'after' })).status).toBe(422);
    expect((await call('/tasks/move', { ref: 'alpha:6', target: 'alpha:7', position: 'after' })).status).toBe(422);
    expect((await call('/tasks/move', { ref: 'alpha:6', target: 'beta:4', position: 'after' })).status).toBe(422);
    expect((await call('/tasks/move', { ref: 'alpha:6', target: 'alpha:9', position: 'middle' })).status).toBe(422);
    expect((await call('/tasks/move', { ref: 'alpha:4', target: 'alpha:9', position: 'after' })).status).toBe(404);
  });
});

// @req FR:web-app/api.edit @req FR:web-app/api.move
describe('expected row text (stale line numbers)', () => {
  it('edit writes when expect matches and 409s when it does not', async () => {
    const { call, rows } = await mk();
    expect((await call('/tasks/edit', { ref: 'alpha:9', text: 'X', expect: 'First 🟢' })).status).toBe(409);
    expect((await rows()).join('|')).not.toContain('- [ ] X');
    expect((await call('/tasks/edit', { ref: 'alpha:6', text: 'First 🟡', expect: 'First 🟢' })).status).toBe(200);
  });
  it('move 409s on a stale ref or target and leaves the file alone', async () => {
    const { call, rows, storage } = await mk();
    const before = (await storage.read('tasks/alpha.md')).content;
    expect((await call('/tasks/move', { ref: 'alpha:6', target: 'alpha:9', position: 'after', expect: 'Second 🔴' })).status).toBe(409);
    expect((await call('/tasks/move', { ref: 'alpha:6', target: 'alpha:9', position: 'after', expectTarget: 'nope' })).status).toBe(409);
    expect((await storage.read('tasks/alpha.md')).content).toBe(before);
    expect((await call('/tasks/move', { ref: 'alpha:6', target: 'alpha:9', position: 'after', expect: 'First 🟢', expectTarget: 'Second 🔴' })).status).toBe(200);
    expect((await rows())[0]).toBe('- [ ] Second 🔴');
  });
});

describe('handler scope and CSRF mapping', () => {
  const body = JSON.stringify({ ref: 'a:4', text: 'Two' });
  const mkh = async (authorize: any) => {
    const storage = new MemoryStorage();
    await storage.write('tasks/a.md', '# A\n\n## Active\n\n- [ ] One\n');
    return createApiHandler({ storage, authorize });
  };
  it('passes route info with write=true and honors a deny', async () => {
    const seen: unknown[] = [];
    const h = await mkh((_r: Request, route: unknown) => { seen.push(route); return true; });
    await h(new Request('https://x.test/api/tasks/edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body }));
    await h(new Request('https://x.test/api/tasks/move', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ref: 'a:4', target: 'a:4', position: 'after' }) }));
    expect(seen).toEqual([{ name: 'tasks.edit', method: 'POST', write: true }, { name: 'tasks.move', method: 'POST', write: true }]);
    const deny = await mkh(() => false);
    expect((await deny(new Request('https://x.test/api/tasks/edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body }))).status).toBe(403);
    expect((await deny(new Request('https://x.test/api/tasks/move', { method: 'POST', headers: { 'content-type': 'application/json' }, body }))).status).toBe(403);
  });
  it('rejects GET, query strings, and non-JSON bodies', async () => {
    const h = await mkh(() => true);
    expect((await h(new Request('https://x.test/api/tasks/edit'))).status).toBeGreaterThanOrEqual(400);
    expect((await h(new Request('https://x.test/api/tasks/edit?x=1', { method: 'POST', headers: { 'content-type': 'application/json' }, body }))).status).toBe(422);
    expect((await h(new Request('https://x.test/api/tasks/edit', { method: 'POST', headers: { 'content-type': 'text/plain' }, body }))).status).toBeGreaterThanOrEqual(400);
  });
});

describe('conflicts and docs', () => {
  it('returns 409 when the file changed under the write', async () => {
    const storage = new MemoryStorage();
    await storage.write('tasks/a.md', '# A\n\n## Active\n\n- [ ] One\n');
    const real = storage.write.bind(storage);
    storage.write = async (p, c, o) => { await real(p, c + '\n- [ ] sneak\n'); return real(p, c, o); };
    const h = createApiHandler({ storage, authorize: () => true });
    const res = await h(new Request('https://x.test/api/tasks/edit', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ref: 'a:4', text: 'Two' }) }));
    expect(res.status).toBe(409);
  });
});
