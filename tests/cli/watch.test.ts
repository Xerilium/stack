/**
 * Unit tests drive a fake `fs.watch` by hand: nothing here waits on the OS (macOS FSEvents can take seconds to start).
 * The real OS watcher is covered end to end in web/e2e/live.spec.ts, which waits for it to be armed.
 * @req FR:test-reliability/wait.event @req FR:test-reliability/seam.watch
 * @req FR:ask-queue/live.watch @req FR:ask-queue/live.sse
 */
import http from 'http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { classify, watchRepo, type Change } from '../../src/cli/watch';
import { startWeb } from '../../src/cli/web';

const tmp = () => mkdtempSync(join(tmpdir(), 'stack-watch-'));

describe('classify', () => {
  it('maps paths to kinds and ignores noise', () => {
    expect(classify('tasks/asks/pr-1.md')).toBe('asks');
    expect(classify('tasks/alpha.md')).toBe('tasks');
    expect(classify('tasks/inbox/alpha.md')).toBe('tasks');
    expect(classify('.stack/cos-state.md')).toBe('state');
    for (const ignored of ['.git/index', 'tasks/.abc123.tmp', 'tasks/asks/.x.tmp', 'tasks/alpha.md~', 'tasks/alpha.md.swp', 'README.md', 'node_modules/x/y.md', 'tasks/asks/4913']) expect(classify(ignored)).toBeNull();
  });
});

/** A stand-in for `fs.watch`: the test pushes repo-relative file events by hand, so nothing waits on the OS. Routes each event to the watcher on that folder, or to the root watcher. */
function fakeFs() {
  const subs = new Map<string, { cb: (ev: string, file: string) => void; recursive: boolean }>();
  let closed = 0; let opened = 0;
  const fn = ((p: string, o: { recursive?: boolean } | undefined, listener: (ev: string, file: string) => void) => {
    subs.set(p, { cb: listener, recursive: o?.recursive === true }); opened++;
    return { on() { return this; }, close() { closed++; subs.delete(p); } };
  }) as unknown as typeof import('fs').watch;
  const emit = (file: string) => {
    const [head, ...rest] = file.split('/');
    for (const [p, s] of subs) if (s.recursive && p.endsWith('/' + head)) return s.cb('change', rest.join('/'));
    for (const s of subs.values()) if (!s.recursive) return s.cb('change', file);
  };
  return { fn, emit, closed: () => opened > 0 && closed === opened };
}
const repoDir = () => { const d = tmp(); mkdirSync(join(d, 'tasks')); mkdirSync(join(d, '.stack')); return d; };
/** Fake only the debounce timer; everything else stays real. */
const fakeDebounce = () => jest.useFakeTimers({ doNotFake: ['Date', 'hrtime', 'nextTick', 'performance', 'queueMicrotask', 'setImmediate', 'clearImmediate', 'setInterval', 'clearInterval'] });

describe('watchRepo', () => {
  afterEach(() => { jest.useRealTimers(); });
  it('coalesces a burst into one change with the kinds that moved', () => {
    fakeDebounce();
    const os = fakeFs(); const w = watchRepo(repoDir(), { debounceMs: 60, watchFn: os.fn });
    const seen: Change[] = [];
    w.on((c) => seen.push(c));
    os.emit('tasks/asks/a.md'); os.emit('tasks/asks/b.md'); jest.advanceTimersByTime(59); os.emit('tasks/alpha.md'); // each event restarts the window
    jest.advanceTimersByTime(59);
    expect(seen).toHaveLength(0);
    jest.advanceTimersByTime(1);
    expect(seen).toHaveLength(1);
    expect(seen[0].kinds.sort()).toEqual(['asks', 'tasks']);
    expect(seen[0].rev).toBe(1);
    expect(w.rev()).toBe(1);
    jest.advanceTimersByTime(1000);
    expect(seen).toHaveLength(1);
    w.close();
  });
  it('ignores dotfiles and .git, and stops after close', () => {
    fakeDebounce();
    const os = fakeFs(); const w = watchRepo(repoDir(), { debounceMs: 40, watchFn: os.fn });
    const seen: Change[] = [];
    w.on((c) => seen.push(c));
    os.emit('.git/HEAD'); os.emit('tasks/.tmp123.tmp');
    expect(jest.getTimerCount()).toBe(0); // ignored events do not even start the debounce
    jest.advanceTimersByTime(1000);
    expect(seen).toHaveLength(0);
    os.emit('tasks/late.md'); // pending when the watcher closes: it must never fire
    w.close();
    expect(os.closed()).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(1000);
    expect(seen).toHaveLength(0);
  });
});

