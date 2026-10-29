/** @req FR:ask-queue/live.watch @req FR:ask-queue/live.sse */
import http from 'http';
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { classify, watchRepo, type Change } from '../../src/cli/watch';
import { startWeb } from '../../src/cli/web';

const tmp = () => mkdtempSync(join(tmpdir(), 'stack-watch-'));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const until = async (cond: () => boolean, ms = 3000) => { const t = Date.now(); while (!cond()) { if (Date.now() - t > ms) throw new Error('timeout'); await sleep(20); } };

describe('classify', () => {
  it('maps paths to kinds and ignores noise', () => {
    expect(classify('tasks/asks/pr-1.md')).toBe('asks');
    expect(classify('tasks/alpha.md')).toBe('tasks');
    expect(classify('tasks/inbox/alpha.md')).toBe('tasks');
    expect(classify('.stack/cos-state.md')).toBe('state');
    for (const ignored of ['.git/index', 'tasks/.abc123.tmp', 'tasks/asks/.x.tmp', 'tasks/alpha.md~', 'tasks/alpha.md.swp', 'README.md', 'node_modules/x/y.md', 'tasks/asks/4913']) expect(classify(ignored)).toBeNull();
  });
});

describe('watchRepo', () => {
  it('coalesces a burst into one change with the kinds that moved', async () => {
    const dir = tmp(); mkdirSync(join(dir, 'tasks/asks'), { recursive: true });
    const w = watchRepo(dir, { debounceMs: 60 });
    const seen: Change[] = [];
    w.on((c) => seen.push(c));
    await sleep(150);
    writeFileSync(join(dir, 'tasks/asks/a.md'), '1'); writeFileSync(join(dir, 'tasks/asks/b.md'), '2'); writeFileSync(join(dir, 'tasks/alpha.md'), '3');
    await until(() => seen.length > 0);
    await sleep(200);
    w.close();
    expect(seen).toHaveLength(1);
    expect(seen[0].kinds.sort()).toEqual(['asks', 'tasks']);
    expect(seen[0].rev).toBe(1);
    expect(w.rev()).toBe(1);
  });
  it('ignores dotfiles and .git, and stops after close', async () => {
    const dir = tmp(); mkdirSync(join(dir, '.git'), { recursive: true }); mkdirSync(join(dir, 'tasks'), { recursive: true });
    const w = watchRepo(dir, { debounceMs: 40 });
    const seen: Change[] = [];
    w.on((c) => seen.push(c));
    await sleep(150);
    writeFileSync(join(dir, '.git/HEAD'), 'x'); writeFileSync(join(dir, 'tasks/.tmp123.tmp'), 'x');
    await sleep(250);
    expect(seen).toHaveLength(0);
    w.close();
    appendFileSync(join(dir, 'tasks/late.md'), 'x');
    await sleep(250);
    expect(seen).toHaveLength(0);
  });
});

function sse(url: string, headers: Record<string, string> = {}) {
  const events: { event: string; data: string; id?: string }[] = [];
  let buf = '';
  const req = http.get(url, { headers }, (res) => {
    res.setEncoding('utf8');
    res.on('data', (d: string) => {
      buf += d;
      let i: number;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, i); buf = buf.slice(i + 2);
        const ev = { event: 'message', data: '' } as { event: string; data: string; id?: string };
        for (const l of block.split('\n')) { if (l.startsWith('event: ')) ev.event = l.slice(7); else if (l.startsWith('data: ')) ev.data = l.slice(6); else if (l.startsWith('id: ')) ev.id = l.slice(4); }
        if (ev.data || ev.event !== 'message') events.push(ev);
      }
    });
  });
  req.on('error', () => undefined);
  return { events, close: () => req.destroy() };
}

