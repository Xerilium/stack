/** @req FR:qm-plan/ui.table @req FR:qm-plan/ui.back */
import { expect, test } from '@playwright/test';

const PLAN = {
  version: 1, asOf: '2026-11-18T19:00:00Z',
  projects: [{ project: 'Stack', agent: { name: 'stack-architect', sessionId: 'local_11aa9613-132f' }, tasks: [{ title: 'Ship QM' }], weeklyTokens: 25_000_000, preAckMin: 10, postReviewMin: 30 }],
};

test.beforeEach(async ({ page }) => {
  await page.route('**/api/qm', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ plan: PLAN }) }));
  await page.goto('/#/qm');
  await expect(page.getByRole('heading', { name: 'QM plan' })).toBeVisible();
});

test('no session id text; compact tokens with the raw value on hover', async ({ page }) => {
  await expect(page.locator('main')).not.toContainText('local_');
  await expect(page.getByRole('cell', { name: 'stack-architect' })).toHaveAttribute('title', 'local_11aa9613-132f');
  await expect(page.getByRole('cell', { name: '25M', exact: true })).toHaveAttribute('title', '25,000,000');
});

test('Back is a quiet icon button: 44 px target, no underline, visible focus ring', async ({ page }) => {
  const back = page.getByRole('link', { name: 'Back' });
  const box = await back.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(44);
  expect(box!.width).toBeGreaterThanOrEqual(44);
  expect(await back.evaluate((e) => getComputedStyle(e).textDecorationLine)).toBe('none');
  await back.focus();
  await page.keyboard.press('Shift+Tab'); await page.keyboard.press('Tab');
  expect(await back.evaluate((e) => getComputedStyle(e).outlineStyle)).toBe('solid');
  await back.click();
  await expect(page).toHaveURL(/#\/now$/);
});
