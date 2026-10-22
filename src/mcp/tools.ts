/**
 * Tool table: each tool is one API route. Calls are shaped-checked here and everything else
 * (field rules, lifecycle, authorization) is the API's.
 * @req FR:mcp-server/tools.api @req FR:mcp-server/tools.mutate
 */
import { ENUMS } from '../api/validate';

type Prop = Record<string, unknown>;
export interface ToolDef {
  name: string;
  /** API route name; its scope (from auth-security) is the tool's scope. */
  route: string;
  description: string;
  method: 'GET' | 'POST';
  path: string;
  props: Record<string, Prop>;
  required?: string[];
  /** Fixed query parameters added to every GET. */
  query?: Record<string, string>;
  /** Reply for a 2xx API body. */
  reply: (body: unknown) => string;
}

const str = (description: string, extra: Prop = {}): Prop => ({ type: 'string', description, ...extra });
const REF = str('project:line');
const enumOf = (v: readonly string[]): Prop => ({ type: 'string', enum: [...v] });

/** Only `project:line` refs from the API are ever echoed. */
const REF_OUT = /^[A-Za-z0-9._-]{1,200}:\d{1,9}$/;
const done = (verb: string) => (body: unknown): string => {
  const b = (typeof body === 'object' && body !== null ? body : {}) as { changed?: unknown; ref?: unknown };
  if (b.changed === false) return 'no change';
  return typeof b.ref === 'string' && REF_OUT.test(b.ref) ? `${verb} ${b.ref}` : verb;
};

const obj = (body: unknown): Record<string, unknown> => (typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {});

/** @req FR:mcp-server/tools.list @req FR:mcp-server/tools.mutate @req FR:mcp-server/tools.next @req FR:mcp-server/tools.list-tool */
export const TOOLS: ToolDef[] = [
  { name: 'next', route: 'next', method: 'GET', path: '/next', props: {}, query: { fields: 'ref,text,project,score' },
    description: 'Top-scored open task.',
    reply: (b) => {
      const t = obj(obj(b).task);
      return Object.keys(t).length ? JSON.stringify({ ref: t.ref, text: t.text, project: t.project, score: t.score }) : 'none';
    } },
  { name: 'list', route: 'tasks.list', method: 'GET', path: '/tasks', query: { fields: 'ref,text,project' },
    description: 'List tasks, newest page first by file order.',
    props: {
      project: str('Project name or alias'), section: str('Section heading'), state: enumOf(['open', 'done', 'all']),
      q: str('Text filter'), limit: { type: 'integer', minimum: 1, maximum: 100, description: 'Default 20' }, offset: { type: 'integer', minimum: 0 },
    },
    reply: (b) => {
      const o = obj(b);
      const items = Array.isArray(o.items) ? o.items.map((i) => { const r = obj(i); return [r.ref, r.text, r.project]; }) : [];
      return JSON.stringify({ total: o.total, offset: o.offset, items });
    } },
  { name: 'add', route: 'tasks.add', method: 'POST', path: '/tasks', required: ['project', 'text'],
    description: 'Add a task to a project.',
    props: { project: str('Project name or alias'), text: str('One line'), section: str('Section heading'), parent: str('Parent ref (project:line)') },
    reply: done('added') },
  { name: 'complete', route: 'tasks.complete', method: 'POST', path: '/tasks/complete',
    description: 'Complete a task (default: the active one).',
    props: { ref: REF, summary: str('One-line summary'), remove: { type: 'boolean' } }, reply: done('completed') },
  { name: 'start', route: 'tasks.start', method: 'POST', path: '/tasks/start',
    description: 'Start a task (default: next).', props: { ref: REF }, reply: done('started') },
  { name: 'skip', route: 'tasks.skip', method: 'POST', path: '/tasks/skip',
    description: 'Skip a task (default: active).', props: { ref: REF }, reply: done('skipped') },
  { name: 'resume', route: 'tasks.resume', method: 'POST', path: '/tasks/resume',
    description: 'Resume a suspended task.', props: { ref: REF }, reply: done('resumed') },
  { name: 'suspend', route: 'tasks.suspend', method: 'POST', path: '/tasks/suspend',
    description: 'Suspend a task for days or hours.',
    props: { ref: REF, days: { type: 'integer', minimum: 1, maximum: 365 }, hours: { type: 'integer', minimum: 1, maximum: 8760 } }, reply: done('suspended') },
  { name: 'set', route: 'tasks.set', method: 'POST', path: '/tasks/set', required: ['ref'],
    description: 'Set task status, priority, effort, or impact.',
    props: {
      ref: REF, status: enumOf(ENUMS.status), priority: enumOf(ENUMS.priority), effort: enumOf(ENUMS.effort), impact: enumOf(ENUMS.impact),
      checkbox: enumOf(ENUMS.checkbox), suspend: str('Suspend-until text'), clearEmojis: { type: 'boolean' },
    }, reply: done('updated') },
];

