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
  removeCompleted, resumeTask, setProperties, skipTask, startTask, suspendTask, sweep, TaskProps,
} from '../core/lifecycle';
import { archiveAsks, ASK_KINDS, ASK_PRIORITIES, handleAsk, listAsks, putAsk, type AskPut, type HandleInput, LIST_STATES } from '../core/asks';
import { AGENT_MODES, agentFor, listTeam, putAgent, type AgentMode } from '../core/agents';
import { captureTask, CaptureError } from '../core/quick-capture';
import { AUTONOMY_LEVELS, type Autonomy } from '../core/model';
import { applyTriage, effectiveAutonomy, setAutonomy } from '../core/triage';
import { createGhClient, refreshQueryTasks } from '../core/query-tasks';
import { ConflictError, FsStorage, NotFoundError, PathError, Storage, StorageError, writeAll } from '../core/storage';
import { GitStorage } from '../core/storage-git';
import { generateSummaries } from '../core/summaries';
import { formatRef, parseArgs, parseRef, UsageError } from './args';
import { graphCmd } from './graph';
import { findStackDir, userConfig } from './discover';
import { redact, prepareDemo, prepareLive, resolveRepo, startWeb, type RepoInfo } from './web';
import { homedir } from 'os';
import { createHash } from 'crypto';

export interface IO { out(s: string): void; err(s: string): void }

/** Exit codes. @req FR:cli/out.codes */
export const EXIT = { ok: 0, failure: 1, usage: 2, conflict: 3, none: 4 } as const;