function sse(url: string, headers: Record<string, string> = {}) {
  const events: { event: string; data: string; id?: string }[] = [];
  const waiters: (() => boolean)[] = [];
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
      for (const w of [...waiters]) if (w()) waiters.splice(waiters.indexOf(w), 1);
    });
  });
  req.on('error', () => undefined);
  /** Resolves when an event matches; a hang is caught by the jest test timeout, not a guess. */
  const waitFor = (event: string) => new Promise<void>((ok) => {
    const check = () => { if (events.some((e) => e.event === event)) { ok(); return true; } return false; };
    if (!check()) waiters.push(check);
  });
  return { events, waitFor, close: () => req.destroy() };
}

describe('GET /events', () => {
  it('sends hello, then a change per file change, with a heartbeat', async () => {
    const dir = tmp(); mkdirSync(join(dir, 'tasks/asks'), { recursive: true });
    const web = join(dir, 'webdist'); mkdirSync(web); writeFileSync(join(web, 'index.html'), '<html></html>');
    const os = fakeFs();
    const s = await startWeb({ dir, port: 0, webDir: web, watch: { debounceMs: 40, heartbeatMs: 100, watchFn: os.fn } });
    const c = sse(`${s.url}/events`);
    try {
      await c.waitFor('hello');
      expect(JSON.parse(c.events[0].data)).toEqual({ rev: 0 });
      os.emit('tasks/asks/a.md');
      await c.waitFor('change');
      const ch = c.events.find((e) => e.event === 'change')!;
      expect(JSON.parse(ch.data)).toEqual({ rev: 1, kinds: ['asks'] });
      expect(ch.id).toBe('1');
    } finally { c.close(); await s.close(); }
  });
  it('a client that reconnects with an old rev gets one catch-up change', async () => {
    const dir = tmp(); mkdirSync(join(dir, 'tasks/asks'), { recursive: true });
    const web = join(dir, 'webdist'); mkdirSync(web); writeFileSync(join(web, 'index.html'), '<html></html>');
    const os = fakeFs();
    const s = await startWeb({ dir, port: 0, webDir: web, watch: { debounceMs: 30, watchFn: os.fn } });
    const first = sse(`${s.url}/events`);
    try {
      await first.waitFor('hello');
      os.emit('tasks/asks/a.md');
      await first.waitFor('change');
      first.close();
      const again = sse(`${s.url}/events`, { 'last-event-id': '0' });
      await again.waitFor('change');
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

describe('watch scope', () => {
  // @req FR:perf/watch.scope
  it('watches tasks/ and .stack/ only, never the whole repo recursively', () => {
    const dir = tmp(); mkdirSync(join(dir, 'tasks'), { recursive: true }); mkdirSync(join(dir, 'node_modules/x'), { recursive: true });
    const calls: { path: string; recursive: boolean }[] = [];
    const watchFn = ((p: string, o: { recursive?: boolean } | undefined) => { calls.push({ path: String(p), recursive: o?.recursive === true }); return { on() { return this; }, close() { /* none */ } }; }) as unknown as typeof import('fs').watch;
    const w = watchRepo(dir, { debounceMs: 40, watchFn });
    w.close();
    expect(calls.filter((c) => c.recursive).map((c) => c.path)).toEqual([join(dir, 'tasks')]);
    expect(calls.some((c) => c.path === dir && c.recursive)).toBe(false);
  });
  // @req FR:perf/watch.scope
  it('notices .stack/ created after start', () => {
    fakeDebounce();
    const dir = tmp(); mkdirSync(join(dir, 'tasks'), { recursive: true });
    const os = fakeFs(); const w = watchRepo(dir, { debounceMs: 40, watchFn: os.fn });
    const seen: Change[] = [];
    w.on((c) => seen.push(c));
    mkdirSync(join(dir, '.stack'));
    os.emit('.stack'); // root event: the folder appeared
    jest.advanceTimersByTime(40);
    expect(seen.map((c) => c.kinds)).toEqual([['state']]);
    os.emit('.stack/cos-state.md');
    jest.advanceTimersByTime(40);
    expect(seen).toHaveLength(2);
    w.close();
  });
});
