/** @req FR:auto-priority/tag.cli @req FR:auto-priority/explain.cli @req FR:auto-priority/truth.report */
import { execFileSync, spawnSync } from 'child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const ROOT = join(__dirname, '../..');
const NOW = '2026-11-05T12:00:00Z';
let build: string;
const dirs: string[] = [];
const ENV: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
function stack(dir: string, ...args: string[]) {
  const r = spawnSync('node', [join(build, 'cli/index.js'), ...args, '--dir', dir], { env: ENV, encoding: 'utf8' });
  return { code: r.status ?? -1, out: r.stdout, err: r.stderr };
}
function repo(): string {
  const d = mkdtempSync(join(tmpdir(), 'stack-tag-'));
  dirs.push(d);
  expect(stack(d, 'init').code).toBe(0);
  expect(stack(d, 'add-project', 'Catalyst', '--alias', 'cat').code).toBe(0);
  expect(stack(d, 'add', 'catalyst', 'Catalyst 0.3.4 release 🟡').code).toBe(0);
  expect(stack(d, 'add', 'catalyst', 'Other chore 🟢').code).toBe(0);
  return d;
}
beforeAll(() => {
  mkdirSync(join(ROOT, 'dist'), { recursive: true });
  build = mkdtempSync(join(ROOT, 'dist', 'e2e-'));
  execFileSync('node', [join(ROOT, 'node_modules/typescript/bin/tsc'), '-p', join(ROOT, 'tsconfig.cli.json'), '--outDir', build], { cwd: ROOT });
}, 120000);
afterAll(() => { rmSync(build, { recursive: true, force: true }); for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

describe('stack tag', () => {
  it('sets and clears unblocker and due, one commit each', () => {
    const d = repo();
    const ref = 'tasks/catalyst.md:' + (readFileSync(join(d, 'tasks/catalyst.md'), 'utf8').split('\n').findIndex((l) => l.includes('0.3.4')) + 1);
    expect(stack(d, 'tag', ref, '--unblocker', 'yes', '--due', 'Nov 12').code).toBe(0);
    const row = readFileSync(join(d, 'tasks/catalyst.md'), 'utf8').split('\n').find((l) => l.includes('0.3.4'))!;
    expect(row).toContain('🔓');
    expect(row).toContain('📅 Nov 12:');
    expect(stack(d, 'tag', ref, '--unblocker', 'no', '--due', 'none').code).toBe(0);
    expect(readFileSync(join(d, 'tasks/catalyst.md'), 'utf8')).not.toMatch(/🔓|📅/);
  });
  it('rejects no flags, bad values', () => {
    const d = repo();
    expect(stack(d, 'tag', 'tasks/catalyst.md:5').code).toBe(2);
    expect(stack(d, 'tag', 'tasks/catalyst.md:5', '--unblocker', 'maybe').code).toBe(2);
    expect(stack(d, 'tag', 'tasks/catalyst.md:5', '--due', 'soon').code).not.toBe(0);
  });
});

describe('stack rank --explain', () => {
  it('prints parts; unblocker ranks first; truth report lists missing and untagged', () => {
    const d = repo();
    const truth = join(d, 'truth.md');
    writeFileSync(truth, '| Rank | Project | Work | Hard date | Why |\n| - | - | - | - | - |\n| 1 | catalyst | 0.3.4 release: sweeps | Nov 9 | Unblocks FH |\n| 4 | ftk | Update v16 PRs | - | Pipeline |\n');
    const a = stack(d, 'rank', '--engine', 'autopri', '--explain', '--truth', truth, '--now', NOW);
    expect(a.code).toBe(0);
    expect(a.out).toMatch(/unblock=0/);
    expect(a.out).toMatch(/untagged.*stack tag/s);
    expect(a.out).toMatch(/missing.*stack add ftk/s);
    const ref = 'tasks/catalyst.md:' + (readFileSync(join(d, 'tasks/catalyst.md'), 'utf8').split('\n').findIndex((l) => l.includes('0.3.4')) + 1);
    stack(d, 'tag', ref, '--unblocker', 'yes');
    const b = JSON.parse(stack(d, 'rank', '--engine', 'autopri', '--explain', '--truth', truth, '--now', NOW, '--json').out);
    expect(b.items[0].text).toContain('0.3.4');
    expect(b.items[0].parts.unblock).toBe(4000);
    expect(b.truth.find((t: { item: { project: string } }) => t.item.project === 'catalyst').status).toBe('ranked');
    expect(stack(d, 'rank', '--explain', '--now', NOW).code).toBe(2);
  });
});
