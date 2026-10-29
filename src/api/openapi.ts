/**
 * Builds docs/api/openapi.yaml from the route table. Request shapes (path, query, body) come from
 * the same specs the handler validates with; only prose and response shapes are authored here.
 * @req FR:api/docs.openapi @req FR:api/docs.openapi.parity @req FR:api/docs.openapi.valid
 */
import { stringify } from 'yaml';
import { ERROR_CODES, STATUS } from './errors';
import { QUERY_DEFAULTS, ROUTES } from './handler';
import { ASK_ANSWERS, ASK_KINDS, ASK_OUTCOMES, ASK_PRIORITIES } from '../core/asks';
import { ANCHORS, CADENCES, WEEKDAYS } from '../core/model';
import { MAX_STR, REF_RE, type Spec } from './validate';

type J = Record<string, unknown>;
const ref = (name: string, kind = 'schemas'): J => ({ $ref: `#/components/${kind}/${name}` });

interface RouteDoc {
  operationId: string;
  summary: string;
  /** Prose for query params and body properties, by name. */
  desc?: Record<string, string>;
  /** Extra schema keywords for body properties and query params, by name. */
  extra?: Record<string, J>;
  responses: J;
}

const mutation = (status: string): J => ({ [status]: ref('Mutation', 'responses'), default: ref('Error', 'responses') });
const ok = (description: string, schema: J, status = '200'): J => ({
  [status]: { description, content: { 'application/json': { schema } } },
  default: ref('Error', 'responses'),
});

