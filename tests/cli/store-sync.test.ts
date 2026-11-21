/** The store sync in the host (`startWeb`) and in `stack doctor`, over real temp git repos. */
import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { startWeb } from '../../src/cli/web';
import { run } from '../../src/cli/run';
import { GitStorage } from '../../src/core/storage-git';
import { cleanLiveRepos, commit, git, LIVE_OPTS, liveRepos, pushMain } from '../helpers/live-repo';

jest.setTimeout(30000);
afterAll(cleanLiveRepos);
const quiet = { watch: { watchFn: (() => ({ on() { return this; }, close() { /* nothing to release */ } })) as unknown as typeof import('fs').watch } };
const webDir = () => { const d = mkdtempSync(join(tmpdir(), 'stack-web-')); writeFileSync(join(d, 'index.html'), '<html>app</html>'); return d; };
const off = { delivery: false as const, agents: false as const, inventory: false as const, connect: false as const };
const LIVE = { mode: 'live' as const, repo: 'x', branch: 'stack/live' };

/** Host options whose `onState` resolves the first state; the test then reads it back through /api/sync. */
function firstState() {
  let done: (v: unknown) => void = () => undefined;
  const seen = new Promise((ok) => { done = ok; });
  return { storeSync: { intervalMs: 60_000, onState: done }, seen };
}
const driftOf = async (url: string) => ((await (await fetch(`${url}/api/sync`)).json()) as { drift?: Record<string, unknown> }).drift;

describe('startWeb store sync', () => {
  // @req FR:store-sync/host.wire @req FR:store-sync/host.api
  it('merges main on start and answers the state on /api/sync', async () => {
    const r = liveRepos();
    pushMain(r, 'tasks/b.md', 'B-main\n');
    const w = firstState();
    const s = await startWeb({ ...quiet, ...off, dir: r.live, port: 0, webDir: webDir(), info: LIVE, storage: new GitStorage(r.live, LIVE_OPTS), storeSync: w.storeSync });
    try {
      await w.seen;
      expect(await driftOf(s.url)).toMatchObject({ state: 'merged', behind: 0 });
      expect(readFileSync(join(r.live, 'tasks/b.md'), 'utf8')).toBe('B-main\n');
    } finally { await s.close(); }
  });

  // @req FR:store-sync/merge.check.conflict @req FR:store-sync/host.api
  it('a conflict: tree unchanged, and /api/sync carries the banner state', async () => {
    const r = liveRepos();
    commit(r.live, 'tasks/b.md', 'B-live\n');
    pushMain(r, 'tasks/b.md', 'B-main\n');
    const was = git(r.live, 'rev-parse', 'HEAD');
    const w = firstState();
    const s = await startWeb({ ...quiet, ...off, dir: r.live, port: 0, webDir: webDir(), info: LIVE, storage: new GitStorage(r.live, LIVE_OPTS), storeSync: w.storeSync });
    try {
      await w.seen;
      expect(await driftOf(s.url)).toMatchObject({ state: 'conflict', behind: 1, files: ['tasks/b.md'], base: 'origin/main' });
      expect(git(r.live, 'rev-parse', 'HEAD')).toBe(was);
      expect(git(r.live, 'status', '--porcelain')).toBe('');
    } finally { await s.close(); }
  });

  // @req FR:store-sync/host.wire.demo
  it('a demo copy runs no store sync', async () => {
    const r = liveRepos();
    pushMain(r, 'tasks/b.md', 'B-main\n');
    const s = await startWeb({ ...quiet, ...off, dir: r.live, port: 0, webDir: webDir(), info: { mode: 'demo', repo: 'x', branch: 'main' }, storage: new GitStorage(r.live, LIVE_OPTS), storeSync: { intervalMs: 60_000 } });
    try {
      expect(await (await fetch(`${s.url}/api/sync`)).json()).not.toHaveProperty('drift');
      expect(readFileSync(join(r.live, 'tasks/b.md'), 'utf8')).toBe('B0\n');
    } finally { await s.close(); }
  });
});

describe('stack doctor', () => {
  const doctor = async (dir: string, ...a: string[]) => {
    let out = ''; let err = '';
    const code = await run(['doctor', '--dir', dir, ...a], { out: (s) => { out += s; }, err: (s) => { err += s; } });
    return { code, out, err };
  };
  // @req FR:store-sync/doctor.@cli @req FR:store-sync/doctor.check @req FR:store-sync/doctor.text @req FR:store-sync/doctor.exit @req FR:store-sync/doctor.readonly
  it('names the drift and the conflicting files, exits 1, and merges nothing', async () => {
    const r = liveRepos();
    commit(r.live, 'tasks/b.md', 'B-live\n');
    pushMain(r, 'tasks/b.md', 'B-main\n'); pushMain(r, 'tasks/c.md', 'C\n');
    const was = git(r.live, 'rev-parse', 'HEAD');
    const t = await doctor(r.live);
    expect(t.code).toBe(1);
    expect(t.out).toBe('store: conflict (2 behind origin/main)\n  Conflicts: tasks/b.md\n');
    expect(git(r.live, 'rev-parse', 'HEAD')).toBe(was);
    const j = await doctor(r.live, '--json');
    expect(j.code).toBe(1);
    expect(JSON.parse(j.out)).toMatchObject({ store: { state: 'conflict', behind: 2, files: ['tasks/b.md'] } });
  });
  // @req FR:store-sync/doctor.text @req FR:store-sync/doctor.exit
  it('in sync: ok, exit 0; on main: skipped', async () => {
    const r = liveRepos();
    expect(await doctor(r.live)).toMatchObject({ code: 0, out: 'store: ok (in sync with origin/main)\n' });
    expect(await doctor(r.main)).toMatchObject({ code: 0, out: 'store: skipped (on main)\n' });
  });
  // @req FR:store-sync/doctor.text
  it('behind with a clean merge: exit 0', async () => {
    const r = liveRepos();
    pushMain(r, 'tasks/c.md', 'C\n');
    expect(await doctor(r.live)).toMatchObject({ code: 0, out: 'store: behind (1 behind origin/main)\n' });
  });
});
