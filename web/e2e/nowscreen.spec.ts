/** Now: one task, one reason, Done / Defer / Delegate with Undo, an empty state. */
import { expect, test } from '@playwright/test';
import { mockApi, seed } from './mock';

const ten = async (page: import('@playwright/test').Page) => { const d = new Date(); d.setHours(10, 0, 0, 0); await page.clock.setFixedTime(d); };

test.describe('Now screen', () => {
  // @req FR:now-screen/now.one @req FR:now-screen/now.why @req FR:now-screen/now.layout
  test('shows the one task, one reason, three actions, and nothing else', async ({ page }, info) => {
    await ten(page);
    await mockApi(page, { tasks: seed() });
    await page.goto('/#/now');
    const now = page.getByTestId('now');
    await expect(now.getByRole('heading', { level: 1 })).toHaveText('Ship the web app'); // the task Home shows
    await expect(page.getByTestId('now-why')).toHaveText(/^due today · high priority · fits your /);
    expect((await page.getByTestId('now-why').innerText()).length).toBeLessThanOrEqual(60);
    await expect(now.getByRole('button')).toHaveText([/^Done/, /^Defer/, /^Delegate/]);
    expect(await now.locator('li, table').count()).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // the action targets are 44 px on touch
    if (info.project.name === 'mobile') for (const b of await now.getByRole('button').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.waitForTimeout(400); // past the enter motion
    await page.screenshot({ path: `e2e/screenshots/now-${info.project.name}.png` });
  });

  // @req FR:now-screen/now.actions @req FR:now-screen/now.undo @req FR:now-screen/now.next
  test('Done completes, shows the next task, and Undo brings the first back', async ({ page }) => {
    await ten(page);
    const m = await mockApi(page, { tasks: seed() });
    await page.goto('/#/now');
    await page.getByRole('button', { name: /^Done/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('Ship the web app'); // the next one takes its place
    expect(m.calls.some((c) => c.path === '/tasks/complete' && c.body.ref === 'alpha:6')).toBe(true);
    await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ship the web app');
  });

  test('Defer parks the row for 2 hours; Undo resumes it', async ({ page }) => {
    await ten(page);
    const m = await mockApi(page, { tasks: seed() });
    await page.goto('/#/now');
    await page.getByRole('button', { name: /^Defer/ }).click();
    expect(m.calls.some((c) => c.path === '/tasks/suspend' && c.body.hours === 2)).toBe(true);
    await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('Ship the web app');
    await expect(page.getByRole('status')).toContainText('Deferred 2h');
    await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ship the web app');
  });

  test('Delegate adds 🪄; Undo removes it', async ({ page }) => {
    await ten(page);
    const m = await mockApi(page, { tasks: seed() });
    await page.goto('/#/now');
    await page.getByRole('button', { name: /^Delegate/ }).click();
    await expect.poll(() => m.tasks.find((t) => t.ref === 'alpha:6')!.text.startsWith('🪄')).toBe(true);
    await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => m.tasks.find((t) => t.ref === 'alpha:6')!.text.startsWith('🪄')).toBe(false);
  });

  // @req FR:now-screen/now.actions (desktop keys)
  test('keys d / n act on the task', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'keys are for desktop');
    await ten(page);
    const m = await mockApi(page, { tasks: seed() });
    await page.goto('/#/now');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ship the web app');
    await page.keyboard.press('d');
    await expect.poll(() => m.calls.some((c) => c.path === '/tasks/complete')).toBe(true);
  });

  // @req FR:now-screen/now.empty
  test('empty state: Nothing now, no buttons', async ({ page }, info) => {
    await ten(page);
    await mockApi(page, { tasks: [] });
    await page.goto('/#/now');
    await expect(page.getByTestId('now-empty')).toContainText('Nothing now');
    await expect(page.getByTestId('now-empty')).toContainText('You are clear.');
    await expect(page.getByTestId('now').getByRole('button')).toHaveCount(0);
    await page.waitForTimeout(400); // past the enter motion
    await page.screenshot({ path: `e2e/screenshots/now-empty-${info.project.name}.png` });
  });

  test('dark theme', async ({ page }, info) => {
    await ten(page);
    await page.emulateMedia({ colorScheme: 'dark' });
    await mockApi(page, { tasks: seed() });
    await page.goto('/#/now');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForTimeout(400); // past the enter motion
    await page.screenshot({ path: `e2e/screenshots/now-dark-${info.project.name}.png` });
  });
});
