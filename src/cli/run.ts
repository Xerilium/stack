/**
 * Command dispatch for the `stack` CLI.
 * @req FR:cli/run.git @req FR:cli/run.nocommit @req FR:cli/run.remote @req FR:cli/run.now @req FR:cli/ref.default
 * @req FR:ai-triage-assist/cli.triage @req FR:cli/cmd.add-project @req FR:cli/cmd.add @req FR:cli/cmd.next @req FR:cli/cmd.start @req FR:cli/cmd.complete @req FR:cli/cmd.skip
 * @req FR:cli/cmd.resume @req FR:cli/cmd.suspend @req FR:cli/cmd.set @req FR:cli/cmd.remove-completed @req FR:cli/cmd.update @req FR:cli/ref.expect @req FR:cli/arch.thin @req FR:cli/arch.storage
 */
import { execFileSync } from 'child_process';
import { existsSync, realpathSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { basename, dirname, join, resolve } from 'path';
import { getDefaults, parseConfig, ConfigError, StackConfig } from '../core/config';
import {
  addProject, addTask, completeTask, LifecycleContext, LifecycleError, LifecycleResult, nextTask,
  explainAutopri, priLinkCounts, rankStack, removeCompleted, resumeTask, setProperties, skipTask, startTask, suspendTask, sweep, tagTask, TaskProps,
} from '../core/lifecycle';
import { archiveAsks, ASK_KINDS, ASK_PRIORITIES, handleAsk, listAsks, putAsk, type AskPut, type HandleInput, LIST_STATES } from '../core/asks';
import { pidAlive, readHostFile, ReportInvalid, ReportStore, stackHome } from '../core/reports';
import { runInventory } from '../core/session-inventory';
import { PRI_LINKS, PrisInvalid, PriStore, type Pri } from '../core/pris';
import { formatGaps, priGaps, registerPrisEngine, setPris, withLinks, withNote } from '../core/pris-rank';
import { AGENT_MODES, agentFor, listTeam, putAgent, type AgentMode } from '../core/agents';
import { currentRows, handleEntry, INBOX_STATES, listInbox, replyFromAgent } from '../core/inbox';
import { registerAutopriEngine } from '../core/autopri';
import { captureTask, CaptureError } from '../core/quick-capture';
import { AUTONOMY_LEVELS, type Autonomy } from '../core/model';
import { applyTriage, effectiveAutonomy, setAutonomy } from '../core/triage';
import { createGhClient, refreshQueryTasks } from '../core/query-tasks';
import { ConflictError, FsStorage, NotFoundError, PathError, Storage, StorageError, writeAll, type AuxFiles } from '../core/storage';
import { PRIORITIES_PATH } from '../core/priorities';
import { GitStorage } from '../core/storage-git';
import { generateSummaries } from '../core/summaries';
import { formatRef, parseArgs, parseRef, UsageError } from './args';
import { emailCmd } from './email';
import { agentCmd } from './agent';
import { graphCmd } from './graph';
import { findStackDir, userConfig, walkStackDir } from './discover';
import { liveLine, redact, prepareDemo, prepareLive, resolveRepo, startWeb, type RepoInfo } from './web';
import { runLocal, type Locks, type SetupHandler } from './setup';
import { BatchedGitStorage } from '../core/storage-batch';
import { homedir } from 'os';

/** `in` reads all of stdin; `null` means no piped input (a terminal). */
export interface IO { out(s: string): void; err(s: string): void; in?: () => Promise<string | null> }

/** All of stdin, or `null` when stdin is a terminal or an open pipe sends nothing for `idleMs` (an agent shell that never closes stdin). */
export async function readStdin(stdin: NodeJS.ReadableStream & { isTTY?: boolean } = process.stdin, idleMs = 5000): Promise<string | null> {
  if (stdin.isTTY) return null;
  return new Promise((ok, fail) => {
    const chunks: Buffer[] = [];
    let timer: NodeJS.Timeout | undefined;
    const done = (v: string | null) => { if (timer) clearTimeout(timer); stdin.removeListener('data', onData); stdin.removeListener('end', onEnd); stdin.removeListener('error', fail); stdin.pause(); ok(v); };
    const arm = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => done(chunks.length ? Buffer.concat(chunks).toString('utf8') : null), idleMs); };
    const onData = (c: Buffer | string) => { chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); arm(); };
    const onEnd = () => done(Buffer.concat(chunks).toString('utf8'));
    stdin.on('data', onData); stdin.once('end', onEnd); stdin.once('error', fail);
    arm();
  });
}

/** Exit codes. @req FR:cli/out.codes */
export const EXIT = { ok: 0, failure: 1, usage: 2, conflict: 3, none: 4 } as const;

