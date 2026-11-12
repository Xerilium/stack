/** My day grid: default view, equal slots, meetings and tasks at their duration, place a task, detail beside or full page, axe. */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mockApi, type MockTask } from './mock';

const at = (h: number, m = 0, plus = 0) => { const d = new Date(); d.setDate(d.getDate() + plus); d.setHours(h, m, 0, 0); return d; };
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const row = (ref: string, text: string, project: string): MockTask => ({ ref, text, project, section: '🔄 Active', done: false, depth: 0, notes: [] });
const schedule = (plus = 0) => ({
  timezone: 'America/Los_Angeles', date: ymd(at(0, 0, plus)), wake: at(8, 0, plus).toISOString(), bed: at(22, 0, plus).toISOString(), asleep: false,
  blocks: [{ name: 'Family evening', label: 'Family', emoji: '🏠', kind: 'personal', start: at(18, 0, plus).toISOString(), end: at(20, 0, plus).toISOString() }],
});
const SYNC = { id: 'e1', subject: 'Allyte sync', start: at(11).toISOString(), end: at(12).toISOString(), allDay: false, showAs: 'busy', cancelled: false, online: true, joinUrl: 'https://teams.microsoft.com/l/meetup-join/x', organizer: 'Pat' };

async function open(page: Page, o: { scheme?: 'light' | 'dark' } = {}) {
  if (o.scheme) await page.emulateMedia({ colorScheme: o.scheme });
  await page.clock.install({ time: at(10) });
  const m = await mockApi(page, { grid: true, tasks: [row('allyte:1', 'Allyte deck 🟢', 'allyte'), row('stack:1', 'Stack fix 🟢', 'stack')], projects: [{ name: 'allyte', title: 'Allyte' }, { name: 'stack', title: 'Stack' }] });
  m.schedule = schedule();
  m.events = [SYNC] as never;
  await page.route('**/api/schedule?**', async (r) => {
    const q = Date.parse(new URL(r.request().url()).searchParams.get('at') ?? '');
    const plus = Math.round((q - at(12).getTime()) / 864e5);
    await r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(Number.isFinite(plus) ? schedule(plus) : m.schedule) });
  });
  await page.goto('/#/today');
  await page.clock.resume();
  await expect(page.getByTestId('day-grid')).toBeVisible();
  return m;
}
const grid = (page: Page) => page.getByTestId('day-grid');

