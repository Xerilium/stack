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
    await edit.getByRole('button', { name: /^Only/ }).click();
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

  // @req FR:home/day.override
  test('Every saves for the weekday; Reset clears the day and the weekday', async ({ page }) => {
    const m = await open(page, at(10));
    await page.getByTestId('day-times').click();
    await page.getByTestId('day-times-edit').getByLabel('Bed').fill('01:00');
    await page.getByTestId('day-times-edit').getByRole('button', { name: /^Every/ }).click();
    await expect.poll(() => m.calls.find((c) => c.path === '/schedule/day')?.body).toEqual({ date: ymd(at(0)), wake: '08:00', bed: '01:00', every: true });
    await page.getByTestId('day-times').click();
    await page.getByTestId('day-times-edit').getByRole('button', { name: 'Reset' }).click();
    await expect.poll(() => m.calls.filter((c) => c.path === '/schedule/day').slice(-2).map((c) => c.body)).toEqual([{ date: ymd(at(0)), reset: true, every: true }, { date: ymd(at(0)), reset: true, every: false }]);
  });

  // @req FR:home/day.tomorrow
  test('tomorrow\'s Available is read-only', async ({ page }) => {
    await open(page, at(23, 30));
    await page.getByTestId('tomorrow').click();
    await expect(page.getByTestId('available').getByRole('button', { name: 'More time' })).toBeDisabled();
    await page.keyboard.press(']'); // must not change today's Available
    await page.getByTestId('tomorrow').click();
    await expect(page.getByTestId('available').getByRole('button', { name: 'Reset' })).toHaveCount(0);
  });

  // @req FR:home/day.override
  test('Enter saves only this day; Esc cancels', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'keyboard');
    const m = await open(page, at(10));
    await page.getByTestId('day-times').click();
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('day-times-edit')).toHaveCount(0);
    await page.getByTestId('day-times').click();
    await page.getByTestId('day-times-edit').getByLabel('Bed').fill('01:00');
    await page.keyboard.press('Enter');
    await expect.poll(() => m.calls.find((c) => c.path === '/schedule/day')?.body).toMatchObject({ bed: '01:00' });
  });

  test('screens: today and tomorrow with meetings (on the plan, no now line tomorrow), light and dark', async ({ page }, info) => {
    const ev = (h: number, plus: number, subject: string) => ({ id: subject, subject, start: at(h, 0, plus).toISOString(), end: at(h + 1, 0, plus).toISOString(), allDay: false, showAs: 'busy', cancelled: false, online: true, joinUrl: 'https://teams.example.test/j' });
    await open(page, at(23, 30), { events: [ev(23, 0, 'APAC sync'), ev(9, 1, 'Allyte standup')] });
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await expect(page.locator('[data-testid="plan"] .meeting')).toContainText('APAC sync');
      await page.screenshot({ path: `e2e/screenshots/myday-v2-today-${scheme}-${info.project.name}.png`, fullPage: true });
      await page.getByTestId('tomorrow').click();
      await expect(page.locator('[data-testid="plan"] .meeting')).toContainText('Allyte standup');
      await expect(page.locator('.now-line')).toHaveCount(0);
      await page.screenshot({ path: `e2e/screenshots/myday-v2-tomorrow-${scheme}-${info.project.name}.png`, fullPage: true });
      await page.getByTestId('tomorrow').click();
    }
  });

  // @req FR:home/myday.timeline @req FR:home/myday.header @req FR:home/myday.short @req FR:ui-kit/daygrid
  test('day grid: every 30-minute row has one height; a 60-minute block is exactly double; empty slots stay', async ({ page }, info) => {
    const ev = (id: string, h: number, m: number, min: number) => ({ id, subject: id, start: at(h, m).toISOString(), end: new Date(at(h, m).getTime() + min * 60_000).toISOString(), allDay: false, showAs: 'busy', cancelled: false, online: id === 'Standup', ...(id === 'Standup' ? { joinUrl: 'https://teams.example.test/j' } : {}) });
    await page.clock.install({ time: at(10, 10) });
    const tasks = [row('allyte:1', 'Quick reply 🔹', 'allyte'), row('allyte:2', 'Allyte deck 🟢', 'allyte'), row('allyte:3', 'Loose end', 'allyte'), row('stack:1', 'Stack fix 🟢', 'stack')];
    const m = await mockApi(page, { tasks, projects: PROJECTS as never });
    m.schedule = schedule();
    m.events = [ev('Standup', 11, 0, 30), ev('Design review', 13, 0, 60), ev('Budget', 14, 30, 90)] as never;
    await page.goto('/#/today');
    await page.clock.resume();
    const plan = page.getByTestId('plan');
    await expect(plan.locator('.meeting')).toHaveCount(3);
    const h = async (sel: string, text?: string) => (await (text ? plan.locator(sel).filter({ hasText: text }) : plan.locator(sel)).first().evaluate((el) => (el.closest('.ui-grid-item') ?? el).getBoundingClientRect().height));
    // Rows: 10:00a to 2:00a is 32 rows, all one height.
    const rows = await page.locator('.ui-slot').evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
    expect(rows).toHaveLength(32);
    expect(new Set(rows).size).toBe(1);
    const slot = rows[0];
    expect(slot).toBe(info.project.name === 'mobile' ? 112 : 60);
    expect(await h('.meeting', 'Standup')).toBe(slot);
    expect(await h('.meeting', 'Design review')).toBe(slot * 2);
    expect(await h('.meeting', 'Budget')).toBe(slot * 3);
    expect(await h('.block', 'Allyte deck')).toBe(slot);
    expect(await h('.block.short', 'Quick reply')).toBeCloseTo(slot * 0.4, 1); // 12 min: 24 px (44 px on touch), in proportion
    for (const target of ['.tick', '.row-open']) expect(await plan.locator(`.block.short ${target}`).evaluate((el) => el.getBoundingClientRect().height)).toBeGreaterThanOrEqual(info.project.name === 'mobile' ? 44 : 24);
    await expect(plan.locator('.block').filter({ hasText: 'Loose end' }).locator('.what-meta')).toContainText('~30m'); // an estimate keeps its mark @req FR:web-app/today.plan
    await expect(plan.locator('.block.short .row-acts')).toBeHidden();
    await expect(plan.locator('.block.short .what-meta .at')).toHaveText('10:15a'); // a start off the half hour shows, on a short block too
    await expect(plan.locator('.block').filter({ hasText: 'Allyte deck' }).locator('.what-meta .at')).toHaveText('10:27a');
    // Allyte deck starts at 10:27a, right under the short block: full width, and no block covers another.
    const boxes = await plan.locator('.ui-grid-item').evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; }));
    const hit = boxes.flatMap((a, i) => boxes.slice(i + 1).filter((b) => a.l < b.r - 0.5 && b.l < a.r - 0.5 && a.t < b.b - 0.5 && b.t < a.b - 0.5));
    expect(hit).toEqual([]);
    const [shortBox, deckBox] = [await plan.locator('.ui-grid-item').filter({ hasText: 'Quick reply' }).boundingBox(), await plan.locator('.ui-grid-item').filter({ hasText: 'Allyte deck' }).boundingBox()];
    expect(deckBox!.width).toBe(shortBox!.width);
    expect(deckBox!.y).toBeGreaterThanOrEqual(shortBox!.y + shortBox!.height - 0.5);
    // A block sits at its real time: Standup starts 2 rows below the 10:00a grid top.
    const top = (await page.locator('.ui-slot').first().boundingBox())!.y;
    expect(Math.round((await plan.locator('.ui-grid-item').filter({ hasText: 'Standup' }).boundingBox())!.y - top)).toBe(slot * 2);
    // Minimal chrome: no day bar, no totals, no jump links, no band rows, no free-gap rows.
    await expect(page.locator('.day-bar, .day-ends, .t-sub .jump, .band, .gap, .earlier')).toHaveCount(0);
    await expect(page.locator('.t-sub')).not.toContainText(/free|in meetings|estimated/);
    await expect(page.locator('.next-meeting')).toContainText('Standup in 50m');
    await expect(page.locator('.ui-slot-band').first()).toHaveText('Work');
    await expect(page.locator('.now-line')).toHaveCount(1);
    // Nothing is cut off sideways or spills out of its block.
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const spills = await plan.locator('.ui-grid-item').evaluateAll((els) => els.filter((el) => { const b = el.getBoundingClientRect(); return [...el.querySelectorAll('button, a')].some((x) => { const r = x.getBoundingClientRect(); return r.height > 0 && (r.top < b.top - 1 || r.bottom > b.bottom + 1); }); }).map((el) => el.textContent));
    expect(spills).toEqual([]);
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.screenshot({ path: `e2e/screenshots/myday-grid-${scheme}-${info.project.name}.png`, fullPage: true });
    }
    // More Available than the time to bed adds no empty rows past bed: the grid ends at bed or the last planned end. @req FR:home/myday.timeline.range
    const more = page.getByRole('button', { name: 'More time', exact: true });
    for (let i = 0; i < 40 && (await more.isEnabled()); i++) await more.click({ force: true });
    await expect(more).toBeDisabled();
    await expect(page.locator('.ui-slot')).toHaveCount(32);
  });
});
