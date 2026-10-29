/** Home on the real schedule: the window until the next commitment, "I have", delegate. */
import { expect, test, type Page } from '@playwright/test';
import { mockApi, type MockTask } from './mock';

const at = (h: number, m = 0, plus = 0) => { const d = new Date(); d.setDate(d.getDate() + plus); d.setHours(h, m, 0, 0); return d; };
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const row = (ref: string, text: string, project = 'alpha'): MockTask => ({ ref, text, project, section: '🔄 Active', done: false, depth: 0, notes: [] });
const tasks = (): MockTask[] => [row('alpha:1', 'Ship the release 🟠'), row('alpha:2', 'Send W9 🟢'), row('beta:1', '🏠 Order dinner 🟢', 'beta')];
const schedule = () => ({
  timezone: 'UTC', date: ymd(at(0)), wake: at(8).toISOString(), bed: at(2, 0, 1).toISOString(), asleep: false,
  blocks: [
    { name: 'Work', emoji: '☀️', kind: 'focus', start: at(8).toISOString(), end: at(16).toISOString() },
    { name: 'Family evening', label: 'Family', emoji: '🏠', kind: 'personal', start: at(16).toISOString(), end: at(20).toISOString() },
    { name: 'Project', emoji: '🌙', kind: 'focus', start: at(23).toISOString(), end: at(2, 0, 1).toISOString() },
  ],
});
const sync = { id: 'm', subject: 'Allyte sync', start: at(15, 55).toISOString(), end: at(16, 30).toISOString(), allDay: false, showAs: 'busy', cancelled: false, online: false };

async function open(page: Page, time: Date, events: unknown[] = []) {
  await page.clock.install({ time });
  const m = await mockApi(page, { tasks: tasks() });
  m.schedule = schedule();
  m.events = events as never;
  await page.goto('/#/home');
  await page.clock.resume();
  return m;
}

test.describe('Home on the schedule', () => {
  // @req FR:home/home.window @req FR:web-app/home.fit
  test('the window runs to the next meeting; the top task does not fit, one that does is offered', async ({ page }, info) => {
    await open(page, at(15, 10), [sync]);
    await expect(page.getByTestId('window')).toContainText('45m until Allyte sync');
    await expect(page.getByTestId('next-title')).toContainText('Send W9'); // the task that fits is NOW
    await expect(page.getByTestId('unfit')).toContainText("Ship the release");
    await expect(page.getByTestId('unfit')).toContainText("doesn't fit now: needs 2h, 45m until Allyte sync");
    await page.screenshot({ path: `e2e/screenshots/home-window-${info.project.name}.png` });
  });

  // @req FR:home/home.have
  test('"I have 2h" makes it fit; Reset returns to the window', async ({ page }) => {
    await open(page, at(15, 10), [sync]);
    await page.getByTestId('have').getByRole('button', { name: /^2h/ }).click();
    await expect(page.getByTestId('window')).toContainText('You have 2h');
    await expect(page.getByTestId('unfit')).toHaveCount(0);
    await expect(page.getByTestId('next-title')).toContainText('Ship the release');
    await page.getByTestId('window').getByRole('button', { name: 'Reset' }).click();
    await expect(page.getByTestId('unfit')).toBeVisible();
  });

  test('h then 1-4 picks; ] adds 30m to what you have', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'keyboard');
    await open(page, at(15, 10), [sync]);
    await page.keyboard.press('h');
    await page.keyboard.press('2');
    await expect(page.getByTestId('window')).toContainText('You have 30m');
    await page.keyboard.press(']');
    await expect(page.getByTestId('window')).toContainText('You have 1h');
    await page.keyboard.press('[');
    await expect(page.getByTestId('window')).toContainText('You have 30m');
    await page.keyboard.press('h');
    await page.keyboard.press('0');
    await expect(page.getByTestId('window')).toContainText('45m until Allyte sync');
    await page.keyboard.press('h');
    await page.keyboard.press('j');
    await page.keyboard.press('2'); // any other key disarms h
    await expect(page.getByTestId('window')).toContainText('45m until Allyte sync');
  });

  // @req FR:home/home.window
  test('in family time only tasks tagged for it fit; one is offered', async ({ page }) => {
    await open(page, at(17));
    await expect(page.getByTestId('window')).toContainText('Family until 8:00p');
    await expect(page.getByTestId('next-title')).toContainText('Order dinner');
    await expect(page.getByTestId('unfit')).toContainText('Family until 8:00p: only 🏠 tasks now');
  });

  // @req FR:home/home.delegate
  test('Delegate marks the row 🪄 with undo', async ({ page }) => {
    const m = await open(page, at(10));
    await page.getByRole('group', { name: 'Next task' }).getByRole('button', { name: /Delegate/ }).click();
    await expect.poll(() => m.calls.find((c) => c.path === '/tasks/edit')?.body).toMatchObject({ ref: 'alpha:1', text: '🪄 Ship the release 🟠', expect: 'Ship the release 🟠' });
    await expect(page.getByText(/Delegated to the/)).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => m.calls.filter((c) => c.path === '/tasks/edit').at(-1)?.body).toMatchObject({ ref: 'alpha:1', text: 'Ship the release 🟠', expect: '🪄 Ship the release 🟠' });
  });
});
