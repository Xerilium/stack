/**
 * Parity of the CLI against a COPY of the legacy tasks. Skipped unless STACK_LEGACY_DIR is set.
 * The folder must hold `tasks/`, the legacy README.md/stack.md/projects.md/my-day.md, and optionally
 * `.xe/config/stack.json`. The folder is only read, never written.
 * @req FR:cli/parity.script
 */
import { execFileSync, spawnSync } from 'child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const LEGACY = process.env.STACK_LEGACY_DIR;
const ROOT = join(__dirname, '../..');
const d = LEGACY ? describe : describe.skip;

d('cli parity with legacy', () => {
  let build: string;
  let work: string;
  const run = (...a: string[]) => spawnSync('node', [join(build, 'cli/index.js'), ...a, '--dir', work, '--no-commit'], { encoding: 'utf8' });

  beforeAll(() => {
    mkdirSync(join(ROOT, 'dist'), { recursive: true });
    build = mkdtempSync(join(ROOT, 'dist', 'e2e-'));
    work = mkdtempSync(join(tmpdir(), 'stack-parity-work-'));
    execFileSync('node', [join(ROOT, 'node_modules/typescript/bin/tsc'), '-p', join(ROOT, 'tsconfig.cli.json'), '--outDir', build], { cwd: ROOT });
    cpSync(join(LEGACY!, 'tasks'), join(work, 'tasks'), { recursive: true });
    if (existsSync(join(LEGACY!, '.xe/config/stack.json'))) cpSync(join(LEGACY!, '.xe/config'), join(work, '.xe/config'), { recursive: true });
    // Seed the previous README/projects so ordering and footer match what legacy had.
    for (const f of ['README.md', 'projects.md']) if (existsSync(join(LEGACY!, f))) cpSync(join(LEGACY!, f), join(work, f));
  }, 120000);
  afterAll(() => { rmSync(build, { recursive: true, force: true }); rmSync(work, { recursive: true, force: true }); });

  it.each(['README.md', 'stack.md', 'projects.md'])('update reproduces %s', (f) => {
    const nowFile = join(LEGACY!, 'now.txt');
    const now = existsSync(nowFile) ? readFileSync(nowFile, 'utf8').trim() : new Date().toISOString();
    const r = run('update', '--now', now);
    expect(r.status).toBe(0);
    expect(readFileSync(join(work, f), 'utf8')).toBe(readFileSync(join(LEGACY!, f), 'utf8'));
  });
});
