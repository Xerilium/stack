/**
 * Agent delivery: the reader of `tasks/.stack/inbox`. Runs the task's agent headlessly (`claude -p`) on each open owner message,
 * posts its reply in the thread as the agent, and handles the entry. Login trouble shows as `Not delivered` and one sign-in ask.
 * Every process start goes through an injected function, so tests start none.
 * @req FR:agent-delivery/pick.entries @req FR:agent-delivery/run.cli @req FR:agent-delivery/state.file @req NFR:agent-delivery/delivery.seam
 */
import { spawn } from 'child_process';
import { appendFileSync, closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync, writeSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { agentFor, listTeam, scopeCovers, type ScannedAgent, type TeamAgent } from '../core/agents';
import { handleAsk, putAsk, readAsk } from '../core/asks';
import type { StackConfig } from '../core/config';
import { currentRows, handleEntry, listInbox, replyFromAgent, type ListedEntry } from '../core/inbox';
import type { LifecycleContext, TaskRef } from '../core/lifecycle';
import { pidAlive, writeAtomic } from '../core/file-lock';
import { projectRepos } from '../core/repos';
import type { Inventory } from '../core/session-inventory';
import { redact } from '../core/triage';
import { childEnv, spawnRunner, type Runner } from '../email/llm';
import { formatRef, parseRef } from '../api/validate';
import { personaOf, runnableAgent, taskContext, type AgentScan } from './team';
import { formatAgentLink, sessionAlive, setFrontmatterValue, taskAgent, type LocalSession } from '../core/goal-model';
import type { AgentRuns } from './runs';

// @req NFR:agent-delivery/delivery.lazy: nothing runs at import; the loop starts only from startDeliveryLoop.
export type DeliveryState = 'working' | 'delivered' | 'failed' | 'not-delivered';
export type LoginState = 'ok' | 'expired' | 'unknown';
export interface DeliveryRecord { state: DeliveryState; at: string; agent: string; reason?: string }
/** A denied tool call waiting on its ask: the entry, the agent, and the exact permission rule an approval adds. */
export interface PendingPerm { entry: string; agent: string; rule: string; tool: string }
export interface DeliveryFile { version: 1; login: { state: LoginState; at: string }; items: Record<string, DeliveryRecord>; spend?: { day: string; usd: number }; perms?: Record<string, PendingPerm> }
export interface DeliverySettings { mode: 'claude' | 'off'; timeoutMs: number; maxUsd: number; dailyCapUsd: number; reposRoot: string }
export interface DeliveryResult { id: string; state: DeliveryState; agent: string; reason?: string }
export interface DeliveryStatus { mode: 'claude' | 'off'; login: LoginState; items: Record<string, Omit<DeliveryRecord, 'at'>>; live?: LiveSession }
export interface LiveSession { id: string; title: string; link: string }

export interface DeliveryDeps {
  ctx: LifecycleContext;
  settings: DeliverySettings;
  store: DeliveryStore;
  /** Starts `claude`; default `spawnRunner` (stdin, timeout, `childEnv`). */
  run?: Runner;
  bin?: string;
  /** The task repo: the fallback working folder. */
  repoDir: string;
  /** A folder is a git checkout; default checks for `.git`. */
  isRepo?: (dir: string) => boolean;
  /** Agents outside the content repo; a Now pick may name one. @req FR:agent-team/agent.team.scan.run */
  agentScan?: AgentScan;
  /** Restarts a gone lead agent from its `agent-def` before work goes to it; absent: never. @req FR:goal-model/agent.restart */
  leads?: LeadRestart;
}

/** What a lead restart needs: the agent runs (a new session), the local session list, and a reader for a repo file. @req FR:goal-model/agent.restart */
export interface LeadRestart {
  /** `sessions` lists the sessions the agent runs started (Claude Code ids); they are not in the app store. */
  runs: Pick<AgentRuns, 'prompt' | 'subscribe'> & Partial<Pick<AgentRuns, 'sessions'>>;
  inventory: () => { sessions: LocalSession[] };
  /** A repo file by its path from the repo root; null when it is missing. */
  readDef: (path: string) => Promise<string | null>;
  /** How long to wait for the new session id. */
  waitMs?: number;
}

/** @req FR:goal-model/agent.restart.to @req FR:goal-model/agent.restart.level: who the work goes to, and the level files this pass tried. */
export interface RestartOpts { to?: { name: string; session?: string }; seen?: Set<string> }
/** Link ids each restart host tried or wrote, for the life of the process. @req FR:goal-model/agent.restart.live */
const tried = new WeakMap<LeadRestart, Set<string>>();

/**
 * When the lead agent of a task (goal frontmatter or folder default) has no session on this machine and its level names `agent-def`,
 * starts a new session from that definition and rewrites the link at that level (the value only). No `agent-def`: nothing starts.
 * A session list that cannot be read starts nothing.
 * @req FR:goal-model/agent.restart
 */
export async function restartLead(ctx: LifecycleContext, deps: LeadRestart, ref: TaskRef, o: RestartOpts = {}): Promise<{ restarted: boolean; path?: string; id?: string }> {
  const no = { restarted: false };
  const lead = await taskAgent(ctx.storage, ref).catch(() => null);
  if (!lead || (lead.level !== 'goal' && lead.level !== 'folder') || !lead.agentDef) return no;
  // @req FR:goal-model/agent.restart.to: only work that goes to the lead restarts it (never work for the roll-up or another agent).
  if (o.to && o.to.session !== lead.link.id && o.to.name !== lead.link.name) return no;
  // @req FR:goal-model/agent.restart.level: one try per level file (goal file or folder default) per pass.
  if (o.seen) { if (o.seen.has(lead.path)) return no; o.seen.add(lead.path); }
  // @req FR:goal-model/agent.restart.live: one link restarts at most once per process; a link this process wrote is live.
  const done = tried.get(deps) ?? new Set<string>();
  tried.set(deps, done);
  if (done.has(lead.link.id)) return no;
  let sessions: LocalSession[];
  try {
    sessions = deps.inventory().sessions;
    // @req FR:goal-model/agent.restart.live: a session the agent runs started is not in the app store; the driver's list has it.
    if (deps.runs.sessions) sessions = [...sessions, ...(await deps.runs.sessions({ limit: 1000 })).items.map((s) => ({ id: s.id, cli: s.id }))];
  } catch { return no; }
  if (sessionAlive(lead.link, sessions)) return no;
  if (lead.agentDef.startsWith('/') || lead.agentDef.split('/').includes('..')) return no;
  const def = await deps.readDef(lead.agentDef).catch(() => null);
  if (!def) return no;
  done.add(lead.link.id);
  const { runId, sessionId } = await deps.runs.prompt({
    text: `You are ${lead.link.name}, restarted as the lead agent for ${lead.path}. Your last session is gone. Read the goal files you lead and continue the work.`,
    options: { title: lead.link.name, systemPrompt: def },
  });
  const sid = sessionId ?? await new Promise<string | null>((ok) => {
    const timer = setTimeout(() => { stop?.(); ok(null); }, deps.waitMs ?? 30_000);
    const stop = deps.runs.subscribe(runId, (u) => { if (u.type === 'session') { clearTimeout(timer); ok(u.sessionId); } }, () => { clearTimeout(timer); ok(null); });
    if (!stop) { clearTimeout(timer); ok(null); }
  });
  if (!sid) return no;
  const id = sid.startsWith('local_') ? sid : `local_${sid}`;
  done.add(id);
  const cur = await ctx.storage.read(lead.path);
  const next = setFrontmatterValue(cur.content, 'agent', formatAgentLink({ name: lead.link.name, id }));
  await ctx.storage.write(lead.path, next, { expectedVersion: cur.version, message: `Restart agent ${lead.link.name}` });
  return { restarted: true, path: lead.path, id };
}

/** The repo rules every delivery run starts with. @req FR:agent-delivery/safe.prefix */
export const PREFIX = [
  'You are answering the owner\'s message on a task, unattended. Rules:',
  '- Read this repo\'s CLAUDE.md (and .xe/process when it exists) first and follow it; it is not loaded for you.',
  '- Never merge a pull request. Never add or remove labels. Never send mail, chat messages, or comments.',
  '- Only reading tools run without asking. Anything that needs the owner (a decision, an approval, a sign-in, a tool you were denied) goes at the end of your answer as "Needs you: ..."; never wait.',
  '- Your final answer is posted to the task thread for you: do not run `stack inbox reply`. Answer in plain text, at most 1000 characters.',
].join('\n');

/** Tools a delivery run may never use. No MCP server loads at all (`--strict-mcp-config`). @req FR:agent-delivery/safe.never */
// @req FR:agent-delivery/safe.never
export const NEVER_TOOLS = ['Bash(gh pr merge:*)', 'Bash(gh pr edit:*)', 'Bash(gh issue edit:*)', 'Bash(gh label:*)', 'Bash(gh api:*)', 'Bash(git push:*)', 'Bash(stack email:*)'];
/** The read tools; the only pre-allow is a read inside the working folder. Everything else the agent file lists is denied in a headless run and becomes an ask. @req FR:acp-driver/perm.headless */
const READ_TOOLS = ['Read', 'Grep', 'Glob'];
/** Read rules also cover Grep and Glob; `./**` is the working folder, so ~/.ssh, .env files elsewhere and token caches stay an ask. */
const READ_HERE = 'Read(./**)';
/** The tools a run gets when the agent file lists none. Never a shell. */
const DEFAULT_TOOLS = ['Read', 'Grep', 'Glob', 'Edit', 'Write', 'WebFetch', 'WebSearch'];
/** Shell tools never enter a delivery run, whatever the agent file says: agents that need a shell stay out of this runner. @req FR:agent-delivery/safe.noshell */
const SHELL = /^(Bash|BashOutput|KillShell|PowerShell)$/;
const CAP_ASK = 'delivery-cap';
const LOGIN_ASK = 'delivery-login';
const SIGN_IN = 'claude auth login';
const STATUS_TIMEOUT_MS = 15_000;
const KEEP_MS = 30 * 864e5;
const THREAD_MAX = 20;
const REPLY_MAX = 1000;
const MAX_ASKS = 5;
/** Sign-in trouble in the CLI's stderr. */
const SIGNED_OUT = /\/login|oauth|not logged in|not signed in|authenticat|invalid api key|\b401\b/i;
/** The CLI's own sign-in errors in the result; never the model's words about auth. */
const CLI_SIGNED_OUT = /Please run \/login|Invalid API key|OAuth token has expired|authentication_error|API Error: 401/;

/** Delivery settings from the config; delivery is off unless the config says `claude`. @req FR:agent-delivery/safe.optin @req FR:agent-delivery/run.limits */
export function deliverySettings(config: StackConfig | undefined, repoDir: string): DeliverySettings {
  // @req FR:agent-delivery/safe.optin
  const i = config?.inbox ?? {};
  return { mode: i.delivery === 'claude' ? 'claude' : 'off', timeoutMs: (i.deliveryTimeoutSeconds ?? 300) * 1000, maxUsd: i.deliveryMaxUsd ?? 0.5, dailyCapUsd: i.deliveryDailyCapUsd ?? 5, reposRoot: i.reposRoot ?? dirname(repoDir) };
}

/** `~/.stack/delivery.json` (state) and `delivery.log` (one line per run, no bodies). @req FR:agent-delivery/state.file @req FR:agent-delivery/safe.log */
export class DeliveryStore {
  readonly file: string;
  readonly logFile: string;
  constructor(readonly home: string, private readonly now: () => Date = () => new Date()) {
    this.file = join(home, 'delivery.json');
    this.logFile = join(home, 'delivery.log');
  }
  read(): DeliveryFile {
    try {
      const j = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<DeliveryFile>;
      if (j.version === 1 && j.items && typeof j.items === 'object' && j.login) return j as DeliveryFile;
    } catch { /* first run */ }
    return { version: 1, login: { state: 'unknown', at: '' }, items: {} };
  }
  private write(f: DeliveryFile): void {
    const cut = this.now().getTime() - KEEP_MS;
    const items = Object.fromEntries(Object.entries(f.items).filter(([, r]) => Date.parse(r.at) >= cut));
    mkdirSync(this.home, { recursive: true });
    writeAtomic(this.file, `${JSON.stringify({ ...f, items }, null, 2)}\n`);
  }
  /**
   * Read-modify-write under `delivery.lock` (O_EXCL, holding the pid), so the host loop and `stack inbox run` never lose each other's writes.
   * A lock whose writer is gone, or older than 30 s, is taken over. @req FR:agent-delivery/pick.serial
   */
  private update<T>(fn: (f: DeliveryFile) => T): T {
    mkdirSync(this.home, { recursive: true });
    const lock = join(this.home, 'delivery.lock');
    const deadline = Date.now() + 5000;
    for (;;) {
      try { const fd = openSync(lock, 'wx', 0o600); try { writeSync(fd, String(process.pid)); } finally { closeSync(fd); } break; } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
        try {
          const pid = Number(readFileSync(lock, 'utf8'));
          if ((pid > 0 && !pidAlive(pid)) || Date.now() - statSync(lock).mtimeMs > 30_000) { unlinkSync(lock); continue; }
        } catch { continue; } // gone between the open and the read
        if (Date.now() > deadline) throw new Error('Delivery state is busy');
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      }
    }
    try { const f = this.read(); const out = fn(f); this.write(f); return out; } finally { try { unlinkSync(lock); } catch { /* already gone */ } }
  }
  set(id: string, r: DeliveryRecord): void { this.update((f) => { f.items[id] = r; }); }
  /**
   * Atomically checks and reserves a run: false when the entry is done, or any fresh `working` record (any process, this entry too) holds the agent.
   * @req FR:agent-delivery/pick.serial @req FR:agent-delivery/pick.once
   */
  claim(id: string, agent: string, freshMs: number, o: { rerun?: boolean } = {}): boolean {
    return this.update((f) => {
      const now = this.now();
      const cur = f.items[id];
      if (!o.rerun && cur && (cur.state === 'delivered' || cur.state === 'failed')) return false;
      if (Object.values(f.items).some((r) => r.agent === agent && r.state === 'working' && now.getTime() - Date.parse(r.at) < freshMs)) return false;
      f.items[id] = { state: 'working', at: now.toISOString(), agent };
      return true;
    });
  }
  private day(): string { return this.now().toISOString().slice(0, 10); }
  /** Spend today (UTC day). @req FR:agent-delivery/run.daily */
  spentToday(): number { const s = this.read().spend; return s && s.day === this.day() ? s.usd : 0; }
  addSpend(usd: number): void { if (!(usd > 0)) return; const day = this.day(); this.update((f) => { f.spend = { day, usd: (f.spend?.day === day ? f.spend.usd : 0) + usd }; }); }
  setPerm(key: string, p: PendingPerm | null): void { this.update((f) => { const m = { ...(f.perms ?? {}) }; if (p) m[key] = p; else delete m[key]; f.perms = m; }); }
  setLogin(state: LoginState): void { this.update((f) => { f.login = { state, at: this.now().toISOString() }; }); }
  // @req FR:agent-delivery/safe.log: ids, states, timing and cost only; never a body.
  log(line: Record<string, unknown>): void {
    mkdirSync(this.home, { recursive: true });
    appendFileSync(this.logFile, `${JSON.stringify({ at: this.now().toISOString(), ...line })}\n`, { mode: 0o600 });
  }
}

