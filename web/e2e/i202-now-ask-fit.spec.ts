/** Now `Waiting on you`: a long answer button never crushes the card or runs off a phone. @req FR:ux-consolidation/one.messages @req FR:ux-consolidation/one.expand */
import { expect, test, type Page } from '@playwright/test';
import { mockApi, seed, type MockAsk } from './mock';

const LONG = 'Complete form, grant permission, and pay before Thursday 5pm'; // 60 characters
const ask = (key: string, score: number, extra: Partial<MockAsk> = {}): MockAsk => ({ key, state: 'open', ask: `Ask ${key}`, kind: 'approve', from: 'cos', reversible: true, priority: 'normal', blocks: 0, created: '2026-11-05T09:00:00Z', updated: '2026-11-05T09:00:00Z', score, overdue: false, recommend: 'Approve', ...extra });

async function open(page: Page) {
  const d = new Date(); d.setHours(10, 0, 0, 0);
  await page.clock.install({ time: d });
  const m = await mockApi(page, { tasks: seed() });
  m.asks = [
    ask('a1', 90, { ask: 'Approve the FH 1105 spec thread' }),
    ask('a2', 80, { ask: 'Decide how to handle the school trip permission slip and fee', kind: 'decide', options: [LONG, 'Skip the trip'], recommend: LONG }),
  ];
  await page.goto('/#/now');
  await page.clock.resume();
  await expect(page.getByTestId('now-asks').locator(':scope > li')).toHaveCount(2);
  return page.getByTestId('now-asks').locator(':scope > li').nth(1);
}

for (const width of [375, 1200]) {
  test(`a 60-character decide option fits the card at ${width} px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    const card = await open(page);
    const mini = card.locator('.now-mini');
    await expect(mini).toHaveAttribute('title', LONG);
    await expect(mini).toHaveAccessibleName(LONG);
    // one line with an ellipsis
    const label = mini.locator('.now-mini-label');
    const m = await label.evaluate((el) => ({ h: el.getBoundingClientRect().height, lh: parseFloat(getComputedStyle(el).lineHeight) || 20, overflow: getComputedStyle(el).textOverflow }));
    expect(Math.round(m.h / m.lh)).toBe(1);
    expect(m.overflow).toBe('ellipsis');
    // the title keeps room: at least 20 characters fit on its first line
    const firstLine = await card.locator('.now-ask-title').evaluate((el) => {
      const r = document.createRange(); const t = el.firstChild!; const top = el.getBoundingClientRect().top; let n = 0;
      for (let i = 1; i <= (t.textContent ?? '').length; i++) { r.setStart(t, 0); r.setEnd(t, i); const rects = r.getClientRects(); if (rects[rects.length - 1].top > top + 4) break; n = i; }
      return n;
    });
    expect(firstLine).toBeGreaterThanOrEqual(20);
    // the button stays inside the card and the page never scrolls sideways
    const cb = (await card.boundingBox())!; const bb = (await mini.boundingBox())!;
    expect(bb.x + bb.width).toBeLessThanOrEqual(cb.x + cb.width + 0.5);
    expect(await page.evaluate(() => document.documentElement.scrollWidth === document.documentElement.clientWidth)).toBe(true);
  });
}

test('a click on the card padding opens the card', async ({ page }) => {
  const card = await open(page);
  const body = card.locator('.now-ask-body');
  await expect(body).toHaveAttribute('aria-expanded', 'false');
  await card.scrollIntoViewIfNeeded();
  await page.evaluate(() => window.scrollBy(0, 200)); // clear of the phone tab bar
  const box = (await card.boundingBox())!;
  await page.mouse.click(box.x + 4, box.y + 8); // the card's own padding, outside the body and the button
  await expect(body).toHaveAttribute('aria-expanded', 'true');
  await expect(card.getByTestId('now-ask-more')).toBeVisible();
});
