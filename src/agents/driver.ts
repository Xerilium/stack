/**
 * The agent driver contract, in Agent Client Protocol vocabulary: sessions, a prompt that streams updates, cancel,
 * and permission requests with `allow_once` / `allow_always` / `reject_once` options. The API and the web app depend on this only.
 * @req FR:agent-sessions/driver.interface @req FR:agent-sessions/driver.active @req FR:agent-sessions/driver.cost
 */
import { ConflictError } from '../core/storage';

export type ToolKind = 'read' | 'edit' | 'delete' | 'move' | 'search' | 'execute' | 'think' | 'fetch' | 'switch_mode' | 'other';
export type ToolStatus = 'pending' | 'in_progress' | 'completed' | 'failed' | 'cancelled';
export type StopReason = 'end_turn' | 'cancelled' | 'max_budget' | 'error';
export type PermissionKind = 'allow_once' | 'allow_always' | 'reject_once' | 'reject_always';
export interface PermissionOption { optionId: string; name: string; kind: PermissionKind }
export interface PermissionRequest {
  requestId: string; callId: string; tool: string;
  /** One line shown to the owner, e.g. `Allow Bash: git push origin main`. */
  title: string;
  input: Record<string, unknown>;
  options: PermissionOption[];
  /** The agent runtime flagged the call as one to refuse by default. */
  risky?: boolean;
}
export interface PermissionAnswer { optionId: string; message?: string }
export interface Cost { usd: number; tokens: number; byModel?: Record<string, { usd: number; tokens: number }>; /** Not every byte was priced yet, or a model has no list price. */ approx?: boolean }

export type Update =
  | { type: 'session'; sessionId: string }
  | { type: 'message_chunk'; role: 'assistant' | 'user'; text: string }
  | { type: 'tool_call'; callId: string; title: string; kind: ToolKind; status: ToolStatus }
  | { type: 'tool_update'; callId: string; status: ToolStatus; output?: string }
  | { type: 'permission'; requestId: string; callId: string; title: string; options: PermissionOption[] }
  | { type: 'done'; stopReason: StopReason; cost: { usd: number; tokens: number }; turns: number; durationMs: number; error?: string; /** The final assistant text. @req FR:agent-team/driver.options */ text?: string; /** The parsed answer when the prompt asked for a schema. */ structured?: unknown };

export interface Session {
  id: string; title: string; project: string; cwd: string; branch?: string;
  /** ISO time of the last transcript write. */
  lastActive: string;
  /** Another client wrote the transcript recently. */
  active: boolean;
  cost: Cost; prs: string[];
}
export interface Turn { at: string; role: 'user' | 'assistant'; text: string }
export interface Run { id: string; sessionId: string | null; updates: AsyncIterable<Update> }
/** Per-prompt options an agent persona needs; every field is optional and a driver may ignore what it cannot honour. @req FR:agent-team/driver.options */
export interface PromptOptions {
  /** Appended to the runtime's own system prompt (the agent's persona and the task context). */
  systemPrompt?: string;
  model?: string;
  /** The session's title (new sessions only). */
  title?: string;
  allowedTools?: string[];
  disallowedTools?: string[];
  /** JSON schema for a structured answer; `done.structured` carries the parsed result. */
  schema?: Record<string, unknown>;
}
export interface PromptRequest { sessionId?: string; cwd?: string; text: string; options?: PromptOptions; onPermission: (req: PermissionRequest) => Promise<PermissionAnswer> }

export interface AgentDriver {
  /** Newest first; `sinceMs` lists every session touched since then (for the cost window) instead of the newest `limit`. */
  listSessions(o?: { limit?: number; sinceMs?: number }): Promise<Session[]>;
  /** Sessions still being indexed (cost not final); 0 when the driver has nothing to catch up on. */
  indexing?(): number;
  getMessages(id: string, o?: { limit?: number }): Promise<Turn[]>;
  prompt(req: PromptRequest): Promise<Run>;
  /** True when a run was in flight and is now aborting. */
  cancel(runId: string): Promise<boolean>;
}

/** Another writer holds the session (a client is appending to it, or a Stack run is in flight). Maps to 409. */
export class SessionBusy extends ConflictError {}

export type SessionState = 'needs-you' | 'running' | 'active' | 'idle' | 'stale';
export const STATE_ORDER: SessionState[] = ['needs-you', 'running', 'active', 'idle', 'stale'];
const DAY = 864e5;

export function sessionState(s: { lastActive: number | string; running: boolean; needsYou: boolean; active?: boolean }, now: Date, activeMs = 120_000): SessionState {
  if (s.needsYou) return 'needs-you';
  if (s.running) return 'running';
  const age = now.getTime() - (typeof s.lastActive === 'number' ? s.lastActive : Date.parse(s.lastActive));
  if (s.active ?? age < activeMs) return 'active';
  return age < DAY ? 'idle' : 'stale';
}

/** The repo folder a session works in; a `.claude/worktrees/<name>` checkout reports its repo. */
export function projectOf(cwd: string): string {
  const parts = cwd.split('/').filter(Boolean);
  const i = parts.indexOf('.claude');
  const base = i > 0 && parts[i + 1] === 'worktrees' ? parts.slice(0, i) : parts;
  return base[base.length - 1] ?? '';
}

/** The session store folder for a working directory (every non-alphanumeric character becomes `-`). */
export const encodeCwd = (cwd: string): string => cwd.replace(/[^A-Za-z0-9]/g, '-');

const KINDS: Record<string, ToolKind> = {
  Bash: 'execute', BashOutput: 'execute', KillShell: 'execute', Read: 'read', NotebookRead: 'read', Glob: 'search', Grep: 'search', LS: 'search',
  Edit: 'edit', MultiEdit: 'edit', Write: 'edit', NotebookEdit: 'edit', WebFetch: 'fetch', WebSearch: 'fetch', TodoWrite: 'think', EnterPlanMode: 'switch_mode', ExitPlanMode: 'switch_mode',
};
export const toolKind = (name: string): ToolKind => KINDS[name] ?? 'other';

/** A read-only run pre-approves reads and forbids every writer; never put an agent's own tools in `allowedTools` (that skips the permission ask). @req FR:agent-team/driver.options */
export const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob', 'TodoWrite']; // the web tools still ask: repo content must not leave without an ask
export const WRITE_TOOLS = ['Bash', 'Edit', 'Write', 'MultiEdit', 'NotebookEdit'];

