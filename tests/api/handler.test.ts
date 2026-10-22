import { createApiHandler, type ApiDeps } from '../../src/api/handler';
import { MemoryStorage } from '../../src/core/storage';

const allow = () => true;
const NOW = new Date('2026-10-22T18:00:00Z');
const mk = (over: Partial<ApiDeps> = {}) => {
  const storage = new MemoryStorage();
  const h = createApiHandler({ storage, authorize: allow, now: () => NOW, ...over });
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const init: RequestInit = { method, headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...headers } };
    if (body !== undefined) init.body = typeof body === 'string' ? body : JSON.stringify(body);
    const res = await h(new Request(`https://x.test${path}`, init));
    const text = await res.text();
    return { status: res.status, headers: res.headers, text, json: text ? JSON.parse(text) : undefined };
  };
  return { storage, h, call };
};
const seed = async (call: ReturnType<typeof mk>['call']) => {
  await call('POST', '/api/projects', { name: 'Alpha', aliases: ['al'], weeklyCapacity: 10 });
  await call('POST', '/api/tasks', { project: 'alpha', text: 'First task 🟢' });
  await call('POST', '/api/tasks', { project: 'al', text: 'Second task 🔴' });
};

// @req FR:api/handler.@function @req FR:api/handler.storage @req FR:api/auth.deny
describe('authorize', () => {
  it('denies everything when no hook is supplied', async () => {
    const { call } = mk({ authorize: undefined });
    for (const [m, p] of [['GET', '/api/next'], ['POST', '/api/tasks'], ['GET', '/api/nope']]) {
      const r = await call(m, p);
      expect(r.status).toBe(401);
      expect(r.json.error.code).toBe('unauthorized');
    }
  });
  // @req FR:api/auth.hook
  it('passes route info and an unread clone', async () => {
    const seen: unknown[] = [];
    const { call } = mk({ authorize: async (req, route) => { seen.push(route, await req.text()); return true; } });
    await call('POST', '/api/projects', { name: 'Zed' });
    expect(seen[0]).toEqual({ name: 'projects.add', method: 'POST', write: true });
    expect(seen[1]).toContain('Zed');
  });
  // @req FR:api/auth.decision
  it('maps decisions', async () => {
    expect((await mk({ authorize: () => false }).call('GET', '/api/next')).status).toBe(403);
    expect((await mk({ authorize: () => ({ allow: false, status: 401 }) }).call('GET', '/api/next')).status).toBe(401);
    expect((await mk({ authorize: () => ({ allow: false }) }).call('GET', '/api/next')).status).toBe(403);
    expect((await mk({ authorize: () => ({ allow: true }) }).call('GET', '/api/next')).status).toBe(200);
    expect((await mk({ authorize: () => 'yes' as unknown as boolean }).call('GET', '/api/next')).status).toBe(403);
    const t = await mk({ authorize: () => { throw new Error('secret'); } }).call('GET', '/api/next');
    expect(t.status).toBe(403);
    expect(t.text).not.toContain('secret');
    expect((await mk({ authorize: async () => { throw new Error('x'); } }).call('GET', '/api/next')).status).toBe(403);
  });
  // @req FR:api/auth.noleak
  it('denies before reporting unknown routes or methods', async () => {
    const { call } = mk({ authorize: () => false });
    expect((await call('GET', '/api/nope')).status).toBe(403);
    expect((await call('DELETE', '/api/tasks')).status).toBe(403);
  });
  it('does not touch storage or parse the body when denied', async () => {
    const { storage, call } = mk({ authorize: () => false });
    const spy = jest.spyOn(storage, 'list');
    await call('POST', '/api/projects', 'not json');
    expect(spy).not.toHaveBeenCalled();
  });
});

// @req FR:api/handler.base
describe('routing', () => {
  it('404s outside the base path and honors basePath', async () => {
    expect((await mk().call('GET', '/other')).status).toBe(404);
    const { call } = mk({ basePath: '/v1' });
    expect((await call('GET', '/v1/next')).status).toBe(200);
    expect((await call('GET', '/api/next')).status).toBe(404);
  });
  // @req FR:api/errors.codes
  it('404 unknown route; 405 with Allow', async () => {
    const { call } = mk();
    const nf = await call('GET', '/api/nope');
    expect(nf.status).toBe(404);
    expect(nf.json.error.code).toBe('not_found');
    const na = await call('DELETE', '/api/tasks');
    expect(na.status).toBe(405);
    expect(na.json.error.code).toBe('method_not_allowed');
    expect(na.headers.get('allow')).toBe('GET, POST');
  });
  it('tolerates a trailing slash', async () => expect((await mk().call('GET', '/api/next/')).status).toBe(200));
});