const DOCS: Record<string, RouteDoc> = {
  next: {
    operationId: 'next', summary: 'Top-ranked task',
    responses: ok('`task` is null when nothing is active.', { type: 'object', properties: { task: { allOf: [ref('NextTask')], nullable: true } } }),
  },
  'tasks.list': {
    operationId: 'listTasks', summary: 'List tasks',
    desc: { section: 'Section heading text, emoji ignored', q: 'Case-insensitive text match' },
    responses: ok('Page of tasks', {
      type: 'object',
      properties: { items: { type: 'array', items: ref('Task') }, total: { type: 'integer' }, offset: { type: 'integer' }, limit: { type: 'integer' } },
    }),
  },
  'tasks.get': { operationId: 'getTask', summary: 'Get one task', responses: ok('Task', ref('Task')) },
  'tasks.add': {
    operationId: 'addTask', summary: 'Add a task',
    desc: { project: 'File base name, title, or alias', section: 'Default Active', text: 'One line; cannot contain the 🤖 autonomy marker (only the owner sets autonomy)', expect: 'Expected current parent row text; 409 conflict when the parent row differs (stale line number)' },
    responses: mutation('201'),
  },
  capture: {
    operationId: 'captureTask', summary: 'Add a task from a natural-language or speech phrase',
    desc: {
      text: 'Phrase such as "call dentist tomorrow 30m #alpha"',
      project: 'Used when the text has no #project or @project hint', section: 'Default Active',
      dryRun: 'Parse and render without writing (200)',
    },
    responses: {
      '200': { description: 'Dry run result', content: { 'application/json': { schema: ref('CaptureResult') } } },
      '201': { description: 'Task added', content: { 'application/json': { schema: ref('CaptureResult') } } },
      default: ref('Error', 'responses'),
    },
  },
  'tasks.start': { operationId: 'startTask', summary: 'Start a task (ref omitted means the next task). Tokens: ref required, autonomy assist or higher; 403 otherwise', responses: mutation('200') },
  'tasks.complete': { operationId: 'completeTask', summary: 'Complete a task. Tokens: ref required; autonomy assist for a 🪄 subtask, full otherwise (403 when unset); remove is owner-only; 409 with an open 🙋 child', responses: mutation('200') },
  'tasks.skip': { operationId: 'skipTask', summary: 'Skip (park) a task. Owner session only (403 for tokens)', responses: mutation('200') },
  'tasks.resume': { operationId: 'resumeTask', summary: 'Resume a parked task. Owner session only (403 for tokens)', responses: mutation('200') },
  'tasks.suspend': { operationId: 'suspendTask', summary: 'Suspend a task for days or hours. Owner session only (403 for tokens)', responses: mutation('200') },
  'tasks.set': {
    operationId: 'setTask', summary: 'Set task properties. Tokens: ref required; autonomy triage (priority, effort, impact), assist (status), fills missing priority/effort/impact only; checkbox, clearEmojis, and gate marks are owner-only (403)',
    desc: { suspend: '`MMM d`, `HH:mm`, or `MMM d HH:mm`; empty clears' },
    responses: mutation('200'),
  },
  'tasks.triage': {
    operationId: 'triageTask', summary: 'Apply a triage suggestion (needs autonomy triage or higher; 403 otherwise)',
    desc: {
      agent: 'One-line 🪄 subtask an agent can do', human: 'One-line 🙋 subtask needing a person',
      priority: 'Only fills a missing priority',
    },
    responses: ok('Applied', {
      type: 'object',
      properties: { changed: { type: 'boolean' }, ref: { type: 'string' }, applied: { type: 'array', items: { type: 'string' } }, added: { type: 'array', items: { type: 'string' } } },
    }),
  },
  'tasks.claim': {
    operationId: 'claimTask', summary: 'Claim a task (needs autonomy assist or higher; never a 🙋 row)',
    responses: ok('Claimed', { type: 'object', properties: { changed: { type: 'boolean' }, ref: { type: 'string' } } }),
  },
  'tasks.result': {
    operationId: 'recordResult', summary: 'Log an agent result in tasks/logs; completes only within autonomy, else defers to a 🙋 subtask',
    desc: { summary: 'One line; secrets are redacted', complete: 'Request completion; honored only within the task autonomy' },
    responses: ok('Logged', {
      type: 'object',
      properties: { logged: { type: 'boolean' }, completed: { type: 'boolean' }, deferred: { type: 'boolean' }, ref: { type: 'string' }, human: { type: 'string' } },
    }),
  },
  'tasks.edit': {
    operationId: 'editTask', summary: 'Replace the text of a task row. Tokens: autonomy assist or higher, open row not 🙋 or held, and every marker (status, priority, effort, impact, dates, recurrence, gate marks) unchanged: 403 otherwise',
    desc: { text: 'Row text after the checkbox, single line', expect: 'Expected current row text at ref; 409 conflict when the row differs (stale line number)' },
    responses: mutation('200'),
  },
  'tasks.move': {
    operationId: 'moveTask', summary: 'Move a task block before or after another task in the same project. Owner session only: 403 for tokens',
    desc: { expect: 'Expected current row text at ref; 409 conflict on mismatch', expectTarget: 'Expected current row text at target; 409 conflict on mismatch' },
    responses: mutation('200'),
  },
  'tasks.removeCompleted': {
    operationId: 'removeCompleted', summary: 'Remove completed tasks',
    responses: ok('Removed count', { type: 'object', properties: { removed: { type: 'integer' }, files: { type: 'array', items: { type: 'string' } } } }),
  },
  'inbox.send': {
    operationId: 'sendToInbox', summary: 'Send a reply or decision to the agent inbox of the task project (tasks/inbox). Owner session only: 403 for tokens',
    desc: { text: 'Your words to the agent; secrets are redacted', expect: 'Expected current row text at ref; 409 conflict when the row differs' },
    responses: ok('Sent', { type: 'object', properties: { id: { type: 'string' }, path: { type: 'string' } } }, '201'),
  },
  'inbox.list': {
    operationId: 'listInbox', summary: 'Inbox entries for agents to act on (open by default)',
    responses: ok('Entries', { type: 'object', properties: { items: { type: 'array', items: ref('InboxEntry') } } }),
  },
  'inbox.handle': {
    operationId: 'handleInboxEntry', summary: 'Mark an inbox entry handled after acting on it',
    responses: ok('Handled', { type: 'object', properties: { changed: { type: 'boolean' } } }),
  },
  'calendar.list': {
    operationId: 'listCalendar', summary: 'Calendar events overlapping a range (at most 7 days), read-only. Owner session only: 403 for tokens',
    desc: { from: 'ISO date-time, inclusive', to: 'ISO date-time, exclusive' },
    responses: ok('Events', {
      type: 'object',
      properties: {
        configured: { type: 'boolean' }, error: { type: 'string' },
        items: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' }, subject: { type: 'string' }, start: { type: 'string', format: 'date-time' }, end: { type: 'string', format: 'date-time' },
              allDay: { type: 'boolean' }, showAs: { type: 'string', enum: ['free', 'tentative', 'busy', 'oof', 'workingElsewhere', 'unknown'] },
              cancelled: { type: 'boolean' }, online: { type: 'boolean' }, organizer: { type: 'string' }, webLink: { type: 'string' }, joinUrl: { type: 'string', description: 'Online meeting join link' },
            },
          },
        },
      },
    }),
  },
  'schedule.get': {
    operationId: 'getSchedule', summary: 'The waking day (wake, bed, time blocks) that contains an instant, from the time blocks in stack.json. Owner session only: 403 for tokens',
    desc: { at: 'ISO date-time; default now' },
    responses: ok('Day', {
      type: 'object',
      properties: {
        timezone: { type: 'string' }, date: { type: 'string', description: 'Local date the day started on (YYYY-MM-DD)' },
        wake: { type: 'string', format: 'date-time' }, bed: { type: 'string', format: 'date-time' }, asleep: { type: 'boolean', description: 'The instant is in sleep time; the day is the next waking day' },
        blocks: {
          type: 'array',
          items: {
            type: 'object',
            properties: { name: { type: 'string' }, label: { type: 'string' }, emoji: { type: 'string' }, kind: { type: 'string', enum: ['focus', 'personal', 'sleep'] }, start: { type: 'string', format: 'date-time' }, end: { type: 'string', format: 'date-time' } },
          },
        },
      },
    }),
  },
  'agents.list': {
    operationId: 'listAgents', summary: 'What agents are doing, from agent rows, result logs, inbox replies, and pull request status',
    responses: ok('Agent work', { type: 'object', properties: { items: { type: 'array', items: ref('AgentItem') } } }),
  },
  'asks.list': {
    operationId: 'listAsks', summary: 'Asks for the owner, ranked by score (open by default). State answered lists asks waiting for the agent to act',
    responses: ok('Asks', { type: 'object', properties: { items: { type: 'array', items: ref('Ask') }, total: { type: 'integer' }, latest: { type: 'string', format: 'date-time' }, snoozed: { type: 'integer' } } }),
  },
  'asks.put': {
    operationId: 'putAsk', summary: 'Create or update an ask (tasks/asks/<key>.md). The key is stable, so writing it again updates the ask',
    desc: { ask: 'The one exact ask, one line. Required on create', kind: 'Required on create', from: "Agent name; defaults to the token's name (the owner session writes as owner)", default: 'What happens if the owner stays silent', by: 'Deadline (ISO)', reopen: 'Open a done ask again', detail: 'Free markdown shown only when the owner expands the ask' },
    responses: ok('Written', { type: 'object', properties: { key: { type: 'string' }, created: { type: 'boolean' } } }),
  },
  'asks.answer': {
    operationId: 'answerAsk', summary: 'Answer an ask (go, no, option, reply, ask, done, defer, retract). Owner session only: 403 for tokens',
    desc: { text: 'Required for option, reply, and ask', until: 'Required for defer (ISO, in the future)' },
    responses: ok('Answered', { type: 'object', properties: { changed: { type: 'boolean' } } }),
  },
  'asks.handle': {
    operationId: 'handleAsk', summary: 'Close an ask after acting (handled, resolved, defaulted) or reopen it with a reply to the owner',
    desc: { reply: 'One line shown to the owner on the reopened ask' },
    responses: ok('Handled', { type: 'object', properties: { changed: { type: 'boolean' } } }),
  },
  'sessions.list': {
    operationId: 'listSessions', summary: 'Live agent sessions on this machine, attention first (needs-you, running, active, idle, stale). 404 on hosts that cannot run agents',
    responses: ok('Sessions', { type: 'object', properties: { items: { type: 'array', items: ref('Session') }, total: { type: 'integer' }, indexing: { type: 'integer' } } }),
  },
  'sessions.cost': {
    operationId: 'sessionCost', summary: "Agent spend by day, project, and model; a session counts on the date of its last activity in the owner's configured timezone (else UTC)",
    responses: ok('Cost report', { type: 'object', properties: {
      attribution: { type: 'string', enum: ['lastActive'] }, indexing: { type: 'integer' },
      days: { type: 'array', items: { type: 'object', properties: { date: { type: 'string' }, usd: { type: 'number' }, tokens: { type: 'integer' }, sessions: { type: 'integer' } } } },
      projects: { type: 'array', items: { type: 'object', properties: { project: { type: 'string' }, usd: { type: 'number' }, tokens: { type: 'integer' }, sessions: { type: 'integer' } } } },
      models: { type: 'array', items: { type: 'object', properties: { model: { type: 'string' }, usd: { type: 'number' }, tokens: { type: 'integer' } } } },
      total: { type: 'object', properties: { usd: { type: 'number' }, tokens: { type: 'integer' }, sessions: { type: 'integer' } } },
    } }),
  },
  'sessions.messages': {
    operationId: 'sessionMessages', summary: 'The last turns of a session: user and assistant text, tool calls as one line each',
    responses: ok('Turns', { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { at: { type: 'string' }, role: { type: 'string', enum: ['user', 'assistant'] }, text: { type: 'string' } } } } } }),
  },
  'sessions.new': {
    operationId: 'newSession', summary: 'Start a new agent session in a folder and send it a prompt. Owner session only: 403 for tokens',
    desc: { cwd: 'Absolute path to an existing folder', text: 'The prompt' },
    responses: ok('Run started', { type: 'object', properties: { runId: { type: 'string' }, sessionId: { type: 'string', nullable: true } } }, '202'),
  },
  'sessions.prompt': {
    operationId: 'promptSession', summary: 'Resume a session with a prompt; updates stream on /sessions/{id}/events. Owner session only: 403 for tokens; 409 when the session is active elsewhere or already running',
    responses: ok('Run started', { type: 'object', properties: { runId: { type: 'string' }, sessionId: { type: 'string', nullable: true } } }, '202'),
  },
  'sessions.cancel': {
    operationId: 'cancelSession', summary: 'Stop the run in flight for a session. Owner session only',
    responses: ok('Cancelled', { type: 'object', properties: { changed: { type: 'boolean' } } }),
  },
  'projects.list': {
    operationId: 'listProjects', summary: 'List projects',
    responses: ok('Projects', { type: 'object', properties: { items: { type: 'array', items: ref('Project') } } }),
  },
  'projects.get': { operationId: 'getProject', summary: 'Get one project', responses: ok('Project', ref('Project')) },
  'projects.add': {
    operationId: 'addProject', summary: 'Add a project',
    desc: { fileName: 'README is reserved; an existing file returns 409' },
    extra: { repositoryUrl: { format: 'uri' } },
    responses: ok('Created', { type: 'object', properties: { path: { type: 'string' }, project: { type: 'string' } } }, '201'),
  },
  'summaries.get': {
    operationId: 'getSummaries', summary: 'Generated summaries',
    responses: ok('Summary documents', {
      type: 'object',
      properties: { readme: { type: 'string' }, stack: { type: 'string' }, projects: { type: 'string' }, myDay: { type: 'string', nullable: true } },
    }),
  },
};

