/** Now polish: an honest calendar line with Connect, ask cards that expand in place, two columns on wide screens, a named composer. */
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
/** Make the page a local host (`stack web`), where `/setup` exists. */
const local = (page: Page) => page.route('**/.auth/me', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ clientPrincipal: { identityProvider: 'local', userId: 'local', userDetails: 'local', userRoles: ['authenticated'] }, local: { mode: 'demo', repo: '/r', branch: 'main' } }) }));

test.describe('Now: the calendar line is honest', () => {
  // @req FR:ux-consolidation/cal.ui @req FR:ux-consolidation/cal.connect @req FR:ux-consolidation/one.meetings
  test('not connected: never says No meetings; Connect opens the panel in place', async ({ page }, info) => {
    await ten(page);
    await mockApi(page, { tasks: seed() }); // no calendar
    await page.goto('/#/now');
    await page.clock.resume();
    const cal = page.getByTestId('now-cal');
    await expect(cal).toContainText('Calendar not connected');
    await expect(page.getByText('No meetings left today.')).toHaveCount(0);
    const connect = cal.getByRole('button', { name: 'Connect' });
    await expect(connect).toHaveAttribute('aria-expanded', 'false');
    await connect.click();
    await expect(cal.getByRole('button', { name: 'Close' })).toHaveAttribute('aria-expanded', 'true');
    const panel = page.getByTestId('now-connect');
    // the hosted app has no /setup: steps and the way to connect, no field
    await expect(panel).toContainText('Outlook');
    await expect(panel).toContainText('Google');
    await expect(panel).toContainText('STACK_CALENDAR_ICS');
    await expect(panel.getByRole('textbox')).toHaveCount(0);
    await expect(panel.locator('.now-cmd code')).toHaveText('stack graph login --client-id <app id> --with calendar');
    await expect(panel.getByRole('button', { name: 'Check connection' })).toBeVisible();
    expect(await noScrollX(page)).toBe(true);
    expect(await axe(page)).toEqual([]);
    if (info.project.name === 'mobile') await tall(page, '[data-testid="now-side"]');
  });

  // @req FR:ux-consolidation/cal.connect @req FR:ux-consolidation/cal.save @req FR:ux-consolidation/cal.check
  test('local host: paste a link, Connect saves it through /setup, then the next 2 meetings show', async ({ page }, info) => {
    const d = await ten(page);
    const m = await mockApi(page, { tasks: seed() });
    await local(page); // after mockApi: the last route registered wins
    const posts: unknown[] = [];
    await page.route('**/setup', async (r) => {
      if (r.request().method() !== 'POST') return r.fulfill({ status: 404, body: '' });
      posts.push(r.request().postDataJSON());
      // the host now reads the feed
      m.events = [
        { id: 'e1', subject: 'Allyte sync', start: at(d, 10, 10), end: at(d, 10, 40), allDay: false, showAs: 'busy', cancelled: false, online: true, joinUrl: 'https://example.test/join' },
        { id: 'e2', subject: 'FOCUS TF1', start: at(d, 13), end: at(d, 14), allDay: false, showAs: 'busy', cancelled: false, online: false },
        { id: 'e3', subject: 'Third', start: at(d, 15), end: at(d, 16), allDay: false, showAs: 'busy', cancelled: false, online: false },
      ];
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ restart: false, status: null }) });
    });
    await page.goto('/#/now');
    await page.clock.resume();
    await page.getByTestId('now-cal').getByRole('button', { name: 'Connect' }).click();
    const panel = page.getByTestId('now-connect');
    const field = panel.getByRole('textbox', { name: 'Published calendar link (ICS)' });
    await field.fill('http://not-secure.test/cal.ics');
    await panel.getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(panel.getByRole('alert')).toContainText('https');
    expect(posts).toEqual([]);
    expect(await axe(page)).toEqual([]);
    if (info.project.name === 'mobile') await tall(page, '[data-testid="now-side"]');
    await page.screenshot({ path: `e2e/screenshots/now-connect-${info.project.name}.png`, fullPage: true });
    const link = 'https://outlook.office365.com/owa/calendar/abc/def/calendar.ics';
    await field.fill(link);
    await field.press('Enter');
    await expect.poll(() => posts).toEqual([{ connect: 'calendar', ics: link }]);
    const meetings = page.getByTestId('now-meetings');
    await expect(meetings.locator('li')).toHaveCount(2);
    await expect(meetings).toContainText('Allyte sync');
    await expect(meetings).not.toContainText('Third');
    await expect(page.getByTestId('now-cal')).toHaveCount(0);
    await expect(page.getByTestId('now-layer')).toHaveText(/Live calendar/);
    // the link never shows in the page once saved
    expect(await page.content()).not.toContain('abc/def');
  });

  // @req FR:ux-consolidation/cal.ui @req FR:ux-consolidation/cal.check @req FR:ux-consolidation/cal.fresh
  test('unavailable and stale say so, with Check connection; weekly meetings still show', async ({ page }) => {
    const d = await ten(page);
    const m = await mockApi(page, { tasks: seed() });
    m.calendarFail = true;
    m.meetings = [{ days: [d.getDay()], start: '11:00', end: '11:30', title: 'Weekly sync', owner: 'cos', topic: 'Status' }];
    await page.goto('/#/now');
    await page.clock.resume();
    const cal = page.getByTestId('now-cal');
    await expect(cal).toContainText('Calendar unavailable');
    await expect(cal.getByRole('button', { name: 'Fix' })).toBeVisible();
    await expect(page.getByText('No meetings left today.')).toHaveCount(0);
    await expect(page.getByTestId('now-meetings')).toContainText('Weekly sync');
    await expect(page.getByTestId('now-layer')).toHaveText(/Weekly schedule/);
    // stale: the copy is 2 h old
    m.calendarFail = false; m.events = [];
    m.calSource = { kind: 'calendar', via: 'ics', state: 'stale', lastSyncAt: new Date(d.getTime() - 125 * 60_000).toISOString() }; // the page clock, not this process's
    await cal.getByRole('button', { name: 'Check connection' }).click();
    await expect(cal).toContainText('Calendar last synced 2 h ago');
    await expect(page.getByText('No meetings left today.')).toHaveCount(0);
    // fresh and empty: now it may say so
    m.calSource = undefined;
    await cal.getByRole('button', { name: 'Check connection' }).click();
    await expect(page.getByText('No meetings left today.')).toBeVisible();
  });
});

