/**
 * Priorities on its own page; Claude sessions and archive candidates on the Sessions page (in More). Neither is in Notifications.
 * @req FR:notifications/pris.route @req FR:notifications/sessions.route
 * @req FR:pris-sessions-ui/pris.block @req FR:pris-sessions-ui/pris.expand @req FR:pris-sessions-ui/pris.edit @req FR:pris-sessions-ui/pris.save
 * @req FR:pris-sessions-ui/pris.conflict @req FR:pris-sessions-ui/pris.invalid @req FR:pris-sessions-ui/sessions.list @req FR:pris-sessions-ui/sessions.row
 * @req FR:pris-sessions-ui/sessions.empty @req FR:pris-sessions-ui/sessions.archive @req FR:pris-sessions-ui/live.inventory @req FR:pris-sessions-ui/live.pris
 * @req NFR:pris-sessions-ui/a11y.axe @req NFR:pris-sessions-ui/a11y.targets @req NFR:pris-sessions-ui/a11y.keys
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mockApi, type Mock, type MockAsk, type MockPri, type MockSessionItem } from './mock';

const iso = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const P = (id: string, title: string, o: Partial<MockPri> = {}): MockPri => ({ id, title, status: 'active', items: [], backlog: [], weekly: [], ...o });
const S = (id: string, project: string, o: Partial<MockSessionItem> = {}): MockSessionItem => ({
  id, title: `Session ${id}`, project, state: 'waiting', reason: 'question', pinned: false, lastActivityAt: iso(12), link: `claude://claude.ai/epitaxy/${id}`, prs: [], ...o,
});
const pris = (): MockPri[] => [
  P('p1', 'Quota-maxxing', { items: [{ text: 'FH PR quality pass', status: 'done' }, { text: 'Stack v2', status: 'doing' }, { text: 'Anything below', status: 'todo' }] }),
  P('p2', 'Autopilot PR progress', { status: 'blocked', items: [{ text: 'Scheduled SM nags', status: 'todo' }] }),
  P('p3', 'Allyte marketplace'),
  P('p4', 'FH 0.11', { status: 'done' }),
  P('p5', 'Personal'),
  P('p6', 'Stack v2 hub'),
  P('p7', 'Catalyst 0.4'),
];
const inventory = (needsYou: MockSessionItem[], archive: MockSessionItem[] = []) => ({ at: new Date().toISOString(), total: needsYou.length + archive.length, counts: {}, needsYou, archive, sessions: [...needsYou, ...archive] });
const ask = (key: string, text: string): MockAsk => ({ key, state: 'open', ask: text, kind: 'go-do', from: 'cos', reversible: true, priority: 'normal', blocks: 0, created: iso(60), updated: iso(30), score: 50, overdue: false });

async function open(page: Page, o: { pris?: MockPri[] | null; needs?: MockSessionItem[]; archive?: MockSessionItem[]; inventory?: boolean; asks?: MockAsk[]; at?: 'priorities' | 'sessions' } = {}): Promise<Mock> {
  const m = await mockApi(page);
  m.pris = o.pris === null ? null : { version: 1, rev: 4, pris: o.pris ?? pris() };
  m.inventory = o.inventory === false ? null : inventory(o.needs ?? [S('a1', 'allyte'), S('a2', 'allyte', { state: 'stuck', reason: 'dead-turn' }), S('x1', 'xerilium', { reason: 'permission', ask: 'Approve the push' })], o.archive ?? [S('d1', 'ftk', { state: 'done', reason: 'pr-merged' }), S('d2', 'other', { state: 'done', reason: 'superseded' })]);
  m.asks = o.asks ?? [ask('k1', 'Register the npm trusted publisher')];
  const at = o.at ?? 'priorities';
  await page.goto(`/#/${at}`);
  await expect(page.getByRole('heading', { name: at === 'sessions' ? 'Sessions' : 'Priorities', level: 1 })).toBeVisible();
  return m;
}
const block = (p: Page) => p.getByTestId('pris');
const row = (p: Page, id: string) => p.locator(`.pri[data-id="${id}"]`);
const lastPut = (m: Mock) => m.calls.filter((c) => c.path === '/pris').at(-1);

test.describe('Priorities', () => {
  test('own page: number, title, status word, progress, next item; first 5 open, the rest behind a count', async ({ page }) => {
    await open(page);
    await expect(block(page)).toBeVisible();
    await expect(page.locator('.ask-li')).toHaveCount(0);
    await expect(page.locator('.pri')).toHaveCount(5);
    await expect(row(page, 'p4')).toHaveCount(0); // done: behind the count
    const r1 = row(page, 'p1');
    await expect(r1.locator('.pri-n')).toHaveText('1');
    await expect(r1).toContainText('Quota-maxxing');
    await expect(r1.locator('.pri-status')).toHaveText(/Active/);
    await expect(r1.locator('.pri-progress')).toHaveText('1/3');
    await expect(r1.locator('.pri-next')).toHaveText('Stack v2');
    await expect(row(page, 'p2').locator('.pri-status')).toHaveText(/Blocked/);
    await expect(row(page, 'p6').locator('.pri-n')).toHaveText('6');
    await block(page).getByRole('button', { name: 'Show 2 more' }).click();
    await expect(page.locator('.pri')).toHaveCount(7);
  });

  test('a tap opens one priority in place; edit the title with Enter, Escape cancels', async ({ page }) => {
    const m = await open(page);
    const toggle = row(page, 'p1').locator('.pri-toggle');
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(row(page, 'p1').locator('.pri-item')).toHaveCount(3);
    await row(page, 'p2').locator('.pri-toggle').click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await toggle.click();
    await row(page, 'p1').getByRole('button', { name: 'Rename priority' }).click();
    const input = row(page, 'p1').getByLabel('Priority title');
    await expect(input).toBeFocused();
    await input.fill('Never saved');
    await input.press('Escape');
    await expect(row(page, 'p1')).toContainText('Quota-maxxing');
    expect(lastPut(m)).toBeUndefined();
    await row(page, 'p1').getByRole('button', { name: 'Rename priority' }).click();
    await row(page, 'p1').getByLabel('Priority title').fill('Quota-maxxing (Thu 10am)');
    await page.keyboard.press('Enter');
    await expect(row(page, 'p1')).toContainText('Quota-maxxing (Thu 10am)');
    await expect.poll(() => lastPut(m)?.body.rev).toBe(4);
    expect(lastPut(m)!.body.pris[0].title).toBe('Quota-maxxing (Thu 10am)');
    expect(lastPut(m)!.body.pris).toHaveLength(7);
    await expect.poll(() => m.pris!.rev).toBe(5);
  });

  test('status, item text and status, add, remove, and move all save the whole list with the latest rev', async ({ page }) => {
    const m = await open(page);
    await row(page, 'p1').locator('.pri-toggle').click();
    await row(page, 'p1').getByLabel('Status of Quota-maxxing').selectOption('paused');
    await expect(row(page, 'p1').locator('.pri-status')).toHaveText(/Paused/);
    await expect.poll(() => m.pris!.pris[0].status).toBe('paused');
    await row(page, 'p1').getByLabel('Status of item Anything below').selectOption('doing');
    await expect.poll(() => m.pris!.pris[0].items[2].status).toBe('doing');
    await row(page, 'p1').getByRole('button', { name: 'Edit item Stack v2' }).click();
    await row(page, 'p1').getByLabel('Item text').fill('Stack v2 UI');
    await row(page, 'p1').getByLabel('Item text').blur(); // blur saves too
    await expect.poll(() => m.pris!.pris[0].items[1].text).toBe('Stack v2 UI');
    await row(page, 'p1').getByLabel('New item').fill('Ship chunk 3');
    await row(page, 'p1').getByLabel('New item').press('Enter');
    await expect(row(page, 'p1').locator('.pri-item')).toHaveCount(4);
    await expect.poll(() => m.pris!.pris[0].items.at(-1)?.text).toBe('Ship chunk 3');
    await row(page, 'p1').getByRole('button', { name: 'Remove item FH PR quality pass' }).click();
    await expect(row(page, 'p1').getByLabel('New item')).toBeFocused();
    await expect.poll(() => m.pris!.pris[0].items.map((i) => i.text)).toEqual(['Stack v2 UI', 'Anything below', 'Ship chunk 3']);
    await row(page, 'p1').getByRole('button', { name: 'Move Quota-maxxing down' }).click();
    await expect.poll(() => m.pris!.pris.map((p) => p.id).slice(0, 2)).toEqual(['p2', 'p1']);
    await expect(row(page, 'p1').locator('.pri-n')).toHaveText('2');
    // every write carried the rev it read: no conflict on the way
    const revs = m.calls.filter((c) => c.path === '/pris').map((c) => c.body.rev);
    expect(revs).toEqual(revs.map((_, i) => 4 + i));
  });

  test('a 409 re-reads and applies the same edit to the new list; a second conflict reloads and says so', async ({ page }) => {
    const m = await open(page);
    // another window adds a priority
    m.pris = { version: 1, rev: 9, pris: [...m.pris!.pris, P('p8', 'From the iPhone')] };
    await row(page, 'p3').locator('.pri-toggle').click();
    await row(page, 'p3').getByLabel('Status of Allyte marketplace').selectOption('paused');
    await expect.poll(() => m.pris!.rev).toBe(10);
    expect(m.pris!.pris.map((p) => [p.id, p.status]).slice(2)).toEqual([['p3', 'paused'], ['p4', 'done'], ['p5', 'active'], ['p6', 'active'], ['p7', 'active'], ['p8', 'active']]);
    await expect(page.locator('.toast')).toHaveCount(0);
    // the item the edit targets is gone on the server: nothing is sent and the server list wins
    m.pris = { version: 1, rev: 12, pris: m.pris!.pris.filter((p) => p.id !== 'p3') };
    await row(page, 'p3').getByLabel('Status of Allyte marketplace').selectOption('blocked');
    await expect(page.locator('.toast')).toContainText('Priorities changed elsewhere. Reloaded.');
    await expect(row(page, 'p3')).toHaveCount(0);
  });

  test('a 400 or a network failure puts the server list back and says why', async ({ page }) => {
    const m = await open(page);
    m.fail.set('POST /pris', { status: 400, code: 'bad_request', message: 'Validation failed', details: [{ field: 'pris[0].title', message: 'Too long' }] });
    await row(page, 'p1').locator('.pri-toggle').click();
    await row(page, 'p1').getByLabel('Status of Quota-maxxing').selectOption('paused');
    await expect(page.locator('.toast')).toContainText('pris[0].title: Too long');
    await expect(row(page, 'p1').locator('.pri-status')).toHaveText(/Active/);
    m.fail.set('POST /pris', { status: 500, code: 'internal', message: 'Disk full' });
    await row(page, 'p1').getByLabel('Status of Quota-maxxing').selectOption('done');
    await expect(page.locator('.toast').last()).toContainText('Not saved: Disk full');
    await expect(row(page, 'p1').locator('.pri-status')).toHaveText(/Active/);
  });

  test('no priorities yet: one line and Add priority; a new one saves with a slug id', async ({ page }) => {
    const m = await open(page, { pris: [] });
    await expect(block(page)).toContainText('No priorities yet');
    await block(page).getByRole('button', { name: 'Add priority' }).click();
    await block(page).getByLabel('New priority').fill('Ship the web app');
    await page.keyboard.press('Enter');
    await expect(row(page, 'ship-the-web-app')).toContainText('Ship the web app');
    await expect.poll(() => m.pris!.pris).toEqual([P('ship-the-web-app', 'Ship the web app')]);
    // blur adds too: typed text is never lost
    await block(page).getByRole('button', { name: 'Add priority' }).click();
    await block(page).getByLabel('New priority').fill('Second one');
    await block(page).getByLabel('New priority').blur();
    await expect.poll(() => m.pris!.pris.map((p) => p.title)).toEqual(['Ship the web app', 'Second one']);
  });

  test('view keys do not fire while a priority field has focus', async ({ page }) => {
    const m = await open(page);
    await row(page, 'p1').locator('.pri-toggle').click();
    await row(page, 'p1').getByLabel('New item').fill('zrjk');
    await expect(page.locator('.ask-defer')).toHaveCount(0); // `z` would open Defer
    await expect(row(page, 'p1').getByLabel('New item')).toHaveValue('zrjk');
    void m;
  });

  test('a host with no store shows no Priorities and no Sessions', async ({ page }) => {
    await open(page, { pris: null, inventory: false });
    await expect(block(page)).toHaveCount(0);
    await expect(page.locator('.page-empty')).toBeVisible();
    await page.goto('/#/sessions');
    await expect(page.locator('.page-empty')).toHaveText('No sessions wait on you.');
    await expect(page.getByTestId('sessions')).toHaveCount(0);
  });
});

test.describe('Sessions', () => {
  test('waiting and stuck sessions on the Sessions page, by project, each a deep link with state word, reason, and time', async ({ page }) => {
    await open(page, { at: 'sessions' });
    const s = page.getByTestId('sessions');
    await expect(s.getByRole('heading', { name: /Waiting on you/ })).toContainText('3');
    await expect(s.locator('h3')).toHaveText(['Allyte', 'Xerilium']);
    const links = s.locator('a.session-row');
    await expect(links).toHaveCount(3);
    await expect(links.nth(0)).toHaveAttribute('href', 'claude://claude.ai/epitaxy/a1');
    await expect(links.nth(0)).toContainText('Waiting');
    await expect(links.nth(0)).toContainText('Asked a question');
    await expect(links.nth(1)).toContainText('Stuck');
    await expect(links.nth(1)).toContainText('No activity for 30 min');
    await expect(links.nth(2)).toContainText('Approve the push');
    await expect(links.nth(0)).toHaveAccessibleName(/^Session a1, Waiting, Asked a question, 12m ago$/);
    await expect(page.locator('.asks')).toHaveCount(0);
  });

  test('a session link that is not an epitaxy link is plain text', async ({ page }) => {
    await open(page, { at: 'sessions', needs: [S('bad', 'other', { link: 'javascript:alert(1)' })] });
    await expect(page.getByTestId('sessions').locator('a')).toHaveCount(0);
    await expect(page.getByTestId('sessions')).toContainText('Session bad');
  });

  test('sessions never count in Notifications', async ({ page }) => {
    await open(page, { at: 'sessions', asks: [] });
    await expect(page.getByTestId('sessions')).toBeVisible();
    await page.goto('/#/notifications');
    await expect(page.getByTestId('asks-empty')).toBeVisible();
    await expect(page.getByTestId('sessions')).toHaveCount(0);
  });
  test('with no sessions, the Sessions page says so', async ({ page }) => {
    await open(page, { at: 'sessions', asks: [], needs: [], archive: [] });
    await expect(page.locator('.page-empty')).toHaveText('No sessions wait on you.');
    await expect(page.getByTestId('sessions')).toHaveCount(0);
  });

  test('archive candidates are collapsed; open, they list each one and Copy ids copies one id per line', async ({ page, context, browserName }) => {
    test.skip(browserName !== 'chromium', 'clipboard permissions are chromium only');
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const m = await open(page, { at: 'sessions' });
    const btn = page.getByRole('button', { name: /Archive candidates · 2/ });
    await expect(btn).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.archive-list')).toHaveCount(0);
    await btn.click();
    await expect(btn).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.archive-list li')).toHaveCount(2);
    await expect(page.locator('.archive-list a').first()).toHaveAttribute('href', 'claude://claude.ai/epitaxy/d1');
    await page.getByRole('button', { name: 'Copy ids' }).click();
    await expect(page.locator('.toast')).toContainText('Copied 2 ids');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('d1\nd2');
    expect(m.calls.filter((c) => /archive/.test(c.path))).toEqual([]);
  });

  test('live: the inventory and priorities re-read every 15 s in place, with no focus move and no toast', async ({ page }) => {
    await page.clock.install();
    const m = await open(page);
    await row(page, 'p1').locator('.pri-toggle').focus();
    m.inventory = inventory([S('n1', 'ftk', { title: 'Fresh one' })]);
    m.pris = { version: 1, rev: 5, pris: [P('p1', 'Quota-maxxing renamed'), ...m.pris!.pris.slice(1)] };
    await page.clock.fastForward(16_000);
    await expect(row(page, 'p1')).toContainText('Quota-maxxing renamed');
    await expect(row(page, 'p1').locator('.pri-toggle')).toBeFocused();
    await expect(page.locator('.toast')).toHaveCount(0);
    await page.evaluate(() => { location.hash = '#/sessions'; });
    await page.clock.fastForward(16_000);
    await expect(page.getByTestId('sessions').locator('a.session-row')).toHaveCount(1);
    await expect(page.getByTestId('sessions')).toContainText('Fresh one');
    await expect(page.locator('[data-testid="sessions-announce"]')).toHaveText('1 session needs you');
  });
});

test.describe('Design', () => {
  for (const scheme of ['light', 'dark'] as const) {
    test(`axe: no violations, contrast included (${scheme})`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      await open(page);
      await row(page, 'p1').locator('.pri-toggle').click();
      const axe = async () => (await new AxeBuilder({ page }).include('.page-view').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
      expect(await axe()).toEqual([]);
      await page.goto('/#/sessions');
      await page.getByRole('button', { name: /Archive candidates/ }).click();
      expect(await axe()).toEqual([]);
    });
  }

  // @req NFR:pris-sessions-ui/a11y.calm
  test('calm: the warning color only on blocked and stuck, nothing moves with reduced motion', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await open(page);
    const warn = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--warn').trim());
    const warnColor = await page.locator('.pri-status.warn').first().evaluate((e) => getComputedStyle(e).color);
    const hotIn = (sel: string) => page.locator(sel).evaluateAll((els, c) => els.filter((e) => e.children.length === 0 && getComputedStyle(e).color === c).map((e) => e.closest('.pri, li')?.textContent?.slice(0, 20)), warnColor);
    expect(warn).toBeTruthy();
    expect(new Set(await hotIn('[data-testid="pris"] *'))).toEqual(new Set([await row(page, 'p2').textContent().then((t) => t!.slice(0, 20))]));
    expect(await row(page, 'p1').locator('.pri-toggle').evaluate((e) => getComputedStyle(e).transitionDuration)).toBe('0s');
    await page.goto('/#/sessions');
    await expect(page.locator('a.session-row')).toHaveCount(3);
    expect(new Set(await hotIn('[data-testid="sessions"] *'))).toEqual(new Set([await page.locator('a.session-row').nth(1).textContent().then((t) => t!.slice(0, 20))]));
  });

  test('targets: 44 px on touch, 24 px on desktop; no horizontal scroll', async ({ page, isMobile }) => {
    await open(page);
    await row(page, 'p1').locator('.pri-toggle').click();
    const min = isMobile ? 44 : 24;
    const small = (sel: string) => page.locator(sel).evaluateAll((els, m) => els.filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height < m; }).map((e) => `${e.tagName} ${e.getAttribute('aria-label') ?? e.textContent}`), min);
    expect(await small('[data-testid="pris"] button, [data-testid="pris"] select, [data-testid="pris"] input')).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.goto('/#/sessions');
    await page.getByRole('button', { name: /Archive candidates/ }).click();
    expect(await small('[data-testid="sessions"] a, .archive button, .archive a')).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
