/**
 * Command dispatch for the `stack` CLI.
 * @req FR:cli/run.git @req FR:cli/run.nocommit @req FR:cli/run.remote @req FR:cli/run.now @req FR:cli/ref.default
 * @req FR:ai-triage-assist/cli.triage @req FR:cli/cmd.add-project @req FR:cli/cmd.add @req FR:cli/cmd.next @req FR:cli/cmd.start @req FR:cli/cmd.complete @req FR:cli/cmd.skip
 * @req FR:cli/cmd.resume @req FR:cli/cmd.suspend @req FR:cli/cmd.set @req FR:cli/cmd.remove-completed @req FR:cli/cmd.update @req FR:cli/ref.expect @req FR:cli/arch.thin @req FR:cli/arch.storage
 */
import { execFileSync } from 'child_process';
import { existsSync, realpathSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { getDefaults, loadConfig } from '../core/config';
import {
  addProject, addTask, completeTask, LifecycleContext, LifecycleError, LifecycleResult, nextStep,
  dailyGoal, dayPris, explainAutopri, explainStack, priLinkCounts, rankStack, removeCompleted, resumeTask, setProperties, skipTask, startTask, suspendTask, sweep, tagTask, TaskProps,
} from '../core/lifecycle';
import { parseProject } from '../core/parser';
import { checkTask } from '../core/quality';
import { formatCount, formatIssue, isError, lintProject, lintRow, lintTitle, type LintIssue } from '../core/task-lint';
import { archiveAsks, ASK_KINDS, ASK_PRIORITIES, envLink, handleAsk, importAsks, listAsks, putAsk, replyAsk, type AskPut, type HandleInput, LIST_STATES } from '../core/asks';
import { pidAlive, readHostFile, ReportInvalid, ReportStore, stackHome } from '../core/reports';
import { defaultSessionsDir, runInventory } from '../core/session-inventory';
import { lintAgents, readFolderAgents, type LocalSession } from '../core/goal-model';
import { PRI_LINKS, PrisInvalid, PriStore, type Pri } from '../core/pris';
import { PrPriConflict, PrPriInvalid, PrPriNotFound, PrPriorityStore } from '../core/pr-priority';
import { PR_PRI_USAGE, prPriArgv, prPriCmd } from './pr-pri';
import { formatGaps, priActions, priGaps, registerPrisEngine, setPris, withLinks, withNote, type PriAction } from '../core/pris-rank';
import { AGENT_MODES, agentFor, listTeam, putAgent, type AgentMode } from '../core/agents';
import { addNote, retitleTask } from '../api/edit';
import { currentRows, handleEntry, INBOX_STATES, listInbox, replyFromAgent } from '../core/inbox';
import { registerAutopriEngine } from '../core/autopri';
import { captureTask, CaptureError } from '../core/quick-capture';
import { FeedbackError, FeedbackStore } from '../core/feedback';
import { AUTONOMY_LEVELS, type Autonomy } from '../core/model';
import { applyTriage, effectiveAutonomy, setAutonomy } from '../core/triage';
import { createGhClient, refreshQueryTasks } from '../core/query-tasks';
import { ConflictError, FsStorage, NotFoundError, PathError, Storage, StorageError, writeAll, type AuxFiles } from '../core/storage';
import { PRIORITIES_PATH } from '../core/priorities';
import { GitStorage } from '../core/storage-git';
import { doctorCmd } from './doctor';
import { generateSummaries } from '../core/summaries';
import { isReadme, projectId, projectPath } from '../core/task-paths'; // @req FR:task-structure/tree.readme
import { assignIds, lintIds, moveProject } from '../core/task-ids';
import { formatRef, parseArgs, parseRef, UsageError } from './args';
import { inboxSourcesCmd } from './inbox-sources';
import { inboxRunCmd } from './delivery';
import { emailCmd } from './email';
import { agentCmd } from './agent';
import { graphCmd } from './graph';
import { prsCmd } from './prs';
import { liveDeps, prioritiesCmd } from './priorities';
import { appCmd, realAppDeps } from './app';
import { findStackDir, userConfig, walkStackDir } from './discover';
import { devicesCmd } from './devices';
import { bindMode } from './tailnet';
import { liveLine, redact, prepareDemo, prepareLive, resolveRepo, startWeb, type RepoInfo } from './web';
import { runLocal, type Locks, type SetupHandler } from './setup';
import { BatchedGitStorage } from '../core/storage-batch';
import { liveCmd, liveExit } from './pr-review';
import { LiveError } from '../core/live-lane';
import { BriefInvalid } from '../core/pr-review';
import { QmInvalid, QmStore, type QmPlan } from '../core/qm-plan';
import { homedir } from 'os';
import { scanAgents } from '../core/agent-scan';
import { projectRepos } from '../core/repos';

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
/** `summary` (60 characters or less) is the command-list line when `help` is longer. @req FR:cli/run.help.short */
const COMMANDS: Record<string, { flags: string[]; usage: string; help: string; summary?: string }> = {
  init: { flags: [], usage: 'init', help: 'create repo, tasks/, and config' },
  'add-project': { flags: ['description', 'repo', 'alias', 'priority', 'capacity', 'weekly-capacity', 'file', 'force', 'queries', 'no-update'], usage: 'add-project <name> [--description t] [--repo url] [--alias a,b] [--priority n] [--capacity Block=h,..] [--weekly-capacity n] [--file name] [--force] [--queries] [--no-update]', help: 'create a project file' },
  add: { flags: ['section', 'parent'], usage: 'add <project> <text...> [--section name] [--parent ref]', help: 'add a task' },
  capture: { flags: ['project', 'section', 'dry-run'], usage: 'capture <text...> [--project name] [--section name] [--dry-run]', help: 'add a task from a phrase (e.g. "call dentist tomorrow 30m #alpha")', summary: 'add a task from a phrase' },
  next: { flags: ['top', 'daily'], usage: 'next [--top n | --daily]', help: 'print the top task, or the first n ranked tasks (1-50); priority actions come first; --daily lists each project with its pick and done today; the web Home and /next use the same order', summary: 'print the top ranked task, or the first n' },
  start: { flags: ['expect', 'queries', 'no-update'], usage: 'start [ref] [--expect t] [--queries] [--no-update]', help: 'mark in progress' },
  complete: { flags: ['summary', 'remove', 'expect', 'queries', 'no-update'], usage: 'complete [ref] [--summary t] [--remove] [--expect t] [--queries] [--no-update]', help: 'check off (rolls recurring rows)' },
  skip: { flags: ['expect', 'queries', 'no-update'], usage: 'skip [ref] [--expect t] [--queries] [--no-update]', help: 'park a task (alias: park)' },
  park: { flags: ['expect', 'queries', 'no-update'], usage: 'park [ref] [--expect t] [--queries] [--no-update]', help: 'same as skip' },
  resume: { flags: ['expect', 'queries', 'no-update'], usage: 'resume [ref] [--expect t] [--queries] [--no-update]', help: 'unpark the first parked task' },
  suspend: { flags: ['days', 'hours', 'expect', 'queries', 'no-update'], usage: 'suspend [ref] [--days n | --hours n] [--expect t] [--queries] [--no-update]', help: 'hide until later' },
  set: { flags: ['status', 'priority', 'effort', 'impact', 'checkbox', 'suspend', 'remove-emojis', 'expect'], usage: 'set <ref> [--status e] [--priority e] [--effort e] [--impact e] [--checkbox complete|incomplete] [--suspend v] [--remove-emojis] [--expect t]', help: 'set emojis and checkbox' },
  retitle: { flags: ['text', 'expect', 'no-update'], usage: 'retitle <ref> --text t [--expect t] [--no-update]', help: 'edit a task row text in place (checkbox, indent, children, notes, and marks stay)', summary: 'edit a task row text in place' },
  lint: { flags: ['project'], usage: 'lint [--project name] [--json]', help: 'the task bloat lint on open rows: one <path>:<line> <rule> <message> line per issue (title-length, title-status, title-parens, detail-nesting, id-duplicate, id-dangling, id-slug, meta-emoji, meta-key, note-status); exit 1 on an error rule, else 0 (note-status, meta-key, meta-emoji only warn); read-only (docs/task-rubric.md)', summary: 'fail on bloated task rows' },
  ids: { flags: ['project', 'dry-run'], usage: 'ids assign [--project id] [--dry-run]', help: 'add a "> id: <slug>" line under each task row that has none (task ID T:<project>.<slug>); keeps every other byte; one commit', summary: 'give every task a readable ID' },
  mv: { flags: ['dry-run'], usage: 'mv <from-id> <to-id> [--dry-run]', help: 'move a project file with its logs and inbox, and rewrite every T:, path, and ref: line that names it; one commit', summary: 'move a project and rewrite its refs' },
  check: { flags: [], usage: 'check <ref> [--json]', help: 'the task quality gate: score 0-4 and the missing checks (next, doneWhen, context, single), plus the task lint on the row; exit 0 at 4 with no lint issue, else 1; read-only (docs/task-rubric.md)', summary: 'score one task on the quality gate (read-only)' },
  note: { flags: ['text', 'expect'], usage: 'note add <ref> --text t [--expect t]', help: 'append a nested note bullet under a task (children stay)' },
  tag: { flags: ['unblocker', 'due', 'expect'], usage: 'tag <ref> [--unblocker yes|no] [--due "MMM d"|none] [--expect t]', help: 'set the 🔓 unblocker and 📅 due tags the autopri engine reads', summary: 'set the 🔓 unblocker and 📅 due tags' },
  rank: { flags: ['engine', 'explain', 'truth', 'top', 'daily'], usage: 'rank [--engine autopri|pris|stack] [--top n] [--explain [--truth file]] [--daily]', help: 'ranked tasks the owner must do (agent rows are left out); pris boosts tasks linked to ~/.stack/pris.json by priority order; --explain shows why each task has its place (stack: due tier, stale; autopri, pris: score parts and the priority served); --truth lists ground-truth items to tag or add; --daily lists each project with its pick and done today', summary: 'ranked tasks the owner must do, and why' },
  triage: { flags: ['autonomy', 'agent', 'human', 'priority', 'effort', 'impact'], usage: 'triage <ref> [--autonomy none|triage|assist|full] [--agent t] [--human t] [--priority e] [--effort e] [--impact e]', help: 'show/set autonomy, add 🪄/🙋 subtasks' },
  'remove-completed': { flags: ['project', 'queries', 'no-update'], usage: 'remove-completed [--project name] [--queries] [--no-update]', help: 'delete checked rows' },
  web: { flags: ['port', 'repo', 'live', 'branch', 'batch', 'reset', 'bind'], usage: 'web [--repo path-or-url] [--live] [--branch name] [--remote name] [--batch minutes] [--port n] [--reset] [--bind loopback|tailnet]', help: 'serve the web app on localhost (demo copy by default; --live edits your checkout, committed in batches; --bind tailnet also serves paired devices on your Tailscale addresses)', summary: 'serve the web app on localhost' },
  devices: { flags: [], usage: 'devices add <name> | list | revoke <id>', help: 'pair a phone with the tailnet host (docs/phone-access.md); add prints a one-time pairing code', summary: 'pair a phone with the tailnet host' },
  asks: { flags: ['ask', 'kind', 'from', 'agent', 'text', 'project', 'why', 'recommend', 'options', 'default', 'by', 'reversible', 'link', 'priority', 'effort', 'blocks', 'detail-file', 'reopen', 'state', 'outcome', 'note', 'reply', 'limit', 'days', 'flow', 'seq', 'ref', 'apply', 'applies', 'dry-run'], usage: 'asks put <key> --ask t --kind k --from agent --why t [--agent "[Name](#local_id)" --project --recommend --options "A|B" --default --by --reversible yes|no --link --priority --effort --blocks --detail-file p --reopen --flow slug --seq n --ref project:line|tasks/<file>.md:<line> --apply "<action>" --applies "a|b"] | reply <key> --from agent --text t | list [--state s] | handle <key> --outcome o [--note --reply] | archive [--days n] | import [--dry-run]', help: 'ask queue for the owner (nested 🙋 task rows): agents put and handle asks; archive deletes old done ask rows; import turns open ask files into rows once', summary: 'the ask queue for the owner' },
  email: { flags: ['account', 'mode', 'max', 'dry-run', 'offline', 'fixture', 'extra', 'project', 'all'], usage: 'email run [--all] [--mode observe|drafts] [--max n] [--dry-run [--offline] [--fixture f.json]] [--project p] | voice [--extra file.json] | status [--account a] | schedule [--remote origin]', help: 'one triage pass on the signed-in mailbox (asks, drafts only, inbox-zero batches), learn your writing voice, or show status; never sends mail', summary: 'one triage pass on the mailbox; never sends mail' },
  graph: { flags: ['client-id', 'tenant', 'with', 'cache', 'account'], usage: 'graph login --client-id <id> [--tenant t] [--account addr] [--with calendar,mail,drafts] [--cache path] | status | logout', help: 'sign in to Microsoft Graph (device code) for the live calendar and mail; read-only scopes', summary: 'sign in to Microsoft Graph for calendar and mail' },
  inbox: { flags: ['from', 'text', 'expect', 'project', 'state', 'note', 'all', 'once', 'watch', 'agent'], usage: 'inbox reply tasks/<file>.md:<line> --from <agent> --text t [--expect t] | list [--project p] [--agent slug] [--state open|handled|all] [--all] [--json] | handle <id> [--note t] [--from <agent>] | run [--project p] [--once|--watch] [--json] | sources [--json]', help: 'reply on a task as an agent (tasks/.stack/inbox, from: agent), list the owner\'s open instructions, mark one handled (docs/agent-instructions.md), deliver open messages to their agents (claude -p), or show each inbox source and how to connect it', summary: 'agent replies, owner instructions, and inbox sources' },
  agent: { flags: ['prompt', 'cwd', 'timeout'], usage: 'agent run <command> [args...] --prompt t [--cwd dir] [--timeout s]', help: 'run one prompt on an ACP agent (e.g. gemini -- --acp); permission requests become asks; never auto-allows', summary: 'run one prompt on an ACP agent' },
  agents: { flags: ['project', 'section', 'name', 'role', 'scope', 'reports-to', 'model', 'mode', 'tools', 'prompt-file'], usage: 'agents list [--project p --section s] | add <slug> --name n --scope a,b [--role r --reports-to a --model m --mode long-running|ad-hoc --tools a,b --prompt-file p]', help: 'the team: tasks/.stack/agents/<slug>.md, .claude/agents/<slug>.md, and project Agents lines', summary: 'list or add team agents' },
  report: { flags: ['agent', 'project', 'file'], usage: 'report --agent <name> --project <p> [--file report.json] [--json]', help: 'send an agent status report (JSON on stdin or --file; docs/report.md) to the running host, or write ~/.stack/reports.json directly; never git', summary: 'send an agent status report to the host' },
  prs: { flags: ['group', 'project', 'sort'], usage: 'prs [--group g] [--project p] [--sort spec-lines] [--json]', help: 'open PRs you review or move (--sort spec-lines: no Autopilot rows, fewest spec lines first, 🔬 = needs live validation), by group (blocked, waiting, processing, pending, paused) with who must act; uses GITHUB_TOKEN or the gh sign-in', summary: 'open PRs you review or move, by group' },
  qm: { flags: ['file'], usage: 'qm [--json] | qm put --file plan.json [--json]', help: 'the weekly QM (quota-maxxing) plan (~/.stack/qm-plan.json, never git; schema in .xe/features/qm-plan/spec.md); agents write it with put', summary: 'the weekly QM (quota-maxxing) plan' },
  feedback: { flags: ['route', 'since'], usage: 'feedback add "<text>" [--route r] | list [--since id] | done <id>', help: 'owner feedback on the app (~/.stack/feedback.jsonl, one JSON line each; docs/feedback.md); done writes feedback.done.jsonl', summary: 'owner feedback on the app' },
  sessions: { flags: [], usage: 'sessions [--json]', help: 'Claude app sessions: counts, ranked Needs you (waiting, stuck) with claude:// links, archive candidates; read-only, cached in ~/.stack/sessions.json', summary: 'Claude app sessions and what needs you' },
  priorities: { flags: [], usage: 'priorities [--json]', help: 'the owner priorities report as markdown: QM (per project), Now (top 3), PRs (live, quickest first), Today, Next 3 days; project rows show project, agent, agent status and the owner next action from tiered tasks (⭐️, or 1️⃣ 2️⃣ 3️⃣, with (agent: ...)) in tasks/*.md; a priority with no tiered task shows a gap; each section is stamped as of its last live check (stale after 30 min); read live from ~/.stack/pris.json, the task files, the session store and GitHub', summary: 'the owner priorities report as markdown' },
  pris: { flags: ['file', 'projects', 'keywords', 'refs'], usage: 'pris [--json] | pris seed --file <md> | pris put --file <json> | pris link <id> [--projects a,b] [--keywords a,b] [--refs a,b] | pris note <id> <text> | pris gaps', help: 'the owner priorities in order (~/.stack/pris.json); seed runs once; put replaces the list (slot and days set the order of each weekday); link sets the terms that link tasks; note records status; gaps lists priorities with no status, stale status (>7 days) or no linked tasks', summary: 'the owner priorities in order' },
  'pr-pri': { flags: ['rank', 'to', 'to-rank', 'note', 'rev', 'agent', 'reason', 'thread', 'on', 'remove', 'file', 'refresh'], usage: PR_PRI_USAGE, help: 'the PR priority queue the Sweep Manager works top down (~/.stack/pr-priority.json, never git): owner edits, agent recommendations, owner decisions, merge-order edges, thread acks, the escalation set; see docs/pr-priority.md', summary: 'the PR priority queue for the Sweep Manager' },
  app: { flags: ['check', 'install', 'no-build', 'source'], usage: 'app install [--no-build] | update [--check | --install] [--no-build] | status [--source dir]', help: 'build Stack.app from the source checkout (STACK_SOURCE or ~/.local/share/stack) and install or update it in /Applications; update never quits a running app unless --install (docs/desktop-install.md)', summary: 'build and install or update Stack.app' },
  live: { flags: ['agent', 'worktree', 'url', 'port', 'pid', 'file', 'text', 'reason', 'by', 'offline'], usage: 'live [next [ref] [--agent a --worktree p --offline] | ready <ref> --url u --pid n [--port n --worktree p] | state <ref> preparing|working | checklist <ref> --file items.json [--agent a] | item add|check|uncheck|fail|needs-fix|fixed|block|comment|edit <ref> [id] [--text t --reason r --by b] | resolve <ref> [--reason merged|closed|done]]', help: 'the live validation lane: one PR at a time, a checklist, the shared server lock; docs/live-validation-agent.md; never touches GitHub threads', summary: 'the live validation lane: one PR at a time' },
  doctor: { flags: [], usage: 'doctor [--remote name] [--json]', help: 'health checks: how the task store branch stands against main on the remote (default origin): ok, behind, or out of sync with the conflicting files; read-only; exit 1 when out of sync', summary: 'health checks (task store drift against main)' },
  update: { flags: ['sweep', 'queries', 'engine'], usage: 'update [--sweep] [--queries] [--engine legacy|stack]', help: 'regenerate README, stack, projects, my-day (default stack: scores and order like `stack next`, with .stack/priorities.json; --engine legacy: the PowerShell output)', summary: 'regenerate README, stack, projects, and my-day' },
};

interface Outcome { json: Record<string, unknown>; text: string; code?: number; /** Lines for stderr. */ err?: string }

/**
 * Every lint issue in `tasks/`, or in one project file.
 * @req FR:task-lint/cli.lint
 * @req FR:task-lint/cli.lint.unknown
 */
/** The sessions on this machine, or null when the session store cannot be read (the dead-link check is then skipped). @req FR:goal-model/lint.dead */
function localSessions(): LocalSession[] | null {
  try {
    if (!existsSync(defaultSessionsDir())) return null;
    return runInventory({ home: stackHome() }).sessions.map((s) => ({ id: s.id, ...(s.cli ? { cli: s.cli } : {}) }));
  } catch { return null; }
}

async function lintFiles(storage: Storage, project?: string, dir?: string): Promise<LintIssue[]> {
  const paths = (await storage.list()).filter((p) => !isReadme(p) && (project === undefined || p === projectPath(project)));
  if (project !== undefined && !paths.length) throw new UsageError(`Project not found: ${project}`);
  const out: LintIssue[] = [];
  for (const p of paths) out.push(...lintProject(p, (await storage.read(p)).content));
  // ID lint reads every file (refs cross files) and reports on the linted ones. @req FR:task-ids/lint.duplicate @req FR:task-ids/lint.dangling
  const all = await Promise.all((await storage.list()).filter((p) => !isReadme(p)).map(async (path) => ({ path, content: (await storage.read(path)).content })));
  out.push(...lintIds(all, new Set(paths)));
  // @req FR:goal-model/lint.lead @req FR:goal-model/lint.duplicate @req FR:goal-model/lint.dead @req FR:goal-model/lint.agent-def
  // Agent lint: goal files and folder defaults; repo paths and the session list are local reads (no network).
  const folders = [...(await readFolderAgents(storage, all.map((f) => f.path)))].map(([path, content]) => ({ path, content }));
  const files = [...all, ...folders];
  const linked = files.some((f) => /\]\(#local_/.test(f.content));
  out.push(...lintAgents(files, {
    only: new Set([...paths, ...(project === undefined ? folders.map((f) => f.path) : [])]),
    ...(dir ? { exists: (p: string) => existsSync(join(dir, p)) } : {}),
    sessions: linked ? localSessions() : null,
  }));
  return out.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : a.line - b.line));
}

