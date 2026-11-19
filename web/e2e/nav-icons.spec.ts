/**
 * Every nav item shows a line icon beside its label, from the one icon set, on the desktop rail and the phone tab bar.
 * @req FR:web-shell/nav.rail.icons @req FR:web-shell/nav.tabbar.icons @req FR:ui-kit/nav @req FR:ui-kit/nav.icon @req FR:ui-kit/nav.icon.muted
 */
import { expect, test } from '@playwright/test';
import { mockApi, seed } from './mock';

test('each nav item has one icon from the set; no two items share an icon; the icon is muted until its item is current', async ({ page, isMobile }) => {
  await mockApi(page, { tasks: seed() });
  await page.goto('/#/now');
  const items = page.locator(isMobile ? '.tabbar .tab' : '.rail .tab');
  await expect(items.first()).toBeVisible();
  const n = await items.count();
  expect(n).toBeGreaterThanOrEqual(isMobile ? 5 : 9);
  const names: string[] = [];
  for (const item of await items.all()) {
    const icon = item.locator('svg.ui-nav-ic');
    await expect(icon, await item.innerText()).toHaveCount(1);
    await expect(icon).toBeVisible();
    names.push((await icon.getAttribute('data-icon'))!);
    const box = (await icon.boundingBox())!;
    expect(box.width).toBe(isMobile ? 22 : 18);
    expect(box.height).toBe(box.width);
  }
  expect(new Set(names).size).toBe(names.length);
  if (isMobile) return; // the phone tab bar is muted as a whole; the current tab is the accent
  // Desktop: the icon sits left of the label, muted; the current item's icon takes the item color.
  const color = (sel: string) => page.locator(sel).first().evaluate((el) => getComputedStyle(el).color);
  const muted = await page.evaluate(() => { const p = document.createElement('i'); p.style.color = 'var(--muted)'; document.body.append(p); const c = getComputedStyle(p).color; p.remove(); return c; });
  expect(await color('.rail .tab:not(.on):not(.add) .ui-nav-ic')).toBe(muted);
  expect(await color('.rail .tab.on .ui-nav-ic')).toBe(await color('.rail .tab.on'));
  const on = page.locator('.rail .tab.on');
  const ic = (await on.locator('.ui-nav-ic').boundingBox())!, label = (await on.locator('.tab-label').boundingBox())!;
  expect(ic.x + ic.width).toBeLessThanOrEqual(label.x);
});
