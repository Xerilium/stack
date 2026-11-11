/**
 * ACP agent driver: spawns an Agent Client Protocol agent (Gemini CLI, Codex, Copilot, ...) and talks JSON-RPC over its stdio.
 * Built on `@agentclientprotocol/sdk` 2.4.0 (stable v1 entrypoint). The driver is the ACP client: it advertises no fs or terminal
 * capability, so every risky tool call comes back as `session/request_permission`, which `onPermission` (the ask queue) answers.
 * @req FR:acp-driver/conn.spawn @req FR:acp-driver/conn.init @req FR:acp-driver/conn.session @req FR:acp-driver/conn.close
 * @req FR:acp-driver/run.prompt @req FR:acp-driver/run.updates @req FR:acp-driver/run.cancel @req FR:acp-driver/run.errors
 * @req FR:acp-driver/perm.ask @req FR:acp-driver/perm.answer @req FR:acp-driver/perm.risky @req FR:acp-driver/perm.flow @req NFR:acp-driver/acp.seam @req NFR:acp-driver/acp.lazy @req NFR:acp-driver/acp.log
 */
import { spawn as nodeSpawn, type ChildProcess } from 'child_process';
import { randomBytes, randomUUID } from 'crypto';
import { isAbsolute, resolve } from 'path';
import { Readable, Writable } from 'stream';
import type * as Acp from '@agentclientprotocol/sdk';
import { loadAcpSdk, type AcpSdk } from './acp-sdk';
import { oneLine } from '../core/asks';
import { redact } from '../core/triage';
import { projectOf, SessionBusy, type AgentDriver, type PermissionAnswer, type PermissionKind, type PermissionOption, type PermissionRequest, type PromptRequest, type Run, type Session, type StopReason, type ToolKind, type ToolStatus, type Turn, type Update } from './driver';

export class AcpError extends Error {}

export interface AcpDriverOptions {
  /** The agent executable, e.g. `gemini`. Run without a shell. */
  command: string;
  args?: string[];
  /** The agent's working directory (and the default session `cwd`). */
  cwd?: string;
  /** Extra environment for the agent, on top of the allow-list. Put agent API keys here, never in the parent environment. */
  env?: Record<string, string>;
  /** Loads the ACP SDK; defaults to a native `import()` (the SDK is ESM-only). Tests inject their own. */
  loadSdk?: () => Promise<AcpSdk>;
  /** Process spawner; tests inject a spy. */
  spawn?: typeof nodeSpawn;
  /** Wait for `initialize`, ms. Default 30 000. */
  startTimeoutMs?: number;
  /** Wait for the child to exit after its stdin closes, then again after SIGTERM, ms. Default 2000. */
  killAfterMs?: number;
}

export interface AcpDriver extends AgentDriver {
  /** Cancels runs in flight and ends the agent process. Safe to call again. */
  close(): Promise<void>;
  /** The tail of the agent's stderr (redacted, at most 2000 characters), for error reports. */
  stderr(): string;
}

const PROTOCOL_VERSION = 1;
/** Only these variables reach the agent; Stack and Graph tokens never do. */
const ENV_ALLOW = /^(PATH|HOME|USER|LOGNAME|LANG|LC_[A-Z_]+|TERM|TMPDIR|SHELL|XDG_[A-Z_]+|NODE_PATH|NODE_OPTIONS|NODE_EXTRA_CA_CERTS)$/;
export const agentEnv = (extra: Record<string, string> = {}, parent: NodeJS.ProcessEnv = process.env): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parent)) if (v !== undefined && ENV_ALLOW.test(k)) out[k] = v;
  return { ...out, ...extra };
};