const PATH_DESC: Record<string, string> = { name: 'File base name' };

/** JSON Schema for one validation spec. */
function schemaOf(spec: Spec, description?: string, extra: J = {}): J {
  let s: J;
  switch (spec.t) {
    case 'str':
      s = { type: 'string', maxLength: spec.max ?? MAX_STR, ...(spec.pattern ? { pattern: spec.pattern.source } : {}) };
      if (spec.line) description = [description, 'Single line.'].filter(Boolean).join(' ');
      break;
    case 'enum': s = { type: 'string', enum: [...spec.values] }; break;
    case 'int': s = { type: 'integer', minimum: spec.min, maximum: spec.max }; break;
    case 'num': s = { type: 'number', minimum: spec.min, maximum: spec.max }; break;
    case 'bool': s = { type: 'boolean' }; break;
    case 'ref': s = ref('Ref'); break;
    case 'strs': s = { type: 'array', maxItems: spec.max ?? 20, items: { type: 'string', maxLength: 200 } }; break;
    case 'caps': s = { type: 'object', maxProperties: 20, additionalProperties: { type: 'number', minimum: 0, maximum: 168 } }; break;
  }
  return { ...s, ...(description ? { description } : {}), ...extra };
}

function operation(r: (typeof ROUTES)[number]): J {
  const d = DOCS[r.name];
  if (!d) throw new Error(`openapi: no docs for route ${r.name}`);
  const parameters: J[] = [...r.doc.matchAll(/\{(\w+)\}/g)].map((m) => ({
    name: m[1], in: 'path', required: true,
    schema: m[1] === 'ref' ? ref('Ref') : { type: 'string' },
    ...(PATH_DESC[m[1]] ? { description: PATH_DESC[m[1]] } : {}),
  }));
  for (const [name, spec] of Object.entries(r.query ?? {})) {
    if (name === 'fields') { parameters.push(ref('fields', 'parameters')); continue; }
    const def = r.name === 'tasks.list' ? QUERY_DEFAULTS[name as keyof typeof QUERY_DEFAULTS] : undefined;
    const schema = schemaOf(spec, undefined, def !== undefined ? { default: def } : {});
    if (spec.t === 'str') delete schema.maxLength; // free text in the query string
    parameters.push({ name, in: 'query', schema, ...(d.desc?.[name] ? { description: d.desc[name] } : {}) });
  }
  const op: J = { summary: d.summary, operationId: d.operationId };
  if (parameters.length) op.parameters = parameters;
  if (r.body) {
    const props = Object.fromEntries(Object.entries(r.body.schema).map(([k, spec]) => [k, schemaOf(spec, d.desc?.[k], d.extra?.[k])]));
    op.requestBody = {
      ...(r.body.required.length ? { required: true } : {}),
      content: {
        'application/json': {
          schema: { type: 'object', additionalProperties: false, ...(r.body.required.length ? { required: [...r.body.required] } : {}), properties: props },
        },
      },
    };
  }
  op.responses = d.responses;
  return op;
}

