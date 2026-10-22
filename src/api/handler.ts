/**
 * Framework-neutral REST handler over the core. Pure (Request) -> Response; storage is injected.
 * @req FR:api/handler.@function
 */
import { getDefaults, type StackConfig } from '../core/config';
import {
  addProject, addTask, completeTask, nextTask, removeCompleted, resumeTask, setProperties, skipTask, startTask, suspendTask,
  type LifecycleContext, type LifecycleResult, type TaskProps,
} from '../core/lifecycle';
import { parseProject, type Project, type Task } from '../core/parser';
import { captureTask, CaptureError } from '../core/quick-capture';
import { applyTriage, claimTask, OUTCOMES, recordResult, type ResultInput, type Suggestion } from '../core/triage';
import type { Storage } from '../core/storage';
import { presentedToken } from './auth/authorize';
import { generateSummaries } from '../core/summaries';
import { ApiError, errorResponse, invalid, json, toApiError } from './errors';
import { parseFields, pick } from './fields';
import { ENUMS, formatRef, intParam, parseRef, readBody, readQuery, validate, type Spec } from './validate';

export interface RouteInfo { name: string; method: string; write: boolean }
export type AuthDecision = boolean | { allow: boolean; status?: 401 | 403 };
/** @req FR:api/auth.hook */
export type Authorize = (req: Request, route: RouteInfo) => AuthDecision | Promise<AuthDecision>;

export interface ApiDeps {
  storage: Storage;
  config?: StackConfig;
  now?: () => Date;
  engine?: string;
  /** Deny-by-default: when absent every request gets 401. */
  authorize?: Authorize;
  basePath?: string;
  /** Called with unexpected errors (they are never sent to the caller). */
  onError?: (e: unknown) => void;
}

type Ctx = { deps: ApiDeps; life: LifecycleContext; req: Request; url: URL; params: string[] };
interface Route {
  method: 'GET' | 'POST';
  /** Path relative to basePath, with `{param}` placeholders; also the OpenAPI path key. */
  doc: string;
  name: string;
  /** Accepted query parameters (all optional); drives validation and the OpenAPI document. */
  query?: Record<string, Spec>;
  /** JSON body schema; drives validation and the OpenAPI document. */
  body?: { schema: Record<string, Spec>; required: string[] };
  run: (c: Ctx) => Promise<Response>;
}

const ACTIONS = ['start', 'complete', 'skip', 'resume', 'suspend', 'set'] as const;
const PROPS: Record<string, Spec> = {
  status: { t: 'enum', values: ENUMS.status }, priority: { t: 'enum', values: ENUMS.priority },
  effort: { t: 'enum', values: ENUMS.effort }, impact: { t: 'enum', values: ENUMS.impact },
  checkbox: { t: 'enum', values: ENUMS.checkbox },
  suspend: { t: 'str', max: 40, pattern: /^(?:|[A-Za-z]{3} \d{1,2}(?: \d{2}:\d{2})?|\d{1,2}:\d{2})$/ }, clearEmojis: { t: 'bool' },
};
const REF: Spec = { t: 'ref' };
const some = (v: readonly string[]): Spec => ({ t: 'enum', values: v.filter((x) => x !== 'None') });
const LINE200: Spec = { t: 'str', max: 200, line: true };
/** Who is acting, from the authenticated request: the API token id, the owner session, or a bare `api` caller. Never from the body. */
const caller = (req: Request) => {
  const tok = presentedToken(req);
  const id = tok === null ? null : /^stk_([0-9a-f]{16})\./.exec(tok)?.[1];
  return { actor: id ? `token:${id}` : req.headers.has('x-ms-client-principal') ? 'owner' : 'api' };
};
/** Only the owner sets autonomy, so no agent-reachable write may carry the marker. @req FR:ai-triage-assist/autonomy.set */
const noAutonomyMark = (field: string, v: unknown): void => {
  if (typeof v === 'string' && v.replace(/[\uFE0E\uFE0F\u200B-\u200F\u2060\uFEFF\u00AD]/g, '').includes('🤖')) throw invalid([{ field, message: 'Cannot contain the 🤖 autonomy marker' }]);
};