const GLOBAL = ['dir', 'json', 'no-commit', 'remote', 'branch', 'now', 'help', 'version'];
const COMMANDS: Record<string, { flags: string[]; usage: string; help: string }> = {
  init: { flags: [], usage: 'init', help: 'create repo, tasks/, and config' },
  'add-project': { flags: ['description', 'repo', 'alias', 'priority', 'capacity', 'weekly-capacity', 'file', 'force', 'queries', 'no-update'], usage: 'add-project <name> [--description t] [--repo url] [--alias a,b] [--priority n] [--capacity Block=h,..] [--weekly-capacity n] [--file name] [--force] [--queries] [--no-update]', help: 'create a project file' },
  add: { flags: ['section', 'parent'], usage: 'add <project> <text...> [--section name] [--parent ref]', help: 'add a task' },
  capture: { flags: ['project', 'section', 'dry-run'], usage: 'capture <text...> [--project name] [--section name] [--dry-run]', help: 'add a task from a phrase (e.g. "call dentist tomorrow 30m #alpha")' },
  next: { flags: ['top'], usage: 'next [--top n]', help: 'print the top task, or the first n ranked tasks (1-50); the web Home and /next use the same order' },
  start: { flags: ['expect', 'queries', 'no-update'], usage: 'start [ref] [--expect t] [--queries] [--no-update]', help: 'mark in progress' },
  complete: { flags: ['summary', 'remove', 'expect', 'queries', 'no-update'], usage: 'complete [ref] [--summary t] [--remove] [--expect t] [--queries] [--no-update]', help: 'check off (rolls recurring rows)' },
  skip: { flags: ['expect', 'queries', 'no-update'], usage: 'skip [ref] [--expect t] [--queries] [--no-update]', help: 'park a task (alias: park)' },
  park: { flags: ['expect', 'queries', 'no-update'], usage: 'park [ref] [--expect t] [--queries] [--no-update]', help: 'same as skip' },
  resume: { flags: ['expect', 'queries', 'no-update'], usage: 'resume [ref] [--expect t] [--queries] [--no-update]', help: 'unpark the first parked task' },
  suspend: { flags: ['days', 'hours', 'expect', 'queries', 'no-update'], usage: 'suspend [ref] [--days n | --hours n] [--expect t] [--queries] [--no-update]', help: 'hide until later' },
  set: { flags: ['status', 'priority', 'effort', 'impact', 'checkbox', 'suspend', 'remove-emojis', 'expect'], usage: 'set <ref> [--status e] [--priority e] [--effort e] [--impact e] [--checkbox complete|incomplete] [--suspend v] [--remove-emojis] [--expect t]', help: 'set emojis and checkbox' },
  tag: { flags: ['unblocker', 'due', 'expect'], usage: 'tag <ref> [--unblocker yes|no] [--due "MMM d"|none] [--expect t]', help: 'set the 🔓 unblocker and 📅 due tags the autopri engine reads' },
  rank: { flags: ['engine', 'explain', 'truth', 'top'], usage: 'rank [--engine autopri|pris|stack] [--top n] [--explain [--truth file]]', help: 'ranked tasks; pris boosts tasks linked to ~/.stack/pris.json by priority order; --explain (autopri, pris) shows score parts and the priority served; --truth lists ground-truth items to tag or add' },
  triage: { flags: ['autonomy', 'agent', 'human', 'priority', 'effort', 'impact'], usage: 'triage <ref> [--autonomy none|triage|assist|full] [--agent t] [--human t] [--priority e] [--effort e] [--impact e]', help: 'show/set autonomy, add 🪄/🙋 subtasks' },
  'remove-completed': { flags: ['project', 'queries', 'no-update'], usage: 'remove-completed [--project name] [--queries] [--no-update]', help: 'delete checked rows' },
  web: { flags: ['port', 'repo', 'live', 'branch', 'batch', 'reset'], usage: 'web [--repo path-or-url] [--live] [--branch name] [--remote name] [--batch minutes] [--port n] [--reset]', help: 'serve the web app on localhost (demo copy by default; --live edits your checkout, committed in batches)' },
  asks: { flags: ['ask', 'kind', 'from', 'project', 'why', 'recommend', 'options', 'default', 'by', 'reversible', 'link', 'priority', 'effort', 'blocks', 'detail-file', 'reopen', 'state', 'outcome', 'note', 'reply', 'limit', 'days', 'flow', 'seq', 'ref', 'apply', 'applies'], usage: 'asks put <key> --ask t --kind k --from agent [--project --why --recommend --options "A|B" --default --by --reversible yes|no --link --priority --effort --blocks --detail-file p --reopen --flow slug --seq n --ref project:line|tasks/<file>.md:<line> --apply "<action>" --applies "a|b"] | list [--state s] | handle <key> --outcome o [--note --reply] | archive [--days n]', help: 'ask queue for the owner: agents put and handle asks; archive moves old done asks aside' },
  email: { flags: ['account', 'mode', 'max', 'dry-run', 'offline', 'fixture', 'extra', 'project', 'all'], usage: 'email run [--all] [--mode observe|drafts] [--max n] [--dry-run [--offline] [--fixture f.json]] [--project p] | voice [--extra file.json] | status [--account a] | schedule [--remote origin]', help: 'one triage pass on the signed-in mailbox (asks, drafts only, inbox-zero batches), learn your writing voice, or show status; never sends mail' },
  graph: { flags: ['client-id', 'tenant', 'with', 'cache', 'account'], usage: 'graph login --client-id <id> [--tenant t] [--account addr] [--with calendar,mail,drafts] [--cache path] | status | logout', help: 'sign in to Microsoft Graph (device code) for the live calendar and mail; read-only scopes' },
  inbox: { flags: ['from', 'text', 'expect', 'project', 'state', 'note'], usage: 'inbox reply tasks/<file>.md:<line> --from <agent> --text t [--expect t] | list [--project p] [--state open|handled|all] | handle <id> [--note t] [--from <agent>]', help: 'reply on a task as an agent (tasks/inbox, from: agent), list the owner\'s open instructions, or mark one handled; docs/agent-instructions.md' },
  agent: { flags: ['prompt', 'cwd', 'timeout'], usage: 'agent run <command> [args...] --prompt t [--cwd dir] [--timeout s]', help: 'run one prompt on an ACP agent (e.g. gemini -- --acp); permission requests become asks; never auto-allows' },
  agents: { flags: ['project', 'section', 'name', 'role', 'scope', 'reports-to', 'model', 'mode', 'tools', 'prompt-file'], usage: 'agents list [--project p --section s] | add <slug> --name n --scope a,b [--role r --reports-to a --model m --mode long-running|ad-hoc --tools a,b --prompt-file p]', help: 'the team: tasks/agents/<slug>.md, .claude/agents/<slug>.md, and project Agents lines' },
  report: { flags: ['agent', 'project', 'file'], usage: 'report --agent <name> --project <p> [--file report.json] [--json]', help: 'send an agent status report (JSON on stdin or --file; docs/report.md) to the running host, or write ~/.stack/reports.json directly; never git' },
  sessions: { flags: [], usage: 'sessions [--json]', help: 'Claude app sessions: counts, ranked Needs you (waiting, stuck) with claude:// links, archive candidates; read-only, cached in ~/.stack/sessions.json' },
  pris: { flags: ['file', 'projects', 'keywords', 'refs'], usage: 'pris [--json] | pris seed --file <md> | pris link <id> [--projects a,b] [--keywords a,b] [--refs a,b] | pris note <id> <text> | pris gaps', help: 'the owner priorities in order (~/.stack/pris.json); seed runs once; link sets the terms that link tasks; note records status; gaps lists priorities with no status, stale status (>7 days) or no linked tasks' },
  update: { flags: ['sweep', 'queries', 'engine'], usage: 'update [--sweep] [--queries] [--engine legacy|stack]', help: 'regenerate README, stack, projects, my-day (default stack: scores and order like `stack next`, with .stack/priorities.json; --engine legacy: the PowerShell output)' },
};

interface Outcome { json: Record<string, unknown>; text: string; code?: number }

const VERBS: Record<string, string> = {
  start: 'started', complete: 'completed', skip: 'skipped', park: 'skipped', resume: 'resumed', suspend: 'suspended', set: 'set', add: 'added',
};

const taskText = (line: string | undefined): string => (line ?? '').replace(/^\s*- \[[ xX]\] ?/, '');
const flag = (f: Record<string, string | true>, n: string): string | undefined => (typeof f[n] === 'string' ? (f[n] as string) : undefined);

function num(v: string | undefined, name: string): number | undefined {
  if (v === undefined) return undefined;
  const n = Number(v);
  if (!/^-?\d+(\.\d+)?$/.test(v.trim()) || !Number.isFinite(n)) throw new UsageError(`--${name} must be a number: ${v}`);
  return n;
}

/** @req FR:cli/run.help.version */
function pkgVersion(): string {
  for (let d = __dirname; ; d = dirname(d)) {
    const p = join(d, 'package.json');
    if (existsSync(p)) {
      const j = JSON.parse(readFileSync(p, 'utf8')) as { name?: string; version?: string };
      if (j.name === 'stack') return j.version ?? '0.0.0';
    }
    if (dirname(d) === d) return '0.0.0';
  }
}

function helpText(): string {
  const lines = ['stack <command> [options]', ''];
  for (const [n, c] of Object.entries(COMMANDS)) if (n !== 'park') lines.push(`  ${c.usage}`.padEnd(30) + `  ${c.help}`);
  lines.push('', 'global: --dir <path> --json --no-commit --remote <name> --branch <name> --now <ISO>');
  lines.push('refs: tasks/<file>.md:<line> (1-based). exit: 0 ok, 1 failure, 2 usage, 3 conflict, 4 nothing to do');
  return lines.join('\n');
}

function loadConfig(dir: string): StackConfig {
  const p = join(dir, '.xe/config/stack.json');
  if (!existsSync(p)) return getDefaults();
  try {
    return parseConfig(JSON.parse(readFileSync(p, 'utf8').replace(/^﻿/, '')));
  } catch (e) {
    if (e instanceof ConfigError) throw e;
    throw new ConfigError(`${p}: ${(e as Error).message}`);
  }
}

