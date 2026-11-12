import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { applyLoginPath, PATH_MARK, resolveLoginPath, spawnExec, type ExecFn } from '../src/login-path';

const HOME = '/Users/me';
const BARE = '/usr/bin:/bin:/usr/sbin:/sbin';
const marked = (p: string) => `${PATH_MARK}${p}${PATH_MARK}`;

function fakeExec(out: string | Error) {
  const calls: { file: string; args: string[]; timeoutMs: number }[] = [];
  const exec: ExecFn = async (file, args, o) => { calls.push({ file, args, timeoutMs: o.timeoutMs }); if (out instanceof Error) throw out; return out; };
  return { exec, calls };
}

// @req FR:desktop-shell/host.path
describe('resolveLoginPath', () => {
  it('runs $SHELL as a login, interactive shell with a timeout', async () => {
    const { exec, calls } = fakeExec(marked('/opt/homebrew/bin:/usr/bin'));
    await resolveLoginPath({ env: { SHELL: '/bin/bash', PATH: BARE }, home: HOME, exec, platform: 'darwin' });
    expect(calls).toHaveLength(1);
    expect(calls[0].file).toBe('/bin/bash');
    expect(calls[0].args[0]).toBe('-ilc');
    expect(calls[0].args[1]).toContain('/usr/bin/printenv PATH');
    expect(calls[0].timeoutMs).toBe(5000);
  });

  it('defaults to /bin/zsh when SHELL is not set', async () => {
    const { exec, calls } = fakeExec(marked('/opt/homebrew/bin'));
    await resolveLoginPath({ env: { PATH: BARE }, home: HOME, exec, platform: 'darwin' });
    expect(calls[0].file).toBe('/bin/zsh');
  });

  it('uses the shell PATH and ignores start-up noise around the markers', async () => {
    const { exec } = fakeExec(`Welcome!\n${marked('/Users/me/.nvm/versions/node/v22/bin:/opt/homebrew/bin:/usr/bin:/bin')}\nbye`);
    const r = await resolveLoginPath({ env: { SHELL: '/bin/zsh', PATH: BARE }, home: HOME, exec, platform: 'darwin' });
    expect(r.source).toBe('login shell');
    expect(r.path).toBe('/Users/me/.nvm/versions/node/v22/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin');
  });

  it('keeps current entries the shell lacks at the end, with no repeats', async () => {
    const { exec } = fakeExec(marked('/opt/homebrew/bin:/usr/bin:/usr/bin::/bin'));
    const r = await resolveLoginPath({ env: { PATH: '/sbin:/usr/bin' }, home: HOME, exec, platform: 'darwin' });
    expect(r.path).toBe('/opt/homebrew/bin:/usr/bin:/bin:/sbin');
  });

  it('keeps a terminal launch PATH as is and runs no shell', async () => {
    const { exec, calls } = fakeExec(marked('/x'));
    const r = await resolveLoginPath({ env: { PATH: '/repo/node_modules/.bin:/Users/me/.nvm/v22/bin:/usr/bin' }, home: HOME, exec, platform: 'darwin' });
    expect(calls).toHaveLength(0);
    expect(r).toEqual({ path: '/repo/node_modules/.bin:/Users/me/.nvm/v22/bin:/usr/bin', source: 'unchanged (not a bare system PATH)' });
  });

  it.each([
    ['fails', new Error('shell exited 1\nstderr detail'), 'shell exited 1'],
    ['times out', new Error('timed out'), 'timed out'],
    ['prints no markers', 'oh-my-zsh says hi', 'no PATH in shell output'],
    ['prints an empty PATH', marked(''), 'no PATH in shell output'],
  ])('falls back when the shell %s', async (_name, out, reason) => {
    const { exec } = fakeExec(out as string | Error);
    const r = await resolveLoginPath({ env: { PATH: BARE }, home: HOME, exec, platform: 'darwin' });
    expect(r.source).toBe(`fallback (${reason})`);
    expect(r.path).toBe(`/opt/homebrew/bin:/usr/local/bin:/Users/me/.local/bin:${BARE}`);
  });

  it('falls back with no current PATH', async () => {
    const { exec } = fakeExec(new Error('ENOENT'));
    const r = await resolveLoginPath({ env: {}, home: HOME, exec, platform: 'darwin' });
    expect(r.path).toBe('/opt/homebrew/bin:/usr/local/bin:/Users/me/.local/bin');
  });

  it('leaves PATH alone on Windows and runs no shell', async () => {
    const { exec, calls } = fakeExec(marked('/x'));
    const r = await resolveLoginPath({ env: { PATH: 'C:\\Windows' }, home: 'C:\\Users\\me', exec, platform: 'win32' });
    expect(calls).toHaveLength(0);
    expect(r).toEqual({ path: 'C:\\Windows', source: 'unchanged (win32)' });
  });
});

