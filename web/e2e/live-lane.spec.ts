/** @req FR:pr-review-lane/panel.view @req FR:pr-review-lane/panel.chip @req FR:pr-review-lane/panel.check @req FR:pr-review-lane/panel.comment @req FR:pr-review-lane/panel.fix @req FR:pr-review-lane/panel.add @req FR:pr-review-lane/panel.a11y */
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

const AT = '2026-11-11T18:00:00Z';
type Item = { id: string; text: string; by: string; state: string; comment?: string; createdAt: string; updatedAt: string };
function seed() {
  return {
    state: 'ready-for-michael', rev: 3, done: [],
    active: { repo: 'o/r', number: 12, url: 'https://github.com/o/r/pull/12', title: 'Fix export', state: 'ready-for-michael', by: 'live-1', serverUrl: 'http://localhost:5176' },
    items: [
      { id: 'li-00000001', text: 'Sign in works', by: 'live-1', state: 'open', createdAt: AT, updatedAt: AT },
      { id: 'li-00000002', text: 'Export CSV has headers', by: 'live-1', state: 'passed', createdAt: AT, updatedAt: AT },
    ] as Item[],
  };
}
async function open(page: Page, lane: ReturnType<typeof seed> | { state: string; rev: number; items: Item[]; done: [] } = seed()) {
  const posts: Record<string, unknown>[] = [];
  let n = 3;
  await page.route('**/api/live', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(lane) }));
  await page.route('**/api/live/items', async (r) => {
    const b = r.request().postDataJSON() as { op: string; id?: string; text?: string };
    posts.push(b);
    const S: Record<string, string> = { check: 'passed', uncheck: 'open', 'needs-fix': 'needs-fix' };
    let it = lane.items.find((i) => i.id === b.id);
    if (b.op === 'add') { it = { id: `li-0000000${++n}`, text: b.text!, by: 'owner', state: 'open', createdAt: AT, updatedAt: AT }; lane.items.push(it); }
    if (it && S[b.op]) it.state = S[b.op];
    if (it && (b.op === 'comment' || (b.op === 'needs-fix' && b.text))) it.comment = b.text;
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ changed: true, item: it }) });
  });
  await page.goto('/#/live');
  await expect(page.getByRole('heading', { name: 'Live validation' })).toBeVisible();
  return posts;
}

test('shows the live PR, the server link, the chip and the items', async ({ page }) => {
  await open(page);
  await expect(page.getByTestId('lane-chip')).toHaveText('Ready for you');
  await expect(page.getByRole('link', { name: 'Fix export o/r#12' })).toHaveAttribute('href', 'https://github.com/o/r/pull/12');
  await expect(page.getByRole('link', { name: 'Open app' })).toHaveAttribute('href', 'http://localhost:5176');
  await expect(page.locator('.lv-item')).toHaveCount(2);
  await expect(page.locator('.lv-item').first()).toContainText('by live-1');
});

test('tap toggles passed and open', async ({ page }) => {
  const posts = await open(page);
  await page.getByRole('checkbox', { name: 'Passed: Sign in works' }).click();
  await expect(page.getByRole('checkbox', { name: 'Passed: Sign in works' })).toHaveAttribute('aria-checked', 'true');
  await page.getByRole('checkbox', { name: 'Passed: Export CSV has headers' }).click();
  await expect(page.getByRole('checkbox', { name: 'Passed: Export CSV has headers' })).toHaveAttribute('aria-checked', 'false');
  expect(posts).toEqual([{ op: 'check', repo: 'o/r', number: 12, id: 'li-00000001' }, { op: 'uncheck', repo: 'o/r', number: 12, id: 'li-00000002' }]);
});

test('comment, needs fix with a note, and add an item', async ({ page }) => {
  const posts = await open(page);
  const row = page.locator('.lv-item').first();
  await row.getByRole('button', { name: 'Comment' }).click();
  await row.getByRole('textbox', { name: 'Comment' }).fill('Button is off by 2 px');
  await row.getByRole('button', { name: 'Needs fix' }).click();
  await expect(row).toContainText('Needs fix');
  await expect(row).toContainText('Button is off by 2 px');
  await page.getByRole('textbox', { name: 'Add a check' }).fill('Dark mode contrast');
  await page.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(page.locator('.lv-item')).toHaveCount(3);
  await expect(page.locator('.lv-item').last()).toContainText('by you');
  expect(posts).toEqual([{ op: 'needs-fix', repo: 'o/r', number: 12, id: 'li-00000001', text: 'Button is off by 2 px' }, { op: 'add', repo: 'o/r', number: 12, text: 'Dark mode contrast' }]);
});

test('long press opens the comment box; save sends comment', async ({ page }) => {
  const posts = await open(page);
  const row = page.locator('.lv-item').nth(1);
  const box = await row.locator('.lv-text').boundingBox();
  await page.mouse.move(box!.x + 5, box!.y + 5);
  await page.mouse.down();
  await page.waitForTimeout(650);
  await page.mouse.up();
  await row.getByRole('textbox', { name: 'Comment' }).fill('Looks right');
  await row.getByRole('button', { name: 'Save comment' }).click();
  await expect(row).toContainText('Looks right');
  expect(posts).toEqual([{ op: 'comment', repo: 'o/r', number: 12, id: 'li-00000002', text: 'Looks right' }]);
});

test('agent working chip and the idle state', async ({ page }) => {
  const s = seed(); s.state = 'working'; s.active.state = 'working';
  await open(page, s);
  await expect(page.getByTestId('lane-chip')).toHaveText('Agent working');
  await page.unroute('**/api/live');
  await page.route('**/api/live', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ state: 'idle', rev: 1, items: [], done: [] }) }));
  await page.reload();
  await expect(page.getByText('No PR in live validation.')).toBeVisible();
});

test('axe: no violations, 44 px targets on touch, no sideways scroll', async ({ page, isMobile }) => {
  await open(page);
  await page.locator('.lv-item').first().getByRole('button', { name: 'Comment' }).click();
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    const { violations } = await new AxeBuilder({ page }).analyze();
    expect(violations.map((v) => v.id)).toEqual([]);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  if (isMobile) {
    for (const b of await page.locator('.lv button, .lv a.btn, .lv input').all()) {
      const r = await b.boundingBox();
      if (r) expect(r.height).toBeGreaterThanOrEqual(44);
    }
  }
});

// @req FR:pr-review-lane/panel.refresh
test('reloads the lane every 15 s while visible', async ({ page }) => {
  await page.clock.install();
  const lane = seed();
  await open(page, lane);
  await expect(page.locator('.lv-item')).toHaveCount(2);
  lane.items.push({ id: 'li-00000009', text: 'Agent added a check', by: 'live-1', state: 'open', createdAt: AT, updatedAt: AT });
  lane.state = 'working'; lane.active.state = 'working';
  await page.clock.runFor(15_500);
  await expect(page.locator('.lv-item')).toHaveCount(3);
  await expect(page.getByTestId('lane-chip')).toHaveText('Agent working');
});
