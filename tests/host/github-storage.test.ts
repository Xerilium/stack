import { ConflictError, NotFoundError, StorageError, versionOf, writeAll } from '../../src/core/storage';
import { GitHubStorage, parseGitHubRepo, type GitHubStorageOptions } from '../../src/host/github-storage';
import { FakeGitHub } from './fake-github';

const make = (gh: FakeGitHub, o: Partial<GitHubStorageOptions> = {}) => {
  let t = 1_000_000;
  const clock = { advance: (ms: number) => { t += ms; } };
  const s = new GitHubStorage({ owner: 'acme', repo: 'tasks', branch: 'main', token: 'ghp_secret', fetch: gh.fetch, now: () => t, ...o });
  return { s, clock };
};
const gets = (gh: FakeGitHub, kind: string) => gh.calls.filter((c) => c.method === 'GET' && c.path.includes(`/git/${kind}`)).length;

// @req FR:live-deploy/gh.select
describe('parseGitHubRepo', () => {
  it.each([
    ['https://github.com/flanakin/todo', { owner: 'flanakin', repo: 'todo' }],
    ['https://github.com/flanakin/todo.git', { owner: 'flanakin', repo: 'todo' }],
    ['https://github.com/a-b/c.d_e.git', { owner: 'a-b', repo: 'c.d_e' }],
  ])('%s is a GitHub repo', (url, want) => { expect(parseGitHubRepo(url)).toEqual(want); });
  it.each(['https://gitlab.com/a/b.git', 'https://github.com/a', 'https://github.com/a/b/c', 'https://github.com/a/b.git/', 'https://www.github.com/a/b', 'http://github.com/a/b', 'https://github.com/-a/b', 'https://github.com/a/..'])(
    '%s is not', (url) => { expect(parseGitHubRepo(url)).toBeNull(); });
});

// @req FR:live-deploy/gh.token
describe('token handling', () => {
  it('sends the token only to api.github.com as a bearer with the api version, and never follows redirects', async () => {
    const gh = new FakeGitHub();
    const seen: { url: string; init: RequestInit }[] = [];
    const { s } = make(gh, { fetch: (u, i = {}) => { seen.push({ url: String(u), init: i }); return gh.fetch(u, i); } });
    await s.write('tasks/a.md', 'A');
    await s.read('tasks/a.md');
    expect(seen.length).toBeGreaterThan(3);
    for (const c of seen) {
      expect(c.url.startsWith('https://api.github.com/repos/acme/tasks/git/')).toBe(true);
      const h = new Headers(c.init.headers);
      expect(h.get('authorization')).toBe('Bearer ghp_secret');
      expect(h.get('x-github-api-version')).toBe('2022-11-28');
      expect(c.init.redirect).toBe('manual');
    }
  });
  it('errors carry a fixed message with the status, never the token or the body', async () => {
    const gh = new FakeGitHub();
    gh.failWith = 401;
    const { s } = make(gh);
    const err = await s.list().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(StorageError);
    expect(String((err as Error).message)).toMatch(/401/);
    expect(String((err as Error).message)).not.toMatch(/ghp_secret|nope|api\.github\.com/);
  });
  it('treats a redirect as a failure', async () => {
    const { s } = make(new FakeGitHub(), { fetch: async () => new Response(null, { status: 302, headers: { location: 'https://evil.test/' } }) });
    await expect(s.list()).rejects.toThrow(/302/);
  });
});