export const inputSchema = (t: ToolDef) => ({
  type: 'object' as const, properties: t.props, ...(t.required ? { required: t.required } : {}), additionalProperties: false as const,
});

// ------------------------------------------------------------------ calls

export class ArgError extends Error { constructor(readonly field: string, message: string) { super(message); } }

/** Shape check only: object, known names, scalar values. @req FR:mcp-server/tools.args */
export function checkArgs(t: ToolDef, raw: unknown): Record<string, string | number | boolean> {
  if (raw !== undefined && (typeof raw !== "object" || raw === null || Array.isArray(raw))) throw new ArgError('arguments', 'Must be an object');
  const out: Record<string, string | number | boolean> = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (!Object.prototype.hasOwnProperty.call(t.props, k)) throw new ArgError(k, 'Unknown field');
    if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') throw new ArgError(k, 'Must be a scalar value');
    out[k] = v;
  }
  if (t.name === 'list') {
    const l = out['limit'];
    if (l !== undefined && !(typeof l === 'number' && Number.isInteger(l) && l >= 1 && l <= 100)) throw new ArgError('limit', 'Must be an integer from 1 to 100');
    if (l === undefined) out['limit'] = 20;
  }
  return out;
}

export function buildRequest(t: ToolDef, args: Record<string, string | number | boolean>, base: string, headers: Record<string, string>): Request {
  if (t.method === 'GET') {
    const q = new URLSearchParams({ ...Object.fromEntries(Object.entries(args).map(([k, v]) => [k, String(v)])), ...t.query });
    return new Request(`${base}${t.path}?${q}`, { method: 'GET', headers });
  }
  return new Request(`${base}${t.path}`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(args) });
}

// ------------------------------------------------------------------ replies

const CODES = new Set(['bad_request', 'unauthorized', 'forbidden', 'not_found', 'method_not_allowed', 'conflict', 'payload_too_large', 'unsupported_media_type', 'invalid', 'internal']);
const isCtl = (c: number) => c < 0x20 || (c >= 0x7f && c <= 0x9f) || c === 0x2028 || c === 0x2029;
export const clean = (s: unknown) => [...String(s)].map((ch) => (isCtl(ch.codePointAt(0)!) ? " " : ch)).join("");

/** @req FR:mcp-server/out.errors */
export function errorText(code: string, details?: { field: string; message: string }[]): string {
  const c = CODES.has(code) ? code : 'internal';
  if (c !== 'invalid' || !details?.length) return `error ${c}`;
  return `error ${c} ${details.map((d) => `${clean(d.field)}: ${clean(d.message)}`).join('; ').slice(0, 200)}`;
}

/** Reduces an API response to the tool's text reply. @req FR:mcp-server/out.noecho @req FR:mcp-server/out.json */
export async function replyFrom(t: ToolDef, res: Response): Promise<{ text: string; isError: boolean; status: number }> {
  let body: unknown;
  try { body = await res.json(); } catch { body = undefined; }
  if (!res.ok) {
    const e = obj(obj(body).error);
    const details = Array.isArray(e.details) ? e.details.map((d) => ({ field: obj(d).field, message: obj(d).message })).filter((d) => typeof d.field === 'string' && typeof d.message === 'string') as { field: string; message: string }[] : undefined;
    return { text: errorText(typeof e.code === 'string' ? e.code : 'internal', details), isError: true, status: res.status };
  }
  return { text: t.reply(body), isError: false, status: res.status };
}
