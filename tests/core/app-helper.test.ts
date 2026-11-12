/**
 * Runs the real swap helper with bash on fake bundles in a temp folder. Never touches /Applications or a real app.
 * @req FR:devops-installer/arch.inject
 */
import { spawn, spawnSync } from 'child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { HELPER_SCRIPT, helperEnv, spawnHelperDetached, writeHelper, type HelperJob } from '../../src/core/app-update';

const posix = process.platform !== 'win32';
const d = posix ? describe : describe.skip;

function bundle(at: string, tag: string, exec = true, sha?: string) {
  mkdirSync(join(at, 'Contents/MacOS'), { recursive: true });
  if (sha) { mkdirSync(join(at, 'Contents/Resources/app'), { recursive: true }); writeFileSync(join(at, 'Contents/Resources/app/package.json'), JSON.stringify({ stackBuild: { sha } }, null, 2)); }
  writeFileSync(join(at, 'Contents/MacOS/Stack'), `#!/bin/sh\necho ${tag}\n`);
  if (exec) chmodSync(join(at, 'Contents/MacOS/Stack'), 0o755);
  writeFileSync(join(at, 'tag'), tag);
}

function world() {
  const root = mkdtempSync(join(tmpdir(), 'stack-helper-'));
  const apps = join(root, 'Applications'); mkdirSync(apps);
  const state = join(root, '.stack');
  const target = join(apps, 'Stack.app');
  const source = join(root, 'out/Stack.app');
  const opened = join(root, 'opened');
  const script = writeHelper(state);
  /** A fake `open` that records its argument, or fails when told to. */
  const open = (fail = false) => { const p = join(root, fail ? 'open-fail' : 'open-ok'); writeFileSync(p, `#!/bin/sh\necho "$1" >> "${opened}"\n${fail ? 'exit 1' : 'exit 0'}\n`); chmodSync(p, 0o755); return p; };
  const run = (job: Partial<HelperJob> = {}, extra: Record<string, string> = {}) => {
    const env = { PATH: process.env.PATH ?? '/usr/bin:/bin', ...helperEnv({ source, target, stateDir: state, relaunch: false, quit: false, ...job }), STACK_UPDATE_OPEN: open(), ...extra };
    return spawnSync('/bin/bash', [script], { env, encoding: 'utf8' });
  };
  const tag = (p: string) => (existsSync(join(p, 'tag')) ? readFileSync(join(p, 'tag'), 'utf8') : null);
  const result = () => JSON.parse(readFileSync(join(state, 'update-result.json'), 'utf8'));
  const log = () => readFileSync(join(state, 'update.log'), 'utf8');
  const openedList = () => (existsSync(opened) ? readFileSync(opened, 'utf8').trim().split('\n') : []);
  return { root, apps, state, target, source, script, open, run, tag, result, log, openedList };
}