describe('GET /events', () => {
  it('sends hello, then a change per file change, with a heartbeat', async () => {
    const dir = tmp(); mkdirSync(join(dir, 'tasks/asks'), { recursive: true });
    const web = join(dir, 'webdist'); mkdirSync(web); writeFileSync(join(web, 'index.html'), '<html></html>');
    const s = await startWeb({ dir, port: 0, webDir: web, watch: { debounceMs: 40, heartbeatMs: 100 } });
    const c = sse(`${s.url}/events`);
    try {
      await until(() => c.events.some((e) => e.event === 'hello'));
      expect(JSON.parse(c.events[0].data)).toEqual({ rev: 0 });
      await sleep(100);
      writeFileSync(join(dir, 'tasks/asks/a.md'), 'x');
      await until(() => c.events.some((e) => e.event === 'change'));
      const ch = c.events.find((e) => e.event === 'change')!;
      expect(JSON.parse(ch.data)).toEqual({ rev: 1, kinds: ['asks'] });
      expect(ch.id).toBe('1');
    } finally { c.close(); await s.close(); }
  });
  it('a client that reconnects with an old rev gets one catch-up change', async () => {
    const dir = tmp(); mkdirSync(join(dir, 'tasks/asks'), { recursive: true });
    const web = join(dir, 'webdist'); mkdirSync(web); writeFileSync(join(web, 'index.html'), '<html></html>');
    const s = await startWeb({ dir, port: 0, webDir: web, watch: { debounceMs: 30 } });
    const first = sse(`${s.url}/events`);
    try {
      await sleep(150);
      writeFileSync(join(dir, 'tasks/asks/a.md'), 'x');
      await until(() => first.events.some((e) => e.event === 'change'));
      first.close();
      const again = sse(`${s.url}/events`, { 'last-event-id': '0' });
      await until(() => again.events.some((e) => e.event === 'change'));
      expect(JSON.parse(again.events.find((e) => e.event === 'change')!.data)).toEqual({ rev: 1, kinds: ['asks', 'tasks', 'state'] });
      again.close();
    } finally { await s.close(); }
  });
  it('announces the stream in /.auth/me so the page only connects where it exists', async () => {
    const dir = tmp(); mkdirSync(join(dir, 'tasks'), { recursive: true });
    const web = join(dir, 'webdist'); mkdirSync(web); writeFileSync(join(web, 'index.html'), '<html></html>');
    const s = await startWeb({ dir, port: 0, webDir: web });
    try {
      const body = await new Promise<string>((ok) => { http.get(`${s.url}/.auth/me`, (r) => { let d = ''; r.on('data', (c) => { d += c; }); r.on('end', () => ok(d)); }); });
      expect(JSON.parse(body).events).toBe(true);
    } finally { await s.close(); }
  });
  it('reports no stream when the folder cannot be watched, and refuses /events', async () => {
    const missing = join(tmp(), 'gone');
    const w = watchRepo(missing);
    expect(w.active()).toBe(false);
    w.close();
    const dir = tmp(); mkdirSync(join(dir, 'tasks'), { recursive: true });
    const web = join(dir, 'webdist'); mkdirSync(web); writeFileSync(join(web, 'index.html'), '<html></html>');
    const s = await startWeb({ dir: join(dir, 'nope'), port: 0, webDir: web });
    try {
      const get = (p: string) => new Promise<{ status: number; body: string }>((ok) => { http.get(`${s.url}${p}`, (r) => { let d = ''; r.on('data', (c) => { d += c; }); r.on('end', () => ok({ status: r.statusCode ?? 0, body: d })); }); });
      expect(JSON.parse((await get('/.auth/me')).body).events).toBe(false);
      expect((await get('/events')).status).toBe(503);
    } finally { await s.close(); }
  });
  it('keeps the loopback guards', async () => {
    const dir = tmp(); mkdirSync(join(dir, 'tasks'), { recursive: true });
    const web = join(dir, 'webdist'); mkdirSync(web); writeFileSync(join(web, 'index.html'), '<html></html>');
    const s = await startWeb({ dir, port: 0, webDir: web });
    try {
      const status = await new Promise<number>((ok) => { http.get(`${s.url}/events`, { headers: { host: 'evil.test' } }, (r) => { ok(r.statusCode ?? 0); r.destroy(); }); });
      expect(status).toBe(403);
    } finally { await s.close(); }
  });
});
