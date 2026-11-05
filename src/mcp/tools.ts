/**
 * Tool table: each tool is one API route. Calls are shaped-checked here and everything else
 * (field rules, lifecycle, authorization) is the API's.
 * @req FR:mcp-server/tools.api @req FR:mcp-server/tools.mutate
 */
import { ENUMS } from '../api/validate';
import { ASK_KINDS, ASK_OUTCOMES, ASK_PRIORITIES, LIST_STATES } from '../core/asks';

type Prop = Record<string, unknown>;
export type Args = Record<string, string | number | boolean>;
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
  /** Argument placed in the path as `{name}` and left out of the body. */
  pathArg?: string;
  /** Arguments sent as arrays: the text is split on `|`. */
  pipeArgs?: string[];
  /** Repeat the request once a second until `ready` holds or `waitSec` seconds pass. */
  wait?: { ready: (body: unknown, args: Args) => boolean };
  /** Reply for a 2xx API body. */
  reply: (body: unknown, args?: Args) => string;
}

const str = (description: string, extra: Prop = {}): Prop => ({ type: 'string', description, ...extra });
const REF = str('project:line');
const enumOf = (v: readonly string[]): Prop => ({ type: 'string', enum: [...v] });
const some = (v: readonly string[]): string[] => v.filter((x) => x !== 'None');

/** Only `project:line` refs from the API are ever echoed. */
const REF_OUT = /^[A-Za-z0-9._-]{1,200}:\d{1,9}$/;
const done = (verb: string) => (body: unknown): string => {
  const b = (typeof body === 'object' && body !== null ? body : {}) as { changed?: unknown; ref?: unknown };
  if (b.changed === false) return 'no change';
  return typeof b.ref === 'string' && REF_OUT.test(b.ref) ? `${verb} ${b.ref}` : verb;
};

const KEY_OUT = /^[a-z0-9][a-z0-9._-]{0,79}$/;
/** Ask text is only ever a JSON string value. */
const askRow = (i: unknown): Record<string, unknown> => {
  const r = obj(i);
  const out: Record<string, unknown> = {};
  for (const k of ['key', 'state', 'from', 'ask', 'kind', 'rank', 'answer', 'text', 'answered', 'outcome']) if (r[k] !== undefined) out[k] = r[k];
  return out;
};
const findAsk = (body: unknown, key: unknown): Record<string, unknown> | null => {
  const items = obj(body).items;
  return (Array.isArray(items) ? items.map(obj).find((i) => i.key === key) : undefined) ?? null;
};
const obj = (body: unknown): Record<string, unknown> => (typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {});

/** @req FR:mcp-server/tools.list @req FR:mcp-server/tools.mutate @req FR:mcp-server/tools.next @req FR:mcp-server/tools.list-tool @req FR:ai-triage-assist/mcp.tools @req FR:ai-triage-assist/mcp.actor */
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
  { name: 'triage', route: 'tasks.triage', method: 'POST', path: '/tasks/triage', required: ['ref'],
    description: 'Suggest priority/effort/impact and add a 🪄 or 🙋 subtask.',
    props: {
      ref: REF, agent: str('One-line 🪄 subtask an agent can do'), human: str('One-line 🙋 subtask needing a person'),
      priority: enumOf(some(ENUMS.priority)), effort: enumOf(some(ENUMS.effort)), impact: enumOf(some(ENUMS.impact)),
    }, reply: done('triaged') },
  { name: 'claim', route: 'tasks.claim', method: 'POST', path: '/tasks/claim', required: ['ref'],
    description: 'Claim a task you may work (autonomy assist or full).', props: { ref: REF }, reply: done('claimed') },
  { name: 'record-result', route: 'tasks.result', method: 'POST', path: '/tasks/result', required: ['ref', 'outcome', 'summary'],
    description: 'Log what you did; completes only within autonomy, else adds a 🙋.',
    props: {
      ref: REF, outcome: enumOf(['done', 'partial', 'blocked', 'needs-human']), summary: str('One line, no secrets'),
      complete: { type: 'boolean' }, human: str('One-line 🙋 subtask if a person is needed'),
    },
    reply: (b) => {
      const o = obj(b);
      if (typeof o.ref !== 'string' || !REF_OUT.test(o.ref)) return 'logged';
      if (o.completed === true) return `logged ${o.ref} completed`;
      return o.deferred === true && typeof o.human === 'string' && REF_OUT.test(o.human) ? `logged ${o.ref} deferred ${o.human}` : `logged ${o.ref}`;
    } },

  // ---- asks. No answer tool: agents never answer. @req FR:mcp-server/tools.asks
  { name: 'asks_put', route: 'asks.put', method: 'POST', path: '/asks/{key}', pathArg: 'key', required: ['key'], pipeArgs: ['options', 'applies'],
    description: 'Put an ask for the owner (stable key; same key updates).',
    props: {
      key: str('Stable ask key, a-z 0-9 . _ -'), ask: str('One decision, 200 chars max'), kind: enumOf(ASK_KINDS), from: str('Your agent name'), project: str('Project'),
      why: str('One line'), recommend: str('Your recommendation'), options: str('A|B (decide)'), default: str('Applied if silent'), by: str('Deadline, ISO'),
      reversible: { type: 'boolean' }, link: str('https URL'), priority: enumOf(ASK_PRIORITIES), effort: str('Owner effort, e.g. 2m'), blocks: { type: 'integer', minimum: 0, maximum: 99 },
      detail: str('Long markdown, owner only'), reopen: { type: 'boolean' }, flow: str('Quick triage flow slug'), seq: { type: 'integer', minimum: 1, maximum: 99 },
      ref: REF, apply: str('Action on go'), applies: str('One action per option, a|b'),
    },
    reply: (b) => { const o = obj(b); const k = typeof o.key === 'string' && KEY_OUT.test(o.key) ? ` ${o.key}` : ''; return `${o.created === true ? 'created' : 'updated'}${k}`; } },
  { name: 'asks_list', route: 'asks.list', method: 'GET', path: '/asks', description: 'List asks; state answered shows asks to act on.',
    props: { state: enumOf(LIST_STATES), limit: { type: 'integer', minimum: 1, maximum: 200, description: 'Default 50' } },
    reply: (b) => { const o = obj(b); return JSON.stringify({ total: o.total, items: Array.isArray(o.items) ? o.items.map(askRow) : [] }); } },
  { name: 'asks_handle', route: 'asks.handle', method: 'POST', path: '/asks/{key}/handle', pathArg: 'key', required: ['key', 'outcome'],
    description: 'Close or reopen an ask after acting on the answer.',
    props: { key: str('Ask key'), outcome: enumOf(ASK_OUTCOMES), note: str('One line'), reply: str('One-line reply when reopening') },
    reply: (b, a = {}) => (obj(b).changed === false ? 'no change' : `handled ${typeof a['key'] === 'string' && KEY_OUT.test(a['key']) ? a['key'] : ''}`.trim()) },
  { name: 'asks_answer_wait', route: 'asks.list', method: 'GET', path: '/asks', query: { state: 'all', limit: '200' }, required: ['key'],
    description: 'Wait up to waitSec (max 20) for the owner to answer an ask.',
    props: { key: str('Ask key'), waitSec: { type: 'integer', minimum: 0, maximum: 20, description: 'Default 0: check once' } },
    wait: { ready: (b, a) => { const r = findAsk(b, a['key']); return r !== null && r.state !== 'open'; } },
    reply: (b, a = {}) => {
      const r = findAsk(b, a['key']);
      if (r === null) return 'error not_found';
      return r.state === 'open' ? 'pending' : JSON.stringify(askRow(r));
    } },
];

