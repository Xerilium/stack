import { fixtureCalendar } from '../../src/calendar';
import { readFileSync } from 'fs';
import { join } from 'path';
import { parseDocument } from 'yaml';
import { createApiHandler, QUERY_DEFAULTS, ROUTES } from '../../src/api/handler';
import { ERROR_CODES } from '../../src/api/errors';
import { buildOpenApi, renderOpenApi } from '../../src/api/openapi';
import { parseRef } from '../../src/api/validate';
import { ENUMS, MAX_STR, type Spec } from '../../src/api/validate';
import { MemoryStorage } from '../../src/core/storage';

const FILE = join(__dirname, '../../docs/api/openapi.yaml');
const text = readFileSync(FILE, 'utf8');
const doc: any = parseDocument(text).toJS();
const ops: { route: (typeof ROUTES)[number]; op: any }[] = ROUTES.map((route) => ({ route, op: doc.paths[route.doc]?.[route.method.toLowerCase()] }));

const resolve = (s: any): any => {
  if (s && s.$ref) {
    const target = s.$ref.replace(/^#\//, '').split('/').reduce((o: any, k: string) => o?.[k], doc);
    if (!target) throw new Error(`unresolved ${s.$ref}`);
    return resolve(target); // strict 3.0.3: siblings of $ref are ignored
  }
  return s;
};

/** Independent check that a JSON schema says what a validation Spec enforces. */
function expectSchema(spec: Spec, raw: any): void {
  const s = resolve(raw);
  switch (spec.t) {
    case 'str':
      expect(s.type).toBe('string');
      expect(s.maxLength).toBe(spec.max ?? MAX_STR);
      if (spec.pattern) expect(s.pattern).toBe(spec.pattern.source);
      break;
    case 'enum': expect(s).toMatchObject({ type: 'string', enum: [...spec.values] }); break;
    case 'int': expect(s).toMatchObject({ type: 'integer', minimum: spec.min, maximum: spec.max }); break;
    case 'num': expect(s).toMatchObject({ type: 'number', minimum: spec.min, maximum: spec.max }); break;
    case 'bool': expect(s.type).toBe('boolean'); break;
    case 'ref': expect(s.type).toBe('string'); expect(s.pattern).toContain(':'); break;
    case 'strs': expect(s).toMatchObject({ type: 'array', maxItems: spec.max ?? 20, items: { type: 'string' } }); break;
    case 'caps': expect(s).toMatchObject({ type: 'object', additionalProperties: { type: 'number', minimum: 0, maximum: 168 } }); break;
  }
}

/** Tiny OpenAPI-subset validator; undeclared properties are errors so output cannot drift from the schema. */
function conforms(schema: any, v: unknown, at = '$'): string[] {
  const s = resolve(schema);
  if (v === null) return s.nullable ? [] : [`${at}: null not allowed`];
  const bad = (m: string) => [`${at}: ${m}`];
  if (s.allOf) return s.allOf.flatMap((x: any) => conforms(x, v, at));
  switch (s.type) {
    case 'string':
      if (typeof v !== 'string') return bad('expected string');
      if (s.enum && !s.enum.includes(v)) return bad(`not in enum: ${v}`);
      if (s.pattern && !new RegExp(s.pattern).test(v)) return bad(`pattern: ${v}`);
      return [];
    case 'integer': return Number.isInteger(v) ? [] : bad('expected integer');
    case 'number': return typeof v === 'number' ? [] : bad('expected number');
    case 'boolean': return typeof v === 'boolean' ? [] : bad('expected boolean');
    case 'array':
      return Array.isArray(v) ? v.flatMap((x, i) => conforms(s.items, x, `${at}[${i}]`)) : bad('expected array');
    case 'object': {
      if (typeof v !== 'object' || Array.isArray(v)) return bad('expected object');
      const o = v as Record<string, unknown>;
      const errs: string[] = [];
      for (const k of s.required ?? []) if (!(k in o)) errs.push(`${at}.${k}: required`);
      for (const [k, x] of Object.entries(o)) {
        if (s.properties?.[k]) errs.push(...conforms(s.properties[k], x, `${at}.${k}`));
        else if (s.additionalProperties && typeof s.additionalProperties === 'object') errs.push(...conforms(s.additionalProperties, x, `${at}.${k}`));
        else if (s.properties) errs.push(`${at}.${k}: undeclared property`);
      }
      return errs;
    }
    default: return [];
  }
}

// @req FR:api/docs.openapi
describe('openapi.yaml generation', () => {
  it('is exactly what the route table generates (run `pnpm openapi` to refresh)', () => {
    expect(text).toBe(renderOpenApi());
  });
  it('builds deterministically', () => {
    expect(JSON.stringify(buildOpenApi())).toBe(JSON.stringify(buildOpenApi()));
  });
});

// @req FR:api/docs.openapi.valid
describe('openapi.yaml validity', () => {
  it('parses with no YAML errors or duplicate keys', () => {
    const d = parseDocument(text);
    expect(d.errors.map((e) => e.message)).toEqual([]);
    expect(d.warnings.map((e) => e.message)).toEqual([]);
    expect((text.match(/^components:/gm) ?? []).length).toBe(1);
    expect((text.match(/^paths:/gm) ?? []).length).toBe(1);
  });
  it('is OpenAPI 3.0.3 with info, server, and the error model', () => {
    expect(doc.openapi).toBe('3.0.3');
    expect(doc.info.title).toBeTruthy();
    expect(doc.servers).toEqual([{ url: '/api' }]);
    expect(doc.components.schemas.Error.properties.error.required).toEqual(['code', 'message']);
  });
  it('resolves every $ref', () => {
    const refs: string[] = [];
    JSON.stringify(doc, (k, v) => { if (k === '$ref') refs.push(v); return v; });
    expect(refs.length).toBeGreaterThan(10);
    for (const r of refs) {
      expect(r).toMatch(/^#\/components\/(schemas|parameters|responses|requestBodies|securitySchemes)\/\w+$/);
      expect(resolve({ $ref: r })).toBeDefined();
    }
  });
  it('has unique operationIds and a responses block on every operation', () => {
    const ids: string[] = [];
    for (const [p, item] of Object.entries<any>(doc.paths)) {
      for (const [m, op] of Object.entries<any>(item)) {
        expect(['get', 'post']).toContain(m);
        expect(op.operationId).toMatch(/^\w+$/);
        expect(Object.keys(op.responses).length).toBeGreaterThan(0);
        expect(op.responses.default).toBeDefined();
        ids.push(op.operationId);
        void p;
      }
    }
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe('route parity', () => {
  it('documents exactly the routes the handler serves', () => {
    const served = ROUTES.map((r) => `${r.method} ${r.doc}`).sort();
    const documented = Object.entries<any>(doc.paths).flatMap(([p, i]) => Object.keys(i).map((m) => `${m.toUpperCase()} ${p}`)).sort();
    expect(documented).toEqual(served);
    expect(new Set(served).size).toBe(served.length);
  });

  // @req FR:api/docs.openapi.parity
  it('matches path parameters', () => {
    for (const { route, op } of ops) {
      const want = [...route.doc.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      const got = (op.parameters ?? []).map(resolve).filter((p: any) => p.in === 'path');
      expect(got.map((p: any) => p.name)).toEqual(want);
      for (const p of got) expect(p.required).toBe(true);
    }
  });

  // @req FR:api/docs.openapi.parity
  it('matches query parameters: names, types, bounds, enums, defaults', () => {
    for (const { route, op } of ops) {
      const got = (op.parameters ?? []).map(resolve).filter((p: any) => p.in === 'query');
      expect(got.map((p: any) => p.name).sort()).toEqual(Object.keys(route.query ?? {}).sort());
      for (const p of got) {
        const spec = route.query![p.name];
        const s = resolve(p.schema);
        if (spec.t === 'enum') expect(s).toMatchObject({ type: 'string', enum: [...spec.values] });
        else if (spec.t === 'int') expect(s).toMatchObject({ type: 'integer', minimum: spec.min, maximum: spec.max });
        else expect(s.type).toBe('string');
        const def = QUERY_DEFAULTS[p.name as keyof typeof QUERY_DEFAULTS];
        if (route.name === 'tasks.list' && def !== undefined) expect(s.default).toBe(def);
        expect(p.required ?? false).toBe(false);
      }
    }
  });

  // @req FR:api/docs.openapi.parity
  it('matches request bodies: properties, required, bounds, enums, strictness', () => {
    for (const { route, op } of ops) {
      if (!route.body) { expect(op.requestBody).toBeUndefined(); continue; }
      const rb = resolve(op.requestBody);
      expect(!!rb.required).toBe(route.body.required.length > 0);
      const s = resolve(rb.content['application/json'].schema);
      expect(s.type).toBe('object');
      expect(s.additionalProperties).toBe(false);
      expect(Object.keys(s.properties).sort()).toEqual(Object.keys(route.body.schema).sort());
      expect([...(s.required ?? [])].sort()).toEqual([...route.body.required].sort());
      for (const [k, spec] of Object.entries(route.body.schema)) expectSchema(spec, s.properties[k]);
    }
  });

  // @req FR:api/input.enums
  it('declares the same enums the API enforces and no force flag', () => {
    const set = resolve(doc.paths['/tasks/set'].post.requestBody).content['application/json'].schema.properties;
    for (const [name, values] of Object.entries(ENUMS)) expect(set[name].enum).toEqual([...values]);
    expect(Object.keys(set).sort()).toEqual(['checkbox', 'clearEmojis', 'effort', 'impact', 'priority', 'ref', 'status', 'suspend']);
    expect(text).not.toMatch(/force:/);
    expect(doc.components.schemas.Error.properties.error.properties.code.enum).toEqual([...ERROR_CODES]);
    expect(resolve(doc.paths['/tasks'].get.parameters.find((p: any) => p.name === 'state')).schema.enum).toEqual(['open', 'done', 'all']);
  });
});

// @req FR:api/docs.openapi.parity
describe('security parity', () => {
  it('requires the host scheme globally and never overrides it', () => {
    expect(doc.security).toEqual([{ host: [] }]);
    expect(doc.components.securitySchemes.host).toMatchObject({ type: 'http', scheme: 'bearer' });
    for (const { op } of ops) expect(op.security).toBeUndefined();
  });
  it('denies every documented route without a grant', async () => {
    const none = createApiHandler({ storage: new MemoryStorage() });
    const no = createApiHandler({ storage: new MemoryStorage(), authorize: () => false });
    for (const r of ROUTES) {
      const url = `https://x.test/api${r.doc.replace(/\{\w+\}/g, 'a:1')}`;
      const init = { method: r.method } as RequestInit;
      expect((await none(new Request(url, init))).status).toBe(401);
      expect((await no(new Request(url, init))).status).toBe(403);
    }
  });
});

describe('response parity (real handler output vs documented schemas)', () => {
  const NOW = new Date('2026-10-22T18:00:00Z');
  const storage = new MemoryStorage();
  // A calendar with an online meeting, so the documented event shape (joinUrl included) is checked against real output.
  const calendar = fixtureCalendar([{ id: 'e1', subject: 'Sync', start: '2026-10-28T15:00:00.000Z', end: '2026-10-28T15:30:00.000Z', allDay: false, showAs: 'busy', cancelled: false, online: true, organizer: 'Ann', webLink: 'https://outlook.office.com/e/1', joinUrl: 'https://teams.microsoft.com/l/1' }]);
  const h = createApiHandler({ storage, authorize: () => true, now: () => NOW, calendar });
  const OWNER_HDR = { 'x-ms-client-principal': Buffer.from(JSON.stringify({ identityProvider: 'github', userId: 'o', userRoles: ['authenticated'] })).toString('base64') };
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await h(new Request(`https://x.test/api${path}`, {
      method, headers: { ...OWNER_HDR, ...(body !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    }));
    const t = await res.text();
    return { status: res.status, body: t ? JSON.parse(t) : undefined };
  };
  const check = (route: string, r: { status: number; body: unknown }) => {
    const { op } = ops.find((o) => o.route.name === route)!;
    const key = String(r.status);
    const resp = resolve(op.responses[key] ?? op.responses.default);
    expect(Object.keys(op.responses)).toContain(op.responses[key] ? key : 'default');
    const schema = resp.content?.['application/json']?.schema;
    expect([route, r.status, conforms(schema, r.body)]).toEqual([route, r.status, []]);
  };

  it('every route response conforms, including errors', async () => {
    const seen = new Set<string>();
    const go = async (name: string, method: string, path: string, body?: unknown, status?: number) => {
      const r = await call(method, path, body);
      if (status !== undefined) expect([name, r.status]).toEqual([name, status]);
      check(name, r);
      seen.add(name);
      return r;
    };
    await go('projects.add', 'POST', '/projects', { name: 'Alpha', aliases: ['al'], weeklyCapacity: 10, capacity: { a: 1 }, repositoryUrl: 'https://x.test/r' }, 201);
    await go('tasks.add', 'POST', '/tasks', { project: 'alpha', text: 'First task 🟢' }, 201);
    await go('tasks.add', 'POST', '/tasks', { project: 'alpha', text: 'Second task 🔴' }, 201);
    await go('tasks.add', 'POST', '/tasks', { project: 'nope' }, 422);
    const list = await go('tasks.list', 'GET', '/tasks?state=all&fields=ref,text,project,section,done,depth,notes', undefined, 200);
    await go('tasks.list', 'GET', '/tasks?limit=0', undefined, 422);
    const ref = (list.body as any).items[0].ref as string;
    await go('tasks.get', 'GET', `/tasks/${encodeURIComponent(ref)}`, undefined, 200);
    await go('tasks.get', 'GET', '/tasks/zzz:99', undefined, 404);
    await go('next', 'GET', '/next', undefined, 200);
    await go('capture', 'POST', '/capture', { text: 'call dentist tomorrow 30m #alpha', dryRun: true }, 200);
    await go('capture', 'POST', '/capture', { text: 'call dentist tomorrow 30m #alpha' }, 201);
    await go('tasks.start', 'POST', '/tasks/start', { ref }, 200);
    await go('tasks.suspend', 'POST', '/tasks/suspend', { ref, days: 1 }, 200);
    await go('tasks.resume', 'POST', '/tasks/resume', { ref }, 200);
    await go('tasks.skip', 'POST', '/tasks/skip', { ref }, 200);
    await go('tasks.set', 'POST', '/tasks/set', { ref, priority: '🔺', effort: '🟢' }, 200);
    await go('tasks.triage', 'POST', '/tasks/triage', { ref }, 403);
    await go('tasks.claim', 'POST', '/tasks/claim', { ref }, 403);
    await go('tasks.result', 'POST', '/tasks/result', { ref, outcome: 'done', summary: 'x' }, 403);
    const cur = ((await go('tasks.list', 'GET', '/tasks?state=all&fields=ref,text', undefined, 200)).body as any).items as { ref: string; text: string }[];
    await go('tasks.edit', 'POST', '/tasks/edit', { ref: cur[0].ref, text: 'Edited', expect: cur[0].text }, 200);
    await go('tasks.edit', 'POST', '/tasks/edit', { ref: cur[0].ref, text: 'Again', expect: 'stale' }, 409);
    await go('tasks.move', 'POST', '/tasks/move', { ref: cur[1].ref, target: cur[0].ref, position: 'before', expect: cur[1].text, expectTarget: 'Edited' }, 200);
    await go('tasks.move', 'POST', '/tasks/move', { ref: cur[0].ref, target: cur[0].ref, position: 'before' }, 422);
    await go('tasks.complete', 'POST', '/tasks/complete', { ref, summary: 'done' }, 200);
    await go('tasks.removeCompleted', 'POST', '/tasks/remove-completed', {}, 200);
    await go('projects.list', 'GET', '/projects?fields=name,title,open,done,aliases,metadata,sections', undefined, 200);
    await go('projects.get', 'GET', '/projects/alpha?fields=name,title,open,done,aliases,metadata,sections', undefined, 200);
    await go('projects.get', 'GET', '/projects/none', undefined, 404);
    await go('summaries.get', 'GET', '/summaries', undefined, 200);
    // @req FR:day-inputs/api.calendar
    await go('calendar.list', 'GET', '/calendar?from=2026-10-28T00:00:00Z&to=2026-10-29T00:00:00Z', undefined, 200);
    await go('calendar.list', 'GET', '/calendar?from=x&to=y', undefined, 422);
    // @req FR:schedule/api.schedule
    await go('schedule.get', 'GET', '/schedule?at=2026-10-29T06:12:00Z', undefined, 200);
    await go('schedule.get', 'GET', '/schedule?at=x', undefined, 422);
    // @req FR:agent-inbox/api.agents
    await go('tasks.add', 'POST', '/tasks', { project: 'alpha', text: '🪄 Agent job https://github.com/o/r/pull/1' }, 201);
    const agent = ((await go('agents.list', 'GET', '/agents', undefined, 200)).body as any).items[0].ref as string;
    const sent = await go('inbox.send', 'POST', '/inbox', { ref: agent, text: 'Go ahead', kind: 'decision' }, 201);
    await go('inbox.send', 'POST', '/inbox', { ref: agent, text: '' }, 422);
    await go('inbox.list', 'GET', '/inbox?state=all', undefined, 200);
    await go('inbox.handle', 'POST', '/inbox/handled', { id: (sent.body as any).id, note: 'ok' }, 200);
    await go('inbox.handle', 'POST', '/inbox/handled', { id: 'in-20260101T000000Z-0000' }, 404);
    // @req FR:ask-queue/api.list @req FR:ask-queue/api.put @req FR:ask-queue/api.answer @req FR:ask-queue/api.handle
    await go('asks.put', 'POST', '/asks/pr-1', { ask: 'Approve PR 1', kind: 'approve', from: 'cos', recommend: 'Approve', by: '2030-01-01T00:00:00Z', link: 'https://github.com/o/r/pull/1', reversible: true }, 200);
    await go('asks.put', 'POST', '/asks/Bad Key', { ask: 'x', kind: 'approve' }, 422);
    await go('asks.list', 'GET', '/asks', undefined, 200);
    await go('asks.list', 'GET', '/asks?state=nope', undefined, 422);
    await go('asks.answer', 'POST', '/asks/pr-1/answer', { answer: 'go' }, 200);
    await go('asks.answer', 'POST', '/asks/pr-1/answer', { answer: 'go' }, 409);
    await go('asks.handle', 'POST', '/asks/pr-1/handle', { outcome: 'handled', note: 'merged' }, 200);
    await go('asks.handle', 'POST', '/asks/zzz/handle', { outcome: 'handled' }, 404);
    // @req FR:agent-sessions/driver.interface (no driver here: every sessions route is 404 and the error shape still conforms)
    await go('sessions.list', 'GET', '/sessions', undefined, 404);
    await go('sessions.cost', 'GET', '/sessions/cost', undefined, 404);
    await go('sessions.messages', 'GET', '/sessions/a1b2c3d4-0000-0000-0000-000000000001/messages', undefined, 404);
    await go('sessions.new', 'POST', '/sessions', { cwd: '/', text: 'x' }, 404);
    await go('sessions.prompt', 'POST', '/sessions/a1b2c3d4-0000-0000-0000-000000000001/prompt', { text: 'x' }, 404);
    await go('sessions.cancel', 'POST', '/sessions/a1b2c3d4-0000-0000-0000-000000000001/cancel', {}, 404);
    expect([...seen].sort()).toEqual(ROUTES.map((r) => r.name).sort());
  });

  it('accepts every documented enum value and rejects values outside it', async () => {
    const props = resolve(doc.paths['/tasks/set'].post.requestBody).content['application/json'].schema.properties;
    for (const name of ['status', 'priority', 'effort', 'impact', 'checkbox']) {
      for (const v of props[name].enum) {
        const r = await call('POST', '/tasks/set', { ref: 'zzz:1', [name]: v });
        expect([name, v, r.status, (r.body?.error?.details ?? []).filter((d: any) => d.field === name)]).toEqual([name, v, r.status, []]);
      }
      const r = await call('POST', '/tasks/set', { ref: 'zzz:1', [name]: 'bogus' });
      expect(r.status).toBe(422);
    }
  });

  it('enforces documented bounds and strictness', async () => {
    expect((await call('POST', '/tasks/suspend', { days: 366 })).status).toBe(422);
    expect((await call('POST', '/tasks/suspend', { days: 0 })).status).toBe(422);
    expect((await call('POST', '/tasks/suspend', { hours: 8761 })).status).toBe(422);
    expect((await call('GET', '/tasks?limit=201')).status).toBe(422);
    expect((await call('GET', '/tasks?offset=-1')).status).toBe(422);
    expect((await call('GET', '/tasks?state=bogus')).status).toBe(422);
    expect((await call('POST', '/capture', { text: 'x'.repeat(2001) })).status).toBe(422);
    expect((await call('POST', '/tasks/start', { ref: 'a:1', extra: 1 })).status).toBe(422);
  });

  it('rejects unknown query params on every route', async () => {
    for (const r of ROUTES) {
      const path = r.doc.replace(/\{\w+\}/g, 'alpha:1');
      const res = await call(r.method, `${path}?bogusParam=1`, r.body ? {} : undefined);
      expect([r.name, res.status]).toEqual([r.name, 422]);
    }
  });

  it('keeps the Ref pattern, README reservation and parseRef in step', () => {
    const re = new RegExp(doc.components.schemas.Ref.pattern);
    for (const v of ['alpha:12', 'README:1', 'readme:1', 'ReadMe:1', 'readme2:1', '.x:1', 'a/b:1', 'a:0x', 'a:1234567890']) {
      expect([v, re.test(v)]).toEqual([v, parseRef(v) !== null]);
    }
  });

  it('types /next task as a nullable allOf wrapper, not $ref siblings', () => {
    const t = doc.paths['/next'].get.responses['200'].content['application/json'].schema.properties.task;
    expect(t).toEqual({ allOf: [{ $ref: '#/components/schemas/NextTask' }], nullable: true });
  });

  it('types capture spec.recurrence and rejects wrong shapes', () => {
    const rec = resolve(doc.components.schemas.CaptureResult).properties.spec.properties.recurrence;
    expect(Object.keys(rec.properties).sort()).toEqual(['anchor', 'cadence', 'nominalDay', 'offsetDays', 'offsetMonths', 'weekdays']);
    expect(conforms(rec, { cadence: 'weekly', weekdays: ['mon'] })).toEqual([]);
    expect(conforms(rec, { cadence: 'quarterly', anchor: 'end-of-month', offsetMonths: 1 })).toEqual([]);
    expect(conforms(rec, { cadence: 'hourly' })).not.toEqual([]);
    expect(conforms(rec, { cadence: 'daily', bogus: 1 })).not.toEqual([]);
    expect(conforms(rec, { weekdays: ['funday'] })).not.toEqual([]);
  });
});
