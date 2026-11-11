/** @req FR:status-ingest/cli.report @req FR:status-ingest/cli.errors */
import { createServer } from 'http';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PassThrough } from 'stream';
import { readStdin, run, webReportStore } from '../../src/cli/run';
import { writeHostFile } from '../../src/core/reports';

const tmp = (p: string) => mkdtempSync(join(tmpdir(), p));
let home: string;
let cwd: string;
beforeEach(() => { home = tmp('stack-home-'); cwd = tmp('stack-norepo-'); process.env.STACK_HOME = home; });
afterAll(() => { delete process.env.STACK_HOME; });

async function stack(stdin: string | null, ...args: string[]) {
  let out = '', err = '';
  // --dir points at a folder that is not a repo: report never needs one.
  const code = await run([...args, '--dir', cwd], { out: (s) => { out += s; }, err: (s) => { err += s; }, in: async () => stdin });
  return { code, out, err };
}
const REPORT = {
  top: [{ text: 'Ship status ingest' }],
  asks: [{ id: 'pr-12', ask: 'Approve PR 12', link: 'https://github.com/o/r/pull/12', by: '2026-11-12T17:00:00Z', kind: 'approve' }],
  blockers: [], progress: [{ text: 'Spec done' }],
};
const stored = () => JSON.parse(readFileSync(join(home, 'reports.json'), 'utf8'));

