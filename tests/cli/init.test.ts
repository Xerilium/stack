/**
 * `stack init` writes to `--dir` or the current folder, never to a configured repo.
 * Every path is a temp dir: HOME, XDG_CONFIG_HOME, STACK_REPO and STACK_DIR point at temp folders.
 * @req FR:cli/cmd.init @req FR:cli/cmd.init.here @req FR:cli/cmd.init.out @req FR:cli/cmd.init.json
 */
import { execFileSync } from 'child_process';
import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { run } from '../../src/cli/run';

const KEYS = ['HOME', 'XDG_CONFIG_HOME', 'STACK_REPO', 'STACK_DIR', 'GIT_CONFIG_GLOBAL', 'GIT_CONFIG_SYSTEM', 'GIT_AUTHOR_NAME', 'GIT_AUTHOR_EMAIL', 'GIT_COMMITTER_NAME', 'GIT_COMMITTER_EMAIL'] as const;
const saved: Partial<Record<string, string | undefined>> = {};
const dirs: string[] = [];
let configured: string;

const tmp = (): string => { const d = realpathSync(mkdtempSync(join(tmpdir(), 'stack-init-'))); dirs.push(d); return d; };
const git = (dir: string, ...a: string[]) => execFileSync('git', a, { cwd: dir, encoding: 'utf8' }).trim();
const commits = (dir: string) => Number(git(dir, 'rev-list', '--count', 'HEAD'));

async function cli(cwd: string, ...args: string[]) {
  const spy = jest.spyOn(process, 'cwd').mockReturnValue(cwd);
  let out = ''; let err = '';
  try {
    const code = await run(args, { out: (s) => { out += s; }, err: (s) => { err += s; } });
    return { code, out, err };
  } finally { spy.mockRestore(); }
}

beforeAll(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  const home = tmp();
  Object.assign(process.env, {
    HOME: home, XDG_CONFIG_HOME: join(home, '.config'),
    GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
    GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
  });
  // A configured Stack repo: user config, $STACK_REPO and $STACK_DIR all name it.
  configured = tmp();
  git(configured, 'init', '-q', '-b', 'main');
  mkdirSync(join(configured, '.xe/config'), { recursive: true });
  writeFileSync(join(configured, '.xe/config/stack.json'), '{}\n');
  mkdirSync(join(configured, 'tasks'));
  writeFileSync(join(configured, 'tasks/.gitkeep'), '');
  git(configured, 'add', '-A');
  git(configured, 'commit', '-q', '-m', 'seed');
  mkdirSync(join(home, '.config/stack'), { recursive: true });
  writeFileSync(join(home, '.config/stack/config.json'), JSON.stringify({ repo: configured }));
  process.env.STACK_REPO = configured;
  process.env.STACK_DIR = configured;
});

afterAll(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
});

describe('stack init', () => {
  it('initializes the current folder, not the configured repo', async () => {
    const here = tmp();
    git(here, 'init', '-q', '-b', 'main');
    const r = await cli(here, 'init');
    expect(r.code).toBe(0);
    expect(existsSync(join(here, 'tasks/.gitkeep'))).toBe(true);
    expect(existsSync(join(here, '.xe/config/stack.json'))).toBe(true);
    expect(commits(here)).toBe(1);
    expect(commits(configured)).toBe(1);
    expect(git(configured, 'status', '--porcelain')).toBe('');
    expect(r.out).toBe(`Initialized ${here}: tasks/.gitkeep .xe/config/stack.json\n`);
  });

  it('uses --dir over the current folder and names it in JSON', async () => {
    const target = join(tmp(), 'new');
    const r = await cli(tmp(), 'init', '--dir', target, '--json');
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toEqual({ ok: true, dir: target, created: ['repo', 'tasks/.gitkeep', '.xe/config/stack.json'] });
    expect(commits(target)).toBe(1);
    expect(commits(configured)).toBe(1);
  });

  it('uses the Stack repo above the current folder, not a new nested repo', async () => {
    const r = await cli(join(configured, 'tasks'), 'init');
    expect(r.code).toBe(0);
    expect(r.out).toBe(`Already initialized: ${configured}\n`);
    expect(existsSync(join(configured, 'tasks/.git'))).toBe(false);
  });

  it('says the repo is already initialized, with its path', async () => {
    const r = await cli(configured, 'init');
    expect(r.code).toBe(0);
    expect(r.out).toBe(`Already initialized: ${configured}\n`);
    expect(commits(configured)).toBe(1);
  });
});
