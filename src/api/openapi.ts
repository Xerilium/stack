/**
 * Builds docs/api/openapi.yaml from the route table. Request shapes (path, query, body) come from
 * the same specs the handler validates with; only prose and response shapes are authored here.
 * @req FR:api/docs.openapi @req FR:api/docs.openapi.parity @req FR:api/docs.openapi.valid
 */
import { stringify } from 'yaml';
import { ERROR_CODES, STATUS } from './errors';
import { QUERY_DEFAULTS, ROUTES } from './handler';
import { ASK_ANSWERS, ASK_KINDS, ASK_OUTCOMES, ASK_PRIORITIES } from '../core/asks';
import { REPORT_ASK_KINDS } from '../core/reports';
import { PROJECTS, SESSION_REASONS, SESSION_STATES } from '../core/session-inventory';
import { PRI_ITEM_STATUSES, PRI_STATUSES } from '../core/pris';
import { ITEM_STATES, LIVE_STATES } from '../core/live-lane';
import { INBOX_KINDS } from '../core/inbox';
import { ESC_STATUSES, REC_STATES } from '../core/pr-priority';
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
  /** Authored request body, for a route whose nested body the core validates (no flat `body` spec). */
  requestBody?: J;
  responses: J;
}

const mutation = (status: string): J => ({ [status]: ref('Mutation', 'responses'), default: ref('Error', 'responses') });
const BUILD_STAMP: J = { type: 'object', nullable: true, properties: { version: { type: 'string' }, sha: { type: 'string' }, dirty: { type: 'boolean' }, builtAt: { type: 'string', format: 'date-time' } } };
/** @req FR:devops-installer/$version-state */
const VERSION_STATE: J = {
  type: 'object', properties: {
    running: BUILD_STAMP, available: BUILD_STAMP, ready: { type: 'boolean' }, mode: { type: 'string', enum: ['on-quit', 'ask', 'auto-idle', 'off'] },
    idleMinutes: { type: 'integer' }, canRestart: { type: 'boolean' },
    last: { type: 'object', nullable: true, properties: { ok: { type: 'boolean' }, step: { type: 'string' }, at: { type: 'string' } } },
  },
};
const ok = (description: string, schema: J, status = '200'): J => ({
  [status]: { description, content: { 'application/json': { schema } } },
  default: ref('Error', 'responses'),
});

