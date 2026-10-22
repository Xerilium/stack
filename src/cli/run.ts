/**
 * Command dispatch for the `stack` CLI.
 * @req FR:cli/run.git @req FR:cli/run.nocommit @req FR:cli/run.remote @req FR:cli/run.now @req FR:cli/ref.default
 * @req FR:cli/cmd.add-project @req FR:cli/cmd.add @req FR:cli/cmd.next @req FR:cli/cmd.start @req FR:cli/cmd.complete @req FR:cli/cmd.skip
 * @req FR:cli/cmd.resume @req FR:cli/cmd.suspend @req FR:cli/cmd.set @req FR:cli/cmd.remove-completed @req FR:cli/arch.thin @req FR:cli/arch.storage
 */
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join, resolve } from 'path';
import { getDefaults, parseConfig, ConfigError, StackConfig } from '../core/config';
import {
  addProject, addTask, completeTask, LifecycleContext, LifecycleError, LifecycleResult, nextTask,
  removeCompleted, resumeTask, setProperties, skipTask, startTask, suspendTask, sweep, TaskProps,
} from '../core/lifecycle';
import { ConflictError, FsStorage, NotFoundError, PathError, Storage, StorageError } from '../core/storage';
import { GitStorage } from '../core/storage-git';
import { generateSummaries } from '../core/summaries';
import { formatRef, parseArgs, parseRef, UsageError } from './args';

export interface IO { out(s: string): void; err(s: string): void }

/** Exit codes. @req FR:cli/out.codes */
export const EXIT = { ok: 0, failure: 1, usage: 2, conflict: 3, none: 4 } as const;

const GLOBAL = ['dir', 'json', 'no-commit', 'remote', 'branch', 'now', 'help', 'version'];
const COMMANDS: Record<string, { flags: string[]; usage: string; help: string }> = {
  init: { flags: [], usage: 'init', help: 'create repo, tasks/, and config' },
  'add-project': { flags: ['description', 'repo', 'alias', 'priority', 'capacity', 'weekly-capacity', 'file', 'force'], usage: 'add-project <name> [--description t] [--repo url] [--alias a,b] [--priority n] [--capacity Block=h,..] [--weekly-capacity n] [--file name] [--force]', help: 'create a project file' },
  add: { flags: ['section', 'parent'], usage: 'add <project> <text...> [--section name] [--parent ref]', help: 'add a task' },
  next: { flags: [], usage: 'next', help: 'print the top task' },
  start: { flags: [], usage: 'start [ref]', help: 'mark in progress' },
  complete: { flags: ['summary', 'remove'], usage: 'complete [ref] [--summary t] [--remove]', help: 'check off (rolls recurring rows)' },
  skip: { flags: [], usage: 'skip [ref]', help: 'park a task (alias: park)' },
  park: { flags: [], usage: 'park [ref]', help: 'same as skip' },
  resume: { flags: [], usage: 'resume [ref]', help: 'unpark the first parked task' },
  suspend: { flags: ['days', 'hours'], usage: 'suspend [ref] [--days n | --hours n]', help: 'hide until later' },
  set: { flags: ['status', 'priority', 'effort', 'impact', 'checkbox', 'suspend', 'remove-emojis'], usage: 'set <ref> [--status e] [--priority e] [--effort e] [--impact e] [--checkbox complete|incomplete] [--suspend v] [--remove-emojis]', help: 'set emojis and checkbox' },
  'remove-completed': { flags: ['project'], usage: 'remove-completed [--project name]', help: 'delete checked rows' },
  update: { flags: ['sweep'], usage: 'update [--sweep]', help: 'regenerate README, stack, projects, my-day' },
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
  if (v.trim() === '' || Number.isNaN(n)) throw new UsageError(`--${name} must be a number: ${v}`);
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
  try { return git(dir, 'rev-parse', '--is-inside-work-tree').trim() === 'true'; } catch { return false; }
}

/** @req FR:cli/cmd.init */
function init(dir: string): Outcome {
  mkdirSync(dir, { recursive: true });
  const made: string[] = [];
  if (!isWorkTree(dir)) { git(dir, 'init', '-q', '-b', 'main'); made.push('repo'); }
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
async function update(ctx: LifecycleContext, storage: Storage, doSweep: boolean): Promise<Outcome> {
  const swept = doSweep ? await sweep(ctx) : undefined;
  const readOpt = async (p: string) => { try { return await storage.read(p); } catch (e) { if (e instanceof NotFoundError) return null; throw e; } };
  const projects = [];
  for (const p of await storage.list()) projects.push({ fileName: p.replace(/^tasks\//, ''), content: (await storage.read(p)).content });
  const strip = (s?: string | null) => s?.replace(/^﻿/, '');
  const files = generateSummaries({
    projects, config: ctx.config ?? getDefaults(), now: ctx.now ? ctx.now() : new Date(),
    previousReadme: strip((await readOpt('README.md'))?.content), previousProjects: strip((await readOpt('projects.md'))?.content),
  });
  const written: string[] = [];
  for (const [name, content] of [['README.md', files.readme], ['stack.md', files.stack], ['projects.md', files.projects], ['my-day.md', files.myDay]] as const) {
    if (content === null) continue;
    const cur = await readOpt(name);
    if (cur && cur.content === content) continue;
    await storage.write(name, content, { expectedVersion: cur ? cur.version : null, message: `Update ${name}` });
    written.push(name);
  }
  return {
    json: { ok: true, changed: written.length > 0, files: written, ...(swept ? { swept } : {}) },
    text: written.length ? `updated ${written.join(' ')}` : 'no change: summaries are current',
  };
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
  const ref = () => (p.positionals[0] ? parseRef(p.positionals[0]) : undefined);
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
      return describe(cmd, await setProperties(ctx, parseRef(p.positionals[0]), props(f)));
    }
    case 'remove-completed': {
      extra(0);
      const r = await removeCompleted(ctx, { project: flag(f, 'project') });
      return { json: { ok: true, changed: r.removed > 0, removed: r.removed, files: r.files }, text: `removed ${r.removed}` };
    }
    case 'update': extra(0); return update(ctx, storage, f['sweep'] === true);
    default: throw new UsageError(`Unknown command: ${cmd}`);
  }
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
    const dir = resolve(flag(p.flags, 'dir') ?? process.cwd());
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
