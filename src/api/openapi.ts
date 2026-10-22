/**
 * Builds docs/api/openapi.yaml from the route table. Request shapes (path, query, body) come from
 * the same specs the handler validates with; only prose and response shapes are authored here.
 * @req FR:api/docs.openapi @req FR:api/docs.openapi.parity @req FR:api/docs.openapi.valid
 */
import { stringify } from 'yaml';
import { ERROR_CODES, STATUS } from './errors';
import { QUERY_DEFAULTS, ROUTES } from './handler';
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
    desc: { project: 'File base name, title, or alias', section: 'Default Active' },
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
  'tasks.start': { operationId: 'startTask', summary: 'Start a task (ref omitted means the next task)', responses: mutation('200') },
  'tasks.complete': { operationId: 'completeTask', summary: 'Complete a task', responses: mutation('200') },
  'tasks.skip': { operationId: 'skipTask', summary: 'Skip (park) a task', responses: mutation('200') },
  'tasks.resume': { operationId: 'resumeTask', summary: 'Resume a parked task', responses: mutation('200') },
  'tasks.suspend': { operationId: 'suspendTask', summary: 'Suspend a task for days or hours', responses: mutation('200') },
  'tasks.set': {
    operationId: 'setTask', summary: 'Set task properties',
    desc: { suspend: '`MMM d`, `HH:mm`, or `MMM d HH:mm`; empty clears' },
    responses: mutation('200'),
  },
  'tasks.removeCompleted': {
    operationId: 'removeCompleted', summary: 'Remove completed tasks',
    responses: ok('Removed count', { type: 'object', properties: { removed: { type: 'integer' }, files: { type: 'array', items: { type: 'string' } } } }),
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
