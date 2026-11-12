/** `stack web`: demo copy, live checkout, and the local server. */
import http from 'http';
import { execFileSync } from 'child_process';
import { cpSync, existsSync, mkdirSync, symlinkSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { liveLine, redact, prepareDemo, prepareLive, resolveRepo, startWeb } from '../../src/cli/web';
import { BatchedGitStorage } from '../../src/core/storage-batch';
import { ReportStore } from '../../src/core/reports';
import { PriStore } from '../../src/core/pris';

const ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
Object.assign(process.env, ENV);
// Real git subprocesses: cost scales with machine load, so the budget matches storage-batch.test.ts.
jest.setTimeout(30000);
/** These tests do not look at file events; a do-nothing watcher keeps the OS (FSEvents) out of them. */
const quiet = { watch: { watchFn: (() => ({ on() { return this; }, close() { /* nothing to release */ } })) as unknown as typeof import('fs').watch } };
const tmp = () => mkdtempSync(join(tmpdir(), 'stack-web-'));

function source(): string {
  const s = tmp(); mkdirSync(join(s, 'tasks'));
  writeFileSync(join(s, 'tasks/alpha.md'), '# Alpha\n\n## Active\n\n- [ ] Write the plan\n');
  return s;
}

describe('prepareDemo', () => {
  // @req FR:cli/web.demo @req FR:cli/web.demo.untouched
  it('copies tasks into a fresh git repo and never touches the source', () => {
    const src = source(); const dest = join(tmp(), 'demo');
    const before = readFileSync(join(src, 'tasks/alpha.md'), 'utf8');
    prepareDemo(src, dest);
    expect(readFileSync(join(dest, 'tasks/alpha.md'), 'utf8')).toBe(before);
    expect(existsSync(join(dest, '.git'))).toBe(true);
    expect(execFileSync('git', ['log', '--oneline'], { cwd: dest, encoding: 'utf8' })).toContain('demo');
  });
  // @req FR:cli/web.demo @req FR:agent-team/agent.path.claude
  it('carries .claude/agents so the demo shows the real team', () => {
    const src = source(); const dest = join(tmp(), 'demo');
    mkdirSync(join(src, '.claude/agents'), { recursive: true });
    writeFileSync(join(src, '.claude/agents/cos.md'), '---\nname: cos\n---\n# CoS\n');
    prepareDemo(src, dest);
    expect(readFileSync(join(dest, '.claude/agents/cos.md'), 'utf8')).toContain('# CoS');
    prepareDemo(source(), join(tmp(), 'demo2')); // no .claude folder: still fine
  });
  // @req FR:cli/web.demo.reset
  it('keeps existing edits unless reset', () => {
    const src = source(); const dest = join(tmp(), 'demo');
    prepareDemo(src, dest);
    writeFileSync(join(dest, 'tasks/alpha.md'), 'edited\n');
    prepareDemo(src, dest);
    expect(readFileSync(join(dest, 'tasks/alpha.md'), 'utf8')).toBe('edited\n');
    prepareDemo(src, dest, true);
    expect(readFileSync(join(dest, 'tasks/alpha.md'), 'utf8')).toContain('Write the plan');
  });
  it('copies through symlinks so edits never reach the original', () => {
    const src = source(); const real = join(tmp(), 'real.md'); writeFileSync(real, 'orig\n');
    symlinkSync(real, join(src, 'tasks/link.md'));
    const dest = join(tmp(), 'demo'); prepareDemo(src, dest);
    writeFileSync(join(dest, 'tasks/link.md'), 'changed\n');
    expect(readFileSync(real, 'utf8')).toBe('orig\n');
  });
  it('refuses a source inside the copy (reset would delete it)', () => {
    const dest = join(tmp(), 'demo'); mkdirSync(join(dest, 'tasks'), { recursive: true });
    expect(() => prepareDemo(dest, dest, true)).toThrow(/overlap/);
  });
  it('re-copies when the source repo changes', () => {
    const a = source(); const b = source(); writeFileSync(join(b, 'tasks/alpha.md'), '# B\n');
    const dest = join(tmp(), 'demo'); prepareDemo(a, dest); prepareDemo(b, dest);
    expect(readFileSync(join(dest, 'tasks/alpha.md'), 'utf8')).toBe('# B\n');
  });
  it('redacts url credentials', () => { expect(redact('https://u:tok@github.com/x/y.git')).toBe('https://github.com/x/y.git'); });
  it('fails clearly when the source is missing', () => {
    expect(() => prepareDemo(join(tmp(), 'nope'), join(tmp(), 'd'))).toThrow(/not found/);
  });
});

describe('startWeb', () => {
  // @req FR:cli/web.serve @req FR:cli/web.serve.local @req FR:cli/web.serve.loopback @req FR:cli/web.@cli
  it('serves the app, local auth stub, and the api over the repo', async () => {
    const dest = join(tmp(), 'demo'); prepareDemo(source(), dest);
    const web = tmp(); writeFileSync(join(web, 'index.html'), '<html>app</html>');
    const s = await startWeb({ ...quiet, dir: dest, port: 0, webDir: web, label: 'demo copy' });
    try {
      expect(await (await fetch(s.url)).text()).toContain('app');
      const me = await (await fetch(`${s.url}/.auth/me`)).json() as { clientPrincipal: { userDetails: string } };
      expect(me.clientPrincipal.userDetails).toContain('demo copy');
      const next = await (await fetch(`${s.url}/api/tasks`)).json() as object;
      expect(JSON.stringify(next)).toContain('Write the plan');
      const done = await fetch(`${s.url}/api/tasks/complete`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ref: 'alpha:4' }) });
      expect(done.status).toBe(200);
      expect(readFileSync(join(dest, 'tasks/alpha.md'), 'utf8')).toContain('- [x] Write the plan');
      const status = await new Promise<number>((ok) => http.get({ host: '127.0.0.1', port: Number(new URL(s.url).port), path: '/api/next', headers: { host: 'evil.example' } }, (r) => { r.resume(); ok(r.statusCode ?? 0); }));
      expect(status).toBe(403);
      const cross = await fetch(`${s.url}/api/tasks/complete`, { method: 'POST', headers: { 'content-type': 'application/json', origin: 'https://evil.example' }, body: JSON.stringify({ ref: 'alpha:4' }) });
      expect(cross.status).toBe(403);
      const site = await fetch(`${s.url}/api/tasks/complete`, { method: 'POST', headers: { 'content-type': 'application/json', 'sec-fetch-site': 'cross-site' }, body: JSON.stringify({ ref: 'alpha:4' }) });
      expect(site.status).toBe(403);
      const trav = await new Promise<string>((ok) => http.get({ host: '127.0.0.1', port: Number(new URL(s.url).port), path: '/..%2f..%2fpackage.json' }, (r) => { let b = ''; r.on('data', (c) => { b += c; }); r.on('end', () => ok(b)); }));
      expect(trav).toContain('app');
    } finally { await s.close(); }
  });
});

