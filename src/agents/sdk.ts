/**
 * The Claude Agent SDK driver: reads the local session store and runs prompts through `query()`, mapped to ACP-shaped updates.
 * The SDK module (and its native binary) is loaded on first use, never at import time.
 * @req FR:agent-sessions/driver.sdk @req FR:agent-sessions/driver.active @req FR:agent-sessions/driver.cost
 */
import { homedir } from 'os';
import { join } from 'path';
import { oneLine } from '../core/asks';
import { encodeCwd, projectOf, readTranscriptFacts, SessionBusy, toolKind, type AgentDriver, type PermissionAnswer, type PermissionRequest, type Run, type Session, type Turn, type Update } from './driver';

/** The slice of the SDK this driver uses; injectable so tests never load the real module. */
export interface SdkLike {
  listSessions(o?: { limit?: number; includeWorktrees?: boolean }): Promise<{ sessionId: string; summary: string; lastModified: number; customTitle?: string; firstPrompt?: string; gitBranch?: string; cwd?: string }[]>;
  getSessionMessages(id: string, o?: { limit?: number }): Promise<{ type: string; message: unknown; timestamp?: string }[]>;
  query(args: { prompt: string; options?: Record<string, unknown> }): AsyncIterable<unknown>;
}
export interface SdkDriverOptions { sdk?: SdkLike; configDir?: string; now?: () => Date; activeMs?: number; maxBudgetUsd?: number }

const OPTIONS = [
  { optionId: 'allow', name: 'Allow once', kind: 'allow_once' as const },
  { optionId: 'allow-session', name: 'Allow for this session', kind: 'allow_always' as const },
  { optionId: 'deny', name: 'Deny', kind: 'reject_once' as const },
];
const MAX_TEXT = 2000;
const TITLE = 80;
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);
const clean = (s: string, n: number) => cut(oneLine(s), n);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** What a tool call is about, in a few words: the command, the path, else the input as JSON. */
export function inputSummary(tool: string, input: unknown, n = 80): string {
  if (!isObj(input)) return '';
  const pick = ['command', 'file_path', 'path', 'pattern', 'url', 'query', 'prompt', 'description'].map((k) => input[k]).find((v) => typeof v === 'string' && v.trim());
  const raw = typeof pick === 'string' ? pick : JSON.stringify(input);
  void tool;
  return clean(raw, n);
}

/** Unbounded async queue: producers push, one consumer iterates. */
class Queue<T> {
  private items: T[] = [];
  private wake: (() => void) | null = null;
  private closed = false;
  push(v: T) { this.items.push(v); this.wake?.(); }
  close() { this.closed = true; this.wake?.(); }
  async *[Symbol.asyncIterator]() {
    for (;;) {
      if (this.items.length) { yield this.items.shift()!; continue; }
      if (this.closed) return;
      await new Promise<void>((ok) => { this.wake = ok; });
      this.wake = null;
    }
  }
}