// @req FR:api/routes.next
describe('next', () => {
  it('returns null when empty', async () => {
    const r = await mk().call('GET', '/api/next');
    expect(r.json).toEqual({ task: null });
  });
  it('returns the top task with ref', async () => {
    const m = mk();
    await seed(m.call);
    const r = await m.call('GET', '/api/next');
    expect(r.status).toBe(200);
    expect(r.json.task.ref).toMatch(/^alpha:\d+$/);
    expect(r.json.task.project).toBeTruthy();
    // @req FR:api/compact.fields
    const f = await m.call('GET', '/api/next?fields=ref,text');
    expect(Object.keys(f.json.task)).toEqual(['ref', 'text']);
  });
});

// @req FR:api/routes.add
describe('add', () => {
  it('adds a project (201) and a task (201), as direct writes', async () => {
    const m = mk();
    const p = await m.call('POST', '/api/projects', { name: 'Alpha' });
    expect(p.status).toBe(201);
    expect(p.json).toEqual({ path: 'tasks/alpha.md', project: 'alpha' });
    const t = await m.call('POST', '/api/tasks', { project: 'alpha', text: 'Do it' });
    expect(t.status).toBe(201);
    expect(t.json.changed).toBe(true);
    expect(t.json.ref).toMatch(/^alpha:\d+$/);
    expect((await m.storage.read('tasks/alpha.md')).content).toContain('Do it');
  });
  it('409 on existing project unless force', async () => {
    const m = mk();
    await m.call('POST', '/api/projects', { name: 'Alpha' });
    const r = await m.call('POST', '/api/projects', { name: 'Alpha' });
    expect(r.status).toBe(409);
    expect(r.json.error.code).toBe('conflict');
    expect((await m.call('POST', '/api/projects', { name: 'Alpha', force: true })).status).toBe(201);
  });
  it('404 for unknown project; 422 for multi-line text', async () => {
    const m = mk();
    expect((await m.call('POST', '/api/tasks', { project: 'ghost', text: 'x' })).status).toBe(404);
    await m.call('POST', '/api/projects', { name: 'Alpha' });
    const r = await m.call('POST', '/api/tasks', { project: 'alpha', text: 'a\nb' });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe('invalid');
  });
  it('accepts section and parent ref', async () => {
    const m = mk();
    await seed(m.call);
    const a = await m.call('POST', '/api/tasks', { project: 'alpha', text: 'Later', section: 'Backlog' });
    expect(a.status).toBe(201);
    const first = (await m.call('GET', '/api/tasks?q=First')).json.items[0].ref;
    const c = await m.call('POST', '/api/tasks', { project: 'alpha', text: 'Child', parent: first });
    expect(c.status).toBe(201);
  });
});

// @req FR:api/routes.actions
describe('actions', () => {
  it('start, suspend, resume, skip, set, complete on the next task', async () => {
    const m = mk();
    await seed(m.call);
    const ref = (await m.call('GET', '/api/next')).json.task.ref;
    const s = await m.call('POST', '/api/tasks/start', { ref });
    expect(s.status).toBe(200);
    expect(s.json.changed).toBe(true);
    expect(s.json.after).toContain('🚧');
    expect((await m.call('POST', '/api/tasks/start', { ref })).json.changed).toBe(false);
    const set = await m.call('POST', '/api/tasks/set', { ref, priority: '🚨' });
    expect(set.json.after).toContain('🚨');
    const sk = await m.call('POST', '/api/tasks/skip', { ref });
    expect(sk.status).toBe(200);
    expect((await m.call('POST', '/api/tasks/resume', { ref })).status).toBe(200);
    const su = await m.call('POST', '/api/tasks/suspend', { ref, days: 2 });
    expect(su.json.message).toMatch(/^Suspended until/);
    const c = await m.call('POST', '/api/tasks/complete', { ref, summary: 'done it' });
    expect(c.status).toBe(200);
    expect(c.json.changed).toBe(true);
  });
  it('omitted ref targets the next task; empty body ok', async () => {
    const m = mk();
    await seed(m.call);
    const r = await m.call('POST', '/api/tasks/start');
    expect(r.status).toBe(200);
    expect(r.json.changed).toBe(true);
  });
  it('no active tasks is a 200 no-op', async () => {
    const r = await mk().call('POST', '/api/tasks/start', {});
    expect(r.status).toBe(200);
    expect(r.json.changed).toBe(false);
  });
  it('set requires ref; validates enums', async () => {
    const m = mk();
    await seed(m.call);
    expect((await m.call('POST', '/api/tasks/set', { priority: '🚨' })).status).toBe(422);
    const r = await m.call('POST', '/api/tasks/set', { ref: 'alpha:0', priority: 'high' });
    expect(r.status).toBe(422);
  });
  it('suspend rejects days+hours; complete.remove removes', async () => {
    const m = mk();
    await seed(m.call);
    expect((await m.call('POST', '/api/tasks/suspend', { days: 1, hours: 1 })).status).toBe(422);
    const ref = (await m.call('GET', '/api/next')).json.task.ref;
    const c = await m.call('POST', '/api/tasks/complete', { ref, remove: true });
    expect(c.status).toBe(200);
  });
  it('bad line is 422', async () => {
    const m = mk();
    await seed(m.call);
    expect((await m.call('POST', '/api/tasks/start', { ref: 'alpha:1' })).status).toBe(422);
  });
  it('missing project file is 404', async () => {
    const m = mk();
    expect((await m.call('POST', '/api/tasks/start', { ref: 'ghost:3' })).status).toBe(404);
  });
  // @req FR:api/routes.remove
  it('remove-completed', async () => {
    const m = mk();
    await seed(m.call);
    const ref = (await m.call('GET', '/api/next')).json.task.ref;
    await m.call('POST', '/api/tasks/complete', { ref });
    const r = await m.call('POST', '/api/tasks/remove-completed', { project: 'alpha' });
    expect(r.json).toEqual({ removed: 1, files: ['tasks/alpha.md'] });
    expect((await m.call('POST', '/api/tasks/remove-completed', { project: 'ghost' })).status).toBe(404);
    expect((await m.call('POST', '/api/tasks/remove-completed', {})).json.removed).toBe(0);
  });
});

