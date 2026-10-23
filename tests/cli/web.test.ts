/** @req FR:cli/web.serve @req FR:cli/web.demo */
import http from 'http';
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { prepareDemo, startWeb } from '../../src/cli/web';

const ENV = { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
Object.assign(process.env, ENV);
const tmp = () => mkdtempSync(join(tmpdir(), 'stack-web-'));

function source(): string {
  const s = tmp(); mkdirSync(join(s, 'tasks'));
  writeFileSync(join(s, 'tasks/alpha.md'), '# Alpha\n\n## Active\n\n- [ ] Write the plan\n');
  return join(s, 'tasks');
}

describe('prepareDemo', () => {
  it('copies tasks into a fresh git repo and never touches the source', () => {
    const src = source(); const dest = join(tmp(), 'demo');
    const before = readFileSync(join(src, 'alpha.md'), 'utf8');
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
    } finally { await s.close(); }
  });
});
