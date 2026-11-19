/** `stack web`: a QM plan write tells open pages (`kinds: ['qm']`). Every store lives in a temp dir, never the real ~/.stack. */
import http from 'http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { prepareDemo, startWeb } from '../../src/cli/web';
import { QmStore } from '../../src/core/qm-plan';
import { ReportStore } from '../../src/core/reports';
import { PriStore } from '../../src/core/pris';
import { PrPriorityStore } from '../../src/core/pr-priority';

Object.assign(process.env, { GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
jest.setTimeout(30000);
const quiet = { watch: { watchFn: (() => ({ on() { return this; }, close() { /* nothing to release */ } })) as unknown as typeof import('fs').watch } };
const tmp = () => mkdtempSync(join(tmpdir(), 'stack-web-qm-'));
const PLAN = { version: 1, asOf: '2026-11-18T19:00:00Z', projects: [{ project: 'Stack', agent: { name: 'stack-architect' }, tasks: [], weeklyTokens: null, preAckMin: null, postReviewMin: null }] };
/** The host's store, polling fast so the test does not wait the default 2 s. */
class FastQm extends QmStore {
  stopped = 0;
  watch(fn: (mtimeMs: number) => void): () => void { const stop = super.watch(fn, 20); return () => { this.stopped++; stop(); }; }
}
const QM_EVENT = /event: change\ndata: \{"rev":\d+,"kinds":\["qm"\]\}/g;

async function host() {
  const src = tmp(); mkdirSync(join(src, 'tasks')); writeFileSync(join(src, 'tasks/alpha.md'), '# Alpha\n\n## Active\n\n- [ ] Write the plan\n');
  const dest = join(tmp(), 'demo'); prepareDemo(src, dest);
  const web = tmp(); writeFileSync(join(web, 'index.html'), '<html>app</html>');
  const dir = tmp(); const qm = new FastQm(dir);
  const s = await startWeb({ ...quiet, dir: dest, port: 0, webDir: web, reports: new ReportStore(tmp()), pris: new PriStore(tmp()), prPriority: new PrPriorityStore(tmp()), qm, inventory: false, agents: false });
  let seen = '';
  let wake: () => void = () => {};
  const until = (re: RegExp) => new Promise<void>((ok) => { wake = () => { if (re.test(seen)) ok(); }; wake(); });
  const req = http.get(`${s.url}/events`, (r) => { r.on('data', (c) => { seen += String(c); wake(); }); });
  await until(/event: hello/);
  /** Waits until the file poll has seen the write (Node shares one stat poll per file), then sends a pris change as an end marker: any extra qm event was sent before it. */
  const drained = async (heard: Promise<void>) => {
    await heard;
    await fetch(`${s.url}/api/pris`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rev: 0, pris: [{ id: 'p1', title: 'Ship', status: 'active', items: [], backlog: [], weekly: [] }] }) });
    await until(/"kinds":\["pris"\]/);
  };
  const polled = () => new Promise<void>((ok) => { const off = new QmStore(dir).watch(() => { off(); ok(); }, 20); });
  return { s, dir, qm, req, until, drained, polled, count: () => (seen.match(QM_EVENT) ?? []).length };
}

describe('startWeb QM plan', () => {
  // @req FR:qm-plan/live.event @req FR:qm-plan/live.event.stop
  it('a CLI-style write (another process) sends one qm change; close() stops the watch', async () => {
    const h = await host();
    try {
      const heard = h.polled();
      new QmStore(h.dir).put(PLAN); // what `stack qm put` does: a separate store, no in-process listener
      await h.until(/"kinds":\["qm"\]/);
      await h.drained(heard);
      expect(h.count()).toBe(1);
      h.req.destroy();
    } finally { await h.s.close(); }
    expect(h.qm.stopped).toBe(1);
  });

  // @req FR:qm-plan/live.event
  it('a host write sends one qm change, not a second one from the file poll', async () => {
    const h = await host();
    try {
      const heard = h.polled();
      h.qm.put(PLAN);
      await h.until(/"kinds":\["qm"\]/);
      await h.drained(heard);
      expect(h.count()).toBe(1);
      h.req.destroy();
    } finally { await h.s.close(); }
  });
});
