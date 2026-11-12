/**
 * Phone (375 x 812) and desktop (1280 x 800) polish: tap size, no sideways scroll, axe clean, empty states that name the next step.
 * @req FR:first-run-onboarding/polish.tap @req FR:first-run-onboarding/polish.overflow @req FR:first-run-onboarding/polish.contrast @req FR:first-run-onboarding/polish.empty
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mockApi } from './mock';

const VIEWS = ['today', 'projects', 'list', 'inbox'] as const;

async function open(page: Page, view: string, scheme: 'light' | 'dark') {
  await page.emulateMedia({ colorScheme: scheme });
  await mockApi(page);
  await page.goto(`/#/${view}`);
  // A fresh load per scheme: a same-document goto keeps the old styles and the color transitions would blend.
  await page.reload();
  await expect(page.locator('.main')).toBeVisible();
  await page.waitForTimeout(400);
}

/** Controls a finger must hit, in the visible content and the nav. */
const TARGETS = 'main button:visible, main a:visible, main select:visible, .tabbar button:visible, .tabbar a:visible';

for (const scheme of ['light', 'dark'] as const) {
  for (const view of VIEWS) {
    test(`${view} (${scheme}): axe clean, no sideways scroll, touch targets`, async ({ page }, info) => {
      await open(page, view, scheme);
      const { violations } = await new AxeBuilder({ page }).analyze();
      const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').flatMap((v) => v.nodes.map((n) => `${v.id} ${n.target.join(' ')}`));
      expect(bad, bad.join('\n')).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      const min = info.project.name === 'mobile' ? 44 : 24;
      const small = await page.locator(TARGETS).evaluateAll((els, m) => els.map((e) => { const r = e.getBoundingClientRect(); return { h: Math.round(r.height), what: `${e.className || e.tagName} "${(e.textContent ?? '').trim().slice(0, 30)}"` }; }).filter((x) => x.h > 0 && x.h < m), min);
      expect(small, JSON.stringify(small, null, 1)).toEqual([]);
    });
  }
}

test.describe('empty states name the next step', () => {
  test('Full stack with no match: says so and offers Clear filters', async ({ page }) => {
    await mockApi(page);
    await page.goto('/#/list?q=zzzz-nothing');
    const e = page.getByTestId('empty-state');
    await expect(e).toContainText('No tasks match.');
    await e.getByRole('button', { name: 'Clear filters' }).click();
    await expect(page.locator('.row').first()).toBeVisible();
  });

  test('Inbox zero: names the next step', async ({ page }) => {
    await mockApi(page);
    await page.goto('/#/inbox');
    const e = page.getByTestId('empty-state');
    await expect(e).toContainText('Inbox zero. Nothing needs you.');
    await expect(e.getByRole('link', { name: 'Back to Now' })).toHaveAttribute('href', '#/now');
  });

  test('My day with nothing that fits: names the key', async ({ page }) => {
    await mockApi(page, { tasks: [] });
    await page.goto('/#/today');
    await expect(page.getByTestId('empty-state')).toContainText(/Add (something|some)/);
  });
});
