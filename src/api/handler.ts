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
import { applyTriage, authorizeEdit, authorizeMutation, claimTask, OUTCOMES, recordResult, TriageDenied, type ResultInput, type Suggestion } from '../core/triage';
import type { Storage } from '../core/storage';
import { agentActivity, type PrStatusProvider } from '../core/activity';
import type { CalendarProvider } from '../calendar';
import { answerAsk, ASK_ANSWERS, ASK_KINDS, ASK_OUTCOMES, ASK_PRIORITIES, handleAsk, LIST_STATES, listAsks, putAsk, type AnswerInput, type AskPut, type HandleInput } from '../core/asks';
import { currentRows, handleEntry, INBOX_KINDS, INBOX_STATES, listInbox, sendToInbox, type InboxKind } from '../core/inbox';
import { presentedToken } from './auth/authorize';
import type { AgentRuns } from '../agents/runs';
import { existsSync, statSync } from 'fs';
import { isAbsolute } from 'path';
import { generateSummaries } from '../core/summaries';
import { editTask, moveTask } from './edit';
import { ApiError, errorResponse, invalid, json, toApiError } from './errors';
import { parseFields, pick } from './fields';
import { ENUMS, formatRef, intParam, parseRef, readBody, readQuery, validate, type Spec } from './validate';

export interface RouteInfo { name: string; method: string; write: boolean }
/** An allowed token call names the token so writes can be attributed to it. */
export type AuthDecision = boolean | { allow: boolean; status?: 401 | 403; token?: { id: string; name: string } };
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
  /** Pull request state and checks for `GET /agents`; absent means links without status. @req FR:agent-inbox/activity.status */
  prs?: PrStatusProvider;
  /** Live agent sessions on this machine; absent on hosts that cannot run agents (every sessions.* route is then 404). @req FR:agent-sessions/driver.interface */
  agents?: AgentRuns;
  /** Today's meetings for the day plan; absent means no calendar. @req FR:day-inputs/api.calendar */
  calendar?: CalendarProvider;
  /** Called with unexpected errors (they are never sent to the caller). */
  onError?: (e: unknown) => void;
}

type Ctx = { deps: ApiDeps; life: LifecycleContext; req: Request; url: URL; params: string[]; /** Set when the request was allowed by an API token. */ token?: { id: string; name: string } };
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

/** Owner session: principal header and no token. */
const isOwner = (req: Request): boolean => caller(req).actor === 'owner';