/** Open owner messages to agents (`instruction` or `reply`), oldest first. @req FR:agent-delivery/pick.entries */
export async function pendingDeliveries(ctx: LifecycleContext, o: { project?: string } = {}): Promise<ListedEntry[]> {
  const open = await listInbox(ctx, { state: 'open', ...(o.project ? { project: o.project } : {}) });
  return open.filter((e) => e.to === 'agent' && e.from !== 'agent' && (e.kind === 'instruction' || e.kind === 'reply'));
}

/** `claude -p` arguments: safe mode, no MCP, nothing kept, the agent's tools, only reads pre-allowed, the never-list denied. @req FR:agent-delivery/run.cli @req FR:agent-delivery/safe.never */
export function deliveryArgs(o: { model?: string; tools?: string[]; maxUsd: number; systemFile: string; approved?: string[] }): string[] {
  const tools = (o.tools?.length ? o.tools : DEFAULT_TOOLS).filter((t) => !SHELL.test(t));
  const allowed = [...(READ_TOOLS.some((t) => tools.includes(t)) ? [READ_HERE] : []), ...(o.approved ?? [])];
  return [
    // No setting source loads: the owner's own allow rules (user, project, local) must never pre-allow a tool in an unattended run.
    '-p', '--safe-mode', '--setting-sources', '', '--strict-mcp-config', '--no-session-persistence', '--output-format', 'json', '--permission-mode', 'default',
    '--max-budget-usd', String(o.maxUsd), '--system-prompt-file', o.systemFile,
    ...(o.model ? ['--model', o.model] : []),
    ...(tools.length ? ['--tools', tools.join(',')] : ['--tools', '']),
    ...(allowed.length ? ['--allowedTools', allowed.join(',')] : []),
    '--disallowedTools', NEVER_TOOLS.join(','),
  ];
}

