/**
 * End-to-end: runs the real built CLI against temp git repos.
 * @req FR:cli/run.bin @req FR:cli/run.dir @req FR:cli/run.git @req FR:cli/run.nocommit @req FR:cli/run.remote @req FR:cli/run.now @req FR:cli/run.help
 * @req FR:cli/ref.format @req FR:cli/ref.default @req FR:cli/ref.invalid @req FR:cli/ref.expect
 * @req FR:cli/cmd.init @req FR:cli/cmd.add-project @req FR:cli/cmd.add @req FR:cli/cmd.next @req FR:cli/cmd.start @req FR:cli/cmd.complete
 * @req FR:cli/cmd.skip @req FR:cli/cmd.resume @req FR:cli/cmd.suspend @req FR:cli/cmd.set @req FR:cli/cmd.remove-completed @req FR:cli/cmd.update
 * @req FR:cli/out.text @req FR:cli/out.json @req FR:cli/out.quiet @req FR:cli/out.codes @req FR:cli/arch.thin @req FR:cli/arch.storage
 */
import { execFileSync, spawnSync } from 'child_process';
import { mkdtempSync, readFileSync, writeFileSync, existsSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const ROOT = join(__dirname, '../..');
const NOW = '2026-10-22T17:00:00Z';
let build: string;
const dirs: string[] = [];

const ENV: NodeJS.ProcessEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
};

function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'stack-cli-'));
  dirs.push(d);
  return d;
}

interface Out { code: number; out: string; err: string }
function stack(dir: string | null, ...args: string[]): Out {
  const a = [join(build, 'cli/index.js'), ...args, ...(dir ? ['--dir', dir] : [])];
  const r = spawnSync('node', a, { env: ENV, encoding: 'utf8' });
  return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
}
const git = (dir: string, ...a: string[]) => execFileSync('git', a, { cwd: dir, env: ENV, encoding: 'utf8' }).trim();
const commits = (dir: string) => Number(git(dir, 'rev-list', '--count', 'HEAD'));
const file = (dir: string, p: string) => readFileSync(join(dir, p), 'utf8');

/** A repo with one project "alpha" and the given tasks in Active. */
function repo(...tasks: string[]): string {
  const d = tmp();
  expect(stack(d, 'init').code).toBe(0);
  expect(stack(d, 'add-project', 'Alpha', '--alias', 'a', '--weekly-capacity', '20').code).toBe(0);
  for (const t of tasks) expect(stack(d, 'add', 'alpha', t).code).toBe(0);
  return d;
}