const git = (dir: string, ...args: string[]): string =>
  execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });

/** @req FR:cli/run.git.worktree */
function isWorkTree(dir: string): boolean {
  try { return git(dir, "rev-parse", "--is-inside-work-tree").trim() === "true"; } catch { return false; }
}

/** True only when dir itself is the work tree top-level (not a subfolder of a parent repo). */
function isTopLevel(dir: string): boolean {
  try { return realpathSync(git(dir, "rev-parse", "--show-toplevel").trim()) === realpathSync(dir); } catch { return false; }
}

/** @req FR:cli/cmd.init */
function init(dir: string): Outcome {
  mkdirSync(dir, { recursive: true });
  const made: string[] = [];
  if (!isTopLevel(dir)) { git(dir, 'init', '-q', '-b', 'main'); made.push('repo'); }
  const add = (rel: string, content: string) => {
    const p = join(dir, rel);
    if (existsSync(p)) return;
    mkdirSync(dirname(p), { recursive: true });
    writeFileSync(p, content);
    made.push(rel);
  };
  add('tasks/.gitkeep', '');
  add('.xe/config/stack.json', '{}\n');
  const files = made.filter(m => m !== 'repo');
  if (files.length) {
    git(dir, 'add', '--', ...files);
    git(dir, 'commit', '-q', '-m', 'Initialize Stack', '--only', '--', ...files);
  }
  return { json: { ok: true, created: made }, text: made.length ? `initialized ${made.join(' ')}` : 'no change: already initialized' };
}

function props(f: Record<string, string | true>): TaskProps {
  const p: TaskProps = {};
  const emoji = (n: 'status' | 'priority' | 'effort' | 'impact') => {
    const v = flag(f, n);
    if (v === undefined) return;
    (p as Record<string, string>)[n] = v.toLowerCase() === 'none' ? 'None' : v;
  };
  (['status', 'priority', 'effort', 'impact'] as const).forEach(emoji);
  const box = flag(f, 'checkbox');
  if (box !== undefined) {
    if (!/^(complete|incomplete)$/i.test(box)) throw new UsageError('--checkbox must be complete or incomplete');
    p.checkbox = box.toLowerCase() === 'complete' ? 'Complete' : 'Incomplete';
  }
  if (f['suspend'] !== undefined) p.suspend = flag(f, 'suspend') ?? '';
  if (f['remove-emojis']) p.removeAllEmojis = true;
  if (Object.keys(p).length === 0) throw new UsageError('set needs at least one property flag');
  return p;
}

/** Canonical command name for JSON output (`park` is `skip`). */
const canon = (cmd: string): string => (cmd === 'park' ? 'skip' : cmd);

