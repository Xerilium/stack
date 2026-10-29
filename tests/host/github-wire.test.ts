import { createApiHandler } from '../../src/api/handler';
import { MemoryStorage } from '../../src/core/storage';
import { createHost } from '../../src/host';
import { GitHubStorage } from '../../src/host/github-storage';
import { openRepoStorage } from '../../src/host/runtime';
import { parseSettings } from '../../src/host/settings';
import { FakeGitHub } from './fake-github';
import { BASE, ENV, principal, setup } from './helpers';

const owner = { 'x-ms-client-principal': principal(), 'sec-fetch-site': 'same-origin' };

// @req FR:live-deploy/gh.select
describe('storage selection', () => {
  it('a github.com repo url opens GitHubStorage over the API (no clone)', async () => {
    const gh = new FakeGitHub('flanakin', 'todo', { 'tasks/a.md': '# A\n' });
    const s = await openRepoStorage(parseSettings({ ...ENV, STACK_REPO_URL: 'https://github.com/flanakin/todo.git' }), { fetch: gh.fetch, run: async () => { throw new Error('git must not run'); } });
    expect(s).toBeInstanceOf(GitHubStorage);
    expect(await s.list()).toEqual(['tasks/a.md']);
  });
  it('another host keeps the git clone adapter', async () => {
    const runs: string[][] = [];
    await openRepoStorage(parseSettings({ ...ENV, STACK_REPO_URL: 'https://git.example.com/a/b.git' }), {
      run: async (args) => { runs.push(args); }, mkdir: async () => undefined, rm: async () => undefined, tmp: '/tmp/x',
    }).catch(() => undefined);
    expect(runs[0]?.[0]).toBe('clone');
  });
  it('the host serves the real repo end to end through the API', async () => {
    const gh = new FakeGitHub('flanakin', 'todo', { 'tasks/home.md': '# Home\n\n## Active\n\n- [ ] Ship it\n' });
    const host = createHost({ ...ENV, STACK_REPO_URL: 'https://github.com/flanakin/todo' }, { fetch: gh.fetch, log: () => undefined });
    const res = await host(new Request(`${BASE}/api/tasks?state=all`, { headers: owner }));
    expect(res.status).toBe(200);
    expect(JSON.stringify(await res.json())).toContain('Ship it');
    const add = await host(new Request(`${BASE}/api/tasks`, { method: 'POST', headers: { ...owner, 'content-type': 'application/json' }, body: JSON.stringify({ project: 'home', text: 'From the phone' }) }));
    expect(add.status).toBe(201);
    expect(gh.file('tasks/home.md')).toContain('From the phone');
  });
  // @req NFR:live-deploy/security
  it('never sends the repo token to the browser', async () => {
    const gh = new FakeGitHub('flanakin', 'todo', { 'tasks/home.md': '# Home\n\n## Active\n\n- [ ] A\n' });
    const host = createHost({ ...ENV, STACK_REPO_URL: 'https://github.com/flanakin/todo' }, { fetch: gh.fetch, log: () => undefined, freshMs: 0 });
    for (const p of ['/api/tasks?state=all', '/api/sync', '/api/projects', '/api/asks', '/api/agents', '/api/health']) {
      const res = await host(new Request(`${BASE}${p}`, { headers: owner }));
      const all = JSON.stringify([...res.headers]) + await res.text();
      expect(all).not.toContain(ENV.STACK_REPO_TOKEN);
    }
    gh.failWith = 401;
    const res = await host(new Request(`${BASE}/api/sync`, { headers: owner }));
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(await res.text()).not.toContain(ENV.STACK_REPO_TOKEN);
  });
});

// @req FR:live-deploy/sync.route
describe('GET /api/sync', () => {
  it('answers null rev for storage without revisions, no-store', async () => {
    const h = createApiHandler({ storage: new MemoryStorage(), authorize: () => true });
    const res = await h(new Request('https://x.test/api/sync', { headers: { 'x-ms-client-principal': principal() } }));
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toMatch(/no-store/);
    expect(await res.json()).toEqual({ rev: null });
  });
  it('answers the head sha, and a new sha after a push elsewhere', async () => {
    const gh = new FakeGitHub('flanakin', 'todo');
    const host = createHost({ ...ENV, STACK_REPO_URL: 'https://github.com/flanakin/todo' }, { fetch: gh.fetch, log: () => undefined, freshMs: 0 });
    const rev = async () => ((await (await host(new Request(`${BASE}/api/sync`, { headers: owner }))).json()) as { rev: string }).rev;
    expect(await rev()).toBe(gh.refs.get('main'));
    const sha = gh.push({ 'tasks/asks/new.md': '# Ask: new\n' });
    expect(await rev()).toBe(sha);
  });
  it('needs a session or a tasks:read token', async () => {
    const { req, mint, storage } = await setup();
    void storage;
    expect((await req('/api/sync')).status).toBe(401);
    const t = await mint('tasks:read');
    expect((await req('/api/sync', { headers: { authorization: `Bearer ${t}` } })).status).toBe(200);
    const s = await mint('summaries:read');
    expect((await req('/api/sync', { headers: { authorization: `Bearer ${s}` } })).status).toBe(403);
  });
});