/** `claude auth status --json`: ok, expired, or unknown (the pass still runs). @req FR:agent-delivery/login.check */
export async function checkLogin(d: DeliveryDeps): Promise<LoginState> {
  // @req FR:agent-delivery/login.check
  try {
    const r = await (d.run ?? spawnRunner)(d.bin ?? process.env.STACK_CLAUDE_BIN ?? 'claude', ['auth', 'status', '--json'], '', { timeoutMs: STATUS_TIMEOUT_MS, cwd: tmpdir() });
    let j: { loggedIn?: unknown } | null = null;
    try { j = JSON.parse(r.stdout) as { loggedIn?: unknown }; } catch { j = null; }
    if (j?.loggedIn === true) return 'ok';
    if (j?.loggedIn === false || r.code === 1) return 'expired';
    return 'unknown';
  } catch { return 'unknown'; }
}

/** Starts the browser sign-in detached; else names the one step. @req FR:agent-delivery/login.signin */
export async function startLogin(spawnDetached: (cmd: string, args: string[]) => Promise<void> | void = defaultDetached): Promise<{ started: boolean; step?: string }> {
  try { await spawnDetached(process.env.STACK_CLAUDE_BIN ?? 'claude', ['auth', 'login']); return { started: true }; } catch { return { started: false, step: SIGN_IN }; }
}
/** Resolves once the process started; rejects on the child's `error` event (e.g. no `claude` on PATH), which fires after `spawn` returns. */
function defaultDetached(cmd: string, args: string[]): Promise<void> {
  return new Promise((ok, fail) => {
    const p = spawn(cmd, args, { detached: true, stdio: 'ignore', env: childEnv() });
    p.once('error', fail);
    p.once('spawn', () => { p.unref(); ok(); });
  });
}