export function createSdkDriver(o: SdkDriverOptions = {}): AgentDriver {
  const now = o.now ?? (() => new Date());
  const activeMs = o.activeMs ?? 120_000;
  const configDir = o.configDir ?? process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
  let sdkP: Promise<SdkLike> | null = o.sdk ? Promise.resolve(o.sdk) : null;
  const sdk = () => (sdkP ??= import('@anthropic-ai/claude-agent-sdk') as unknown as Promise<SdkLike>);
  const runs = new Map<string, { sessionId: string | null; ac: AbortController }>();
  let seq = 0;

  const transcript = (cwd: string | undefined, id: string) => join(configDir, 'projects', encodeCwd(cwd ?? ''), `${id}.jsonl`);

  async function listSessions(q: { limit?: number } = {}): Promise<Session[]> {
    const items = await (await sdk()).listSessions({ limit: q.limit, includeWorktrees: true });
    const t = now().getTime();
    return items.map((s) => {
      const facts = readTranscriptFacts(transcript(s.cwd, s.sessionId));
      const title = clean(s.customTitle?.trim() || s.summary?.trim() || s.firstPrompt?.trim() || s.sessionId.slice(0, 8), TITLE);
      return { id: s.sessionId, title, project: projectOf(s.cwd ?? ''), cwd: s.cwd ?? '', branch: s.gitBranch, lastActive: new Date(s.lastModified).toISOString(), active: t - s.lastModified < activeMs, cost: facts.cost, prs: facts.prs };
    });
  }

  async function getMessages(id: string, q: { limit?: number } = {}): Promise<Turn[]> {
    const rows = await (await sdk()).getSessionMessages(id, { limit: q.limit });
    const out: Turn[] = [];
    for (const r of rows) {
      const m = r.message as { role?: string; content?: unknown } | undefined;
      if (!m) continue;
      const at = typeof r.timestamp === 'string' ? r.timestamp : '';
      const role = r.type === 'assistant' ? 'assistant' : 'user';
      if (typeof m.content === 'string') { if (m.content.trim()) out.push({ at, role, text: clean(m.content, MAX_TEXT) }); continue; }
      if (!Array.isArray(m.content)) continue;
      for (const b of m.content as Record<string, unknown>[]) {
        if (b.type === 'text' && typeof b.text === 'string' && b.text.trim()) out.push({ at, role, text: clean(b.text, MAX_TEXT) });
        else if (b.type === 'tool_use' && typeof b.name === 'string') out.push({ at, role: 'assistant', text: `⚙ ${b.name}: ${inputSummary(b.name, b.input)}` });
      }
    }
    return out;
  }

  async function prompt(req: { sessionId?: string; cwd?: string; text: string; onPermission: (r: PermissionRequest) => Promise<PermissionAnswer> }): Promise<Run> {
    if (req.sessionId) {
      for (const r of runs.values()) if (r.sessionId === req.sessionId) throw new SessionBusy('Session is running; wait for it to finish');
      const s = (await listSessions()).find((x) => x.id === req.sessionId);
      if (s?.active) throw new SessionBusy('Session is active elsewhere; message it through its inbox');
    }
    const id = `run-${++seq}`;
    const ac = new AbortController();
    const state = { sessionId: req.sessionId ?? null, ac };
    runs.set(id, state);
    const q = new Queue<Update>();
    const allowed = new Set<string>();
    const run: Run = { id, sessionId: state.sessionId, updates: q };

    const canUseTool = async (tool: string, input: Record<string, unknown>, ctx: { toolUseID?: string; requestId?: string; defaultToNo?: boolean }) => {
      if (allowed.has(tool)) return { behavior: 'allow' as const };
      const callId = ctx.toolUseID ?? ctx.requestId ?? tool;
      const pr: PermissionRequest = { requestId: ctx.requestId ?? callId, callId, tool, title: `Allow ${tool}: ${inputSummary(tool, input)}`, input, options: OPTIONS, ...(ctx.defaultToNo ? { risky: true } : {}) };
      q.push({ type: 'permission', requestId: pr.requestId, callId, title: pr.title, options: OPTIONS });
      const a = await req.onPermission(pr);
      if (a.optionId === 'allow-session') { allowed.add(tool); return { behavior: 'allow' as const }; }
      if (a.optionId === 'allow') return { behavior: 'allow' as const };
      return { behavior: 'deny' as const, message: a.message ?? 'Denied by the owner' };
    };

    const pump = async () => {
      let streamed = false;
      let finished = false;
      try {
        const it = (await sdk()).query({ prompt: req.text, options: { ...(req.sessionId ? { resume: req.sessionId } : {}), ...(req.cwd ? { cwd: req.cwd } : {}), includePartialMessages: true, canUseTool, abortController: ac, ...(o.maxBudgetUsd !== undefined ? { maxBudgetUsd: o.maxBudgetUsd } : {}) } });
        for await (const raw of it) {
          const m = raw as Record<string, unknown>;
          if (m.type === 'system' && m.subtype === 'init' && typeof m.session_id === 'string' && !state.sessionId) {
            state.sessionId = m.session_id; run.sessionId = m.session_id; q.push({ type: 'session', sessionId: m.session_id });
          } else if (m.type === 'stream_event') {
            const ev = m.event as { type?: string; delta?: { type?: string; text?: string } } | undefined;
            if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && typeof ev.delta.text === 'string') { streamed = true; q.push({ type: 'message_chunk', role: 'assistant', text: ev.delta.text }); }
          } else if (m.type === 'assistant') {
            const content = (m.message as { content?: unknown })?.content;
            for (const b of Array.isArray(content) ? (content as Record<string, unknown>[]) : []) {
              if (b.type === 'text' && !streamed && typeof b.text === 'string' && b.text) q.push({ type: 'message_chunk', role: 'assistant', text: b.text });
              else if (b.type === 'tool_use' && typeof b.name === 'string') q.push({ type: 'tool_call', callId: String(b.id ?? ''), title: `${b.name}: ${inputSummary(b.name, b.input)}`, kind: toolKind(b.name), status: 'pending' });
            }
            streamed = false;
          } else if (m.type === 'user') {
            const content = (m.message as { content?: unknown })?.content;
            for (const b of Array.isArray(content) ? (content as Record<string, unknown>[]) : []) {
              if (b.type !== 'tool_result') continue;
              const text = typeof b.content === 'string' ? b.content : Array.isArray(b.content) ? (b.content as Record<string, unknown>[]).map((x) => (typeof x.text === 'string' ? x.text : '')).join(' ') : '';
              q.push({ type: 'tool_update', callId: String(b.tool_use_id ?? ''), status: b.is_error ? 'failed' : 'completed', ...(text ? { output: clean(text, 200) } : {}) });
            }
          } else if (m.type === 'result') {
            finished = true;
            const mu = (m.modelUsage ?? {}) as Record<string, Record<string, unknown>>;
            const tokens = Object.values(mu).reduce((t, u) => t + ['inputTokens', 'outputTokens', 'cacheReadInputTokens', 'cacheCreationInputTokens'].reduce((x, k) => x + (typeof u[k] === 'number' ? (u[k] as number) : 0), 0), 0);
            const usd = typeof m.total_cost_usd === 'number' ? m.total_cost_usd : 0;
            const errors = Array.isArray(m.errors) ? (m.errors as unknown[]).map(String).join('; ') : '';
            const stopReason = m.subtype === 'success' ? 'end_turn' : m.subtype === 'error_max_budget_usd' ? 'max_budget' : 'error';
            q.push({ type: 'done', stopReason, cost: { usd, tokens }, turns: typeof m.num_turns === 'number' ? m.num_turns : 0, durationMs: typeof m.duration_ms === 'number' ? m.duration_ms : 0, ...(stopReason === 'error' && errors ? { error: errors } : {}) });
          }
        }
        if (!finished) q.push({ type: 'done', stopReason: ac.signal.aborted ? 'cancelled' : 'error', cost: { usd: 0, tokens: 0 }, turns: 0, durationMs: 0, ...(ac.signal.aborted ? {} : { error: 'The agent stopped without a result' }) });
      } catch (e) {
        if (!finished) q.push({ type: 'done', stopReason: ac.signal.aborted ? 'cancelled' : 'error', cost: { usd: 0, tokens: 0 }, turns: 0, durationMs: 0, ...(ac.signal.aborted ? {} : { error: e instanceof Error ? e.message : String(e) }) });
      } finally {
        runs.delete(id);
        q.close();
      }
    };
    void pump();
    return run;
  }

  async function cancel(runId: string): Promise<boolean> {
    const r = runs.get(runId);
    if (!r) return false;
    r.ac.abort();
    return true;
  }

  return { listSessions, getMessages, prompt, cancel };
}
