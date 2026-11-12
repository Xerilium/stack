/**
 * Framework-neutral REST handler over the core. Pure (Request) -> Response; storage is injected.
 * @req FR:api/handler.@function
 */
import { getDefaults, type StackConfig } from '../core/config';
import { cleanOverrides, daySchedule, dayScheduleOn, type ScheduleOverrides } from '../core/schedule';
import {
  addProject, addTask, completeTask, nextTask, rankStack, removeCompleted, resumeTask, setProperties, skipTask, startTask, suspendTask,
  type LifecycleContext, type LifecycleResult, type TaskProps,
} from '../core/lifecycle';
import { parseProject, type Project, type Task } from '../core/parser';
import { captureTask, CaptureError } from '../core/quick-capture';
import { FeedbackError, MAX_TEXT as FEEDBACK_MAX_TEXT, type FeedbackStore } from '../core/feedback';
import { applyTriage, authorizeEdit, authorizeMutation, claimTask, OUTCOMES, recordResult, TriageDenied, type ResultInput, type Suggestion } from '../core/triage';
import type { AuxFiles, Storage } from '../core/storage';
import { agentActivity, type PrStatusProvider } from '../core/activity';
import { sourceStatus, type CalendarProvider } from '../calendar';
import { ReportInvalid, type ReportStore } from '../core/reports';
import type { Inventory } from '../core/session-inventory';
import { PrisInvalid, type PriStore } from '../core/pris';
import { blockedText, DECISIONS, MOVE_TO, QUEUE_OPS, type PrPriorityStore, type QueueOp } from '../core/pr-priority';
import { LABELS, sameLabel, type PrRow } from '../core/pr-board';
import type { PrBoardService } from './pr-board-service';
import { AI_PREFIX, GitHubWriteDenied, type GitHubWrites } from './github-write';
import { QueueRefused, QueueUnavailable, type PrQueue } from './pr-queue';
import { ITEM_OPS, LiveError, type ItemOp, type LiveStore } from '../core/live-lane';
import { briefViews, type BriefStore, type FactsStore } from '../core/pr-review';
import { answerAsk, ASK_ANSWERS, ASK_KINDS, ASK_OUTCOMES, ASK_PRIORITIES, handleAsk, LIST_STATES, listAsks, putAsk, type AnswerInput, type AskPut, type HandleInput } from '../core/asks';
import { currentRows, handleEntry, INBOX_KINDS, INBOX_STATES, listInbox, replyFromAgent, sendToInbox, type InboxKind } from '../core/inbox';
import { presentedToken } from './auth/authorize';
import type { AgentRuns } from '../agents/runs';
import { agentFor, listTeam } from '../core/agents';
import { agentPromptOptions, assignTask, listReviews, reviewTask, startAgentRun, taskThread } from '../agents/team';
import { existsSync, statSync } from 'fs';
import { isAbsolute } from 'path';
import { generateSummaries } from '../core/summaries';
import { PRIORITIES_PATH } from '../core/priorities';
import { editTask, moveTask } from './edit';
import { readMeetings } from '../core/meetings';
import { answerNeed, readNeeds } from '../core/needs-you';
import type { MailProvider } from '../email/types';
import { ACTIONS as INBOX_ACTIONS, ACTION_IDS, loadSources, readInbox, readInboxChecked, requestAction, runAction, type ActionId, type IssueFiler, type SourceProbe } from '../inbox';
import { createBriefCache } from './brief';
import type { ClaudeJson } from '../email/llm';
import { IDLE_MINUTES, UPDATE_MODES, UpdateRefused, type AppUpdater, type UpdateMode } from '../core/app-update';
import { ApiError, errorResponse, flushError, invalid, json, toApiError } from './errors';
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
  /** The live report store (~/.stack); absent means POST /reports is 404 and Needs you has no report asks. @req FR:status-ingest/api.put */
  reports?: ReportStore;
  /** Runs the Claude app session inventory; absent means GET /session-inventory is 404. @req FR:session-inventory/api.inventory */
  inventory?: () => Inventory;
  /** The owner's priorities store (~/.stack/pris.json); absent means /pris is 404. @req FR:session-inventory/api.pris.get */
  pris?: PriStore;
  /** The PR priority store (~/.stack/pr-priority.json); absent means /pr-priority is 404 and GET /agents PRs have priority null. @req FR:pr-priority/api.get */
  prPriority?: PrPriorityStore;
  /** The live validation lane (~/.stack/live-lane.json); absent means /live is 404. @req FR:pr-review-lane/lane.api */
  live?: LiveStore;
  /** Agent briefs (~/.stack/pr-briefs.json) and PR facts (~/.stack/pr-facts.json); absent means /pr-review is 404. @req FR:pr-review-lane/sort.api */
  briefs?: BriefStore;
  facts?: FactsStore;
  /** Deny-by-default: when absent every request gets 401. */
  authorize?: Authorize;
  basePath?: string;
  /** Pull request state and checks for `GET /agents`; absent means links without status. @req FR:agent-inbox/activity.status */
  prs?: PrStatusProvider;
  /** Live agent sessions on this machine; absent on hosts that cannot run agents (every sessions.* route is then 404). @req FR:agent-sessions/driver.interface */
  agents?: AgentRuns;
  /** Mail drafts for the Inbox page; absent means reply drafts answer 409. Never sends. @req FR:inbox-page/api.act */
  mail?: Pick<MailProvider, 'createDraft'>;
  /** This machine's inbox sign-ins (Graph caches, GitHub); absent on the hosted app, which uses sync records only. `fresh` skips any cache. @req FR:inbox-page/api.sources */
  inboxProbe?: (o?: { fresh: true }) => Promise<SourceProbe>;
  /** Files "Request this action" issues; absent means a Stack task instead. @req FR:inbox-page/action.request */
  issues?: IssueFiler;
  /** Today's meetings for the day plan; absent means no calendar. @req FR:day-inputs/api.calendar */
  calendar?: CalendarProvider;
  /** Model for the AI daily brief (`claude -p`); absent means `GET /brief/summary` says not configured. @req FR:cos-view/brief.ai.route */
  brief?: ClaudeJson;
  /** The PR page board; absent means GET /prs is 404. @req FR:pr-page/api.get */
  prBoard?: PrBoardService;
  /** GitHub writes for the PR page (Autopilot label, AI comments). @req FR:github-pr-status/write.@function */
  prWrites?: GitHubWrites;
  /** Changes the PR priority queue. @req FR:pr-page/api.queue-client */
  prQueue?: PrQueue;
  /** The desktop installer: version probe, update mode, restart. Absent means /version is 404. @req FR:devops-installer/version.get */
  app?: AppUpdater;
  /** The owner feedback store (~/.stack/feedback.jsonl); absent means POST /feedback is 404. @req FR:feedback-button/api.route */
  feedback?: FeedbackStore;
  /** Called with unexpected errors (they are never sent to the caller). */
  onError?: (e: unknown) => void;
}