describe('stack report', () => {
  // @req FR:status-ingest/cli.direct
  it('with no host, writes the local store directly from stdin; no repo and no git', async () => {
    const r = await stack(JSON.stringify(REPORT), 'report', '--agent', 'xe-cos', '--project', 'stack');
    expect(r).toMatchObject({ code: 0, out: 'report xe-cos/stack: 1 asks, 0 dropped (store)\n' });
    expect(stored().reports['xe-cos/stack']).toMatchObject({ top: REPORT.top, asks: [expect.objectContaining({ key: 'rp.xe-cos.stack.pr-12' })] });
    expect(existsSync(join(cwd, 'tasks'))).toBe(false);
    expect(existsSync(join(cwd, '.stack'))).toBe(false);
  });

  // @req FR:status-ingest/cli.direct
  it('reads --file and prints the result with --json; a stale host.json falls back to the store', async () => {
    writeHostFile(home, { url: 'http://127.0.0.1:1', pid: 1 }); // nothing listens on port 1
    await stack(JSON.stringify(REPORT), 'report', '--agent', 'xe-cos', '--project', 'stack');
    writeFileSync(join(cwd, 'r.json'), JSON.stringify({ top: [{ text: 'Next' }] }));
    const r = await stack(null, 'report', '--agent', 'xe-cos', '--project', 'stack', '--file', join(cwd, 'r.json'), '--json');
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toEqual({ ok: true, via: 'store', agent: 'xe-cos', project: 'stack', created: false, asks: { put: [], dropped: ['rp.xe-cos.stack.pr-12'], answers: {} } });
    expect(stored().reports['xe-cos/stack'].top).toEqual([{ text: 'Next' }]);
  });

  // @req FR:status-ingest/cli.host
  it('with a host up, POSTs to it and does not write the store itself; host 400 is exit 2', async () => {
    const seen: unknown[] = [];
    const srv = createServer((req, res) => {
      let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => {
        const body = JSON.parse(b); seen.push({ url: req.url, method: req.method, body });
        if (body.top?.[0]?.text === 'bad') { res.writeHead(400, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { code: 'bad_request', message: 'Validation failed', details: [{ field: 'top[0].text', message: 'x' }] } })); return; }
        res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ agent: body.agent, project: body.project, created: true, asks: { put: ['rp.a.p.pr-12'], dropped: [], answers: {} } }));
      });
    });
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
    try {
      const port = (srv.address() as { port: number }).port;
      writeHostFile(home, { url: `http://127.0.0.1:${port}`, pid: process.pid });
      const r = await stack(JSON.stringify(REPORT), 'report', '--agent', 'a', '--project', 'p');
      expect(r).toMatchObject({ code: 0, out: 'report a/p: 1 asks, 0 dropped (host)\n' });
      expect(seen[0]).toEqual({ url: '/api/reports', method: 'POST', body: { ...REPORT, agent: 'a', project: 'p' } });
      expect(existsSync(join(home, 'reports.json'))).toBe(false);
      const bad = await stack(JSON.stringify({ top: [{ text: 'bad' }] }), 'report', '--agent', 'a', '--project', 'p', '--json');
      expect(bad.code).toBe(2);
      expect(JSON.parse(bad.out)).toMatchObject({ ok: false, issues: [{ field: 'top[0].text' }] });
    } finally { await new Promise((ok) => srv.close(ok)); }
  });

  // @req FR:status-ingest/cli.direct
  it('a host.json whose process is gone, or a port that is not a Stack host, falls back to the store', async () => {
    writeHostFile(home, { url: 'http://127.0.0.1:9', pid: 999999999 });
    expect((await stack(JSON.stringify(REPORT), 'report', '--agent', 'a', '--project', 'p')).out).toContain('(store)');
    const srv = createServer((_req, res) => { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<html>other app</html>'); });
    await new Promise<void>((ok) => srv.listen(0, '127.0.0.1', ok));
    try {
      writeHostFile(home, { url: `http://127.0.0.1:${(srv.address() as { port: number }).port}`, pid: process.pid });
      const r = await stack(JSON.stringify(REPORT), 'report', '--agent', 'a', '--project', 'p');
      expect(r).toMatchObject({ code: 0, out: 'report a/p: 1 asks, 0 dropped (store)\n' });
    } finally { await new Promise((ok) => srv.close(ok)); }
  });

  // @req FR:status-ingest/cli.report
  it('reads stdin to its end, and treats an open pipe that stays silent as no input', async () => {
    const ended = new PassThrough(); setTimeout(() => { ended.write('{"a":'); ended.end('1}'); }, 10);
    expect(await readStdin(ended, 1000)).toBe('{"a":1}');
    expect(await readStdin(new PassThrough(), 30)).toBeNull();
    expect(await readStdin(Object.assign(new PassThrough(), { isTTY: true }), 30)).toBeNull();
  });

  it('exits 2 on bad input and names every issue; nothing is written', async () => {
    const bad = await stack(JSON.stringify({ top: [{ text: '' }], asks: [{ id: 'x', ask: 'y' }], extra: 1 }), 'report', '--agent', 'a', '--project', 'p');
    expect(bad.code).toBe(2);
    expect(bad.err).toContain('top[0].text');
    expect(bad.err).toContain('asks[0].link');
    expect(bad.err).toContain('extra');
    const j = await stack('{"extra":1}', 'report', '--agent', 'a', '--project', 'p', '--json');
    expect(j.code).toBe(2);
    expect(JSON.parse(j.out)).toMatchObject({ ok: false, code: 2, issues: [{ field: 'extra', message: expect.any(String) }] });
    expect((await stack('not json', 'report', '--agent', 'a', '--project', 'p')).code).toBe(2);
    expect((await stack(null, 'report', '--agent', 'a', '--project', 'p')).code).toBe(2); // no stdin, no --file
    expect((await stack('{}', 'report', '--project', 'p')).code).toBe(2);
    expect((await stack('{}', 'report', '--agent', 'a')).code).toBe(2);
    expect((await stack('{}', 'report', '--agent', 'Bad', '--project', 'p')).code).toBe(2);
    expect((await stack(null, 'report', '--agent', 'a', '--project', 'p', '--file', join(cwd, 'missing.json'))).code).toBe(2);
    expect((await stack('{}', 'report', 'extra-arg', '--agent', 'a', '--project', 'p')).code).toBe(2);
    expect((await stack('{"agent":"other"}', 'report', '--agent', 'a', '--project', 'p')).err).toContain('does not match --agent');
    expect(existsSync(join(home, 'reports.json'))).toBe(false);
  });
});

describe('stack web report store', () => {
  // @req FR:status-ingest/host.demo
  it('demo mode writes reports beside the demo copy, nowhere under the Stack home; live uses the default store', async () => {
    const userHome = tmp('stack-user-');
    const demo = webReportStore(false, userHome)!;
    expect(demo.dir).toBe(join(userHome, '.config/stack/demo-state'));
    await demo.put({ ...REPORT, agent: 'a', project: 'p' });
    expect(existsSync(join(demo.dir, 'reports.json'))).toBe(true);
    expect(readdirSync(home)).toEqual([]); // STACK_HOME untouched
    expect(existsSync(join(userHome, '.stack'))).toBe(false);
    expect(webReportStore(true, userHome)).toBeUndefined();
  });
});
