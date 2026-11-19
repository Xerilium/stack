/** Now polish: one quiet, honest calendar line that links to Settings, ask cards that expand in place, two columns on wide screens, a named composer. */
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mockApi, seed, type MockAsk } from './mock';

const ask = (key: string, from: string, score: number, extra: Partial<MockAsk> = {}): MockAsk => ({ key, state: 'open', ask: `Ask ${key}`, kind: 'approve', from, reversible: true, priority: 'normal', blocks: 0, created: '2026-11-05T09:00:00Z', updated: '2026-11-05T09:00:00Z', score, overdue: false, recommend: 'Approve', ...extra });
const ten = async (page: Page) => { const d = new Date(); d.setHours(10, 0, 0, 0); await page.clock.install({ time: d }); return d; };
const at = (d: Date, h: number, mi = 0) => { const x = new Date(d); x.setHours(h, mi, 0, 0); return x.toISOString(); };
const noScrollX = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const axe = async (page: Page) => (await new AxeBuilder({ page }).include('[data-testid="now"]').analyze()).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`);
/** Every button, link, and field in `scope` is at least 44 px high (touch). */
const tall = async (page: Page, scope: string) => {
  for (const el of await page.locator(`${scope} button:visible, ${scope} a:visible, ${scope} input:visible, ${scope} textarea:visible`).all()) expect((await el.boundingBox())!.height, await el.evaluate((e) => e.outerHTML.slice(0, 80))).toBeGreaterThanOrEqual(44);
};

test.describe('Now: the calendar line is quiet and honest', () => {
  // @req FR:connect-accounts/web.now @req FR:connect-accounts/web.where @req FR:ux-consolidation/cal.ui @req FR:ux-consolidation/one.meetings
  test('not connected: one line that links to Settings > Accounts; no panel, no Fix, no Connect; never No meetings', async ({ page }, info) => {
    await ten(page);
    await mockApi(page, { tasks: seed() }); // no calendar
    await page.goto('/#/now');
    await page.clock.resume();
    const cal = page.getByTestId('now-cal');
    await expect(cal).toHaveText(/Calendar not connected/);
    await expect(cal.getByRole('button')).toHaveCount(0);
    await expect(page.getByTestId('now-connect')).toHaveCount(0);
    await expect(page.getByTestId('connect-accounts')).toHaveCount(0);
    await expect(page.getByText('No meetings left today.')).toHaveCount(0);
    expect(await noScrollX(page)).toBe(true);
    expect(await axe(page)).toEqual([]);
    if (info.project.name === 'mobile') await tall(page, '[data-testid="now-side"]');
    await cal.getByRole('link').click();
    await expect(page).toHaveURL(/#\/settings\/accounts$/);
    await expect(page.getByTestId('settings')).toBeVisible();
  });

  // @req FR:connect-accounts/web.now @req FR:connect-accounts/acct.health
  test('Microsoft not responding is not a sign-in problem; weekly meetings still show', async ({ page }) => {
    const d = await ten(page);
    const m = await mockApi(page, { tasks: seed() });
    m.calendarFail = true; m.calSource = { kind: 'calendar', via: 'graph', account: 'a@x.test', state: 'error', reason: 'down' };
    m.meetings = [{ days: [d.getDay()], start: '11:00', end: '11:30', title: 'Weekly sync', owner: 'cos', topic: 'Status' }];
    await page.goto('/#/now');
    await page.clock.resume();
    const cal = page.getByTestId('now-cal');
    await expect(cal).toHaveText(/^Calendar: Microsoft not responding/);
    await expect(page.locator('[data-testid="now"]')).not.toContainText(/sign in again/i);
    await expect(page.getByText('No meetings left today.')).toHaveCount(0);
    await expect(page.getByTestId('now-meetings')).toContainText('Weekly sync');
    await expect(page.getByTestId('now-layer')).toHaveText(/Weekly schedule/);
  });

  // @req FR:connect-accounts/web.now
  for (const [src, text] of [
    [{ kind: 'calendar', via: 'graph', state: 'error', reason: 'signin' }, 'Calendar needs sign-in'],
    [{ kind: 'calendar', via: 'ics', state: 'error' }, 'Calendar unavailable'],
  ] as const) {
    test(`error line: ${text}`, async ({ page }) => {
      await ten(page);
      const m = await mockApi(page, { tasks: seed() });
      m.calendarFail = true; m.calSource = src;
      await page.goto('/#/now');
      await expect(page.getByTestId('now-cal')).toHaveText(new RegExp(`^${text}`));
    });
  }

  // @req FR:ux-consolidation/cal.fresh @req FR:connect-accounts/web.now
  test('stale says when it last synced; fresh and empty says No meetings with no line', async ({ page }) => {
    const d = await ten(page);
    const m = await mockApi(page, { tasks: seed() });
    m.events = [];
    m.calSource = { kind: 'calendar', via: 'ics', state: 'stale', lastSyncAt: new Date(d.getTime() - 125 * 60_000).toISOString() };
    await page.goto('/#/now');
    await expect(page.getByTestId('now-cal')).toHaveText(/Calendar last synced 2 h ago/);
    await expect(page.getByText('No meetings left today.')).toHaveCount(0);
    m.calSource = undefined;
    await page.reload();
    await expect(page.getByText('No meetings left today.')).toBeVisible();
    await expect(page.getByTestId('now-cal')).toHaveCount(0);
  });

  // @req FR:connect-accounts/web.label @req FR:connect-accounts/cal.account
  test('meetings from more than one account carry the account badge; one account shows none', async ({ page }) => {
    const d = await ten(page);
    const m = await mockApi(page, { tasks: seed() });
    m.events = [
      { id: 'e1', subject: 'Allyte sync', start: at(d, 10, 30), end: at(d, 11), allDay: false, showAs: 'busy', cancelled: false, online: false, account: 'michael@allyte.com' },
      { id: 'e2', subject: 'FOCUS TF1', start: at(d, 13), end: at(d, 14), allDay: false, showAs: 'busy', cancelled: false, online: false, account: 'michael@xerilium.com' },
    ];
    await page.goto('/#/now');
    const meetings = page.getByTestId('now-meetings');
    await expect(meetings.getByRole('img', { name: 'michael@allyte.com' })).toHaveText('M');
    await expect(meetings.getByRole('img', { name: 'michael@xerilium.com' })).toBeVisible();
    expect(await axe(page)).toEqual([]);
    await page.goto('/#/today');
    await expect(page.getByTestId('plan').getByRole('img', { name: 'michael@allyte.com' })).toBeVisible();
    m.events = m.events!.map((e) => ({ ...e, account: 'michael@allyte.com' }));
    await page.goto('/#/now');
    await page.reload();
    await expect(page.getByTestId('now-meetings')).toContainText('Allyte sync');
    await expect(page.getByTestId('now-meetings').getByRole('img')).toHaveCount(0);
  });
});

test.describe('Now: calendar refresh', () => {
  // @req FR:ux-consolidation/cal.check: an open page reads the calendar again, so a working calendar never goes stale
  // @req FR:connect-accounts/cal.page
  test('the page reads the calendar again after 5 minutes', async ({ page }) => {
    await ten(page);
    const m = await mockApi(page, { tasks: seed() });
    m.events = [];
    await page.goto('/#/now');
    await expect(page.getByText('No meetings left today.')).toBeVisible();
    let n = 0;
    await page.route('**/api/calendar**', async (r) => { n++; await r.fallback(); });
    await page.clock.fastForward('06:00');
    await page.clock.runFor(61_000);
    await expect.poll(() => n).toBeGreaterThan(0);
    await page.clock.fastForward('50:00');
    await page.clock.runFor(61_000);
    await expect(page.getByText('No meetings left today.')).toBeVisible(); // still fresh after an hour open
  });

  // @req FR:ux-consolidation/cal.check: a refresh that cannot reach the host is not an empty day
  test('a failed refresh shows Calendar unavailable, not No meetings', async ({ page }) => {
    await ten(page);
    const m = await mockApi(page, { tasks: seed() });
    m.events = [];
    await page.goto('/#/now');
    await expect(page.getByText('No meetings left today.')).toBeVisible();
    await page.route('**/api/calendar**', (r) => r.abort());
    await page.clock.fastForward('16:00');
    await page.clock.runFor(61_000);
    await expect(page.getByText('Calendar unavailable')).toBeVisible();
    await expect(page.getByText('No meetings left today.')).toHaveCount(0);
  });
});

test.describe('Now: layout and composer', () => {
  // @req FR:now-screen/now.layout @req FR:ux-consolidation/one.layout @req FR:now-screen/now.compose @req FR:now-screen/now.thread
  test('wide screens put Next in a right column; phones stack them under the task', async ({ page }, info) => {
    await ten(page);
    const m = await mockApi(page, { tasks: seed() });
    m.team = [{ slug: 'cos', name: 'Allyte CoS', scope: ['*'], mode: 'ad-hoc', prompt: '', defined: true, projects: ['alpha', 'beta'] }];
    m.asks = [ask('a1', 'cos', 90, { ask: 'Approve the plan' })];
    m.inbox.push({ id: 'in-20261101T100000Z-aaaa', at: '2026-11-01T10:00:00Z', project: 'alpha', ref: 'alpha:6', task: 'Ship the web app', kind: 'instruction', to: 'agent', text: 'Start with the login page', state: 'open', row: 'alpha:6' });
    if (info.project.name === 'desktop') await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/#/now');
    await page.clock.resume();
    const focus = (await page.getByTestId('now-focus').boundingBox())!;
    const side = (await page.getByTestId('now-side').boundingBox())!;
    if (info.project.name === 'desktop') {
      expect(side.x).toBeGreaterThan(focus.x + focus.width); // beside, not below
      expect(Math.abs(side.y - focus.y)).toBeLessThan(8); // top-aligned
      expect(focus.width).toBeLessThanOrEqual(640);
    } else {
      expect(side.y).toBeGreaterThanOrEqual(focus.y + focus.height);
    }
    // the composer names who it talks to, above the field
    const to = page.getByTestId('now-to');
    await expect(to).toHaveText(/Allyte CoS/);
    await expect(to.locator('.avatar')).toHaveCount(1);
    const box = page.getByRole('textbox', { name: 'Message Allyte CoS' });
    expect((await to.boundingBox())!.y).toBeLessThan((await box.boundingBox())!.y);
    const thread = page.getByTestId('now-thread');
    await expect(thread.locator('li.from-me')).toContainText('You to Allyte CoS');
    await expect(page.getByTestId('now-awaits')).toHaveText(/Allyte CoS replies here/);
    expect(await noScrollX(page)).toBe(true);
    expect(await axe(page)).toEqual([]);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `e2e/screenshots/now-layout-${info.project.name}.png`, fullPage: true });
  });
});
