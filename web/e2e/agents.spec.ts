/** Agents view: the name, pins, grouping. @req FR:agent-sessions/web.agents @req FR:agent-sessions/web.pins @req FR:agent-sessions/web.groups */
import { expect, test, type Page } from '@playwright/test';
import { mockApi, type MockSession } from './mock';

const iso = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
const sess = (id: string, title: string, project: string, state: MockSession['state'] = 'idle'): MockSession => ({ id, title, project, cwd: `/Users/me/dev/${project}`, lastActive: iso(10), state, cost: { usd: 1, tokens: 1000 }, prs: [] });
async function open(page: Page) {
  const m = await mockApi(page);
  m.sessions = [sess('s1', 'Fix the build', 'alpha', 'running'), sess('s2', 'Write the blog post', 'beta'), sess('s3', 'Tidy the backlog', 'alpha'), sess('s4', 'Plan the launch', 'gamma')];
  await page.goto('/#/sessions');
  await expect(page.locator('.sess-li')).toHaveCount(4);
  return m;
}

test.describe('Agents', () => {
  test('is called Agents everywhere; #/sessions still opens it', async ({ page }, info) => {
    await open(page);
    await expect(page).toHaveURL(/#\/sessions|#\/agents/);
    await expect(page.getByRole('region', { name: 'Agents' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Agents' })).toBeVisible();
    await expect(page.getByText('Sessions', { exact: true })).toHaveCount(0);
    if (info.project.name !== 'mobile') {
      await expect(page.locator('.rail').getByRole('button', { name: /^Agents/ })).toBeVisible();
      await page.keyboard.press('Control+k');
      await expect(page.locator('#palette-list')).toContainText('Go to Agents');
    }
    await page.goto('/#/agents');
    await expect(page.getByRole('region', { name: 'Agents' })).toBeVisible();
  });

  test('f pins the cursor row to the top under Pinned; the pin survives a reload', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'keyboard');
    await open(page);
    await expect(page.locator('.sess-li').first()).toContainText('Fix the build');
    await page.keyboard.press('j'); await page.keyboard.press('j');
    await expect(page.locator('.sess-li.cursor')).toContainText('Tidy the backlog');
    await page.keyboard.press('f');
    await expect(page.locator('.sess-group').first()).toHaveText('Pinned');
    await expect(page.locator('.sess-li').first()).toContainText('Tidy the backlog');
    await expect(page.locator('.sess-li').first().getByRole('button', { name: 'Unpin' })).toBeVisible();
    expect(await page.evaluate(() => localStorage.getItem('stack.pins'))).toBe('["s3"]');
    await page.reload();
    await expect(page.locator('.sess-li').first()).toContainText('Tidy the backlog');
    await page.locator('.sess-li').first().getByRole('button', { name: 'Unpin' }).click();
    await expect(page.locator('.sess-group')).toHaveCount(0);
    await expect(page.locator('.sess-li').first()).toContainText('Fix the build');
  });

  test('g p from a directly loaded Agents view navigates and leaves the grouping alone', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'keyboard');
    const m = await mockApi(page); m.sessions = [sess('s1', 'Fix the build', 'alpha')];
    await page.goto('/#/agents');
    await expect(page.locator('.sess-li')).toHaveCount(1);
    await page.keyboard.press('g'); await page.keyboard.press('p');
    await expect(page).toHaveURL(/#\/projects/);
    expect(await page.evaluate(() => localStorage.getItem('stack.agents.group'))).toBeNull();
  });

  test('By project groups the rows with one header per project', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'By project' }).click();
    await expect(page.locator('.sess-group')).toHaveText(['alpha', 'beta', 'gamma']);
    await expect(page.locator('.sess-group').first().locator('xpath=following-sibling::li[1]')).toContainText('Fix the build');
    expect(await page.evaluate(() => localStorage.getItem('stack.agents.group'))).toBe('project');
    await page.reload();
    await expect(page.locator('.sess-group')).toHaveCount(3);
  });
});
