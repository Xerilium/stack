/** My day v2: inline wake/bed, tomorrow, meetings, blocks. */
import { expect, test, type Page } from '@playwright/test';
import { mockApi, type MockTask } from './mock';

const at = (h: number, m = 0, plus = 0) => { const d = new Date(); d.setDate(d.getDate() + plus); d.setHours(h, m, 0, 0); return d; };
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const row = (ref: string, text: string, project: string): MockTask => ({ ref, text, project, section: '🔄 Active', done: false, depth: 0, notes: [] });
const PROJECTS = [{ name: 'allyte', title: 'Allyte', metadata: { 'Work capacity': '8h' } }, { name: 'stack', title: 'Stack', metadata: { 'Project capacity': '1h' } }];
const schedule = (plus = 0) => ({
  timezone: 'UTC', date: ymd(at(0, 0, plus)), wake: at(8, 0, plus).toISOString(), bed: at(2, 0, plus + 1).toISOString(), asleep: false,
  blocks: [
    { name: 'Work', emoji: '☀️', kind: 'focus', start: at(8, 0, plus).toISOString(), end: at(16, 0, plus).toISOString() },
    { name: 'Family evening', label: 'Family', emoji: '🏠', kind: 'personal', start: at(16, 0, plus).toISOString(), end: at(20, 0, plus).toISOString() },
    { name: 'Project', emoji: '🌙', kind: 'focus', start: at(23, 0, plus).toISOString(), end: at(2, 0, plus + 1).toISOString() },
  ],
});

async function open(page: Page, time: Date, o: { events?: unknown[]; projects?: unknown[] } = {}) {
  await page.clock.install({ time });
  const m = await mockApi(page, { tasks: [row('allyte:1', 'Allyte deck 🟢', 'allyte'), row('stack:1', 'Stack fix 🟢', 'stack')], projects: (o.projects ?? PROJECTS) as never });
  m.schedule = schedule();
  m.events = (o.events ?? null) as never;
  await page.route('**/api/schedule?**', async (r) => {
    const q = new URL(r.request().url()).searchParams.get('at');
    const tomorrow = q && Date.parse(q) >= at(2, 0, 1).getTime();
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(tomorrow ? { ...schedule(1), asleep: true } : m.schedule) });
  });
  await page.goto('/#/today');
  await page.clock.resume();
  return m;
}

test.describe('My day v2', () => {
  // @req FR:home/day.blocks
  test('work waits for its block: the Stack task goes in Project time, the Allyte task in Work', async ({ page }) => {
    await open(page, at(10));
    const blocks = page.locator('[data-testid="plan"] .block');
    await expect(blocks.filter({ hasText: 'Allyte deck' }).locator('.when')).toContainText('10:00a');
    await expect(blocks.filter({ hasText: 'Stack fix' }).locator('.when')).toContainText('11:00p');
  });

  // @req FR:home/day.override
  test('the header times change bed for today', async ({ page }, info) => {
    const m = await open(page, at(10));
    await page.getByTestId('day-times').click();
    const edit = page.getByTestId('day-times-edit');
    await edit.getByLabel('Bed').fill('01:00');
    await edit.getByRole('button', { name: 'Today' }).click();
    await expect.poll(() => m.calls.find((c) => c.path === '/schedule/day')?.body).toMatchObject({ date: ymd(at(0)), bed: '01:00' });
    await expect(page.getByTestId('day-times')).toContainText('8:00a–1:00a');
    await page.screenshot({ path: `e2e/screenshots/myday-times-${info.project.name}.png` });
  });

  // @req FR:home/day.tomorrow
  test('late in the day it offers tomorrow, planned from wake', async ({ page }, info) => {
    await open(page, at(23, 30));
    await page.getByTestId('tomorrow').click();
    await expect(page.locator('.t-date')).toContainText('Tomorrow');
    await expect(page.locator('[data-testid="plan"] .block').first().locator('.when')).toContainText('8:00a');
    await page.screenshot({ path: `e2e/screenshots/myday-tomorrow-${info.project.name}.png` });
    await page.getByTestId('tomorrow').click();
    await expect(page.locator('.t-date')).not.toContainText('Tomorrow');
  });

  test('early in the day there is no tomorrow offer', async ({ page }) => {
    await open(page, at(10));
    await expect(page.getByTestId('tomorrow')).toHaveCount(0);
  });

  // @req FR:home/day.nocal
  test('no calendar connected says so; with one, meetings sit on the timeline', async ({ page }) => {
    await open(page, at(10));
    await expect(page.getByTestId('nocal')).toContainText('No calendar');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('meetings from the calendar are on the plan and take time', async ({ page }) => {
    await open(page, at(10), { events: [{ id: 'e', subject: 'Allyte sync', start: at(11).toISOString(), end: at(12).toISOString(), allDay: false, showAs: 'busy', cancelled: false, online: false }] });
    await expect(page.getByTestId('nocal')).toHaveCount(0);
    await expect(page.locator('[data-testid="plan"] .meeting')).toContainText('Allyte sync');
  });
});