test.describe('My day grid', () => {
  // @req FR:my-day-grid/view.default @req FR:my-day-grid/view.header @req FR:my-day-grid/grid.slots @req FR:my-day-grid/grid.now
  test('opens as a grid of equal 30-minute slots with a now line and one quiet header', async ({ page }, info) => {
    await open(page);
    await expect(page.getByRole('radio', { name: 'Grid' })).toHaveAttribute('aria-checked', 'true');
    const heights = await grid(page).locator('.dg-slot').evaluateAll((els) => [...new Set(els.map((e) => Math.round(e.getBoundingClientRect().height)))]);
    expect(heights).toEqual([48]);
    await expect(grid(page).locator('.dg-slot')).toHaveCount(28); // 8a to 10p
    await expect(page.getByTestId('dg-now')).toBeVisible();
    await expect(page.getByTestId('dg-now')).toBeInViewport();
    for (const gone of ['.day-bar', '[data-testid="quiet-side"]', '[data-testid="available"]']) await expect(page.locator(gone)).toHaveCount(0);
    await expect(page.locator('main kbd:visible')).toHaveCount(0);
    await page.screenshot({ path: `e2e/screenshots/myday-grid-${info.project.name}.png` });
  });

  // @req FR:my-day-grid/grid.meetings @req FR:my-day-grid/grid.tasks @req FR:my-day-grid/grid.free
  test('a meeting spans its hour with Join; tasks sit at their planned time; free slots are empty buttons', async ({ page }) => {
    await open(page);
    const mtg = page.getByTestId('dg-meeting');
    await expect(mtg).toContainText('Allyte sync');
    expect(Math.round((await mtg.boundingBox())!.height)).toBeGreaterThanOrEqual(94);
    await expect(mtg.getByRole('link', { name: 'Join Allyte sync' })).toHaveAttribute('href', SYNC.joinUrl);
    await expect(page.getByTestId('dg-task').filter({ hasText: 'Allyte deck' })).toContainText('10:00a');
    await expect(page.getByTestId('dg-task').filter({ hasText: 'Stack fix' })).toContainText('10:30a');
    await expect(page.getByRole('button', { name: 'Place a task at 9:00a' })).toHaveCount(0); // past
    await expect(page.getByRole('button', { name: 'Place a task at 11:00a' })).toHaveCount(0); // meeting
    await expect(page.getByRole('button', { name: 'Place a task at 2:00p' })).toBeVisible();
    const cursor = await page.getByTestId('dg-task').first().locator('.dg-open').evaluate((e) => getComputedStyle(e).cursor);
    expect(cursor).toBe('pointer');
  });

  // @req FR:my-day-grid/grid.place
  test('tapping a free slot places a task there; Undo puts it back', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Place a task at 2:00p' }).click();
    const list = page.getByTestId('dg-place');
    await expect(list).toContainText('Place at 2:00p');
    await list.getByRole('button', { name: /Stack fix/ }).click();
    await expect(page.getByTestId('dg-task').filter({ hasText: 'Stack fix' })).toContainText('2:00p');
    expect(await page.evaluate(() => localStorage.getItem('stack.placed'))).toContain('stack:1');
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByTestId('dg-task').filter({ hasText: 'Stack fix' })).toContainText('10:30a');
  });

  test('Esc closes the place list', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Place a task at 2:00p' }).click();
    await expect(page.getByTestId('dg-place')).toBeVisible();
    await expect(page.getByTestId('dg-place').locator('.fl-option').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('dg-place')).toHaveCount(0);
  });

  // @req FR:my-day-grid/grid.drag
  test('dragging a task onto a free slot places it', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'drag is for pointer devices');
    await open(page);
    await page.getByTestId('dg-task').filter({ hasText: 'Allyte deck' }).dragTo(page.locator('[data-testid="dg-free"][data-at="780"]'));
    await expect(page.getByTestId('dg-task').filter({ hasText: 'Allyte deck' })).toContainText('1:00p');
  });

  // @req FR:my-day-grid/detail.open @req FR:my-day-grid/detail.side
  test('a task opens beside the grid when wide, full page when narrow; Esc closes', async ({ page }, info) => {
    await open(page);
    await page.getByTestId('dg-task').filter({ hasText: 'Allyte deck' }).locator('.dg-open').click();
    const d = page.getByRole('dialog', { name: 'Task detail' });
    await expect(d).toBeVisible();
    const box = (await d.boundingBox())!;
    const vw = page.viewportSize()!.width;
    if (info.project.name === 'desktop') {
      expect(box.x).toBeGreaterThan(vw / 2);
      await expect(grid(page)).toBeInViewport();
      await expect(page.getByTestId('dg-task').filter({ hasText: 'Allyte deck' })).toHaveClass(/\bon\b/);
    } else {
      expect(Math.round(box.width)).toBe(vw);
      await expect(d.getByRole('button', { name: 'Close' })).toBeVisible();
    }
    await page.screenshot({ path: `e2e/screenshots/myday-grid-detail-${info.project.name}.png` });
    await page.keyboard.press('Escape');
    await expect(d).toHaveCount(0);
  });

  test('a meeting opens its detail with Join; Esc closes', async ({ page }) => {
    await open(page);
    await page.getByTestId('dg-meeting').locator('.dg-open').click();
    const d = page.getByTestId('meeting-detail');
    await expect(d).toContainText('Allyte sync');
    await expect(d).toContainText('11:00a–12:00p');
    await expect(d.getByRole('link', { name: 'Join' })).toHaveAttribute('href', SYNC.joinUrl);
    await page.keyboard.press('Escape');
    await expect(d).toHaveCount(0);
  });

  // @req FR:my-day-grid/view.default
  test('Agenda is a toggle, remembered on this device', async ({ page }) => {
    await open(page);
    await page.getByRole('radio', { name: 'Agenda' }).click();
    await expect(page.getByTestId('plan')).toBeVisible();
    await page.reload();
    await expect(page.getByTestId('plan')).toBeVisible();
    await expect(page.getByRole('radio', { name: 'Agenda' })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('radio', { name: 'Grid' }).click();
    await expect(grid(page)).toBeVisible();
  });

  // @req FR:my-day-grid/view.nav
  test('Next day and Today move between days', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Next day' }).click();
    await expect(page.locator('.dg-date')).toContainText('Tomorrow');
    await expect(page.getByTestId('dg-now')).toHaveCount(0);
    await page.getByRole('button', { name: 'Today', exact: true }).click();
    await expect(page.locator('.dg-date')).not.toContainText('Tomorrow');
    await expect(page.getByRole('button', { name: 'Today', exact: true })).toBeDisabled();
  });

  // @req FR:my-day-grid/look.fluent
  for (const scheme of ['light', 'dark'] as const) {
    test(`axe clean, no sideways scroll, touch targets (${scheme})`, async ({ page }, info) => {
      await open(page, { scheme });
      await page.waitForTimeout(300);
      const { violations } = await new AxeBuilder({ page }).analyze();
      const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').flatMap((v) => v.nodes.map((n) => `${v.id} ${n.target.join(' ')}`));
      expect(bad, bad.join('\n')).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      const min = info.project.name === 'mobile' ? 44 : 24;
      const small = await page.locator('[data-testid="day-grid"] button:visible, [data-testid="day-grid"] a:visible, .dg-head button:visible').evaluateAll((els, m) => els.map((e) => { const r = e.getBoundingClientRect(); return { h: Math.round(r.height), what: `${e.className} "${(e.textContent ?? '').trim().slice(0, 30)}"` }; }).filter((x) => x.h > 0 && x.h < m), min);
      expect(small, JSON.stringify(small, null, 1)).toEqual([]);
    });
  }
});