// @req FR:live-deploy/gh.snapshot
describe('snapshot reads', () => {
  it('reads one tree per head commit and each blob once', async () => {
    const gh = new FakeGitHub('acme', 'tasks', { 'tasks/a.md': 'A', 'tasks/b.md': 'B', 'README.md': 'R' });
    const { s } = make(gh);
    expect(await s.list()).toEqual(['tasks/a.md', 'tasks/b.md']);
    expect((await s.read('tasks/a.md')).content).toBe('A');
    expect((await s.read('tasks/a.md')).content).toBe('A');
    expect((await s.read('tasks/b.md')).version).toBe(versionOf('B'));
    expect(gets(gh, 'trees')).toBe(1);
    expect(gets(gh, 'blobs')).toBe(2);
  });
  it('a missing path is NotFoundError with no network call', async () => {
    const gh = new FakeGitHub();
    const { s } = make(gh);
    await s.list();
    const n = gh.calls.length;
    await expect(s.read('tasks/inbox/x.md')).rejects.toBeInstanceOf(NotFoundError);
    expect(gh.calls.length).toBe(n);
  });
  it('keeps exact bytes (BOM, CRLF, emoji) through write and read', async () => {
    const gh = new FakeGitHub();
    const { s } = make(gh);
    const c = '﻿# T\r\n- [ ] 🔝 x  \r\n';
    await s.write('tasks/x.md', c);
    expect(gh.file('tasks/x.md')).toBe(c);
    const fresh = make(gh).s;
    expect((await fresh.read('tasks/x.md')).content).toBe(c);
  });
});

