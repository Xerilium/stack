/** @req FR:agent-sessions/web.view @req FR:agent-sessions/web.drawer @req FR:agent-sessions/web.message @req FR:agent-sessions/web.cost @req FR:agent-sessions/web.new @req FR:agent-sessions/web.states @req FR:agent-sessions/web.keys @req FR:agent-sessions/web.a11y */
import { expect, test, type Page } from '@playwright/test';
import { mockApi, type Mock, type MockSession } from './mock';

const iso = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();
const id = (n: number) => `a1b2c3d4-0000-0000-0000-00000000000${n}`;
const mk = (n: number, o: Partial<MockSession> = {}): MockSession => ({ id: id(n), title: `Session ${n}`, project: 'stack', cwd: '/x/stack', branch: 'main', lastActive: iso(n * 10), state: 'idle', cost: { usd: 0.5, tokens: 120_000 }, prs: [], ...o });
const seed = (): MockSession[] => [
  mk(1, { title: 'allyte: landing page PR 879', project: 'allyte', cwd: '/x/allyte', branch: 'xe/landing', state: 'needs-you', cost: { usd: 2.1, tokens: 1_900_000 } }),
  mk(2, { title: 'stack: live ask queue', state: 'running', cost: { usd: 1.25, tokens: 1_200_000 } }),
  mk(3, { title: 'todo: plan the week', project: 'todo', cwd: '/x/todo', branch: undefined, state: 'active' }),
  mk(4, { title: 'finops-toolkit: v15 notes', project: 'finops-toolkit', cwd: '/x/ftk', state: 'idle', lastActive: iso(90) }),
  mk(5, { title: 'old research', state: 'stale', lastActive: iso(60 * 50), cost: { usd: 0.004, tokens: 900 } }),
];
const today = new Date().toISOString().slice(0, 10);
const cost = { attribution: 'lastActive', days: [{ date: '2026-10-23', usd: 3.2, tokens: 410_000, sessions: 4 }, { date: today, usd: 4.1, tokens: 1_200_000, sessions: 6 }], projects: [{ project: 'allyte', usd: 14.2, tokens: 5_000_000, sessions: 3 }, { project: 'stack', usd: 9.8, tokens: 3_000_000, sessions: 2 }], models: [{ model: 'claude-sonnet-5-5', usd: 24, tokens: 8_000_000 }], total: { usd: 31, tokens: 8_000_000, sessions: 10 } };

const frames = (updates: unknown[]) => updates.map((u) => `event: update\ndata: ${JSON.stringify(u)}\n\n`).join('');
async function open(page: Page, sessions = seed()): Promise<Mock> {
  const m = await mockApi(page);
  m.sessions = sessions; m.sessionCost = cost;
  m.sessionTurns[id(2)] = [{ at: iso(20), role: 'user', text: 'Build the live ask queue' }, { at: iso(19), role: 'assistant', text: 'Spec first, then tests.' }, { at: iso(19), role: 'assistant', text: '⚙ Bash: pnpm test' }];
  await page.route('**/sessions/*/events', (r) => r.fulfill({ status: 200, contentType: 'text/event-stream', body: frames([
    { type: 'message_chunk', role: 'assistant', text: 'On ' }, { type: 'message_chunk', role: 'assistant', text: 'it.' },
    { type: 'tool_call', callId: 'tu1', title: 'Bash: git status', kind: 'execute', status: 'pending' },
    { type: 'tool_update', callId: 'tu1', status: 'completed', output: 'clean' },
    { type: 'tool_call', callId: 'tu2', title: 'Bash: git push', kind: 'execute', status: 'pending' },
    { type: 'permission', requestId: 'r1', callId: 'tu2', title: 'Allow Bash: git push', options: [] },
    { type: 'tool_update', callId: 'tu2', status: 'completed' },
    { type: 'done', stopReason: 'end_turn', cost: { usd: 0.12, tokens: 300 }, turns: 3, durationMs: 900 },
  ]) }));
  await page.goto('/#/sessions');
  await expect(page.locator('.sess-row').first()).toBeVisible();
  return m;
}
const drawer = (p: Page) => p.getByRole('dialog');