/** The OpenAPI 3.0.3 document for the current route table. */
export function buildOpenApi(): J {
  const paths: Record<string, J> = {};
  for (const r of ROUTES) (paths[r.doc] ??= {})[r.method.toLowerCase()] = operation(r);
  const extra = Object.keys(DOCS).filter((n) => !ROUTES.some((r) => r.name === n));
  if (extra.length) throw new Error(`openapi: docs for unknown routes: ${extra.join(', ')}`);
  return {
    openapi: '3.0.3',
    info: {
      title: 'Stack API', version: '0.0.1',
      description: 'REST over the Stack core. JSON only, compact responses. Use `fields` to cut tokens. '
        + 'Tasks are addressed by `ref` = `project:line`. Authentication is supplied by the host '
        + '(the handler denies every request when no authorize hook is configured).',
    },
    servers: [{ url: '/api' }],
    security: [{ host: [] }],
    paths,
    components: {
      securitySchemes: {
        host: { type: 'http', scheme: 'bearer', description: 'Supplied by the host through the authorize hook (auth-security slice).' },
      },
      parameters: {
        fields: {
          name: 'fields', in: 'query', schema: { type: 'string' },
          description: 'Comma-separated fields to return. Unknown names are rejected.',
        },
      },
      responses: {
        Mutation: {
          description: 'Result of a change',
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  changed: { type: 'boolean' }, ref: ref('Ref'), before: { type: 'string' }, after: { type: 'string' }, message: { type: 'string' },
                },
              },
            },
          },
        },
        Error: {
          description: `Error. Codes: ${ERROR_CODES.map((c) => `${c} ${STATUS[c]}`).join(', ')}.`,
          content: { 'application/json': { schema: ref('Error') } },
        },
      },
      schemas: {
        CaptureResult: {
          type: 'object',
          properties: {
            changed: { type: 'boolean' }, ref: ref('Ref'), after: { type: 'string' },
            spec: {
              type: 'object',
              properties: {
                title: { type: 'string' }, due: { type: 'string', format: 'date' },
                effort: { type: 'object', properties: { minutes: { type: 'integer' }, emoji: { type: 'string' } } },
                project: { type: 'string' }, recurrence: {
                  type: 'object',
                  description: 'offsetMonths is parsed and reported but not used by rolls: Quarterly-EOM+1 rolls to month end 3 months on.',
                  properties: {
                    cadence: { type: 'string', enum: [...CADENCES] },
                    weekdays: { type: 'array', items: { type: 'string', enum: [...WEEKDAYS] } },
                    anchor: { type: 'string', enum: [...ANCHORS] },
                    offsetDays: { type: 'integer' }, offsetMonths: { type: 'integer' }, nominalDay: { type: 'string', format: 'date' },
                  },
                },
              },
            },
          },
        },
        Ref: { type: 'string', pattern: REF_RE.source, example: 'alpha:12', description: '`<project>:<line>`. README (any case) is reserved and never a valid project.' },
        Error: {
          type: 'object', required: ['error'],
          properties: {
            error: {
              type: 'object', required: ['code', 'message'],
              properties: {
                code: { type: 'string', enum: [...ERROR_CODES] },
                message: { type: 'string' },
                details: { type: 'array', items: { type: 'object', properties: { field: { type: 'string' }, message: { type: 'string' } } } },
              },
            },
          },
        },
        InboxEntry: {
          type: 'object',
          description: 'One owner message in tasks/inbox/<project>.md. Agents act on open entries, then mark them handled.',
          properties: {
            id: { type: 'string' }, at: { type: 'string', format: 'date-time' }, project: { type: 'string' }, ref: ref('Ref'), task: { type: 'string' },
            kind: { type: 'string', enum: ['reply', 'decision'] }, to: { type: 'string', enum: ['agent', 'human', 'none'] }, text: { type: 'string' },
            state: { type: 'string', enum: ['open', 'handled'] }, handled: { type: 'string' }, note: { type: 'string' },
            row: { ...ref('Ref'), description: 'Where the row is now, found by title (lines move); absent when the row is gone' },
          },
        },
        Ask: {
          type: 'object',
          description: 'One ask for the owner (tasks/asks/<key>.md) with its computed score and rank.',
          properties: {
            key: { type: 'string' }, state: { type: 'string', enum: ['open', 'answered', 'done'] }, ask: { type: 'string' }, kind: { type: 'string', enum: [...ASK_KINDS] }, from: { type: 'string' },
            project: { type: 'string' }, why: { type: 'string' }, recommend: { type: 'string' }, options: { type: 'array', items: { type: 'string' } }, default: { type: 'string' },
            by: { type: 'string', format: 'date-time' }, reversible: { type: 'boolean' }, link: { type: 'string', format: 'uri' }, priority: { type: 'string', enum: [...ASK_PRIORITIES] },
            effort: { type: 'string' }, blocks: { type: 'integer' }, created: { type: 'string', format: 'date-time' }, updated: { type: 'string', format: 'date-time' },
            answer: { type: 'string', enum: [...ASK_ANSWERS] }, text: { type: 'string' }, answered: { type: 'string', format: 'date-time' }, outcome: { type: 'string', enum: [...ASK_OUTCOMES] },
            handled: { type: 'string' }, note: { type: 'string' }, snoozed: { type: 'string', format: 'date-time' }, detail: { type: 'string' },
            score: { type: 'integer' }, rank: { type: 'integer' }, overdue: { type: 'boolean' }, snoozedUntil: { type: 'string', format: 'date-time' }, agentReply: { type: 'string' },
          },
        },
        Session: {
          type: 'object',
          description: 'One Claude session on this machine (from the local session store), with its state and cost.',
          properties: {
            id: { type: 'string' }, title: { type: 'string' }, project: { type: 'string' }, cwd: { type: 'string' }, branch: { type: 'string' },
            lastActive: { type: 'string', format: 'date-time' }, state: { type: 'string', enum: ['needs-you', 'running', 'active', 'idle', 'stale'] },
            cost: { type: 'object', properties: { usd: { type: 'number' }, tokens: { type: 'integer' }, approx: { type: 'boolean' } } }, prs: { type: 'array', items: { type: 'string' } },
          },
        },
        AgentItem: {
          type: 'object',
          properties: {
            ref: ref('Ref'), project: { type: 'string' }, title: { type: 'string' }, text: { type: 'string' },
            state: { type: 'string', enum: ['failing', 'waiting', 'review', 'merged', 'ci', 'working', 'queued'] },
            prs: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  url: { type: 'string' }, repo: { type: 'string' }, number: { type: 'integer' }, state: { type: 'string', enum: ['open', 'draft', 'merged', 'closed'] },
                  checks: { type: 'string', enum: ['passing', 'failing', 'pending', 'none'] }, title: { type: 'string' }, updatedAt: { type: 'string' },
                },
              },
            },
            last: { type: 'object', properties: { at: { type: 'string' }, action: { type: 'string' }, outcome: { type: 'string' }, summary: { type: 'string' } } },
            waitingOn: ref('Ref'), replies: { type: 'integer' }, since: { type: 'string' },
          },
        },
        NextTask: { type: 'object', properties: { ref: ref('Ref'), text: { type: 'string' }, project: { type: 'string' }, score: { type: 'number' } } },
        Task: {
          type: 'object',
          description: 'Default fields are ref, text, project, section, done. depth and notes only via fields.',
          properties: {
            ref: ref('Ref'), text: { type: 'string' }, project: { type: 'string' }, section: { type: 'string' }, done: { type: 'boolean' },
            depth: { type: 'integer' }, notes: { type: 'array', items: { type: 'string' } },
          },
        },
        Project: {
          type: 'object',
          description: 'Default fields are name, title, open, done.',
          properties: {
            name: { type: 'string' }, title: { type: 'string' }, open: { type: 'integer' }, done: { type: 'integer' },
            aliases: { type: 'array', items: { type: 'string' } },
            metadata: { type: 'object', additionalProperties: { type: 'string' } },
            sections: {
              type: 'array',
              items: { type: 'object', properties: { heading: { type: 'string' }, open: { type: 'integer' }, done: { type: 'integer' } } },
            },
          },
        },
      },
    },
  };
}

/** YAML text of {@link buildOpenApi}, as committed to docs/api/openapi.yaml. */
export function renderOpenApi(): string {
  return `# Generated by \`pnpm openapi\` from the api route table. Do not edit.\n# @req FR:api/docs.openapi\n${stringify(buildOpenApi(), { lineWidth: 0 })}`;
}