/** One sign-in ask while signed out; closed once signed in. @req FR:agent-delivery/login.notice */
async function syncLoginAsk(ctx: LifecycleContext, login: LoginState): Promise<void> {
  if (login === 'unknown') return;
  const cur = await readAsk(ctx, LOGIN_ASK);
  const open = !!cur && cur.ask.state !== 'done';
  if (login === 'expired' && !open) {
    await putAsk(ctx, LOGIN_ASK, {
      ask: 'Claude login expired: Sign in', kind: 'go-do', from: 'stack', priority: 'high', effort: '2m', blocks: 1, reversible: true,
      why: `Messages to agents wait until you sign in. Use Sign in on the message, or run: ${SIGN_IN}`, ...(cur ? { reopen: true } : {}),
    }, 'stack');
  }
  if (login === 'ok' && open) await handleAsk(ctx, LOGIN_ASK, { outcome: 'resolved', note: 'Signed in' }, 'stack');
}

/** One cap ask while the day's spend is at the cap; closed once under it. @req FR:agent-delivery/run.daily */
async function syncCapAsk(d: DeliveryDeps, hit: boolean): Promise<void> {
  const cur = await readAsk(d.ctx, CAP_ASK);
  const open = !!cur && cur.ask.state !== 'done';
  if (hit && !open) {
    await putAsk(d.ctx, CAP_ASK, {
      ask: `Agent delivery hit its daily cap (${d.settings.dailyCapUsd}): raise it or wait`, kind: 'go-do', from: 'stack', priority: 'high', effort: '2m', blocks: 1, reversible: true,
      why: 'Messages to agents wait until tomorrow (UTC), or raise inbox.deliveryDailyCapUsd in .xe/config/stack.json', ...(cur ? { reopen: true } : {}),
    }, 'stack');
  }
  if (!hit && open) await handleAsk(d.ctx, CAP_ASK, { outcome: 'resolved', note: 'Under the cap' }, 'stack');
}

const toRef = (row: string): TaskRef | null => { const m = /^(tasks\/.+\.md):(\d+)$/.exec(row); return m ? { path: m[1], line: Number(m[2]) - 1 } : null; };
const oneLine = (s: string, max: number) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > max ? `${t.slice(0, max - 1)}…` : t; };

