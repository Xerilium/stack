/** Cards answer the pointer and the keyboard: hover and focus change the background, in light and dark. */
import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mockApi, type MockAsk } from './mock';

const ask = (key: string, extra: Partial<MockAsk> = {}): MockAsk => ({ key, state: 'open', ask: `Ask ${key}`, kind: 'approve', from: 'cos', reversible: true, priority: 'normal', blocks: 0, created: '2026-11-05T09:00:00Z', updated: '2026-11-05T09:00:00Z', score: 50, overdue: false, recommend: 'Go ahead', ...extra });
const bg = (l: Locator) => l.evaluate((el) => getComputedStyle(el).backgroundColor);
const ten = async (page: Page) => { const d = new Date(); d.setHours(10, 0, 0, 0); await page.clock.setFixedTime(d); };
/** Hover changes the background; the pointer leaves; keyboard focus inside changes it too. */
async function reacts(page: Page, card: Locator, focusIn: Locator) {
  await page.mouse.move(0, 0);
  const rest = await bg(card);
  await card.hover();
  await expect.poll(() => bg(card)).not.toBe(rest);
  await page.mouse.move(0, 0);
  await expect.poll(() => bg(card)).toBe(rest);
  await focusIn.focus();
  await expect.poll(() => bg(card)).not.toBe(rest);
  return rest;
}

// @req FR:task-detail-design/rules.nokeys
test('no button shows a key badge; the key is in the tooltip', async ({ page }, info) => {
  await ten(page);
  await mockApi(page);
  await page.goto('/#/now');
  await expect(page.getByRole('button', { name: /^Done/ })).toHaveAttribute('title', 'Done (D)');
  await expect(page.getByRole('button', { name: /^Defer/ })).toHaveAttribute('title', 'Defer (N)');
  if (info.project.name === 'desktop') {
    const rail = page.locator('.rail');
    await rail.getByRole('button', { name: /^Now/ }).hover();
    await expect(rail.getByRole('button', { name: /^Now/ })).toHaveAttribute('title', 'Now (g n)');
    await expect(rail.getByRole('button', { name: /New task/ })).toHaveAttribute('title', 'New task (C)');
  }
  await expect(page.locator('button kbd:visible, a kbd:visible')).toHaveCount(0);
});

for (const scheme of ['light', 'dark'] as const) {
  test.describe(`card hover and focus (${scheme})`, () => {
    test.skip(({ isMobile }) => isMobile, 'hover is a pointer state');
    test.beforeEach(async ({ page }) => { await page.emulateMedia({ colorScheme: scheme }); await ten(page); });

    // @req FR:product-reset/ui.taskcard
    test('Now: a Waiting on you card', async ({ page }) => {
      const m = await mockApi(page);
      m.asks = [ask('a1')];
      await page.goto('/#/now');
      const card = page.locator('.now-ask').first();
      const rest = await reacts(page, card, card.locator('.now-ask-body'));
      // dark: the card rests a shade below the panel, so hover can lift it
      if (scheme === 'dark') expect(rest).toBe('rgb(22, 22, 24)');
      expect((await new AxeBuilder({ page }).include('[data-testid="now-asks"]').analyze()).violations).toEqual([]);
    });

    test('Needs you: the ask card', async ({ page }) => {
      const m = await mockApi(page);
      m.asks = [ask('a1')];
      await page.goto('/#/asks');
      const card = page.locator('.ask-card').first();
      await reacts(page, card, card.getByRole('button').first());
      expect((await new AxeBuilder({ page }).include('.ask-card').analyze()).violations).toEqual([]);
    });

    test('My day: a block row', async ({ page }) => {
      await mockApi(page);
      await page.goto('/#/today');
      // pin one row: the cursor class moves, so the locator must not follow it
      const ref = await page.locator('.today .block:not(.meeting):not(.cursor)').first().getAttribute('data-ref');
      const what = page.locator(`.today .block[data-ref="${ref}"] .what`);
      await reacts(page, what, what.locator('.row-open'));
    });
  });
}
