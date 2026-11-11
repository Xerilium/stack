/** Home: the one thing now, whether it fits, the next two, the top of every project. */
import { expect, test } from '@playwright/test';
import { dateTag, mockApi, seed, type MockTask } from './mock';

const home = () => {
  const t = seed();
  // alpha:6 (the /next task) is 1 h and due today; alpha:9 is 2 h; beta:4 is 30 m
  t.push({ ref: 'gamma:3', text: `📅 ${dateTag(-2)}: Chase the invoice 🔹`, project: 'gamma', section: '⏭️ Up next', done: false, depth: 0, notes: [] } as MockTask);
  return t;
};

test.describe('Home', () => {
  // @req FR:web-app/home.one @req FR:top-asks/top.rows @req FR:web-app/home.projects @req FR:web-app/home.quiet
  // @req FR:web-app/home3.now @req FR:web-app/home3.context @req FR:web-app/home3.rows
  test('one thing (title, one context line, Start, Done, …), one row per other project, nothing else', async ({ page }, info) => {
    const ten = new Date(); ten.setHours(10, 0, 0, 0); await page.clock.setFixedTime(ten); // fit follows the time you have now
    await mockApi(page, { tasks: home() });
    await page.goto('/#/home');
    const one = page.getByRole('group', { name: 'Next task' });
    await expect(one.getByTestId('next-title')).toContainText('Ship the web app');
    await expect(one.getByTestId('now-context')).toHaveText('Alpha'); // project; `late` only when overdue
    // the card is five things at most: title, context line, Start, Done, …
    expect(await one.locator('h1, .context, button').count()).toBeLessThanOrEqual(5);
    await expect(one.getByTestId('expected')).toHaveCount(0);
    await expect(one.getByTestId('ends')).toHaveCount(0);
    await expect(page.getByTestId('up-next')).toHaveCount(0);
    // every other project has one row; the NOW project (alpha) is not repeated
    const projects = page.getByTestId('top-asks').locator('li');
    await expect(projects).toHaveCount(2);
    await expect(projects.locator('.proj-link')).toHaveText(['Beta', 'Gamma']); // the server's order
    await expect(projects.first()).toContainText('Plan the trip');
    await expect(projects.nth(1)).toContainText('Chase the invoice');
    await expect(projects.nth(1).getByTestId('countdown')).toHaveText('2d late');
    await expect(page.getByText(/Show all active/)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `e2e/screenshots/home-${info.project.name}.png` });
  });

  // @req FR:web-app/home.fit
  test('says when the one thing does not fit the time left and offers one that does', async ({ page }, info) => {
    const m = await mockApi(page, { tasks: home() });
    await page.clock.install({ time: new Date(2026, 9, 29, 17, 30) }); // 30 min of the work day left
    await page.goto('/#/home');
    // one focal point: the task that fits is NOW; the one that does not is one muted line under it
    const one = page.getByRole('group', { name: 'Next task' });
    await expect(one.getByTestId('next-title')).toContainText('Plan the trip');
    const unfit = page.getByTestId('unfit');
    await expect(unfit).toContainText('Ship the web app');
    await expect(unfit).toContainText("doesn't fit now: needs 1h, 30m until end of day");
    // keys act on the task shown as NOW, not on the waiting one
    if (info.project.name !== 'mobile') { await page.keyboard.press('s'); await expect.poll(() => m.calls.at(-1)).toMatchObject({ path: '/tasks/start', body: { ref: 'beta:4' } }); }
    if (info.project.name === 'mobile') await unfit.getByRole('button', { name: /More time/ }).tap(); else await page.keyboard.press(']'); // +30 m: now it fits
    await expect(one.getByTestId('next-title')).toContainText('Ship the web app');
    await expect(page.getByTestId('unfit')).toHaveCount(0);
  });

  // @req FR:web-app/home.projects
  test('project name opens that project in Full stack', async ({ page }) => {
    await mockApi(page, { tasks: home() });
    await page.goto('/#/home');
    await page.getByTestId('top-asks').getByRole('button', { name: 'Gamma' }).click(); // @req FR:web-app/today.projects
    await expect(page).toHaveURL(/#\/list\?project=gamma/);
  });
});
