/**
 * The agent driver contract, in Agent Client Protocol vocabulary: sessions, a prompt that streams updates, cancel,
 * and permission requests with `allow_once` / `allow_always` / `reject_once` options. The API and the web app depend on this only.
 * @req FR:agent-sessions/driver.interface @req FR:agent-sessions/driver.active @req FR:agent-sessions/driver.cost
 */
import { readFileSync } from 'fs';
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
export interface Cost { usd: number; tokens: number; byModel?: Record<string, { usd: number; tokens: number }> }

export type Update =
  | { type: 'session'; sessionId: string }
  | { type: 'message_chunk'; role: 'assistant' | 'user'; text: string }
  | { type: 'tool_call'; callId: string; title: string; kind: ToolKind; status: ToolStatus }
  | { type: 'tool_update'; callId: string; status: ToolStatus; output?: string }
  | { type: 'permission'; requestId: string; callId: string; title: string; options: PermissionOption[] }
  | { type: 'done'; stopReason: StopReason; cost: { usd: number; tokens: number }; turns: number; durationMs: number; error?: string };

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
export interface PromptRequest { sessionId?: string; cwd?: string; text: string; onPermission: (req: PermissionRequest) => Promise<PermissionAnswer> }

export interface AgentDriver {
  listSessions(o?: { limit?: number }): Promise<Session[]>;
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
  if (s.active || age < activeMs) return 'active';
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

export const ZERO_COST: Cost = { usd: 0, tokens: 0, byModel: {} };
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
const round = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Cost and pull requests from a transcript file: the `cost-state` record when present (authoritative), else the sum of assistant usage.
 * Tolerant: bad lines are skipped and a missing file costs nothing.
 */
export function readTranscriptFacts(path: string): { cost: Cost; prs: string[] } {
  let text: string;
  try { text = readFileSync(path, 'utf8'); } catch { return { cost: { ...ZERO_COST, byModel: {} }, prs: [] }; }
  const prs: string[] = [];
  const summed: Record<string, { usd: number; tokens: number }> = {};
  let state: Record<string, { usd: number; tokens: number }> | null = null;
  let stateUsd = 0;
  for (const line of text.split('\n')) {
    if (!line.startsWith('{')) continue;
    let r: Record<string, unknown>;
    try { r = JSON.parse(line) as Record<string, unknown>; } catch { continue; }
    if (r.type === 'pr-link' && typeof r.prUrl === 'string' && /^https:\/\/github\.com\//.test(r.prUrl) && !prs.includes(r.prUrl) && prs.length < 5) prs.push(r.prUrl);
    else if (r.type === 'cost-state' && typeof r.modelUsage === 'object' && r.modelUsage) {
      state = {}; stateUsd = num(r.totalCostUSD);
      for (const [model, u] of Object.entries(r.modelUsage as Record<string, Record<string, unknown>>)) {
        state[model] = { usd: round(num(u.costUSD)), tokens: num(u.inputTokens) + num(u.outputTokens) + num(u.cacheReadInputTokens) + num(u.cacheCreationInputTokens) };
      }
    } else if (r.type === 'assistant' && typeof r.message === 'object' && r.message) {
      const m = r.message as { model?: unknown; usage?: Record<string, unknown> };
      const u = m.usage ?? {};
      const model = typeof m.model === 'string' ? m.model : 'unknown';
      const cur = (summed[model] ??= { usd: 0, tokens: 0 });
      cur.tokens += num(u.input_tokens) + num(u.output_tokens) + num(u.cache_read_input_tokens) + num(u.cache_creation_input_tokens);
    }
  }
  const byModel = state ?? summed;
  const tokens = Object.values(byModel).reduce((t, m) => t + m.tokens, 0);
  const usd = state ? round(stateUsd) : 0;
  return { cost: { usd, tokens, byModel }, prs };
}