const FIELDS_Q: Record<string, Spec> = { fields: { t: 'str' } };
const STATES = ['open', 'done', 'all'] as const;
/** Documented defaults for query parameters; shared with the OpenAPI document. */
export const QUERY_DEFAULTS = { state: 'open', limit: 50, offset: 0 } as const;
const LIST_Q: Record<string, Spec> = {
  project: { t: 'str' }, section: { t: 'str' }, state: { t: 'enum', values: STATES }, q: { t: 'str' },
  limit: { t: 'int', min: 1, max: 200 }, offset: { t: 'int', min: 0, max: 1_000_000 }, ...FIELDS_Q,
};
const ADD_BODY = {
  schema: {
    project: { t: 'str', required: true, max: 200, line: true }, text: { t: 'str', required: true, line: true },
    section: { t: 'str', max: 200, line: true }, parent: REF,
  } satisfies Record<string, Spec>,
  required: ['project', 'text'],
};
const CAPTURE_BODY = {
  schema: {
    text: { t: 'str', required: true, line: true }, project: { t: 'str', max: 200, line: true },
    section: { t: 'str', max: 200, line: true }, dryRun: { t: 'bool' },
  } satisfies Record<string, Spec>,
  required: ['text'],
};
const ACTION_BODIES: Record<(typeof ACTIONS)[number], { schema: Record<string, Spec>; required: string[] }> = {
  start: { schema: { ref: REF }, required: [] },
  skip: { schema: { ref: REF }, required: [] },
  resume: { schema: { ref: REF }, required: [] },
  complete: { schema: { ref: REF, summary: { t: 'str', max: 10000, line: true }, remove: { t: 'bool' } }, required: [] },
  suspend: { schema: { ref: REF, days: { t: 'int', min: 1, max: 365 }, hours: { t: 'int', min: 1, max: 8760 } }, required: [] },
  set: { schema: { ref: REF, ...PROPS }, required: ['ref'] },
};
const TRIAGE_BODY = {
  schema: {
    ref: REF, agent: LINE200, human: LINE200, priority: some(ENUMS.priority), effort: some(ENUMS.effort), impact: some(ENUMS.impact),
  } satisfies Record<string, Spec>,
  required: ['ref'],
};
const CLAIM_BODY = { schema: { ref: REF } satisfies Record<string, Spec>, required: ['ref'] };
const RESULT_BODY = {
  schema: {
    ref: REF, outcome: { t: 'enum', values: OUTCOMES }, summary: { t: 'str', required: true, max: 500, line: true },
    complete: { t: 'bool' }, human: LINE200,
  } satisfies Record<string, Spec>,
  required: ['ref', 'outcome', 'summary'],
};
const REMOVE_BODY = { schema: { project: { t: 'str', max: 200, line: true } } satisfies Record<string, Spec>, required: [] as string[] };
const PROJECT_BODY = {
  schema: {
    name: { t: 'str', required: true, max: 200, line: true }, description: { t: 'str', max: 2000, line: true },
    repositoryUrl: { t: 'str', line: true, pattern: /^https?:\/\/[^\s()[\]<>]+$/ }, aliases: { t: 'strs' },
    priority: { t: 'num', min: 0, max: 1_000_000 }, capacity: { t: 'caps' }, weeklyCapacity: { t: 'num', min: 0, max: 168 },
    fileName: { t: 'str', max: 100, noReadme: true, pattern: /^[A-Za-z0-9][A-Za-z0-9._-]*$/ },
  } satisfies Record<string, Spec>,
  required: ['name'],
};

// ------------------------------------------------------------------ data views

