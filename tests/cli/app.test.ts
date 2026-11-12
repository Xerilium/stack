import { appCmd, BUILD_STEPS, type AppCliDeps } from '../../src/cli/app';
import { manifestPath, type BuildStamp, type HelperJob, type UpdateResult } from '../../src/core/app-update';
import { run } from '../../src/cli/run';

const OLD: BuildStamp = { version: '0.0.1', sha: 'aaaaaaaaaaaa', dirty: false, builtAt: '2026-11-10T10:00:00.000Z' };
const NEW: BuildStamp = { version: '0.0.1', sha: 'bbbbbbbbbbbb', dirty: false, builtAt: '2026-11-12T10:00:00.000Z' };
const SRC = '/h/.local/share/stack';
const BUILD = `${SRC}/desktop/out/Stack-darwin-arm64/Stack.app`;
const APP = '/Applications/Stack.app';
const OK: UpdateResult = { ok: true, step: 'done', at: '2026-11-12T11:00:00Z' };

function fake(o: { installed?: BuildStamp | null; available?: BuildStamp | null; builtBecomes?: BuildStamp; running?: boolean; platform?: string; failStep?: number; result?: UpdateResult; cfg?: Record<string, unknown>; last?: string } = {}) {
  const ran: [string, string[], string][] = []; const jobs: HelperJob[] = [];
  let available = o.available === undefined ? NEW : o.available;
  const deps: AppCliDeps = {
    platform: o.platform ?? 'darwin', home: '/h', env: {},
    run: (cmd, args, cwd) => { ran.push([cmd, args, cwd]); if (o.failStep === ran.length) return 1; if (ran.length === BUILD_STEPS.length && o.builtBecomes) available = o.builtBecomes; return 0; },
    readText: (p) => {
      if (p === manifestPath(APP)) return o.installed === null ? null : JSON.stringify({ stackBuild: o.installed ?? OLD });
      if (p === manifestPath(BUILD)) return available ? JSON.stringify({ stackBuild: available }) : null;
      if (p === '/h/.stack/update-result.json') return o.last ?? null;
      return null;
    },
    exists: (p) => (p === BUILD ? available !== null : false),
    isRunning: () => o.running ?? false,
    runHelper: (j) => { jobs.push(j); return o.result ?? OK; },
    readConfig: () => o.cfg ?? { repo: '/r' },
  };
  return { deps, ran, jobs };
}

describe('stack app status', () => {
  // @req FR:devops-installer/status.@cli @req FR:devops-installer/status.show @req FR:devops-installer/$install-result @req FR:devops-installer/install.output @req FR:devops-installer/update.output
  it('shows installed, available, ready, and mode; changes nothing', async () => {
    const f = fake({ last: '{"ok":false,"step":"launch","at":"2026-11-12T09:00:00Z"}' });
    const r = await appCmd('status', {}, f.deps);
    expect(r.code).toBe(0);
    expect(r.json).toMatchObject({ ok: true, action: 'status', installed: OLD, available: NEW, ready: true, mode: 'on-quit', outcome: 'checked', last: { ok: false, step: 'launch' } });
    expect(r.text).toContain('last update: failed at launch (2026-11-12T09:00:00Z)');
    expect(r.text).toContain('installed: aaaaaaaaaaaa');
    expect(r.text).toContain('available: bbbbbbbbbbbb');
    expect(f.ran).toEqual([]); expect(f.jobs).toEqual([]);
  });
});

