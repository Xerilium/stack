import { applyLoginPath, PATH_MARK, resolveLoginPath, type ExecFn } from '../src/login-path';

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
    expect(calls[0].args[1]).toContain('$PATH');
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
    const r = await resolveLoginPath({ env: { PATH: '/custom/bin:/usr/bin' }, home: HOME, exec, platform: 'darwin' });
    expect(r.path).toBe('/opt/homebrew/bin:/usr/bin:/bin:/custom/bin');
  });

  it.each([
    ['fails', new Error('exit 1'), 'exit 1'],
    ['times out', Object.assign(new Error('Command failed'), { killed: true, signal: 'SIGTERM' }), 'timed out'],
    ['prints no markers', 'oh-my-zsh says hi', 'no PATH in shell output'],
    ['prints an empty PATH', marked(''), 'no PATH in shell output'],
  ])('falls back when the shell %s', async (_name, out, reason) => {
    const { exec } = fakeExec(out as string | Error);
    const r = await resolveLoginPath({ env: { PATH: '/usr/bin:/opt/homebrew/bin:/bin' }, home: HOME, exec, platform: 'darwin' });
    expect(r.source).toBe(`fallback (${reason})`);
    expect(r.path).toBe('/opt/homebrew/bin:/usr/local/bin:/Users/me/.local/bin:/usr/bin:/bin');
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