const TOOL_KINDS = new Set<ToolKind>(['read', 'edit', 'delete', 'move', 'search', 'execute', 'think', 'fetch', 'switch_mode', 'other']);
const TOOL_STATUS = new Set<ToolStatus>(['pending', 'in_progress', 'completed', 'failed', 'cancelled']);
/** Tool kinds whose ask recommends Deny: they run code, remove or move files, or reach the network. @req FR:acp-driver/perm.risky */
const RISKY = new Set<ToolKind>(['execute', 'delete', 'move', 'fetch', 'other']);
const PERM_KINDS =new Set<PermissionKind>(['allow_once', 'allow_always', 'reject_once', 'reject_always']);
const toolKind = (k: unknown): ToolKind => (typeof k === 'string' && TOOL_KINDS.has(k as ToolKind) ? (k as ToolKind) : 'other');
const toolStatus = (s: unknown, dflt: ToolStatus): ToolStatus => (typeof s === 'string' && TOOL_STATUS.has(s as ToolStatus) ? (s as ToolStatus) : dflt);
const line = (s: unknown, max: number): string => oneLine(redact(String(s ?? ''))).slice(0, max);

/** A push queue read as an async iterable (one reader). */
function channel<T>() {
  const items: T[] = [];
  let wake: (() => void) | null = null;
  let ended = false;
  return {
    push(x: T) { if (!ended) { items.push(x); wake?.(); } },
    end() { ended = true; wake?.(); },
    iterable: { [Symbol.asyncIterator]: () => ({
      async next(): Promise<IteratorResult<T>> {
        while (!items.length && !ended) await new Promise<void>((r) => { wake = r; });
        wake = null;
        return items.length ? { value: items.shift() as T, done: false } : { value: undefined as never, done: true };
      },
    }) } as AsyncIterable<T>,
  };
}

interface ActiveRun {
  id: string; sessionId: string; started: number; text: string; cancelled: boolean; finished: boolean;
  calls: Map<string, { title: string; kind: ToolKind; status: ToolStatus; input: Record<string, unknown> }>;
  q: ReturnType<typeof channel<Update>>;
  abort: Promise<void>; doAbort: () => void;
  onPermission: PromptRequest['onPermission'];
  finish(u: Omit<Extract<Update, { type: 'done' }>, 'type' | 'cost' | 'turns' | 'durationMs'>): void;
}
interface Conn { sdk: AcpSdk; ctx: Acp.ClientContext; child: ChildProcess; close(): void }

