/**
 * The Needs you count shows one value on a cold load: it waits for the server asks and the task asks.
 * @req FR:ask-queue/web.home.count @req FR:ask-queue/web.home.count.once @req FR:ask-queue/web.home.count.live
 */
import { expect, test } from '@playwright/test';
import { mockApi, type MockAsk } from './mock';

const iso = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const ask = (key: string): MockAsk => ({ key, state: 'open', ask: `Ask ${key}`, kind: 'go-do', from: 'cos', reversible: true, priority: 'normal', blocks: 0, created: iso(60), updated: iso(30), score: 50, overdue: false });

test('cold load: the badge and title show one value, never an intermediate one', async ({ page }) => {
  const m = await mockApi(page);
  m.asks = [ask('k1'), ask('k2')];
  m.needs = [
    { id: 'n1', title: 'Approve the plan', recommendation: 'Go', link: 'https://example.com/1' },
    { id: 'n2', title: 'Pick a date', recommendation: 'Friday', link: 'https://example.com/2' },
  ];
  // The CoS file answers late: the server asks are in long before it.
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  await page.route('**/api/needs-you', async (route) => { await gate; await route.fallback(); });
  // Record every value the badge and the title take.
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __seen: string[] }).__seen = seen;
    const note = () => {
      const b = [...document.querySelectorAll('[data-testid="nav-notifications"] .badge')].map((x) => x.textContent).join(',');
      const v = `${b}|${document.title}`;
      if (seen[seen.length - 1] !== v) seen.push(v);
    };
    new MutationObserver(note).observe(document, { subtree: true, childList: true, characterData: true });
  });
  const asksIn = page.waitForResponse((r) => new URL(r.url()).pathname === '/api/asks');
  await page.goto('/#/now');
  await asksIn;
  await expect(page.locator('[data-testid="nav-notifications"]:visible')).toBeVisible();
  await page.waitForTimeout(200); // let the page render what it has
  // Server asks are loaded, the CoS items are not: no count yet.
  await expect(page.locator('[data-testid="nav-notifications"]:visible .badge')).toHaveCount(0);
  release();
  await expect(page.locator('[data-testid="nav-notifications"]:visible .badge')).toHaveText('4');
  await expect(page).toHaveTitle('(4) Stack');
  const seen = await page.evaluate(() => (window as unknown as { __seen: string[] }).__seen);
  const counts = [...new Set(seen.flatMap((v) => v.split('|')[0].split(',')).filter(Boolean))];
  const titles = [...new Set(seen.map((v) => v.split('|')[1]).filter((t) => t !== 'Stack'))];
  expect(counts).toEqual(['4']);
  expect(titles).toEqual(['(4) Stack']);
});

test('after the first count, a live change shows at once', async ({ page }) => {
  const m = await mockApi(page);
  m.asks = [ask('k1')];
  await page.goto('/#/now');
  await expect(page.locator('[data-testid="nav-notifications"]:visible .badge')).toHaveText('1');
  m.asks = [ask('k1'), ask('k2')];
  m.rev = null; // the next probe reloads
  await expect(page.locator('[data-testid="nav-notifications"]:visible .badge')).toHaveText('2', { timeout: 20_000 });
  await expect(page).toHaveTitle('(2) Stack');
});
