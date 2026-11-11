/** One ranking, the CoS's Needs you, and a quiet Home. */
import { expect, test } from '@playwright/test';
import { mockApi, type MockNeed } from './mock';

const need = (over: Partial<MockNeed> = {}): MockNeed => ({ id: 'pay-bills', title: 'Pay bills tonight', recommendation: 'Pay USAA first', default: 'I wait until Monday', link: 'https://example.test/bills', project: 'alpha', ...over });

test.describe('Home draws the server ranking', () => {
  // @req FR:web-app/now.active @req FR:web-app/home.one @req FR:top-asks/top.rows
  test('NOW and Top asks follow GET /rank, not anything the page works out itself', async ({ page }) => {
    const m = await mockApi(page);
    m.ranked = [{ ref: 'beta:4' }, { ref: 'alpha:9' }, { ref: 'alpha:6' }]; // the owner put "Plan the trip" first
    await page.goto('/#/home');
    await expect(page.getByTestId('next-title')).toContainText('Plan the trip');
    await expect(page.getByTestId('top-asks').locator('.proj-top')).toHaveText(['Review pull requests']); // alpha's top row; beta is NOW
  });

  // @req FR:web-app/home.one @req FR:task-lifecycle/rank.root
  test('a ranked leaf shows as its top-level row', async ({ page }) => {
    const m = await mockApi(page);
    m.tasks.push({ ref: 'alpha:20', text: 'Pay bills 💰', project: 'alpha', section: '🔄 Active', done: false, depth: 0, notes: [] } as never);
    m.tasks.push({ ref: 'alpha:21', text: 'Mortgage', project: 'alpha', section: '🔄 Active', done: false, depth: 1, notes: [] } as never);
    m.ranked = [{ ref: 'alpha:21', root: 'alpha:20' }, { ref: 'alpha:6' }];
    await page.goto('/#/home');
    await expect(page.getByTestId('next-title')).toContainText('Pay bills');
  });
});

test.describe('My day takes the whole-day ranking', () => {
  // @req FR:web-app/today.plan
  test('the page asks for blocks=any and keeps a failed whole-day ranking from blanking Home', async ({ page }) => {
    const m = await mockApi(page);
    await page.goto('/#/home');
    await expect(page.getByTestId('next-title')).toBeVisible();
    expect(m.rankQueries.some((q) => q.includes('blocks=any'))).toBe(true);
  });
});

test.describe('Needs you from the Chief of Staff', () => {
  // @req FR:ask-queue/needs.web @req FR:ask-queue/needs.web.card
  test('CoS items come first with the recommendation, the default if silent, and a link', async ({ page }) => {
    const m = await mockApi(page);
    m.needs = [need(), need({ id: 'second', title: 'Second thing', recommendation: 'Do it' })];
    await page.goto('/#/asks');
    await expect(page.locator('.ask-card .ask-title')).toHaveText('Pay bills tonight');
    await expect(page.locator('.ask-card')).toContainText('Pay USAA first');
    await expect(page.locator('.ask-card')).toContainText('I wait until Monday');
    await expect(page.locator('.ask-card').getByRole('button', { name: /Go with it/ })).toBeVisible();
  });

  // @req FR:ask-queue/needs.answer @req FR:ask-queue/needs.web.answered
  test('Go with it records the answer on the item and offers Undo, which clears it', async ({ page }) => {
    const m = await mockApi(page);
    m.needs = [need()];
    await page.goto('/#/asks');
    await page.locator('.ask-card').getByRole('button', { name: /Go with it/ }).click();
    await expect.poll(() => m.calls.find((c) => c.path === '/needs-you/pay-bills/answer')?.body).toMatchObject({ choice: 'go' });
    await expect(page.getByText(/Going with it/)).toBeVisible();
    await expect(page.locator('.ask-card .ask-title')).toHaveCount(0); // gone from the list
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => m.calls.filter((c) => c.path === '/needs-you/pay-bills/answer').at(-1)?.body).toMatchObject({ choice: 'undo' });
    await expect(page.locator('.ask-card .ask-title')).toHaveText('Pay bills tonight');
  });

  // @req FR:web-app/home3.dedupe @req FR:ask-queue/needs.dedupe
  test('a task that is in Needs you is not on Home', async ({ page }) => {
    const m = await mockApi(page);
    m.needs = [need({ ref: 'alpha:6' })]; // the NOW task
    await page.goto('/#/home');
    await expect(page.getByTestId('next-title')).not.toContainText('Ship the web app');
    await expect(page.locator('section[aria-label="Home"]')).not.toContainText('Ship the web app');
    await page.goto('/#/asks');
    await expect(page.locator('.ask-card .ask-title')).toHaveText('Pay bills tonight');
  });

  // @req FR:ask-queue/needs.read
  test('no file or an empty one changes nothing', async ({ page }) => {
    await mockApi(page);
    await page.goto('/#/home');
    await expect(page.getByTestId('next-title')).toContainText('Ship the web app');
  });
});