describe('static caching', () => {
  // @req FR:perf/serve.assets
  it('keeps hashed assets for a year and leaves the page and api uncached', async () => {
    const dest = join(tmp(), 'demo'); prepareDemo(source(), dest);
    const web = tmp(); mkdirSync(join(web, 'assets')); writeFileSync(join(web, 'index.html'), '<html>app</html>'); writeFileSync(join(web, 'assets/index-abc.js'), 'x');
    const s = await startWeb({ dir: dest, port: 0, webDir: web });
    try {
      expect((await fetch(`${s.url}/assets/index-abc.js`)).headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
      expect((await fetch(s.url)).headers.get('cache-control')).toBe('no-store');
      expect((await fetch(`${s.url}/api/tasks`)).headers.get('cache-control')).not.toContain('immutable');
    } finally { await s.close(); }
  });

  // @req FR:agent-team/agent.icon: every image type an icon may use is served with its own type (nosniff blocks octet-stream)
  it('serves agent icon images with their image type', async () => {
    const dest = join(tmp(), 'demo'); prepareDemo(source(), dest);
    const web = tmp(); mkdirSync(join(web, 'agents')); writeFileSync(join(web, 'index.html'), '<html>app</html>');
    const types: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
    for (const ext of Object.keys(types)) writeFileSync(join(web, `agents/a.${ext}`), 'x');
    const s = await startWeb({ dir: dest, port: 0, webDir: web });
    try {
      for (const [ext, type] of Object.entries(types)) expect((await fetch(`${s.url}/agents/a.${ext}`)).headers.get('content-type')).toBe(type);
    } finally { await s.close(); }
  });
});

describe('prepareLive', () => {
  const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
  // One committed repo is built once and copied per test: three git calls per test become none.
  let template: string;
  beforeAll(() => {
    template = source(); g(template, 'init', '-q', '-b', 'main'); g(template, 'add', '-A');
    g(template, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init');
  });
  function content(): string { const r = tmp(); cpSync(template, r, { recursive: true }); return r; }
  // @req FR:cli/web.live @req FR:cli/web.live.remote
  it('serves the real checkout on its current branch (main included) and finds the remote', () => {
    const repo = content();
    expect(prepareLive(repo)).toEqual({ dir: repo, branch: 'main', remote: undefined });
    g(repo, 'remote', 'add', 'origin', join(tmp(), 'origin.git'));
    expect(prepareLive(repo)).toEqual({ dir: repo, branch: 'main', remote: 'origin' });
    g(repo, 'remote', 'add', 'upstream', join(tmp(), 'up.git'));
    expect(prepareLive(repo, undefined, 'upstream').remote).toBe('upstream'); // user config wins
    expect(() => prepareLive(repo, undefined, 'upstrem')).toThrow(/Remote upstrem .*not found/); // a typo fails fast
    g(repo, 'checkout', '-q', '-b', 'work');
    expect(prepareLive(repo, 'work').branch).toBe('work');
    expect(g(repo, 'worktree', 'list').split('\n')).toHaveLength(1); // no worktree is made
  });
  // @req FR:cli/web.live.branch
  it('--branch only asserts the checked-out branch', () => {
    const repo = content();
    expect(prepareLive(repo, 'main').branch).toBe('main');
    expect(() => prepareLive(repo, 'stack-web')).toThrow(/stack-web is not checked out.*main/);
  });
  // @req FR:cli/web.live.refuse
  it('refuses a detached HEAD, a non-repo, and a repo without tasks/', () => {
    const repo = content();
    g(repo, 'checkout', '-q', '--detach');
    expect(() => prepareLive(repo)).toThrow(/detached/);
    expect(() => prepareLive(tmp())).toThrow(/git repo/);
    const bare = tmp(); g(bare, 'init', '-q', '-b', 'main');
    expect(() => prepareLive(bare)).toThrow(/tasks/);
  });
  // @req FR:cli/web.batch @req FR:cli/web.batch.zero
  it('a batch of 0 commits every edit on the checked-out branch', async () => {
    const repo = content();
    const web = tmp(); writeFileSync(join(web, 'index.html'), 'x');
    const storage = new BatchedGitStorage(repo, { idleMs: 0 });
    const s = await startWeb({ ...quiet, dir: repo, port: 0, webDir: web, info: { mode: 'live', repo, branch: 'main' }, storage });
    try {
      const d = await fetch(`${s.url}/api/tasks/complete`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ref: 'alpha:4' }) });
      expect(d.status).toBe(200);
      const me = await (await fetch(`${s.url}/.auth/me`)).json() as { local: { mode: string; branch: string } };
      expect(me.local).toMatchObject({ mode: 'live', branch: 'main' });
    } finally { await s.close(); }
    expect(g(repo, 'log', '--format=%s', 'main').split('\n')[0]).toBe('Stack: done 1');
    expect(g(repo, 'branch', '--show-current')).toBe('main');
    expect(readFileSync(join(repo, 'tasks/alpha.md'), 'utf8')).toContain('- [x] Write the plan');
  });
  // @req FR:cli/web.batch.idle @req FR:cli/web.batch.shutdown
  it('an idle batch leaves the edit in the file, reports it on /api/sync, flushes on POST /api/sync and on shutdown', async () => {
    const repo = content();
    const web = tmp(); writeFileSync(join(web, 'index.html'), 'x');
    const storage = new BatchedGitStorage(repo, { idleMs: 60_000 });
    const s = await startWeb({ ...quiet, dir: repo, port: 0, webDir: web, info: { mode: 'live', repo, branch: 'main' }, storage });
    try {
      await fetch(`${s.url}/api/tasks/complete`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ref: 'alpha:4' }) });
      expect(readFileSync(join(repo, 'tasks/alpha.md'), 'utf8')).toContain('- [x] Write the plan');
      expect(g(repo, 'log', '--format=%s').split('\n')).toEqual(['init']);
      const sync = await (await fetch(`${s.url}/api/sync`)).json() as { rev: string | null; pending: number; since: string };
      expect(sync.pending).toBe(1);
      expect(Date.parse(sync.since)).toBeGreaterThan(0);
      const flushed = await (await fetch(`${s.url}/api/sync`, { method: 'POST' })).json() as { flushed: number; rev: string };
      expect(flushed.flushed).toBe(1);
      expect(flushed.rev).toBe(g(repo, 'rev-parse', 'HEAD'));
      expect(g(repo, 'log', '--format=%s').split('\n')[0]).toBe('Stack: done 1');
      expect(((await (await fetch(`${s.url}/api/sync`)).json()) as { pending: number }).pending).toBe(0);
      // @req FR:live-deploy/web.unsaved.refresh — the event stream hears pending changes, so the page re-reads the count after an idle flush
      const es = await fetch(`${s.url}/events`);
      const reader = es.body!.getReader(); const dec = new TextDecoder(); let buf = '';
      const waitFor = async (re: RegExp) => { while (!re.test(buf)) { const { value, done } = await reader.read(); if (done) throw new Error(`stream ended without ${re}: ${buf}`); buf += dec.decode(value); } };
      await waitFor(/event: hello/);
      await fetch(`${s.url}/api/tasks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project: 'alpha', text: 'Another' }) });
      expect(storage.pending().count).toBe(1);
      await waitFor(/"kinds":\["sync"\]/);
      buf = '';
      await fetch(`${s.url}/api/sync`, { method: 'POST' });
      await waitFor(/"kinds":\["sync"\]/);
      await reader.cancel();
      await fetch(`${s.url}/api/tasks`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ project: 'alpha', text: 'One more' }) });
      expect(storage.pending().count).toBe(1);
    } finally { await s.close(); } // shutdown flushes
    expect(g(repo, 'log', '--format=%s').split('\n')[0]).toBe('Stack: added 1');
    expect(g(repo, 'status', '--porcelain')).toBe('');
  });
  // @req FR:cli/web.batch.shutdown @req FR:test-reliability/shutdown.reply
  it('shutdown lets a request already being handled land before the final flush', async () => {
    const repo = content();
    const web = tmp(); writeFileSync(join(web, 'index.html'), 'x');
    const storage = new BatchedGitStorage(repo, { idleMs: 60_000 });
    const s = await startWeb({ ...quiet, dir: repo, port: 0, webDir: web, info: { mode: 'live', repo, branch: 'main' }, storage });
    // Hold the handler at its write until shutdown has begun: no sleep decides whether the request "arrived" yet.
    let entered!: () => void; const inHandler = new Promise<void>((ok) => { entered = ok; });
    let open!: () => void; const gate = new Promise<void>((ok) => { open = ok; });
    const held = storage as unknown as Record<'write' | 'writeMany', (...a: unknown[]) => Promise<unknown>>;
    for (const m of ['write', 'writeMany'] as const) { const real = held[m].bind(storage); held[m] = async (...a) => { entered(); await gate; return real(...a); }; }
    const req = fetch(`${s.url}/api/tasks/complete`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ref: 'alpha:4' }) });
    await inHandler; // the request is in the server, not yet written
    const closing = s.close();
    open();
    expect((await req).status).toBe(200);
    await closing;
    expect(g(repo, 'log', '--format=%s').split('\n')[0]).toBe('Stack: done 1');
    expect(g(repo, 'status', '--porcelain')).toBe('');
  });

  // @req FR:cli/web.batch.startup
  it('says where edits go and when they commit', () => {
    expect(liveLine('/r', 'main', 5, 'origin')).toBe('LIVE MODE: edits land in /r/tasks on main; committed after 5 min idle, then pushed to origin');
    expect(liveLine('/r', 'work', 0)).toBe('LIVE MODE: edits land in /r/tasks on work; committed on every edit');
  });
});

describe('resolveRepo', () => {
  // @req FR:cli/web.serve
  it('passes paths through and clones urls into the cache', () => {
    const repo = source(); execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'add', '-A'], { cwd: repo });
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'i'], { cwd: repo });
    expect(resolveRepo(repo, tmp())).toBe(repo);
    const cache = tmp();
    const c = resolveRepo(`file://${repo}`, cache);
    expect(existsSync(join(c, 'tasks/alpha.md'))).toBe(true);
    expect(c.startsWith(cache)).toBe(true);
  });
});