const GLOBAL = ['dir', 'json', 'no-commit', 'remote', 'branch', 'now', 'help', 'version'];
const COMMANDS: Record<string, { flags: string[]; usage: string; help: string }> = {
  init: { flags: [], usage: 'init', help: 'create repo, tasks/, and config' },
  'add-project': { flags: ['description', 'repo', 'alias', 'priority', 'capacity', 'weekly-capacity', 'file', 'force'], usage: 'add-project <name> [--description t] [--repo url] [--alias a,b] [--priority n] [--capacity Block=h,..] [--weekly-capacity n] [--file name] [--force]', help: 'create a project file' },
  add: { flags: ['section', 'parent'], usage: 'add <project> <text...> [--section name] [--parent ref]', help: 'add a task' },
  capture: { flags: ['project', 'section', 'dry-run'], usage: 'capture <text...> [--project name] [--section name] [--dry-run]', help: 'add a task from a phrase (e.g. "call dentist tomorrow 30m #alpha")' },
  next: { flags: [], usage: 'next', help: 'print the top task' },
  start: { flags: ['expect'], usage: 'start [ref] [--expect t]', help: 'mark in progress' },
  complete: { flags: ['summary', 'remove', 'expect'], usage: 'complete [ref] [--summary t] [--remove] [--expect t]', help: 'check off (rolls recurring rows)' },
  skip: { flags: ['expect'], usage: 'skip [ref] [--expect t]', help: 'park a task (alias: park)' },
  park: { flags: ['expect'], usage: 'park [ref] [--expect t]', help: 'same as skip' },
  resume: { flags: ['expect'], usage: 'resume [ref] [--expect t]', help: 'unpark the first parked task' },
  suspend: { flags: ['days', 'hours', 'expect'], usage: 'suspend [ref] [--days n | --hours n] [--expect t]', help: 'hide until later' },
  set: { flags: ['status', 'priority', 'effort', 'impact', 'checkbox', 'suspend', 'remove-emojis', 'expect'], usage: 'set <ref> [--status e] [--priority e] [--effort e] [--impact e] [--checkbox complete|incomplete] [--suspend v] [--remove-emojis] [--expect t]', help: 'set emojis and checkbox' },
  triage: { flags: ['autonomy', 'agent', 'human', 'priority', 'effort', 'impact'], usage: 'triage <ref> [--autonomy none|triage|assist|full] [--agent t] [--human t] [--priority e] [--effort e] [--impact e]', help: 'show/set autonomy, add 🪄/🙋 subtasks' },
  'remove-completed': { flags: ['project'], usage: 'remove-completed [--project name]', help: 'delete checked rows' },
  web: { flags: ['port', 'repo', 'live', 'branch', 'reset'], usage: 'web [--repo path-or-url] [--live] [--branch name] [--port n] [--reset]', help: 'serve the web app on localhost (demo copy by default; --live commits to a branch)' },
  asks: { flags: ['ask', 'kind', 'from', 'project', 'why', 'recommend', 'options', 'default', 'by', 'reversible', 'link', 'priority', 'effort', 'blocks', 'detail-file', 'reopen', 'state', 'outcome', 'note', 'reply', 'limit', 'days'], usage: 'asks put <key> --ask t --kind k --from agent [--project --why --recommend --options "A|B" --default --by --reversible yes|no --link --priority --effort --blocks --detail-file p --reopen] | list [--state s] | handle <key> --outcome o [--note --reply] | archive [--days n]', help: 'ask queue for the owner: agents put and handle asks; archive moves old done asks aside' },
  graph: { flags: ['client-id', 'tenant', 'with', 'cache'], usage: 'graph login --client-id <id> [--tenant t] [--with calendar,mail,drafts] [--cache path] | status | logout', help: 'sign in to Microsoft Graph (device code) for the live calendar and mail; read-only scopes' },
  update: { flags: ['sweep', 'queries'], usage: 'update [--sweep] [--queries]', help: 'regenerate README, stack, projects, my-day' },
  agents: { flags: ['project', 'section', 'name', 'role', 'scope', 'model', 'mode', 'tools', 'prompt-file'], usage: 'agents list [--project p --section s] | add <slug> --name n --scope a,b [--role r --model m --mode long-running|ad-hoc --tools a,b --prompt-file p]', help: 'agents defined per project folder (tasks/agents/<slug>.md)' },
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

function describe(cmd: string, r: LifecycleResult): Outcome {
  const json: Record<string, unknown> = {
    ok: true, changed: r.changed,
    ...(r.ref ? { ref: { path: r.ref.path, line: r.ref.line + 1 } } : {}),
    ...(r.before !== undefined ? { before: r.before } : {}),
    ...(r.after !== undefined ? { after: r.after } : {}),
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
async function update(ctx: LifecycleContext, storage: Storage, opts: { sweep: boolean; queries: boolean }): Promise<Outcome> {
  const now = ctx.now ? ctx.now() : new Date();
  const config = ctx.config ?? getDefaults();
  const queries = opts.queries ? await refreshQueryTasks(storage, createGhClient(), { now, timeZone: config.timezone }) : undefined;
  const swept = opts.sweep ? await sweep(ctx) : undefined;
  const readOpt = async (p: string) => { try { return await storage.read(p); } catch (e) { if (e instanceof NotFoundError) return null; throw e; } };
  const projects = [];
  for (const p of await storage.list()) projects.push({ fileName: p.replace(/^tasks\//, ''), content: (await storage.read(p)).content });
  const strip = (s?: string | null) => s?.replace(/^﻿/, '');
  const files = generateSummaries({
    projects, config, now,
    previousReadme: strip((await readOpt('README.md'))?.content), previousProjects: strip((await readOpt('projects.md'))?.content),
  });
  const changed: { path: string; content: string; expectedVersion: string | null }[] = [];
  for (const [name, content] of [['README.md', files.readme], ['stack.md', files.stack], ['projects.md', files.projects], ['my-day.md', files.myDay]] as const) {
    if (content === null) continue;
    const cur = await readOpt(name);
    if (cur && cur.content === content) continue;
    changed.push({ path: name, content, expectedVersion: cur ? cur.version : null });
  }
  if (changed.length) await writeAll(storage, changed, 'Update summaries');
  const written = changed.map(c => c.path);
  const q = queries ? ` (queries: ${queries.processed} refreshed${queries.failures.length ? `, ${queries.failures.length} failed: ${queries.failures.map(x => x.message).join('; ')}` : ''})` : '';
  return {
    json: { ok: true, changed: written.length > 0, files: written, ...(swept ? { swept } : {}), ...(queries ? { queries } : {}) },
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
      return { json: { ok: true, items }, text: items.map((a) => `${a.slug}  ${a.name}  ${a.scope.join(',') || '-'}${a.defined ? '' : '  (metadata only)'}`).join('\n') };
    }
    case 'add': {
      if (!slug) throw new UsageError('agents add needs a slug');
      const mode = s('mode');
      if (mode !== undefined && !(AGENT_MODES as readonly string[]).includes(mode)) throw new UsageError(`--mode must be one of ${AGENT_MODES.join(', ')}`);
      const pf = s('prompt-file');
      const r = await putAgent(ctx, slug, { name: s('name'), role: s('role'), scope: list(s('scope')), model: s('model'), tools: list(s('tools')), mode: mode as AgentMode | undefined, ...(pf ? { prompt: readFileSync(pf, 'utf8') } : {}) });
      return { json: { ok: true, ...r }, text: `${r.created ? 'added' : 'updated'} ${r.slug}` };
    }
    default: throw new UsageError('Usage: stack agents list|add (see stack --help)');
  }
}

async function dispatch(cmd: string, p: ReturnType<typeof parseArgs>, dir: string): Promise<Outcome> {
  const f = p.flags;
  if (cmd === 'init') return init(dir);
  let storage: Storage;
  if (f['no-commit']) {
    storage = new FsStorage(dir);
  } else {
    if (!isWorkTree(dir)) throw new StorageError(`Not a git work tree: ${dir} (run \`stack init --dir ${dir}\`, or use --no-commit)`);
    storage = new GitStorage(dir, { remote: flag(f, 'remote'), branch: flag(f, 'branch') });
  }
  const nowFlag = flag(f, 'now');
  const at = nowFlag ? new Date(nowFlag) : undefined;
  if (at && Number.isNaN(at.getTime())) throw new UsageError(`--now must be an ISO date: ${nowFlag}`);
  const ctx: LifecycleContext = { storage, config: loadConfig(dir), now: () => at ?? new Date() };
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
    case 'update': extra(0); return update(ctx, storage, { sweep: f['sweep'] === true, queries: f['queries'] === true });
    default: throw new UsageError(`Unknown command: ${cmd}`);
  }
}

/** @req FR:cli/web.serve @req FR:cli/web.demo @req FR:cli/web.live */
async function web(f: Record<string, string | true>, io: IO, found: string | null, home: string): Promise<number> {
  const port = num(flag(f, 'port'), 'port') ?? 4173;
  const cfg = userConfig(home);
  const spec = flag(f, 'repo') ?? found;
  if (!spec) throw new UsageError('No content repo. Use: stack web --repo <path-or-git-url> (or set STACK_REPO, or "repo" in ~/.config/stack/config.json)');
  const repo = resolveRepo(spec, join(home, '.config/stack/clones'));
  const live = f['live'] === true || cfg.mode === 'live';
  let target: string; let info: RepoInfo; let label: string;
  if (live) {
    const branch = flag(f, 'branch') ?? cfg.branch ?? 'stack-web';
    const wt = join(home, '.config/stack/live', `${basename(repo)}-${createHash('sha1').update(`${repo}\0${branch}`).digest('hex').slice(0, 8)}`);
    target = prepareLive(repo, branch, wt).dir;
    info = { mode: 'live', repo: redact(repo), branch };
    label = `LIVE - edits are committed to branch ${branch} of ${repo}`;
    io.out(`LIVE MODE: edits commit to branch ${branch} of ${repo} (worktree ${target}); main is untouched until you merge.\n`);
  } else {
    target = join(home, '.config/stack/demo');
    prepareDemo(repo, target, f['reset'] === true);
    info = { mode: 'demo', repo: redact(repo), branch: 'main' };
    label = `DEMO COPY of ${repo} - edits stay in the copy`;
    io.out(`DEMO MODE: serving a COPY of ${repo}\nEdits stay in ${target}; the real repo is never touched. Reset: stack web --reset. Real data: stack web --live\n`);
  }
  const webDir = join(__dirname, '../../web/dist');
  if (!existsSync(join(webDir, 'index.html'))) throw new StorageError(`Web app not built (${webDir}). Run: pnpm build`);
  const s = await startWeb({ dir: target, port, webDir, label, info });
  io.out(`Stack web: ${s.url}  (data: ${target}; Ctrl+C to stop)\n`);
  await new Promise<void>((ok) => { process.once('SIGINT', ok); process.once('SIGTERM', ok); });
  await s.close();
  return EXIT.ok;
}

function exitCodeFor(e: unknown): number {
  if (e instanceof UsageError || e instanceof LifecycleError || e instanceof NotFoundError || e instanceof PathError) return EXIT.usage;
  if (e instanceof ConflictError) return EXIT.conflict;
  return EXIT.failure;
}

/**
 * Runs the CLI and returns the exit code (never exits the process).
 * @req FR:cli/run.@function @req FR:cli/run.dir @req FR:cli/run.help @req FR:cli/out.text @req FR:cli/out.json @req FR:cli/out.quiet @req FR:cli/out.codes
 */
export async function run(argv: string[], io: IO = { out: (s) => process.stdout.write(s), err: (s) => process.stderr.write(s) }): Promise<number> {
  let json = argv.includes('--json') && !argv.includes('--');
  try {
    const p = parseArgs(argv);
    json = p.flags['json'] === true;
    if (p.flags['version']) { io.out(`${pkgVersion()}\n`); return EXIT.ok; }
    if (p.flags['help'] || !p.command) { io.out(`${helpText()}\n`); return EXIT.ok; }
    const spec = COMMANDS[p.command];
    if (!spec) throw new UsageError(`Unknown command: ${p.command}`);
    for (const k of Object.keys(p.flags)) if (!GLOBAL.includes(k) && !spec.flags.includes(k)) throw new UsageError(`Unknown option for ${p.command}: --${k}`);
    const home = homedir();
    const explicit = flag(p.flags, 'dir');
    const found = explicit ? null : findStackDir({ cwd: process.cwd(), env: process.env, home });
    const dir = resolve(explicit ?? found ?? process.cwd());
    if (p.command === 'web') return await web(p.flags, io, explicit ?? found, home);
    if (p.command === 'graph') return await graphCmd(p.positionals[0], p.flags, io, json);
    const r = await dispatch(p.command, p, dir);
    if (json) io.out(`${JSON.stringify(r.json)}\n`);
    else if (r.text) io.out(`${r.text}\n`);
    return r.code ?? EXIT.ok;
  } catch (e) {
    const code = exitCodeFor(e);
    const msg = e instanceof Error ? e.message : String(e);
    if (json) io.out(`${JSON.stringify({ ok: false, error: msg, code })}\n`);
    else io.err(`error: ${msg}\n`);
    return code;
  }
}