// @req FR:desktop-shell/host.path @req NFR:desktop-shell/shell.log
describe('applyLoginPath', () => {
  it('sets env.PATH and logs the source, never the value', async () => {
    const env: NodeJS.ProcessEnv = { PATH: BARE, SHELL: '/bin/zsh' };
    const log: string[] = [];
    const { exec } = fakeExec(marked('/Users/me/secret-tools/bin:/usr/bin'));
    await applyLoginPath(env, { home: HOME, exec, platform: 'darwin', log: (l) => log.push(l) });
    expect(env.PATH).toBe('/Users/me/secret-tools/bin:/usr/bin:/bin:/usr/sbin:/sbin');
    expect(log).toEqual(['path: login shell']);
  });

  it('logs the fallback reason', async () => {
    const env: NodeJS.ProcessEnv = { PATH: BARE };
    const log: string[] = [];
    await applyLoginPath(env, { home: HOME, exec: fakeExec(new Error('boom')).exec, platform: 'darwin', log: (l) => log.push(l) });
    expect(env.PATH?.startsWith('/opt/homebrew/bin:')).toBe(true);
    expect(log).toEqual(['path: fallback (boom)']);
  });
});

// The real spawner, driven with Node scripts (not a shell): timeout, stdin, early resolve. @req FR:desktop-shell/host.path
describe('spawnExec', () => {
  const node = (script: string, timeoutMs = 400) => spawnExec(process.execPath, ['-e', script], { timeoutMs });

  it('SIGKILLs the whole group on timeout: a child that ignores SIGTERM and a grandchild that holds stdout', async () => {
    const pids = join(mkdtempSync(join(tmpdir(), 'stack-path-')), 'pids');
    const script = `const c = require('child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: ['ignore', 'inherit', 'ignore'] });
      process.on('SIGTERM', () => {}); require('fs').writeFileSync(${JSON.stringify(pids)}, process.pid + ',' + c.pid); setInterval(() => {}, 1000)`;
    const t = Date.now();
    await expect(spawnExec(process.execPath, ['-e', script], { timeoutMs: 400 })).rejects.toThrow('timed out');
    expect(Date.now() - t).toBeLessThan(2000);
    await new Promise((r) => setTimeout(r, 100));
    const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
    for (const pid of readFileSync(pids, 'utf8').split(',').map(Number)) expect(alive(pid)).toBe(false);
  });

  it('closes stdin, so a child that reads input gets EOF', async () => {
    await expect(node("process.stdin.resume(); process.stdin.on('end', () => process.stdout.write('eof'))", 3000)).resolves.toBe('eof');
  });

  it('resolves once both markers arrive, even if the child keeps running', async () => {
    const t = Date.now();
    await expect(node(`process.stdout.write('${PATH_MARK}/a:/b${PATH_MARK}'); setInterval(() => {}, 1000)`, 3000)).resolves.toContain('/a:/b');
    expect(Date.now() - t).toBeLessThan(2000);
  });

  it('kills a child whose output passes the cap', async () => {
    await expect(node("const s = 'x'.repeat(65536); setInterval(() => process.stdout.write(s), 1)", 3000)).rejects.toThrow('shell output too large');
  });

  it('rejects on a non-zero exit and on a missing program', async () => {
    await expect(node('process.exit(3)')).rejects.toThrow('shell exited 3');
    await expect(spawnExec('/no/such/shell', [], { timeoutMs: 400 })).rejects.toThrow('cannot start shell (ENOENT)');
  });
});