/** The working folder: the project's repo under the repos root, else the task repo. @req FR:agent-delivery/run.cwd */
async function cwdFor(d: DeliveryDeps, project: string): Promise<string> {
  // @req FR:agent-delivery/run.cwd
  const isRepo = d.isRepo ?? ((dir: string) => existsSync(join(dir, '.git')));
  const names = (await projectRepos(d.ctx).catch(() => [])).find((e) => e.project === project)?.names ?? [];
  for (const n of names) { const dir = join(d.settings.reposRoot, n); if (/^[A-Za-z0-9._-]+$/.test(n) && isRepo(dir)) return dir; }
  return d.repoDir;
}

interface Target { ref: TaskRef; apiRef: string; agent: TeamAgent; context: string; title: string; project: string; /** A scanned agent's repo folder. */ cwd?: string }
/** The team and the scan it came from (a scanned agent reads its whole file when it runs). */
interface Crew { team: TeamAgent[]; scanned: ScannedAgent[]; /** The scan failed: a named agent missing from the team may be a scanned one. */ scanFailed?: boolean }

/**
 * One pass: check the login, then deliver every pending message, one at a time per agent, oldest first.
 * @req FR:agent-delivery/pick.serial @req FR:agent-delivery/pick.once @req FR:agent-delivery/pick.agent
 */
export async function runDeliveryPass(d: DeliveryDeps, o: { project?: string } = {}): Promise<{ login: LoginState; items: DeliveryResult[] }> {
  const now = () => (d.ctx.now ?? (() => new Date()))();
  // Nothing to deliver: no process starts (the login is checked only when it matters).
  const done0 = d.store.read().items;
  const pending = await pendingDeliveries(d.ctx, o);
  // A reply was posted but the entry was not handled (a conflict or a crash between the two writes): finish it, never run again.
  for (const e of pending.filter((x) => done0[x.id]?.state === 'delivered')) await handleEntry(d.ctx, e.id, done0[e.id].agent || 'stack', 'Delivered').catch(() => undefined);
  const entries = pending.filter((e) => done0[e.id]?.state !== 'failed' && done0[e.id]?.state !== 'delivered');
  const out: DeliveryResult[] = [];
  const perms = d.store.read().perms ?? {};
  // Open permission asks wait for the owner: they alone never start a process (the login check included). @req FR:agent-delivery/run.approved @req FR:agent-delivery/login.check
  if (!entries.length && await allOpen(d, perms)) return { login: d.store.read().login.state, items: out };
  let login = await checkLogin(d);
  d.store.setLogin(login);
  await syncLoginAsk(d.ctx, login);
  const capHit = () => d.store.spentToday() >= d.settings.dailyCapUsd;
  await syncCapAsk(d, capHit());
  const rows = await currentRows(d.ctx, entries);
  let scanFailed = false;
  const scanned = d.agentScan ? await d.agentScan().catch((err: unknown) => { scanFailed = true; console.error(`delivery: agent scan failed (${err instanceof Error ? err.message : 'error'})`); return [] as ScannedAgent[]; }) : [];
  const team: Crew = { team: await listTeam(d.ctx, scanned), scanned, scanFailed };
  const recs = d.store.read().items;
  const fresh = d.settings.timeoutMs + 60_000;
  const busy = new Set(Object.entries(recs).filter(([, r]) => r.state === 'working' && now().getTime() - Date.parse(r.at) < fresh).map(([, r]) => r.agent));
  const record = (e: ListedEntry, r: Omit<DeliveryResult, 'id'>) => {
    const res: DeliveryResult = { id: e.id, ...r };
    d.store.set(e.id, { state: r.state, at: now().toISOString(), agent: r.agent, ...(r.reason ? { reason: r.reason } : {}) });
    out.push(res);
    return res;
  };
  const restarted = new Set<string>();
  for (const e of entries) {
    const prev = d.store.read().items[e.id];
    if (prev && (prev.state === 'failed' || prev.state === 'delivered')) continue;
    const t = await targetOf(d, e, rows.get(e.id), team);
    if (t === 'human' || t === 'wait') continue;
    if (!t) { record(e, { state: 'failed', agent: '', reason: 'No agent for this task' }); d.store.log({ entry: e.id, agent: '', project: e.project, state: 'failed', ms: 0, usd: 0, reason: 'No agent for this task' }); continue; }
    // Re-read before each run: another process (the host loop, the CLI) may have started this agent since the pass began.
    const live = d.store.read().items;
    if (busy.has(t.agent.slug) || Object.entries(live).some(([id, r]) => r.agent === t.agent.slug && r.state === 'working' && now().getTime() - Date.parse(r.at) < fresh && id !== e.id)) continue;
    if (live[e.id]?.state === 'delivered' || live[e.id]?.state === 'failed') continue;
    if (login === 'expired') {
      if (prev?.state !== 'not-delivered') record(e, { state: 'not-delivered', agent: t.agent.slug, reason: 'Claude login expired' });
      else out.push({ id: e.id, state: 'not-delivered', agent: t.agent.slug, reason: 'Claude login expired' });
      continue;
    }
    if (capHit()) { record(e, { state: 'not-delivered', agent: t.agent.slug, reason: 'Daily cap reached' }); await syncCapAsk(d, true); continue; }
    // The entries list is a snapshot: the owner may have withdrawn this one since (or another run handled it).
    if (!(await stillOpen(d, e))) continue;
    if (!d.store.claim(e.id, t.agent.slug, fresh)) continue;
    // @req FR:goal-model/agent.restart @req FR:goal-model/agent.restart.to @req FR:goal-model/agent.restart.level: work goes to this agent now; a gone lead gets a new session first.
    if (d.leads) await restartLead(d.ctx, d.leads, t.ref, { to: t.agent, seen: restarted }).catch(() => undefined);
    const r = await deliverOne(d, e, t, now);
    record(e, r);
    if (r.state === 'not-delivered') { login = 'expired'; d.store.setLogin(login); await syncLoginAsk(d.ctx, login); }
  }
  if (login !== 'expired') await runApprovals(d, perms, team, now, capHit, (e, r) => record(e, r));
  return { login, items: out };
}