/**
 * Refuses a new title that breaks a title rule; the error names the rubric, which states the rules.
 * @req FR:task-lint/cli.write
 * @req FR:task-lint/docs.rubric
 * @req FR:task-lint/docs.cli
 */
function assertTitle(text: string): void {
  const bad = lintTitle(text);
  if (bad.length) throw new LifecycleError(`The title fails the task lint (docs/task-rubric.md):\n${bad.map((b) => `  ${b.rule} ${b.message}`).join('\n')}`);
}

const VERBS: Record<string, string> = {
  start: 'started', complete: 'completed', skip: 'skipped', park: 'skipped', resume: 'resumed', suspend: 'suspended', set: 'set', add: 'added', retitle: 'retitled',
};

const taskText = (line: string | undefined): string => (line ?? '').replace(/^\s*- \[[ xX]\] ?/, '');
const flag = (f: Record<string, string | true>, n: string): string | undefined => (typeof f[n] === 'string' ? (f[n] as string) : undefined);
/** The `--now` clock, or undefined for the real one. */
function nowOf(f: Record<string, string | true>): Date | undefined {
  const v = flag(f, 'now');
  if (v === undefined) return undefined;
  const at = new Date(v);
  if (Number.isNaN(at.getTime())) throw new UsageError(`--now must be an ISO date: ${v}`);
  return at;
}

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