type Ctx = { deps: ApiDeps; /** Per-handler AI brief cache. */ briefCache: ReturnType<typeof createBriefCache>; life: LifecycleContext; req: Request; url: URL; params: string[]; /** Set when the request was allowed by an API token. */ token?: { id: string; name: string } };
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
/** @req FR:feedback-button/api.route */
const FEEDBACK_BODY = {
  schema: {
    text: { t: 'str', required: true, max: FEEDBACK_MAX_TEXT }, route: { t: 'str', max: 500, line: true },
    viewport: { t: 'str', max: 11, pattern: /^\d{2,5}x\d{2,5}$/ }, theme: { t: 'enum', values: ['light', 'dark'] },
    capture: { t: 'bool' }, png: { t: 'str', max: 1_000_000, pattern: /^[A-Za-z0-9+/]+={0,2}$/ },
  } satisfies Record<string, Spec>,
  required: ['text'],
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
  set: { schema: { ref: REF, ...PROPS, expect: EXPECT }, required: ['ref'] },
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
const ISO_INSTANT = /^(\d{4})-(\d\d)-(\d\d)T(\d\d):(\d\d)(?::(\d\d)(?:\.\d{1,3})?)?(?:Z|[+-](\d\d):(\d\d))$/;
/** An ISO date-time with an offset that names a real moment (no month 13, Feb 30, or 25:00). */
const isInstant = (v: string | null): v is string => {
  const m = typeof v === 'string' ? ISO_INSTANT.exec(v) : null;
  if (!m) return false;
  const [y, mo, d, h, mi, s = '0', oh = '0', om = '0'] = m.slice(1);
  return +mo >= 1 && +mo <= 12 && +d >= 1 && +d <= new Date(Date.UTC(+y, +mo, 0)).getUTCDate() && +h < 24 && +mi < 60 && +s < 60 && +oh < 24 && +om < 60;
};
const SCHEDULE_Q: Record<string, Spec> = { at: { t: 'str', max: 40 } };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const SCHEDULE_DAY_BODY = {
  schema: { date: { t: 'str', required: true, max: 10 }, wake: { t: 'str', max: 5 }, bed: { t: 'str', max: 5 }, every: { t: 'bool' }, reset: { t: 'bool' } } satisfies Record<string, Spec>,
  required: ['date'],
};
const VERSION_MODE_BODY = {
  schema: { mode: { t: 'enum', values: UPDATE_MODES }, idleMinutes: { t: 'int', min: IDLE_MINUTES.min, max: IDLE_MINUTES.max } } satisfies Record<string, Spec>,
  required: ['mode'],
};
const appOf = (c: Ctx): AppUpdater => { if (!c.deps.app) throw new ApiError('not_found', 'No installer on this host'); return c.deps.app; };
const SCHEDULE_PATH = '.stack/schedule.json';
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
/** A storage that batches commits (storage-git FR:batch), found by duck typing so no adapter is imported here. @req FR:live-deploy/sync.pending */
interface Batching { pending(): { count: number; since: Date | null }; flush(): Promise<string | null> }
const batchOf = (s: unknown): Batching | null => (s && typeof (s as Batching).pending === 'function' && typeof (s as Batching).flush === 'function' ? s as Batching : null);
const revOf = async (s: unknown): Promise<string | null> => { const r = (s as { rev?: () => Promise<string | null> }).rev; return typeof r === 'function' ? r.call(s) : null; };
const auxOf = (s: unknown): AuxFiles | null => (s && typeof (s as AuxFiles).readAux === 'function' && typeof (s as AuxFiles).writeAux === 'function' ? s as AuxFiles : null);
/** Saved wake/bed overrides, or none when the storage keeps no state files. @req FR:schedule/api.override */
async function overridesOf(storage: unknown): Promise<{ value: ScheduleOverrides; version: string | null; broken?: boolean }> {
  const aux = auxOf(storage);
  const f = aux ? await aux.readAux(SCHEDULE_PATH) : null;
  if (!f) return { value: {}, version: null };
  try { return { value: cleanOverrides(JSON.parse(f.content)), version: f.version }; } catch { return { value: {}, version: f.version, broken: true }; }
}
const INBOX_Q: Record<string, Spec> = { project: { t: 'str', max: 200 }, state: { t: 'enum', values: INBOX_STATES } };
const HANDLED_BODY = { schema: { id: { t: 'str', required: true, max: 64, line: true, pattern: /^in-[0-9TZ]+-[0-9a-f]{4,}$/ }, note: { t: 'str', max: 500, line: true }, withdrawn: { t: 'bool' } } satisfies Record<string, Spec>, required: ['id'] };
const ASK_PUT_BODY = {
  schema: {
    ref: REF,
    ask: { t: 'str', max: 200, line: true }, kind: { t: 'enum', values: ASK_KINDS }, from: { t: 'str', max: 80, line: true }, project: { t: 'str', max: 80, line: true },
    why: { t: 'str', max: 500, line: true }, recommend: { t: 'str', max: 200, line: true }, options: { t: 'strs', max: 4, commas: true }, default: { t: 'str', max: 200, line: true },
    by: { t: 'str', max: 40, line: true, pattern: /^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:\d{2})?)?$/ }, reversible: { t: 'bool' },
    link: { t: 'str', max: 2000, line: true, pattern: /^https:\/\/[^\s]+$/ }, priority: { t: 'enum', values: ASK_PRIORITIES },
    effort: { t: 'str', max: 4, line: true, pattern: /^\d{1,3}[mh]$/ }, blocks: { t: 'int', min: 0, max: 99 }, detail: { t: 'str', max: 20_000 }, reopen: { t: 'bool' },
    // quick triage. @req FR:quick-triage/api.put
    flow: { t: 'str', max: 80, line: true, pattern: /^[a-z0-9][a-z0-9._-]{0,79}$/ }, seq: { t: 'int', min: 1, max: 99 }, apply: { t: 'str', max: 500, line: true }, applies: { t: 'strs', max: 4, commas: false },
  } satisfies Record<string, Spec>,
  required: [] as string[],
};
const ASK_ANSWER_BODY = {
  schema: { answer: { t: 'enum', values: ASK_ANSWERS }, text: { t: 'str', max: 1000, line: true }, until: { t: 'str', max: 40, line: true } } satisfies Record<string, Spec>,
  required: ['answer'],
};
const NEED_ANSWER_BODY = {
  schema: { choice: { t: 'enum', values: ['go', 'defer', 'reply', 'undo'] }, text: { t: 'str', max: 1000, line: true }, until: { t: 'str', max: 40, line: true } } satisfies Record<string, Spec>,
  required: ['choice'],
};
const PR_PRI_BODY = {
  schema: {
    rev: { t: 'int', min: 0, max: 1_000_000_000 }, op: { t: 'enum', values: QUEUE_OPS }, ref: { t: 'str', max: 300, line: true },
    rank: { t: 'int', min: 1, max: 100 }, to: { t: 'enum', values: MOVE_TO }, note: { t: 'str', max: 300, line: true }, thread: { t: 'str', max: 2000, line: true },
  } satisfies Record<string, Spec>,
  required: ['rev', 'op'],
};
const PR_REC_BODY = {
  schema: {
    repo: { t: 'str', max: 140, line: true }, number: { t: 'int', min: 1, max: 9_999_999 }, agent: { t: 'str', max: 40, line: true },
    reason: { t: 'str', max: 300, line: true }, toRank: { t: 'int', min: 1, max: 100 },
  } satisfies Record<string, Spec>,
  required: ['repo', 'number', 'agent', 'reason'],
};
const PR_DECIDE_BODY = {
  schema: { decision: { t: 'enum', values: DECISIONS }, rank: { t: 'int', min: 1, max: 100 }, note: { t: 'str', max: 300, line: true }, reason: { t: 'str', max: 300, line: true } } satisfies Record<string, Spec>,
  required: ['decision'],
};
const PR_DEC_Q: Record<string, Spec> = { agent: { t: 'str', max: 40, line: true } };
const RANK_Q: Record<string, Spec> = { limit: { t: 'int', min: 1, max: 1000 }, blocks: { t: 'enum', values: ['now', 'any'] } };
const PR_REPO: Spec = { t: 'str', required: true, max: 140, pattern: /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/ };
const PR_NUM: Spec = { t: 'int', min: 1, max: 9_999_999 };
export const PR_QUEUE_OPS = ['top', 'up', 'down', 'move', 'add', 'pin', 'unpin', 'remove', 'undo'] as const;
const PR_QUEUE_BODY = { schema: { repo: PR_REPO, number: PR_NUM, op: { t: 'enum', values: PR_QUEUE_OPS }, rank: { t: 'int', min: 1, max: 100 } } satisfies Record<string, Spec>, required: ['repo', 'number', 'op'] };
const PR_LABEL_BODY = { schema: { repo: PR_REPO, number: PR_NUM, op: { t: 'enum', values: ['add', 'remove'] } } satisfies Record<string, Spec>, required: ['repo', 'number', 'op'] };
const PR_ACK_BODY = {
  schema: { repo: PR_REPO, number: PR_NUM, thread: { t: 'str', required: true, max: 500, line: true, pattern: /^https:\/\/github\.com\/\S+$/ }, note: { t: 'str', required: true, max: 300, line: true }, post: { t: 'bool' }, text: { t: 'str', max: 4000 }, replyTo: { t: 'int', min: 1, max: Number.MAX_SAFE_INTEGER } } satisfies Record<string, Spec>,
  required: ['repo', 'number', 'thread', 'note'],
};
const PRS_REC_BODY = {
  schema: { decision: { t: 'enum', values: ['accept', 'edit', 'reject'] }, rank: { t: 'int', min: 1, max: 100 }, note: { t: 'str', max: 300, line: true }, reason: { t: 'str', max: 300, line: true } } satisfies Record<string, Spec>,
  required: ['decision'],
};
const INBOX_ACTION_BODY = {
  schema: { action: { t: 'enum', values: ACTION_IDS }, text: { t: 'str', max: 5000 }, until: { t: 'str', max: 40, line: true }, request: { t: 'bool' } } satisfies Record<string, Spec>,
  required: ['action'],
};
const ASK_HANDLE_BODY = {
  schema: { outcome: { t: 'enum', values: ASK_OUTCOMES }, note: { t: 'str', max: 500, line: true }, reply: { t: 'str', max: 1000, line: true } } satisfies Record<string, Spec>,
  required: ['outcome'],
};
const UUID: Spec = { t: 'str', required: true, max: 36, line: true, pattern: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i };
const SESSIONS_Q: Record<string, Spec> = { limit: { t: 'int', min: 1, max: 200 } };
const COST_Q: Record<string, Spec> = { days: { t: 'int', min: 1, max: 90 } };
const SLUG: Spec = { t: 'str', max: 40, line: true, pattern: /^[a-z0-9][a-z0-9._-]{0,39}$/ };
/** `ref`/`agent` on a follow-up re-apply the task persona. @req FR:agent-thread/thread.ask */
const PROMPT_BODY = { schema: { text: { t: 'str', required: true, max: 4000 }, ref: REF, agent: SLUG } satisfies Record<string, Spec>, required: ['text'] };
/** `cwd` is optional since agent-team: a session for a task runs in the served folder unless a folder is given. @req FR:agent-team/talk.api */
const NEW_SESSION_BODY = { schema: { cwd: { t: 'str', max: 1000, line: true }, text: { t: 'str', required: true, max: 4000 }, agent: SLUG, ref: REF, project: { t: 'str', max: 200, line: true, noReadme: true } } satisfies Record<string, Spec>, required: ['text'] };
const TEAM_Q: Record<string, Spec> = { project: { t: 'str', max: 200, line: true }, section: { t: 'str', max: 200, line: true } };
const REVIEWS_Q: Record<string, Spec> = { project: { t: 'str', required: true, max: 200, line: true } };
const REVIEW_BODY = { schema: { ref: { t: 'ref', required: true }, agent: SLUG } satisfies Record<string, Spec>, required: ['ref'] };
const REPLY_BODY = { schema: { ref: REF, text: { t: 'str', required: true, max: 1000, line: true }, expect: { t: 'str', max: 2000, line: true } } satisfies Record<string, Spec>, required: ['ref', 'text'] };
const ASSIGN_BODY = { schema: { agent: SLUG, note: { t: 'str', max: 1000, line: true } } satisfies Record<string, Spec>, required: [] as string[] };
/** The ref in a path segment (`/tasks/{ref}/...`). */
const refParam = (c: Ctx) => { const r = parseRef(c.params[0]); if (!r) throw invalid([{ field: 'ref', message: 'Must be project:line' }]); return r; };
const BRIEF_Q: Record<string, Spec> = { refresh: { t: 'str', max: 1 } };
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
  // @req FR:perf/load.parallel
  return Promise.all((await storage.list()).filter((p) => baseName(p).toLowerCase() !== 'readme').map(async (path) => {
    const f = await storage.read(path);
    return { name: baseName(path), path, content: f.content, project: parseProject(f.content) };
  }));
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
/** @req FR:pr-review-lane/lane.api */
const LIVE_ITEM_BODY = {
  schema: {
    op: { t: 'enum', values: ITEM_OPS }, repo: { t: 'str', max: 140, line: true, pattern: /^[A-Za-z0-9][A-Za-z0-9-]{0,38}\/[A-Za-z0-9._-]{1,100}$/ },
    number: { t: 'int', min: 1, max: 9999999 }, id: { t: 'str', max: 11, line: true, pattern: /^li-[0-9a-f]{8}$/ },
    text: { t: 'str', max: 300, line: true }, reason: { t: 'str', max: 300, line: true },
  } satisfies Record<string, Spec>,
  required: ['op', 'repo', 'number'],
};
/** Lane errors as API errors with the core's fixed text. */
async function liveCall<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    if (!(e instanceof LiveError)) throw e;
    if (e.code === 'notfound') throw new ApiError('not_found', e.message);
    if (e.code === 'conflict') throw new ApiError('conflict', e.message);
    throw invalid([{ field: 'body', message: e.message }]);
  }
}

