/** Home, round 3: priority-ordered projects, "only have 5 min", fold, inline expand, one cursor, Defer everywhere, animated Done, × close, Stack [DEMO]. */
import { expect, test, type Page } from '@playwright/test';
import { mockApi, seed, type MockTask } from './mock';

const KEYBOARD = 'keyboard';
const mk = (ref: string, text: string, project: string, extra: Partial<MockTask> = {}): MockTask => ({ ref, text, project, section: '🔄 Active', done: false, depth: 0, notes: [], ...extra });
const tasks = (): MockTask[] => [
  ...seed(), // alpha:6 is /next (1 h, due today); alpha:9 2 h; beta:4 30 m
  mk('alpha:30', 'Reply to Dana 🔹', 'alpha', { notes: ['She asked about Net 45.', 'Draft is in Outlook.'] }),
  mk('alpha:31', 'Water the plants 🔹', 'alpha'),
  mk('gamma:3', '🚨 Fix the outage 🟠', 'gamma'),
  mk('delta:3', 'Plan the offsite 🟡', 'delta'),
  mk('epsilon:3', 'Sort receipts 🟢', 'epsilon'),
  mk('zeta:3', 'Read the report 🟢', 'zeta'),
];
const demoMe = (page: Page) => page.route('**/.auth/me', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ clientPrincipal: { userDetails: 'local', identityProvider: 'local', userRoles: ['authenticated'] }, local: { mode: 'demo', repo: '/Users/me/todo', branch: 'main' }, events: false }) }));

test.describe('Home round 3', () => {
  // @req FR:web-app/home2.order @req FR:web-app/home2.five @req FR:web-app/home2.fold
  test('projects by priority, only-have-5-min, three projects then Show all', async ({ page }) => {
    await mockApi(page, { tasks: tasks() });
    await page.goto('/');
    const five = page.getByTestId('five');
    await expect(five.locator('.row .title')).toHaveText(['Reply to Dana', 'Water the plants']);
    const projects = page.getByTestId('home-projects');
    await expect(projects.locator('li:visible')).toHaveCount(3);
    await expect(page.getByTestId('up-next').locator('.row .title').first()).toHaveText('Fix the outage'); // 🚨 ranks first, so it is Up next
    await expect(projects.locator('li').first()).toContainText('Beta'); // then the next-ranked project, not alphabetical (Delta/Epsilon come later)
    await expect(page.locator('.home-projects-wrap .fold')).toBeVisible();
    await page.getByRole('button', { name: /Show all \(\d+\)/ }).click();
    await expect(projects.locator('li:visible').count()).resolves.toBeGreaterThan(3);
  });

  // @req FR:web-app/home2.expand @req FR:web-app/home2.body @req FR:web-app/home2.close @req FR:web-app/home2.defer
  test('one click expands a row in place with its body and actions; Enter opens the detail which closes with ×', async ({ page }, info) => {
    await mockApi(page, { tasks: tasks() });
    await page.goto('/');
    const row = page.locator('.row[data-ref="alpha:30"]');
    await row.locator('.title').click();
    const detail = row.locator('.row-detail');
    await expect(detail).toBeVisible();
    await expect(detail.locator('.body')).toContainText('She asked about Net 45.');
    await expect(detail.getByRole('button', { name: /Defer/ })).toBeVisible();
    await expect(page.getByText('Not now')).toHaveCount(0);
    await row.locator('.title').click();
    await expect(detail).toHaveCount(0);
    await row.locator('.title').click();
    await expect(detail).toBeVisible();
    if (info.project.name !== 'mobile') {
      await page.keyboard.press('Escape');
      await expect(detail).toHaveCount(0);
      await page.keyboard.press('Enter');
    } else await detail.getByRole('button', { name: 'Open' }).click();
    const full = page.getByRole('dialog', { name: 'Focus' });
    await expect(full).toBeVisible();
    await expect(full).toContainText('Draft is in Outlook.');
    await expect(full.getByRole('button', { name: /^Back/ })).toHaveCount(0);
    await full.getByRole('button', { name: 'Close' }).click();
    await expect(full).toHaveCount(0);
  });

  // @req FR:web-app/home2.cursor
  test('one cursor runs from NOW through Up next, 5 min and Projects', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', KEYBOARD);
    await mockApi(page, { tasks: tasks() });
    await page.goto('/');
    await expect(page.locator('.focus-block')).toHaveClass(/cursor/);
    for (let i = 0; i < 2; i++) await page.keyboard.press('j');
    await expect(page.getByTestId('up-next').locator('.row.cursor')).toHaveCount(1);
    for (let i = 0; i < 2; i++) await page.keyboard.press('j');
    await expect(page.getByTestId('five').locator('.row.cursor')).toHaveCount(1);
    for (let i = 0; i < 2; i++) await page.keyboard.press('j');
    await expect(page.getByTestId('home-projects').locator('li.cursor')).toHaveCount(1);
    await page.keyboard.press(' ');
    await expect(page.getByTestId('home-projects').locator('.row-detail')).toBeVisible();
    // the cursor never runs past the fold: the last reachable row is the third project
    for (let i = 0; i < 6; i++) await page.keyboard.press('j');
    await expect(page.getByTestId('home-projects').locator('li.cursor')).toHaveCount(1);
    await expect(page.getByTestId('home-projects').locator('li:visible').nth(2)).toHaveClass(/cursor/);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Focus' })).toBeVisible();
  });

  // @req FR:web-app/home2.expand
  test('clicks inside the detail keep it open; a focused title toggles with Space and opens with Enter', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', KEYBOARD);
    await mockApi(page, { tasks: tasks() });
    await page.goto('/');
    const row = page.locator('.row[data-ref="alpha:30"]');
    const title = row.locator('.title .text');
    await title.focus();
    await expect(title).toHaveAttribute('aria-expanded', 'false');
    await page.keyboard.press(' ');
    await expect(title).toHaveAttribute('aria-expanded', 'true');
    await page.keyboard.press(' ');
    await expect(title).toHaveAttribute('aria-expanded', 'false'); // one toggle per press
    await page.keyboard.press(' ');
    await row.locator('.row-detail .body').click();
    await expect(row.locator('.row-detail')).toBeVisible();
    await title.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Focus' })).toContainText('Reply to Dana');
  });

  // @req FR:web-app/home2.done
  test('Done draws a green check and fades the row', async ({ page }) => {
    const m = await mockApi(page, { tasks: tasks() });
    await page.goto('/');
    const row = page.locator('.row[data-ref="alpha:31"]');
    await page.route('**/api/tasks/complete', async (r) => { await new Promise((ok) => setTimeout(ok, 400)); await r.fallback(); }); // the check is drawn before the write lands
    await row.locator('.tick').click();
    await expect(row).toHaveClass(/done-anim/);
    await expect.poll(() => m.calls.find((c) => c.path === '/tasks/complete')?.body.ref).toBe('alpha:31');
  });

  // @req FR:web-app/home2.demo
  test('brand reads Stack [DEMO] in demo mode, with the mark; no banner, no path', async ({ page }, info) => {
    await mockApi(page, { tasks: tasks() });
    await demoMe(page);
    await page.goto('/');
    const brand = info.project.name === 'mobile' ? page.locator('.phone-brand') : page.locator('.rail .brand');
    await expect(brand).toHaveText('Stack [DEMO]');
    await expect(brand.locator('svg')).toHaveCount(1);
    await expect(page.getByTestId('repo-banner')).toHaveCount(0);
    await expect(page.getByTestId('repo-pill')).toHaveCount(0);
    await expect(page.getByText('/Users/me/todo')).toHaveCount(0);
  });
});