// @req FR:live-deploy/gh.fresh @req FR:live-deploy/sync.cheap @req NFR:live-deploy/cost
describe('freshness', () => {
  it('checks the ref at most every freshMs, conditionally, and picks up pushes from elsewhere', async () => {
    const gh = new FakeGitHub('acme', 'tasks', { 'tasks/a.md': 'A1' });
    const { s, clock } = make(gh, { freshMs: 5000 });
    expect((await s.read('tasks/a.md')).content).toBe('A1');
    const refs = () => gets(gh, 'ref/');
    const r0 = refs();
    await s.read('tasks/a.md');
    expect(refs()).toBe(r0); // younger than freshMs: no call
    clock.advance(5000);
    await s.read('tasks/a.md');
    expect(refs()).toBe(r0 + 1);
    expect(gh.calls.filter((c) => c.path.includes('/git/ref/')).pop()!.headers['if-none-match']).toMatch(/^W\/"/);
    expect(gets(gh, 'trees')).toBe(1); // 304: same snapshot
    gh.push({ 'tasks/a.md': 'A2', 'tasks/asks/k.md': 'K' });
    clock.advance(5000);
    expect((await s.read('tasks/a.md')).content).toBe('A2');
    expect(await s.listAsks()).toEqual(['tasks/asks/k.md']);
  });
  it('sync() and rev() force a check and rev is the head sha', async () => {
    const gh = new FakeGitHub();
    const { s } = make(gh);
    expect(await s.rev()).toBe(gh.refs.get('main'));
    const sha = gh.push({ 'tasks/n.md': 'N' });
    await s.sync();
    expect(await s.list()).toEqual(['tasks/n.md']);
    expect(await s.rev()).toBe(sha);
  });
  it('a failed check serves the current snapshot to reads, but rev() reports it until a check succeeds', async () => {
    const gh = new FakeGitHub('acme', 'tasks', { 'tasks/a.md': 'A' });
    const { s, clock } = make(gh);
    await s.read('tasks/a.md');
    gh.failWith = 401;
    clock.advance(10_000);
    expect((await s.read('tasks/a.md')).content).toBe('A');
    await expect(s.rev()).rejects.toThrow(/401/);
    gh.failWith = undefined;
    clock.advance(10_000);
    expect(await s.rev()).toBe(gh.refs.get('main'));
  });
  it('concurrent first reads share one snapshot load', async () => {
    const gh = new FakeGitHub('acme', 'tasks', { 'tasks/a.md': 'A' });
    const { s } = make(gh);
    await Promise.all([s.list(), s.list(), s.read('tasks/a.md')]);
    expect(gets(gh, 'trees')).toBe(1);
  });
});

// @req FR:live-deploy/gh.paths
describe('paths', () => {
  it('prefixes STACK_REPO_PATH and lists relative to it', async () => {
    const gh = new FakeGitHub('acme', 'tasks', { 'data/tasks/a.md': 'A', 'tasks/outside.md': 'O' });
    const { s } = make(gh, { path: 'data' });
    expect(await s.list()).toEqual(['tasks/a.md']);
    await s.write('tasks/b.md', 'B');
    expect(gh.file('data/tasks/b.md')).toBe('B');
    expect(gh.file('tasks/b.md')).toBeNull();
  });
  it('hides dotfiles, nested files and non-md from list, and lists only valid ask keys', async () => {
    const gh = new FakeGitHub('acme', 'tasks', { 'tasks/a.md': 'A', 'tasks/.h.md': 'H', 'tasks/x.txt': 'X', 'tasks/logs/l.md': 'L', 'tasks/asks/ok.md': 'K', 'tasks/asks/Bad.md': 'B', 'tasks/asks/archive/old.md': 'O' });
    const { s } = make(gh);
    expect(await s.list()).toEqual(['tasks/a.md']);
    expect(await s.listAsks()).toEqual(['tasks/asks/ok.md']);
  });
  it('refuses symlinks and submodules', async () => {
    const gh = new FakeGitHub();
    gh.pushEntry('tasks/link.md', '120000');
    gh.pushEntry('tasks/sub.md', '160000');
    const { s } = make(gh);
    expect(await s.list()).toEqual([]);
    await expect(s.read('tasks/link.md')).rejects.toBeInstanceOf(StorageError);
    await expect(s.read('tasks/link.md')).rejects.not.toBeInstanceOf(NotFoundError);
    await expect(s.write('tasks/link.md', 'x')).rejects.toBeInstanceOf(StorageError);
    await expect(s.read('tasks/sub.md')).rejects.toBeInstanceOf(StorageError);
  });
  it('state files: read, create, version-check', async () => {
    const gh = new FakeGitHub();
    const { s } = make(gh);
    expect(await s.readAux('.stack/tokens.json')).toBeNull();
    const w = await s.writeAux('.stack/tokens.json', '{}', { expectedVersion: null });
    expect((await s.readAux('.stack/tokens.json'))!.version).toBe(w.version);
    await expect(s.writeAux('.stack/tokens.json', '{"a":1}', { expectedVersion: null })).rejects.toBeInstanceOf(ConflictError);
    await expect(s.readAux('tasks/a.md')).rejects.toThrow();
    expect(await s.list()).toEqual([]);
  });
});

// @req FR:live-deploy/gh.write @req FR:live-deploy/gh.limits
describe('writes', () => {
  it('one commit for many files, on the head, with author and message', async () => {
    const gh = new FakeGitHub('acme', 'tasks', { 'tasks/old.md': 'O' });
    const { s } = make(gh, { author: { name: 'Stack', email: 'stack@users.noreply.github.com' } });
    const before = gh.commitCount();
    await writeAll(s, [{ path: 'tasks/a.md', content: 'A' }, { path: 'tasks/old.md', content: null }, { path: 'README.md', content: 'R2' }], 'Batch');
    expect(gh.commitCount()).toBe(before + 1);
    expect(gh.headCommit().message).toBe('Batch');
    expect(gh.headCommit().author).toEqual({ name: 'Stack', email: 'stack@users.noreply.github.com' });
    expect(gh.file('tasks/old.md')).toBeNull();
    expect(gh.file('tasks/a.md')).toBe('A');
    const patch = gh.calls.find((c) => c.method === 'PATCH')!;
    expect(patch.path).toBe('/repos/acme/tasks/git/refs/heads/main');
  });
  it('default message names the path', async () => {
    const gh = new FakeGitHub();
    await make(gh).s.write('tasks/a.md', 'A');
    expect(gh.headCommit().message).toBe('Update tasks/a.md');
  });
  it('sends ref updates with force false', async () => {
    const gh = new FakeGitHub();
    const seen: string[] = [];
    const { s } = make(gh, { fetch: (u, i = {}) => { if (i.method === 'PATCH') seen.push(String(i.body)); return gh.fetch(u, i); } });
    await s.write('tasks/a.md', 'A');
    expect(JSON.parse(seen[0]).force).toBe(false);
  });
  it('an unchanged write makes no commit', async () => {
    const gh = new FakeGitHub('acme', 'tasks', { 'tasks/a.md': 'A' });
    const { s } = make(gh);
    const n = gh.commitCount();
    await s.write('tasks/a.md', 'A');
    await writeAll(s, [{ path: 'tasks/missing.md', content: null }]);
    expect(gh.commitCount()).toBe(n);
  });
  it('checks versions against the head, not a stale snapshot', async () => {
    const gh = new FakeGitHub('acme', 'tasks', { 'tasks/a.md': 'A1' });
    const { s } = make(gh, { freshMs: 60_000 });
    const v = (await s.read('tasks/a.md')).version;
    gh.push({ 'tasks/a.md': 'A-other' });
    await expect(s.write('tasks/a.md', 'mine', { expectedVersion: v })).rejects.toBeInstanceOf(ConflictError);
    expect(gh.file('tasks/a.md')).toBe('A-other');
    expect((await s.read('tasks/a.md')).content).toBe('A-other');
  });
  it('reads see their own write at once', async () => {
    const gh = new FakeGitHub();
    const { s } = make(gh, { freshMs: 60_000 });
    await s.list();
    await s.write('tasks/a.md', 'A');
    expect(await s.list()).toEqual(['tasks/a.md']);
    expect((await s.read('tasks/a.md')).content).toBe('A');
  });
  it('a truncated tree is a StorageError naming the limit', async () => {
    const gh = new FakeGitHub();
    gh.truncated = true;
    await expect(make(gh).s.list()).rejects.toThrow(/too large/i);
  });
  it('times out a hung call', async () => {
    const { s } = make(new FakeGitHub(), { timeoutMs: 20, fetch: (_u, i = {}) => new Promise((_r, bad) => { i.signal?.addEventListener('abort', () => bad(new Error('aborted'))); }) });
    await expect(s.list()).rejects.toBeInstanceOf(StorageError);
  });
});

// @req FR:live-deploy/gh.race
describe('races', () => {
  it('rebuilds on the new head when the branch moved and the paths are untouched', async () => {
    const gh = new FakeGitHub('acme', 'tasks', { 'tasks/a.md': 'A' });
    const { s } = make(gh);
    const v = (await s.read('tasks/a.md')).version;
    gh.beforeRefUpdate = () => { gh.push({ 'tasks/asks/k.md': 'agent ask' }); };
    await s.write('tasks/a.md', 'A2', { expectedVersion: v });
    expect(gh.file('tasks/a.md')).toBe('A2');
    expect(gh.file('tasks/asks/k.md')).toBe('agent ask');
  });
  it('conflicts when the moved branch changed a path it expected', async () => {
    const gh = new FakeGitHub('acme', 'tasks', { 'tasks/a.md': 'A' });
    const { s } = make(gh);
    const v = (await s.read('tasks/a.md')).version;
    gh.beforeRefUpdate = () => { gh.push({ 'tasks/a.md': 'theirs' }); };
    await expect(s.write('tasks/a.md', 'mine', { expectedVersion: v })).rejects.toBeInstanceOf(ConflictError);
    expect(gh.file('tasks/a.md')).toBe('theirs');
  });
  it('gives up after 3 attempts', async () => {
    const gh = new FakeGitHub();
    const { s } = make(gh);
    let n = 0;
    const always = () => { n++; gh.push({ [`tasks/o${n}.md`]: 'x' }); gh.beforeRefUpdate = always; };
    gh.beforeRefUpdate = always;
    await expect(s.write('tasks/a.md', 'A')).rejects.toBeInstanceOf(ConflictError);
    expect(n).toBe(3);
    gh.beforeRefUpdate = undefined;
  });
});

// @req FR:live-deploy/gh.serial
describe('serial writes', () => {
  it('runs writes one at a time; reads do not wait', async () => {
    const gh = new FakeGitHub('acme', 'tasks', { 'tasks/a.md': '0' });
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let first = true;
    const { s } = make(gh, { fetch: async (u, i = {}) => { if (i.method === 'PATCH' && first) { first = false; await gate; } return gh.fetch(u, i); } });
    const v = (await s.read('tasks/a.md')).version;
    const w1 = s.write('tasks/a.md', 'a', { expectedVersion: v });
    const w2 = s.write('tasks/a.md', 'b', { expectedVersion: v });
    await new Promise((r) => setTimeout(r, 10));
    expect((await s.read('tasks/a.md')).content).toBe('0');
    release();
    const res = await Promise.allSettled([w1, w2]);
    expect(res.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
    expect(gh.file('tasks/a.md')).toBe('a');
  });
});

// @req FR:live-deploy/gh.fresh @req FR:live-deploy/gh.race
describe('review round 1: snapshot ordering', () => {
  it('a read in flight while a write lands never replaces the newer snapshot', async () => {
    const gh = new FakeGitHub('acme', 'tasks', { 'tasks/a.md': 'A1' });
    let release!: () => void;
    let gateRef = false;
    let reader: Promise<unknown> | null = null;
    const h: { s?: GitHubStorage; advance?: (ms: number) => void } = {};
    const { s, clock } = make(gh, {
      fetch: async (u, i = {}) => {
        const method = i.method ?? 'GET';
        if (method === 'POST' && String(u).endsWith('/git/blobs') && !reader) {
          // Mid-write: a reader whose window expired starts a check and sees the old head.
          h.advance!(10_000); gateRef = true; reader = h.s!.read('tasks/a.md');
        }
        // The reader sends no ETag, so it gets a full 200 for the old head (the non-304 path).
        const strip = gateRef && method === 'GET' && String(u).includes('/git/ref/');
        const r = await gh.fetch(u, strip ? { ...i, headers: { ...(i.headers as Record<string, string>), 'if-none-match': '' } } : i);
        if (gateRef && method === 'GET' && String(u).includes('/git/ref/')) { gateRef = false; await new Promise<void>((ok) => { release = ok; }); }
        return r;
      },
    });
    h.s = s; h.advance = clock.advance;
    await s.read('tasks/a.md');
    await s.write('tasks/a.md', 'A2');
    release();
    await reader;
    expect((await s.read('tasks/a.md')).content).toBe('A2');
    expect(await s.rev()).toBe(gh.refs.get('main'));
  });
  it('a failed tree read after a good ref read is reported by rev()', async () => {
    const gh = new FakeGitHub('acme', 'tasks', { 'tasks/a.md': 'A' });
    let failTree = false;
    const { s, clock } = make(gh, { fetch: (u, i = {}) => failTree && String(u).includes('/git/trees/') ? Promise.resolve(new Response('{}', { status: 502 })) : gh.fetch(u, i) });
    await s.read('tasks/a.md');
    gh.push({ 'tasks/b.md': 'B' });
    failTree = true;
    clock.advance(10_000);
    expect((await s.read('tasks/a.md')).content).toBe('A');
    await expect(s.rev()).rejects.toThrow(/502/);
    failTree = false;
    clock.advance(10_000);
    expect(await s.list()).toEqual(['tasks/a.md', 'tasks/b.md']);
  });
  it('a ref update that times out after GitHub applied it counts as written', async () => {
    const gh = new FakeGitHub('acme', 'tasks', { 'tasks/a.md': 'A' });
    let drop = true;
    const { s } = make(gh, { fetch: async (u, i = {}) => { const r = await gh.fetch(u, i); if (i.method === 'PATCH' && drop) { drop = false; throw new Error('socket hang up'); } return r; } });
    await s.write('tasks/a.md', 'A2');
    expect(gh.file('tasks/a.md')).toBe('A2');
    expect(gh.commitCount()).toBe(2);
  });
  it('a ref update with no answer that did not land is an error, not a silent success', async () => {
    const gh = new FakeGitHub('acme', 'tasks', { 'tasks/a.md': 'A' });
    const { s } = make(gh, { fetch: async (u, i = {}) => { if (i.method === 'PATCH') throw new Error('socket hang up'); return gh.fetch(u, i); } });
    await expect(s.write('tasks/a.md', 'A2')).rejects.toBeInstanceOf(StorageError);
    expect(gh.file('tasks/a.md')).toBe('A');
  });
});

describe('review round 1: bounded blob cache', () => {
  it('keeps at most 2000 blobs, dropping the oldest', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 2005; i++) files[`tasks/asks/k${i}.md`] = `ask ${i}`;
    const gh = new FakeGitHub('acme', 'tasks', files);
    const { s } = make(gh);
    for (let i = 0; i < 2005; i++) await s.read(`tasks/asks/k${i}.md`);
    const before = gets(gh, 'blobs');
    await s.read('tasks/asks/k2004.md');
    expect(gets(gh, 'blobs')).toBe(before);
    await s.read('tasks/asks/k0.md');
    expect(gets(gh, 'blobs')).toBe(before + 1);
  });
});
