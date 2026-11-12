import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  bundleOf, buildPath, createAppUpdater, helperEnv, isNewer, manifestPath, noteUpdateResult, parseResult, parseStamp, readSettings, sourceDir,
  UpdateRefused, type BuildStamp, type HelperJob, type UpdateSettings, type UpdaterDeps,
} from '../../src/core/app-update';
import { ReportStore } from '../../src/core/reports';

const OLD: BuildStamp = { version: '0.0.1', sha: 'aaaaaaaaaaaa', dirty: false, builtAt: '2026-11-10T10:00:00.000Z' };
const NEW: BuildStamp = { version: '0.0.1', sha: 'bbbbbbbbbbbb', dirty: false, builtAt: '2026-11-12T10:00:00.000Z' };
const manifest = (s: BuildStamp | null) => JSON.stringify({ name: 'stack-desktop', ...(s ? { stackBuild: s } : {}) });

describe('build stamp', () => {
  // @req FR:devops-installer/stamp.read @req FR:devops-installer/$build-stamp
  it('reads a stamp from a manifest; missing, broken, or unstamped reads as none', () => {
    expect(parseStamp(manifest(NEW))).toEqual(NEW);
    expect(parseStamp(null)).toBeNull();
    expect(parseStamp('{not json')).toBeNull();
    expect(parseStamp(manifest(null))).toBeNull();
    expect(parseStamp(JSON.stringify({ stackBuild: { sha: 1 } }))).toBeNull();
    expect(manifestPath('/A/Stack.app')).toBe('/A/Stack.app/Contents/Resources/app/package.json');
  });
  // @req FR:devops-installer/stamp.newer
  it('is newer only with a different sha and a later build time, or when the other has no stamp', () => {
    expect(isNewer(NEW, OLD)).toBe(true);
    expect(isNewer(OLD, NEW)).toBe(false);
    expect(isNewer(NEW, NEW)).toBe(false);
    expect(isNewer({ ...NEW, builtAt: '2026-11-13T00:00:00.000Z' }, NEW)).toBe(false);
    expect(isNewer(NEW, null)).toBe(true);
    expect(isNewer(null, OLD)).toBe(false);
    // A rebuild with uncommitted changes on the same commit is newer.
    expect(isNewer({ ...OLD, dirty: true, builtAt: NEW.builtAt }, OLD)).toBe(true);
    expect(isNewer({ ...OLD, builtAt: NEW.builtAt }, { ...OLD, dirty: true })).toBe(true);
  });
});

describe('source', () => {
  // @req FR:devops-installer/source.local
  it('is STACK_SOURCE, else ~/.local/share/stack; its build is under desktop/out', () => {
    expect(sourceDir({}, '/h')).toBe('/h/.local/share/stack');
    expect(sourceDir({ STACK_SOURCE: '/src' }, '/h')).toBe('/src');
    expect(buildPath('/src')).toBe('/src/desktop/out/Stack-darwin-arm64/Stack.app');
  });
  // @req FR:devops-installer/quit.spawn
  it('finds the bundle the app runs from, or none outside a bundle', () => {
    expect(bundleOf('/Applications/Stack.app/Contents/MacOS/Stack')).toBe('/Applications/Stack.app');
    expect(bundleOf('/repo/desktop/node_modules/electron/dist/Electron')).toBeNull();
  });
});

describe('settings', () => {
  // @req FR:devops-installer/mode.setting @req FR:devops-installer/mode.idle-minutes @req FR:devops-installer/$update-mode
  it('reads update.mode and idleMinutes; missing or bad values fall back to on-quit and 30', () => {
    expect(readSettings({})).toEqual({ mode: 'on-quit', idleMinutes: 30 });
    expect(readSettings({ update: { mode: 'ask' } })).toEqual({ mode: 'ask', idleMinutes: 30 });
    expect(readSettings({ update: { mode: 'auto-idle', idleMinutes: 10 } })).toEqual({ mode: 'auto-idle', idleMinutes: 10 });
    expect(readSettings({ update: { mode: 'nope', idleMinutes: 2 } })).toEqual({ mode: 'on-quit', idleMinutes: 30 });
    expect(readSettings({ update: 'off' })).toEqual({ mode: 'on-quit', idleMinutes: 30 });
  });
  // @req FR:devops-installer/$update-result
  it('reads the helper result file', () => {
    expect(parseResult('{"ok":false,"step":"launch","at":"2026-11-12T10:00:00Z"}')).toEqual({ ok: false, step: 'launch', at: '2026-11-12T10:00:00Z' });
    expect(parseResult(null)).toBeNull();
    expect(parseResult('{"ok":"yes"}')).toBeNull();
  });
});