// @req FR:api/routes.tasks
describe('list and get', () => {
  it('lists open tasks with defaults and paging', async () => {
    const m = mk();
    await seed(m.call);
    const r = await m.call('GET', '/api/tasks');
    expect(r.json.total).toBe(2);
    expect(r.json.limit).toBe(50);
    expect(r.json.offset).toBe(0);
    expect(Object.keys(r.json.items[0]).sort()).toEqual(['done', 'project', 'ref', 'section', 'text']);
    const p = await m.call('GET', '/api/tasks?limit=1&offset=1');
    expect(p.json.items).toHaveLength(1);
    expect(p.json.total).toBe(2);
  });
  it('filters by project, section, q, state', async () => {
    const m = mk();
    await seed(m.call);
    expect((await m.call('GET', '/api/tasks?q=second')).json.total).toBe(1);
    expect((await m.call('GET', '/api/tasks?project=alpha&section=active')).json.total).toBe(2);
    expect((await m.call('GET', '/api/tasks?section=backlog')).json.total).toBe(0);
    expect((await m.call('GET', '/api/tasks?project=ghost')).json.total).toBe(0);
    const ref = (await m.call('GET', '/api/next')).json.task.ref;
    await m.call('POST', '/api/tasks/complete', { ref });
    expect((await m.call('GET', '/api/tasks?state=done')).json.total).toBe(1);
    expect((await m.call('GET', '/api/tasks?state=all')).json.total).toBe(2);
  });
  it('fields incl. optional depth and notes', async () => {
    const m = mk();
    await seed(m.call);
    const r = await m.call('GET', '/api/tasks?fields=ref,depth,notes');
    expect(Object.keys(r.json.items[0])).toEqual(['ref', 'depth', 'notes']);
  });
  it('gets one task; 404 on non-task line', async () => {
    const m = mk();
    await seed(m.call);
    const ref = (await m.call('GET', '/api/tasks?q=First')).json.items[0].ref;
    const g = await m.call('GET', `/api/tasks/${encodeURIComponent(ref)}`);
    expect(g.status).toBe(200);
    expect(g.json.text).toContain('First task');
    expect((await m.call('GET', '/api/tasks/alpha:0')).status).toBe(404);
    expect((await m.call('GET', '/api/tasks/ghost:1')).status).toBe(404);
    expect((await m.call('GET', '/api/tasks/garbage')).status).toBe(422);
    expect((await m.call('GET', '/api/tasks/%E0%A4%A')).status).toBe(400);
  });
  it('validates query params', async () => {
    const m = mk();
    for (const q of ['limit=0', 'limit=201', 'limit=x', 'offset=-1', 'state=weird', 'bogus=1', 'fields=nope', 'fields=']) {
      const r = await m.call('GET', `/api/tasks?${q}`);
      expect([q, r.status]).toEqual([q, 422]);
    }
  });
});

// @req FR:api/routes.projects
describe('projects', () => {
  it('lists and gets', async () => {
    const m = mk();
    await seed(m.call);
    const l = await m.call('GET', '/api/projects');
    expect(l.json.items).toHaveLength(1);
    expect(Object.keys(l.json.items[0]).sort()).toEqual(['done', 'name', 'open', 'title']);
    expect(l.json.items[0]).toMatchObject({ name: 'alpha', title: 'Alpha', open: 2, done: 0 });
    const g = await m.call('GET', '/api/projects/alpha?fields=name,aliases,sections,metadata');
    expect(g.json.aliases).toEqual(['al']);
    expect(g.json.sections.map((s: { heading: string }) => s.heading)).toContain('🔄 Active');
    expect(g.json.metadata).toBeTruthy();
    expect((await m.call('GET', '/api/projects/ghost')).status).toBe(404);
    expect((await m.call('GET', '/api/projects/a%2Fb')).status).toBe(404);
  });
  it('ignores readme.md', async () => {
    const m = mk();
    await m.storage.write('tasks/README.md', '# Index\n');
    expect((await m.call('GET', '/api/projects')).json.items).toEqual([]);
  });
});