test.describe('Now: Waiting on you cards', () => {
  // @req FR:ux-consolidation/one.messages @req FR:ux-consolidation/one.expand @req FR:ux-consolidation/one.answer @req FR:ux-consolidation/one.layout
  test('tap the body expands in place with the context and every response; answers use the Needs you API with Undo', async ({ page }, info) => {
    const d = await ten(page);
    const m = await mockApi(page, { tasks: seed() });
    m.team = [{ slug: 'cos', name: 'Allyte CoS', scope: ['*'], mode: 'ad-hoc', prompt: '', defined: true, projects: ['alpha'] }];
    m.asks = [
      ask('a1', 'cos', 90, { ask: 'Approve the FH 1105 spec thread', why: 'The spec thread is held for your ack', recommend: 'Approve', default: 'Approve on Friday', by: at(d, 17), link: 'https://github.com/x/y/pull/1105' }),
      ask('a2', 'cos', 80, { ask: 'Pick a venue', kind: 'decide', options: ['Seattle', 'Remote'], recommend: 'Remote' }),
      ask('a3', 'cos', 70, { ask: 'Answer the budget question', kind: 'answer', recommend: undefined }),
      ask('a4', 'cos', 60),
    ];
    await page.goto('/#/now');
    await page.clock.resume();
    const waiting = page.getByTestId('now-asks');
    await expect(waiting.locator(':scope > li')).toHaveCount(3);
    await expect(page.getByRole('link', { name: /1 more in Needs you/ }).or(page.getByRole('button', { name: /1 more in Needs you/ }))).toBeVisible();
    const card = waiting.locator(':scope > li').first();
    await expect(card).toContainText('Allyte CoS'); // the source agent by name, with its avatar
    await expect(card.locator('.avatar')).toHaveCount(1);
    const body = card.getByRole('button', { name: /Approve the FH 1105 spec thread/ });
    await expect(body).toHaveAttribute('aria-expanded', 'false');
    await body.click();
    await expect(body).toHaveAttribute('aria-expanded', 'true');
    await expect(page).toHaveURL(/#\/now/); // expand, never navigate
    const more = card.getByTestId('now-ask-more');
    await expect(more).toContainText('The spec thread is held for your ack');
    await expect(more).toContainText('If silent: Approve on Friday');
    await expect(more).toContainText(/Today 5:00/);
    await expect(more.getByRole('link', { name: /Open/ })).toHaveAttribute('href', 'https://github.com/x/y/pull/1105');
    for (const name of ['Approve', 'Reject', 'Reply', 'Defer', 'Open in Needs you']) await expect(more.getByRole('button', { name, exact: true })).toBeVisible();
    expect(await noScrollX(page)).toBe(true);
    expect(await axe(page)).toEqual([]);
    if (info.project.name === 'mobile') await tall(page, '[data-testid="now-asks"]');
    await page.screenshot({ path: `e2e/screenshots/now-ask-open-${info.project.name}.png`, fullPage: true });
    // only one card is open at a time
    await waiting.getByRole('button', { name: /Pick a venue/ }).click();
    await expect(body).toHaveAttribute('aria-expanded', 'false');
    // choose an option: the same answer API
    await waiting.getByTestId('now-ask-more').getByRole('button', { name: 'Remote' }).click();
    await expect.poll(() => m.calls.find((c) => c.path === '/asks/a2/answer')?.body).toEqual({ answer: 'option', text: 'Remote' });
    await expect(waiting).not.toContainText('Pick a venue');
    // Undo brings it back
    await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => m.asks.find((a) => a.key === 'a2')?.state).toBe('open');
    await expect(waiting).toContainText('Pick a venue');
  });

  // @req FR:ux-consolidation/one.expand @req FR:ux-consolidation/one.answer
  test('answer with text and defer, inline', async ({ page }) => {
    await ten(page);
    const m = await mockApi(page, { tasks: seed() });
    m.asks = [ask('q1', 'cos', 90, { ask: 'Answer the budget question', kind: 'answer', recommend: undefined }), ask('q2', 'cos', 80, { ask: 'Approve the plan' })];
    await page.goto('/#/now');
    await page.clock.resume();
    const waiting = page.getByTestId('now-asks');
    // an answer ask: Reply on the closed card opens it with the field
    await waiting.locator(':scope > li').first().getByRole('button', { name: 'Reply', exact: true }).click();
    const field = waiting.getByRole('textbox', { name: 'Reply to cos' });
    await expect(field).toBeFocused();
    await field.fill('Keep it under 5k');
    await field.press('Enter');
    await expect.poll(() => m.calls.find((c) => c.path === '/asks/q1/answer')?.body).toEqual({ answer: 'reply', text: 'Keep it under 5k' });
    await expect(waiting).not.toContainText('Answer the budget question');
    await expect(page).toHaveURL(/#\/now/);
    // defer
    await waiting.getByRole('button', { name: /Approve the plan/ }).click();
    await waiting.getByTestId('now-ask-more').getByRole('button', { name: 'Defer', exact: true }).click();
    await waiting.getByRole('group', { name: 'Defer until' }).getByRole('button', { name: '1 hour' }).click();
    await expect.poll(() => m.calls.find((c) => c.path === '/asks/q2/answer')?.body?.answer).toBe('defer');
    await expect(waiting).toHaveCount(0);
  });

  test('Open in Needs you opens that ask there', async ({ page }) => {
    await ten(page);
    const m = await mockApi(page, { tasks: seed() });
    m.asks = [ask('a1', 'cos', 90, { ask: 'Approve the plan' })];
    await page.goto('/#/now');
    await page.getByRole('button', { name: /Approve the plan/ }).click();
    await page.getByRole('button', { name: 'Open in Needs you' }).click();
    await expect(page).toHaveURL(/#\/asks/);
  });
});

test.describe('Now: layout and composer', () => {
  // @req FR:now-screen/now.layout @req FR:ux-consolidation/one.layout @req FR:now-screen/now.compose @req FR:now-screen/now.thread
  test('wide screens put Next and Waiting on you in a right column; phones stack them under the task', async ({ page }, info) => {
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
