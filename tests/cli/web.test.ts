/** @req FR:cli/web.serve @req FR:cli/web.demo @req FR:cli/web.live */
import http from 'http';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, symlinkSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { redact, prepareDemo, prepareLive, resolveRepo, startWeb } from '../../src/cli/web';

const ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
Object.assign(process.env, ENV);
const tmp = () => mkdtempSync(join(tmpdir(), 'stack-web-'));

function source(): string {
  const s = tmp(); mkdirSync(join(s, 'tasks'));
  writeFileSync(join(s, 'tasks/alpha.md'), '# Alpha\n\n## Active\n\n- [ ] Write the plan\n');
  return s;
}

describe('prepareDemo', () => {
  it('copies tasks into a fresh git repo and never touches the source', () => {
    const src = source(); const dest = join(tmp(), 'demo');
    const before = readFileSync(join(src, 'tasks/alpha.md'), 'utf8');
    prepareDemo(src, dest);
    expect(readFileSync(join(dest, 'tasks/alpha.md'), 'utf8')).toBe(before);
    expect(existsSync(join(dest, '.git'))).toBe(true);
    expect(execFileSync('git', ['log', '--oneline'], { cwd: dest, encoding: 'utf8' })).toContain('demo');
  });
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
  it('serves the app, local auth stub, and the api over the repo', async () => {
    const dest = join(tmp(), 'demo'); prepareDemo(source(), dest);
    const web = tmp(); writeFileSync(join(web, 'index.html'), '<html>app</html>');
    const s = await startWeb({ dir: dest, port: 0, webDir: web, label: 'demo copy' });
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

describe('prepareLive', () => {
  const g = (cwd: string, ...a: string[]) => execFileSync('git', a, { cwd, encoding: 'utf8' }).trim();
  function content(): string {
    const r = source(); g(r, 'init', '-q', '-b', 'main'); g(r, 'add', '-A');
    g(r, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-q', '-m', 'init'); return r;
  }
  it('works on a dedicated branch in a worktree; the repo checkout and main stay untouched', async () => {
    const repo = content(); const wt = join(tmp(), 'wt');
    const live = prepareLive(repo, 'stack-web', wt);
    expect(live).toEqual({ dir: wt, branch: 'stack-web' });
    expect(prepareLive(repo, 'stack-web', wt).dir).toBe(wt); // idempotent
    const web = tmp(); writeFileSync(join(web, 'index.html'), 'x');
    const s = await startWeb({ dir: wt, port: 0, webDir: web, info: { mode: 'live', repo, branch: 'stack-web' } });
    try {
      const d = await fetch(`${s.url}/api/tasks/complete`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ref: 'alpha:4' }) });
      expect(d.status).toBe(200);
      const me = await (await fetch(`${s.url}/.auth/me`)).json() as { local: { mode: string; branch: string } };
      expect(me.local).toMatchObject({ mode: 'live', branch: 'stack-web' });
    } finally { await s.close(); }
    expect(g(repo, 'log', '--oneline', 'stack-web')).toContain('Complete');
    expect(g(repo, 'log', '--oneline', 'main')).not.toContain('Complete');
    expect(g(repo, 'branch', '--show-current')).toBe('main');
    expect(readFileSync(join(repo, 'tasks/alpha.md'), 'utf8')).toContain('- [ ] Write the plan');
  });
  it('refuses main and option-like branches', () => {
    const repo = content();
    expect(() => prepareLive(repo, 'main', join(tmp(), 'w'))).toThrow(/never commits/);
    expect(() => prepareLive(repo, '--detach', join(tmp(), 'w'))).toThrow(/Bad branch/);
  });
  it('rejects a non-repo', () => {
    expect(() => prepareLive(tmp(), 'stack-web', join(tmp(), 'w'))).toThrow(/git repo/);
  });
});

describe('resolveRepo', () => {
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