const ownerOnly = (c: Ctx, why: string) => { if (!isOwner(c.req)) throw new ApiError('forbidden', why); };
const prStore = (c: Ctx): PrPriorityStore => { if (!c.deps.prPriority) throw new ApiError('not_found', 'No PR priority store on this host'); return c.deps.prPriority; };
/** The list view (cached facts only) plus open recommendations. @req FR:pr-priority/view.item */
const prView = (c: Ctx, s: PrPriorityStore) => { const q = s.read(); return { ...q, items: s.view(), escalations: s.state().escalations ?? null, recommendations: s.openRecs() }; };
/** The PR page parts, or 404 where the host has no GitHub token. @req FR:pr-page/api.get */
const boardOf = (c: Ctx): PrBoardService => { if (!c.deps.prBoard) throw new ApiError('not_found', 'No PR board on this host'); return c.deps.prBoard; };
const writesOf = (c: Ctx): GitHubWrites => { if (!c.deps.prWrites) throw new ApiError('not_found', 'No GitHub writes on this host'); return c.deps.prWrites; };
const queueOf = (c: Ctx): PrQueue => { if (!c.deps.prQueue) throw new ApiError('conflict', 'PR priority queue is not installed'); return c.deps.prQueue; };
/** GitHub writes only reach PRs on the owner's board, even with no repo allow-list. @req FR:pr-page/api.repos */
async function onBoard(c: Ctx, pr: { repo: string; number: number }): Promise<PrRow> {
  const row = (await boardOf(c).get()).rows.find((r) => r.repo.toLowerCase() === pr.repo.toLowerCase() && r.number === pr.number);
  if (!row) throw new ApiError('forbidden', 'This PR is not on your board');
  return row;
}
/** Queue errors to 409 with the reason. @req FR:pr-page/api.queue-client */
async function prQueueCall(fn: () => Promise<void>): Promise<void> {
  try { await fn(); } catch (e) { if (e instanceof QueueUnavailable || e instanceof QueueRefused) throw new ApiError('conflict', e.message); throw e; }
}
/** GitHub write errors: a refused write is 403; a GitHub failure is 409 with the status only. @req FR:github-pr-status/write.errors @req FR:pr-page/api.repos */
async function ghCall(fn: () => Promise<void>): Promise<void> {
  try { await fn(); } catch (e) {
    if (e instanceof GitHubWriteDenied) throw new ApiError('forbidden', e.message);
    if (e instanceof Error && /^GitHub \d+$/.test(e.message)) throw new ApiError('conflict', e.message);
    throw e;
  }
}

