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
  // @req FR:web-app/home.one @req FR:web-app/home.next @req FR:web-app/home.projects @req FR:web-app/home.quiet
  test('one thing with its time and countdown, up next (2), one row per project, nothing else', async ({ page }, info) => {
    const ten = new Date(); ten.setHours(10, 0, 0, 0); await page.clock.setFixedTime(ten); // fit follows the time you have now
    await mockApi(page, { tasks: home() });
    await page.goto('/');
    const one = page.getByRole('group', { name: 'Next task' });
    await expect(one.getByTestId('next-title')).toContainText('Ship the web app');
    await expect(one.getByTestId('expected')).toHaveText('1h');
    await expect(one.getByTestId('countdown')).toHaveText('today');
    await expect(page.getByTestId('up-next').locator('.row')).toHaveCount(2);
    await expect(page.getByTestId('up-next').locator('.row .title')).toHaveText(['Review pull requests', 'Plan the trip']);
    await expect(page.getByTestId('up-next').locator('.row').first().getByTestId('expected')).toHaveText('2h');
    // projects whose top task is already on screen (alpha, beta) are not repeated
    const projects = page.getByTestId('home-projects').locator('li');
    await expect(projects).toHaveCount(1);
    await expect(projects.first()).toContainText('Chase the invoice');
    await expect(projects.first().getByTestId('countdown')).toHaveText('2d late');
    await expect(one.getByTestId('ends')).toHaveText(/^ends ~\d{1,2}:\d\d[ap]$/);
    await expect(page.getByText(/Show all active/)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `e2e/screenshots/home-${info.project.name}.png` });
  });

  // @req FR:web-app/home.fit
  test('says when the one thing does not fit the time left and offers one that does', async ({ page }, info) => {
    const m = await mockApi(page, { tasks: home() });
    await page.clock.install({ time: new Date(2026, 9, 29, 17, 30) }); // 30 min of the work day left
    await page.goto('/');
    // one focal point: the task that fits is NOW; the one that does not is one muted line under it
    const one = page.getByRole('group', { name: 'Next task' });
    await expect(one.getByTestId('next-title')).toContainText('Plan the trip');
    await expect(one.getByTestId('expected')).toHaveText('30m');
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
    await page.goto('/');
    await page.getByTestId('home-projects').getByRole('button', { name: 'Gamma' }).click(); // @req FR:web-app/today.projects
    await expect(page).toHaveURL(/#\/list\?project=gamma/);
  });
});