interface Doc { name: string; path: string; content: string; project: Project }
const baseName = (p: string) => p.replace(/^.*\//, '').replace(/\.md$/, '');
const key = (h: string) => h.replace(/^[^\p{L}\p{N}]+/u, '').trim().toLowerCase();

async function loadDocs(storage: Storage): Promise<Doc[]> {
  const docs: Doc[] = [];
  for (const path of (await storage.list()).filter((p) => baseName(p).toLowerCase() !== 'readme')) {
    const f = await storage.read(path);
    docs.push({ name: baseName(path), path, content: f.content, project: parseProject(f.content) });
  }
  return docs;
}

interface TaskView { ref: string; text: string; project: string; section: string; done: boolean; depth: number; notes: string[] }
const TASK_FIELDS = ['ref', 'text', 'project', 'section', 'done', 'depth', 'notes'] as const;
const TASK_DEFAULT = ['ref', 'text', 'project', 'section', 'done'];

function flatten(doc: Doc): TaskView[] {
  const out: TaskView[] = [];
  const walk = (ts: Task[], section: string, depth: number) => {
    for (const t of ts) {
      if (t.text.trim() !== '') {
        out.push({ ref: formatRef({ path: doc.path, line: t.line }), text: t.text, project: doc.name, section, done: t.checked, depth, notes: t.notes });
      }
      walk(t.children, section, depth + 1);
    }
  };
  for (const s of doc.project.sections) walk(s.tasks, s.heading, 0);
  return out;
}

const counts = (ts: TaskView[]) => ({ open: ts.filter((t) => !t.done).length, done: ts.filter((t) => t.done).length });
const PROJECT_FIELDS = ['name', 'title', 'open', 'done', 'aliases', 'metadata', 'sections'] as const;
const PROJECT_DEFAULT = ['name', 'title', 'open', 'done'];

function projectView(doc: Doc) {
  const all = flatten(doc);
  const sections = doc.project.sections.map((s) => ({ heading: s.heading, ...counts(all.filter((t) => t.section === s.heading)) }));
  return {
    name: doc.name, title: doc.project.title, ...counts(all),
    aliases: (doc.project.metadata['Aliases'] ?? '').split(',').map((a) => a.trim()).filter(Boolean),
    metadata: doc.project.metadata, sections,
  };
}

// ------------------------------------------------------------------ handlers

const result = (r: LifecycleResult, status = 200) =>
  json(status, { changed: r.changed, ref: r.ref ? formatRef(r.ref) : undefined, before: r.before, after: r.after, message: r.message });

const noQuery = (c: Ctx) => { readQuery(c.url, []); };

/** `ref` is optional for actions that fall back to the core's own target choice. */
async function action(c: Ctx, name: (typeof ACTIONS)[number]): Promise<Response> {
  noQuery(c);
  const body = await readBody(c.req);
  const b = validate<Record<string, unknown> & { ref?: ReturnType<typeof parseRef> }>(body, ACTION_BODIES[name].schema, ACTION_BODIES[name].required);
  const ref = b.ref ?? undefined;
  noAutonomyMark('summary', b.summary);
  switch (name) {
    case 'start': return result(await startTask(c.life, ref));
    case 'skip': return result(await skipTask(c.life, ref));
    case 'resume': return result(await resumeTask(c.life, ref));
    case 'complete': return result(await completeTask(c.life, ref, { summary: b.summary as string | undefined, remove: b.remove as boolean | undefined }));
    case 'suspend': return result(await suspendTask(c.life, ref, { days: b.days as number | undefined, hours: b.hours as number | undefined }));
    case 'set': {
      const { ref: _r, clearEmojis, ...rest } = b;
      void _r;
      return result(await setProperties(c.life, ref!, { ...rest, ...(clearEmojis !== undefined ? { removeAllEmojis: clearEmojis as boolean } : {}) } as TaskProps));
    }
  }
}

const actionRoutes: Route[] = ACTIONS.map((a) => ({
  method: 'POST', doc: `/tasks/${a}`, name: `tasks.${a}`, body: ACTION_BODIES[a], run: (c) => action(c, a),
}));

/** @req FR:ai-triage-assist/api.routes @req FR:api/routes.next @req FR:api/routes.add @req FR:api/routes.actions @req FR:api/routes.remove @req FR:api/routes.tasks @req FR:api/routes.projects @req FR:api/routes.summaries */
export const ROUTES: Route[] = [
  {
    method: 'GET', doc: '/next', name: 'next', query: FIELDS_Q,
    async run(c) {
      const q = readQuery(c.url, Object.keys(FIELDS_Q));
      const fields = parseFields(q.get('fields'), ['ref', 'text', 'project', 'score']) ?? ['ref', 'text', 'project', 'score'];
      const n = await nextTask(c.life);
      return json(200, { task: n ? pick({ ref: formatRef(n.ref), text: n.text, project: n.project, score: n.score }, fields) : null });
    },
  },
  {
    method: 'GET', doc: '/tasks', name: 'tasks.list', query: LIST_Q,
    async run(c) {
      const q = readQuery(c.url, Object.keys(LIST_Q));
      const fields = parseFields(q.get('fields'), TASK_FIELDS) ?? TASK_DEFAULT;
      const state = q.get('state') ?? QUERY_DEFAULTS.state;
      if (!(STATES as readonly string[]).includes(state)) throw invalid([{ field: 'state', message: 'Must be open, done, or all' }]);
      const limit = intParam(q, 'limit', QUERY_DEFAULTS.limit, 1, 200);
      const offset = intParam(q, 'offset', QUERY_DEFAULTS.offset, 0, 1_000_000);
      const project = q.get('project')?.toLowerCase();
      const section = q.get('section') === null ? null : key(q.get('section')!);
      const text = q.get('q')?.toLowerCase();
      const docs = (await loadDocs(c.deps.storage)).filter((d) => project === undefined || d.name.toLowerCase() === project);
      const all = docs.flatMap(flatten).filter((t) =>
        (state === 'all' || (state === 'done') === t.done) &&
        (section === null || key(t.section) === section) &&
        (text === undefined || t.text.toLowerCase().includes(text)));
      return json(200, { items: all.slice(offset, offset + limit).map((t) => pick(t, fields)), total: all.length, offset, limit });
    },
  },
  {
    method: 'GET', doc: '/tasks/{ref}', name: 'tasks.get', query: FIELDS_Q,
    async run(c) {
      const q = readQuery(c.url, Object.keys(FIELDS_Q));
      const fields = parseFields(q.get('fields'), TASK_FIELDS) ?? TASK_DEFAULT;
      const ref = parseRef(c.params[0]);
      if (!ref) throw invalid([{ field: 'ref', message: 'Must be project:line' }]);
      const f = await c.deps.storage.read(ref.path);
      const doc: Doc = { name: baseName(ref.path), path: ref.path, content: f.content, project: parseProject(f.content) };
      const t = flatten(doc).find((x) => x.ref === c.params[0]);
      if (!t) throw new ApiError('not_found', 'Task not found');
      return json(200, pick(t, fields));
    },
  },
  {
    method: 'POST', doc: '/tasks', name: 'tasks.add', body: ADD_BODY,
    async run(c) {
      noQuery(c);
      const b = validate<{ project: string; text: string; section?: string; parent?: ReturnType<typeof parseRef> }>(await readBody(c.req), ADD_BODY.schema, ADD_BODY.required);
      noAutonomyMark('text', b.text);
      return result(await addTask(c.life, { project: b.project, text: b.text, section: b.section, parent: b.parent ?? undefined }), 201);
    },
  },
  {
    method: 'POST', doc: '/capture', name: 'capture', body: CAPTURE_BODY,
    async run(c) {
      noQuery(c);
      const b = validate<{ text: string; project?: string; section?: string; dryRun?: boolean }>(await readBody(c.req), CAPTURE_BODY.schema, CAPTURE_BODY.required);
      noAutonomyMark('text', b.text);
      try {
        const { result: r, spec } = await captureTask(c.life, b.text, { project: b.project, section: b.section, dryRun: b.dryRun });
        return json(b.dryRun ? 200 : 201, { changed: r.changed, ref: r.ref ? formatRef(r.ref) : undefined, after: r.after, spec });
      } catch (e) {
        if (e instanceof CaptureError) throw invalid([{ field: 'text', message: e.message }]);
        throw e;
      }
    },
  },
  ...actionRoutes,
  {
    method: 'POST', doc: '/tasks/remove-completed', name: 'tasks.removeCompleted', body: REMOVE_BODY,
    async run(c) {
      noQuery(c);
      const b = validate<{ project?: string }>(await readBody(c.req), REMOVE_BODY.schema);
      return json(200, await removeCompleted(c.life, { project: b.project }));
    },
  },
  {
    method: 'POST', doc: '/tasks/triage', name: 'tasks.triage', body: TRIAGE_BODY,
    async run(c) {
      noQuery(c);
      const b = validate<Suggestion & { ref: NonNullable<ReturnType<typeof parseRef>> }>(await readBody(c.req), TRIAGE_BODY.schema, TRIAGE_BODY.required);
      const { ref, ...s } = b;
      const r = await applyTriage(c.life, ref, s, caller(c.req));
      return json(200, { changed: r.changed, ref: formatRef(r.ref), applied: r.applied, added: r.added.map(formatRef) });
    },
  },
  {
    method: 'POST', doc: '/tasks/claim', name: 'tasks.claim', body: CLAIM_BODY,
    async run(c) {
      noQuery(c);
      const b = validate<{ ref: NonNullable<ReturnType<typeof parseRef>> }>(await readBody(c.req), CLAIM_BODY.schema, CLAIM_BODY.required);
      const r = await claimTask(c.life, b.ref, caller(c.req));
      return json(200, { changed: r.changed, ref: formatRef(r.ref!) });
    },
  },
  {
    method: 'POST', doc: '/tasks/result', name: 'tasks.result', body: RESULT_BODY,
    async run(c) {
      noQuery(c);
      const b = validate<ResultInput & { ref: NonNullable<ReturnType<typeof parseRef>> }>(await readBody(c.req), RESULT_BODY.schema, RESULT_BODY.required);
      const { ref, ...r } = b;
      const out = await recordResult(c.life, ref, r, caller(c.req));
      return json(200, { logged: out.logged, completed: out.completed, deferred: out.deferred, ref: formatRef(out.ref), ...(out.human ? { human: formatRef(out.human) } : {}) });
    },
  },
  {
    method: 'GET', doc: '/projects', name: 'projects.list', query: FIELDS_Q,
    async run(c) {
      const q = readQuery(c.url, Object.keys(FIELDS_Q));
      const fields = parseFields(q.get('fields'), PROJECT_FIELDS) ?? PROJECT_DEFAULT;
      return json(200, { items: (await loadDocs(c.deps.storage)).map((d) => pick(projectView(d), fields)) });
    },
  },
  {
    method: 'GET', doc: '/projects/{name}', name: 'projects.get', query: FIELDS_Q,
    async run(c) {
      const q = readQuery(c.url, Object.keys(FIELDS_Q));
      const fields = parseFields(q.get('fields'), PROJECT_FIELDS) ?? PROJECT_DEFAULT;
      const name = c.params[0].toLowerCase();
      const doc = (await loadDocs(c.deps.storage)).find((d) => d.name.toLowerCase() === name);
      if (!doc) throw new ApiError('not_found', 'Project not found');
      return json(200, pick(projectView(doc), fields));
    },
  },
  {
    method: 'POST', doc: '/projects', name: 'projects.add', body: PROJECT_BODY,
    async run(c) {
      noQuery(c);
      const b = validate<Parameters<typeof addProject>[1]>(await readBody(c.req), PROJECT_BODY.schema, PROJECT_BODY.required);
      const { path } = await addProject(c.life, { ...b, force: false });
      return json(201, { path, project: baseName(path) });
    },
  },
  {
    method: 'GET', doc: '/summaries', name: 'summaries.get', query: FIELDS_Q,
    async run(c) {
      const q = readQuery(c.url, Object.keys(FIELDS_Q));
      const fields = parseFields(q.get('fields'), ['readme', 'stack', 'projects', 'myDay']) ?? ['readme', 'stack', 'projects', 'myDay'];
      const docs = await loadDocs(c.deps.storage);
      const s = generateSummaries({
        projects: docs.map((d) => ({ fileName: `${d.name}.md`, content: d.content })),
        config: c.deps.config ?? getDefaults(), now: (c.deps.now ?? (() => new Date()))(),
      });
      return json(200, pick(s, fields));
    },
  },
];

// ------------------------------------------------------------------ dispatch

const matchPath = (pattern: string, segs: string[]): string[] | null => {
  const p = pattern.split('/').slice(1);
  if (p.length !== segs.length) return null;
  const params: string[] = [];
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith('{')) params.push(segs[i]);
    else if (p[i] !== segs[i]) return null;
  }
  return params;
};

