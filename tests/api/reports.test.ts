import { createApiHandler, ROUTES } from '../../src/api/handler';
import { createAuth, createTokenService, MemoryTokenStore, routeScope } from '../../src/api';
import { MemoryStorage } from '../../src/core/storage';
import { NEEDS_PATH } from '../../src/core/needs-you';
import { ReportStore } from '../../src/core/reports';
import { mkdtempSync, readFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const NOW = new Date('2026-11-11T18:00:00Z');
const ASK = { id: 'pr-12', ask: 'Approve PR 12', link: 'https://github.com/o/r/pull/12', by: '2026-11-12T17:00:00Z', recommend: 'Approve' };
const BODY = { agent: 'xe-cos', project: 'stack', top: [{ text: 'Ship it' }], asks: [ASK], blockers: [], progress: [{ text: 'Spec done' }] };
const OWNER = { 'x-ms-client-principal': Buffer.from(JSON.stringify({ userDetails: 'me', identityProvider: 'github', userRoles: ['authenticated'] })).toString('base64') };

async function mk(withStore = true) {
  const storage = new MemoryStorage();
  const reports = withStore ? new ReportStore(mkdtempSync(join(tmpdir(), 'stack-home-')), { now: () => NOW }) : undefined;
  const tokens = createTokenService({ store: new MemoryTokenStore(), now: () => NOW });
  const auth = createAuth({ owners: [], tokens });
  const token = auth.wrap(createApiHandler({ storage, reports, authorize: auth.authorize, now: () => NOW }));
  const owner = createApiHandler({ storage, reports, authorize: () => true, now: () => NOW });
  const mint = async (name: string, ...scopes: string[]) => (await tokens.create({ name, scopes: scopes as never })).token;
  const call = async (who: string | 'owner' | null, body: unknown, path = '/reports', method = 'POST') => {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (who === 'owner') Object.assign(headers, OWNER);
    else if (who) headers.authorization = `Bearer ${who}`;
    const res = await (who === 'owner' ? owner : token)(new Request(`https://x.test/api${path}`, { method, headers, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }));
    const text = await res.text();
    return { status: res.status, json: text ? JSON.parse(text) : undefined };
  };
  return { storage, reports, mint, call };
}

describe('POST /reports', () => {
  // @req FR:status-ingest/api.put
  it('is registered with tasks:write and in the OpenAPI document', () => {
    expect(routeScope('reports.put')).toBe('tasks:write');
    expect(ROUTES.some((r) => r.name === 'reports.put' && r.method === 'POST' && r.doc === '/reports')).toBe(true);
    expect(readFileSync(join(__dirname, '../../docs/api/openapi.yaml'), 'utf8')).toContain('/reports:');
  });

  // @req FR:status-ingest/api.put @req FR:status-ingest/asks.result @req FR:status-ingest/auth.writer
  it('a token stores the report in the live store, not the content repo', async () => {
    const { call, mint, storage, reports } = await mk();
    const r = await call(await mint('xe-cos', 'tasks:write'), BODY);
    expect(r).toEqual({ status: 200, json: { agent: 'xe-cos', project: 'stack', created: true, asks: { put: ['rp.xe-cos.stack.pr-12'], dropped: [], answers: {} } } });
    expect(reports!.list()[0]).toMatchObject({ agent: 'xe-cos', writer: 'token:xe-cos', top: [{ text: 'Ship it' }] });
    expect(await storage.list()).toEqual([]);
    expect(await storage.listAsks()).toEqual([]);
  });

  // @req FR:status-ingest/auth.writer
  it('another token gets 403; read-only and missing tokens are refused; the owner may write', async () => {
    const { call, mint } = await mk();
    expect((await call(await mint('xe-cos', 'tasks:write'), BODY)).status).toBe(200);
    expect((await call(await mint('other', 'tasks:write'), BODY)).status).toBe(403);
    expect((await call(await mint('ro', 'tasks:read'), BODY)).status).toBe(403);
    expect((await call(null, BODY)).status).toBe(401);
    expect((await call('owner', BODY)).status).toBe(200);
  });

  // @req FR:status-ingest/api.invalid @req FR:status-ingest/schema.errors
  it('a bad body is 400 with every issue; nothing is written', async () => {
    const { call, mint, reports } = await mk();
    const r = await call(await mint('xe-cos', 'tasks:write'), { ...BODY, agent: 'Bad', asks: [{ ...ASK, link: 'http://x' }], extra: true });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe('bad_request');
    expect(r.json.error.details.map((i: { field: string }) => i.field).sort()).toEqual(['agent', 'asks[0].link', 'extra']);
    expect(reports!.list()).toEqual([]);
    expect((await call('owner', { project: 'p' })).status).toBe(400);
  });

  // @req FR:status-ingest/api.put
  it('is 404 on a host with no report store', async () => {
    const { call } = await mk(false);
    expect((await call('owner', BODY)).status).toBe(404);
  });
});

describe('Needs you with report asks', () => {
  // @req FR:status-ingest/needs.list @req FR:status-ingest/needs.answer
  it('lists report asks after the CoS items and records the owner answer in the live store', async () => {
    const { call, storage, reports } = await mk();
    await storage.writeAux(NEEDS_PATH, JSON.stringify({ items: [{ id: 'pay', title: 'Pay bills', recommendation: 'Pay', link: 'https://x.test/p' }] }), { expectedVersion: null });
    await call('owner', BODY);
    const list = await call('owner', undefined, '/needs-you', 'GET');
    expect(list.json.items.map((i: { id: string }) => i.id)).toEqual(['pay', 'rp.xe-cos.stack.pr-12']);
    expect(list.json.items[1]).toEqual({ id: 'rp.xe-cos.stack.pr-12', title: 'Approve PR 12', recommendation: 'Approve', link: ASK.link, project: 'stack', by: ASK.by });
    expect((await call('owner', { choice: 'go' }, '/needs-you/rp.xe-cos.stack.pr-12/answer')).json).toEqual({ changed: true });
    expect(reports!.list()[0].asks[0].answer).toEqual({ choice: 'go', at: NOW.toISOString() });
    expect((await call('owner', undefined, '/needs-you', 'GET')).json.items[1].answer).toEqual({ choice: 'go', at: NOW.toISOString() });
    expect((await call('owner', { choice: 'go' }, '/needs-you/rp.nope.x.y/answer')).status).toBe(404);
  });
});