export const inputSchema = (t: ToolDef) => ({
  type: 'object' as const, properties: t.props, ...(t.required ? { required: t.required } : {}), additionalProperties: false as const,
});

// ------------------------------------------------------------------ calls

export class ArgError extends Error { constructor(readonly field: string, message: string) { super(message); } }

/** Shape check only: object, known names, scalar values. @req FR:mcp-server/tools.args */
export function checkArgs(t: ToolDef, raw: unknown): Args {
  if (raw !== undefined && (typeof raw !== "object" || raw === null || Array.isArray(raw))) throw new ArgError('arguments', 'Must be an object');
  const out: Args = {};
  for (const [k, v] of Object.entries(raw ?? {})) {
    if (!Object.prototype.hasOwnProperty.call(t.props, k)) throw new ArgError(k, 'Unknown field');
    if (typeof v !== 'string' && typeof v !== 'number' && typeof v !== 'boolean') throw new ArgError(k, 'Must be a scalar value');
    out[k] = v;
  }
  const w = out['waitSec'];
  if (w !== undefined && !(typeof w === 'number' && Number.isInteger(w) && w >= 0 && w <= 20)) throw new ArgError('waitSec', 'Must be an integer from 0 to 20');
  if (t.required) for (const r of t.required) if (t.pathArg === r && (typeof out[r] !== 'string' || out[r] === '')) throw new ArgError(r, 'Required');
  if (t.name === 'list') {
    const l = out['limit'];
    if (l !== undefined && !(typeof l === 'number' && Number.isInteger(l) && l >= 1 && l <= 100)) throw new ArgError('limit', 'Must be an integer from 1 to 100');
    if (l === undefined) out['limit'] = 20;
  }
  return out;
}

export function buildRequest(t: ToolDef, args: Args, base: string, headers: Record<string, string>): Request {
  const { waitSec: _w, ...rest } = args;
  void _w;
  let path = t.path;
  const body: Record<string, string | number | boolean | string[]> = {};
  for (const [k, v] of Object.entries(rest)) {
    if (k === t.pathArg) path = path.replace(`{${k}}`, encodeURIComponent(String(v)));
    else body[k] = t.pipeArgs?.includes(k) && typeof v === 'string' ? v.split('|').map((x) => x.trim()).filter(Boolean) : v;
  }
  if (t.method === 'GET') {
    const q = new URLSearchParams({ ...(t.wait ? {} : Object.fromEntries(Object.entries(body).map(([k, v]) => [k, String(v)]))), ...t.query });
    return new Request(`${base}${path}?${q}`, { method: 'GET', headers });
  }
  return new Request(`${base}${path}`, { method: 'POST', headers: { ...headers, 'content-type': 'application/json' }, body: JSON.stringify(body) });
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
export async function replyFrom(t: ToolDef, res: Response, args: Args = {}): Promise<{ text: string; isError: boolean; status: number }> {
  let body: unknown;
  try { body = await res.json(); } catch { body = undefined; }
  if (!res.ok) {
    const e = obj(obj(body).error);
    const details = Array.isArray(e.details) ? e.details.map((d) => ({ field: obj(d).field, message: obj(d).message })).filter((d) => typeof d.field === 'string' && typeof d.message === 'string') as { field: string; message: string }[] : undefined;
    return { text: errorText(typeof e.code === 'string' ? e.code : 'internal', details), isError: true, status: res.status };
  }
  const text = t.reply(body, args);
  return { text, isError: text.startsWith('error '), status: res.status };
}
