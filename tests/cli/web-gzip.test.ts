/** `stack web` gzips text responses over 1 KB for clients that accept it. */
import http from 'http';
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { gunzipSync } from 'zlib';
import { prepareDemo, startWeb, type WebServer } from '../../src/cli/web';

const tmp = () => mkdtempSync(join(tmpdir(), 'stack-web-gzip-'));
let s: WebServer;
let bundle: string;

/** Raw bytes and headers: fetch would decode gzip and hide the wire format. */
function raw(path: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: Buffer }> {
  return new Promise((ok, bad) => {
    const req = http.get(`${s.url}${path}`, { headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => { chunks.push(c); if (res.headers['content-type']?.startsWith('text/event-stream')) { req.destroy(); ok({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }); } });
      res.on('end', () => ok({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', bad);
  });
}

beforeAll(async () => {
  const src = tmp(); mkdirSync(join(src, 'tasks'));
  const rows = Array.from({ length: 60 }, (_, i) => `- [ ] Task number ${i} with some words to fill the row`).join('\n');
  writeFileSync(join(src, 'tasks/alpha.md'), `# Alpha\n\n## Active\n\n${rows}\n`);
  const dest = join(tmp(), 'demo'); prepareDemo(src, dest);
  const web = tmp(); mkdirSync(join(web, 'assets'));
  writeFileSync(join(web, 'index.html'), '<html>app</html>');
  bundle = Array.from({ length: 4000 }, (_, i) => `export function f${i % 50}(a, b) { return a + b + ${i}; }`).join('\n');
  writeFileSync(join(web, 'assets/index-abc.js'), bundle);
  writeFileSync(join(web, 'assets/logo-abc.png'), Buffer.alloc(4096, 7));
  const watchFn = (() => ({ on() { return this; }, close() { /* nothing to release */ } })) as unknown as typeof import('fs').watch;
  s = await startWeb({ watch: { watchFn }, dir: dest, port: 0, webDir: web });
});
afterAll(async () => { await s.close(); });

describe('stack web gzip', () => {
  // @req FR:perf/serve.gzip
  it('gzips JSON over 1 KB when the client accepts gzip, and it decodes to the same body', async () => {
    const plain = await raw('/api/tasks');
    expect(plain.body.length).toBeGreaterThan(1024);
    expect(plain.headers['content-encoding']).toBeUndefined();
    const z = await raw('/api/tasks', { 'accept-encoding': 'gzip, br' });
    expect(z.headers['content-encoding']).toBe('gzip');
    expect(z.headers.vary).toMatch(/accept-encoding/i);
    expect(gunzipSync(z.body).toString()).toBe(plain.body.toString());
  });

  // @req FR:perf/serve.gzip @req FR:perf/serve.gzip.cache
  it('gzips the main JS bundle to at least 60% smaller', async () => {
    const a = await raw('/assets/index-abc.js', { 'accept-encoding': 'gzip' });
    const b = await raw('/assets/index-abc.js', { 'accept-encoding': 'gzip' });
    expect(a.headers['content-encoding']).toBe('gzip');
    expect(a.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(gunzipSync(a.body).toString()).toBe(bundle);
    expect(a.body.length).toBeLessThanOrEqual(Buffer.byteLength(bundle) * 0.4);
    expect(b.body.equals(a.body)).toBe(true);
  });

  // @req FR:perf/serve.gzip
  it('sends raw bytes without Accept-Encoding gzip, and for small bodies', async () => {
    expect((await raw('/assets/index-abc.js')).headers['content-encoding']).toBeUndefined();
    expect((await raw('/assets/index-abc.js', { 'accept-encoding': 'br, gzip;q=0' })).headers['content-encoding']).toBeUndefined();
    expect((await raw('/', { 'accept-encoding': 'gzip' })).headers['content-encoding']).toBeUndefined();
  });

  // @req FR:perf/serve.gzip.skip
  it('never compresses images or event streams', async () => {
    const png = await raw('/assets/logo-abc.png', { 'accept-encoding': 'gzip' });
    expect(png.headers['content-type']).toBe('image/png');
    expect(png.headers['content-encoding']).toBeUndefined();
    const sse = await raw('/events', { 'accept-encoding': 'gzip' });
    expect(sse.headers['content-type']).toBe('text/event-stream');
    expect(sse.headers['content-encoding']).toBeUndefined();
  });
});