const SOURCES_Q: Record<string, Spec> = { fresh: { t: 'enum', values: ['1', 'true'] } };
/** Sources from the sync records, the config and (local host) this machine's probe. A failing probe reads as none. @req FR:inbox-page/api.sources @req FR:inbox-page/src.fresh */
async function inboxSources(c: Ctx, fresh: boolean) {
  const probe = c.deps.inboxProbe;
  return loadSources({ storage: c.deps.storage, now: c.deps.now?.() ?? new Date(), ...(probe ? { probe: () => probe(fresh ? { fresh: true } : undefined) } : {}), ...(c.deps.config?.inbox ? { inbox: c.deps.config.inbox } : {}) });
}

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
    const { ref: _r, clearEmojis, expect: _e, ...rest } = b;
    void _r; void _e;
    ref = await authorizeMutation(c.life, ref, name, name === 'set' ? { ...rest, ...(clearEmojis !== undefined ? { removeAllEmojis: clearEmojis as boolean } : {}) } as TaskProps : {});
  }
  switch (name) {
    case 'start': return result(await startTask(c.life, ref));
    case 'skip': return result(await skipTask(c.life, ref));
    case 'resume': return result(await resumeTask(c.life, ref));
    case 'complete': return result(await completeTask(c.life, ref, { summary: b.summary as string | undefined, remove: b.remove as boolean | undefined }));
    case 'suspend': return result(await suspendTask(c.life, ref, { days: b.days as number | undefined, hours: b.hours as number | undefined }));
    case 'set': {
      const { ref: _r, clearEmojis, expect, ...rest } = b;
      void _r;
      // `expect`: the task text the caller saw; another row now at this line is a 409, never a silent write to the wrong task. @req FR:task-detail-design/detail.save
      // A token's ref is already pinned to the current row (authorizeMutation); a different expect is then a conflict too.
      if (expect !== undefined && ref!.text !== undefined && ref!.text.trim() !== (expect as string).trim()) throw new ApiError('conflict', 'Conflict');
      const pinned = expect !== undefined && ref!.text === undefined ? { ...ref!, text: expect as string } : ref!;
      return result(await setProperties(c.life, pinned, { ...rest, ...(clearEmojis !== undefined ? { removeAllEmojis: clearEmojis as boolean } : {}) } as TaskProps));
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
    // @req FR:api/routes.rank
    // The one ranking: engine order plus the overrides.
    method: 'GET', doc: '/rank', name: 'rank', query: RANK_Q,
    async run(c) {
      const q = readQuery(c.url, Object.keys(RANK_Q));
      const limit = intParam(q, 'limit', 20, 1, 1000);
      const blocks = q.get('blocks') ?? 'now';
      // readQuery checks names only, not enum values: this check is the only one for `blocks`.
      if (blocks !== 'now' && blocks !== 'any') throw invalid([{ field: 'blocks', message: 'Must be now or any' }]);
      const items = (await rankStack(c.life, undefined, limit, { ignoreBlocks: blocks === 'any' })).map((t) => ({ ref: formatRef(t.ref), text: t.text, project: t.project, score: t.score, ...(t.rule ? { rule: t.rule } : {}), ...(t.root ? { root: formatRef(t.root) } : {}) }));
      return json(200, { items });
    },
  },
  {
    // The weekly meetings in `.stack/meetings.md`: Brief's fallback when no calendar is signed in. @req FR:cos-view/meet.api
    method: 'GET', doc: '/meetings', name: 'meetings.list',
    async run(c) {
      noQuery(c);
      if (!isOwner(c.req)) throw new ApiError('forbidden', 'Only the owner can read the meetings');
      return json(200, { items: await readMeetings(c.deps.storage) });
    },
  },
  {
    // @req FR:ask-queue/needs.api @req FR:ask-queue/needs.read
    method: 'GET', doc: '/needs-you', name: 'needs.list',
    async run(c) {
      noQuery(c);
      // Report asks, PR priority recommendations and blocked live checks come from the live store. @req FR:status-ingest/needs.list @req FR:pr-review-lane/lane.needs
      return json(200, { items: [...await readNeeds(c.deps.storage), ...(c.deps.reports?.needs() ?? []), ...(c.deps.prPriority?.needs() ?? []), ...(c.deps.live?.needs() ?? [])] });
    },
  },
  {
    // The owner's answer, written onto the item (the CoS owns the list). @req FR:ask-queue/needs.api @req FR:ask-queue/needs.answer
    method: 'POST', doc: '/needs-you/{id}/answer', name: 'needs.answer', body: NEED_ANSWER_BODY,
    async run(c) {
      noQuery(c);
      ownerOnly(c, 'Only the owner can answer a need');
      const b = validate<{ choice: 'go' | 'defer' | 'reply' | 'undo'; text?: string; until?: string }>(await readBody(c.req), NEED_ANSWER_BODY.schema, NEED_ANSWER_BODY.required);
      if (b.choice === 'defer' && (!b.until || Number.isNaN(Date.parse(b.until)))) throw invalid([{ field: 'until', message: 'Required for defer: an ISO date or time' }]);
      if (b.choice === 'reply' && !b.text?.trim()) throw invalid([{ field: 'text', message: 'Required for reply' }]);
      // @req FR:status-ingest/needs.answer
      // A PR priority recommendation: go accepts; the other choices need the decide route. @req FR:pr-priority/needs.actions
      if (c.params[0].startsWith('pp.') && c.deps.prPriority) {
        const id = c.params[0].slice(3);
        if (b.choice !== 'go') throw new ApiError('bad_request', `Use POST /api/pr-priority/recommendations/${id} with decision accept, edit or reject`);
        await c.deps.prPriority.decide(id, { decision: 'accept' });
      } else if (c.params[0].startsWith('rp.') && c.deps.reports) { await c.deps.reports.answer(c.params[0], b);
      } else if (c.params[0].startsWith('lv.') && c.deps.live) return json(200, { changed: await liveCall(() => c.deps.live!.answerNeed(c.params[0], b)) });
      else await answerNeed(c.deps.storage, c.params[0], b, (c.deps.now ?? (() => new Date()))());
      return json(200, { changed: true });
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
  {
    // The owner's words about the app, for an agent tailing ~/.stack/feedback.jsonl. @req FR:feedback-button/api.route
    method: 'POST', doc: '/feedback', name: 'feedback', body: FEEDBACK_BODY,
    async run(c) {
      noQuery(c);
      ownerOnly(c, 'Only the owner can send feedback');
      if (!c.deps.feedback) throw new ApiError('not_found', 'No feedback store on this host');
      const b = validate<{ text: string; route?: string; viewport?: string; theme?: 'light' | 'dark'; capture?: boolean; png?: string }>(await readBody(c.req, 1_000_000), FEEDBACK_BODY.schema, FEEDBACK_BODY.required);
      try {
        const it = await c.deps.feedback.add({ text: b.text, route: b.route, viewport: b.viewport, theme: b.theme }, { png: b.png ? Buffer.from(b.png, 'base64') : undefined, capture: b.capture });
        return json(201, { id: it.id, at: it.at, screenshot: !!it.screenshotPath });
      } catch (e) {
        if (e instanceof FeedbackError && e.code === 'invalid') throw invalid([{ field: /screenshot/.test(e.message) ? 'png' : 'text', message: e.message }]);
        if (e instanceof FeedbackError && e.code === 'busy') throw new ApiError('conflict', e.message);
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
      const b = validate<{ id: string; note?: string; withdrawn?: boolean }>(await readBody(c.req), HANDLED_BODY.schema, HANDLED_BODY.required);
      // Only the owner takes back what the owner sent; an agent must never hide the owner's words. @req FR:agent-inbox/inbox.withdraw
      if (b.withdrawn && !isOwner(c.req)) throw new ApiError('forbidden', 'Only the owner can withdraw a message');
      return json(200, await handleEntry(c.life, b.id, caller(c.req).actor, b.note, { withdrawn: !!b.withdrawn }));
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
      const { ref, ...b } = validate<AskPut & { ref?: ReturnType<typeof parseRef> }>(await readBody(c.req), ASK_PUT_BODY.schema, ASK_PUT_BODY.required);
      // A token names its agent (the token's name); the owner session writes as `owner`.
      const actor = caller(c.req).actor;
      // `perm-*` asks belong to the permission broker: a token rewriting one could make the owner approve a misdescribed tool call.
      if (actor !== 'owner' && c.params[0].startsWith('perm-')) throw new ApiError('forbidden', 'Permission asks are written by Stack only');
      const name = actor.startsWith('token:') ? (c.token?.name ?? 'agent') : actor;
      // A token updates only asks it wrote (security M5); the owner may update any ask.
      return json(200, await putAsk(c.life, c.params[0], { ...b, ...(ref ? { ref: formatRef(ref) } : {}) }, name, actor.startsWith('token:') ? { writer: `token:${name}` } : {}));
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
  {
    // The body is nested, so the core checks it (one schema for CLI and API); the OpenAPI body is authored in openapi.ts.
    // @req FR:status-ingest/api.put @req FR:status-ingest/api.invalid @req FR:status-ingest/auth.writer
    method: 'POST', doc: '/reports', name: 'reports.put',
    async run(c) {
      noQuery(c);
      const body = await readBody(c.req);
      const actor = caller(c.req).actor;
      const name = actor.startsWith('token:') ? (c.token?.name ?? 'agent') : actor;
      try {
        if (!c.deps.reports) throw new ApiError('not_found', 'No report store on this host');
        return json(200, await c.deps.reports.put(body, actor.startsWith('token:') ? { writer: `token:${name}` } : {}));
      } catch (e) {
        if (e instanceof ReportInvalid) throw new ApiError('bad_request', 'Validation failed', e.issues);
        throw e;
      }
    },
  },
  {
    // The Chief of Staff view reads the latest reports; owner only. @req FR:cos-base-of-ops/api.list
    method: 'GET', doc: '/reports', name: 'reports.list',
    async run(c) {
      noQuery(c);
      ownerOnly(c, 'Only the owner can read reports');
      if (!c.deps.reports) throw new ApiError('not_found', 'No report store on this host');
      return json(200, { items: c.deps.reports.list() });
    },
  },
  {
    // Session titles are the owner's: owner only. @req FR:session-inventory/api.inventory
    method: 'GET', doc: '/session-inventory', name: 'inventory.list',
    async run(c) {
      noQuery(c);
      ownerOnly(c, 'Only the owner can read the session inventory');
      if (!c.deps.inventory) throw new ApiError('not_found', 'No session inventory on this host');
      return json(200, c.deps.inventory());
    },
  },
  {
    // @req FR:session-inventory/api.pris.get
    method: 'GET', doc: '/pris', name: 'pris.get',
    async run(c) {
      noQuery(c);
      ownerOnly(c, 'Only the owner can read priorities');
      if (!c.deps.pris) throw new ApiError('not_found', 'No priorities store on this host');
      return json(200, c.deps.pris.read());
    },
  },
  {
    // The list is nested, so the core checks it; the OpenAPI body is authored in openapi.ts. @req FR:session-inventory/api.pris.put
    method: 'POST', doc: '/pris', name: 'pris.put',
    async run(c) {
      noQuery(c);
      ownerOnly(c, 'Only the owner can change priorities');
      if (!c.deps.pris) throw new ApiError('not_found', 'No priorities store on this host');
      const b = await readBody(c.req) as { rev?: unknown; pris?: unknown } | null;
      const issues: { field: string; message: string }[] = [];
      if (!b || typeof b !== 'object' || Array.isArray(b)) throw new ApiError('bad_request', 'Validation failed', [{ field: 'body', message: 'Must be a JSON object {rev, pris}' }]);
      for (const k of Object.keys(b)) if (k !== 'rev' && k !== 'pris') issues.push({ field: k, message: 'Unknown field' });
      if (!Number.isInteger(b.rev) || (b.rev as number) < 0) issues.push({ field: 'rev', message: 'Required: the rev you read' });
      if (issues.length) throw new ApiError('bad_request', 'Validation failed', issues);
      try {
        return json(200, await c.deps.pris.put(b.rev as number, b.pris));
      } catch (e) {
        if (e instanceof PrisInvalid) throw new ApiError('bad_request', 'Validation failed', e.issues.map((i) => ({ ...i, field: i.field === 'pris' ? 'pris' : `pris${i.field}` })));
        throw e;
      }
    },
  },
  {
    // The list view with open recommendations; owner only. @req FR:pr-priority/api.get
    method: 'GET', doc: '/pr-priority', name: 'prPriority.get',
    async run(c) {
      noQuery(c);
      ownerOnly(c, 'Only the owner can read the PR priorities');
      return json(200, prView(c, prStore(c)));
    },
  },
  {
    // One queue action; idempotent; returns the list view. @req FR:pr-priority/api.put @req FR:pr-priority/queue.idem
    method: 'POST', doc: '/pr-priority', name: 'prPriority.put', body: PR_PRI_BODY,
    async run(c) {
      noQuery(c);
      ownerOnly(c, 'Only the owner can change the PR priorities');
      const s = prStore(c);
      const b = validate<{ rev: number; op: (typeof QUEUE_OPS)[number]; ref?: string; rank?: number; to?: (typeof MOVE_TO)[number]; note?: string; thread?: string }>(await readBody(c.req), PR_PRI_BODY.schema, PR_PRI_BODY.required);
      if (b.op !== 'undo' && !b.ref) throw invalid([{ field: 'ref', message: `Required for ${b.op}` }]);
      let changed: boolean;
      if (b.op === 'ack') {
        if (!b.thread || !b.note) throw invalid([{ field: b.thread ? 'note' : 'thread', message: 'Required for ack' }]);
        changed = (await s.ack(b.ref!, b.thread, b.note)).changed;
      } else {
        if (b.op === 'move' && b.to === undefined && b.rank === undefined) throw invalid([{ field: 'to', message: 'Required for move: top, up, down, or rank' }]);
        const op: QueueOp = b.op === 'undo' ? { op: 'undo' }
          : b.op === 'add' ? { op: 'add', ref: b.ref!, ...(b.rank !== undefined ? { rank: b.rank } : {}), ...(b.note !== undefined ? { note: b.note } : {}) }
            : b.op === 'move' ? { op: 'move', ref: b.ref!, to: b.to ?? b.rank!, ...(b.note !== undefined ? { note: b.note } : {}) }
              : { op: b.op, ref: b.ref! };
        changed = (await s.edit(op, { rev: b.rev })).changed;
      }
      return json(200, { changed, ...prView(c, s) });
    },
  },
  {
    // An agent token may recommend; a blocked recommendation is 409 with the reason. @req FR:pr-priority/api.recommend
    method: 'POST', doc: '/pr-priority/recommendations', name: 'prPriority.recommend', body: PR_REC_BODY,
    async run(c) {
      noQuery(c);
      const b = validate<{ repo: string; number: number; agent: string; reason: string; toRank?: number }>(await readBody(c.req), PR_REC_BODY.schema, PR_REC_BODY.required);
      // A token speaks only for itself: `agent` must be the token name (as a slug). @req FR:pr-priority/api.recommend
      if (caller(c.req).actor.startsWith('token:')) {
        const own = (c.token?.name ?? '').toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
        if (b.agent !== own) throw new ApiError('forbidden', 'agent must be the token name');
      }
      const r = await prStore(c).recommend(b);
      if ('blocked' in r) { const t = blockedText(r.blocked); throw new ApiError('conflict', `Blocked: ${t}`, [{ field: r.blocked.kind === 'rejected' ? 'reason' : 'number', message: t }]); }
      return json(200, r);
    },
  },
  {
    // Prior decisions so agents do not retry. @req FR:pr-priority/api.decisions
    method: 'GET', doc: '/pr-priority/recommendations', name: 'prPriority.decisions', query: PR_DEC_Q,
    async run(c) {
      const q = readQuery(c.url, Object.keys(PR_DEC_Q));
      return json(200, { items: prStore(c).decisions(q.get('agent') ?? undefined) });
    },
  },
  {
    // The owner accepts, edits or rejects. @req FR:pr-priority/api.decide
    method: 'POST', doc: '/pr-priority/recommendations/{id}', name: 'prPriority.decide', body: PR_DECIDE_BODY,
    async run(c) {
      noQuery(c);
      ownerOnly(c, 'Only the owner can decide a recommendation');
      const b = validate<{ decision: (typeof DECISIONS)[number]; rank?: number; note?: string; reason?: string }>(await readBody(c.req), PR_DECIDE_BODY.schema, PR_DECIDE_BODY.required);
      return json(200, await prStore(c).decide(c.params[0], b));
    },
  },
  {
    // PR titles and blockers are the owner's: owner only. @req FR:pr-page/api.get @req FR:pr-page/act.owner
    method: 'GET', doc: '/prs', name: 'prs.get',
    async run(c) {
      noQuery(c);
      ownerOnly(c, 'Only the owner can read the PR board');
      // No token: say so with 200, so the page hides the icon without a failing request. @req FR:pr-page/icon.absent
      if (!c.deps.prBoard) return json(200, { off: true });
      return json(200, await boardOf(c).get());
    },
  },
  {
    // @req FR:pr-page/api.queue @req FR:pr-page/act.queue
    method: 'POST', doc: '/prs/queue', name: 'prs.queue', body: PR_QUEUE_BODY,
    async run(c) {
      noQuery(c);
      ownerOnly(c, 'Only the owner can change the PR queue');
      const b = validate<{ repo: string; number: number; op: (typeof PR_QUEUE_OPS)[number]; rank?: number }>(await readBody(c.req), PR_QUEUE_BODY.schema, PR_QUEUE_BODY.required);
      const ref = `${b.repo}#${b.number}`;
      const board = boardOf(c);
      const find = async () => (await board.get()).rows.find((r) => r.repo.toLowerCase() === b.repo.toLowerCase() && r.number === b.number);
      const cur = (await find())?.rank ?? null;
      const q = queueOf(c);
      // The ops are the `stack pr-pri` ones: add (top), move --to, pin, unpin, remove, undo. @req FR:pr-page/api.queue-client
      await prQueueCall(() => {
        switch (b.op) {
          case 'top': case 'up': case 'down': return q.move(ref, b.op);
          case 'move': return q.move(ref, b.rank ?? 1);
          case 'add': return q.add(ref);
          case 'pin': return q.pin(ref);
          case 'unpin': return q.unpin(ref);
          case 'remove': return q.remove(ref);
          default: return q.undo();
        }
      });
      // The queue file changed, not GitHub: the next board build reads it, no GitHub call.
      const now = await find();
      return json(200, { rank: now?.rank ?? null, was: cur, pinned: !!now?.pinned });
    },
  },
  {
    // The label is always Autopilot: the owner's click is the human act. @req FR:pr-page/api.label @req FR:pr-page/act.autopilot @req FR:pr-page/api.repos
    method: 'POST', doc: '/prs/label', name: 'prs.label', body: PR_LABEL_BODY,
    async run(c) {
      noQuery(c);
      ownerOnly(c, 'Only the owner can label a PR');
      const b = validate<{ repo: string; number: number; op: 'add' | 'remove' }>(await readBody(c.req), PR_LABEL_BODY.schema, PR_LABEL_BODY.required);
      const w = writesOf(c);
      const row = await onBoard(c, b);
      // Remove the label as this repo spells it; reads match it without case or emoji variants.
      const name = b.op === 'remove' ? row.labels.find((l) => sameLabel(l, LABELS.autopilot)) ?? LABELS.autopilot : LABELS.autopilot;
      await ghCall(() => (b.op === 'add' ? w.addLabel(b, name) : w.removeLabel(b, name)));
      await c.deps.prBoard?.refresh();
      return json(200, { ok: true, label: LABELS.autopilot, op: b.op });
    },
  },
  {
    // Records the owner's ack; posting to GitHub is opt-in and AI-prefixed. @req FR:pr-page/api.ack @req FR:pr-page/act.accept
    method: 'POST', doc: '/prs/ack', name: 'prs.ack', body: PR_ACK_BODY,
    async run(c) {
      noQuery(c);
      ownerOnly(c, 'Only the owner can answer for a PR');
      const b = validate<{ repo: string; number: number; thread: string; note: string; post?: boolean; text?: string; replyTo?: number }>(await readBody(c.req), PR_ACK_BODY.schema, PR_ACK_BODY.required);
      if (b.post && !(b.text ?? '').startsWith(AI_PREFIX)) throw invalid([{ field: 'text', message: `Must start with "${AI_PREFIX.trim()}"` }]);
      const w = b.post ? writesOf(c) : null;
      if (!w) queueOf(c);
      // Post first: a failed post records nothing. After a post, a failed record answers 200 with recorded false, so no one posts twice.
      if (w) { await onBoard(c, b); await ghCall(() => (b.replyTo ? w.reply(b, b.replyTo, b.text!) : w.comment(b, b.text!))); }
      try { await prQueueCall(() => queueOf(c).ack(`${b.repo}#${b.number}`, b.thread, b.note)); } catch (e) {
        if (w && e instanceof ApiError) { await c.deps.prBoard?.refresh(); return json(200, { ok: true, posted: true, recorded: false, message: e.message }); }
        throw e;
      }
      if (w) await c.deps.prBoard?.refresh();
      return json(200, { ok: true, posted: !!w, recorded: true });
    },
  },
  {
    // @req FR:pr-page/api.rec @req FR:pr-page/act.rec
    method: 'POST', doc: '/prs/recs/{id}', name: 'prs.rec', body: PRS_REC_BODY,
    async run(c) {
      noQuery(c);
      ownerOnly(c, 'Only the owner can decide a recommendation');
      if (!/^pp-[0-9a-f]{8}$/.test(c.params[0])) throw invalid([{ field: 'id', message: 'Must be pp- and 8 hex characters' }]);
      const b = validate<{ decision: 'accept' | 'edit' | 'reject'; rank?: number; note?: string; reason?: string }>(await readBody(c.req), PRS_REC_BODY.schema, PRS_REC_BODY.required);
      if (b.decision !== 'accept' && !b.reason?.trim()) throw invalid([{ field: 'reason', message: 'Required for edit and reject' }]);
      const id = c.params[0];
      const q = queueOf(c);
      // `accept`, `edit`, `reject` are the `stack pr-pri` decisions. @req FR:pr-page/api.queue-client
      await prQueueCall(() => (b.decision === 'accept' ? q.accept(id) : b.decision === 'edit' ? q.edit(id, { reason: b.reason!, ...(b.rank ? { rank: b.rank } : {}), ...(b.note ? { note: b.note } : {}) }) : q.reject(id, b.reason!)));
      return json(200, { ok: true });
    },
  },
  {
    // Cached facts and briefs only: no GitHub call, no token in the browser. @req FR:pr-review-lane/sort.api @req FR:pr-review-lane/brief.api
    method: 'GET', doc: '/pr-review', name: 'prReview.get',
    async run(c) {
      noQuery(c);
      if (!c.deps.briefs || !c.deps.facts) throw new ApiError('not_found', 'No PR review store on this host');
      const facts = c.deps.facts.read();
      return json(200, { facts, briefs: briefViews(c.deps.briefs.read(), facts) });
    },
  },
  {
    // @req FR:pr-review-lane/lane.api
    method: 'GET', doc: '/live', name: 'live.get',
    async run(c) {
      noQuery(c);
      if (!c.deps.live) throw new ApiError('not_found', 'No live lane on this host');
      return json(200, c.deps.live.view());
    },
  },
  {
    // An owner call is by owner; a token call is by the token name. Never touches GitHub. @req FR:pr-review-lane/lane.api @req FR:pr-review-lane/lane.guard
    method: 'POST', doc: '/live/items', name: 'live.item', body: LIVE_ITEM_BODY,
    async run(c) {
      noQuery(c);
      if (!c.deps.live) throw new ApiError('not_found', 'No live lane on this host');
      const b = validate<{ op: ItemOp; repo: string; number: number; id?: string; text?: string; reason?: string }>(await readBody(c.req), LIVE_ITEM_BODY.schema, LIVE_ITEM_BODY.required);
      const by = isOwner(c.req) ? 'owner' : (c.token?.name ?? 'agent').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/^-+/, '').slice(0, 40) || 'agent';
      const r = { repo: b.repo, number: b.number, url: `https://github.com/${b.repo}/pull/${b.number}` };
      return json(200, await liveCall(() => c.deps.live!.item(r, b.op, { id: b.id, text: b.text, reason: b.reason, by })));
    },
  },
  {
    // @req FR:inbox-page/api.read
    method: 'GET', doc: '/inbox-items', name: 'inboxItems.list',
    async run(c) {
      noQuery(c);
      ownerOnly(c, 'Only the owner can read the inbox');
      const { items, verified } = await readInboxChecked(c.deps.storage);
      const src = await inboxSources(c, false);
      // Fresh syncs say nothing about an item file that is missing or unreadable: no zero claim off that. @req FR:inbox-page/src.summary
      return json(200, { items, actions: INBOX_ACTIONS, ...src, summary: { ...src.summary, canClaimZero: src.summary.canClaimZero && verified } });
    },
  },
  {
    // @req FR:inbox-page/api.sources
    method: 'GET', doc: '/inbox-sources', name: 'inboxSources.list', query: SOURCES_Q,
    async run(c) {
      const q = readQuery(c.url, Object.keys(SOURCES_Q));
      ownerOnly(c, 'Only the owner can read inbox sources');
      return json(200, await inboxSources(c, q.get('fresh') === '1' || q.get('fresh') === 'true'));
    },
  },
  {
    // Never sends: the only mail write is a reply draft. @req FR:inbox-page/api.act
    method: 'POST', doc: '/inbox-items/{id}/action', name: 'inboxItems.action', body: INBOX_ACTION_BODY,
    async run(c) {
      noQuery(c);
      ownerOnly(c, 'Only the owner can act on the inbox');
      const b = validate<{ action: ActionId; text?: string; until?: string; request?: boolean }>(await readBody(c.req), INBOX_ACTION_BODY.schema, INBOX_ACTION_BODY.required);
      const item = (await readInbox(c.deps.storage)).find((i) => i.id === c.params[0]);
      if (!item) throw new ApiError('not_found', 'Inbox item not found');
      const addProjectTask = (text: string) => addTask(c.life, { project: 'stack', text });
      if (b.request) return json(200, await requestAction(item, b.action, { filer: c.deps.issues ?? { file: async () => { throw new Error('no filer'); } }, addTask: addProjectTask }));
      if (b.action === 'reply-draft' && !c.deps.mail) throw new ApiError('conflict', 'Mail is not connected');
      return json(200, await runAction(item, b, { ctx: c.life, ...(c.deps.mail ? { mail: c.deps.mail } : {}), addTask: addProjectTask }));
    },
  },
  {
    // @req FR:cos-view/brief.ai.route
    method: 'GET', doc: '/brief/summary', name: 'brief.summary', query: BRIEF_Q,
    async run(c) {
      const q = readQuery(c.url, Object.keys(BRIEF_Q));
      if (!isOwner(c.req)) throw new ApiError('forbidden', 'Only the owner can read the brief');
      if (!c.deps.brief) return json(200, { configured: false });
      const now = (c.deps.now ?? (() => new Date()))();
      const asks = await listAsks(c.life, { state: 'open', limit: 200 });
      return json(200, await c.briefCache({ model: c.deps.brief, asks: asks.items, now, refresh: q.get('refresh') === '1', onError: c.deps.onError }));
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
      const b = validate<{ cwd?: string; text: string; agent?: string; ref?: ReturnType<typeof parseRef>; project?: string }>(await readBody(c.req), NEW_SESSION_BODY.schema, NEW_SESSION_BODY.required);
      const agents = agentsOf(c);
      ownerOnly(c, 'Only the owner can message an agent');
      if (b.cwd !== undefined && (!isAbsolute(b.cwd) || !existsSync(b.cwd) || !statSync(b.cwd).isDirectory())) throw invalid([{ field: 'cwd', message: 'Must be an absolute path to an existing folder' }]);
      if (!b.text.trim()) throw invalid([{ field: 'text', message: 'Required' }]);
      // @req FR:agent-team/talk.api: a task or project session gets its agent's persona and context.
      if (b.ref || b.project || b.agent) {
        return json(202, await startAgentRun(agents, c.life, { agent: b.agent, ref: b.ref ? formatRef(b.ref) : undefined, project: b.project, ...(b.cwd ? { cwd: b.cwd } : {}), text: b.text }));
      }
      if (b.cwd === undefined && !agents.cwd) throw invalid([{ field: 'cwd', message: 'Required' }]);
      return json(202, await agents.prompt({ ...(b.cwd ? { cwd: b.cwd } : {}), text: b.text }));
    },
  },
  {
    // @req FR:agent-sessions/run.prompt
    method: 'POST', doc: '/sessions/{id}/prompt', name: 'sessions.prompt', body: PROMPT_BODY,
    async run(c) {
      noQuery(c);
      const b = validate<{ text: string; ref?: ReturnType<typeof parseRef>; agent?: string }>(await readBody(c.req), PROMPT_BODY.schema, PROMPT_BODY.required);
      const id = sessionId(c);
      const agents = agentsOf(c);
      ownerOnly(c, 'Only the owner can message an agent');
      if (!b.text.trim()) throw invalid([{ field: 'text', message: 'Required' }]);
      // A follow-up on a task carries the persona again (a resumed session gets no system prompt otherwise). @req FR:agent-thread/thread.ask
      const options = b.ref || b.agent ? (await agentPromptOptions(c.life, { ...(b.ref ? { ref: formatRef(b.ref) } : {}), ...(b.agent ? { agent: b.agent } : {}) })).options : undefined;
      return json(202, await agents.prompt({ sessionId: id, text: b.text, ...(options ? { options } : {}) }));
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
    // @req FR:day-inputs/api.calendar @req FR:ux-consolidation/cal.status
    method: 'GET', doc: '/calendar', name: 'calendar.list', query: CAL_Q,
    async run(c) {
      const q = readQuery(c.url, Object.keys(CAL_Q));
      const from = Date.parse(q.get('from') ?? ''), to = Date.parse(q.get('to') ?? '');
      if (!isInstant(q.get('from')) || !isInstant(q.get('to')) || !(from < to) || to - from > 7 * 864e5) throw invalid([{ field: 'from', message: 'from and to must be ISO date-times, from before to, at most 7 days apart' }]);
      // Calendars hold personal data: the owner only.
      if (!isOwner(c.req)) throw new ApiError('forbidden', 'Only the owner can read the calendar');
      // Every reply says how the source is doing, so the page never reads "no meetings" off a missing calendar. @req FR:ux-consolidation/cal.status
      const at = () => (c.deps.now ?? (() => new Date()))().getTime();
      const cal = c.deps.calendar;
      if (!cal) return json(200, { configured: false, items: [], source: sourceStatus(undefined, false, at()) });
      try {
        const items = await cal.events(new Date(from).toISOString(), new Date(to).toISOString());
        return json(200, { configured: true, items, source: sourceStatus(cal, true, at()) });
      } catch (e) {
        c.deps.onError?.(e);
        return json(200, { configured: true, items: [], error: 'Calendar unavailable', source: sourceStatus(cal, false, at()) });
      }
    },
  },
  {
    // @req FR:agent-thread/reply.entry: tokens only, so the page never writes in an agent's voice.
    method: 'POST', doc: '/inbox/reply', name: 'inbox.reply', body: REPLY_BODY,
    async run(c) {
      noQuery(c);
      const b = validate<{ ref: NonNullable<ReturnType<typeof parseRef>>; text: string; expect?: string }>(await readBody(c.req), REPLY_BODY.schema, REPLY_BODY.required);
      if (isOwner(c.req)) throw new ApiError('forbidden', 'Only an agent replies as an agent');
      const who = c.token?.name ?? caller(c.req).actor;
      return json(201, await replyFromAgent(c.life, b.ref, b.text, who, b.expect));
    },
  },
  {
    // @req FR:agent-thread/thread.read
    method: 'GET', doc: '/tasks/{ref}/thread', name: 'tasks.thread',
    async run(c) { readQuery(c.url, []); return json(200, await taskThread(c.life, c.deps.agents, formatRef(refParam(c)))); },
  },
  {
    // @req FR:agent-thread/thread.assign
    method: 'POST', doc: '/tasks/{ref}/assign', name: 'tasks.assign', body: ASSIGN_BODY,
    async run(c) {
      noQuery(c);
      const ref = refParam(c);
      const agents = agentsOf(c);
      ownerOnly(c, 'Only the owner assigns a task');
      const b = validate<{ agent?: string; note?: string }>(await readBody(c.req), ASSIGN_BODY.schema, ASSIGN_BODY.required);
      return json(202, await assignTask(agents, c.life, formatRef(ref), b.agent, b.note));
    },
  },
  {
    // @req FR:agent-team/review.api
    method: 'GET', doc: '/team', name: 'team.list', query: TEAM_Q,
    async run(c) {
      const q = validate<{ project?: string; section?: string }>(Object.fromEntries(readQuery(c.url, Object.keys(TEAM_Q)).entries()), TEAM_Q, []);
      const team = await listTeam(c.life);
      return json(200, { items: q.project ? agentFor(team, q.project, q.section) : team });
    },
  },
  {
    // @req FR:agent-team/review.api
    method: 'GET', doc: '/reviews', name: 'reviews.list', query: REVIEWS_Q,
    async run(c) {
      const q = validate<{ project: string }>(Object.fromEntries(readQuery(c.url, Object.keys(REVIEWS_Q)).entries()), REVIEWS_Q, ['project']);
      return json(200, { items: await listReviews(c.life, q.project) });
    },
  },
  {
    // @req FR:agent-team/review.api
    method: 'POST', doc: '/tasks/review', name: 'tasks.review', body: REVIEW_BODY,
    async run(c) {
      noQuery(c);
      const agents = agentsOf(c);
      ownerOnly(c, 'Only the owner can ask for a review');
      const b = validate<{ ref: ReturnType<typeof parseRef>; agent?: string }>(await readBody(c.req), REVIEW_BODY.schema, REVIEW_BODY.required);
      return json(202, await reviewTask(agents, c.life, formatRef(b.ref!), b.agent));
    },
  },
  {
    // @req FR:schedule/api.schedule
    method: 'GET', doc: '/schedule', name: 'schedule.get', query: SCHEDULE_Q,
    async run(c) {
      const q = readQuery(c.url, Object.keys(SCHEDULE_Q));
      const raw = q.get('at');
      if (raw !== null && !isInstant(raw)) throw invalid([{ field: 'at', message: 'at must be an ISO date-time' }]);
      // Sleep times and personal blocks are personal data: the owner only.
      if (!isOwner(c.req)) throw new ApiError('forbidden', 'Only the owner can read the schedule');
      const config = c.deps.config ?? getDefaults();
      const at = raw === null ? (c.deps.now ?? (() => new Date()))() : new Date(raw);
      return json(200, { timezone: config.timezone, ...daySchedule(config, at, (await overridesOf(c.deps.storage)).value) });
    },
  },
  {
    // @req FR:schedule/api.override
    method: 'POST', doc: '/schedule/day', name: 'schedule.day', body: SCHEDULE_DAY_BODY,
    async run(c) {
      noQuery(c);
      if (!isOwner(c.req)) throw new ApiError('forbidden', 'Only the owner can change the schedule');
      const b = validate<{ date: string; wake?: string; bed?: string; every?: boolean; reset?: boolean }>(await readBody(c.req), SCHEDULE_DAY_BODY.schema, SCHEDULE_DAY_BODY.required);
      const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(b.date);
      if (!m || !isInstant(`${b.date}T12:00:00Z`)) throw invalid([{ field: 'date', message: 'date must be YYYY-MM-DD' }]);
      for (const k of ['wake', 'bed'] as const) if (b[k] !== undefined && !HHMM.test(b[k]!)) throw invalid([{ field: k, message: `${k} must be HH:mm` }]);
      if (!b.reset && !b.wake && !b.bed) throw invalid([{ field: 'wake', message: 'wake or bed is required (or reset)' }]);
      const aux = auxOf(c.deps.storage);
      if (!aux) throw new ApiError('bad_request', 'This storage cannot keep schedule changes');
      const { value, version, broken } = await overridesOf(c.deps.storage);
      // A hand-edited file that is not JSON is never overwritten: fix or delete it first.
      if (broken) throw new ApiError('conflict', '.stack/schedule.json is not valid JSON; fix or delete it');
      const dow = WEEKDAYS[new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).getUTCDay()];
      const bucket = b.every ? 'weekdays' : 'dates';
      const key = b.every ? dow : b.date;
      const map = { ...(value[bucket] ?? {}) };
      if (b.reset) delete map[key];
      else map[key] = { ...map[key], ...(b.wake ? { wake: b.wake } : {}), ...(b.bed ? { bed: b.bed } : {}) };
      const next: ScheduleOverrides = { ...value, [bucket]: map };
      // Every <weekday> from a date's view applies to that date too: its own change gives way.
      if (b.every && !b.reset && next.dates?.[b.date]) { const d = { ...next.dates }; delete d[b.date]; next.dates = d; }
      for (const k of ['dates', 'weekdays'] as const) if (next[k] && Object.keys(next[k]!).length === 0) delete next[k];
      // No change, no write (on GitHub storage a write is a commit).
      if (JSON.stringify(next) !== JSON.stringify(value)) await aux.writeAux(SCHEDULE_PATH, `${JSON.stringify(next, null, 2)}\n`, { expectedVersion: version });
      const config = c.deps.config ?? getDefaults();
      return json(200, { timezone: config.timezone, ...dayScheduleOn(config, b.date, next) });
    },
  },
  {
    // @req FR:agent-inbox/api.agents
    method: 'GET', doc: '/agents', name: 'agents.list',
    async run(c) {
      readQuery(c.url, []);
      // Each PR carries its queue rank for the PR page. @req FR:pr-priority/api.pr
      const q = c.deps.prPriority;
      const rank = q ? q.ranks() : () => null;
      const items = (await agentActivity({ ...c.life, prs: c.deps.prs })).map((i) => ({ ...i, prs: i.prs.map((p) => ({ ...p, priority: rank(p.repo, p.number) })) }));
      return json(200, { items });
    },
  },
  {
    // @req FR:live-deploy/sync.route @req FR:live-deploy/sync.cheap @req FR:live-deploy/sync.pending @req FR:live-deploy/sync.@api
    method: 'GET', doc: '/sync', name: 'sync',
    async run(c) {
      readQuery(c.url, []);
      const b = batchOf(c.deps.storage);
      // `live` changes when live state outside the repo (the PR priority store) changes, so a poller reloads Needs you. @req FR:pr-priority/needs.poll
      const p = b?.pending();
      return json(200, { rev: await revOf(c.deps.storage), ...(p ? { pending: p.count, since: p.since?.toISOString() ?? null } : {}), ...(c.deps.prPriority ? { live: c.deps.prPriority.stamp() } : {}) });
    },
  },
  {
    // @req FR:devops-installer/version.@api @req FR:devops-installer/version.get @req FR:devops-installer/version.cheap @req FR:devops-installer/$version-state
    method: 'GET', doc: '/version', name: 'version',
    async run(c) {
      readQuery(c.url, []);
      return json(200, appOf(c).state());
    },
  },
  {
    // @req FR:devops-installer/version.mode
    method: 'POST', doc: '/version/mode', name: 'version.mode', body: VERSION_MODE_BODY,
    async run(c) {
      readQuery(c.url, []);
      const app = appOf(c);
      ownerOnly(c, 'Only the owner can change how updates install');
      const b = validate<{ mode: UpdateMode; idleMinutes?: number }>(await readBody(c.req), VERSION_MODE_BODY.schema, VERSION_MODE_BODY.required);
      return json(200, app.setMode(b.mode, b.idleMinutes));
    },
  },
  {
    // Commit the live batch first, then the helper swaps after the app quits.
    // @req FR:devops-installer/restart.@api @req FR:devops-installer/restart.owner @req FR:devops-installer/restart.ready @req FR:devops-installer/restart.flush @req FR:devops-installer/restart.spawn
    method: 'POST', doc: '/version/restart', name: 'version.restart',
    async run(c) {
      readQuery(c.url, []);
      const app = appOf(c);
      ownerOnly(c, 'Only the owner can restart Stack');
      const s = app.state();
      if (!s.ready) throw new ApiError('conflict', 'No update ready');
      if (!s.canRestart) throw new ApiError('conflict', 'Restart is not available on this host');
      const b = batchOf(c.deps.storage);
      if (b && b.pending().count > 0) { try { await b.flush(); } catch (e) { throw flushError(e); } }
      try { app.restart(); } catch (e) { if (e instanceof UpdateRefused) throw new ApiError('conflict', e.message); throw e; }
      return json(200, { restarting: true });
    },
  },
  {
    // Commit and push what is pending now (owner only; a keepalive POST from a closing page sends `{}` or nothing, neither is read).
    // @req FR:live-deploy/sync.flush @req FR:live-deploy/sync.flush.none @req FR:live-deploy/sync.flush.error @req FR:live-deploy/$flush-result
    method: 'POST', doc: '/sync', name: 'sync.flush',
    async run(c) {
      readQuery(c.url, []);
      ownerOnly(c, 'Only the owner can save pending edits');
      const b = batchOf(c.deps.storage);
      const n = b?.pending().count ?? 0;
      if (!b || n === 0) return json(200, { flushed: 0, rev: await revOf(c.deps.storage) });
      let sha: string | null;
      try { sha = await b.flush(); } catch (e) { throw flushError(e); }
      return json(200, { flushed: n, rev: sha ?? await revOf(c.deps.storage) });
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
      // The `stack` engine and the overrides, so the README top is the task GET /next returns (FR:summaries/engine.order).
      const priorities = (await auxOf(c.deps.storage)?.readAux(PRIORITIES_PATH))?.content;
      const s = generateSummaries({
        projects: docs.map((d) => ({ fileName: `${d.name}.md`, content: d.content })),
        config: c.deps.config ?? getDefaults(), now: (c.deps.now ?? (() => new Date()))(),
        engine: 'stack', ...(priorities ? { priorities } : {}),
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
  const briefCache = createBriefCache();

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
      return await hit.r.run({ deps, briefCache, life, req, url, params, ...(token ? { token } : {}) });
    } catch (e) {
      const err = toApiError(e);
      if (err.code === 'internal') deps.onError?.(e);
      return errorResponse(err);
    }
  };
}
