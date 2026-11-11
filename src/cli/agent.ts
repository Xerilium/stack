/**
 * `stack agent run <command> [args...] --prompt t`: one prompt on an ACP agent. Permission requests become asks
 * (`tasks/asks/perm-*.md`) that the owner answers; nothing is ever auto-allowed. Output passes through `redact`.
 * Cancel, timeout and crash end cleanly: the run is cancelled, an agent that ignores the cancel is closed after a grace period,
 * and the agent is always closed before the command returns.
 * @req FR:acp-driver/cli.run @req FR:acp-driver/cli.safe @req FR:acp-driver/perm.broker @req FR:acp-driver/perm.flow
 * @req FR:acp-driver/cli.signal @req FR:acp-driver/cli.timeout @req FR:acp-driver/cli.crash
 */
import { basename } from 'path';
import { createAcpDriver, createPermissionBroker, permKey, type AcpDriver, type Update } from '../agents';
import type { LifecycleContext } from '../core/lifecycle';
import { redact } from '../core/triage';
import { UsageError } from './args';
import type { IO } from './run';

const USAGE = 'Usage: stack agent run <command> [args...] --prompt t [--cwd dir] [--timeout s] (put -- before an agent argument that starts with --)';
const DEFAULT_TIMEOUT_S = 600;
/** After a cancel, how long the agent gets to end its turn before the command closes it. */
const GRACE_MS = 3000;

export interface AgentRunDeps {
  /** Tests inject a driver; the command creates the real one otherwise. */
  driver?: (o: { command: string; args: string[]; cwd?: string }) => AcpDriver;
}

export async function agentCmd(positionals: string[], flags: Record<string, string | true>, io: IO, json: boolean, ctxFactory: () => LifecycleContext, deps: AgentRunDeps = {}): Promise<number> {
  const [sub, command, ...args] = positionals;
  if (sub !== 'run') throw new UsageError(USAGE);
  if (!command) throw new UsageError(`agent run needs the agent command. ${USAGE}`);
  const prompt = typeof flags.prompt === 'string' ? flags.prompt : '';
  if (!prompt.trim()) throw new UsageError(`agent run needs --prompt. ${USAGE}`);
  const timeoutS = flags.timeout === undefined ? DEFAULT_TIMEOUT_S : Number(flags.timeout);
  if (typeof flags.timeout === 'boolean' || !Number.isFinite(timeoutS) || timeoutS <= 0) throw new UsageError(`--timeout must be a positive number of seconds: ${String(flags.timeout)}`);
  const cwd = typeof flags.cwd === 'string' ? flags.cwd : process.cwd();

  const ctx = ctxFactory();
  const broker = createPermissionBroker(ctx);
  const driver = (deps.driver ?? ((o) => createAcpDriver(o)))({ command, args, cwd });
  const title = `agent:${basename(command)}`;
  let sessionId = 'agent';
  let runId = '';
  /** Why the run was stopped (a signal or the timeout); null while it runs. */
  let stopped: string | null = null;
  let forced = false;
  let buf = '';
  const flush = (all: boolean) => {
    const cut = all ? buf.length : buf.lastIndexOf('\n') + 1;
    if (cut <= 0) return;
    io.out(redact(buf.slice(0, cut)));
    buf = buf.slice(cut);
  };
  let grace: NodeJS.Timeout | undefined;
  const force = () => { if (!forced) { forced = true; void driver.close(); } };
  /** First stop cancels the run; a second stop, or the end of the grace period, closes the agent. */
  const stop = (why: string) => {
    if (stopped) { force(); return; }
    stopped = why;
    if (runId) void driver.cancel(runId);
    grace = setTimeout(force, GRACE_MS);
  };
  const onInt = () => stop('cancelled (SIGINT)');
  const onTerm = () => stop('cancelled (SIGTERM)');
  process.on('SIGINT', onInt);
  process.on('SIGTERM', onTerm);
  let timer: NodeJS.Timeout | undefined;
  try {
    const run = await driver.prompt({
      cwd, text: prompt,
      onPermission: (req) => broker.ask({ id: sessionId, title, cwd }, req, runId || sessionId),
    });
    runId = run.id; sessionId = run.sessionId ?? sessionId;
    if (stopped) void driver.cancel(runId); // a signal came while the agent was starting
    timer = setTimeout(() => stop(`timed out after ${timeoutS} s`), timeoutS * 1000);
    let done: Extract<Update, { type: 'done' }> | undefined;
    for await (const u of run.updates) {
      if (u.type === 'message_chunk' && !json) { buf += u.text; flush(false); }
      else if (u.type === 'permission') io.err(`permission: ${redact(u.title)} (ask ${permKey(sessionId, u.requestId)})\n`);
      else if (u.type === 'done') done = u;
    }
    if (!json && buf) { buf = buf.endsWith('\n') ? buf : `${buf}\n`; flush(true); }
    const ok = !stopped && done?.stopReason === 'end_turn';
    const error = stopped ?? done?.error ?? (ok ? undefined : `run ${done?.stopReason ?? 'ended without a result'}`);
    if (json) io.out(`${JSON.stringify({ ok, sessionId, stopReason: stopped ? 'cancelled' : done?.stopReason ?? 'error', text: redact(done?.text ?? ''), ...(error ? { error: redact(error) } : {}) })}\n`);
    if (!ok) {
      if (!json) io.err(`error: ${redact(error ?? 'run failed')}\n`);
      const tail = driver.stderr().trim();
      if (tail && !json) io.err(`agent stderr: ${redact(tail).slice(-2000)}\n`);
    }
    return ok ? 0 : 1;
  } finally {
    clearTimeout(timer);
    clearTimeout(grace);
    process.off('SIGINT', onInt);
    process.off('SIGTERM', onTerm);
    broker.release(runId || sessionId);
    await driver.close();
  }
}