/** Inbox source status, shared by GET /inbox-sources and GET /inbox-items. @req FR:inbox-page/api.sources */
const SOURCES_PROPS = { sources: { type: 'array', items: { type: 'object', properties: { kind: { type: 'string', enum: ['email', 'github', 'teams', 'slack'] }, account: { type: 'string' }, state: { type: 'string', enum: ['not-connected', 'connecting', 'ok', 'error', 'stale'] }, lastSyncAt: { type: 'string', format: 'date-time' }, error: { type: 'string' }, needs: { type: 'string' }, command: { type: 'string' }, doc: { type: 'string' }, mode: { type: 'string', enum: ['read-only', 'drafts'] }, planned: { type: 'boolean' } } } }, summary: { type: 'object', properties: { connected: { type: 'integer' }, total: { type: 'integer' }, fresh: { type: 'integer' }, attention: { type: 'boolean' }, canClaimZero: { type: 'boolean' }, headline: { type: 'string', nullable: true } } } };
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
  feedback: {
    operationId: 'sendFeedback', summary: 'Owner only. Append one feedback line to ~/.stack/feedback.jsonl (docs/feedback.md) for an agent to tail. Tokens in text and the route query are removed. 404 on hosts with no store',
    desc: {
      text: 'The feedback', route: 'The app route (query string dropped)', viewport: 'Width x height, such as 1280x800', theme: 'The app theme',
      capture: 'Ask the desktop host to capture the window as the screenshot', png: 'A base64 PNG screenshot (browser), at most 700 KB decoded',
    },
    responses: {
      '201': { description: 'Stored', content: { 'application/json': { schema: { type: 'object', required: ['id', 'at', 'screenshot'], properties: { id: { type: 'string' }, at: { type: 'string', format: 'date-time' }, screenshot: { type: 'boolean' } } } } } },
      default: ref('Error', 'responses'),
    },
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
    desc: { suspend: '`MMM d`, `HH:mm`, or `MMM d HH:mm`; empty clears', expect: 'Expected current task text; 409 conflict when the row differs (stale line number)' },
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
    desc: { withdrawn: 'Owner only (403 for tokens): the owner took the message back (Undo); lists and the thread then hide it' },
    responses: ok('Handled', { type: 'object', properties: { changed: { type: 'boolean' } } }),
  },
  'calendar.list': {
    operationId: 'listCalendar', summary: 'Calendar events overlapping a range (at most 7 days), read-only. Owner session only: 403 for tokens',
    desc: { from: 'ISO date-time, inclusive', to: 'ISO date-time, exclusive' },
    responses: ok('Events', {
      type: 'object',
      properties: {
        configured: { type: 'boolean' }, error: { type: 'string' },
        source: {
          type: 'object', description: 'How the calendar source is doing; never holds a feed path or token',
          properties: {
            kind: { type: 'string', enum: ['calendar'] }, via: { type: 'string', enum: ['graph', 'ics', 'fixture', 'none'] }, account: { type: 'string', description: 'Sign-in address or feed host names' },
            state: { type: 'string', enum: ['not-connected', 'ok', 'error', 'stale'] }, lastSyncAt: { type: 'string', format: 'date-time', description: 'When the data shown was last read from the source' },
          },
        },
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
  'schedule.day': {
    operationId: 'setScheduleDay', summary: 'Change wake or bed for a date, or with every for its weekday (which also removes that date\'s own change); reset removes it. Saved in .stack/schedule.json. Owner session only',
    responses: ok('Day', { type: 'object', properties: { timezone: { type: 'string' }, date: { type: 'string' }, wake: { type: 'string', format: 'date-time' }, bed: { type: 'string', format: 'date-time' }, asleep: { type: 'boolean' }, blocks: { type: 'array', items: { type: 'object' } } } }),
  },
  'agents.list': {
    operationId: 'listAgents', summary: 'What agents are doing, from agent rows, result logs, inbox replies, and pull request status',
    responses: ok('Agent work', { type: 'object', properties: { items: { type: 'array', items: ref('AgentItem') } } }),
  },
  sync: {
    operationId: 'sync', summary: 'Change probe: the head revision of the task repo (null when the storage has none), plus pending/since when the storage batches commits. Poll it and reload only when rev changes',
    responses: ok('Sync state', { type: 'object', properties: { rev: { type: 'string', nullable: true }, pending: { type: 'integer', description: 'Writes not yet committed (batching storage only)' }, since: { type: 'string', format: 'date-time', nullable: true, description: 'First pending write (batching storage only)' }, live: { type: 'string', description: 'Changes when live state outside the repo (PR priorities) changes; present only when the host has it' } } }),
  },
  version: {
    operationId: 'getVersion', summary: 'Desktop app only: the running and available builds, whether an update is ready, the update mode, and the last helper result. 404 on hosts with no installer. Reads only local files',
    responses: ok('Version state', VERSION_STATE),
  },
  'version.mode': {
    operationId: 'setUpdateMode', summary: 'Set when updates install: on-quit (default), ask, auto-idle, or off (owner only). Saved in ~/.config/stack/config.json',
    responses: ok('Version state', VERSION_STATE),
  },
  'version.restart': {
    operationId: 'restartForUpdate', summary: 'Commit pending edits, then quit, swap in the ready build, and relaunch (owner only). 409 when no update is ready or the host cannot restart',
    responses: ok('Restarting', { type: 'object', properties: { restarting: { type: 'boolean' } } }),
  },
  'sync.flush': {
    operationId: 'flushSync', summary: 'Commit and push pending edits now (owner only). flushed is 0 when nothing was pending or the storage does not batch',
    responses: ok('Flush result', { type: 'object', properties: { flushed: { type: 'integer' }, rev: { type: 'string', nullable: true } } }),
  },
  'asks.list': {
    operationId: 'listAsks', summary: 'Asks for the owner, ranked by score (open by default). State answered lists asks waiting for the agent to act',
    responses: ok('Asks', { type: 'object', properties: { items: { type: 'array', items: ref('Ask') }, total: { type: 'integer' }, latest: { type: 'string', format: 'date-time' }, snoozed: { type: 'integer' } } }),
  },
  'asks.put': {
    operationId: 'putAsk', summary: 'Create or update an ask (tasks/asks/<key>.md). The key is stable, so writing it again updates the ask. A token gets 403 on an ask another writer created and on perm-* keys',
    desc: { ask: 'The one exact ask, one line. Required on create', kind: 'Required on create', from: "Agent name; defaults to the token's name (the owner session writes as owner)", default: 'What happens if the owner stays silent', by: 'Deadline (ISO)', reopen: 'Open a done ask again', detail: 'Free markdown shown only when the owner expands the ask', flow: 'Quick triage: the flow this question belongs to (slug)', seq: 'Its place in the flow (1-99)', ref: 'The task this ask belongs to (project:line); the task must exist', apply: 'Action Stack runs on go: set prop=value…, due Mon d, suspend 7d, skip, complete, start, resume, note text', applies: 'One action per option (- for none)' },
    responses: ok('Written', { type: 'object', properties: { key: { type: 'string' }, created: { type: 'boolean' } } }),
  },
  rank: {
    operationId: 'rank', summary: 'The ranked tasks: engine order plus the owner and Chief of Staff overrides (`.stack/priorities.json`). `/next` is the first; `root` is the top-level row a leaf sits under. `blocks=any` keeps tasks the current time block would hide',
    responses: ok('Ranked tasks', { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { ref: ref('Ref'), text: { type: 'string' }, project: { type: 'string' }, score: { type: 'number' }, rule: { type: 'string', description: 'The override that applied' }, root: ref('Ref') } } } } }),
  },
  'inboxItems.list': {
    operationId: 'listInboxItems', summary: 'All mail, unread Teams, Slack and GitHub items, each with a summary and a suggested action, plus the action catalog and the source status (as GET /inbox-sources). Owner session only: 403 for tokens',
    responses: ok('Inbox', { type: 'object', properties: { items: { type: 'array', items: { type: 'object' } }, actions: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, label: { type: 'string' }, ready: { type: 'boolean' } } } }, ...SOURCES_PROPS } }),
  },
  'inboxSources.list': {
    operationId: 'listInboxSources', summary: 'Each inbox source (every email account, GitHub, and planned Teams and Slack) with its state, last sync and the exact step to connect it, plus a summary (N of M connected, whether Inbox zero may be claimed, a headline). fresh=1 re-probes this machine. Never a token. Owner session only: 403 for tokens',
    responses: ok('Sources', { type: 'object', properties: SOURCES_PROPS }),
  },
  'inboxItems.action': {
    operationId: 'inboxAction', summary: 'Run an inbox action (reply-draft makes a draft and never sends), or with request true file a request for a missing action. Owner session only: 403 for tokens',
    desc: { text: 'Draft text for reply-draft', until: 'ISO date for snooze', request: 'File a GitHub issue (label help wanted) for a missing action' },
    responses: ok('Result', { type: 'object' }),
  },
  'meetings.list': {
    operationId: 'listMeetings', summary: 'The owner\'s weekly meetings (`.stack/meetings.md`): days (0 = Sunday), local start and end, topic, owner agent, join link. Owner session only: 403 for tokens',
    responses: ok('Meetings', { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { title: { type: 'string' }, days: { type: 'array', items: { type: 'integer' } }, start: { type: 'string' }, end: { type: 'string' }, biweekly: { type: 'boolean' }, topic: { type: 'string' }, owner: { type: 'string' }, join: { type: 'string' } } } } } }),
  },
  'needs.list': {
    operationId: 'listNeeds', summary: 'The Chief of Staff\'s open decisions and go-dos (`.stack/needs-you.json`), each with a recommendation, a default, and a link',
    responses: ok('Needs', { type: 'object', properties: { items: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, recommendation: { type: 'string' }, default: { type: 'string' }, by: { type: 'string' }, link: { type: 'string' }, project: { type: 'string' }, ref: { type: 'string' }, kind: { type: 'string', enum: ['decision'], description: 'A PR priority recommendation: post actions to decide' }, actions: { type: 'array', items: { type: 'string', enum: ['accept', 'edit', 'reject'] } }, decide: { type: 'string' }, answer: { type: 'object', properties: { choice: { type: 'string', enum: ['go', 'defer', 'reply'] }, text: { type: 'string' }, until: { type: 'string' }, at: { type: 'string', format: 'date-time' } } } } } } } }),
  },
  'needs.answer': {
    operationId: 'answerNeed', summary: 'Record the owner\'s answer on a need (go, defer, reply) or clear it (undo). Owner session only: 403 for tokens',
    desc: { text: 'Required for reply', until: 'Required for defer (ISO)' },
    responses: ok('Answered', { type: 'object', properties: { changed: { type: 'boolean' } } }),
  },
  'brief.summary': {
    operationId: 'briefSummary', summary: 'AI daily brief over the top open asks, cached per day. Owner session only: 403 for tokens. configured is false when the host has no model',
    desc: { refresh: '1 forces a new model call' },
    responses: ok('Brief', { type: 'object', properties: { configured: { type: 'boolean' }, date: { type: 'string' }, headline: { type: 'string' }, cached: { type: 'boolean' }, error: { type: 'string' }, lines: { type: 'array', items: { type: 'object', properties: { key: { type: 'string' }, text: { type: 'string' }, note: { type: 'string' }, action: { type: 'string', enum: ['go', 'no', 'done', 'none'] } } } } } }),
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
  'reports.put': {
    operationId: 'putReport', summary: 'Store an agent status report in the host live store (~/.stack, never git); the latest per agent and project replaces the prior; its asks show in Needs you. 400 lists every schema issue; 404 on hosts with no store. See docs/report.md',
    requestBody: { required: true, content: { 'application/json': { schema: ref('ReportInput') } } },
    responses: ok('Stored', {
      type: 'object',
      properties: {
        agent: { type: 'string' }, project: { type: 'string' }, created: { type: 'boolean' },
        asks: { type: 'object', properties: { put: { type: 'array', items: { type: 'string' } }, dropped: { type: 'array', items: { type: 'string' } }, answers: { type: 'object', description: 'Owner answers on the kept asks, by ask key: {choice, text?, until?, at}', additionalProperties: { type: 'object', properties: { choice: { type: 'string', enum: ['go', 'defer', 'reply'] }, text: { type: 'string' }, until: { type: 'string' }, at: { type: 'string' } } } } } },
      },
    }),
  },
  'inventory.list': {
    operationId: 'listSessionInventory', summary: 'Owner only. Claude app sessions on this machine (read-only, cached by mtime in ~/.stack/sessions.json): counts per state, the ranked Needs-you list (waiting, stuck), archive candidates, and every session. No transcript text. 404 on hosts with no inventory',
    responses: ok('Inventory', ref('Inventory')),
  },
  'pris.get': {
    operationId: 'getPriorities', summary: 'Owner only. The owner priorities, most important first (~/.stack/pris.json); rev 0 and an empty list when none. 404 on hosts with no store',
    responses: ok('Priorities', ref('PrisFile')),
  },
  'pris.put': {
    operationId: 'putPriorities', summary: 'Owner only. Replace the priorities list. Send the rev you read: a stale rev is 409. 400 lists every issue',
    requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, required: ['rev', 'pris'], properties: { rev: { type: 'integer', minimum: 0 }, pris: { type: 'array', maxItems: 30, items: ref('Pri') } } } } } },
    responses: ok('Stored', ref('PrisFile')),
  },
  'prPriority.get': {
    operationId: 'getPrPriority', summary: 'Owner only. The PR priority queue for the Sweep Manager (~/.stack/pr-priority.json), each PR with cached facts, merge-order edges, the newest report record, acks and status, plus the escalation set and open recommendations (by project, oldest first). 404 on hosts with no store',
    responses: ok('PR priorities', ref('PrPriView')),
  },
  'prPriority.put': {
    operationId: 'changePrPriority', summary: 'Owner only. One idempotent queue action: add (default top), move (to top, up, down, or rank), pin, unpin, remove, undo (restores the prior revision), or ack (a hold thread). Send the rev you read: a stale rev is 409; a PR not queued is 404',
    desc: { ref: '<owner>/<name>#<n> or a GitHub PR url; required except for undo', to: 'For move: top, up or down (or send rank)', thread: 'For ack: the https url of the thread', note: 'For add and move: the item note; for ack: the ack note' },
    responses: ok('Changed', ref('PrPriView')),
  },
  'prPriority.recommend': {
    operationId: 'recommendPrPriority', summary: 'An agent recommends a higher rank for a PR. Returns the new or already open recommendation. 409 when the owner rejected a similar reason in the last 14 days (the message has his reason), when the PR is already queued high enough, or when it is excluded',
    responses: ok('Recommended', { type: 'object', properties: { created: { type: 'boolean' }, rec: ref('PrRec') } }),
  },
  'prPriority.decisions': {
    operationId: 'listPrPriorityDecisions', summary: 'Decided recommendations (accepted, edited, rejected with the owner reason), newest first, so agents do not retry',
    responses: ok('Decisions', { type: 'object', properties: { items: { type: 'array', items: ref('PrRec') } } }),
  },
  'prPriority.decide': {
    operationId: 'decidePrPriority', summary: 'Owner only. Accept, edit, or reject a recommendation. Edit and reject need a reason. The same decision again is a no-op; another decision is 409',
    desc: { rank: 'For edit: the rank to use', note: 'For edit: the item note', reason: 'Required for edit and reject' },
    responses: ok('Decided', { type: 'object', properties: { changed: { type: 'boolean' }, rec: ref('PrRec'), queue: { type: 'object' } } }),
  },
  // @req FR:pr-page/api.get @req FR:pr-page/api.queue @req FR:pr-page/api.label @req FR:pr-page/api.ack @req FR:pr-page/api.rec
  'prs.get': {
    operationId: 'getPrBoard', summary: 'Owner only. Open PRs the owner reviews or moves, grouped (blocked, waiting, processing, pending, paused), with who must act, CI, unresolved threads, queue rank, and the escalation set. Taking it renews a 3-minute poll lease. `{off: true}` on hosts with no GitHub token',
    responses: ok('Board', { type: 'object', properties: { at: { type: 'string', nullable: true }, user: { type: 'string' }, agents: { type: 'object' }, counts: { type: 'object' }, footer: { type: 'object' }, rows: { type: 'array', items: { type: 'object' } }, escalations: { type: 'object' }, queue: { type: 'boolean' }, rate: { type: 'object' }, error: { type: 'string' }, off: { type: 'boolean' } } }),
  },
  'prs.queue': {
    operationId: 'movePrInQueue', summary: 'Owner only. Change the PR priority queue through stack pr-pri: top, up, down, move (to rank), add (at the top), pin, unpin, remove, undo. 409 when the queue is not installed or refuses',
    desc: { op: 'top, up, down, move, add, pin, unpin, remove, or undo', rank: 'Target rank for move' },
    responses: ok('New rank', { type: 'object', properties: { rank: { type: 'integer', nullable: true }, was: { type: 'integer', nullable: true }, pinned: { type: 'boolean' } } }),
  },
  'prs.label': {
    operationId: 'labelPr', summary: 'Owner only. Add or remove the Autopilot label (no other label). 403 for repos outside STACK_GITHUB_REPOS',
    responses: ok('Done', { type: 'object' }),
  },
  'prs.ack': {
    operationId: 'ackPr', summary: 'Owner only. Record the owner answer on a thread (stack pr-pri ack --thread --note). With post true, first post text (must start with the AI prefix) as a thread reply (replyTo) or a PR comment',
    desc: { thread: 'Thread or PR url the answer is for', note: 'The answer' },
    responses: ok('Done', { type: 'object' }),
  },
  'prs.rec': {
    operationId: 'decidePrRec', summary: 'Owner only. Accept, edit, or reject a PR priority recommendation; edit and reject need a reason',
    responses: ok('Done', { type: 'object' }),
  },
  'prReview.get': {
    operationId: 'getPrReview', summary: 'Cached PR facts (specLines, live flag, head SHA) and agent briefs with stale. No GitHub call. 404 on hosts with no store',
    responses: ok('PR review', { type: 'object', required: ['facts', 'briefs'], properties: { facts: { type: 'array', items: ref('PrFacts') }, briefs: { type: 'array', items: ref('PrBrief') } } }),
  },
  'live.get': {
    operationId: 'getLiveLane', summary: 'The live validation lane: state (idle when no PR), the active PR, its checklist, and done PRs. 404 on hosts with no lane',
    responses: ok('Lane', ref('LiveLane')),
  },
  'live.item': {
    operationId: 'changeLiveItem', summary: 'Change one checklist item of the live PR: add, check, uncheck, fail, needs-fix, fixed, block, comment, edit. Owner calls are by owner; token calls are by the token name. 404 when the PR is not live or the id is unknown',
    desc: { text: 'Required for add, comment, edit; the comment for needs-fix', reason: 'Required for block', id: 'Required for every op except add' },
    responses: ok('Changed', { type: 'object', required: ['changed', 'item'], properties: { changed: { type: 'boolean' }, item: ref('LiveItem') } }),
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
    desc: { cwd: 'Absolute path to an existing folder; default: the served folder (also with agent, ref, or project: an agent can be started in its project repo)', text: 'The prompt', agent: 'Agent slug (tasks/agents/<slug>.md); default: the active agent for the task or project', ref: 'The task the session is about: its row, notes, and subtasks become context and the agent persona is applied', project: 'Project when there is no task (404 when it has no file)' },
    responses: ok('Run started', { type: 'object', properties: { runId: { type: 'string' }, sessionId: { type: 'string', nullable: true }, agent: { type: 'string', description: 'Set for a task or project session' }, title: { type: 'string', description: 'Set for a task or project session: `<agent> · <task> · <ref>`' } } }, '202'),
  },
  'inbox.reply': {
    operationId: 'replyFromAgent', summary: "An agent's reply on a task (tasks/inbox, from: agent, named by the token). Tokens only: the owner session gets 403",
    desc: { text: 'One line to the owner; secrets are redacted', expect: 'Expected current row text; 409 when the row differs' },
    responses: ok('Written', { type: 'object', properties: { id: { type: 'string' }, path: { type: 'string' } } }, '201'),
  },
  'tasks.thread': {
    operationId: 'getTaskThread', summary: "One task's thread in time order: the owner's messages, the agent's replies, its asks, the review verdict, agent-owned subtasks; plus the task's newest session when a runner exists",
    responses: ok('Thread', { type: 'object', properties: { items: { type: 'array', items: ref('ThreadItem') }, session: { type: 'object', properties: { id: { type: 'string' }, title: { type: 'string' }, state: { type: 'string' } } }, review: ref('Review') } }),
  },
  'tasks.assign': {
    operationId: 'assignTask', summary: 'Hand the task to its agent: claims the row (log + in progress) and starts a session with the assign prompt. Owner session only; 404 without a runner; 403 for a 🙋 row',
    desc: { agent: 'Agent slug; default: the active agent', note: 'The owner\'s note, added to the assign prompt (at most 1000 characters)' },
    responses: ok('Assigned', { type: 'object', properties: { runId: { type: 'string' }, sessionId: { type: 'string', nullable: true }, agent: { type: 'string' }, title: { type: 'string' }, claimed: { type: 'boolean' } } }, '202'),
  },
  'team.list': {
    operationId: 'listTeam', summary: 'The team: tasks/agents/<slug>.md, .claude/agents/<slug>.md and project Agents lines, each with who it reports to; with project, the agents that cover it, the roll-up first',
    desc: { project: 'Project name: only the agents whose scope covers it, the roll-up first then most specific first', section: 'Section heading, for section-scoped agents' },
    responses: ok('Team', { type: 'object', properties: { items: { type: 'array', items: ref('TeamAgent') } } }),
  },
  'reviews.list': {
    operationId: 'listReviews', summary: "Every row's newest review in a project (verdict, plan, estimate, agent, open need asks)",
    desc: { project: 'Project name' },
    responses: ok('Reviews', { type: 'object', properties: { items: { type: 'array', items: ref('Review') } } }),
  },
  'tasks.review': {
    operationId: 'reviewTask', summary: "Ask the task's agent whether it can do the task: a read-only run whose verdict lands in the result log and whose needs become asks. Owner session only: 403 for tokens and for a 🙋 row; 404 without a runner",
    desc: { agent: 'Agent slug; default: the active agent' },
    responses: ok('Review started', { type: 'object', properties: { runId: { type: 'string' }, sessionId: { type: 'string', nullable: true }, agent: { type: 'string' } } }, '202'),
  },
  'sessions.prompt': {
    operationId: 'promptSession', summary: 'Resume a session with a prompt; updates stream on /sessions/{id}/events. Owner session only: 403 for tokens; 409 when the session is active elsewhere or already running',
    desc: { text: 'The prompt', ref: 'The task the follow-up is about: the agent persona (and model) is applied again, since a resumed session carries no system prompt', agent: 'Agent slug for the persona; default: the active agent for the task' },
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
  } else if (d.requestBody) op.requestBody = d.requestBody;
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
        SessionItem: {
          type: 'object', required: ['id', 'title', 'project', 'state', 'reason', 'pinned', 'lastActivityAt', 'link', 'prs'],
          properties: {
            id: { type: 'string' }, title: { type: 'string' }, project: { type: 'string', enum: [...PROJECTS] },
            state: { type: 'string', enum: [...SESSION_STATES] }, reason: { type: 'string', enum: [...SESSION_REASONS] }, pinned: { type: 'boolean' },
            lastActivityAt: { type: 'string', format: 'date-time' }, link: { type: 'string', description: 'claude://claude.ai/epitaxy/<id>' },
            prs: { type: 'array', items: { type: 'object', properties: { url: { type: 'string' }, state: { type: 'string' } } } },
            ask: { type: 'string' }, scheduled: { type: 'object', properties: { id: { type: 'string' }, name: { type: 'string' } } },
          },
        },
        Inventory: {
          type: 'object', required: ['at', 'total', 'counts', 'needsYou', 'archive', 'sessions'],
          properties: {
            at: { type: 'string', format: 'date-time' }, total: { type: 'integer' },
            counts: { type: 'object', properties: Object.fromEntries(SESSION_STATES.map((k) => [k, { type: 'integer' }])) },
            needsYou: { type: 'array', items: ref('SessionItem') }, archive: { type: 'array', items: ref('SessionItem') }, sessions: { type: 'array', items: ref('SessionItem') },
          },
        },
        PriItem: {
          type: 'object', additionalProperties: false, required: ['text', 'status'],
          properties: { text: { type: 'string', minLength: 1, maxLength: 300 }, status: { type: 'string', enum: [...PRI_ITEM_STATUSES] } },
        },
        Pri: {
          type: 'object', additionalProperties: false, required: ['id', 'title', 'status', 'items', 'backlog', 'weekly'],
          properties: {
            id: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,23}$' }, title: { type: 'string', minLength: 1, maxLength: 200 }, status: { type: 'string', enum: [...PRI_STATUSES] },
            items: { type: 'array', maxItems: 20, items: ref('PriItem') }, backlog: { type: 'array', maxItems: 50, items: ref('PriItem') },
            weekly: { type: 'array', maxItems: 12, description: 'Weekly progress, newest first', items: { type: 'object', additionalProperties: false, required: ['week', 'text'], properties: { week: { type: 'string', pattern: '^\\d{4}-W(0[1-9]|[1-4]\\d|5[0-3])$' }, text: { type: 'string', minLength: 1, maxLength: 500 } } } },
          },
        },
        PrRec: {
          type: 'object', required: ['id', 'repo', 'number', 'url', 'agent', 'reason', 'state', 'at'],
          properties: {
            id: { type: 'string', pattern: '^pp-[0-9a-f]{8}$' }, repo: { type: 'string' }, number: { type: 'integer' }, url: { type: 'string' }, agent: { type: 'string' }, reason: { type: 'string' },
            toRank: { type: 'integer' }, state: { type: 'string', enum: [...REC_STATES] }, at: { type: 'string', format: 'date-time' },
            decision: { type: 'object', properties: { at: { type: 'string', format: 'date-time' }, reason: { type: 'string' }, rank: { type: 'integer' }, note: { type: 'string' } } },
          },
        },
        PrPriView: {
          type: 'object', required: ['version', 'rev', 'items'],
          properties: {
            changed: { type: 'boolean' }, version: { type: 'integer' }, rev: { type: 'integer' }, updatedAt: { type: 'string', format: 'date-time' },
            items: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  rank: { type: 'integer' }, repo: { type: 'string' }, number: { type: 'integer' }, pr: { type: 'integer' }, url: { type: 'string' }, pinned: { type: 'boolean' }, note: { type: 'string' }, by: { type: 'string' }, at: { type: 'string' },
                  title: { type: 'string' }, author: { type: 'string' }, isDraft: { type: 'boolean' }, assignee: { type: 'string', nullable: true }, labels: { type: 'array', items: { type: 'string' } },
                  reviewDecision: { type: 'string', nullable: true }, checks: { type: 'string', enum: ['green', 'red', 'pending'] }, mergeable: { type: 'string' }, lastPushAt: { type: 'string' }, headSha: { type: 'string' }, state: { type: 'string', enum: ['open', 'merged', 'closed'] }, factsAt: { type: 'string' },
                  baseStack: { type: 'array', items: { type: 'string' }, description: 'PR urls this PR merges after' }, waitsOn: { type: 'array', items: { type: 'string' }, description: 'baseStack urls not merged' }, why: { type: 'string' },
                  michaelDecision: { type: 'object', properties: { state: { type: 'string' }, reason: { type: 'string' }, at: { type: 'string' } } },
                  report: { type: 'object', description: 'Newest per-PR report record' }, acks: { type: 'array', items: { type: 'object', properties: { thread: { type: 'string' }, note: { type: 'string' }, at: { type: 'string' } } } },
                  status: { type: 'string', enum: [...ESC_STATUSES] },
                },
              },
            },
            escalations: { type: 'object', nullable: true }, recommendations: { type: 'array', items: ref('PrRec') },
          },
        },
        PrisFile: {
          type: 'object', required: ['version', 'rev', 'pris'],
          properties: {
            version: { type: 'integer' }, rev: { type: 'integer' }, updatedAt: { type: 'string', format: 'date-time' },
            seed: { type: 'object', properties: { source: { type: 'string' }, at: { type: 'string' }, sha256: { type: 'string' } } },
            pris: { type: 'array', items: ref('Pri') },
          },
        },
        PrFacts: {
          type: 'object', required: ['repo', 'number', 'url', 'headSha', 'specLines', 'live', 'at'],
          properties: {
            repo: { type: 'string' }, number: { type: 'integer' }, url: { type: 'string' }, title: { type: 'string' }, headSha: { type: 'string' },
            specLines: { type: 'integer', description: 'Lines changed in spec files (.xe/, spec.md, docs/*.md)' }, labels: { type: 'array', items: { type: 'string' } },
            live: { type: 'boolean', description: 'Needs live validation' }, reasons: { type: 'array', items: { type: 'string' } }, draft: { type: 'boolean' }, at: { type: 'string', format: 'date-time' },
          },
        },
        PrBrief: {
          type: 'object', required: ['repo', 'number', 'url', 'problem', 'solution', 'recommendation', 'evidence', 'askedAt', 'headSha', 'stale'],
          properties: {
            repo: { type: 'string' }, number: { type: 'integer' }, url: { type: 'string' }, problem: { type: 'string' }, solution: { type: 'string' }, recommendation: { type: 'string' },
            evidence: { type: 'array', items: { type: 'string' } }, askedAt: { type: 'string' }, headSha: { type: 'string' }, by: { type: 'string' }, stale: { type: 'boolean' },
          },
        },
        LiveItem: {
          type: 'object', required: ['id', 'text', 'by', 'state', 'createdAt', 'updatedAt'],
          properties: {
            id: { type: 'string' }, text: { type: 'string' }, by: { type: 'string' }, state: { type: 'string', enum: [...ITEM_STATES] },
            comment: { type: 'string' }, reason: { type: 'string' }, createdAt: { type: 'string' }, updatedAt: { type: 'string' }, updatedBy: { type: 'string', description: 'Who made the last change: owner or an agent' },
          },
        },
        LiveLane: {
          type: 'object', required: ['state', 'rev', 'items', 'done'],
          properties: {
            state: { type: 'string', enum: ['idle', ...LIVE_STATES] }, rev: { type: 'integer' },
            active: { type: 'object', properties: { repo: { type: 'string' }, number: { type: 'integer' }, url: { type: 'string' }, title: { type: 'string' }, state: { type: 'string', enum: [...LIVE_STATES] }, by: { type: 'string' }, claimedAt: { type: 'string' }, worktree: { type: 'string' }, serverUrl: { type: 'string' }, port: { type: 'integer' }, pid: { type: 'integer' }, headSha: { type: 'string' }, waitingOnLock: { type: 'string' } } },
            items: { type: 'array', items: ref('LiveItem') },
            done: { type: 'array', items: { type: 'object', properties: { repo: { type: 'string' }, number: { type: 'integer' }, url: { type: 'string' }, at: { type: 'string' }, reason: { type: 'string' } } } },
          },
        },
        ReportItem: {
          type: 'object', additionalProperties: false, required: ['text'],
          properties: { text: { type: 'string', minLength: 1, maxLength: 200, description: 'Single line.' }, link: { type: 'string', maxLength: 2000, pattern: '^https://' } },
        },
        ReportInput: {
          type: 'object', additionalProperties: false, required: ['agent', 'project'],
          properties: {
            agent: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,23}$' },
            project: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,23}$' },
            top: { type: 'array', maxItems: 3, items: ref('ReportItem') },
            asks: {
              type: 'array', maxItems: 10,
              items: {
                type: 'object', additionalProperties: false, required: ['id', 'ask', 'link', 'by'],
                properties: {
                  id: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{0,23}$', description: 'Unique in the report; the ask key is rp.<agent>.<project>.<id>' },
                  ask: { type: 'string', minLength: 1, maxLength: 200 }, link: { type: 'string', maxLength: 2000, pattern: '^https://' },
                  by: { type: 'string', description: 'ISO date or date-time deadline' },
                  kind: { type: 'string', enum: [...REPORT_ASK_KINDS], default: 'answer' },
                  recommend: { type: 'string', maxLength: 200 }, why: { type: 'string', maxLength: 500 }, default: { type: 'string', maxLength: 200 },
                  priority: { type: 'string', enum: [...ASK_PRIORITIES] },
                },
              },
            },
            blockers: { type: 'array', maxItems: 10, items: ref('ReportItem') },
            progress: { type: 'array', maxItems: 10, items: ref('ReportItem') },
          },
        },
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
            parent: { type: 'string', description: 'Title of the parent row; absent for top-level rows' },
            kind: { type: 'string', enum: [...INBOX_KINDS] }, to: { type: 'string', enum: ['agent', 'human', 'none'] }, text: { type: 'string' },
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
            flow: { type: 'string' }, seq: { type: 'integer' }, ref: ref('Ref'), apply: { type: 'string' }, applies: { type: 'array', items: { type: 'string' } }, flowTotal: { type: 'integer' }, flowDone: { type: 'integer' }, refText: { type: 'string' }, writer: { type: 'string', description: 'Who created the ask; only that token or the owner updates it' },
            row: ref('Ref'), task: { type: 'string' },
          },
        },
        TeamAgent: {
          type: 'object',
          properties: {
            slug: { type: 'string' }, name: { type: 'string' }, role: { type: 'string' }, scope: { type: 'array', items: { type: 'string' } }, model: { type: 'string' },
            tools: { type: 'array', items: { type: 'string' } }, mode: { type: 'string', enum: ['long-running', 'ad-hoc'] }, prompt: { type: 'string' }, defined: { type: 'boolean' }, projects: { type: 'array', items: { type: 'string' } },
            reportsTo: { type: 'string', description: 'Slug of the agent this one reports to; absent on the roll-up' }, icon: { type: 'string', description: 'Avatar: an emoji, fluent:<name> (a Fluent Emoji file name), or a same-origin image path; absent means a monogram' }, source: { type: 'string', enum: ['stack', 'claude', 'metadata'], description: 'tasks/agents file, .claude/agents file, or a project Agents line' },
          },
        },
        ThreadItem: {
          type: 'object',
          properties: {
            at: { type: 'string' }, kind: { type: 'string', enum: ['owner', 'agent', 'ask', 'review', 'subtask'] }, id: { type: 'string' }, text: { type: 'string' }, state: { type: 'string' }, agent: { type: 'string' },
            withdrawn: { type: 'boolean', description: 'Owner item the owner took back (Undo); clients hide it' },
            ask: ref('Ask'), verdict: { type: 'string' }, plan: { type: 'string' }, estimate: { type: 'string' }, ref: ref('Ref'), done: { type: 'boolean' },
          },
        },
        Review: {
          type: 'object',
          properties: { ref: ref('Ref'), at: { type: 'string' }, verdict: { type: 'string', enum: ['can', 'partial', 'cannot'] }, plan: { type: 'string' }, estimate: { type: 'string' }, agent: { type: 'string' }, needs: { type: 'array', items: { type: 'string' } } },
        },
        Session: {
          type: 'object',
          description: 'One Claude session on this machine (from the local session store), with its state and cost.',
          properties: {
            id: { type: 'string' }, title: { type: 'string' }, project: { type: 'string' }, owner: { type: 'string', nullable: true, description: 'The Stack project that owns the repo (name, alias, Repository, or Repos line), or null' }, cwd: { type: 'string' }, branch: { type: 'string' },
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
                  priority: { type: 'integer', nullable: true, description: 'Rank in the PR priority queue, or null' },
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
