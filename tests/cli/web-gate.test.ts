/** The local `stack web` gate: cross-site reads, bad origins, and oversized bodies get 4xx, never 500. */
import { mkdirSync, mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { prepareDemo, startWeb, type WebServer } from '../../src/cli/web';

const tmp = () => mkdtempSync(join(tmpdir(), 'stack-web-gate-'));
const quiet = { watch: { watchFn: (() => ({ on() { return this; }, close() { /* nothing to release */ } })) as unknown as typeof import('fs').watch } };
let s: WebServer;
let errors: jest.SpyInstance;

beforeAll(async () => {
  const src = tmp(); mkdirSync(join(src, 'tasks'));
  writeFileSync(join(src, 'tasks/alpha.md'), '# Alpha\n\n## Active\n\n- [ ] Write the plan\n');
  const dest = join(tmp(), 'demo'); prepareDemo(src, dest);
  const web = tmp(); writeFileSync(join(web, 'index.html'), '<html>app</html>');
  s = await startWeb({ ...quiet, dir: dest, port: 0, webDir: web });
});
afterAll(async () => { await s.close(); });
beforeEach(() => { errors = jest.spyOn(console, 'error').mockImplementation(() => undefined); });
afterEach(() => { errors.mockRestore(); });

const get = (path: string, headers: Record<string, string> = {}) => fetch(`${s.url}${path}`, { headers });
const post = (path: string, headers: Record<string, string>, body = '{}') => fetch(`${s.url}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body });

describe('stack web local gate', () => {
  // @req FR:cli/web.serve.loopback @req FR:cli/web.serve.loopback.reads
  it('refuses cross-site and same-site reads of the api and event streams', async () => {
    for (const site of ['cross-site', 'same-site']) {
      expect((await get('/api/sync', { 'sec-fetch-site': site, origin: 'http://evil.com' })).status).toBe(403);
      expect((await get('/api/tasks', { 'sec-fetch-site': site })).status).toBe(403);
      expect((await get('/events', { 'sec-fetch-site': site })).status).toBe(403);
      expect((await get('/sessions/abc/events', { 'sec-fetch-site': site })).status).toBe(403);
    }
  });

  // @req FR:cli/web.serve.loopback.reads
  it('serves same-origin, none, and header-less reads', async () => {
    expect((await get('/api/tasks', { 'sec-fetch-site': 'same-origin' })).status).toBe(200);
    expect((await get('/api/tasks', { 'sec-fetch-site': 'none' })).status).toBe(200);
    expect((await get('/api/tasks')).status).toBe(200);
    expect((await get('/', { 'sec-fetch-site': 'cross-site' })).status).toBe(200);
  });

  // @req FR:cli/web.serve.loopback.origin
  it('answers 403 for a write with a null or broken Origin', async () => {
    expect((await post('/api/tasks', { origin: 'null' })).status).toBe(403);
    expect((await post('/api/tasks', { origin: 'not a url' })).status).toBe(403);
    expect(errors).not.toHaveBeenCalled();
  });

  // @req FR:cli/web.serve.body @req FR:cli/web.serve.body.quiet
  it('answers 413 for a body over 1 MB, with no error stack', async () => {
    const r = await post('/api/tasks', { 'sec-fetch-site': 'same-origin' }, 'x'.repeat(1_100_000));
    expect(r.status).toBe(413);
    expect(errors).not.toHaveBeenCalled();
  });
});