beforeAll(() => {
  mkdirSync(join(ROOT, 'dist'), { recursive: true });
  build = mkdtempSync(join(ROOT, 'dist', 'e2e-'));
  execFileSync('node', [join(ROOT, 'node_modules/typescript/bin/tsc'), '-p', join(ROOT, 'tsconfig.cli.json'), '--outDir', build], { cwd: ROOT });
}, 120000);
afterAll(() => { rmSync(build, { recursive: true, force: true }); for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

describe('run', () => {
  it('has a bin entry with a shebang', () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
    expect(pkg.bin.stack).toBe('dist/cli/index.js');
    expect(readFileSync(join(build, 'cli/index.js'), 'utf8').startsWith('#!/usr/bin/env node')).toBe(true);
  });

  it('prints help and version', () => {
    const h = stack(null, '--help');
    expect(h.code).toBe(0);
    expect(h.out).toContain('add-project');
    expect(stack(null).out).toContain('remove-completed');
    expect(stack(null, '--version').out.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  it('rejects unknown commands and flags as usage errors', () => {
    expect(stack(null, 'bogus').code).toBe(2);
    expect(stack(repo(), 'next', '--bogus', 'x').code).toBe(2);
  });

  it('fails with a hint outside a git work tree', () => {
    const d = tmp();
    const r = stack(d, 'next');
    expect(r.code).toBe(1);
    expect(r.err).toContain('stack init');
    expect(r.out).toBe('');
  });
});

describe('init', () => {
  it("runs git init for a subfolder of a parent repo", () => {
    const parent = tmp();
    git(parent, "init", "-q", "-b", "main");
    const sub = join(parent, "sub");
    expect(stack(sub, "init").code).toBe(0);
    expect(existsSync(join(sub, ".git"))).toBe(true);
    expect(commits(sub)).toBe(1);
    expect(git(parent, "rev-list", "--all", "--count")).toBe("0");
  });

  it("rejects non-finite and non-decimal numbers", () => {
    const d = repo();
    for (const bad of ["Infinity", "0x10", "1e3"]) {
      const r = stack(d, "add-project", "Beta", "--priority", bad);
      expect(r.code).toBe(2);
    }
  });

  it('creates the repo, files, and one commit; second run changes nothing', () => {
    const d = join(tmp(), 'new');
    const r = stack(d, 'init');
    expect(r.code).toBe(0);
    expect(existsSync(join(d, '.git'))).toBe(true);
    expect(file(d, '.xe/config/stack.json')).toBe('{}\n');
    expect(existsSync(join(d, 'tasks/.gitkeep'))).toBe(true);
    expect(commits(d)).toBe(1);
    expect(git(d, 'status', '--porcelain')).toBe('');
    expect(stack(d, 'init').code).toBe(0);
    expect(commits(d)).toBe(1);
  });
});

describe('commands', () => {
  it('add-project creates the file and commits; refuses to overwrite', () => {
    const d = repo();
    expect(file(d, 'tasks/alpha.md')).toContain('# Alpha');
    expect(file(d, 'tasks/alpha.md')).toContain('**Aliases:** a');
    expect(git(d, 'log', '-1', '--format=%s')).toBe('Add project: Alpha');
    expect(stack(d, 'add-project', 'Alpha').code).toBe(3);
    expect(stack(d, 'add-project', 'Alpha', '--force').code).toBe(0);
  });

  it('add by alias prints a 1-based ref and commits', () => {
    const d = repo();
    const before = commits(d);
    const r = stack(d, 'add', 'a', 'Write', 'the', 'spec', '💰');
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^added tasks\/alpha\.md:\d+ /);
    expect(file(d, 'tasks/alpha.md')).toContain('- [ ] Write the spec 💰');
    expect(commits(d)).toBe(before + 1);
    expect(stack(d, 'add', 'nope', 'x').code).toBe(2);
    expect(stack(d, 'add', 'alpha').code).toBe(2);
  });

  it('add --section and --parent', () => {
    const d = repo('Parent');
    stack(d, 'add', 'alpha', 'Later', '--section', 'Backlog');
    const lines = file(d, 'tasks/alpha.md').split('\n');
    expect(lines.findIndex(l => l.includes('Later'))).toBeGreaterThan(lines.findIndex(l => l.includes('Backlog')));
    const ref = `tasks/alpha.md:${lines.findIndex(l => l.includes('Parent')) + 1}`;
    expect(stack(d, 'add', 'alpha', 'Child', '--parent', ref).code).toBe(0);
    expect(file(d, 'tasks/alpha.md')).toContain('  - [ ] Child');
  });

  it('next prints ref, score, project, text; exit 4 when none', () => {
    const d = repo();
    const none = stack(d, 'next', '--now', NOW);
    expect(none.code).toBe(4);
    expect(none.out).toBe('');
    stack(d, 'add', 'alpha', 'Low 🔻');
    stack(d, 'add', 'alpha', 'High 🚨 ⬆️');
    const r = stack(d, 'next', '--now', NOW);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^tasks\/alpha\.md:\d+ [\d.]+ Alpha High/);
    const j = JSON.parse(stack(d, 'next', '--now', NOW, '--json').out);
    expect(j.ok).toBe(true);
    expect(j.text).toContain('High');
    expect(j.ref.line).toBeGreaterThan(0);
    expect(j.ref.path).toBe('tasks/alpha.md');
  });

  it('start and complete the top task, and by explicit ref', () => {
    const d = repo('🚨 One', 'Two');
    const before = commits(d);
    const s = stack(d, 'start', '--now', NOW);
    expect(s.code).toBe(0);
    expect(s.out).toMatch(/^started tasks\/alpha\.md:\d+ /);
    expect(file(d, 'tasks/alpha.md')).toContain('- [ ] 🚨 🚧 One');
    expect(stack(d, 'start', '--now', NOW).out).toMatch(/^no change:/);
    expect(commits(d)).toBe(before + 1);
    const c = stack(d, 'complete', '--now', NOW, '--summary', 'done it');
    expect(c.code).toBe(0);
    expect(file(d, 'tasks/alpha.md')).toContain('- [x] 🚨 One');
    expect(file(d, 'tasks/alpha.md')).toContain('✅ **COMPLETED**: done it');
    const line = file(d, 'tasks/alpha.md').split('\n').findIndex(l => l.includes('Two')) + 1;
    expect(stack(d, 'complete', `tasks/alpha.md:${line}`, '--now', NOW).code).toBe(0);
    expect(file(d, 'tasks/alpha.md')).toContain('- [x] Two');
  });

  // @req FR:task-lifecycle/complete.recurring @req FR:config/load.validate.shift-weekends
  it('stack.json shiftWeekends controls recurring rolls', () => {
    for (const [cfg, want] of [['{}', 'Nov 23, 2026'], ['{"shiftWeekends":false}', 'Nov 22, 2026']] as const) {
      const d = repo('📅 Oct 22, 2026: 🔄 Monthly: Pay bills');
      writeFileSync(join(d, '.xe/config/stack.json'), cfg);
      const line = file(d, 'tasks/alpha.md').split('\n').findIndex(l => l.includes('Pay bills')) + 1;
      expect(stack(d, 'complete', `tasks/alpha.md:${line}`, '--now', NOW).code).toBe(0);
      expect(file(d, 'tasks/alpha.md')).toContain(`📅 ${want}: 🔄 Monthly`);
    }
    const bad = repo('x');
    writeFileSync(join(bad, '.xe/config/stack.json'), '{"shiftWeekends":"no"}');
    expect(stack(bad, 'next', '--now', NOW).err).toContain('shiftWeekends');
  });

  it('complete --remove deletes the row; remove-completed prunes done rows', () => {
    const d = repo('ItemA', 'ItemB');
    const line = (t: string) => file(d, 'tasks/alpha.md').split('\n').findIndex(l => l.includes(t)) + 1;
    stack(d, 'complete', `tasks/alpha.md:${line('ItemA')}`);
    stack(d, 'complete', `tasks/alpha.md:${line('ItemB')}`, '--remove');
    expect(file(d, 'tasks/alpha.md')).not.toContain('ItemB');
    const r = stack(d, 'remove-completed');
    expect(r.out.trim()).toBe('removed 1');
    expect(file(d, 'tasks/alpha.md')).not.toContain('[x]');
    expect(stack(d, 'remove-completed', '--project', 'nope').code).toBe(2);
    expect(JSON.parse(stack(d, 'remove-completed', '--json').out)).toMatchObject({ ok: true, removed: 0 });
  });

  it('skip then resume', () => {
    const d = repo('Only');
    const s = stack(d, 'skip', '--now', NOW);
    expect(s.out).toMatch(/^skipped /);
    expect(file(d, 'tasks/alpha.md')).toContain('- [ ] 🅿️ Only');
    expect(stack(d, 'park', '--now', NOW).code).toBe(4); // nothing left to park
    expect(stack(d, 'resume').out).toMatch(/^resumed /);
    expect(file(d, 'tasks/alpha.md')).toContain('- [ ] Only');
    expect(stack(d, 'resume').out).toMatch(/^no change:/);
  });

  it('suspend with days and hours; both is a usage error', () => {
    const d = repo('Nap');
    expect(stack(d, 'suspend', '--hours', '2', '--now', NOW).out).toMatch(/^suspended /);
    expect(file(d, 'tasks/alpha.md')).toMatch(/- \[ \] 💤 12:00: Nap/);
    const d2 = repo('Nap');
    stack(d2, 'suspend', '--days', '3', '--now', NOW);
    expect(file(d2, 'tasks/alpha.md')).toContain('💤 Oct 25: Nap');
    expect(stack(d2, 'suspend', '--days', '1', '--hours', '1', '--now', NOW).code).toBe(2);
  });

  it('set status/priority/checkbox; invalid emoji is a usage error', () => {
    const d = repo('Thing');
    const ref = `tasks/alpha.md:${file(d, 'tasks/alpha.md').split('\n').findIndex(l => l.includes('Thing')) + 1}`;
    expect(stack(d, 'set', ref, '--priority', '🚨', '--status', '🚧', '--effort', '🟢', '--impact', '⬆️').code).toBe(0);
    expect(file(d, 'tasks/alpha.md')).toContain('- [ ] 🚨 🚧 Thing 🟢 ⬆️');
    stack(d, 'set', ref, '--priority', 'none', '--checkbox', 'complete');
    expect(file(d, 'tasks/alpha.md')).toContain('- [x] 🚧 Thing 🟢 ⬆️');
    stack(d, 'set', ref, '--remove-emojis');
    expect(file(d, 'tasks/alpha.md')).toContain('- [x] Thing');
    expect(stack(d, 'set', ref, '--status', 'x').code).toBe(2);
    expect(stack(d, 'set').code).toBe(2);
    expect(stack(d, 'set', 'bad-ref', '--status', 'none').code).toBe(2);
  });

  it('ref that is not a task line is a usage error', () => {
    const d = repo('X');
    expect(stack(d, 'start', 'tasks/alpha.md:1').code).toBe(2);
    expect(stack(d, 'start', 'tasks/alpha.md').code).toBe(2);
  });

  it('json mode reports results and errors on stdout', () => {
    const d = repo('J');
    const r = JSON.parse(stack(d, 'start', '--json', '--now', NOW).out);
    expect(r).toMatchObject({ ok: true, changed: true });
    expect(r.after).toContain('🚧');
    const e = stack(d, 'add', 'nope', 'x', '--json');
    expect(e.code).toBe(2);
    expect(JSON.parse(e.out)).toMatchObject({ ok: false, code: 2 });
    expect(e.err).toBe('');
  });
});

describe('update', () => {
  it('writes the four summaries, commits changed files only, and is stable', () => {
    const d = repo('Plan 🚨 ⬆️', 'Ship');
    const before = commits(d);
    const r = stack(d, 'update', '--now', NOW);
    expect(r.code).toBe(0);
    expect(r.out).toMatch(/^updated /);
    for (const f of ['README.md', 'stack.md', 'projects.md', 'my-day.md']) expect(existsSync(join(d, f))).toBe(true);
    expect(file(d, 'stack.md')).toContain('Plan');
    expect(commits(d)).toBeGreaterThan(before);
    expect(git(d, 'status', '--porcelain')).toBe('');
    const mid = commits(d);
    const again = stack(d, 'update', '--now', NOW);
    expect(again.out).toMatch(/^no change/);
    expect(commits(d)).toBe(mid);
    // summary files are not task files
    expect(stack(d, 'next', '--now', NOW).code).toBe(0);
  });

  it('leaves my-day.md alone when there are no tasks', () => {
    const d = repo();
    expect(stack(d, 'update', '--now', NOW).code).toBe(0);
    expect(existsSync(join(d, 'my-day.md'))).toBe(false);
    expect(existsSync(join(d, 'README.md'))).toBe(true);
  });

  it('--sweep reactivates due suspended tasks first', () => {
    const d = repo('Nap');
    stack(d, 'suspend', '--hours', '1', '--now', NOW);
    stack(d, 'update', '--sweep', '--now', '2026-10-22T20:00:00Z');
    expect(file(d, 'tasks/alpha.md')).toContain('- [ ] Nap');
    expect(file(d, 'tasks/alpha.md')).not.toContain('💤');
  });
});

describe('update lifecycle gaps', () => {
  // @req FR:cli/cmd.update
  it('makes ONE commit for all changed summary files', () => {
    const d = repo('Plan', 'Ship');
    const before = commits(d);
    expect(stack(d, 'update', '--now', NOW).out).toMatch(/^updated README.md/);
    expect(commits(d)).toBe(before + 1);
    expect(git(d, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort()).toEqual(['README.md', 'my-day.md', 'projects.md', 'stack.md']);
  });

  // @req FR:cli/cmd.update
  it('--sweep escalates due dates and commits task files once, then summaries once', () => {
    const d = repo('Pay 📅 Oct 22: bill', 'Nap');
    stack(d, 'update', '--now', NOW);
    const before = commits(d);
    stack(d, 'update', '--sweep', '--now', NOW);
    expect(file(d, 'tasks/alpha.md')).toContain('‼️ Pay 📅 Oct 22: bill');
    expect(commits(d)).toBe(before + 2);
  });

  // @req FR:cli/cmd.update
  it('--queries refreshes query tasks (fake gh on PATH); off by default', () => {
    const d = repo('Q 🔎 @GitHub/xerilium/stack (is:open)');
    const bin = tmp();
    writeFileSync(join(bin, 'gh'), '#!/bin/sh\necho \'{"data":{"search":{"nodes":[{"__typename":"Issue","title":"T1","url":"https://x/1"}]}}}\'\n', { mode: 0o755 });
    const oldPath = ENV.PATH;
    ENV.PATH = `${bin}:${oldPath}`;
    try {
      expect(stack(d, 'update', '--now', NOW, '--json').out).not.toContain('queries');
      expect(file(d, 'tasks/alpha.md')).not.toContain('🌐');
      const j = JSON.parse(stack(d, 'update', '--queries', '--now', NOW, '--json').out);
      expect(j.queries.processed).toBe(1);
      expect(j.queries.failures).toEqual([]);
    } finally { ENV.PATH = oldPath; }
    expect(file(d, 'tasks/alpha.md')).toContain('- [ ] 🌐 T1 — https://x/1');
    expect(git(d, 'status', '--porcelain')).toBe('');
  });

  // @req FR:cli/cmd.update
  it('--queries reports failures without failing the command', () => {
    const d = repo('Q 🔎 @Nope/x/y (a)');
    const j = JSON.parse(stack(d, 'update', '--queries', '--now', NOW, '--json').out);
    expect(j.ok).toBe(true);
    expect(j.queries.failures).toHaveLength(1);
  });

  // @req FR:cli/ref.expect
  it('--expect guards stale refs (exit 3, nothing changed)', () => {
    const d = repo('One', 'Two');
    const line = file(d, 'tasks/alpha.md').split('\n').findIndex(l => l.includes('Two')) + 1;
    const ref = `tasks/alpha.md:${line}`;
    const before = commits(d);
    const bad = stack(d, 'start', ref, '--expect', 'One', '--now', NOW);
    expect(bad.code).toBe(3);
    expect(bad.err).toMatch(/^error: /);
    expect(commits(d)).toBe(before);
    expect(stack(d, 'start', ref, '--expect', 'Two', '--now', NOW).code).toBe(0);
    expect(file(d, 'tasks/alpha.md')).toContain('🚧 Two');
  });
});

describe('no-commit and remote', () => {
  it('--no-commit edits files in a plain directory', () => {
    const d = tmp();
    mkdirSync(join(d, 'tasks'));
    writeFileSync(join(d, 'tasks/p.md'), '# P\n\n## 🔄 Active\n\n- [ ] Hi\n');
    expect(stack(d, 'start', '--no-commit', '--now', NOW).code).toBe(0);
    expect(file(d, 'tasks/p.md')).toContain('- [ ] 🚧 Hi');
    expect(existsSync(join(d, '.git'))).toBe(false);
  });

  it('pushes with --remote and reports a stale clone as a conflict (exit 3)', () => {
    const root = tmp();
    const bare = join(root, 'origin.git');
    git(root, 'init', '-q', '--bare', '-b', 'main', bare);
    const a = join(root, 'a');
    stack(a, 'init');
    stack(a, 'add-project', 'Alpha');
    stack(a, 'add', 'alpha', 'Shared');
    git(a, 'remote', 'add', 'origin', bare);
    git(a, 'push', '-q', 'origin', 'main');
    git(root, 'clone', '-q', bare, join(root, 'b'));
    const b = join(root, 'b');
    const line = file(a, 'tasks/alpha.md').split('\n').findIndex(l => l.includes('Shared')) + 1;
    const ref = `tasks/alpha.md:${line}`;
    expect(stack(b, 'start', ref, '--remote', 'origin').code).toBe(0);
    git(root, 'clone', '-q', bare, join(root, 'c'));
    expect(file(join(root, 'c'), 'tasks/alpha.md')).toContain('🚧 Shared');
    // a never fetched: its local copy is stale, so the write must conflict
    const r = stack(a, 'complete', ref, '--remote', 'origin');
    expect(r.code).toBe(3);
    expect(r.err).toMatch(/^error: /);
    expect(file(a, 'tasks/alpha.md')).not.toContain('[x]');
  });
});