d('swap helper', () => {
  // @req FR:devops-installer/swap.verify
  it('refuses a copy that is not the chosen build', () => {
    const w = world();
    bundle(w.target, 'old'); bundle(w.source, 'new', true, 'cccccccccccc');
    expect(w.run({ sha: 'bbbbbbbbbbbb' }).status).toBe(1);
    expect(w.tag(w.target)).toBe('old');
    expect(w.result()).toMatchObject({ ok: false, step: 'verify' });
    bundle(w.source, 'new', true, 'bbbbbbbbbbbb');
    expect(w.run({ sha: 'bbbbbbbbbbbb' }).status).toBe(0);
    expect(w.tag(w.target)).toBe('new');
  });

  // @req FR:devops-installer/swap.lock
  it('takes over a lock whose owner died, and stops when a live helper holds it', () => {
    const w = world();
    bundle(w.target, 'old'); bundle(w.source, 'new');
    const lock = join(w.apps, '.Stack.app.updating');
    mkdirSync(lock); writeFileSync(join(lock, 'pid'), String(process.pid));
    expect(w.run().status).toBe(1);
    expect(w.tag(w.target)).toBe('old');
    expect(w.log()).toMatch(/busy: another update is running/);
    writeFileSync(join(lock, 'pid'), '999999');
    expect(w.run().status).toBe(0);
    expect(w.tag(w.target)).toBe('new');
    expect(existsSync(lock)).toBe(false);
  });

  // @req FR:devops-installer/swap.lock
  it('puts the previous app back first when a killed helper left none', () => {
    const w = world();
    bundle(join(w.apps, '.Stack.app.previous'), 'old');
    const r = w.run({}, { STACK_UPDATE_SOURCE: join(w.root, 'missing.app') });
    expect(r.status).toBe(1);
    expect(w.tag(w.target)).toBe('old');
    expect(w.log()).toMatch(/recover: put the previous app back/);
  });

  // @req FR:devops-installer/swap.wait @req FR:devops-installer/update.install
  it('asks a running app to quit, waits for it, then swaps', async () => {
    const w = world();
    bundle(w.target, 'old'); bundle(w.source, 'new');
    writeFileSync(join(w.target, 'Contents/MacOS/Stack'), '#!/bin/sh\nsleep 30\n');
    const app = spawn(join(w.target, 'Contents/MacOS/Stack'), [], { stdio: 'ignore' });
    const quitter = join(w.root, 'quitter');
    writeFileSync(quitter, '#!/bin/sh\npkill -f "$1/Contents/MacOS/"\nexit 0\n'); chmodSync(quitter, 0o755);
    const env = { PATH: process.env.PATH ?? '', ...helperEnv({ source: w.source, target: w.target, stateDir: w.state, relaunch: false, quit: true }), STACK_UPDATE_QUITTER: quitter, STACK_UPDATE_WAIT_S: '10' };
    const code = await new Promise<number | null>((ok) => spawn('/bin/bash', [w.script], { env }).on('exit', ok));
    app.kill();
    expect(code).toBe(0);
    expect(w.tag(w.target)).toBe('new');
    expect(w.log()).toMatch(/quit: asking Stack to quit/);
  });

  // @req FR:devops-installer/swap.@script
  it('is a fixed script: no input is in its text', () => {
    expect(HELPER_SCRIPT).toMatch(/^#!\/bin\/bash/);
    expect(HELPER_SCRIPT).not.toMatch(/Applications|\.local\/share/);
    const w = world();
    expect(readFileSync(w.script, 'utf8')).toBe(HELPER_SCRIPT);
  });

  // @req FR:devops-installer/swap.stage @req FR:devops-installer/swap.atomic @req FR:devops-installer/swap.keep @req FR:devops-installer/swap.log @req FR:devops-installer/swap.result @req FR:devops-installer/$update-result
  it('swaps the bundle, keeps the previous one, logs each step, and records success', () => {
    const w = world();
    bundle(w.target, 'old'); bundle(w.source, 'new');
    const r = w.run();
    expect(r.status).toBe(0);
    expect(w.tag(w.target)).toBe('new');
    expect(w.tag(join(w.apps, '.Stack.app.previous'))).toBe('old');
    expect(existsSync(join(w.apps, '.Stack.app.staging'))).toBe(false);
    expect(w.result()).toMatchObject({ ok: true, step: 'done' });
    expect(w.log()).toMatch(/^\d{4}-\d\d-\d\dT[\d:]+Z start: /m);
    expect(w.log()).toMatch(/swap: done/);
    expect(w.openedList()).toEqual([]);
    expect(w.tag(w.source)).toBe('new');
  });

  // @req FR:devops-installer/install.place @req FR:devops-installer/swap.launch
  it('installs where no app was and opens it when told to relaunch', () => {
    const w = world();
    bundle(w.source, 'new');
    expect(w.run({ relaunch: true }).status).toBe(0);
    expect(w.tag(w.target)).toBe('new');
    expect(w.openedList()).toEqual([w.target]);
  });

  // @req FR:devops-installer/swap.verify
  it('removes a staged copy with no executable and leaves the target as it was', () => {
    const w = world();
    bundle(w.target, 'old'); bundle(w.source, 'broken', false);
    const r = w.run({ relaunch: true });
    expect(r.status).toBe(1);
    expect(w.tag(w.target)).toBe('old');
    expect(existsSync(join(w.apps, '.Stack.app.staging'))).toBe(false);
    expect(w.result()).toMatchObject({ ok: false, step: 'verify' });
    expect(w.openedList()).toEqual([]);
  });

  // @req FR:devops-installer/swap.stage
  it('fails at stage when the source is missing', () => {
    const w = world();
    bundle(w.target, 'old');
    expect(w.run().status).toBe(1);
    expect(w.tag(w.target)).toBe('old');
    expect(w.result()).toMatchObject({ ok: false, step: 'stage' });
  });

  // @req FR:devops-installer/swap.launch
  it('puts the previous bundle back and opens it when the new one fails to open', () => {
    const w = world();
    bundle(w.target, 'old'); bundle(w.source, 'new');
    const r = w.run({ relaunch: true }, { STACK_UPDATE_OPEN: w.open(true) });
    expect(r.status).toBe(1);
    expect(w.tag(w.target)).toBe('old');
    expect(w.result()).toMatchObject({ ok: false, step: 'launch' });
    expect(w.openedList()).toEqual([w.target, w.target]);
    expect(w.log()).toMatch(/launch: failed, rolling back/);
  });

  // @req FR:devops-installer/swap.wait
  it('waits for the app pid to exit before it changes anything', async () => {
    const w = world();
    bundle(w.target, 'old'); bundle(w.source, 'new');
    const app = spawn('/bin/sleep', ['1']);
    const t0 = Date.now();
    const env = { PATH: process.env.PATH ?? '', ...helperEnv({ source: w.source, target: w.target, stateDir: w.state, pid: app.pid!, relaunch: false, quit: false }) };
    const code = await new Promise<number | null>((ok) => spawn('/bin/bash', [w.script], { env }).on('exit', ok));
    expect(code).toBe(0);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(800);
    expect(w.tag(w.target)).toBe('new');
  });

  // @req FR:devops-installer/swap.wait
  it('gives up after the wait limit and changes nothing', () => {
    const w = world();
    bundle(w.target, 'old'); bundle(w.source, 'new');
    const r = w.run({ pid: process.pid }, { STACK_UPDATE_WAIT_S: '1' });
    expect(r.status).toBe(1);
    expect(w.tag(w.target)).toBe('old');
    expect(w.result()).toMatchObject({ ok: false, step: 'wait' });
  });
});

describe('helper process', () => {
  // @req FR:devops-installer/swap.detached
  it('runs detached in its own process group with no stdio, and is not waited on', () => {
    const calls: { cmd: string; args: string[]; opts: Record<string, unknown> }[] = []; let unref = 0;
    const fake = ((cmd: string, args: string[], opts: Record<string, unknown>) => { calls.push({ cmd, args, opts }); return { unref: () => { unref++; } }; }) as unknown as typeof spawn;
    const state = mkdtempSync(join(tmpdir(), 'stack-helper-'));
    spawnHelperDetached({ source: '/s/Stack.app', target: '/t/Stack.app', stateDir: state, pid: 9, relaunch: false, quit: false }, fake);
    expect(calls).toHaveLength(1);
    expect(calls[0].cmd).toBe('/bin/bash');
    expect(calls[0].args).toEqual([join(state, 'app/update.sh')]);
    expect(calls[0].opts).toMatchObject({ detached: true, stdio: 'ignore', env: expect.objectContaining({ STACK_UPDATE_PID: '9', STACK_UPDATE_RELAUNCH: '0' }) });
    expect(unref).toBe(1);
  });
  // @req FR:devops-installer/arch.no-apple
  it('needs no Apple account: no Developer ID, notarization, or Electron updater in the installer', () => {
    for (const f of ['src/core/app-update.ts', 'src/cli/app.ts', 'desktop/src/update.ts', 'desktop/src/pack.ts']) {
      const text = readFileSync(join(__dirname, '../..', f), 'utf8');
      expect(text).not.toMatch(/Developer ID Application|notarytool|osxNotarize|osxSign|autoUpdater|electron-updater|APPLE_ID/);
    }
  });
});