/** Every pending permission ask is still open (none answered, none gone). */
async function allOpen(d: DeliveryDeps, perms: Record<string, PendingPerm>): Promise<boolean> {
  for (const key of Object.keys(perms)) if ((await readAsk(d.ctx, key).catch(() => null))?.ask.state !== 'open') return false;
  return true;
}

/**
 * Answered permission asks: a `go` re-runs the agent once with exactly that rule added and the owner's approval in the prompt;
 * any other answer closes the ask. Open asks wait. @req FR:agent-delivery/run.approved
 */
async function runApprovals(d: DeliveryDeps, perms: Record<string, PendingPerm>, team: Crew, now: () => Date, capHit: () => boolean, record: (e: ListedEntry, r: Omit<DeliveryResult, 'id'>) => void): Promise<void> {
  const byEntry = new Map<string, { keys: string[]; rules: string[]; tools: string[] }>();
  for (const [key, p] of Object.entries(perms)) {
    const a = await readAsk(d.ctx, key).catch(() => null);
    if (!a) { d.store.setPerm(key, null); continue; }
    if (a.ask.state === 'open') continue;
    const g = byEntry.get(p.entry) ?? { keys: [], rules: [], tools: [] };
    g.keys.push(key);
    if (a.ask.state === 'answered' && a.ask.answer === 'go') { g.rules.push(p.rule); g.tools.push(p.tool); }
    byEntry.set(p.entry, g);
  }
  if (!byEntry.size) return;
  const all = await listInbox(d.ctx, { state: 'all' });
  const rows = await currentRows(d.ctx, all);
  for (const [id, g] of byEntry) {
    const close = async (note: string) => { for (const k of g.keys) { d.store.setPerm(k, null); await handleAsk(d.ctx, k, { outcome: 'handled', note }, 'stack').catch(() => undefined); } };
    if (!g.rules.length) { await close('Denied'); continue; }
    const e = all.find((x) => x.id === id);
    const t = e ? await targetOf(d, e, rows.get(id), team) : null;
    if (t === 'wait') continue; // the scan failed: the approval waits for the next pass
    if (!e || !t || t === 'human') { await close('Task gone'); continue; }
    if (capHit()) { await syncCapAsk(d, true); continue; } // waits for the next day with the asks still answered
    if (!d.store.claim(e.id, t.agent.slug, d.settings.timeoutMs + 60_000, { rerun: true })) continue; // the agent is busy: the asks wait for the next pass
    await close('Re-run with approval');
    record(e, await deliverOne(d, e, t, now, { approved: g.rules, note: `The owner approved: ${g.tools.join(', ')} (${g.rules.join(', ')}). Do what you asked to do, then answer.` }));
  }
}

/** The agent Now's composer names: the most specific agent on the task, else the roll-up (same rule as the web `ownerOf`). @req FR:agent-delivery/pick.agent */
export function deliveryAgent(team: TeamAgent[], project: string, section?: string): TeamAgent | undefined {
  const all = agentFor(team, project, section);
  const fits = (a: TeamAgent) => a.scope.some((x) => scopeCovers(x, project));
  return all.find((a, i) => !(i === 0 && a.scope.includes('*')) && fits(a)) ?? all[0];
}

async function targetOf(d: DeliveryDeps, e: ListedEntry, row: string | undefined, crew: Crew): Promise<Target | 'human' | 'wait' | null> {
  const ref = row ? toRef(row) : null;
  if (!ref) return null;
  const c = await taskContext(d.ctx, ref).catch(() => null);
  if (c?.human) return 'human'; // the owner's own row: never delivered
  if (!c) return null;
  // The recipient Now named (the pick, else the owner) wins when Stack can run it. @req FR:agent-delivery/pick.agent @req FR:product-reset/ui.thread
  // A scanned agent runs only when named; the automatic pick stays in the content repo. @req FR:agent-team/agent.team.scan.run.pick
  const named = !e.from && e.agent ? crew.team.find((a) => a.slug === e.agent) : undefined;
  // A named agent missing while the scan failed may be a scanned one: wait for the next pass, never run a different agent unattended.
  if (!e.from && e.agent && !named && crew.scanFailed) return 'wait';
  const found = named ?? deliveryAgent(crew.team.filter((a) => a.home === undefined), c.project, c.section);
  if (!found) return null;
  // Its whole file and its repo (@req FR:agent-team/agent.team.scan.run.prompt @req FR:agent-team/agent.team.scan.run.cwd); a file gone since the scan is no agent.
  const run = await runnableAgent(found, crew.scanned).catch(() => null);
  return run ? { ref, apiRef: formatRef(ref), agent: run.agent, context: c.text, title: c.title, project: c.project, ...(run.cwd ? { cwd: run.cwd } : {}) } : null;
}