/** @req FR:api/auth.decision */
function decide(d: unknown): ApiError | null {
  if (d === true || (typeof d === 'object' && d !== null && (d as { allow?: unknown }).allow === true)) return null;
  if (typeof d === 'object' && d !== null && (d as { allow?: unknown }).allow === false && (d as { status?: unknown }).status === 401) {
    return new ApiError('unauthorized', 'Authentication required');
  }
  return new ApiError('forbidden', 'Forbidden');
}

/** @req FR:api/handler.@function @req FR:api/handler.storage @req FR:api/handler.base @req FR:api/auth.deny @req FR:api/auth.noleak */
export function createApiHandler(deps: ApiDeps): (req: Request) => Promise<Response> {
  const base = (deps.basePath ?? '/api').replace(/\/+$/, '');
  const life: LifecycleContext = { storage: deps.storage, config: deps.config, now: deps.now, engine: deps.engine };

  return async (req) => {
    try {
      const url = new URL(req.url);
      const method = req.method.toUpperCase();
      let rel: string | null = null;
      if (url.pathname === base || url.pathname.startsWith(`${base}/`)) rel = url.pathname.slice(base.length);
      const segs = (rel ?? '').split('/').filter(Boolean);
      let params: string[] = [];
      // A bad escape is reported only after authorization, so it cannot be probed anonymously.
      let badEncoding = false;
      try { params = []; segs.forEach((s, i) => { segs[i] = decodeURIComponent(s); }); } catch { badEncoding = true; segs.length = 0; }
      const here = rel === null ? [] : ROUTES.map((r) => ({ r, p: matchPath(r.doc, segs) })).filter((x) => x.p);
      const hit = here.find((x) => x.r.method === method);

      // Auth first: callers learn nothing about routes.
      let denied: ApiError | null;
      if (!deps.authorize) denied = new ApiError('unauthorized', 'Authentication required');
      else {
        try {
          denied = decide(await deps.authorize(req.clone(), { name: hit?.r.name ?? 'unknown', method, write: hit ? hit.r.method !== 'GET' : method !== 'GET' && method !== 'HEAD' }));
        } catch { denied = new ApiError('forbidden', 'Forbidden'); }
      }
      if (denied) return errorResponse(denied);
      if (badEncoding) throw new ApiError('bad_request', 'Malformed URL encoding');

      if (!hit) {
        if (here.length) {
          throw new ApiError('method_not_allowed', 'Method not allowed', undefined, { allow: [...new Set(here.map((x) => x.r.method))].sort().join(', ') });
        }
        throw new ApiError('not_found', 'Not found');
      }
      params = hit.p!;
      return await hit.r.run({ deps, life, req, url, params });
    } catch (e) {
      const err = toApiError(e);
      if (err.code === 'internal') deps.onError?.(e);
      return errorResponse(err);
    }
  };
}