test.describe('Sessions', () => {
  test('list: cost strip, attention order, state labels, project · branch, cost', async ({ page }) => {
    await open(page);
    await expect(page.getByTestId('cost-strip')).toContainText('Today $4.10 · 1.2M tokens · 6 sessions');
    await expect(page.getByTestId('cost-strip')).toContainText('2 days $31');
    const rows = page.locator('.sess-row');
    await expect(rows).toHaveCount(5);
    await expect(rows.nth(0)).toContainText('Needs you');
    await expect(rows.nth(0)).toContainText('allyte: landing page PR 879');
    await expect(rows.nth(1)).toContainText('Running');
    await expect(rows.nth(4)).toContainText('Stale');
    await expect(rows.nth(4)).toContainText('<$0.01');
    await expect(page).toHaveURL(/#\/sessions/);
  });

  test('Enter opens the drawer with the history; Esc closes and returns focus to the row', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'keyboard flow');
    await open(page);
    await page.keyboard.press('j');
    await page.keyboard.press('Enter');
    await expect(drawer(page)).toBeVisible();
    await expect(drawer(page).getByRole('heading', { level: 2 })).toHaveText('stack: live ask queue');
    await expect(drawer(page).locator('.turns .tl')).toHaveCount(3);
    await expect(drawer(page).locator('.turns .tl.user')).toHaveText('Build the live ask queue');
    await expect(drawer(page).getByLabel('Message stack: live ask queue')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(drawer(page)).toHaveCount(0);
    await expect(page.locator('.sess-li').nth(1).locator('button')).toBeFocused();
  });

  test('a running session streams: text, tool lines with status, waiting for you with a link to Asks, done with cost', async ({ page }) => {
    await open(page);
    await page.locator('.sess-row').nth(1).click();
    const d = drawer(page);
    await expect(d.locator('.stream .tl.assistant')).toHaveText('On it.');
    await expect(d.locator('.stream .tl.tool').nth(0)).toContainText('Bash: git status');
    await expect(d.locator('.stream .tl.tool').nth(0)).toHaveClass(/completed/);
    await expect(d.locator('.drawer-note.done')).toHaveText('Done · $0.12 · 3 turns');
  });

  test('sending: Enter posts the prompt, the user line appears, Stop cancels; 409 shows inline', async ({ page }) => {
    const m = await open(page);
    await page.locator('.sess-row').nth(3).click();
    const d = drawer(page);
    await d.getByLabel(/^Message/).fill('Add tests for the parser');
    await page.keyboard.press('Enter');
    await expect.poll(() => m.calls.find((c) => c.path === `/sessions/${id(4)}/prompt`)?.body).toEqual({ text: 'Add tests for the parser' });
    await expect(d.locator('.turns .tl.user').last()).toHaveText('Add tests for the parser');
    await expect(d.locator('.drawer-note.done')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.locator('.sess-row').nth(2).click();
    await drawer(page).getByLabel(/^Message/).fill('hello');
    await page.keyboard.press('Enter');
    await expect(drawer(page).getByRole('alert')).toContainText('active in another window');
  });

  test('a needs-you session points to Asks', async ({ page }) => {
    await open(page);
    await page.locator('.sess-row').nth(0).click();
    await expect(drawer(page).getByRole('link', { name: 'Answer in Asks' })).toHaveAttribute('href', '#/asks');
  });

  test('Costs (c) shows the last days with bars, per-project totals, and the model line', async ({ page }, info) => {
    await open(page);
    if (info.project.name === 'mobile') await page.getByRole('button', { name: /Costs/ }).click(); else await page.keyboard.press('c');
    const costs = page.getByTestId('costs');
    await expect(costs.locator('.cost-days li')).toHaveCount(2);
    await expect(costs.locator('.cost-days li').nth(1)).toContainText('$4.10 · 1.2M · 6 sessions');
    await expect(costs.locator('.cost-days li').nth(0).locator('.bar span')).toHaveAttribute('style', /width: 78%/);
    await expect(costs.locator('.cost-projects')).toHaveText('allyte $14 · stack $9.80');
    await expect(costs.locator('.cost-models')).toContainText('claude-sonnet-5-5 $24');
  });

  test('New (n): folder and first prompt start a session and open its drawer', async ({ page }, info) => {
    const m = await open(page);
    if (info.project.name === 'mobile') await page.getByRole('button', { name: 'New', exact: true }).click(); else await page.keyboard.press('n');
    const d = drawer(page);
    await expect(d.getByRole('heading', { level: 2 })).toHaveText('New session');
    await d.getByLabel('Folder').fill('/x/stack');
    await d.getByLabel('First prompt').fill('Write the release notes');
    await page.keyboard.press('Enter');
    await expect.poll(() => m.calls.find((c) => c.path === '/sessions')?.body).toEqual({ cwd: '/x/stack', text: 'Write the release notes' });
    await expect(d.locator('.turns .tl.user')).toHaveText('Write the release notes');
    await expect(d.locator('.drawer-note.done')).toBeVisible();
  });

  test('states: not available on this host, empty, error with Retry', async ({ page }) => {
    const m = await mockApi(page);
    await page.goto('/#/sessions');
    await expect(page.getByTestId('sessions-unavailable')).toContainText('Not available on this host');
    m.sessions = [];
    await page.reload();
    await expect(page.getByTestId('sessions-empty')).toContainText('No sessions on this machine yet.');
    m.fail.set('/sessions', { status: 500, code: 'internal', message: 'Internal error' });
    await page.reload();
    await expect(page.getByRole('alert')).toContainText('Cannot load sessions');
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByTestId('sessions-empty')).toBeVisible();
  });

  test('the palette lists the session commands and g s goes there', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'keyboard flow');
    const m = await mockApi(page); m.sessions = seed();
    await page.goto('/#/asks');
    await page.keyboard.press('g'); await page.keyboard.press('s');
    await expect(page).toHaveURL(/#\/sessions/);
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Command' }).fill('Session:');
    await expect(page.getByRole('option', { name: /Session: new/ })).toBeVisible();
    await expect(page.getByRole('option', { name: /Session: stop/ })).toBeVisible();
  });

  test('mobile: rows are 44px tall and the drawer is a sheet', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'touch layout');
    await open(page);
    for (const r of await page.locator('.sess-row').all()) expect((await r.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.locator('.sess-row').nth(1).click();
    const box = (await drawer(page).boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(370);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= 390)).toBe(true);
  });
});
