/**
 * The vertical slice against the real server: an agent writes a file, the page updates by itself; the owner answers, the agent reads it.
 * @req FR:ask-queue/live.watch @req FR:ask-queue/live.sse @req FR:ask-queue/live.quiet @req FR:ask-queue/web.live @req FR:ask-queue/flow.answer @req FR:ask-queue/cli.put
 */
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { expect, test } from '@playwright/test';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
let out: string;
let repo: string;
let server: { url: string; close(): Promise<void> };
let cli: (...a: string[]) => string;

test.describe.configure({ mode: 'serial' });
test.skip(({ isMobile }) => isMobile, 'one run is enough; the mobile layout is covered by the mocked specs');

test.beforeAll(async () => {
  out = mkdtempSync(join(tmpdir(), 'stack-live-build-'));
  execFileSync('node', [join(ROOT, 'node_modules/typescript/bin/tsc'), '-p', join(ROOT, 'tsconfig.cli.json'), '--outDir', out], { cwd: ROOT });
  repo = mkdtempSync(join(tmpdir(), 'stack-live-repo-'));
  mkdirSync(join(repo, 'tasks'));
  writeFileSync(join(repo, 'tasks/alpha.md'), '# Alpha\n\n## 🔄 Active\n\n- [ ] Write the plan 🟢\n');
  // The in-process server commits answers through GitStorage with process.env, so CI runners (no git identity) need these too.
  Object.assign(process.env, { GIT_CONFIG_GLOBAL: '/dev/null', GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' });
  const env = { ...process.env };
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: repo, env });
  execFileSync('git', ['add', '-A'], { cwd: repo, env });
  execFileSync('git', ['commit', '-q', '-m', 'init'], { cwd: repo, env });
  cli = (...a) => execFileSync('node', [join(out, 'cli/index.js'), ...a, '--dir', repo], { env, encoding: 'utf8' });
  const { startWeb } = await import(pathToFileURL(join(out, 'cli/web.js')).href);
  server = await startWeb({ dir: repo, port: 0, webDir: join(ROOT, 'web/dist'), watch: { debounceMs: 60 } });
});
test.afterAll(async () => { await server?.close(); rmSync(out, { recursive: true, force: true }); rmSync(repo, { recursive: true, force: true }); });

test('a file written by an agent appears by itself; the answer lands back in the file; the agent handles it', async ({ page }) => {
  await page.goto(`${server.url}/#/asks`);
  await expect(page.getByTestId('asks-empty')).toBeVisible();
  await expect(page.getByTestId('live-status')).toHaveText(/Live/);

  // agent writes an ask: the page re-renders with no reload and no toast
  cli('asks', 'put', 'pr-1', '--ask', 'Approve merging PR 1', '--kind', 'approve', '--from', 'cos', '--recommend', 'Approve', '--default', 'Merges at 8', '--reversible', 'yes', '--by', new Date(Date.now() + 3 * 3600_000).toISOString(), '--link', 'https://github.com/o/r/pull/1');
  await expect(page.locator('.ask-card .ask-title')).toHaveText('Approve merging PR 1', { timeout: 5000 });
  await expect(page.locator('.toast')).toHaveCount(0);
  await expect(page).toHaveTitle('(1) Stack');

  // a higher-ranked ask from another agent jumps ahead; the owner's cursor stays on the ask being read
  cli('asks', 'put', 'urgent', '--ask', 'Wire the invoice', '--kind', 'go-do', '--from', 'finance-cos', '--priority', 'crit');
  await expect(page.locator('.ask-li').first()).toContainText('Wire the invoice');
  await expect(page.locator('.ask-card .ask-title')).toHaveText('Approve merging PR 1');

  // owner approves with Enter: the file records the answer
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: /Sent · 1/ })).toBeVisible();
  await expect.poll(() => readFileSync(join(repo, 'tasks/asks/pr-1.md'), 'utf8')).toContain('- state: answered');
  expect(readFileSync(join(repo, 'tasks/asks/pr-1.md'), 'utf8')).toContain('- answer: go');
  const waiting = JSON.parse(cli('asks', 'list', '--state', 'answered', '--json'));
  expect(waiting.items.map((i: { key: string }) => i.key)).toEqual(['pr-1']);

  // agent handles it: the Sent footer clears by itself
  cli('asks', 'handle', 'pr-1', '--outcome', 'handled', '--note', 'merged');
  await expect(page.getByRole('button', { name: /Sent/ })).toHaveCount(0, { timeout: 5000 });
  await expect(page.locator('.ask-card .ask-title')).toHaveText('Wire the invoice');

  // agent resolves the last one: nothing needs the owner
  cli('asks', 'handle', 'urgent', '--outcome', 'resolved');
  await expect(page.getByTestId('asks-empty')).toBeVisible({ timeout: 5000 });
  await expect(page).toHaveTitle('Stack');
});
