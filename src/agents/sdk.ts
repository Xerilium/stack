/**
 * The Claude Agent SDK driver: reads the local session store and runs prompts through `query()`, mapped to ACP-shaped updates.
 * The SDK module (and its native binary) is loaded on first use, never at import time.
 * @req FR:agent-sessions/driver.sdk @req FR:agent-sessions/driver.active @req FR:agent-sessions/driver.cost
 */
import { homedir } from 'os';
import { join } from 'path';
import { oneLine } from '../core/asks';
import { createStoreIndex, type StoreIndex } from './store';
import { SessionBusy, toolKind, type AgentDriver, type PermissionAnswer, type PermissionRequest, type Run, type Session, type Turn, type Update } from './driver';

/** The slice of the SDK this driver uses; injectable so tests never load the real module. */
export interface SdkLike {
  getSessionMessages(id: string, o?: { limit?: number }): Promise<{ type: string; message: unknown; timestamp?: string }[]>;
  query(args: { prompt: string; options?: Record<string, unknown> }): AsyncIterable<unknown>;
}
export interface SdkDriverOptions { sdk?: SdkLike; configDir?: string; now?: () => Date; activeMs?: number; maxBudgetUsd?: number; store?: StoreIndex }

const OPTIONS = [
  { optionId: 'allow', name: 'Allow once', kind: 'allow_once' as const },
  { optionId: 'allow-session', name: 'Allow for this session', kind: 'allow_always' as const },
  { optionId: 'deny', name: 'Deny', kind: 'reject_once' as const },
];
const MAX_TEXT = 2000;
const cut = (s: string, n: number) => (s.length > n ? s.slice(0, n) : s);
const clean = (s: string, n: number) => cut(oneLine(s), n);
// eslint-disable-next-line no-control-regex
const CTRL = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]+/g;
/** Tool input for display: one line, no control characters; paths and commands stay readable (the secret redactor flags long paths). */
const plain = (s: string, n: number) => cut(s.replace(CTRL, ' ').replace(/\s+/g, ' ').trim(), n);
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** What a tool call is about, in a few words: the command, the path, else the input as JSON. */
export function inputSummary(input: unknown, n = 80): string {
  if (!isObj(input)) return '';
  const pick = ['command', 'file_path', 'path', 'pattern', 'url', 'query', 'prompt', 'description'].map((k) => input[k]).find((v) => typeof v === 'string' && v.trim());
  const raw = typeof pick === 'string' ? pick : JSON.stringify(input);
  return plain(raw, n);
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
  // A real `import()`: under `module: commonjs` tsc would turn it into `require()`, which cannot load the ESM-only SDK on Node < 22.12.
  const dynamicImport = new Function('m', 'return import(m)') as (m: string) => Promise<SdkLike>;
  const sdk = () => (sdkP ??= dynamicImport('@anthropic-ai/claude-agent-sdk'));
  /** Sessions this process wrote and when: their transcript is fresh because of us, not another client. */
  const ownWrites = new Map<string, number>();
  /** How long after a run ends its transcript may still be written by the CLI (summary, cost record) and stay "ours". */
  const OWN_WRITE_MS = 30_000;
  const runs = new Map<string, { sessionId: string | null; ac: AbortController }>();
  let seq = 0;

  const store = o.store ?? createStoreIndex({ configDir, now, activeMs });

  /** The list comes from the store index (fast, cached); the SDK is never asked to parse every transcript. */
  async function listSessions(q: { limit?: number; sinceMs?: number } = {}): Promise<Session[]> {
    const own = (s: Session) => { const t = ownWrites.get(s.id); return t !== undefined && Date.parse(s.lastActive) <= t + OWN_WRITE_MS; };
    return store.list({ limit: q.limit ?? (q.sinceMs !== undefined ? 5000 : 200), sinceMs: q.sinceMs }).map((s) => (s.active && own(s) ? { ...s, active: false } : s));
  }

  async function getMessages(id: string, q: { limit?: number } = {}): Promise<Turn[]> {
    // The SDK pages from the start; the drawer wants the end, so read everything and keep the last turns.
    const rows = await (await sdk()).getSessionMessages(id);
    // The SDK resolves `[]` for an id it does not know; an empty transcript the store knows is still a session.
    if (rows.length === 0 && !store.entries().some((e) => e.id === id)) throw new Error(`Session not found: ${id}`);
    const out: Turn[] = [];
    for (const r of rows) {
      const m = r.message as { role?: string; content?: unknown } | undefined;
      if (!m) continue;
      const at = typeof r.timestamp === 'string' ? r.timestamp : '';
      const role = r.type === 'assistant' ? 'assistant' : 'user';
      const own = (t: string) => clean(t.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').replace(/<ide_opened_file>[\s\S]*?<\/ide_opened_file>/g, ''), MAX_TEXT);
      if (typeof m.content === 'string') { const t = own(m.content); if (t) out.push({ at, role, text: t }); continue; }
      if (!Array.isArray(m.content)) continue;
      for (const b of m.content as Record<string, unknown>[]) {
        if (b.type === 'text' && typeof b.text === 'string') { const t = own(b.text); if (t) out.push({ at, role, text: t }); }
        else if (b.type === 'tool_use' && typeof b.name === 'string') out.push({ at, role: 'assistant', text: `⚙ ${b.name}: ${inputSummary(b.input)}` });
      }
    }
    return q.limit !== undefined && out.length > q.limit ? out.slice(out.length - q.limit) : out;
  }

  async function prompt(req: { sessionId?: string; cwd?: string; text: string; onPermission: (r: PermissionRequest) => Promise<PermissionAnswer> }): Promise<Run> {
    // The run is reserved before any await, so two prompts in one tick cannot both start on one transcript.
    if (req.sessionId) for (const r of runs.values()) if (r.sessionId === req.sessionId) throw new SessionBusy('Session is running; wait for it to finish');
    const id = `run-${++seq}`;
    const ac = new AbortController();
    const state = { sessionId: req.sessionId ?? null, ac };
    runs.set(id, state);
    if (req.sessionId) {
      let s: Session | undefined;
      try { s = (await listSessions({ limit: 400 })).find((x) => x.id === req.sessionId); } catch (e) { runs.delete(id); throw e; }
      if (s?.active) { runs.delete(id); throw new SessionBusy('Session is active elsewhere; message it through its inbox'); }
    }
    const q = new Queue<Update>();
    const allowed = new Set<string>();
    const run: Run = { id, sessionId: state.sessionId, updates: q };

    const canUseTool = async (tool: string, input: Record<string, unknown>, ctx: { toolUseID?: string; requestId?: string; defaultToNo?: boolean }) => {
      if (allowed.has(tool)) return { behavior: 'allow' as const };
      const callId = ctx.toolUseID ?? ctx.requestId ?? tool;
      const pr: PermissionRequest = { requestId: ctx.requestId ?? callId, callId, tool, title: `Allow ${tool}: ${inputSummary(input)}`, input, options: OPTIONS, ...(ctx.defaultToNo ? { risky: true } : {}) };
      q.push({ type: 'permission', requestId: pr.requestId, callId, title: pr.title, options: OPTIONS });
      let a: PermissionAnswer;
      try { a = await req.onPermission(pr); } catch (e) { return { behavior: 'deny' as const, message: `Permission check failed: ${e instanceof Error ? e.message : String(e)}` }; }
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
          } else if (m.type === 'stream_event' && m.parent_tool_use_id == null) {
            const ev = m.event as { type?: string; delta?: { type?: string; text?: string } } | undefined;
            if (ev?.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && typeof ev.delta.text === 'string') { streamed = true; q.push({ type: 'message_chunk', role: 'assistant', text: ev.delta.text }); }
          } else if (m.type === 'assistant') {
            const content = (m.message as { content?: unknown })?.content;
            for (const b of Array.isArray(content) ? (content as Record<string, unknown>[]) : []) {
              if (b.type === 'text' && !streamed && typeof b.text === 'string' && b.text) q.push({ type: 'message_chunk', role: 'assistant', text: b.text });
              else if (b.type === 'tool_use' && typeof b.name === 'string') q.push({ type: 'tool_call', callId: String(b.id ?? ''), title: `${b.name}: ${inputSummary(b.input)}`, kind: toolKind(b.name), status: 'pending' });
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
            const stopReason = ac.signal.aborted ? 'cancelled' : m.subtype === 'success' ? 'end_turn' : m.subtype === 'error_max_budget_usd' ? 'max_budget' : 'error';
            q.push({ type: 'done', stopReason, cost: { usd, tokens }, turns: typeof m.num_turns === 'number' ? m.num_turns : 0, durationMs: typeof m.duration_ms === 'number' ? m.duration_ms : 0, ...(stopReason === 'error' && errors ? { error: errors } : {}) });
          }
        }
        if (!finished) q.push({ type: 'done', stopReason: ac.signal.aborted ? 'cancelled' : 'error', cost: { usd: 0, tokens: 0 }, turns: 0, durationMs: 0, ...(ac.signal.aborted ? {} : { error: 'The agent stopped without a result' }) });
      } catch (e) {
        if (!finished) q.push({ type: 'done', stopReason: ac.signal.aborted ? 'cancelled' : 'error', cost: { usd: 0, tokens: 0 }, turns: 0, durationMs: 0, ...(ac.signal.aborted ? {} : { error: e instanceof Error ? e.message : String(e) }) });
      } finally {
        runs.delete(id);
        if (state.sessionId) ownWrites.set(state.sessionId, Date.now());
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

  return { listSessions, getMessages, prompt, cancel, indexing: () => store.pending() };
}
