import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createPrServers, type PrServers } from '../../src/api/pr-server';

const git = (cwd: string, ...args: string[]) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], { cwd, stdio: 'pipe' }).toString().trim();
const SERVER = `const http = require('http');
const at = process.argv.indexOf('--port');
const port = Number(at > 0 ? process.argv[at + 1] : process.env.PORT);
http.createServer((q, s) => s.end('pr ' + require('./package.json').version)).listen(port, '127.0.0.1');`;

/** A root with a clone `r` of a bare origin that says it is github.com/o/r and holds `refs/pull/7/head`. */
function world(pkg: Record<string, unknown> | null = { name: 'r', version: '7.0.0', scripts: { start: 'node server.js' } }) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'stack-prsrv-')));
  const origin = join(root, 'origin.git');
  mkdirSync(origin);
  git(origin, 'init', '--bare', '-q');
  const clone = join(root, 'dev', 'r');
  mkdirSync(clone, { recursive: true });
  git(clone, 'init', '-q', '-b', 'main');
  writeFileSync(join(clone, 'README.md'), 'main\n');
  git(clone, 'add', '.'); git(clone, 'commit', '-qm', 'main');
  git(clone, 'remote', 'add', 'origin', origin);
  git(clone, 'push', '-q', 'origin', 'main');
  git(clone, 'checkout', '-qb', 'pr');
  writeFileSync(join(clone, 'server.js'), SERVER);
  if (pkg) writeFileSync(join(clone, 'package.json'), JSON.stringify(pkg));
  git(clone, 'add', '.'); git(clone, 'commit', '-qm', 'pr');
  git(clone, 'push', '-q', 'origin', 'pr:refs/pull/7/head');
  git(clone, 'checkout', '-q', 'main');
  // The clone says its origin is the GitHub repo; fetches go to the local bare repo.
  git(clone, 'config', 'remote.origin.url', 'https://github.com/O/R.git');
  git(clone, 'config', `url.${origin}.insteadOf`, 'https://github.com/O/R.git');
  return { root, clone, wt: `${clone}.worktrees/pr-7-live` };
}
const until = async (s: PrServers, want: string, ms = 20_000) => {
  const end = Date.now() + ms;
  for (;;) { const v = s.view('o/r', 7); if (v?.state === want) return v; if (Date.now() > end) throw new Error(`still ${JSON.stringify(v)}`); await new Promise((ok) => setTimeout(ok, 50)); }
};

describe('PR test servers', () => {
  const made: { s: PrServers; root: string }[] = [];
  const make = (root: string, o: Partial<Parameters<typeof createPrServers>[0]> = {}) => { const s = createPrServers({ roots: [join(root, 'dev')], ...o }); made.push({ s, root }); return s; };
  afterEach(async () => { for (const m of made.splice(0)) { await m.s.stopAll(); rmSync(m.root, { recursive: true, force: true }); } });

  // @req FR:pr-page/server.clone @req FR:pr-page/server.checkout @req FR:pr-page/server.run @req FR:pr-page/server.view @req FR:pr-page/server.port
  it('start: fetches the PR into a worktree, runs the package script on a free port, and reports the URL', async () => {
    const w = world();
    let changes = 0;
    const s = make(w.root, { onChange: () => { changes++; } });
    expect(s.view('o/r', 7)).toBeUndefined();
    const first = await s.start('o/r', 7);
    expect(first).toMatchObject({ state: 'starting', step: 'checkout' });
    const v = await until(s, 'running');
    expect(v.url).toMatch(/^http:\/\/localhost:\d+$/);
    expect(v.error).toBeUndefined();
    expect(Object.keys(v).sort()).toEqual(['at', 'state', 'url']);
    expect(existsSync(join(w.wt, 'server.js'))).toBe(true);
    expect(git(w.wt, 'rev-parse', 'HEAD')).toBe(git(w.clone, 'rev-parse', 'pr'));
    expect(await (await fetch(v.url!)).text()).toBe('pr 7.0.0');
    expect(changes).toBeGreaterThan(0);
    // A second start returns the same server.
    expect((await s.start('o/r', 7)).url).toBe(v.url);
  }, 30_000);

  // @req FR:pr-page/server.stop
  it('stop: ends the process, drops the view, and keeps the worktree', async () => {
    const w = world();
    const s = make(w.root);
    await s.start('o/r', 7);
    const v = await until(s, 'running');
    await s.stop('o/r', 7);
    expect(s.view('o/r', 7)).toBeUndefined();
    expect(existsSync(w.wt)).toBe(true);
    await expect(fetch(v.url!)).rejects.toThrow();
    // The worktree is used again.
    await s.start('o/r', 7);
    expect((await until(s, 'running')).url).toMatch(/localhost/);
  }, 40_000);

  // @req FR:pr-page/server.plan @req FR:pr-page/server.port
  it('the Server line of the check file runs, with its port replaced', async () => {
    const w = world(null);
    writeFileSync(join(w.clone, 'x'), ''); // the PR has no package.json: only the Server line can start it
    const s = make(w.root);
    await s.start('o/r', 7, 'echo \'{"version":"9"}\' > package.json && node server.js --port 5180');
    const v = await until(s, 'running');
    expect(v.url).not.toBe('http://localhost:5180');
    expect(await (await fetch(v.url!)).text()).toBe('pr 9');
  }, 30_000);

  // @req FR:pr-page/server.clone @req FR:pr-page/server.plan @req FR:pr-page/server.run
  it('failures say why: no clone, no command, a command that exits', async () => {
    const w = world({ name: 'r', version: '1', scripts: { test: 'true' } });
    const s = make(w.root);
    await s.start('o/other', 7);
    expect(s.view('o/other', 7)).toMatchObject({ state: 'failed', error: 'No local clone of o/other' });
    await s.start('o/r', 7);
    expect(await until(s, 'failed')).toMatchObject({ error: 'No server command: add a Server line to the check file' });
    await s.start('o/r', 7, 'echo boom >&2; exit 3');
    expect((await until(s, 'failed')).error).toBe('The server stopped: boom');
    // A PR that does not exist.
    await s.start('o/r', 8);
    const end = Date.now() + 10_000;
    while (s.view('o/r', 8)?.state === 'starting' && Date.now() < end) await new Promise((ok) => setTimeout(ok, 50));
    expect(s.view('o/r', 8)).toMatchObject({ state: 'failed', error: 'Could not fetch o/r#8' });
  }, 40_000);

  // @req FR:pr-page/server.stop @req FR:pr-page/api.server
  it('at most 3 at one time; a bad repo name is refused', async () => {
    const w = world();
    const s = make(w.root, { max: 1 });
    await s.start('o/r', 7);
    await expect(s.start('o/r', 9)).rejects.toThrow('Stop a test server first: 1 run now');
    await expect(s.start('../x', 1)).rejects.toThrow();
    await expect(s.start('o/r', 0)).rejects.toThrow();
  }, 30_000);

  // @req FR:pr-page/server.run
  it('a port that stays shut fails after the wait', async () => {
    const w = world();
    const s = make(w.root, { waitMs: 600 });
    await s.start('o/r', 7, 'sleep 30');
    expect((await until(s, 'failed')).error).toBe('The server did not open its port in time');
  }, 30_000);
});
