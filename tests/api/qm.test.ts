import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { createApiHandler } from '../../src/api/handler';
import { MemoryStorage } from '../../src/core/storage';
import { QmStore } from '../../src/core/qm-plan';

const OWNER = { 'x-ms-client-principal': Buffer.from(JSON.stringify({ userDetails: 'me', identityProvider: 'github', userRoles: ['authenticated'] })).toString('base64') };
const PLAN = { version: 1, asOf: '2026-11-18T19:00:00Z', projects: [{ project: 'Stack', agent: { name: 'a' }, tasks: [], weeklyTokens: 1, preAckMin: 2, postReviewMin: 3 }] };

const get = async (qm: QmStore | undefined, owner = true) => {
  const h = createApiHandler({ storage: new MemoryStorage(), authorize: () => true, ...(qm ? { qm } : {}) });
  const res = await h(new Request('https://x.test/api/qm', { headers: owner ? OWNER : {} }));
  return { status: res.status, json: await res.json() };
};

// @req FR:qm-plan/api.get
describe('GET /qm', () => {
  it('returns the plan, or null when none', async () => {
    const s = new QmStore(mkdtempSync(join(tmpdir(), 'stack-qmapi-')));
    expect(await get(s)).toEqual({ status: 200, json: { plan: null } });
    s.put(PLAN);
    expect(await get(s)).toEqual({ status: 200, json: { plan: PLAN } });
  });

  it('is owner only and 404 with no store', async () => {
    expect((await get(new QmStore(mkdtempSync(join(tmpdir(), 'stack-qmapi-'))), false)).status).toBe(403);
    expect((await get(undefined)).status).toBe(404);
  });
});
