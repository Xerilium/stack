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
    await mockApi(page, { tasks: home() });
    await page.goto('/');
    const one = page.getByRole('group', { name: 'Next task' });
    await expect(one.getByTestId('next-title')).toContainText('Ship the web app');
    await expect(one.getByTestId('expected')).toHaveText('1h');
    await expect(one.getByTestId('countdown')).toHaveText('today');
    await expect(page.getByTestId('up-next').locator('.row')).toHaveCount(2);
    await expect(page.getByTestId('up-next').locator('.row .title')).toHaveText(['Review pull requests', 'Plan the trip']);
    await expect(page.getByTestId('up-next').locator('.row').first().getByTestId('expected')).toHaveText('2h');
    const projects = page.getByTestId('home-projects').locator('li');
    await expect(projects).toHaveCount(3);
    await expect(projects.nth(2)).toContainText('Chase the invoice');
    await expect(projects.nth(2).getByTestId('countdown')).toHaveText('2 d late');
    await expect(page.getByText(/Show all active/)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `e2e/screenshots/home-${info.project.name}.png` });
  });

  // @req FR:web-app/home.fit
  test('says when the one thing does not fit the time left and offers one that does', async ({ page }, info) => {
    await mockApi(page, { tasks: home() });
    await page.clock.install({ time: new Date(2026, 9, 29, 17, 30) }); // 30 min of the work day left
    await page.goto('/');
    const one = page.getByRole('group', { name: 'Next task' });
    await expect(one.getByTestId('nofit')).toHaveText('No time for this today: needs 1h, 30m left');
    const instead = page.getByTestId('instead');
    await expect(instead).toContainText('Plan the trip');
    await expect(instead.getByTestId('expected')).toHaveText('30m');
    if (info.project.name === 'mobile') await one.getByRole('button', { name: /More time/ }).tap(); else await page.keyboard.press(']'); // +30 m: now it fits
    await expect(one.getByTestId('nofit')).toHaveCount(0);
    await expect(page.getByTestId('instead')).toHaveCount(0);
  });

  // @req FR:web-app/home.projects
  test('project name opens that project in Full stack', async ({ page }) => {
    await mockApi(page, { tasks: home() });
    await page.goto('/');
    await page.getByTestId('home-projects').getByRole('button', { name: 'Beta' }).click();
    await expect(page).toHaveURL(/#\/list\?project=beta/);
  });
});