// @req FR:api/routes.summaries
describe('summaries', () => {
  it('generates from storage and selects fields', async () => {
    const m = mk();
    await seed(m.call);
    const r = await m.call('GET', '/api/summaries');
    expect(r.status).toBe(200);
    expect(Object.keys(r.json).sort()).toEqual(['myDay', 'projects', 'readme', 'stack']);
    expect(r.json.stack).toContain('First task');
    const f = await m.call('GET', '/api/summaries?fields=stack');
    expect(Object.keys(f.json)).toEqual(['stack']);
  });
  it('myDay is null with no tasks', async () => {
    const r = await mk().call('GET', '/api/summaries?fields=myDay');
    expect(r.json).toEqual({ myDay: null });
  });
});

// @req FR:api/input.json
describe('input', () => {
  it('415, 400, 413', async () => {
    const m = mk();
    const t = await m.call('POST', '/api/projects', 'name=x', { 'content-type': 'text/plain' });
    expect(t.status).toBe(415);
    expect(t.json.error.code).toBe('unsupported_media_type');
    expect((await m.call('POST', '/api/projects', '{bad')).status).toBe(400);
    expect((await m.call('POST', '/api/projects', '[1]')).status).toBe(400);
    const big = await m.call('POST', '/api/projects', JSON.stringify({ name: 'x'.repeat(70000) }));
    expect(big.status).toBe(413);
    expect(big.json.error.code).toBe('payload_too_large');
  });
  // @req FR:api/input.strict
  it('rejects unknown body fields', async () => {
    const r = await mk().call('POST', '/api/projects', { name: 'A', nmae: 'x' });
    expect(r.status).toBe(422);
    expect(r.json.error.details).toEqual([{ field: 'nmae', message: 'Unknown field' }]);
  });
  // @req FR:api/input.types @req FR:api/errors.validation
  it('type and range checks list every problem', async () => {
    const r = await mk().call('POST', '/api/projects', { name: 5, priority: 'x', aliases: 'a', capacity: { Work: 'x' }, force: 'yes' });
    expect(r.status).toBe(422);
    const fields = r.json.error.details.map((d: { field: string }) => d.field).sort();
    expect(fields).toEqual(['aliases', 'capacity', 'force', 'name', 'priority']);
    expect((await mk().call('POST', '/api/projects', { name: 'x'.repeat(2001) })).status).toBe(422);
    expect((await mk().call('POST', '/api/projects', {})).json.error.details[0].field).toBe('name');
    expect((await mk().call('POST', '/api/tasks/suspend', { days: 1.5 })).status).toBe(422);
  });
  // @req FR:api/input.ref
  it('rejects malformed refs', async () => {
    const m = mk();
    for (const ref of ['alpha', 'alpha:-1', 'alpha:x', ':3', '../x:1', 'a/b:1', '.hid:1', 5]) {
      expect([ref, (await m.call('POST', '/api/tasks/start', { ref })).status]).toEqual([ref, 422]);
    }
  });
});

// @req FR:api/errors.shape
describe('errors and compact output', () => {
  it('never leaks internals on unexpected failures', async () => {
    const m = mk();
    jest.spyOn(m.storage, 'list').mockRejectedValue(new Error('disk /secret/path exploded'));
    const r = await m.call('GET', '/api/projects');
    expect(r.status).toBe(500);
    expect(r.json).toEqual({ error: { code: 'internal', message: 'Internal error' } });
  });
  // @req FR:api/errors.map
  it('maps storage conflicts to 409', async () => {
    const m = mk();
    await seed(m.call);
    const ref = (await m.call('GET', '/api/next')).json.task.ref;
    const real = m.storage.write.bind(m.storage);
    jest.spyOn(m.storage, 'write').mockImplementation(async (p, c, o) => {
      await real(p, c + '\n- [ ] sneaky', {});
      return real(p, c, o);
    });
    expect((await m.call('POST', '/api/tasks/start', { ref })).status).toBe(409);
  });
  // @req FR:api/compact.json @req FR:api/compact.cache
  it('compact json, no-store, json content type', async () => {
    const m = mk();
    await seed(m.call);
    const r = await m.call('GET', '/api/tasks?limit=1');
    expect(r.text).not.toMatch(/\n|": /);
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('content-type')).toMatch(/^application\/json/);
  });
});
