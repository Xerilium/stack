/** @req FR:qm-plan/ui.route @req FR:qm-plan/ui.table @req FR:qm-plan/ui.sort @req FR:qm-plan/ui.stamp @req FR:qm-plan/ui.style */
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const PLAN = {
  version: 1, asOf: '2026-11-18T19:00:00Z',
  projects: [
    { project: 'Stack', agent: { name: 'stack-architect', sessionId: 'local_abc', url: 'https://example.com/s' }, tasks: [{ title: 'Ship QM', url: 'https://github.com/o/r/pull/1' }, { title: 'Fix CI' }], weeklyTokens: 2000000, preAckMin: 10, postReviewMin: 30 },
    { project: 'FOCUS', agent: { name: 'focus-lead' }, tasks: [], weeklyTokens: null, preAckMin: 5, postReviewMin: null },
  ],
};
async function open(page: Page, body: unknown = { plan: PLAN }) {
  await page.route('**/api/qm', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }));
  await page.goto('/#/qm');
  await expect(page.getByRole('heading', { name: 'QM plan' })).toBeVisible();
}
const projects = (page: Page) => page.locator('.qm-table tbody th').allTextContents();

test('shows the plan table, the stamp and expandable tasks', async ({ page }) => {
  await open(page);
  await expect(page.getByText(/^As of /)).toBeVisible();
  await expect(page.getByRole('columnheader')).toHaveText(['Project▲', 'Agent', 'Top 5', 'Weekly tokens', 'Pre-ack min', 'Post-review min']);
  await expect(page.getByRole('link', { name: 'stack-architect' })).toHaveAttribute('href', 'https://example.com/s');
  await expect(page.getByText('2,000,000')).toBeVisible();
  await expect(page.getByText('Pending')).toHaveCount(2);
  await page.locator('.qm-tasks summary').click();
  await expect(page.getByRole('link', { name: 'Ship QM' })).toBeVisible();
});

test('sorts by a column; a second click reverses', async ({ page }) => {
  await open(page);
  expect(await projects(page)).toEqual(['FOCUS', 'Stack']);
  await page.getByRole('button', { name: 'Weekly tokens' }).click();
  await expect(page.getByRole('columnheader', { name: 'Weekly tokens' })).toHaveAttribute('aria-sort', 'ascending');
  expect(await projects(page)).toEqual(['Stack', 'FOCUS']);
  await page.getByRole('button', { name: 'Project' }).click();
  await page.getByRole('button', { name: 'Project' }).click();
  await expect(page.getByRole('columnheader', { name: 'Project' })).toHaveAttribute('aria-sort', 'descending');
  expect(await projects(page)).toEqual(['Stack', 'FOCUS']);
});

test('no plan', async ({ page }) => {
  await open(page, { plan: null });
  await expect(page.getByText('No plan yet.')).toBeVisible();
});

test('axe: no violations, light and dark; the page never scrolls sideways', async ({ page }) => {
  await open(page);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => v.id)).toEqual([]);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
