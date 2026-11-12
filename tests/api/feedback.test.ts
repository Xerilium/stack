import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createApiHandler } from '../../src/api/handler';
import { MemoryStorage } from '../../src/core/storage';
import { FeedbackStore, setPageCapture } from '../../src/core/feedback';

const OWNER = { 'x-ms-client-principal': Buffer.from(JSON.stringify({ userDetails: 'me', identityProvider: 'github', userRoles: ['authenticated'] })).toString('base64') };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, 2)]);
let home: string;
const mk = (store = true) => {
  home = mkdtempSync(join(tmpdir(), 'stack-fbapi-'));
  const h = createApiHandler({ storage: new MemoryStorage(), authorize: () => true, ...(store ? { feedback: new FeedbackStore(home) } : {}) });
  return async (body: unknown, owner = true) => {
    const res = await h(new Request('https://x.test/api/feedback', { method: 'POST', headers: { 'content-type': 'application/json', ...(owner ? OWNER : {}) }, body: JSON.stringify(body) }));
    const t = await res.text();
    return { status: res.status, json: t ? JSON.parse(t) : undefined };
  };
};
const stored = () => readFileSync(join(home, 'feedback.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
afterEach(() => setPageCapture(undefined));

// @req FR:feedback-button/api.route
describe('POST /feedback', () => {
  it('stores the owner feedback (201)', async () => {
    const call = mk();
    const r = await call({ text: 'Too much padding', route: '/#asks', viewport: '375x812', theme: 'light' });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ id: expect.stringMatching(/^fb-/), screenshot: false });
    expect(stored()).toEqual([expect.objectContaining({ id: r.json.id, text: 'Too much padding', route: '/#asks', viewport: '375x812', theme: 'light' })]);
  });

  it('saves an uploaded png and a host capture', async () => {
    const call = mk();
    expect((await call({ text: 'a', png: PNG.toString('base64') })).json.screenshot).toBe(true);
    setPageCapture(async () => PNG);
    expect((await call({ text: 'b', capture: true })).json.screenshot).toBe(true);
    expect(stored().every((x) => typeof x.screenshotPath === 'string')).toBe(true);
  });

  it('is owner only, 404 without a store, and validates', async () => {
    expect((await mk()({ text: 'x' }, false)).status).toBe(403);
    expect((await mk(false)({ text: 'x' })).status).toBe(404);
    const call = mk();
    expect((await call({ text: '' })).status).toBe(422);
    expect((await call({ text: 'x', viewport: 'big' })).status).toBe(422);
    expect((await call({ text: 'x', theme: 'neon' })).status).toBe(422);
    expect((await call({ text: 'x', extra: 1 })).status).toBe(422);
    expect((await call({ text: 'x', png: Buffer.from('nope').toString('base64') })).status).toBe(422);
  });
});