/** @req FR:task-lifecycle/doc.json */
function describe(cmd: string, r: LifecycleResult): Outcome {
  const json: Record<string, unknown> = {
    ok: true, command: canon(cmd), changed: r.changed,
    ...(r.ref ? { project: r.ref.path.replace(/^.*\//, '').replace(/\.md$/, '') } : {}),
    ...(r.ref ? { ref: { path: r.ref.path, line: r.ref.line + 1 } } : {}),
    ...(r.before !== undefined ? { before: r.before } : {}),
    ...(r.after !== undefined ? { after: r.after, text: taskText(r.after) } : {}),
    ...(r.message ? { message: r.message } : {}),
    ...(r.rolled ? { rolled: true } : {}),
  };
  if (!r.changed) {
    const where = r.ref ? ` (${formatRef(r.ref)})` : '';
    return { json, text: `no change: ${r.message ?? 'nothing to do'}${where}`, code: r.ref ? EXIT.ok : EXIT.none };
  }
  const verb = r.rolled ? 'rolled' : VERBS[cmd] ?? cmd;
  return { json, text: `${verb} ${r.ref ? formatRef(r.ref) : ''} ${taskText(r.after)}`.replace(/\s+$/, '') };
}

/** @req FR:cli/cmd.update */
async function update(ctx: LifecycleContext, storage: Storage, opts: { sweep: boolean; queries: boolean; engine?: 'legacy' | 'stack' }): Promise<Outcome> {
  const now = ctx.now ? ctx.now() : new Date();
  const config = ctx.config ?? getDefaults();
  // @req FR:cli/cmd.update.queries
  const queries = opts.queries ? await refreshQueryTasks(storage, createGhClient(), { now, timeZone: config.timezone }) : undefined;
  // @req FR:cli/cmd.update.sweep
  const swept = opts.sweep ? await sweep(ctx) : undefined;
  const readOpt = async (p: string) => { try { return await storage.read(p); } catch (e) { if (e instanceof NotFoundError) return null; throw e; } };
  const projects = [];
  for (const p of await storage.list()) projects.push({ fileName: p.replace(/^tasks\//, ''), content: (await storage.read(p)).content });
  const strip = (s?: string | null) => s?.replace(/^﻿/, '');
  // @req FR:cli/cmd.update.engine
  // The default is the engine `nextTask` uses, so the README top is the row a no-ref start/complete/skip acts on.
  const engine = opts.engine ?? 'stack';
  const priorities = engine === 'stack' ? (await (storage as Partial<AuxFiles>).readAux?.(PRIORITIES_PATH))?.content : undefined;
  const files = generateSummaries({
    projects, config, now, engine, ...(priorities ? { priorities } : {}),
    previousReadme: strip((await readOpt('README.md'))?.content), previousProjects: strip((await readOpt('projects.md'))?.content),
  });
  const changed: { path: string; content: string; expectedVersion: string | null }[] = [];
  for (const [name, content] of [['README.md', files.readme], ['stack.md', files.stack], ['projects.md', files.projects], ['my-day.md', files.myDay]] as const) {
    if (content === null) continue;
    const cur = await readOpt(name);
    if (cur && cur.content === content) continue;
    changed.push({ path: name, content, expectedVersion: cur ? cur.version : null });
  }
  // @req FR:cli/cmd.update.commit
  if (changed.length) await writeAll(storage, changed, 'Update summaries');
  const written = changed.map(c => c.path);
  const q = queries ? ` (queries: ${queries.processed} refreshed${queries.failures.length ? `, ${queries.failures.length} failed: ${queries.failures.map(x => x.message).join('; ')}` : ''})` : '';
  return {
    json: { ok: true, command: 'update', changed: written.length > 0, files: written, ...(swept ? { swept } : {}), ...(queries ? { queries } : {}) },
    text: (written.length ? `updated ${written.join(' ')}` : 'no change: summaries are current') + q,
  };
}

/** @req FR:ask-queue/cli.put @req FR:ask-queue/cli.list @req FR:ask-queue/cli.handle @req FR:ask-queue/cli.archive */
async function asksCmd(ctx: LifecycleContext, p: ReturnType<typeof parseArgs>): Promise<Outcome> {
  const f = p.flags;
  const [sub, key, ...rest] = p.positionals;
  if (rest.length) throw new UsageError(`Unexpected argument: ${rest[0]}`);
  const actor = flag(f, 'from') ?? 'cli';
  const s = (n: string) => flag(f, n);
  switch (sub) {
    case 'put': {
      if (!key) throw new UsageError('asks put needs a key');
      if (s('from') === undefined) throw new UsageError('asks put needs --from <agent>');
      const n = (name: string) => { const v = s(name); if (v === undefined) return undefined; if (!/^\d{1,2}$/.test(v)) throw new UsageError(`--${name} must be a whole number: ${v}`); return Number(v); };
      const yn = s('reversible');
      if (yn !== undefined && yn !== 'yes' && yn !== 'no') throw new UsageError('--reversible must be yes or no');
      const kind = s('kind');
      if (kind !== undefined && !(ASK_KINDS as readonly string[]).includes(kind)) throw new UsageError(`--kind must be one of ${ASK_KINDS.join(', ')}`);
      const pr = s('priority');
      if (pr !== undefined && !(ASK_PRIORITIES as readonly string[]).includes(pr)) throw new UsageError(`--priority must be one of ${ASK_PRIORITIES.join(', ')}`);
      const detailFile = s('detail-file');
      const input: AskPut = {
        ask: s('ask'), kind: kind as AskPut['kind'], from: s('from'), project: s('project'), why: s('why'), recommend: s('recommend'), default: s('default'), by: s('by'),
        link: s('link'), priority: pr as AskPut['priority'], effort: s('effort'), blocks: n('blocks'),
        ...(s('options') !== undefined ? { options: s('options')!.split('|').map((o) => o.trim()) } : {}),
        // @req FR:quick-triage/cli.put
        flow: s('flow'), seq: n('seq'), ref: s('ref')?.startsWith('tasks/') ? apiRef(parseRef(s('ref')!)) : s('ref'), apply: s('apply'),
        ...(s('applies') !== undefined ? { applies: s('applies')!.split('|').map((o) => o.trim()) } : {}),
        ...(yn !== undefined ? { reversible: yn === 'yes' } : {}),
        ...(detailFile ? { detail: readFileSync(detailFile, 'utf8') } : {}),
        ...(f['reopen'] ? { reopen: true } : {}),
      };
      for (const k of Object.keys(input) as (keyof AskPut)[]) if (input[k] === undefined) delete input[k];
      const r = await putAsk(ctx, key, input, actor);
      return { json: { ok: true, ...r }, text: r.key };
    }
    case 'list': {
      if (key) throw new UsageError(`Unexpected argument: ${key}`);
      const state = s('state') ?? 'open';
      if (!(LIST_STATES as readonly string[]).includes(state)) throw new UsageError(`--state must be one of ${LIST_STATES.join(', ')}`);
      const limit = num(s('limit'), 'limit');
      const r = await listAsks(ctx, { state: state as (typeof LIST_STATES)[number], limit });
      return { json: { ok: true, ...r }, text: r.items.map((a) => `${a.key}  ${a.score}  ${a.ask}`).join('\n') };
    }
    case 'handle': {
      if (!key) throw new UsageError('asks handle needs a key');
      const outcome = s('outcome');
      if (!outcome) throw new UsageError('asks handle needs --outcome');
      const r = await handleAsk(ctx, key, { outcome: outcome as HandleInput['outcome'], note: s('note'), reply: s('reply') }, actor);
      return { json: { ok: true, ...r }, text: r.changed ? `${outcome} ${key}` : `no change: ${key}` };
    }
    case 'archive': {
      // @req FR:ask-queue/cli.archive
      if (key) throw new UsageError(`Unexpected argument: ${key}`);
      const days = num(s('days'), 'days');
      const r = await archiveAsks(ctx, { days });
      return { json: { ok: true, ...r }, text: r.archived.length ? `archived ${r.archived.join(' ')}` : 'no change: nothing to archive' };
    }
    default: throw new UsageError('Usage: stack asks put|list|handle|archive (see stack --help)');
  }
}

/**
 * Sends a report to the running host (`host.json`), or writes the local store itself when no host answers. Never touches git.
 * @req FR:status-ingest/cli.report @req FR:status-ingest/cli.errors @req FR:status-ingest/cli.host @req FR:status-ingest/cli.direct
 */
async function reportCmd(p: ReturnType<typeof parseArgs>, input: () => Promise<string | null>): Promise<Outcome> {
  if (p.positionals.length) throw new UsageError(`Unexpected argument: ${p.positionals[0]}`);
  const agent = flag(p.flags, 'agent'); const project = flag(p.flags, 'project'); const file = flag(p.flags, 'file');
  if (!agent) throw new UsageError('report needs --agent <name>');
  if (!project) throw new UsageError('report needs --project <p>');
  let text: string | null;
  if (file !== undefined) { try { text = readFileSync(resolve(file), 'utf8'); } catch { throw new UsageError(`Cannot read --file: ${file}`); } }
  else text = await input();
  if (text === null || text.trim() === '') throw new UsageError('report needs JSON on stdin or --file <path>');
  let body: unknown;
  try { body = JSON.parse(text.replace(/^\uFEFF/, '')); } catch { throw new UsageError('report input is not valid JSON'); }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) throw new UsageError('report input must be a JSON object');
  // The flags name the pair; a body that names another pair is a mistake, not something to overwrite silently.
  for (const [k, v] of [['agent', agent], ['project', project]] as const) {
    const b = (body as Record<string, unknown>)[k];
    if (b !== undefined && b !== v) throw new UsageError(`report body ${k} "${String(b)}" does not match --${k} ${v}`);
  }
  const full = { ...body, agent, project };
  const home = stackHome();
  const host = readHostFile(home);
  let r: Awaited<ReturnType<ReportStore['put']>> | undefined;
  let via: 'host' | 'store' = 'store';
  // A host.json whose process is gone is stale (crash, or the port now belongs to something else).
  if (host && pidAlive(host.pid)) {
    let res: Response | undefined;
    try { res = await fetch(`${host.url}/api/reports`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(full), signal: AbortSignal.timeout(5000) }); } catch { res = undefined; } // no host listening: write the store directly
    if (res) {
      const j = await res.json().catch(() => null) as { asks?: { put?: unknown; dropped?: unknown; answers?: unknown }; error?: { code?: string; message?: string; details?: { field: string; message: string }[] } } | null;
      if (res.status === 400 && Array.isArray(j?.error?.details)) throw new ReportInvalid(j.error.details);
      if (res.ok && Array.isArray(j?.asks?.put) && Array.isArray(j?.asks?.dropped) && typeof j?.asks?.answers === 'object') { r = j as Awaited<ReturnType<ReportStore['put']>>; via = 'host'; }
      // A Stack error other than 404 (no store) is the host's answer; anything else is not a Stack host: write the store directly.
      else if (j?.error?.code && res.status !== 404) throw new StorageError(`host refused the report (${res.status}): ${j.error.message ?? 'error'}`);
    }
  }
  r ??= await new ReportStore(home).put(full);
  const answered = Object.keys(r.asks.answers ?? {}).length;
  return { json: { ok: true, via, ...r }, text: `report ${agent}/${project}: ${r.asks.put.length} asks, ${r.asks.dropped.length} dropped${answered ? `, ${answered} answered (see --json)` : ''} (${via})` };
}

/**
 * The session inventory, read-only on the app store. @req FR:session-inventory/cli.sessions
 */
function sessionsCmd(p: ReturnType<typeof parseArgs>): Outcome {
  if (p.positionals.length) throw new UsageError(`Unexpected argument: ${p.positionals[0]}`);
  const inv = runInventory({ home: stackHome() });
  const c = inv.counts;
  const lines = [`sessions: ${inv.total} (running ${c.running}, waiting ${c.waiting}, stuck ${c.stuck}, done ${c.done}, pinned ${c.pinned}, idle ${c.idle})`];
  if (inv.needsYou.length) lines.push('needs you:');
  inv.needsYou.forEach((s, i) => lines.push(`${i + 1}. [${s.project}] ${s.state} ${s.title} - ${s.ask ?? s.reason} ${s.link}`));
  lines.push(`archive candidates: ${inv.archive.length}`);
  return { json: { ok: true, ...inv }, text: lines.join('\n') };
}

/**
 * The owner priorities, or a one-time seed from markdown. @req FR:session-inventory/cli.pris @req FR:session-inventory/pris.seed.once
 */
async function prisCmd(p: ReturnType<typeof parseArgs>, ctxOf: () => LifecycleContext): Promise<Outcome> {
  const store = new PriStore(stackHome());
  const [sub, extra] = p.positionals;
  if (sub === 'link' || sub === 'note' || sub === 'gaps') return prisCos(store, sub, p, ctxOf);
  if (extra !== undefined || (sub !== undefined && sub !== 'seed')) throw new UsageError(`Unexpected argument: ${extra ?? sub}`);
  for (const k of ['projects', 'keywords', 'refs']) if (p.flags[k] !== undefined) throw new UsageError(`--${k} needs pris link`);
  if (sub === 'seed') {
    const file = flag(p.flags, 'file');
    if (!file) throw new UsageError('pris seed needs --file <md>');
    let r: { seeded: boolean; count: number };
    try { r = await store.seed(resolve(file)); } catch (e) {
      if (e instanceof PrisInvalid) throw e;
      // Any file-system error opening or reading --file is a usage error. @req FR:session-inventory/cli.pris
      if (['open', 'read'].includes(String((e as NodeJS.ErrnoException).syscall))) throw new UsageError(`Cannot read --file: ${file}`);
      throw e;
    }
    return { json: { ok: true, ...r }, text: r.seeded ? `seeded ${r.count} priorities` : `already seeded (${r.count} priorities)` };
  }
  const d = store.read();
  if (!d.pris.length) return { json: { ok: true, ...d }, text: 'no priorities (run: stack pris seed --file <md>)' };
  const lines = d.pris.flatMap((x, i) => [`${i + 1}. ${x.title} [${x.status}]`, ...x.items.map((it) => `   - ${it.text}${it.status === 'todo' ? '' : ` [${it.status}]`}`), ...(x.weekly[0] ? [`   week ${x.weekly[0].week}: ${x.weekly[0].text}`] : [])]);
  return { json: { ok: true, ...d }, text: lines.join('\n') };
}

/**
 * CoS commands: link terms, status notes, and gaps.
 * @req FR:pris-aware-ranking/cos.link @req FR:pris-aware-ranking/cos.note @req FR:pris-aware-ranking/cos.gaps.cli
 */
async function prisCos(store: PriStore, sub: 'link' | 'note' | 'gaps', p: ReturnType<typeof parseArgs>, ctxOf: () => LifecycleContext): Promise<Outcome> {
  const args = p.positionals.slice(1);
  const d = store.read();
  if (sub === 'gaps') {
    if (args.length) throw new UsageError(`Unexpected argument: ${args[0]}`);
    const ctx = ctxOf();
    const gaps = priGaps(d.pris, await priLinkCounts(ctx, d.pris), ctx.now?.() ?? new Date());
    return { json: { ok: true, gaps }, text: formatGaps(gaps) };
  }
  const [id, ...rest] = args;
  if (!id) throw new UsageError(`pris ${sub} needs <id>`);
  if (!d.pris.some((x) => x.id === id)) throw new UsageError(`Unknown priority: ${id}`);
  let next: Pri[];
  if (sub === 'link') {
    if (rest.length) throw new UsageError(`Unexpected argument: ${rest[0]}`);
    const lists: Partial<Record<(typeof PRI_LINKS)[number], string[]>> = {};
    for (const k of PRI_LINKS) {
      const v = p.flags[k];
      if (v === true) throw new UsageError(`--${k} needs a value (use "" to clear)`);
      if (v !== undefined) lists[k] = v.split(',').map((x) => x.trim()).filter(Boolean);
    }
    if (!Object.keys(lists).length) throw new UsageError('pris link needs --projects, --keywords or --refs');
    next = withLinks(d.pris, id, lists);
  } else {
    const text = rest.join(' ').trim();
    if (!text) throw new UsageError('pris note needs <text>');
    const nowFlag = flag(p.flags, 'now');
    const at = nowFlag ? new Date(nowFlag) : new Date();
    if (Number.isNaN(at.getTime())) throw new UsageError(`--now must be an ISO date: ${nowFlag}`);
    next = withNote(d.pris, id, text, at);
  }
  const w = await store.put(d.rev, next);
  const x = w.pris.find((y) => y.id === id)!;
  return { json: { ok: true, changed: true, rev: w.rev, pri: x }, text: sub === 'link' ? `${id} linked: ${PRI_LINKS.map((k) => `${k}=${(x[k] ?? []).join(',') || '-'}`).join(' ')}${PRI_LINKS.some((k) => x[k]?.length) ? '' : ' (no terms: automatic terms from the title apply)'}` : `${id} noted (${x.weekly[0].week})` };
}

/** A core ref as the api writes it (`<project>:<line>`, 0-based). */
const apiRef = (r: { path: string; line: number }) => `${basename(r.path).replace(/\.md$/, '')}:${r.line}`;

/** @req FR:agent-team/cli.agents */
async function agentsCmd(ctx: LifecycleContext, p: ReturnType<typeof parseArgs>): Promise<Outcome> {
  const f = p.flags;
  const [sub, slug, ...rest] = p.positionals;
  if (rest.length) throw new UsageError(`Unexpected argument: ${rest[0]}`);
  const s = (n: string) => flag(f, n);
  const list = (v: string | undefined) => (v === undefined ? undefined : v.split(',').map((x) => x.trim()).filter(Boolean));
  switch (sub) {
    case 'list': {
      if (slug) throw new UsageError(`Unexpected argument: ${slug}`);
      const team = await listTeam(ctx);
      const items = s('project') ? agentFor(team, s('project')!, s('section')) : team;
      return { json: { ok: true, items }, text: items.map((a) => `${a.slug}  ${a.name}  ${a.scope.join(',') || '-'}  ${a.reportsTo ?? '-'}${a.defined ? '' : '  (metadata only)'}`).join('\n') };
    }
    case 'add': {
      if (!slug) throw new UsageError('agents add needs a slug');
      const mode = s('mode');
      if (mode !== undefined && !(AGENT_MODES as readonly string[]).includes(mode)) throw new UsageError(`--mode must be one of ${AGENT_MODES.join(', ')}`);
      const pf = s('prompt-file');
      const r = await putAgent(ctx, slug, { name: s('name'), role: s('role'), scope: list(s('scope')), reportsTo: s('reports-to'), model: s('model'), tools: list(s('tools')), mode: mode as AgentMode | undefined, ...(pf ? { prompt: readFileSync(pf, 'utf8') } : {}) });
      return { json: { ok: true, ...r }, text: `${r.created ? 'added' : 'updated'} ${r.slug}` };
    }
    default: throw new UsageError('Usage: stack agents list|add (see stack --help)');
  }
}

/** The storage, config, and clock every command that touches the repo runs on. */
function buildCtx(f: Record<string, string | true>, dir: string): LifecycleContext {
  let storage: Storage;
  if (f['no-commit']) {
    storage = new FsStorage(dir);
  } else {
    // @req FR:cli/run.git.worktree
    if (!isWorkTree(dir)) throw new StorageError(`Not a git work tree: ${dir} (run \`stack init --dir ${dir}\`, or use --no-commit)`);
    storage = new GitStorage(dir, { remote: flag(f, 'remote'), branch: flag(f, 'branch') });
  }
  const nowFlag = flag(f, 'now');
  const at = nowFlag ? new Date(nowFlag) : undefined;
  if (at && Number.isNaN(at.getTime())) throw new UsageError(`--now must be an ISO date: ${nowFlag}`);
  return { storage, config: loadConfig(dir), now: () => at ?? new Date() };
}

/** Commands after which legacy ran `Update-StackSummary`. @req FR:cli/cmd.refresh */
const REFRESH = new Set(['start', 'complete', 'skip', 'resume', 'suspend', 'remove-completed', 'add-project']);

/** @req FR:cli/cmd.refresh @req FR:cli/cmd.refresh.skip @req FR:cli/cmd.refresh.json */
async function dispatch(cmd: string, p: ReturnType<typeof parseArgs>, dir: string): Promise<Outcome> {
  const o = await dispatchOne(cmd, p, dir);
  if (!REFRESH.has(canon(cmd)) || o.json.changed !== true || p.flags['no-update'] === true) return o;
  const ctx = buildCtx(p.flags, dir);
  const u = await update(ctx, ctx.storage, { sweep: true, queries: p.flags['queries'] === true });
  const { files, swept, queries } = u.json;
  return { ...o, json: { ...o.json, update: { files, ...(swept ? { swept } : {}), ...(queries ? { queries } : {}) } } };
}

async function dispatchOne(cmd: string, p: ReturnType<typeof parseArgs>, dir: string): Promise<Outcome> {
  const f = p.flags;
  if (cmd === 'init') return init(dir);
  const ctx = buildCtx(f, dir);
  const { storage } = ctx;
  const nowFlag = flag(f, 'now');
  const at = nowFlag ? new Date(nowFlag) : undefined;
  const ref = () => (p.positionals[0] ? { ...parseRef(p.positionals[0]), text: flag(f, 'expect') } : undefined);
  const extra = (n: number) => { if (p.positionals.length > n) throw new UsageError(`Unexpected argument: ${p.positionals[n]}`); };

  switch (cmd) {
    case 'add-project': {
      if (p.positionals.length === 0) throw new UsageError('add-project needs a name');
      const capacity: Record<string, number> = {};
      for (const part of (flag(f, 'capacity') ?? '').split(',').filter(Boolean)) {
        const m = /^(.+)=(\d+(?:\.\d+)?)$/.exec(part);
        if (!m) throw new UsageError(`--capacity expects Block=hours,...: ${part}`);
        capacity[m[1]] = Number(m[2]);
      }
      const r = await addProject(ctx, {
        name: p.positionals.join(' '), description: flag(f, 'description'), repositoryUrl: flag(f, 'repo'),
        aliases: flag(f, 'alias')?.split(',').map(a => a.trim()).filter(Boolean), priority: num(flag(f, 'priority'), 'priority'),
        capacity: Object.keys(capacity).length ? capacity : undefined, weeklyCapacity: num(flag(f, 'weekly-capacity'), 'weekly-capacity'),
        fileName: flag(f, 'file'), force: f['force'] === true,
      });
      return { json: { ok: true, changed: true, path: r.path }, text: `created ${r.path}` };
    }
    case 'add': {
      if (p.positionals.length < 2) throw new UsageError('add needs <project> <text...>');
      const parent = flag(f, 'parent');
      return describe('add', await addTask(ctx, {
        project: p.positionals[0], text: p.positionals.slice(1).join(' '), section: flag(f, 'section'), parent: parent ? parseRef(parent) : undefined,
      }));
    }
    // @req FR:quick-capture/cli.cmd
    case 'capture': {
      const text = p.positionals.join(' ').trim();
      if (!text) throw new UsageError('capture needs <text...>');
      try {
        const { result, spec } = await captureTask(ctx, text, { project: flag(f, 'project'), section: flag(f, 'section'), dryRun: f['dry-run'] === true });
        const o = describe('add', result);
        return result.changed ? { ...o, json: { ...o.json, spec } } : { json: { ok: true, changed: false, after: result.after, spec }, text: `would add ${taskText(result.after)}` };
      } catch (e) {
        if (e instanceof CaptureError) throw new UsageError(e.message);
        throw e;
      }
    }
    case 'next': {
      extra(0);
      // @req FR:cli/cmd.next
      const top = num(flag(f, 'top'), 'top');
      if (top !== undefined) {
        if (!Number.isInteger(top) || top < 1 || top > 50) throw new UsageError('--top must be a whole number from 1 to 50');
        const ranked = await rankStack(ctx, at, top);
        if (!ranked.length) return { json: { ok: true, changed: false, message: 'No active tasks available' }, text: '', code: EXIT.none };
        return {
          json: { ok: true, items: ranked.map((n) => ({ ref: { path: n.ref.path, line: n.ref.line + 1 }, score: n.score, project: n.project, text: n.text, ...(n.rule ? { rule: n.rule } : {}) })) },
          text: ranked.map((n) => `${formatRef(n.ref)} ${Number(n.score.toFixed(1))} ${n.project} ${n.text}`).join('\n'),
        };
      }
      const n = await nextTask(ctx, at);
      if (!n) return { json: { ok: true, changed: false, message: 'No active tasks available' }, text: '', code: EXIT.none };
      const score = Number(n.score.toFixed(1));
      return { json: { ok: true, ref: { path: n.ref.path, line: n.ref.line + 1 }, score: n.score, project: n.project, text: n.text }, text: `${formatRef(n.ref)} ${score} ${n.project} ${n.text}` };
    }
    case 'start': extra(1); return describe(cmd, await startTask(ctx, ref()));
    case 'complete': {
      extra(1);
      return describe(cmd, await completeTask(ctx, ref(), { summary: flag(f, 'summary'), remove: f['remove'] === true }));
    }
    case 'skip': case 'park': extra(1); return describe('skip', await skipTask(ctx, ref()));
    case 'resume': extra(1); return describe(cmd, await resumeTask(ctx, ref()));
    case 'suspend': {
      extra(1);
      return describe(cmd, await suspendTask(ctx, ref(), { days: num(flag(f, 'days'), 'days'), hours: num(flag(f, 'hours'), 'hours') }));
    }
    case 'set': {
      if (p.positionals.length !== 1) throw new UsageError('set needs exactly one <ref>');
      return describe(cmd, await setProperties(ctx, { ...parseRef(p.positionals[0]), text: flag(f, 'expect') }, props(f)));
    }
    // @req FR:auto-priority/tag.cli
    case 'tag': {
      if (p.positionals.length !== 1) throw new UsageError('tag needs exactly one <ref>');
      const u = flag(f, 'unblocker'), d = flag(f, 'due');
      if (u === undefined && d === undefined) throw new UsageError('tag needs --unblocker or --due');
      if (u !== undefined && u !== 'yes' && u !== 'no') throw new UsageError('--unblocker must be yes or no');
      return describe('set', await tagTask(ctx, { ...parseRef(p.positionals[0]), text: flag(f, 'expect') }, {
        ...(u !== undefined ? { unblocker: u === 'yes' } : {}), ...(d !== undefined ? { due: d.toLowerCase() === 'none' ? null : d } : {}),
      }));
    }
    // @req FR:auto-priority/explain.cli @req FR:auto-priority/truth.report
    case 'rank': {
      extra(0);
      const engine = flag(f, 'engine') ?? 'stack';
      if (engine !== 'autopri' && engine !== 'pris' && engine !== 'stack') throw new UsageError('--engine must be autopri, pris or stack');
      const explain = f['explain'] === true;
      if (explain && engine === 'stack') throw new UsageError('--explain needs --engine autopri or pris');
      if (flag(f, 'truth') !== undefined && !explain) throw new UsageError('--truth needs --explain');
      const top = num(flag(f, 'top'), 'top');
      if (top !== undefined && (!Number.isInteger(top) || top < 1 || top > 50)) throw new UsageError('--top must be a whole number from 1 to 50');
      registerAutopriEngine();
      // @req FR:pris-aware-ranking/explain.cli @req FR:pris-aware-ranking/explain.json
      const pris = engine === 'pris' ? new PriStore(stackHome()).read().pris : undefined;
      if (pris) { registerPrisEngine(); setPris(pris); }
      const rctx = { ...ctx, engine };
      if (explain) {
        const tf = flag(f, 'truth');
        let truth: string | undefined;
        if (tf !== undefined) { try { truth = readFileSync(resolve(tf), 'utf8'); } catch { throw new UsageError(`Cannot read --truth file: ${tf}`); } }
        const r = await explainAutopri(rctx, at, { top, truth, ...(pris ? { pris } : {}) });
        return { json: { ok: true, items: r.items, ...(r.truth ? { truth: r.truth } : {}) }, text: r.text, code: r.items.length ? EXIT.ok : EXIT.none };
      }
      const ranked = await rankStack(rctx, at, top);
      return {
        json: { ok: true, items: ranked.map((n) => ({ ref: { path: n.ref.path, line: n.ref.line + 1 }, score: n.score, project: n.project, text: n.text })) },
        text: ranked.map((n) => `${formatRef(n.ref)} ${Number(n.score.toFixed(1))} ${n.project} ${n.text}`).join('\n'), code: ranked.length ? EXIT.ok : EXIT.none,
      };
    }
    case 'triage': {
      if (p.positionals.length !== 1) throw new UsageError('triage needs exactly one <ref>');
      const r0 = parseRef(p.positionals[0]);
      const level = flag(f, 'autonomy');
      if (level !== undefined && !(AUTONOMY_LEVELS as readonly string[]).includes(level)) throw new UsageError(`--autonomy must be one of: ${AUTONOMY_LEVELS.join(' ')}`);
      const s = { agent: flag(f, 'agent'), human: flag(f, 'human'), priority: flag(f, 'priority'), effort: flag(f, 'effort'), impact: flag(f, 'impact') };
      const edits = Object.fromEntries(Object.entries(s).filter(([, v]) => v !== undefined));
      let changed = false;
      if (level !== undefined) changed = (await setAutonomy(ctx, r0, level as Autonomy)).changed;
      if (Object.keys(edits).length) changed = (await applyTriage(ctx, r0, edits, { actor: 'cli', owner: true })).changed || changed;
      const now = effectiveAutonomy((await storage.read(r0.path)).content, r0.line);
      return { json: { ok: true, changed, ref: { path: r0.path, line: r0.line + 1 }, autonomy: now }, text: `${formatRef(r0)} autonomy ${now}${changed ? ' (updated)' : ''}` };
    }
    case 'remove-completed': {
      extra(0);
      const r = await removeCompleted(ctx, { project: flag(f, 'project') });
      return { json: { ok: true, changed: r.removed > 0, removed: r.removed, files: r.files }, text: `removed ${r.removed}` };
    }
    case 'asks': return asksCmd(ctx, p);
    case 'agents': return agentsCmd(ctx, p);
    case 'inbox': {
      // @req FR:agent-inbox/cli.list
      if (p.positionals[0] === 'list') {
        extra(1);
        const state = flag(f, 'state');
        if (state !== undefined && !(INBOX_STATES as readonly string[]).includes(state)) throw new UsageError(`--state must be one of ${INBOX_STATES.join(', ')}`);
        const items = await listInbox(ctx, { project: flag(f, 'project'), state: state as (typeof INBOX_STATES)[number] | undefined });
        const rows = await currentRows(ctx, items);
        const out = items.map((e) => ({ ...e, ...(rows.has(e.id) ? { row: rows.get(e.id)! } : {}) }));
        return { json: { ok: true, items: out }, text: out.map((e) => `${e.id} ${e.kind} ${e.project} ${e.row ?? e.ref} ${e.text}`).join('\n') };
      }
      // @req FR:agent-inbox/cli.handle
      if (p.positionals[0] === 'handle') {
        if (!p.positionals[1]) throw new UsageError('inbox handle needs an id');
        extra(2);
        const r = await handleEntry(ctx, p.positionals[1], flag(f, 'from') ?? 'cli', flag(f, 'note'));
        return { json: { ok: true, ...r }, text: r.changed ? 'handled' : 'unchanged' };
      }
      // @req FR:agent-thread/reply.entry
      if (p.positionals[0] !== 'reply') throw new UsageError('Usage: stack inbox reply <ref> --from <agent> --text t | list | handle <id>');
      if (!p.positionals[1]) throw new UsageError('inbox reply needs a ref');
      extra(2);
      const from = flag(f, 'from'); const text = flag(f, 'text');
      if (!from) throw new UsageError('inbox reply needs --from <agent>');
      if (!text) throw new UsageError('inbox reply needs --text');
      const r = await replyFromAgent(ctx, parseRef(p.positionals[1]), text, from, flag(f, 'expect'));
      return { json: { ok: true, ...r }, text: r.id };
    }
    case 'email': return emailCmd(ctx, p.positionals[0], p.flags, { repo: dir });
    case 'update': {
      extra(0);
      const engine = f['engine'] === true ? '' : flag(f, 'engine'); // a bare --engine is an error, not the default
      if (engine !== undefined && engine !== 'legacy' && engine !== 'stack') throw new UsageError('--engine must be legacy or stack');
      return update(ctx, storage, { sweep: f['sweep'] === true, queries: f['queries'] === true, engine: engine as 'legacy' | 'stack' | undefined });
    }
    default: throw new UsageError(`Unknown command: ${cmd}`);
  }
}

/**
 * The report store for `stack web`: demo keeps reports beside the demo copy, never in live state; live uses the default store (undefined).
 * @req FR:status-ingest/host.demo
 */
export function webReportStore(live: boolean, home: string): ReportStore | undefined {
  return live ? undefined : new ReportStore(join(home, '.config/stack/demo-state'));
}

/**
 * `stack web`: the real server when a repo is known, else the first-run setup server; setup restarts it on the same port.
 * @req FR:cli/web.@cli @req FR:cli/web.serve @req FR:cli/web.demo @req FR:cli/web.live @req FR:first-run-onboarding/host.setup
 */
async function web(f: Record<string, string | true>, io: IO, here: { dir: string; by: string } | null, home: string): Promise<number> {
  const port = num(flag(f, 'port'), 'port') ?? 4173;
  const webDir = join(__dirname, '../../web/dist');
  if (!existsSync(join(webDir, 'index.html'))) throw new StorageError(`Web app not built (${webDir}). Run: pnpm build`);
  // --repo, then --dir or the current folder, then env, then user config; config is read again on every restart (setup writes it).
  const spec = () => { const c = userConfig(home); return flag(f, 'repo') ?? here?.dir ?? process.env.STACK_REPO ?? process.env.STACK_DIR ?? c.repo ?? c.dir; };
  // What wins over setup: the flow shows these as fixed instead of saving a choice that would not apply. @req FR:first-run-onboarding/step.repo @req FR:first-run-onboarding/step.mode
  const locks = (): Locks => ({ repo: flag(f, 'repo') ? '--repo' : here?.by, mode: f['live'] === true ? '--live' : undefined });
  let reset = f['reset'] === true;
  const startReal = async (p: number, setup: SetupHandler) => {
    const cfg = userConfig(home);
    const repo = resolveRepo(spec()!, join(home, '.config/stack/clones'));
    const live = f['live'] === true || cfg.mode === 'live';
    let target: string; let info: RepoInfo; let label: string; let storage: BatchedGitStorage | undefined;
    if (live) {
      // @req FR:cli/web.live @req FR:cli/web.batch @req FR:cli/web.batch.idle @req FR:cli/web.batch.zero
      if (cfg.batch !== undefined && (typeof cfg.batch !== 'number' || !Number.isFinite(cfg.batch) || cfg.batch < 0)) throw new UsageError('user config "batch" must be a number of minutes, 0 or more');
      const minutes = num(flag(f, 'batch'), 'batch') ?? cfg.batch ?? 5;
      if (minutes < 0) throw new UsageError('--batch must be 0 or more minutes');
      const l = prepareLive(repo, flag(f, 'branch') ?? cfg.branch, flag(f, 'remote') ?? cfg.remote); // flags win over user config, as for branch and batch
      target = l.dir;
      info = { mode: 'live', repo: redact(repo), branch: l.branch };
      label = `LIVE - ${repo} on ${l.branch}`;
      storage = new BatchedGitStorage(target, { idleMs: minutes * 60_000, remote: l.remote, branch: l.branch, onError: (e) => io.err(`error: commit failed, edits kept and retried: ${e instanceof Error ? e.message : String(e)}\n`) });
      io.out(`${liveLine(repo, l.branch, minutes, l.remote)}\n`);
    } else {
      target = join(home, '.config/stack/demo');
      prepareDemo(repo, target, reset);
      reset = false; // --reset once, not on every setup restart
      info = { mode: 'demo', repo: redact(repo), branch: 'main' };
      label = `DEMO COPY of ${repo} - edits stay in the copy`;
      io.out(`DEMO MODE: serving a COPY of ${repo}\nEdits stay in ${target}; the real repo is never touched. Reset: stack web --reset. Real data: stack web --live\n`);
    }
    // Demo never touches live state (~/.stack): its reports stay beside the demo copy. @req FR:status-ingest/host.demo
    const reports = webReportStore(live, home);
    const ics = (cfg as { ics?: unknown }).ics; // @req FR:first-run-onboarding/step.calendar
    // Demo reads no session store and keeps priorities beside the demo copy. @req FR:status-ingest/host.demo
    const demoLive = live ? {} : { inventory: false as const, pris: new PriStore(join(home, '.config/stack/demo-state')) };
    const server = await startWeb({ dir: target, port: p, webDir, label, info, storage, setup, ...(typeof ics === 'string' ? { ics } : {}), ...(reports ? { reports } : {}), ...demoLive });
    return { server, dir: target };
  };
  const s = await runLocal({ port, home, env: process.env, webDir, spec, locks, startReal, log: (l) => io.out(`${l}\n`) });
  io.out(`Stack web: ${s.url}  (${spec() ? 'Ctrl+C to stop' : 'first run: finish setup in the browser; Ctrl+C to stop'})\n`);
  await new Promise<void>((ok) => { process.once('SIGINT', ok); process.once('SIGTERM', ok); });
  await s.close();
  return EXIT.ok;
}

function exitCodeFor(e: unknown): number {
  if (e instanceof UsageError || e instanceof LifecycleError || e instanceof NotFoundError || e instanceof PathError || e instanceof ReportInvalid || e instanceof PrisInvalid) return EXIT.usage;
  if (e instanceof ConflictError) return EXIT.conflict;
  return EXIT.failure;
}

/**
 * Runs the CLI and returns the exit code (never exits the process).
 * @req FR:cli/run.@function @req FR:cli/run.dir @req FR:cli/run.help @req FR:cli/out.text @req FR:cli/out.json @req FR:cli/out.quiet @req FR:cli/out.codes
 */
export async function run(argv: string[], io: IO = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) }): Promise<number> {
  let json = argv.includes('--json') && !argv.includes('--');
  let command: string | undefined;
  try {
    const p = parseArgs(argv);
    json = p.flags['json'] === true;
    // @req FR:cli/run.help.version
    if (p.flags['version']) { io.out(`${pkgVersion()}\n`); return EXIT.ok; }
    if (p.flags['help'] || !p.command) { io.out(`${helpText()}\n`); return EXIT.ok; }
    const spec = COMMANDS[p.command];
    if (spec) command = canon(p.command);
    if (!spec) throw new UsageError(`Unknown command: ${p.command}`);
    for (const k of Object.keys(p.flags)) if (!GLOBAL.includes(k) && !spec.flags.includes(k)) throw new UsageError(`Unknown option for ${p.command}: --${k}`);
    const home = homedir();
    const explicit = flag(p.flags, 'dir');
    const found = explicit ? null : findStackDir({ cwd: process.cwd(), env: process.env, home });
    const dir = resolve(explicit ?? found ?? process.cwd());
    // Only --dir or the current folder is fixed at startup; env and user config are read on every setup restart.
    if (p.command === 'web') { const up = walkStackDir(process.cwd()); return await web(p.flags, io, explicit ? { dir: explicit, by: '--dir' } : up ? { dir: up, by: 'the current folder' } : null, home); }
    if (p.command === 'graph') return await graphCmd(p.positionals[0], p.flags, io, json);
    if (p.command === 'agent') return await agentCmd(p.positionals, p.flags, io, json, () => buildCtx(p.flags, dir));
    // A report is live state for the host's store, not the content repo: it needs no repo. @req FR:status-ingest/cli.report
    // Live state under ~/.stack needs no content repo. @req FR:session-inventory/cli.sessions @req FR:session-inventory/cli.pris
    const r = p.command === 'report' ? await reportCmd(p, io.in ?? readStdin) : p.command === 'sessions' ? sessionsCmd(p) : p.command === 'pris' ? await prisCmd(p, () => buildCtx(p.flags, dir)) : await dispatch(p.command, p, dir);
    if (json) io.out(`${JSON.stringify(r.json)}\n`);
    else if (r.text) io.out(`${r.text}\n`);
    return r.code ?? EXIT.ok;
  } catch (e) {
    const code = exitCodeFor(e);
    const msg = e instanceof Error ? e.message : String(e);
    if (json) io.out(`${JSON.stringify({ ok: false, ...(command ? { command } : {}), error: msg, code, ...(e instanceof ReportInvalid ? { issues: e.issues } : {}) })}\n`);
    else io.err(`error: ${msg}\n`);
    return code;
  }
}