const CLI_DOCS = 'https://github.com/Xerilium/stack/blob/main/docs/cli.md';

/** The command list: one short line per command. @req FR:cli/run.help @req FR:cli/run.help.short @req FR:cli/run.help.width */
function helpText(): string {
  const lines = ['Usage: stack <command> [options]', '', 'Commands:'];
  for (const [n, c] of Object.entries(COMMANDS)) if (n !== 'park') lines.push(`  ${n.padEnd(17)} ${c.summary ?? c.help}`);
  lines.push('', 'Run stack <command> --help or stack help <command> for its flags.', `Docs: ${CLI_DOCS}`);
  lines.push('global: --dir <path> --json --no-commit --remote <name> --branch <name> --now <ISO>');
  lines.push('refs: tasks/<file>.md:<line> (1-based). exit: 0 ok, 1 failure, 2 usage, 3 conflict, 4 nothing to do');
  return lines.join('\n');
}

/** One command: usage, full help, and its docs anchor. @req FR:cli/run.help.cmd */
function commandHelp(name: string): string {
  const c = COMMANDS[name];
  return `Usage: stack ${c.usage}\n\n${c.help}\n\nSee ${CLI_DOCS}#${name}`;
}

/** Edit distance, for the "Did you mean" hint. */
function distance(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = row;
  }
  return prev[b.length];
}