export function createAcpDriver(o: AcpDriverOptions): AcpDriver {
  if (!o.command) throw new AcpError('command is required');
  const loadSdk = o.loadSdk ?? loadAcpSdk;
  const spawn = o.spawn ?? nodeSpawn;
  const startTimeoutMs = o.startTimeoutMs ?? 30_000;
  const killAfterMs = o.killAfterMs ?? 2000;
  const sessions = new Map<string, Session & { turns: Turn[] }>();
  const runs = new Map<string, ActiveRun>();
  let conn: Promise<Conn> | null = null;
  let child: ChildProcess | null = null;
  let closing: Promise<void> | null = null;
  let exited: string | null = null;
  let err = '';

  const now = () => new Date().toISOString();
  const byId = (sessionId: string) => [...runs.values()].find((r) => r.sessionId === sessionId);
  const failAll = (error: string) => { for (const r of [...runs.values()]) r.finish({ stopReason: 'error', error }); };
  const exitedWaiter = (c: ChildProcess) => new Promise<void>((r) => { if (c.exitCode !== null || c.signalCode !== null) r(); else c.once('exit', () => r()); });

  async function start(): Promise<Conn> {
    const sdk = await loadSdk();
    const c = spawn(o.command, o.args ?? [], { cwd: o.cwd, env: agentEnv(o.env), stdio: ['pipe', 'pipe', 'pipe'], shell: false, windowsHide: true });
    child = c;
    c.stdin?.on('error', () => undefined);
    c.stderr?.on('data', (b: Buffer) => { err = (err + b.toString('utf8')).slice(-8000); });
    const dead = new Promise<never>((_, reject) => {
      c.once('error', (e) => { exited = `Cannot start ${o.command}: ${e.message}`; reject(new AcpError(line(exited, 300))); });
      c.once('exit', (code, sig) => {
        exited = `Agent exited (${sig ?? `code ${code}`})`;
        if (!closing) failAll(exited);
        reject(new AcpError(exited));
      });
    });
    dead.catch(() => undefined);
    if (!c.stdin || !c.stdout) throw new AcpError(`Cannot start ${o.command}: no stdio`);

    const app = sdk.client({ name: 'stack' })
      .onNotification(sdk.methods.client.session.update, ({ params }) => onUpdate(params))
      .onRequest(sdk.methods.client.session.requestPermission, ({ params }) => onPermission(params));
    const stream = sdk.ndJsonStream(Writable.toWeb(c.stdin) as WritableStream<Uint8Array>, Readable.toWeb(c.stdout) as ReadableStream<Uint8Array>);
    const connection = app.connect(stream);
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new AcpError(`Agent did not answer initialize within ${startTimeoutMs} ms`)), startTimeoutMs); });
    try {
      const init = await Promise.race([
        connection.agent.request(sdk.methods.agent.initialize, { protocolVersion: PROTOCOL_VERSION, clientInfo: { name: 'stack', version: '0' }, clientCapabilities: {} }),
        dead, timeout,
      ]);
      if (init.protocolVersion !== PROTOCOL_VERSION) throw new AcpError(`Unsupported ACP protocol version ${String(init.protocolVersion)} (this driver speaks ${PROTOCOL_VERSION})`);
    } catch (e) {
      throw e instanceof AcpError ? e : new AcpError(`Agent initialize failed: ${line((e as Error).message, 300)}`);
    } finally { clearTimeout(timer); }
    return { sdk, ctx: connection.agent, child: c, close: () => connection.close() };
  }

  /** @req FR:acp-driver/conn.spawn */
  async function ensure(): Promise<Conn> {
    if (closing) throw new AcpError('ACP driver is closed');
    if (exited) throw new AcpError(exited);
    conn ??= start();
    try { return await conn; } catch (e) { await close(); throw e; }
  }

  // ---- inbound: updates and permission requests
  function onUpdate(p: Acp.SessionNotification): void {
    const r = byId(p.sessionId);
    if (!r || r.finished) return;
    const u = p.update as Record<string, unknown> & { sessionUpdate: string };
    switch (u.sessionUpdate) {
      case 'agent_message_chunk': {
        const c = u.content as { type?: string; text?: string } | undefined;
        if (c?.type === 'text' && typeof c.text === 'string') { r.text += c.text; r.q.push({ type: 'message_chunk', role: 'assistant', text: c.text }); }
        break;
      }
      case 'tool_call': {
        const callId = String(u.toolCallId);
        const call = { title: line(u.title, 200), kind: toolKind(u.kind), status: toolStatus(u.status, 'pending'), input: (u.rawInput && typeof u.rawInput === 'object' ? u.rawInput : {}) as Record<string, unknown> };
        r.calls.set(callId, call);
        r.q.push({ type: 'tool_call', callId, title: call.title, kind: call.kind, status: call.status });
        break;
      }
      case 'tool_call_update': {
        const callId = String(u.toolCallId);
        const prev = r.calls.get(callId);
        const status = toolStatus(u.status, prev?.status ?? 'in_progress');
        if (prev) prev.status = status;
        const output = (Array.isArray(u.content) ? u.content : [])
          .map((x: { type?: string; content?: { type?: string; text?: string } }) => (x?.type === 'content' && x.content?.type === 'text' ? x.content.text ?? '' : '')).filter(Boolean).join('\n');
        r.q.push({ type: 'tool_update', callId, status, ...(output ? { output: output.slice(0, 4000) } : {}) });
        break;
      }
      default: break; // thoughts, plans, modes, usage: not part of the driver vocabulary yet
    }
  }

  /** @req FR:acp-driver/perm.ask @req FR:acp-driver/perm.answer */
  async function onPermission(p: Acp.RequestPermissionRequest): Promise<Acp.RequestPermissionResponse> {
    const cancelled = { outcome: { outcome: 'cancelled' } } as Acp.RequestPermissionResponse;
    const r = byId(p.sessionId);
    if (!r || r.finished || r.cancelled) return cancelled;
    const options: PermissionOption[] = p.options.map((x) => ({ optionId: x.optionId, name: line(x.name, 80), kind: PERM_KINDS.has(x.kind as PermissionKind) ? (x.kind as PermissionKind) : 'reject_once' }));
    const callId = String(p.toolCall.toolCallId);
    const known = r.calls.get(callId);
    const title = line(p.toolCall.title ?? known?.title ?? 'Tool call', 200);
    const input = (p.toolCall.rawInput && typeof p.toolCall.rawInput === 'object' ? p.toolCall.rawInput : known?.input ?? {}) as Record<string, unknown>;
    const kind = toolKind(p.toolCall.kind ?? known?.kind);
    const req: PermissionRequest = { requestId: randomBytes(4).toString('hex'), callId, tool: String(p.toolCall.name ?? p.toolCall.kind ?? known?.kind ?? 'tool'), title, input, options, ...(RISKY.has(kind) ? { risky: true } : {}) };
    r.q.push({ type: 'permission', requestId: req.requestId, callId, title, options });
    try {
      const answer = await Promise.race([r.onPermission(req), r.abort.then(() => null)]);
      if (!answer || r.cancelled) return cancelled;
      const id = pick(options, answer);
      return id ? ({ outcome: { outcome: 'selected', optionId: id } } as Acp.RequestPermissionResponse) : cancelled;
    } catch { return cancelled; } // a failure never allows
  }

  async function prompt(req: PromptRequest): Promise<Run> {
    const c = await ensure();
    let sessionId = req.sessionId;
    const fresh = !sessionId;
    if (sessionId) {
      if (!sessions.has(sessionId)) throw new AcpError(`Unknown session: ${sessionId} (this driver resumes only sessions it created)`);
      if (byId(sessionId)) throw new SessionBusy('Session has a run in flight');
    } else {
      const cwd = req.cwd ? (isAbsolute(req.cwd) ? req.cwd : resolve(req.cwd)) : resolve(o.cwd ?? process.cwd());
      try {
        sessionId = (await c.ctx.request(c.sdk.methods.agent.session.new, { cwd, mcpServers: [] })).sessionId;
      } catch (e) { throw new AcpError(`session/new failed: ${line((e as Error).message, 300)}`); }
      sessions.set(sessionId, { id: sessionId, title: line(req.options?.title ?? req.text, 80), project: projectOf(cwd), cwd, lastActive: now(), active: false, cost: { usd: 0, tokens: 0 }, prs: [], turns: [] });
    }
    const sid = sessionId as string;
    const session = sessions.get(sid) as Session & { turns: Turn[] };
    session.turns.push({ at: now(), role: 'user', text: req.text });

    let doAbort = () => undefined as void;
    const q = channel<Update>();
    const run: ActiveRun = {
      id: randomUUID(), sessionId: sid, started: Date.now(), text: '', cancelled: false, finished: false, calls: new Map(), q,
      abort: new Promise<void>((r) => { doAbort = r; }), doAbort, onPermission: req.onPermission,
      finish(d) {
        if (run.finished) return;
        run.finished = true; runs.delete(run.id); doAbort();
        session.lastActive = now();
        if (run.text) session.turns.push({ at: now(), role: 'assistant', text: run.text });
        q.push({ type: 'done', cost: { usd: 0, tokens: 0 }, turns: 1, durationMs: Date.now() - run.started, text: run.text, ...d });
        q.end();
      },
    };
    runs.set(run.id, run);
    if (fresh) q.push({ type: 'session', sessionId: sid });
    c.ctx.request(c.sdk.methods.agent.session.prompt, { sessionId: sid, prompt: [{ type: 'text', text: req.text }] }).then(
      (res) => run.finish(stopOf(res.stopReason, run.cancelled)),
      async (e: Error) => {
        // stdout often closes before the exit event: give the exit a moment so the error names the exit code (FR:cli.crash).
        if (!run.cancelled && !exited && c.child.exitCode === null && c.child.signalCode === null) await Promise.race([exitedWaiter(c.child), new Promise<void>((r) => setTimeout(r, 500).unref?.())]);
        run.finish(run.cancelled ? { stopReason: 'cancelled' } : { stopReason: 'error', error: exited && !closing ? exited : line(e.message, 300) });
      },
    );
    return { id: run.id, sessionId: sid, updates: q.iterable };
  }

  async function cancel(runId: string): Promise<boolean> {
    const r = runs.get(runId);
    if (!r || r.finished || r.cancelled) return false;
    r.cancelled = true;
    r.doAbort();
    try { const c = await conn; await c?.ctx.notify(c.sdk.methods.agent.session.cancel, { sessionId: r.sessionId }); } catch { /* the agent is gone; the run ends below */ }
    return true;
  }

  /** @req FR:acp-driver/conn.close */
  function close(): Promise<void> {
    closing ??= (async () => {
      for (const r of [...runs.values()]) { r.cancelled = true; r.doAbort(); }
      const c = conn ? await conn.catch(() => null) : null;
      if (c) for (const r of [...runs.values()]) await c.ctx.notify(c.sdk.methods.agent.session.cancel, { sessionId: r.sessionId }).catch(() => undefined);
      for (const r of [...runs.values()]) r.finish({ stopReason: 'cancelled' });
      c?.close();
      const ch = child;
      if (ch && ch.exitCode === null && ch.signalCode === null) {
        const gone = exitedWaiter(ch);
        const within = (ms: number) => Promise.race([gone.then(() => true), new Promise<boolean>((r) => setTimeout(() => r(false), ms).unref?.())]);
        ch.stdin?.end();
        if (!(await within(killAfterMs))) {
          ch.kill('SIGTERM');
          if (!(await within(killAfterMs))) { ch.kill('SIGKILL'); await gone; }
        }
      }
    })();
    return closing;
  }

  return {
    prompt, cancel, close,
    stderr: () => redact(err).slice(-2000),
    listSessions: async (opt) => [...sessions.values()].reverse().slice(0, opt?.limit ?? 50).map((s) => ({ id: s.id, title: s.title, project: s.project, cwd: s.cwd, lastActive: s.lastActive, active: s.active, cost: s.cost, prs: s.prs })),
    getMessages: async (id, opt) => (sessions.get(id)?.turns ?? []).slice(-(opt?.limit ?? 30)),
  };
}

/** The ACP option to send for an answer: an offered id as is; Stack's `allow` / `deny` map to the first option of that kind. */
function pick(options: PermissionOption[], a: PermissionAnswer): string | null {
  if (options.some((x) => x.optionId === a.optionId)) return a.optionId;
  const first = (...kinds: PermissionKind[]) => { for (const k of kinds) { const o = options.find((x) => x.kind === k); if (o) return o.optionId; } return null; };
  if (a.optionId === 'allow') return first('allow_once');
  if (a.optionId === 'deny') return first('reject_once', 'reject_always');
  return null;
}

function stopOf(reason: string, cancelled: boolean): { stopReason: StopReason; error?: string } {
  // A cancelled run is cancelled, also when the agent ignores session/cancel and ends its turn (FR:run.cancel).
  if (reason === 'cancelled' || cancelled) return { stopReason: 'cancelled' };
  if (reason === 'end_turn') return { stopReason: 'end_turn' };
  return { stopReason: 'error', error: `Agent stopped: ${reason}` };
}