test.describe('Quiet Home', () => {
  // @req FR:web-app/home3.keys
  test('key hints stay hidden until the first key press; every control carries its key in its tooltip', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'keyboard');
    await mockApi(page);
    await page.goto('/#/home');
    const focus = page.locator('.focus-block');
    await expect(focus.getByRole('button', { name: /^Start/ })).toHaveAttribute('title', /\(s\)/);
    await expect(focus.getByRole('button', { name: /^Done/ })).toHaveAttribute('title', /\(d\)/);
    await expect(focus.locator('kbd:visible')).toHaveCount(0);
    await page.keyboard.press('j');
    await expect(focus.locator('kbd:visible').first()).toBeVisible();
  });

  // @req FR:web-app/home3.menu
  test('the … menu holds Defer 2h, Defer…, Delegate and Open, and closes on Esc and on a click outside', async ({ page }) => {
    await mockApi(page);
    await page.goto('/#/home');
    const focus = page.locator('.focus-block');
    await expect(focus.getByTestId('more-menu')).toHaveCount(0);
    await focus.getByTestId('more').click();
    await expect(focus.getByRole('menuitem')).toHaveText([/Defer 2h/, /Defer…/, /Delegate/, /Open/]);
    await page.keyboard.press('Escape');
    await expect(focus.getByTestId('more-menu')).toHaveCount(0);
    await focus.getByTestId('more').click();
    await page.locator('.home-window .window').click(); // outside the menu (the menu covers what is below the card)
    await expect(focus.getByTestId('more-menu')).toHaveCount(0);
  });

  // @req FR:web-app/home3.menu.keys
  test('the … menu takes focus, moves with the arrow keys, returns focus on Esc, and closes on Tab', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'keyboard');
    const m = await mockApi(page);
    await page.goto('/#/home');
    const focus = page.locator('.focus-block');
    await focus.getByTestId('more').click();
    await expect(focus.getByRole('menuitem', { name: /Defer 2h/ })).toBeFocused();
    const before = await page.locator('.cursor').first().getAttribute('data-ref');
    await page.keyboard.press('ArrowDown');
    await expect(focus.getByRole('menuitem', { name: /Defer…/ })).toBeFocused();
    expect(await page.locator('.cursor').first().getAttribute('data-ref')).toBe(before); // the arrow moved the menu, not the Home cursor
    await page.keyboard.press('n'); // a key inside the open menu is not the global defer
    expect(m.calls.some((c) => c.path === '/tasks/suspend')).toBe(false);
    await page.keyboard.press('End');
    await expect(focus.getByRole('menuitem', { name: /Open/ })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(focus.getByTestId('more')).toBeFocused();
    await focus.getByTestId('more').click();
    await page.keyboard.press('Tab');
    await expect(focus.getByTestId('more-menu')).toHaveCount(0);
  });

  // @req FR:web-app/home3.menu
  test('Open from the menu opens the task full screen', async ({ page }) => {
    await mockApi(page);
    await page.goto('/#/home');
    await page.locator('.focus-block').getByTestId('more').click();
    await page.getByRole('menuitem', { name: /Open/ }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
  });

  // @req FR:web-app/home3.context
  test('the context line says late only when overdue', async ({ page }) => {
    const m = await mockApi(page);
    const ten = new Date(); ten.setHours(10, 0, 0, 0); await page.clock.setFixedTime(ten); // fit follows the clock; CI runs in UTC, past the work day
    const t = m.tasks.find((x) => x.ref === 'alpha:6')!;
    await page.goto('/#/home');
    await expect(page.getByTestId('now-context')).not.toContainText('late');
    const ago = new Date(Date.now() - 3 * 864e5); // inside the overdue window, whatever today is
    t.text = `📅 ${ago.toLocaleString('en-US', { month: 'short' })} ${ago.getDate()}: Ship the web app 🟠`;
    await page.reload();
    await expect(page.getByTestId('now-context')).toContainText('late');
  });
});

test.describe('Needs you cursor', () => {
  // @req FR:ask-queue/needs.web
  test('a CoS item that arrives after the asks took the card: the cursor follows the top item', async ({ page }) => {
    const m = await mockApi(page);
    m.asks = [{ key: 'pr-1', state: 'open', ask: 'Review PR 1', kind: 'approve', from: 'cos', project: 'alpha', reversible: true, priority: 'normal', blocks: 0, created: '2026-10-31T10:00:00Z', updated: '2026-10-31T10:00:00Z', score: 60, overdue: false }];
    m.needs = [need()];
    await page.route('**/api/needs-you', async (route) => { await new Promise((ok) => setTimeout(ok, 600)); await route.fallback(); }); // the file loads after the asks
    await page.goto('/#/asks');
    await expect(page.locator('.ask-card .ask-title')).toHaveText('Pay bills tonight');
  });
});
