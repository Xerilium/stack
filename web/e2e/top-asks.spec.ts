/**
 * Top asks: the top task overall and one row per other project, live.
 * @req FR:top-asks/top.one @req FR:top-asks/top.rows @req FR:top-asks/top.row @req FR:top-asks/top.live @req FR:top-asks/top.status
 */
import { expect, test, type Page } from '@playwright/test';
import { dateTag, mockApi, seed, type MockTask } from './mock';

const mk = (ref: string, text: string, project: string, extra: Partial<MockTask> = {}): MockTask => ({ ref, text, project, section: '🔄 Active', done: false, depth: 0, notes: [], ...extra });
const tasks = (): MockTask[] => [
  ...seed(), // alpha:6 is on top; alpha:9 and beta:4 are the next ranked rows
  mk('gamma:3', `📅 ${dateTag(-2)}: Chase the invoice 🔹`, 'gamma'),
  mk('delta:3', 'Plan the offsite 🟡', 'delta'),
  mk('alpha:30', 'Reply to Dana 🔹', 'alpha'),
];
const ten = async (page: Page) => { const d = new Date(); d.setHours(10, 0, 0, 0); await page.clock.install({ time: d }); };

test.describe('Top asks', () => {
  test('NOW, then one row per other project; no Up next, no 5-minute list, no fold', async ({ page }, info) => {
    await ten(page);
    await mockApi(page, { tasks: tasks() });
    await page.goto('/');
    await page.clock.resume();
    await expect(page.getByTestId('next-title')).toContainText('Ship the web app');
    const list = page.getByTestId('top-asks');
    await expect(list.locator('li')).toHaveCount(3); // beta, gamma, delta; alpha is NOW
    await expect(list.locator('li .proj-link')).toHaveText(['Gamma', 'Beta', 'Delta']);
    await expect(list.locator('li').first()).toContainText('Chase the invoice');
    await expect(list.locator('li').first().getByTestId('countdown')).toHaveText('2d late');
    await expect(page.getByTestId('up-next')).toHaveCount(0);
    await expect(page.getByTestId('five')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Show all \(/ })).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `e2e/screenshots/top-asks-${info.project.name}.png`, fullPage: true });
  });

  test('a click opens a row in place; the project name opens its Full stack', async ({ page }) => {
    await ten(page);
    await mockApi(page, { tasks: tasks() });
    await page.goto('/');
    await page.clock.resume();
    const row = page.getByTestId('top-asks').locator('li', { hasText: 'Plan the offsite' });
    await row.locator('.proj-top').click();
    await expect(row.locator('.row-detail')).toBeVisible();
    await row.getByRole('button', { name: 'Delta' }).click();
    await expect(page).toHaveURL(/#\/list.*project=delta/);
  });

  test('j and k run one cursor from NOW through the rows', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'keyboard');
    await ten(page);
    await mockApi(page, { tasks: tasks() });
    await page.goto('/');
    await page.clock.resume();
    await expect(page.locator('.focus-block')).toHaveClass(/cursor/);
    await page.keyboard.press('j');
    await expect(page.getByTestId('top-asks').locator('li').first()).toHaveClass(/cursor/);
    await page.keyboard.press('j'); await page.keyboard.press('j');
    await expect(page.getByTestId('top-asks').locator('li').nth(2)).toHaveClass(/cursor/);
  });

  // @req FR:top-asks/top.live
  test('a change from elsewhere updates the rows in place: new top task, a project gone, cursor stays, no toast', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'keyboard');
    await ten(page);
    const m = await mockApi(page, { tasks: tasks() });
    m.rev = 'r1';
    await page.goto('/');
    await page.clock.resume();
    const list = page.getByTestId('top-asks');
    await expect(list.locator('li')).toHaveCount(3);
    await expect(page.getByTestId('top-live')).toHaveCount(1);
    await page.keyboard.press('j'); // gamma
    await expect(list.locator('li').first()).toHaveClass(/cursor/);
    // another writer: Delta's work is done, Beta gets a new top row that ranks first
    m.tasks.find((t) => t.ref === 'delta:3')!.done = true;
    m.tasks.push(mk('beta:9', 'Pay the deposit 🟢', 'beta'));
    m.ranked = [{ ref: 'alpha:6' }, { ref: 'beta:9' }, { ref: 'gamma:3' }, { ref: 'beta:4' }];
    m.rev = 'r2';
    await page.clock.fastForward(16_000);
    await expect(list.locator('li')).toHaveCount(2);
    await expect(list.locator('li').first()).toContainText('Pay the deposit');
    await expect(list.locator('li.cursor')).toContainText('Chase the invoice'); // the cursor stays on the same task
    await expect(page.locator('.toast')).toHaveCount(0);
    await expect(page.getByTestId('top-count')).toHaveText('2 projects');
  });
});