describe('startWeb reports', () => {
  // @req FR:status-ingest/store.live @req FR:status-ingest/api.put @req FR:status-ingest/needs.list
  it('a report POSTed to the host lands in the live store, shows in Needs you, and pushes a change to open pages', async () => {
    const dest = join(tmp(), 'demo'); prepareDemo(source(), dest);
    const web = tmp(); writeFileSync(join(web, 'index.html'), '<html>app</html>');
    const reports = new ReportStore(tmp());
    const s = await startWeb({ ...quiet, dir: dest, port: 0, webDir: web, reports, agents: false });
    try {
      let seen = '';
      let wake: () => void = () => {};
      const until = (re: RegExp) => new Promise<void>((ok) => { wake = () => { if (re.test(seen)) ok(); }; wake(); });
      const req = http.get(`${s.url}/events`, (r) => { r.on('data', (c) => { seen += String(c); wake(); }); });
      await until(/event: hello/);
      const body = { agent: 'xe-cos', project: 'stack', asks: [{ id: 'pr-1', ask: 'Approve PR 1', link: 'https://x.test/1', by: '2026-11-12' }] };
      const res = await fetch(`${s.url}/api/reports`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
      expect(res.status).toBe(200);
      const needs = await (await fetch(`${s.url}/api/needs-you`)).json() as { items: { id: string }[] };
      expect(needs.items.map((i) => i.id)).toContain('rp.xe-cos.stack.pr-1');
      await until(/event: change\ndata: \{"rev":\d+,"kinds":\["tasks"\]\}/);
      req.destroy();
      expect(existsSync(join(dest, '.stack/reports.json'))).toBe(false);
    } finally { await s.close(); }
  });
});

describe('startWeb priorities', () => {
  // @req FR:pris-sessions-ui/live.event
  it('a priorities write pushes a pris change to open pages', async () => {
    const dest = join(tmp(), 'demo'); prepareDemo(source(), dest);
    const web = tmp(); writeFileSync(join(web, 'index.html'), '<html>app</html>');
    const s = await startWeb({ ...quiet, dir: dest, port: 0, webDir: web, reports: new ReportStore(tmp()), pris: new PriStore(tmp()), inventory: false, agents: false });
    try {
      let seen = '';
      let wake: () => void = () => {};
      const until = (re: RegExp) => new Promise<void>((ok) => { wake = () => { if (re.test(seen)) ok(); }; wake(); });
      const req = http.get(`${s.url}/events`, (r) => { r.on('data', (c) => { seen += String(c); wake(); }); });
      await until(/event: hello/);
      const pris = [{ id: 'p1', title: 'Ship', status: 'active', items: [], backlog: [], weekly: [] }];
      const res = await fetch(`${s.url}/api/pris`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rev: 0, pris }) });
      expect(res.status).toBe(200);
      await until(/event: change\ndata: \{"rev":\d+,"kinds":\["pris"\]\}/);
      req.destroy();
    } finally { await s.close(); }
  });
});