/** The thread so far on this row, the task, and the message to answer. @req FR:agent-delivery/run.prompt */
async function userText(d: DeliveryDeps, e: ListedEntry, t: Target, note?: string): Promise<string> {
  const all = await listInbox(d.ctx, { project: t.project, state: 'all' }).catch(() => [] as ListedEntry[]);
  const rows = await currentRows(d.ctx, all).catch(() => new Map<string, string>());
  const here = `${t.ref.path}:${t.ref.line + 1}`;
  // Owner messages up to this one; agent replies already posted count even when newer (a reply to the message before this one, queued behind it).
  const before = all.filter((x) => x.id !== e.id && (x.from === 'agent' || x.at <= e.at) && rows.get(x.id) === here).slice(-THREAD_MAX);
  const lines = before.map((x) => `- ${x.from === 'agent' ? (x.agent ?? 'agent') : 'Owner'}: ${x.text}`);
  return [`Task (${t.apiRef}):`, t.context, '', 'Thread so far (oldest first):', ...(lines.length ? lines : ['- (none)']), '', `Message to answer (from the owner, ${e.kind}):`, '', e.text, ...(note ? ['', note] : [])].join('\n');
}

interface ClaudeOut { result?: unknown; is_error?: unknown; subtype?: unknown; total_cost_usd?: unknown; permission_denials?: unknown }

/** Runs the agent once and posts its reply. @req FR:agent-delivery/run.reply @req FR:agent-delivery/run.limits @req FR:agent-delivery/run.asks */
async function deliverOne(d: DeliveryDeps, e: ListedEntry, t: Target, now: () => Date, extra: { approved?: string[]; note?: string } = {}): Promise<Omit<DeliveryResult, 'id'>> {
  const agent = t.agent.slug;
  const t0 = Date.now();
  let usd = 0;
  const done = (state: DeliveryState, reason?: string): Omit<DeliveryResult, 'id'> => {
    d.store.log({ entry: e.id, agent, project: t.project, state, ms: Date.now() - t0, usd, ...(reason ? { reason } : {}) });
    return { state, agent, ...(reason ? { reason } : {}) };
  };
  const dir = mkdtempSync(join(tmpdir(), 'stack-deliver-'));
  let r: { code: number; stdout: string; stderr: string };
  try {
    const systemFile = join(dir, 'system.txt');
    writeFileSync(systemFile, `${PREFIX}\n\n${personaOf(t.agent, t.context)}`, { mode: 0o600 });
    const args = deliveryArgs({ model: t.agent.model, tools: t.agent.tools, maxUsd: d.settings.maxUsd, systemFile, ...(extra.approved ? { approved: extra.approved } : {}) });
    r = await (d.run ?? spawnRunner)(d.bin ?? process.env.STACK_CLAUDE_BIN ?? 'claude', args, await userText(d, e, t, extra.note), { timeoutMs: d.settings.timeoutMs, cwd: t.cwd ?? await cwdFor(d, t.project) });
  } catch (err) {
    return done('failed', err instanceof Error && /timed out/i.test(err.message) ? 'Timed out' : 'Agent run failed');
  } finally { rmSync(dir, { recursive: true, force: true }); }
  let out: ClaudeOut = {};
  try { out = JSON.parse(r.stdout) as ClaudeOut; } catch { out = {}; }
  usd = typeof out.total_cost_usd === 'number' ? out.total_cost_usd : 0;
  d.store.addSpend(usd);
  const text = typeof out.result === 'string' ? out.result : '';
  const failed = r.code !== 0 || out.is_error === true;
  if (failed && (SIGNED_OUT.test(r.stderr) || CLI_SIGNED_OUT.test(text))) return done('not-delivered', 'Claude login expired');
  await denialAsks(d, e, t, out.permission_denials).catch(() => undefined);
  if (typeof out.subtype === 'string' && /budget/i.test(out.subtype)) return done('failed', 'Cost cap reached');
  if (failed) return done('failed', 'Agent run failed');
  const reply = oneLine(redact(text), REPLY_MAX); // the thread is committed: no secret the run read may land there
  if (!reply) return done('failed', 'Agent sent no reply');
  // The run took minutes: the owner may have withdrawn the message, and the task may have moved. Post on the row where it is now.
  if (!(await stillOpen(d, e, !!extra.approved))) return done('failed', 'Withdrawn');
  const at = await rowNow(d, e);
  if (!at) return done('failed', 'Task gone');
  try { await replyFromAgent(d.ctx, at.ref, reply, agent, at.text); } catch { return done('failed', 'Task changed during the run'); }
  // Delivered is written before the entry is handled: if handling fails, the next pass finishes it instead of running again.
  d.store.set(e.id, { state: 'delivered', at: now().toISOString(), agent });
  await handleEntry(d.ctx, e.id, agent, 'Delivered').catch(() => undefined);
  return done('delivered');
}

/** The entry is still open (not withdrawn, not handled); for an approved re-run (already handled), only not withdrawn. */
async function stillOpen(d: DeliveryDeps, e: ListedEntry, rerun = false): Promise<boolean> {
  return (await listInbox(d.ctx, { project: e.project, state: rerun ? 'all' : 'open' })).some((x) => x.id === e.id);
}

