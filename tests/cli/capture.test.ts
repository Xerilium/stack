/**
 * @req FR:quick-capture/cli.cmd
 */
import { execFileSync, spawnSync } from 'child_process';
import { mkdtempSync, readFileSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const ROOT = join(__dirname, '../..');
const NOW = '2026-10-22T17:00:00Z';
let build: string;
const dirs: string[] = [];
const ENV = {
  ...process.env,
  GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t',
};
const stack = (dir: string, ...args: string[]) => {
  const r = spawnSync('node', [join(build, 'cli/index.js'), ...args, '--dir', dir, '--now', NOW], { env: ENV, encoding: 'utf8' });
  return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
};
const repo = () => {
  const d = mkdtempSync(join(tmpdir(), 'stack-cap-'));
  dirs.push(d);
  expect(stack(d, 'init').code).toBe(0);
  expect(stack(d, 'add-project', 'Alpha').code).toBe(0);
  return d;
};

beforeAll(() => {
  mkdirSync(join(ROOT, 'dist'), { recursive: true });
  build = mkdtempSync(join(ROOT, 'dist', 'cap-'));
  execFileSync('node', [join(ROOT, 'node_modules/typescript/bin/tsc'), '-p', join(ROOT, 'tsconfig.cli.json'), '--outDir', build], { cwd: ROOT });
}, 120000);
afterAll(() => { rmSync(build, { recursive: true, force: true }); for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

describe('stack capture', () => {
  it('adds a parsed task and commits', () => {
    const d = repo();
    const r = stack(d, 'capture', 'call dentist tomorrow 30m #alpha');
    expect(r.code).toBe(0);
    expect(r.out).toContain('added tasks/alpha.md:');
    expect(readFileSync(join(d, 'tasks/alpha.md'), 'utf8')).toContain('- [ ] 📅 Oct 23: Call dentist 🟢');
  });

  it('joins unquoted words and takes --project', () => {
    const d = repo();
    expect(stack(d, 'capture', 'pay', 'rent', 'every', 'Monday', '--project', 'alpha').code).toBe(0);
    expect(readFileSync(join(d, 'tasks/alpha.md'), 'utf8')).toContain('📅 Monday: 🔄 Weekly: Pay rent');
  });

  it('--dry-run writes nothing; --json includes spec', () => {
    const d = repo();
    const before = readFileSync(join(d, 'tasks/alpha.md'), 'utf8');
    const r = stack(d, 'capture', 'x tomorrow', '--project', 'alpha', '--dry-run', '--json');
    expect(r.code).toBe(0);
    expect(JSON.parse(r.out)).toMatchObject({ ok: true, spec: { title: 'X', due: '2026-10-23' } });
    expect(readFileSync(join(d, 'tasks/alpha.md'), 'utf8')).toBe(before);
  });

  it('usage errors: empty, unparseable, no project, unknown project', () => {
    const d = repo();
    expect(stack(d, 'capture').code).toBe(2);
    expect(stack(d, 'capture', 'tomorrow', '--project', 'alpha').code).toBe(2);
    expect(stack(d, 'capture', 'do thing').code).toBe(2);
    expect(stack(d, 'capture', 'do thing #ghost').code).toBe(2);
  });
});
