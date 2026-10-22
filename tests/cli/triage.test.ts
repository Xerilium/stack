/**
 * @req FR:ai-triage-assist/cli.triage
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
  const d = mkdtempSync(join(tmpdir(), 'stack-tri-'));
  dirs.push(d);
  expect(stack(d, 'init').code).toBe(0);
  expect(stack(d, 'add-project', 'Alpha').code).toBe(0);
  expect(stack(d, 'add', 'alpha', 'Ship it').code).toBe(0);
  return d;
};
const file = (d: string) => readFileSync(join(d, 'tasks/alpha.md'), 'utf8');
const refOf = (d: string) => `tasks/alpha.md:${file(d).split('\n').findIndex((l) => l.includes('Ship it')) + 1}`;

beforeAll(() => {
  mkdirSync(join(ROOT, 'dist'), { recursive: true });
  build = mkdtempSync(join(ROOT, 'dist', 'tri-'));
  execFileSync('node', [join(ROOT, 'node_modules/typescript/bin/tsc'), '-p', join(ROOT, 'tsconfig.cli.json'), '--outDir', build], { cwd: ROOT });
}, 120000);
afterAll(() => { rmSync(build, { recursive: true, force: true }); for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

describe('stack triage', () => {
  it('shows the effective autonomy, sets it, adds subtasks as owner', () => {
    const d = repo();
    const ref = refOf(d);
    expect(stack(d, 'triage', ref).out).toContain('autonomy none');
    expect(stack(d, 'triage', ref, '--autonomy', 'assist').code).toBe(0);
    expect(file(d)).toContain('Ship it 🤖:assist');
    expect(stack(d, 'triage', ref).out).toContain('autonomy assist');
    const r = stack(d, 'triage', ref, '--agent', 'Draft it', '--human', 'Approve it', '--priority', '🔺');
    expect(r.code).toBe(0);
    expect(file(d)).toContain('  - [ ] 🪄 Draft it');
    expect(file(d)).toContain('  - [ ] 🙋 Approve it');
    expect(file(d)).toContain('🔺');
  });

  it('works with --json and rejects bad input with exit 2', () => {
    const d = repo();
    const ref = refOf(d);
    expect(JSON.parse(stack(d, 'triage', ref, '--json').out)).toMatchObject({ ok: true, autonomy: 'none' });
    expect(stack(d, 'triage', ref, '--autonomy', 'root').code).toBe(2);
    expect(stack(d, 'triage', ref, '--agent', 'a 🤖:full').code).toBe(2);
    expect(stack(d, 'triage').code).toBe(2);
  });

  it('is additive: help lists it and existing commands still work', () => {
    const d = repo();
    expect(stack(d, '--help').out).toContain('triage <ref>');
    expect(stack(d, 'next').code).toBe(0);
  });
});