/** A short typo has few letters to go on, so the hint allows at most half the typed length. @req FR:cli/run.help.unknown @req FR:cli/run.help.near */
function unknownCommand(name: string): UsageError {
  const max = Math.min(2, Math.floor(name.length / 2));
  const near = [...Object.keys(COMMANDS), 'help'].map((c) => ({ c, d: distance(name, c) })).filter((x) => x.d <= max).sort((a, b) => a.d - b.d)[0];
  return new UsageError(`Unknown command: ${name}. Run stack --help to see commands.${near ? ` Did you mean: ${near.c}?` : ''}`);
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

/** @req FR:cli/cmd.init @req FR:cli/cmd.init.out @req FR:cli/cmd.init.json */
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
  return { json: { ok: true, dir, created: made }, text: made.length ? `Initialized ${dir}: ${made.join(' ')}` : `Already initialized: ${dir}` };
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
    ...(r.ref ? { project: projectId(r.ref.path) } : {}),
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
  for (const p of (await storage.list()).filter((x) => !isReadme(x))) projects.push({ fileName: p.replace(/^tasks\//, ''), content: (await storage.read(p)).content });
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
      // @req FR:ask-routing/addr.env: the session that writes the ask is the one that waits for the answer.
      const agent = s('agent') ?? envLink(input.from!, process.env);
      if (agent) input.agent = agent;
      const r = await putAsk(ctx, key, input, actor, { agent: true }); // the CLI is an agent surface: never the owner
      return { json: { ok: true, ...r }, text: r.key };
    }
    case 'reply': {
      // @req FR:ask-routing/reply.surfaces
      if (!key) throw new UsageError('asks reply needs a key');
      if (s('from') === undefined) throw new UsageError('asks reply needs --from <agent>');
      const text = s('text');
      if (text === undefined) throw new UsageError('asks reply needs --text');
      const agent = s('agent') ?? envLink(actor, process.env);
      const r = await replyAsk(ctx, key, { text, ...(agent ? { agent } : {}) }, actor);
      return { json: { ok: true, ...r }, text: `replied ${key}` };
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
    case 'import': {
      // @req FR:task-asks/import.cmd
      if (key) throw new UsageError(`Unexpected argument: ${key}`);
      const dry = f['dry-run'] === true;
      const r = await importAsks(ctx, { dryRun: dry });
      return { json: { ok: true, dryRun: dry, ...r }, text: [...r.imported.map((k) => `imported ${k}`), ...r.skipped.map((k) => `skipped ${k}`), `${r.imported.length} asks in ${r.files.length} files${dry ? ' (dry run)' : ''}`].join('\n') };
    }
    default: throw new UsageError('Usage: stack asks put|list|handle|archive|import (see stack --help)');
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

/** One line per project: the QM plan as text. */
const qmText = (p: QmPlan | null): string => {
  if (!p) return 'no QM plan (write one: stack qm put --file plan.json)';
  const n = (v: number | null) => (v === null ? 'pending' : String(v));
  return [`QM plan as of ${p.asOf}`, ...p.projects.map((x) => `${x.project}  ${x.agent.name}  tasks ${x.tasks.length}  tokens ${n(x.weeklyTokens)}  pre-ack ${n(x.preAckMin)}m  review ${n(x.postReviewMin)}m`)].join('\n');
};

/** The weekly QM plan in the local store; no repo. @req FR:qm-plan/cli.get @req FR:qm-plan/cli.put */
function qmCmd(p: ReturnType<typeof parseArgs>): Outcome {
  const store = new QmStore(stackHome());
  const [sub, ...rest] = p.positionals;
  if (rest.length) throw new UsageError(`Unexpected argument: ${rest[0]}`);
  if (sub === undefined && flag(p.flags, 'file')) throw new UsageError('--file needs qm put (stack qm put --file plan.json)');
  if (sub === undefined) { const r = store.read(); return { json: { ok: true, ...r }, text: `${qmText(r.plan)}${r.broken ? ' (qm-plan.json is broken)' : ''}` }; }
  if (sub !== 'put') throw new UsageError(`Unknown qm command: ${sub}`);
  const file = flag(p.flags, 'file');
  if (!file) throw new UsageError('qm put needs --file <plan.json>');
  let body: unknown;
  try { body = JSON.parse(readFileSync(file, 'utf8').replace(/^\uFEFF/, '')); } catch { throw new UsageError(`qm put: cannot read JSON from ${file}`); }
  const plan = store.put(body);
  return { json: { ok: true, changed: true, plan }, text: `QM plan stored: ${plan.projects.length} projects` };
}

/** Owner feedback in the local store; no repo. @req FR:feedback-button/cli.add @req FR:feedback-button/cli.list @req FR:feedback-button/cli.done */
async function feedbackCmd(p: ReturnType<typeof parseArgs>): Promise<Outcome> {
  const store = new FeedbackStore(stackHome());
  const [sub, ...rest] = p.positionals;
  if (sub === 'add') {
    const text = rest.join(' ').trim();
    if (!text) throw new UsageError('feedback add needs "<text>"');
    try {
      const item = await store.add({ text, route: flag(p.flags, 'route') });
      return { json: { ok: true, changed: true, item }, text: item.id };
    } catch (e) { if (e instanceof FeedbackError && e.code === 'invalid') throw new UsageError(e.message); throw e; }
  }
  if (sub === 'list') {
    if (rest.length) throw new UsageError(`Unexpected argument: ${rest[0]}`);
    const items = store.list({ since: flag(p.flags, 'since') });
    const line = (x: (typeof items)[number]) => `${x.id}${x.done ? ' done' : ''}  ${x.text.replace(/\s+/g, ' ')}${x.screenshotPath ? ` [${x.screenshotPath}]` : ''}`;
    return { json: { ok: true, items }, text: items.map(line).join('\n') || 'no feedback' };
  }
  if (sub === 'done') {
    if (rest.length !== 1) throw new UsageError('feedback done needs exactly one <id>');
    try {
      const r = await store.done(rest[0]);
      return { json: { ok: true, ...r }, text: `${r.id} ${r.changed ? 'done' : 'already done'}` };
    } catch (e) {
      if (e instanceof FeedbackError && e.code === 'not_found') return { json: { ok: false, error: e.message, code: EXIT.none }, text: `error: ${e.message}`, code: EXIT.none };
      throw e;
    }
  }
  throw new UsageError('feedback needs add, list or done');
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
  if (extra !== undefined || (sub !== undefined && sub !== 'seed' && sub !== 'put')) throw new UsageError(`Unexpected argument: ${extra ?? sub}`);
  for (const k of ['projects', 'keywords', 'refs']) if (p.flags[k] !== undefined) throw new UsageError(`--${k} needs pris link`);
  // @req FR:pri-first-ranking/day.cli @req FR:pri-first-ranking/day.cli.put
  if (sub === 'put') {
    const file = flag(p.flags, 'file');
    if (!file) throw new UsageError('pris put needs --file <json>');
    let body: unknown;
    try { body = JSON.parse(readFileSync(resolve(file), 'utf8')); } catch { throw new UsageError(`Cannot read JSON --file: ${file}`); }
    const w = await store.put(store.read().rev, body);
    return { json: { ok: true, ...w }, text: `put ${w.pris.length} priorities` };
  }
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
const apiRef = (r: { path: string; line: number }) => `${projectId(r.path)}:${r.line}`;

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
  return { storage, config: loadConfig(dir), now: () => at ?? new Date(), pris: ownerPris() };
}

/**
 * The owner priorities, read once; a missing or invalid file means none.
 * @req FR:pri-first-ranking/cli.@cli @req FR:pri-first-ranking/cli.read @req FR:pri-first-ranking/cli.read.bad
 */
function ownerPris(): () => Pri[] {
  let pris: Pri[] | undefined;
  return () => {
    if (!pris) { try { pris = new PriStore(stackHome()).read().pris; } catch { pris = []; } }
    return pris;
  };
}

/**
 * One line per project: `<project> done=yes|no <ref> <text>`, `-` for no pick.
 * @req FR:pri-first-ranking/daily.@cli @req FR:pri-first-ranking/daily.cli
 */
async function dailyOut(ctx: LifecycleContext, at: Date | undefined, f: Record<string, string | true>): Promise<Outcome> {
  // @req FR:pri-first-ranking/daily.cli.alone
  for (const k of ['top', 'engine', 'explain', 'truth']) if (f[k] !== undefined) throw new UsageError(`--daily does not take --${k}`);
  const rows = await dailyGoal(ctx, at);
  return {
    json: { ok: true, items: rows.map((d) => ({ project: d.project, ...(d.name ? { name: d.name } : {}), done: d.done, ...(d.pick ? { pick: { ref: formatRef(d.pick.ref), text: d.pick.text } } : {}) })) },
    text: rows.map((d) => `${d.name ?? d.project.replace(/\s+/g, '-')} done=${d.done ? 'yes' : 'no'} ${d.pick ? `${formatRef(d.pick.ref)} ${d.pick.text}` : '-'}`).join('\n'),
  };
}

/**
 * Ranked rows: the priority actions, then the tasks.
 * @req FR:pri-first-ranking/action.first @req FR:pri-first-ranking/cli.rows @req FR:pri-first-ranking/cli.json @req FR:pri-first-ranking/cli.rows.score @req FR:pri-first-ranking/proof.top @req FR:pri-first-ranking/proof.backlog
 */
async function rankRows(ctx: LifecycleContext, at: Date | undefined, top: number | undefined): Promise<{ json: object[]; text: string[] }> {
  const acts: PriAction[] = priActions(dayPris(ctx, at));
  const tasks = await rankStack(ctx, at, top);
  const a = acts.map((x) => ({ json: { pri: { id: x.id, rank: x.rank, title: x.title }, project: x.title, score: x.score, text: x.text }, text: `pri:${x.rank} ${Number(x.score.toFixed(1))} ${x.title} ${x.text}` }));
  const t = tasks.map((n) => ({ json: { ref: { path: n.ref.path, line: n.ref.line + 1 }, score: n.score, project: n.project, text: n.text, ...(n.rule ? { rule: n.rule } : {}), ...(n.stale ? { stale: true } : {}) }, text: `${formatRef(n.ref)} ${Number(n.score.toFixed(1))} ${n.project} ${n.text}` }));
  const all = [...a, ...t].slice(0, top);
  return { json: all.map((x) => x.json), text: all.map((x) => x.text) };
}

/** Commands after which legacy ran `Update-StackSummary`. @req FR:cli/cmd.refresh */
const REFRESH = new Set(['start', 'complete', 'skip', 'resume', 'suspend', 'retitle', 'remove-completed', 'add-project']);

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
      assertTitle(p.positionals.slice(1).join(' '));
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
        // The lint reads the row capture builds, so parsed dates (now marks) pass.
        if (f['dry-run'] !== true) assertTitle(taskText((await captureTask(ctx, text, { project: flag(f, 'project'), section: flag(f, 'section'), dryRun: true })).result.after));
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
      if (f['daily'] === true) return dailyOut(ctx, at, f);
      // @req FR:cli/cmd.next
      const top = num(flag(f, 'top'), 'top');
      if (top !== undefined) {
        if (!Number.isInteger(top) || top < 1 || top > 50) throw new UsageError('--top must be a whole number from 1 to 50');
        const ranked = await rankRows(ctx, at, top);
        if (!ranked.json.length) return { json: { ok: true, changed: false, message: 'No active tasks available' }, text: '', code: EXIT.none };
        return { json: { ok: true, items: ranked.json }, text: ranked.text.join('\n') };
      }
      // A priority action comes before any task. @req FR:pri-first-ranking/action.first
      // One function with `GET /next`. @req FR:pri-first-ranking/api.next.one
      const { action: act, task: n } = await nextStep(ctx, at);
      if (act) return { json: { ok: true, pri: { id: act.id, rank: act.rank, title: act.title }, project: act.title, score: act.score, text: act.text }, text: `pri:${act.rank} ${Number(act.score.toFixed(1))} ${act.title} ${act.text}` };
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
    // @req FR:product-reset/cli.check
    case 'check': {
      if (p.positionals.length !== 1) throw new UsageError('check needs exactly one <ref>');
      const r = parseRef(p.positionals[0]);
      const src = (await storage.read(r.path)).content;
      const q = checkTask(parseProject(src), r.line);
      if (!q) throw new LifecycleError('Task not found');
      const at = formatRef(r);
      // @req FR:task-lint/cli.check
      const lint = lintRow(r.path, src, r.line + 1).map(({ line, rule, message }) => ({ line, rule, message }));
      const rules = [...new Set(lint.map((i) => i.rule))];
      return {
        json: { ok: true, ref: at, ...q, ...(lint.length ? { lint } : {}) },
        text: `${at} ${q.score}/4 ${q.actionable ? 'actionable' : `missing: ${q.missing.join(', ')}`}${rules.length ? ` lint: ${rules.join(', ')}` : ''}`,
        code: q.actionable && !lint.some(isError) ? EXIT.ok : EXIT.failure,
      };
    }
    // @req FR:task-ids/assign.add
    case 'ids': {
      if (p.positionals[0] !== 'assign') throw new UsageError('ids needs a subcommand: assign');
      if (p.positionals.length > 1) throw new UsageError(`Unexpected argument: ${p.positionals[1]}`);
      const r = await assignIds(ctx, { project: flag(f, 'project'), dryRun: f['dry-run'] === true });
      return { json: { ok: true, command: 'ids assign', ...r }, text: [...r.files, `${r.added} IDs in ${r.files.length} files${f['dry-run'] === true ? ' (dry run)' : ''}`].join('\n') };
    }
    // @req FR:task-ids/mv.file @req FR:task-ids/mv.report
    case 'mv': {
      if (p.positionals.length !== 2) throw new UsageError('mv needs <from-id> <to-id>');
      const r = await moveProject(ctx, p.positionals[0], p.positionals[1], { dryRun: f['dry-run'] === true }).catch((e: Error) => { throw new LifecycleError(e.message); });
      return { json: { ok: true, command: 'mv', ...r }, text: [...r.files, `${r.refs} refs in ${r.files.length} files${f['dry-run'] === true ? ' (dry run)' : ''}`].join('\n') };
    }
    // @req FR:task-lint/cli.lint @req FR:task-lint/cli.lint.out @req FR:task-lint/cli.lint.exit @req FR:task-lint/cli.lint.json
    case 'lint': {
      extra(0);
      const issues = await lintFiles(storage, flag(f, 'project'), dir);
      return {
        json: { ok: !issues.some(isError), command: 'lint', issues },
        text: issues.length ? [...issues.map(formatIssue), formatCount(issues)].join('\n') : 'no issues',
        // @req FR:task-lint/cli.lint.exit: warnings flag old content and never fail.
        code: issues.some(isError) ? EXIT.failure : EXIT.ok,
      };
    }
    // @req FR:cli/cmd.retitle
    case 'retitle': {
      const text = flag(f, 'text');
      if (p.positionals.length !== 1) throw new UsageError('retitle needs exactly one <ref>');
      if (text === undefined) throw new UsageError('retitle needs --text');
      assertTitle(text);
      const r = parseRef(p.positionals[0]);
      return describe(cmd, await retitleTask(storage, r, text, flag(f, 'expect')));
    }
    // @req FR:cli/cmd.note
    case 'note': {
      const text = flag(f, 'text');
      if (p.positionals[0] !== 'add') throw new UsageError('Usage: stack note add <ref> --text t [--expect t]');
      if (p.positionals.length !== 2) throw new UsageError('note add needs exactly one <ref>');
      if (text === undefined) throw new UsageError('note add needs --text');
      const r = await addNote(storage, parseRef(p.positionals[1]), text, flag(f, 'expect'));
      return { json: { ok: true, command: 'note', changed: true, ref: { path: r.ref.path, line: r.ref.line + 1 }, text: text.trim() }, text: `noted ${formatRef(r.ref)}` };
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
      if (f['daily'] === true) return dailyOut(ctx, at, f);
      const engine = flag(f, 'engine') ?? 'stack';
      if (engine !== 'autopri' && engine !== 'pris' && engine !== 'stack') throw new UsageError('--engine must be autopri, pris or stack');
      const explain = f['explain'] === true;
      if (flag(f, 'truth') !== undefined && !explain) throw new UsageError('--truth needs --explain');
      if (flag(f, 'truth') !== undefined && engine === 'stack') throw new UsageError('--truth needs --engine autopri or pris');
      const top = num(flag(f, 'top'), 'top');
      if (top !== undefined && (!Number.isInteger(top) || top < 1 || top > 50)) throw new UsageError('--top must be a whole number from 1 to 50');
      // @req FR:task-lifecycle/rank.explain
      if (explain && engine === 'stack') {
        const r = await explainStack(ctx, at, { top });
        return { json: { ok: true, items: r.items, dropped: r.dropped }, text: r.text, code: r.items.length ? EXIT.ok : EXIT.none };
      }
      registerAutopriEngine();
      // @req FR:pris-aware-ranking/explain.cli @req FR:pris-aware-ranking/explain.json
      const pris = engine === 'pris' ? new PriStore(stackHome()).read().pris : undefined;
      if (pris) { registerPrisEngine(); setPris(pris); }
      // An explicit engine keeps its own order (bake-offs). @req FR:pri-first-ranking/order.none
      const rctx = { ...ctx, engine, pris: undefined };
      if (explain) {
        const tf = flag(f, 'truth');
        let truth: string | undefined;
        if (tf !== undefined) { try { truth = readFileSync(resolve(tf), 'utf8'); } catch { throw new UsageError(`Cannot read --truth file: ${tf}`); } }
        const r = await explainAutopri(rctx, at, { top, truth, ...(pris ? { pris } : {}) });
        return { json: { ok: true, items: r.items, ...(r.truth ? { truth: r.truth } : {}) }, text: r.text, code: r.items.length ? EXIT.ok : EXIT.none };
      }
      const ranked = await rankRows(engine === 'stack' ? ctx : rctx, at, top);
      return { json: { ok: true, items: ranked.json }, text: ranked.text.join('\n'), code: ranked.json.length ? EXIT.ok : EXIT.none };
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
        const items = await listInbox(ctx, { project: flag(f, 'project'), agent: flag(f, 'agent'), state: (state ?? (f.all === true ? 'all' : undefined)) as (typeof INBOX_STATES)[number] | undefined, withdrawn: f.all === true }); // --all: every entry, withdrawn too; --state still narrows
        const rows = await currentRows(ctx, items);
        const out = items.map((e) => ({ ...e, ...(rows.has(e.id) ? { row: rows.get(e.id)! } : {}) }));
        return { json: { ok: true, items: out }, text: out.map((e) => `${e.id} ${e.kind} ${e.project} ${e.row ?? e.ref} ${e.text}${!e.from && e.agent ? ` (to ${e.agent})` : ''}${e.withdrawn ? ' (withdrawn)' : ''}`).join('\n') }; // @req FR:product-reset/ui.thread
      }
      // @req FR:inbox-page/cli.sources
      if (p.positionals[0] === 'sources') { extra(1); return inboxSourcesCmd(ctx); }
      // @req FR:agent-delivery/cli.run
      if (p.positionals[0] === 'run') { extra(1); const config = loadConfig(dir); return inboxRunCmd(ctx, f, { repo: dir, config, agentScan: () => projectRepos(ctx).then((repos) => scanAgents({ home: homedir(), roots: config?.agents?.scanRoots, skip: [dir], repos })), out: (l) => process.stdout.write(`${l}\n`) }); }
      // @req FR:agent-inbox/cli.handle
      if (p.positionals[0] === 'handle') {
        if (!p.positionals[1]) throw new UsageError('inbox handle needs an id');
        extra(2);
        const r = await handleEntry(ctx, p.positionals[1], flag(f, 'from') ?? 'cli', flag(f, 'note'));
        return { json: { ok: true, ...r }, text: r.changed ? 'handled' : 'unchanged' };
      }
      // @req FR:agent-thread/reply.entry
      if (p.positionals[0] !== 'reply') throw new UsageError('Usage: stack inbox reply <ref> --from <agent> --text t | list | handle <id> | run | sources');
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
      const u = await update(ctx, storage, { sweep: f['sweep'] === true, queries: f['queries'] === true, engine: engine as 'legacy' | 'stack' | undefined });
      // The summaries are written first, so a lint issue never stops them. @req FR:task-lint/cli.update @req FR:task-lint/cli.update.refresh
      const issues = await lintFiles(storage, undefined, dir);
      if (!issues.length) return u;
      // @req FR:task-lint/cli.update: the daily loop never stops on lint; issues go to stderr.
      return { ...u, json: { ...u.json, lint: issues }, err: [...issues.map(formatIssue), formatCount(issues)].join('\n') };
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
  // @req FR:tailnet-access/bind.@cli
  const bind = bindMode(f['bind'], userConfig(home).bind);
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
    const demoLive = live ? {} : { inventory: false as const, pris: new PriStore(join(home, '.config/stack/demo-state')), prPriority: new PrPriorityStore(join(home, '.config/stack/demo-state')) };
    const server = await startWeb({ dir: target, port: p, webDir, label, info, storage, bind, setup, ...(typeof ics === 'string' ? { ics } : {}), ...(reports ? { reports } : {}), ...demoLive });
    // @req FR:tailnet-access/bind.startup
    if (bind === 'tailnet') io.out(`Tailnet (paired devices only): ${server.urls.slice(1).join('  ')}\nHTTPS for the phone: tailscale serve --bg ${new URL(server.url).port}. Pair a phone: stack devices add <name>\n`);
    return { server, dir: target };
  };
  const s = await runLocal({ port, home, env: process.env, webDir, spec, locks, startReal, log: (l) => io.out(`${l}\n`) });
  io.out(`Stack web: ${s.url}  (${spec() ? 'Ctrl+C to stop' : 'first run: finish setup in the browser; Ctrl+C to stop'})\n`);
  await new Promise<void>((ok) => { process.once('SIGINT', ok); process.once('SIGTERM', ok); });
  await s.close();
  return EXIT.ok;
}

function exitCodeFor(e: unknown): number {
  // @req FR:pr-priority/cli.edit: bad input 2, stale rev or a closed decision 3, not queued or unknown id 1.
  if (e instanceof PrPriInvalid) return EXIT.usage;
  if (e instanceof PrPriConflict) return EXIT.conflict;
  if (e instanceof PrPriNotFound) return EXIT.failure;
  if (e instanceof LiveError) return liveExit(e);
  if (e instanceof BriefInvalid) return EXIT.usage;
  if (e instanceof UsageError || e instanceof LifecycleError || e instanceof NotFoundError || e instanceof PathError || e instanceof ReportInvalid || e instanceof PrisInvalid || e instanceof QmInvalid) return EXIT.usage;
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
    const p = parseArgs(prPriArgv(argv));
    json = p.flags['json'] === true;
    // @req FR:cli/run.help.version
    if (p.flags['version']) { io.out(`${pkgVersion()}\n`); return EXIT.ok; }
    // @req FR:cli/run.help @req FR:cli/run.help.cmd
    if (p.command === 'help' || !p.command) {
      const name = p.positionals[0];
      const one = name && name !== 'help' ? name : undefined;
      if (one && !COMMANDS[one]) throw unknownCommand(one);
      io.out(`${one ? commandHelp(one) : helpText()}\n`);
      return EXIT.ok;
    }
    const spec = COMMANDS[p.command];
    if (!spec) throw unknownCommand(p.command);
    command = canon(p.command);
    if (p.flags['help']) { io.out(`${commandHelp(p.command)}\n`); return EXIT.ok; }
    for (const k of Object.keys(p.flags)) if (!GLOBAL.includes(k) && !spec.flags.includes(k)) throw new UsageError(`Unknown option for ${p.command}: --${k}`);
    const home = homedir();
    const explicit = flag(p.flags, 'dir');
    // init targets --dir, the repo at or above the current folder, or the current folder; never env or user config. @req FR:cli/cmd.init.here
    const found = explicit ? null : p.command === 'init' ? walkStackDir(process.cwd()) : findStackDir({ cwd: process.cwd(), env: process.env, home });
    const dir = resolve(explicit ?? found ?? process.cwd());
    // Only --dir or the current folder is fixed at startup; env and user config are read on every setup restart.
    if (p.command === 'web') { const up = walkStackDir(process.cwd()); return await web(p.flags, io, explicit ? { dir: explicit, by: '--dir' } : up ? { dir: up, by: 'the current folder' } : null, home); }
    if (p.command === 'graph') return await graphCmd(p.positionals[0], p.flags, io, json);
    if (p.command === 'agent') return await agentCmd(p.positionals, p.flags, io, json, () => buildCtx(p.flags, dir));
    // A report is live state for the host's store, not the content repo: it needs no repo. @req FR:status-ingest/cli.report
    // Live state under ~/.stack needs no content repo. @req FR:session-inventory/cli.sessions @req FR:session-inventory/cli.pris
    // PR review lane state lives under ~/.stack too. @req FR:pr-review-lane/sort.cli @req FR:pr-review-lane/brief.cli @req FR:pr-review-lane/lane.show
    if (p.command === 'live') {
      const o = await liveCmd(p);
      if (json) io.out(`${JSON.stringify(o.json)}\n`); else if (o.text) (o.code ? io.err : io.out)(`${o.text}\n`);
      return o.code ?? EXIT.ok;
    }
    // Devices live in ~/.stack (STACK_HOME), not the content repo. @req FR:tailnet-access/pair.@cli
    if (p.command === 'devices') { const d = await devicesCmd(p.positionals[0], p.positionals.slice(1), stackHome()); io.out(`${json ? JSON.stringify(d.json) : d.text}\n`); return EXIT.ok; }
    // @req FR:store-sync/doctor.@cli
    if (p.command === 'doctor') { const d = await doctorCmd(dir, flag(p.flags, 'remote')); io.out(`${json ? JSON.stringify(d.json) : d.text}\n`); return d.code; }
    const r = p.command === 'report' ? await reportCmd(p, io.in ?? readStdin) : p.command === 'sessions' ? sessionsCmd(p) : p.command === 'feedback' ? await feedbackCmd(p) : p.command === 'qm' ? qmCmd(p) : p.command === 'prs' ? await prsCmd(p.flags, p.positionals, () => loadConfig(dir), stackHome()) : p.command === 'priorities' ? await prioritiesCmd(p.flags, p.positionals, liveDeps(stackHome(), dir, () => loadConfig(dir), process.env, nowOf(p.flags))) : p.command === 'pris' ? await prisCmd(p, () => buildCtx(p.flags, dir)) : p.command === 'app' ? await appCmd(p.positionals[0], p.flags, realAppDeps(home)) : p.command === 'pr-pri' ? await prPriCmd(p.positionals, p.flags, io.in ?? readStdin) : await dispatch(p.command, p, dir);
    if (json) io.out(`${JSON.stringify(r.json)}\n`);
    else if (r.text) io.out(`${r.text}\n`);
    const err = (r as Outcome).err;
    if (!json && err) io.err(`${err}\n`);
    return r.code ?? EXIT.ok;
  } catch (e) {
    const code = exitCodeFor(e);
    const msg = e instanceof Error ? e.message : String(e);
    if (json) io.out(`${JSON.stringify({ ok: false, ...(command ? { command } : {}), error: msg, code, ...(e instanceof ReportInvalid || e instanceof PrPriInvalid || e instanceof QmInvalid ? { issues: e.issues } : {}) })}\n`);
    else io.err(`error: ${msg}\n`);
    return code;
  }
}