/** The entry's row now, with its text so the reply write fails if the row changes in between. */
async function rowNow(d: DeliveryDeps, e: ListedEntry): Promise<{ ref: TaskRef; text: string } | null> {
  const ref = toRef((await currentRows(d.ctx, [e])).get(e.id) ?? '');
  if (!ref) return null;
  const line = (await d.ctx.storage.read(ref.path)).content.split('\n')[ref.line] ?? '';
  const bare = line.replace(/\r$/, '');
  return /^\s*- \[[ xX]\]/.test(bare) ? { ref, text: bare.replace(/^\s*- \[[ xX]\] ?/, '') } : null; // same row text the inbox checks
}

/** Every denied tool call is one ask; Stack never re-runs it. @req FR:agent-delivery/run.asks @req FR:acp-driver/perm.headless */
async function denialAsks(d: DeliveryDeps, e: ListedEntry, t: Target, denials: unknown): Promise<void> {
  if (!Array.isArray(denials)) return;
  const base = `perm-dl-${e.id.replace(/^in-/, '').toLowerCase()}`;
  for (const [i, x] of denials.slice(0, MAX_ASKS).entries()) {
    const tool = typeof (x as { tool_name?: unknown })?.tool_name === 'string' ? (x as { tool_name: string }).tool_name.replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 60) : 'a tool';
    const raw = ((x as { tool_input?: unknown })?.tool_input ?? {}) as Record<string, unknown>;
    const input = JSON.stringify(raw);
    // The rule an approval adds: scoped to the file or host the agent asked for, else the tool.
    const fp = typeof raw.file_path === 'string' && /^[^()\n,]{1,300}$/.test(raw.file_path) ? raw.file_path : '';
    let host = ''; try { host = typeof raw.url === 'string' ? new URL(raw.url).hostname : ''; } catch { host = ''; }
    const rule = fp ? `${tool}(${fp})` : host ? `${tool}(domain:${host})` : tool;
    if (!SHELL.test(tool) && tool !== 'a tool') d.store.setPerm(`${base}-${i + 1}`, { entry: e.id, agent: t.agent.slug, rule, tool });
    await putAsk(d.ctx, `${base}-${i + 1}`, {
      ask: oneLine(redact(`Allow ${tool} for ${t.agent.name}? ${t.title}`), 200), kind: 'approve', from: t.agent.slug, project: t.project, ref: t.apiRef,
      why: oneLine(redact(`${tool} ${input}`), 500), recommend: 'Deny', priority: 'normal', blocks: 1, reversible: false,
    }, t.agent.slug);
  }
}

/** The newest live session for this agent or task: link only. @req FR:agent-delivery/live.find */
export function liveSessionFor(inv: Pick<Inventory, 'sessions'> | undefined, agent: { name: string }, apiRef: string): LiveSession | undefined {
  const hit = (inv?.sessions ?? [])
    // Archived sessions never reach the inventory (FR:session-inventory/state.archived). The name is the whole title head: `<name>` or `<name> · …`.
    .filter((s) => s.state !== 'done' && (s.title.endsWith(` · ${apiRef}`) || s.title === agent.name || s.title.startsWith(`${agent.name} · `)))
    .sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt))[0];
  return hit ? { id: hit.id, title: hit.title, link: hit.link } : undefined;
}

/** What Now shows under the row's messages. @req FR:agent-delivery/state.api @req FR:agent-delivery/live.offer */
export async function deliveryStatus(d: DeliveryDeps, apiRef: string, inventory?: () => Pick<Inventory, 'sessions'>): Promise<DeliveryStatus> {
  const ref = parseRef(apiRef);
  if (!ref) throw new Error('Bad ref');
  const c = await taskContext(d.ctx, ref);
  const entries = await listInbox(d.ctx, { project: c.project, state: 'all' });
  const rows = await currentRows(d.ctx, entries);
  const here = `${ref.path}:${ref.line + 1}`;
  const f = d.store.read();
  const items: DeliveryStatus['items'] = {};
  for (const e of entries) {
    const r = f.items[e.id];
    if (r && e.from !== 'agent' && rows.get(e.id) === here) items[e.id] = { state: r.state, agent: r.agent, ...(r.reason ? { reason: r.reason } : {}) };
  }
  const agent = deliveryAgent(await listTeam(d.ctx), c.project, c.section);
  let live: LiveSession | undefined;
  try { live = agent && inventory ? liveSessionFor(inventory(), agent, apiRef) : undefined; } catch { live = undefined; }
  return { mode: d.settings.mode, login: f.login.state, items, ...(live ? { live } : {}) };
}

/**
 * The host loop: a pass at start, then on a timer and on `kick()`; passes never overlap. `close()` waits for the pass in flight.
 * @req FR:agent-delivery/host.loop
 */
export function startDeliveryLoop(d: DeliveryDeps, o: { intervalMs?: number; onError?: (e: unknown) => void } = {}): { kick(): void; close(): Promise<void> } {
  let running: Promise<void> | null = null;
  let again = false;
  let closed = false;
  const pass = (): void => {
    if (closed) return;
    if (running) { again = true; return; }
    running = runDeliveryPass(d).then(() => undefined, (e) => { o.onError?.(e); }).finally(() => {
      running = null;
      if (again && !closed) { again = false; pass(); }
    });
  };
  const timer = setInterval(pass, o.intervalMs ?? 20_000);
  timer.unref?.();
  pass();
  return {
    kick: pass,
    async close() { closed = true; clearInterval(timer); while (running) await running; },
  };
}
