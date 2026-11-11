import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { hostPlan, startHost, type HostDeps } from '../src/host';
import { readHostFile, type ReportStore } from '../../src/core/reports';

const tmp = () => mkdtempSync(join(tmpdir(), 'stack-desktop-'));

function webDir(): string {
  const d = join(tmp(), 'web/dist');
  mkdirSync(d, { recursive: true });
  writeFileSync(join(d, 'index.html'), '<!doctype html>');
  return d;
}

function deps(over: Partial<HostDeps> = {}) {
  const calls: Record<string, unknown[]> = { startWeb: [], prepareLive: [], prepareDemo: [], resolveRepo: [], storage: [] };
  let closes = 0;
  const d: HostDeps = {
    webDir: webDir(),
    resolveRepo: (spec, cache) => { calls.resolveRepo.push([spec, cache]); return `/resolved${spec}`; },
    prepareLive: (repo, branch, remote) => { calls.prepareLive.push([repo, branch, remote]); return { dir: repo, branch: branch ?? 'main', remote }; },
    prepareDemo: (repo, dest) => { calls.prepareDemo.push([repo, dest]); },
    storage: (dir, o) => { calls.storage.push([dir, o]); return { dir } as never; },
    startWeb: async (o) => { calls.startWeb.push(o); return { url: 'http://localhost:51234', close: async () => { closes++; } }; },
    log: () => { /* quiet */ },
    ...over,
  };
  return { d, calls, closes: () => closes };
}

describe('hostPlan', () => {
  // @req FR:desktop-shell/host.plan
  it('reads the repo from env first, then user config', () => {
    expect(hostPlan({ cfg: { repo: '/cfg' }, env: { STACK_REPO: '/env' }, home: '/h' }).repo).toBe('/env');
    expect(hostPlan({ cfg: { repo: '/cfg' }, env: { STACK_DIR: '/dir' }, home: '/h' }).repo).toBe('/dir');
    expect(hostPlan({ cfg: { repo: '/cfg' }, env: {}, home: '/h' }).repo).toBe('/cfg');
    expect(hostPlan({ cfg: { dir: '/d' }, env: {}, home: '/h' }).repo).toBe('/d');
  });
  // @req FR:desktop-shell/host.plan
  it('fails without a repo', () => {
    expect(() => hostPlan({ cfg: {}, env: {}, home: '/h' })).toThrow('No content repo. Set "repo" in ~/.config/stack/config.json');
  });
  // @req FR:desktop-shell/host.plan
  it('takes live mode, branch, remote and batch from user config', () => {
    const p = hostPlan({ cfg: { repo: '/r', mode: 'live', branch: 'main', remote: 'up', batch: 0 }, env: {}, home: '/h' });
    expect(p).toMatchObject({ repo: '/r', live: true, batchMinutes: 0, branch: 'main', remote: 'up', home: '/h' });
    expect(hostPlan({ cfg: { repo: '/r' }, env: {}, home: '/h' })).toMatchObject({ live: false, batchMinutes: 5 });
  });
  // @req FR:desktop-shell/host.plan
  it('rejects a bad batch', () => {
    expect(() => hostPlan({ cfg: { repo: '/r', batch: -1 }, env: {}, home: '/h' })).toThrow('batch');
    expect(() => hostPlan({ cfg: { repo: '/r', batch: 'x' as unknown as number }, env: {}, home: '/h' })).toThrow('batch');
  });
});

describe('startHost', () => {
  // @req FR:desktop-shell/host.start
  it('live: prepares the checkout, uses batched storage, and asks for a free loopback port', async () => {
    const { d, calls } = deps();
    const h = await startHost({ repo: '/r', live: true, batchMinutes: 2, branch: 'main', remote: 'origin', home: '/h' }, d);
    expect(calls.resolveRepo[0]).toEqual(['/r', '/h/.config/stack/clones']);
    expect(calls.prepareLive[0]).toEqual(['/resolved/r', 'main', 'origin']);
    expect(calls.storage[0]).toMatchObject(['/resolved/r', { idleMs: 120_000, remote: 'origin', branch: 'main' }]);
    const o = calls.startWeb[0] as { port: number; dir: string; info: unknown; webDir: string };
    expect(o.port).toBe(0);
    expect(o.dir).toBe('/resolved/r');
    expect(o.info).toEqual({ mode: 'live', repo: '/resolved/r', branch: 'main' });
    expect(o.webDir).toBe(d.webDir);
    expect(h.url).toBe('http://127.0.0.1:51234');
  });
  // @req FR:desktop-shell/host.start
  it('demo: copies into ~/.config/stack/demo and never prepares live', async () => {
    const { d, calls } = deps();
    const h = await startHost({ repo: '/r', live: false, batchMinutes: 5, home: '/h' }, d);
    expect(calls.prepareDemo[0]).toEqual(['/resolved/r', '/h/.config/stack/demo']);
    expect(calls.prepareLive).toHaveLength(0);
    expect(calls.storage).toHaveLength(0);
    expect((calls.startWeb[0] as { dir: string }).dir).toBe('/h/.config/stack/demo');
    expect(h.url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });
  // @req FR:desktop-shell/host.webdir
  it('fails when the web app is not built', async () => {
    const { d } = deps({ webDir: join(tmp(), 'missing') });
    await expect(startHost({ repo: '/r', live: false, batchMinutes: 5, home: '/h' }, d)).rejects.toThrow('Web app not built. Run: pnpm build');
  });
  // @req FR:status-ingest/host.file @req FR:status-ingest/api.put
  it('serves the live report store and writes host.json in the Stack home; close removes it', async () => {
    const state = tmp();
    const { d, calls } = deps({ stateDir: state });
    const h = await startHost({ repo: '/r', live: false, batchMinutes: 5, home: '/h' }, d);
    expect((calls.startWeb[0] as { reports: ReportStore }).reports.dir).toBe(state);
    expect(readHostFile(state)).toEqual({ url: h.url, pid: process.pid });
    await h.close();
    expect(existsSync(join(state, 'host.json'))).toBe(false);
  });
  // @req FR:desktop-shell/host.stop
  it('closes the host once', async () => {
    const { d, closes } = deps();
    const h = await startHost({ repo: '/r', live: false, batchMinutes: 5, home: '/h' }, d);
    await h.close();
    await h.close();
    expect(closes()).toBe(1);
  });
});