describe('helper env', () => {
  // @req FR:devops-installer/swap.@script
  it('passes every input as an environment variable', () => {
    const env = helperEnv({ source: '/s/Stack.app', target: '/A/Stack.app', stateDir: '/h/.stack', pid: 42, relaunch: true, quit: false });
    expect(helperEnv({ source: 's', target: 't', stateDir: '/x', relaunch: false, quit: false, sha: 'abc' }).STACK_UPDATE_SHA).toBe('abc');
    expect(env).toMatchObject({
      STACK_UPDATE_SOURCE: '/s/Stack.app', STACK_UPDATE_TARGET: '/A/Stack.app', STACK_UPDATE_PID: '42', STACK_UPDATE_RELAUNCH: '1', STACK_UPDATE_QUIT: '0',
      STACK_UPDATE_LOG: '/h/.stack/update.log', STACK_UPDATE_RESULT: '/h/.stack/update-result.json',
    });
    expect(helperEnv({ source: 's', target: 't', stateDir: '/x', relaunch: false, quit: true }).STACK_UPDATE_PID).toBe('');
  });
});

function updater(o: { running?: BuildStamp | null; available?: BuildStamp | null; target?: string | null; settings?: Partial<UpdateSettings>; result?: string | null; spawnFails?: boolean } = {}) {
  const spawned: HelperJob[] = []; const logs: string[] = []; let quits = 0;
  let settings: UpdateSettings = { mode: 'on-quit', idleMinutes: 30, ...o.settings };
  const files: Record<string, string | null> = {
    [manifestPath('/src/desktop/out/Stack-darwin-arm64/Stack.app')]: o.available === undefined ? manifest(NEW) : o.available ? manifest(o.available) : null,
    '/h/.stack/update-result.json': o.result ?? null,
  };
  const deps: UpdaterDeps = {
    running: o.running === undefined ? OLD : o.running,
    target: o.target === undefined ? '/Applications/Stack.app' : o.target,
    source: '/src/desktop/out/Stack-darwin-arm64/Stack.app',
    stateDir: '/h/.stack', pid: 4242,
    readText: (p) => files[p] ?? null,
    settings: () => settings,
    saveSettings: (s) => { settings = { ...settings, ...s }; },
    spawnHelper: (j) => { if (o.spawnFails) throw new Error('spawn EACCES'); spawned.push(j); },
    quit: () => { quits++; },
    log: (l) => logs.push(l),
  };
  return { u: createAppUpdater(deps), spawned, logs, quits: () => quits, settings: () => settings };
}

describe('updater state', () => {
  // @req FR:devops-installer/version.get @req FR:devops-installer/version.cheap @req FR:devops-installer/$version-state
  it('answers running, available, ready, mode, canRestart, and the last result', () => {
    const { u } = updater({ result: '{"ok":true,"step":"done","at":"2026-11-12T09:00:00Z"}' });
    expect(u.state()).toEqual({ running: OLD, available: NEW, ready: true, mode: 'on-quit', idleMinutes: 30, canRestart: true, last: { ok: true, step: 'done', at: '2026-11-12T09:00:00Z' } });
  });
  it('is not ready when the build is the same or missing, and cannot restart outside a bundle', () => {
    expect(updater({ available: OLD }).u.state().ready).toBe(false);
    expect(updater({ available: null }).u.state()).toMatchObject({ available: null, ready: false });
    expect(updater({ target: null }).u.state().canRestart).toBe(false);
  });
  // @req FR:devops-installer/version.mode
  it('saves the mode and idle minutes', () => {
    const t = updater();
    expect(t.u.setMode('auto-idle', 15)).toMatchObject({ mode: 'auto-idle', idleMinutes: 15 });
    expect(t.settings()).toEqual({ mode: 'auto-idle', idleMinutes: 15 });
  });
});

