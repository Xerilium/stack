import { createApiHandler } from '../../src/api/handler';
import { MemoryStorage } from '../../src/core/storage';
import { DesignReviewError, type DesignReview } from '../../src/core/design-review';

const OWNER = { 'x-ms-client-principal': Buffer.from(JSON.stringify({ userDetails: 'me', identityProvider: 'github', userRoles: ['authenticated'] })).toString('base64') };
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(16, 2)]).toString('base64');
const mk = (review?: DesignReview) => {
  const h = createApiHandler({ storage: new MemoryStorage(), authorize: () => true, ...(review ? { designReview: review } : {}) });
  return async (body: unknown, owner = true) => {
    const res = await h(new Request('https://x.test/api/design-review', { method: 'POST', headers: { 'content-type': 'application/json', ...(owner ? OWNER : {}) }, body: JSON.stringify(body) }));
    const t = await res.text();
    return { status: res.status, json: t ? JSON.parse(t) : undefined };
  };
};
const ok = (): DesignReview & { seen: unknown[] } => { const seen: unknown[] = []; return { seen, run: async (x) => { seen.push(x); return { page: 'asks', url: 'https://github.com/Xerilium/stack/issues/1' }; } }; };
const fails = (code: DesignReviewError['code']): DesignReview => ({ run: async () => { throw new DesignReviewError(code, `${code} failed`); } });

describe('POST /design-review', () => {
  // @req FR:design-review/api.route
  it('runs a review and returns the issue (201)', async () => {
    const d = ok();
    const r = await mk(d)({ route: '/#/asks', viewport: '375x812', theme: 'light', png: PNG });
    expect(r.status).toBe(201);
    expect(r.json).toEqual({ page: 'asks', url: 'https://github.com/Xerilium/stack/issues/1' });
    expect(d.seen).toEqual([expect.objectContaining({ route: '/#/asks', viewport: '375x812', theme: 'light', png: Buffer.from(PNG, 'base64') })]);
    await mk(d)({ route: '#/now', capture: true });
    expect(d.seen[1]).toMatchObject({ route: '#/now', capture: true });
  });

  // @req FR:design-review/api.owner @req FR:design-review/api.absent
  it('is owner only and 404 without a reviewer', async () => {
    expect((await mk(ok())({ route: '#/now', png: PNG }, false)).status).toBe(403);
    expect((await mk()({ route: '#/now', png: PNG })).status).toBe(404);
  });

  // @req FR:design-review/api.route
  it('validates the body like feedback', async () => {
    const call = mk(ok());
    expect((await call({})).status).toBe(422);
    expect((await call({ route: '#/now', viewport: 'big' })).status).toBe(422);
    expect((await call({ route: '#/now', theme: 'neon' })).status).toBe(422);
    expect((await call({ route: '#/now', extra: 1 })).status).toBe(422);
  });

  // @req FR:design-review/api.shot @req FR:design-review/api.down @req FR:design-review/api.issue
  it('maps failures to status codes', async () => {
    expect((await mk(fails('shot'))({ route: '#/now' })).status).toBe(422);
    const down = await mk(fails('down'))({ route: '#/now', png: PNG });
    expect(down.status).toBe(503);
    expect(down.json.error.message).toBe('down failed');
    expect((await mk(fails('issue'))({ route: '#/now', png: PNG })).status).toBe(502);
  });
});
