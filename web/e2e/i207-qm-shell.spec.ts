/**
 * The QM plan keeps the app shell: the rail on desktop, the tab bar on phones, one main landmark, one scroll container.
 * @req FR:web-shell/nav.pages @req FR:web-shell/nav.pages.current @req FR:web-shell/nav.pages.scroll @req FR:web-shell/nav.pages.keys @req FR:qm-plan/ui.route
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mockApi } from './mock';

const PLAN = {
  version: 1, asOf: '2026-11-18T19:00:00Z',
  projects: Array.from({ length: 30 }, (_, i) => ({ project: `P${String(i).padStart(2, '0')}`, agent: { name: `agent-${i}` }, tasks: [], weeklyTokens: null, preAckMin: null, postReviewMin: null })),
};
async function open(page: Page) {
  await mockApi(page);
  await page.route('**/api/qm', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ plan: PLAN }) }));
  await page.goto('/#/qm');
  await expect(page.getByRole('heading', { name: 'QM plan' })).toBeVisible();
}

test('the rail (desktop) or the tab bar (phone) stays, and no nav item is current', async ({ page }, info) => {
  await open(page);
  const bar = info.project.name === 'mobile' ? page.locator('.tabbar') : page.locator('nav.rail');
  await expect(bar).toBeVisible();
  await expect(bar.locator('[aria-current="page"]')).toHaveCount(0);
  await expect(page.getByRole('main')).toHaveCount(1);
  // the nav still works from here
  await bar.getByRole('button', { name: /^Now/ }).first().click();
  await expect(page).toHaveURL(/#\/now$/);
  await expect(page.getByRole('heading', { name: 'QM plan' })).toHaveCount(0);
  await expect(bar.locator('[aria-current="page"]')).toHaveCount(1);
});

test('one scroll container: the last row scrolls clear of the phone tab bar', async ({ page }, info) => {
  await open(page);
  expect(await page.locator('.qm').evaluate((e) => getComputedStyle(e).overflowY)).toBe('visible');
  test.skip(info.project.name !== 'mobile', 'the tab bar is phone only');
  await page.locator('.main').evaluate((m) => { m.scrollTop = m.scrollHeight; });
  const last = (await page.locator('.qm-table tbody tr').last().boundingBox())!;
  const tab = (await page.locator('.tabbar').boundingBox())!;
  expect(last.y + last.height).toBeLessThanOrEqual(tab.y + 1);
});

test('row keys do nothing on the QM page; the palette still opens', async ({ page }) => {
  const m = await mockApi(page);
  await page.route('**/api/qm', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ plan: PLAN }) }));
  await page.goto('/#/qm');
  await expect(page.getByRole('heading', { name: 'QM plan' })).toBeVisible();
  await page.locator('.qm-title').click();
  for (const k of ['d', 'n', 'Shift+A']) await page.keyboard.press(k);
  await page.waitForTimeout(300);
  expect(m.calls.filter((c) => c.path.startsWith('/tasks'))).toEqual([]);
  await page.keyboard.press(':');
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('desktop: no empty header landmark', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'desktop only');
  await open(page);
  await expect(page.getByRole('banner')).toHaveCount(0);
});

test('axe: no landmark or contrast issues on the QM page in the shell', async ({ page }) => {
  await open(page);
  const r = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
  expect(r.violations.map((v) => v.id)).toEqual([]);
});