describe('restart now', () => {
  // @req FR:devops-installer/restart.spawn
  it('starts the helper with its pid and relaunch on, then quits', () => {
    const t = updater({ settings: { mode: 'ask' } });
    t.u.restart();
    expect(t.spawned).toEqual([{ source: '/src/desktop/out/Stack-darwin-arm64/Stack.app', target: '/Applications/Stack.app', stateDir: '/h/.stack', pid: 4242, relaunch: true, quit: false, sha: 'bbbbbbbbbbbb' }]);
    expect(t.quits()).toBe(1);
  });
  // @req FR:devops-installer/restart.ready
  it('refuses with no update ready or outside a bundle', () => {
    expect(() => updater({ available: OLD }).u.restart()).toThrow(new UpdateRefused('No update ready'));
    expect(() => updater({ target: null }).u.restart()).toThrow(new UpdateRefused('Restart is not available on this host'));
  });
});

describe('install on quit', () => {
  // @req FR:devops-installer/quit.spawn @req FR:devops-installer/quit.next
  it('in on-quit mode with an update ready, starts the helper with no relaunch', () => {
    const t = updater();
    expect(t.u.onQuit()).toBe(true);
    expect(t.spawned).toEqual([expect.objectContaining({ pid: 4242, relaunch: false, quit: false })]);
    expect(t.quits()).toBe(0);
  });
  // @req FR:devops-installer/quit.spawn
  it('does nothing in other modes, with nothing ready, or outside a bundle', () => {
    for (const mode of ['ask', 'auto-idle', 'off'] as const) { const t = updater({ settings: { mode } }); expect(t.u.onQuit()).toBe(false); expect(t.spawned).toEqual([]); }
    expect(updater({ available: OLD }).u.onQuit()).toBe(false);
    expect(updater({ target: null }).u.onQuit()).toBe(false);
  });
  // @req FR:devops-installer/quit.spawn @req FR:devops-installer/restart.spawn
  it('starts one helper only: a restart already in flight wins over the quit hook', () => {
    const t = updater();
    t.u.restart();
    expect(t.u.onQuit()).toBe(false);
    expect(t.spawned).toHaveLength(1);
  });
  // @req FR:devops-installer/quit.fast
  it('a helper that fails to start logs and never throws', () => {
    const t = updater({ spawnFails: true });
    expect(t.u.onQuit()).toBe(false);
    expect(t.logs).toEqual(['update: spawn EACCES']);
  });
});

describe('restart when idle', () => {
  // @req FR:devops-installer/idle.check
  it('restarts in auto-idle mode when idle long enough and the window is not focused', () => {
    const t = updater({ settings: { mode: 'auto-idle', idleMinutes: 10 } });
    expect(t.u.idleCheck(599, false)).toBe(false);
    expect(t.u.idleCheck(600, true)).toBe(false);
    expect(t.spawned).toEqual([]);
    expect(t.u.idleCheck(600, false)).toBe(true);
    expect(t.spawned).toEqual([expect.objectContaining({ relaunch: true })]);
    expect(t.quits()).toBe(1);
  });
  // @req FR:devops-installer/idle.check @req FR:devops-installer/mode.never-launch
  it('never restarts in other modes or with nothing ready', () => {
    for (const mode of ['on-quit', 'ask', 'off'] as const) expect(updater({ settings: { mode } }).u.idleCheck(99_999, false)).toBe(false);
    expect(updater({ settings: { mode: 'auto-idle' }, available: OLD }).u.idleCheck(99_999, false)).toBe(false);
  });
});

describe('failure note', () => {
  const store = () => new ReportStore(mkdtempSync(join(tmpdir(), 'stack-upd-')));
  // @req FR:devops-installer/fail.note
  it('puts a go-do ask in Needs you when the last update failed', async () => {
    const r = store();
    await noteUpdateResult({ ok: false, step: 'launch', at: '2026-11-12T10:00:00Z' }, r);
    const rep = r.list().find((x) => x.agent === 'installer');
    expect(rep?.project).toBe('stack');
    expect(rep?.asks).toEqual([expect.objectContaining({ id: 'update-failed', kind: 'go-do', ask: 'Stack update failed at launch and was rolled back. See ~/.stack/update.log' })]);
  });
  // @req FR:devops-installer/fail.clear
  it('clears the note after a good update, and does nothing with no result', async () => {
    const r = store();
    await noteUpdateResult({ ok: false, step: 'swap', at: 'x' }, r);
    await noteUpdateResult({ ok: true, step: 'done', at: 'y' }, r);
    expect(r.list().find((x) => x.agent === 'installer')?.asks).toEqual([]);
    const empty = store();
    await noteUpdateResult(null, empty);
    expect(empty.list()).toEqual([]);
  });
});