const FIELDS_Q: Record<string, Spec> = { fields: { t: 'str' } };
const STATES = ['open', 'done', 'all'] as const;
/** Documented defaults for query parameters; shared with the OpenAPI document. */
export const QUERY_DEFAULTS = { state: 'open', limit: 50, offset: 0 } as const;
const LIST_Q: Record<string, Spec> = {
  project: { t: 'str' }, section: { t: 'str' }, state: { t: 'enum', values: STATES }, q: { t: 'str' },
  limit: { t: 'int', min: 1, max: 200 }, offset: { t: 'int', min: 0, max: 1_000_000 }, ...FIELDS_Q,
};
const EXPECT = { t: 'str', max: 2000, line: true } as const;
const ADD_BODY = {
  schema: {
    project: { t: 'str', required: true, max: 200, line: true }, text: { t: 'str', required: true, line: true },
    section: { t: 'str', max: 200, line: true }, parent: REF, expect: EXPECT,
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
const INBOX_BODY = {
  schema: { ref: REF, text: { t: 'str', required: true, max: 1000, line: true }, kind: { t: 'enum', values: INBOX_KINDS }, expect: { t: 'str', max: 2000, line: true } } satisfies Record<string, Spec>,
  required: ['ref', 'text'],
};
const CAL_Q: Record<string, Spec> = { from: { t: 'str', max: 40 }, to: { t: 'str', max: 40 } };
const INBOX_Q: Record<string, Spec> = { project: { t: 'str', max: 200 }, state: { t: 'enum', values: INBOX_STATES } };
const HANDLED_BODY = { schema: { id: { t: 'str', required: true, max: 64, line: true, pattern: /^in-[0-9TZ]+-[0-9a-f]{4,}$/ }, note: { t: 'str', max: 500, line: true } } satisfies Record<string, Spec>, required: ['id'] };
const ASK_PUT_BODY = {
  schema: {
    ask: { t: 'str', max: 200, line: true }, kind: { t: 'enum', values: ASK_KINDS }, from: { t: 'str', max: 80, line: true }, project: { t: 'str', max: 80, line: true },
    why: { t: 'str', max: 500, line: true }, recommend: { t: 'str', max: 200, line: true }, options: { t: 'strs', max: 4, commas: true }, default: { t: 'str', max: 200, line: true },
    by: { t: 'str', max: 40, line: true, pattern: /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/ }, reversible: { t: 'bool' },
    link: { t: 'str', max: 2000, line: true, pattern: /^https:\/\/[^\s]+$/ }, priority: { t: 'enum', values: ASK_PRIORITIES },
    effort: { t: 'str', max: 4, line: true, pattern: /^\d{1,3}[mh]$/ }, blocks: { t: 'int', min: 0, max: 99 }, detail: { t: 'str', max: 20_000 }, reopen: { t: 'bool' },
  } satisfies Record<string, Spec>,
  required: [] as string[],
};
const ASK_ANSWER_BODY = {
  schema: { answer: { t: 'enum', values: ASK_ANSWERS }, text: { t: 'str', max: 1000, line: true }, until: { t: 'str', max: 40, line: true } } satisfies Record<string, Spec>,
  required: ['answer'],
};
const ASK_HANDLE_BODY = {
  schema: { outcome: { t: 'enum', values: ASK_OUTCOMES }, note: { t: 'str', max: 500, line: true }, reply: { t: 'str', max: 1000, line: true } } satisfies Record<string, Spec>,
  required: ['outcome'],
};
const UUID: Spec = { t: 'str', required: true, max: 36, line: true, pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i };
const SESSIONS_Q: Record<string, Spec> = { limit: { t: 'int', min: 1, max: 200 } };
const COST_Q: Record<string, Spec> = { days: { t: 'int', min: 1, max: 90 } };
const PROMPT_BODY = { schema: { text: { t: 'str', required: true, max: 4000 } } satisfies Record<string, Spec>, required: ['text'] };
const NEW_SESSION_BODY = { schema: { cwd: { t: 'str', required: true, max: 1000, line: true }, text: { t: 'str', required: true, max: 4000 } } satisfies Record<string, Spec>, required: ['cwd', 'text'] };
const ASK_Q: Record<string, Spec> = { state: { t: 'enum', values: LIST_STATES }, limit: { t: 'int', min: 1, max: 200 } };
/** Inbox refs are stored 1-based with the file path; the api speaks `name:line` (0-based). */
const apiRef = (fileRef: string) => { const m = /^(tasks\/.+\.md):(\d+)$/.exec(fileRef); return m ? formatRef({ path: m[1], line: Number(m[2]) - 1 }) : fileRef; };
const REMOVE_BODY = { schema: { project: { t: 'str', max: 200, line: true } } satisfies Record<string, Spec>, required: [] as string[] };
const EDIT_BODY = { schema: { ref: REF, text: { t: 'str', required: true, max: 2000, line: true }, expect: EXPECT } satisfies Record<string, Spec>, required: ['ref', 'text'] };
const MOVE_BODY = {
  schema: { ref: REF, target: REF, position: { t: 'enum', values: ['before', 'after'] }, expect: EXPECT, expectTarget: EXPECT } satisfies Record<string, Spec>,
  required: ['ref', 'target', 'position'],
};
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

const fmtEdit = (r: { changed: boolean; ref: Parameters<typeof formatRef>[0]; before?: string; after?: string; message: string }) =>
  ({ changed: r.changed, ref: formatRef(r.ref), before: r.before, after: r.after, message: r.message });

const noQuery = (c: Ctx) => { readQuery(c.url, []); };
/** The agent runs for this host, or 404 (the route does not exist where no agent can run). @req FR:agent-sessions/driver.interface */
const agentsOf = (c: Ctx): AgentRuns => { if (!c.deps.agents) throw new ApiError('not_found', 'Not found'); return c.deps.agents; };
const sessionId = (c: Ctx): string => { const id = c.params[0]; const bad = validate<{ id: string }>({ id }, { id: UUID }, ['id']); return bad.id; };
const ownerOnly = (c: Ctx, why: string) => { if (!isOwner(c.req)) throw new ApiError('forbidden', why); };

/** `ref` is optional for actions that fall back to the core's own target choice. */
async function action(c: Ctx, name: (typeof ACTIONS)[number]): Promise<Response> {
  noQuery(c);
  const body = await readBody(c.req);
  const b = validate<Record<string, unknown> & { ref?: ReturnType<typeof parseRef> }>(body, ACTION_BODIES[name].schema, ACTION_BODIES[name].required);
  let ref = b.ref ?? undefined;
  noAutonomyMark('summary', b.summary);
  // Agents (anyone but the owner session) pass the autonomy gate first. @req FR:ai-triage-assist/autonomy.mutations
  if (!isOwner(c.req)) {
    if (name === 'skip' || name === 'resume' || name === 'suspend') throw new TriageDenied('Owner only');
    if (!ref) throw invalid([{ field: 'ref', message: 'Required' }]);
    if (name === 'complete' && b.remove) throw new TriageDenied('Owner only');
    const { ref: _r, clearEmojis, ...rest } = b;
    void _r;
    ref = await authorizeMutation(c.life, ref, name, name === 'set' ? { ...rest, ...(clearEmojis !== undefined ? { removeAllEmojis: clearEmojis as boolean } : {}) } as TaskProps : {});
  }
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
/** @req FR:auth-security/docs.routes (the table the security tests iterate) */
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
      const b = validate<{ project: string; text: string; section?: string; parent?: ReturnType<typeof parseRef>; expect?: string }>(await readBody(c.req), ADD_BODY.schema, ADD_BODY.required);
      noAutonomyMark('text', b.text);
      if (b.expect !== undefined && !b.parent) throw invalid([{ field: 'expect', message: 'expect needs parent' }]);
      const parent = b.parent ? { ...b.parent, ...(b.expect !== undefined ? { text: b.expect } : {}) } : undefined;
      return result(await addTask(c.life, { project: b.project, text: b.text, section: b.section, parent }), 201);
    },
  },
  {
    // @req FR:quick-capture/api.route
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
    method: 'POST', doc: '/tasks/edit', name: 'tasks.edit', body: EDIT_BODY,
    async run(c) {
      noQuery(c);
      const b = validate<{ ref: NonNullable<ReturnType<typeof parseRef>>; text: string; expect?: string }>(await readBody(c.req), EDIT_BODY.schema, EDIT_BODY.required);
      noAutonomyMark('text', b.text);
      let expect = b.expect;
      let chain: string[] | undefined;
      if (!isOwner(c.req)) {
        const cur = await authorizeEdit(c.life, b.ref, b.text);
        if (b.expect !== undefined && b.expect !== cur.text) throw new ApiError('conflict', 'Conflict');
        expect = cur.text;
        chain = cur.chain;
      }
      return json(200, fmtEdit(await editTask(c.deps.storage, b.ref, b.text, expect, chain)));
    },
  },
  {
    method: 'POST', doc: '/tasks/move', name: 'tasks.move', body: MOVE_BODY,
    async run(c) {
      noQuery(c);
      const b = validate<{ ref: NonNullable<ReturnType<typeof parseRef>>; target: NonNullable<ReturnType<typeof parseRef>>; position: 'before' | 'after'; expect?: string; expectTarget?: string }>(await readBody(c.req), MOVE_BODY.schema, MOVE_BODY.required);
      if (!isOwner(c.req)) throw new ApiError('forbidden', 'Forbidden');
      return json(200, fmtEdit(await moveTask(c.deps.storage, b.ref, b.target, b.position, { ref: b.expect, target: b.expectTarget })));
    },
  },
  {
    method: 'POST', doc: '/tasks/remove-completed', name: 'tasks.removeCompleted', body: REMOVE_BODY,
    async run(c) {
      noQuery(c);
      if (!isOwner(c.req)) throw new TriageDenied('Owner only');
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
    // @req FR:agent-inbox/api.send
    method: 'POST', doc: '/inbox', name: 'inbox.send', body: INBOX_BODY,
    async run(c) {
      noQuery(c);
      const b = validate<{ ref: NonNullable<ReturnType<typeof parseRef>>; text: string; kind?: InboxKind; expect?: string }>(await readBody(c.req), INBOX_BODY.schema, INBOX_BODY.required);
      // Only the owner speaks in the inbox; an agent token must never write words in the owner's voice.
      if (!isOwner(c.req)) throw new ApiError('forbidden', 'Only the owner can write to an agent inbox');
      return json(201, await sendToInbox(c.life, b.ref, b.text, b.kind ?? 'reply', b.expect));
    },
  },
  {
    // @req FR:agent-inbox/api.list
    method: 'GET', doc: '/inbox', name: 'inbox.list', query: INBOX_Q,
    async run(c) {
      const q = readQuery(c.url, Object.keys(INBOX_Q));
      const v = validate<{ project?: string; state?: (typeof INBOX_STATES)[number] }>(Object.fromEntries(q.entries()), INBOX_Q, []);
      const items = await listInbox(c.life, { project: v.project, state: v.state });
      const rows = await currentRows(c.life, items);
      return json(200, { items: items.map((e) => { const row = rows.get(e.id); return { ...e, ref: apiRef(e.ref), ...(row ? { row: apiRef(row) } : {}) }; }) });
    },
  },
  {
    // @req FR:agent-inbox/api.handle
    method: 'POST', doc: '/inbox/handled', name: 'inbox.handle', body: HANDLED_BODY,
    async run(c) {
      noQuery(c);
      const b = validate<{ id: string; note?: string }>(await readBody(c.req), HANDLED_BODY.schema, HANDLED_BODY.required);
      return json(200, await handleEntry(c.life, b.id, caller(c.req).actor, b.note));
    },
  },
  {
    // @req FR:ask-queue/api.list
    method: 'GET', doc: '/asks', name: 'asks.list', query: ASK_Q,
    async run(c) {
      const q = readQuery(c.url, Object.keys(ASK_Q));
      const v = validate<{ state?: (typeof LIST_STATES)[number] }>(Object.fromEntries([...q.entries()].filter(([k]) => k === 'state')), ASK_Q, []);
      return json(200, await listAsks(c.life, { state: v.state, limit: intParam(q, 'limit', 50, 1, 200) }));
    },
  },
  {
    // @req FR:ask-queue/api.put
    method: 'POST', doc: '/asks/{key}', name: 'asks.put', body: ASK_PUT_BODY,
    async run(c) {
      noQuery(c);
      const b = validate<AskPut>(await readBody(c.req), ASK_PUT_BODY.schema, ASK_PUT_BODY.required);
      // A token names its agent (the token's name); the owner session writes as `owner`.
      const actor = caller(c.req).actor;
      return json(200, await putAsk(c.life, c.params[0], b, actor.startsWith('token:') ? (c.token?.name ?? 'agent') : actor));
    },
  },
  {
    // @req FR:ask-queue/api.answer
    method: 'POST', doc: '/asks/{key}/answer', name: 'asks.answer', body: ASK_ANSWER_BODY,
    async run(c) {
      noQuery(c);
      const b = validate<AnswerInput>(await readBody(c.req), ASK_ANSWER_BODY.schema, ASK_ANSWER_BODY.required);
      // Only the owner answers; an agent token must never answer in the owner's voice.
      if (!isOwner(c.req)) throw new ApiError('forbidden', 'Only the owner can answer an ask');
      return json(200, await answerAsk(c.life, c.params[0], b));
    },
  },
  {
    // @req FR:ask-queue/api.handle
    method: 'POST', doc: '/asks/{key}/handle', name: 'asks.handle', body: ASK_HANDLE_BODY,
    async run(c) {
      noQuery(c);
      const b = validate<HandleInput>(await readBody(c.req), ASK_HANDLE_BODY.schema, ASK_HANDLE_BODY.required);
      return json(200, await handleAsk(c.life, c.params[0], b, caller(c.req).actor));
    },
  },
  // ---- agent sessions (404 without a driver) @req FR:agent-sessions/driver.interface
  {
    // @req FR:agent-sessions/sessions.list
    method: 'GET', doc: '/sessions', name: 'sessions.list', query: SESSIONS_Q,
    async run(c) {
      const q = readQuery(c.url, Object.keys(SESSIONS_Q));
      const agents = agentsOf(c);
      return json(200, await agents.sessions({ limit: intParam(q, 'limit', 50, 1, 200) }));
    },
  },
  {
    // @req FR:agent-sessions/sessions.cost
    method: 'GET', doc: '/sessions/cost', name: 'sessions.cost', query: COST_Q,
    async run(c) {
      const q = readQuery(c.url, Object.keys(COST_Q));
      const agents = agentsOf(c);
      return json(200, await agents.cost(intParam(q, 'days', 7, 1, 90)));
    },
  },
  {
    // @req FR:agent-sessions/sessions.messages
    method: 'GET', doc: '/sessions/{id}/messages', name: 'sessions.messages', query: SESSIONS_Q,
    async run(c) {
      const q = readQuery(c.url, Object.keys(SESSIONS_Q));
      const id = sessionId(c);
      const agents = agentsOf(c);
      return json(200, { items: await agents.messages(id, { limit: intParam(q, 'limit', 30, 1, 200) }) });
    },
  },
  {
    // @req FR:agent-sessions/run.prompt
    method: 'POST', doc: '/sessions', name: 'sessions.new', body: NEW_SESSION_BODY,
    async run(c) {
      noQuery(c);
      const b = validate<{ cwd: string; text: string }>(await readBody(c.req), NEW_SESSION_BODY.schema, NEW_SESSION_BODY.required);
      const agents = agentsOf(c);
      ownerOnly(c, 'Only the owner can message an agent');
      if (!isAbsolute(b.cwd) || !existsSync(b.cwd) || !statSync(b.cwd).isDirectory()) throw invalid([{ field: 'cwd', message: 'Must be an absolute path to an existing folder' }]);
      if (!b.text.trim()) throw invalid([{ field: 'text', message: 'Required' }]);
      return json(202, await agents.prompt({ cwd: b.cwd, text: b.text }));
    },
  },
  {
    // @req FR:agent-sessions/run.prompt
    method: 'POST', doc: '/sessions/{id}/prompt', name: 'sessions.prompt', body: PROMPT_BODY,
    async run(c) {
      noQuery(c);
      const b = validate<{ text: string }>(await readBody(c.req), PROMPT_BODY.schema, PROMPT_BODY.required);
      const id = sessionId(c);
      const agents = agentsOf(c);
      ownerOnly(c, 'Only the owner can message an agent');
      if (!b.text.trim()) throw invalid([{ field: 'text', message: 'Required' }]);
      return json(202, await agents.prompt({ sessionId: id, text: b.text }));
    },
  },
  {
    // @req FR:agent-sessions/run.cancel
    method: 'POST', doc: '/sessions/{id}/cancel', name: 'sessions.cancel',
    async run(c) {
      noQuery(c);
      const id = sessionId(c);
      const agents = agentsOf(c);
      ownerOnly(c, 'Only the owner can stop an agent');
      return json(200, await agents.cancel(id));
    },
  },
  {
    // @req FR:day-inputs/api.calendar
    method: 'GET', doc: '/calendar', name: 'calendar.list', query: CAL_Q,
    async run(c) {
      const q = readQuery(c.url, Object.keys(CAL_Q));
      const from = Date.parse(q.get('from') ?? ''), to = Date.parse(q.get('to') ?? '');
      const iso = (v: string | null) => typeof v === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d{1,3})?)?(?:Z|[+-]\d\d:\d\d)$/.test(v);
      if (!iso(q.get('from')) || !iso(q.get('to')) || !(from < to) || to - from > 7 * 864e5) throw invalid([{ field: 'from', message: 'from and to must be ISO date-times, from before to, at most 7 days apart' }]);
      // Calendars hold personal data: the owner only.
      if (!isOwner(c.req)) throw new ApiError('forbidden', 'Only the owner can read the calendar');
      if (!c.deps.calendar) return json(200, { configured: false, items: [] });
      try {
        return json(200, { configured: true, items: await c.deps.calendar.events(new Date(from).toISOString(), new Date(to).toISOString()) });
      } catch (e) {
        c.deps.onError?.(e);
        return json(200, { configured: true, items: [], error: 'Calendar unavailable' });
      }
    },
  },
  {
    // @req FR:agent-inbox/api.agents
    method: 'GET', doc: '/agents', name: 'agents.list',
    async run(c) {
      readQuery(c.url, []);
      return json(200, { items: await agentActivity({ ...c.life, prs: c.deps.prs }) });
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
      // @req FR:api/input.noforce (never overwrites; force is not exposed)
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
      let token: Ctx['token'];
      if (!deps.authorize) denied = new ApiError('unauthorized', 'Authentication required');
      else {
        try {
          const d = await deps.authorize(req.clone(), { name: hit?.r.name ?? 'unknown', method, write: hit ? hit.r.method !== 'GET' : method !== 'GET' && method !== 'HEAD' });
          denied = decide(d);
          if (!denied && typeof d === 'object' && d.token) token = d.token;
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
      return await hit.r.run({ deps, life, req, url, params, ...(token ? { token } : {}) });
    } catch (e) {
      const err = toApiError(e);
      if (err.code === 'internal') deps.onError?.(e);
      return errorResponse(err);
    }
  };
}