describe('stack app update', () => {
  // @req FR:devops-installer/update.check
  it('--check builds nothing, exits 0 when ready and 4 when not', async () => {
    const f = fake();
    expect((await appCmd('update', { check: true }, f.deps)).code).toBe(0);
    expect((await appCmd('update', { check: true }, fake({ available: OLD }).deps)).code).toBe(4);
    expect(f.ran).toEqual([]); expect(f.jobs).toEqual([]);
  });
  // @req FR:devops-installer/build.steps @req FR:devops-installer/update.build @req FR:devops-installer/update.closed
  it('builds in the source, then swaps at once with no launch when the app is closed', async () => {
    const f = fake({ available: OLD, builtBecomes: NEW });
    const r = await appCmd('update', {}, f.deps);
    expect(f.ran).toEqual([
      ['git', ['pull', '--ff-only'], SRC], ['pnpm', ['install', '--frozen-lockfile'], SRC], ['pnpm', ['build'], SRC], ['pnpm', ['desktop:package'], SRC],
    ]);
    expect(f.jobs).toEqual([{ source: BUILD, target: APP, stateDir: '/h/.stack', relaunch: false, quit: false, sha: 'bbbbbbbbbbbb' }]);
    expect(r).toMatchObject({ code: 0, json: { outcome: 'installed', result: OK } });
  });
  // @req FR:devops-installer/build.steps
  it('stops at the first failed build step and installs nothing', async () => {
    const f = fake({ failStep: 2 });
    const r = await appCmd('update', {}, f.deps);
    expect(r.code).toBe(1);
    expect(r.text).toBe('Build failed: pnpm install --frozen-lockfile');
    expect(f.ran).toHaveLength(2); expect(f.jobs).toEqual([]);
  });
  // @req FR:devops-installer/update.current
  it('says up to date and changes nothing when the build is not newer', async () => {
    const f = fake({ available: OLD });
    const r = await appCmd('update', { 'no-build': true }, f.deps);
    expect(r).toMatchObject({ code: 4, text: 'Up to date (aaaaaaaaaaaa)', json: { outcome: 'current' } });
    expect(f.ran).toEqual([]); expect(f.jobs).toEqual([]);
  });
  // @req FR:devops-installer/update.running @req FR:devops-installer/mode.never-launch
  it('never quits a running app; says how the update lands for each mode', async () => {
    const words: Record<string, string> = {
      'on-quit': 'Update ready: installs when you quit Stack', ask: 'Update ready: select Restart in Stack',
      'auto-idle': 'Update ready: installs when Stack is idle', off: 'Update built; updates are off. Run: stack app update --install',
    };
    for (const [mode, text] of Object.entries(words)) {
      const f = fake({ running: true, cfg: { repo: '/r', update: { mode } } });
      const r = await appCmd('update', { 'no-build': true }, f.deps);
      expect(r).toMatchObject({ code: 0, text, json: { outcome: 'staged', mode } });
      expect(f.jobs).toEqual([]);
    }
  });
  // @req FR:devops-installer/update.install
  it('--install quits a running app, swaps, and relaunches', async () => {
    const f = fake({ running: true });
    const r = await appCmd('update', { install: true, 'no-build': true }, f.deps);
    expect(f.jobs).toEqual([{ source: BUILD, target: APP, stateDir: '/h/.stack', relaunch: true, quit: true, sha: 'bbbbbbbbbbbb' }]);
    expect(r).toMatchObject({ code: 0, json: { outcome: 'installed' } });
  });
  // @req FR:devops-installer/swap.result
  it('a failed helper run is exit 1 with the step and the log path', async () => {
    const f = fake({ result: { ok: false, step: 'launch', at: 'x' } });
    const r = await appCmd('update', { 'no-build': true }, f.deps);
    expect(r.code).toBe(1);
    expect(r.text).toBe('Update failed at launch; rolled back. Log: /h/.stack/update.log');
  });
  it('rejects --check with --install', async () => {
    await expect(appCmd('update', { check: true, install: true }, fake().deps)).rejects.toThrow('Use --check or --install, not both');
  });
});

describe('stack app install', () => {
  // @req FR:devops-installer/install.@cli @req FR:devops-installer/install.build @req FR:devops-installer/install.place
  it('builds, then places and launches the app, even when the same build is installed', async () => {
    const f = fake({ available: OLD });
    const r = await appCmd('install', {}, f.deps);
    expect(f.ran).toHaveLength(4);
    expect(f.jobs).toEqual([{ source: BUILD, target: APP, stateDir: '/h/.stack', relaunch: true, quit: true, sha: 'aaaaaaaaaaaa' }]);
    expect(r).toMatchObject({ code: 0, json: { action: 'install', outcome: 'installed' } });
  });
  // @req FR:devops-installer/install.nobuild
  it('with no build fails and changes nothing', async () => {
    const f = fake({ available: null });
    const r = await appCmd('install', { 'no-build': true }, f.deps);
    expect(r).toMatchObject({ code: 1, text: `No build at ${BUILD}. Run: stack app install` });
    expect(f.jobs).toEqual([]);
  });
  // @req FR:devops-installer/install.config
  it('says first launch opens setup when no repo is configured', async () => {
    const r = await appCmd('install', { 'no-build': true }, fake({ cfg: {} }).deps);
    expect(r.text).toContain('First launch opens setup');
  });
  // @req FR:devops-installer/install.mac
  it('is macOS only, except status', async () => {
    const f = fake({ platform: 'linux' });
    for (const a of ['install', 'update']) expect(await appCmd(a, {}, f.deps)).toMatchObject({ code: 1, text: 'Stack.app is macOS only' });
    expect((await appCmd('status', {}, f.deps)).code).toBe(0);
    expect((await appCmd('update', { check: true }, f.deps)).code).toBe(0);
  });
  // @req FR:devops-installer/source.local
  it('--source picks another checkout', async () => {
    const f = fake();
    await appCmd('status', { source: '/elsewhere' }, f.deps);
    const r = await appCmd('install', { source: '/elsewhere', 'no-build': true }, f.deps);
    expect(r.text).toBe('No build at /elsewhere/desktop/out/Stack-darwin-arm64/Stack.app. Run: stack app install');
  });
  it('rejects an unknown action', async () => {
    await expect(appCmd('nope', {}, fake().deps)).rejects.toThrow('Use: stack app install');
  });
});

describe('stack app wiring', () => {
  // @req FR:devops-installer/install.@cli @req FR:devops-installer/update.@cli
  it('the CLI knows the app command and its flags', async () => {
    const out: string[] = [];
    const code = await run(['app', 'update', '--check', '--install', '--json'], { out: (s) => out.push(s), err: (s) => out.push(s) });
    expect(code).toBe(2);
    expect(out.join('')).toContain('Use --check or --install, not both');
  });
});
