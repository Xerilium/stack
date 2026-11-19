/**
 * One page header on each page: one h1 with the page name, and the count after it.
 * @req FR:ui-kit/header @req FR:web-app/list.view @req FR:web-app/week.days
 */
import { expect, test } from '@playwright/test';
import { mockApi, seed } from './mock';

test('Projects: one h1, the project count, and This week as a section', async ({ page }) => {
  await mockApi(page, { tasks: seed() });
  await page.goto('/#/projects');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(['Projects']);
  await expect(page.locator('.ui-head-meta')).toHaveText(/^\d+ projects?$/);
  await expect(page.getByRole('heading', { level: 2, name: 'This week' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 2, name: 'All projects' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'All projects' })).toBeVisible();
});

test('Full stack: one h1 and the count of tasks that match', async ({ page }) => {
  await mockApi(page, { tasks: seed() });
  await page.goto('/#/list');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(['Full stack']);
  const count = page.getByTestId('list-count');
  await expect(count).toHaveText(/^\d+ tasks?$/);
  const all = await count.textContent();
  await page.getByLabel('Search tasks').fill('zzzz-no-match');
  await expect(count).toHaveText('0 tasks');
  expect(all).not.toBe('0 tasks');
});
