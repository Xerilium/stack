/**
 * Notifications: bell in the chrome, flyout (desktop) or page (phone), one ranked list of things to act on.
 * Priorities and Sessions get their own pages; Sessions sits in More. Cards change background on hover; no key badges.
 * @req FR:notifications/bell.place @req FR:notifications/bell.count @req FR:notifications/bell.flyout @req FR:notifications/bell.phone
 * @req FR:notifications/list.route @req FR:notifications/list.what @req FR:notifications/list.not @req FR:notifications/list.empty
 * @req FR:notifications/pris.route @req FR:notifications/sessions.route @req FR:notifications/sessions.more
 * @req FR:notifications/nav.rail @req FR:notifications/nav.tabbar @req FR:notifications/cards.hover @req FR:notifications/cards.focus
 * @req FR:notifications/keys.none @req FR:notifications/keys.tip @req NFR:notifications/a11y.axe @req NFR:notifications/a11y.targets
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mockApi, type Mock, type MockAsk, type MockSessionItem } from './mock';

const iso = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const ask = (key: string, text: string, score = 50): MockAsk => ({ key, state: 'open', ask: text, kind: 'go-do', from: 'cos', reversible: true, priority: 'normal', blocks: 0, created: iso(60), updated: iso(30), score, overdue: false });
const S = (id: string, o: Partial<MockSessionItem> = {}): MockSessionItem => ({ id, title: `Session ${id}`, project: 'allyte', state: 'waiting', reason: 'question', pinned: false, lastActivityAt: iso(12), link: `claude://claude.ai/epitaxy/${id}`, prs: [], ...o });

async function setup(page: Page, asks: MockAsk[] = [ask('k1', 'Register the npm trusted publisher', 60), ask('k2', 'Pick the launch date', 40)]): Promise<Mock> {
  const m = await mockApi(page);
  m.asks = asks;
  m.pris = { version: 1, rev: 1, pris: [{ id: 'p1', title: 'Quota-maxxing', status: 'active', items: [{ text: 'Stack v2', status: 'doing' }], backlog: [], weekly: [] }] };
  const needs = [S('a1')];
  m.inventory = { at: new Date().toISOString(), total: 2, counts: {}, needsYou: needs, archive: [S('d1', { state: 'done', reason: 'pr-merged' })], sessions: needs };
  return m;
}
const axe = (page: Page) => new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze();
const bell = (page: Page) => page.locator('.bell:visible');

test.describe('Notifications', () => {
  test('page: one ranked list, no Priorities, no Sessions; old routes redirect', async ({ page }) => {
    await setup(page);
    for (const old of ['#/asks', '#/needs']) {
      await page.goto(`/${old}`);
      await expect(page.getByRole('heading', { name: /^Notifications/, level: 1 })).toBeVisible();
      await expect(page).toHaveURL(/#\/notifications$/);
    }
    await expect(page.locator('.ask-li')).toHaveCount(2);
    await expect(page.locator('.ask-li').first()).toContainText('Register the npm trusted publisher');
    await expect(page.getByTestId('pris')).toHaveCount(0);
    await expect(page.getByRole('heading', { name: /^Sessions/ })).toHaveCount(0);
    expect((await axe(page)).violations).toEqual([]);
  });

  test('bell shows the count; desktop opens a flyout with direct actions, phone opens the page', async ({ page }, info) => {
    const m = await setup(page);
    await page.goto('/#/now');
    const b = bell(page);
    await expect(b).toHaveCount(1);
    await expect(b).toHaveAccessibleName('Notifications, 2');
    await expect(b.locator('.badge')).toHaveText('2');
    const box = await b.boundingBox();
    if (info.project.name === 'mobile') {
      expect(box!.height).toBeGreaterThanOrEqual(44);
      await b.click();
      await expect(page).toHaveURL(/#\/notifications$/);
      return;
    }
    await b.click();
    const fly = page.getByRole('dialog', { name: 'Notifications' });
    await expect(fly).toBeVisible();
    await expect(b).toHaveAttribute('aria-expanded', 'true');
    await expect(fly.locator('.now-ask')).toHaveCount(2);
    expect((await axe(page)).violations).toEqual([]);
    await fly.locator('.now-ask').first().getByRole('button', { name: 'Do' }).or(fly.locator('.now-ask').first().locator('.now-mini')).first().click();
    await expect.poll(() => m.calls.some((c) => c.path.startsWith('/asks'))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(fly).toHaveCount(0);
    await expect(b).toBeFocused();
    await b.click();
    await page.getByRole('dialog', { name: 'Notifications' }).getByRole('link', { name: 'See all' }).click();
    await expect(page).toHaveURL(/#\/notifications$/);
  });

  test('an expired sign-in is a notification; empty state is calm', async ({ page }) => {
    const m = await setup(page, []);
    await page.goto('/#/notifications');
    await expect(page.getByTestId('asks-empty')).toContainText("You're all caught up.");
    await expect(bell(page).locator('.badge')).toHaveCount(0);
    m.fail.set('/sync', { status: 401, code: 'unauthorized', message: 'Authentication required' });
    await page.reload();
    const n = page.getByTestId('signin-notice');
    await expect(n).toContainText('Sign-in expired');
    await expect(n.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(bell(page).locator('.badge')).toHaveText('1');
  });
});

test.describe('Priorities and Sessions', () => {
  test('Priorities has its own page and nav item', async ({ page }) => {
    await setup(page);
    await page.goto('/#/now');
    const nav = page.locator('nav:visible').filter({ has: page.getByRole('button', { name: /^Priorities/ }) }).first();
    await nav.getByRole('button', { name: /^Priorities/ }).click();
    await expect(page).toHaveURL(/#\/priorities$/);
    await expect(page.getByRole('heading', { name: 'Priorities', level: 1 })).toBeVisible();
    await expect(page.locator('.pri[data-id="p1"]')).toContainText('Quota-maxxing');
    await expect(page.locator('.ask-li')).toHaveCount(0);
    expect((await axe(page)).violations).toEqual([]);
  });

  test('Sessions sits in More and opens #/sessions unchanged', async ({ page }) => {
    await setup(page);
    await page.goto('/#/now');
    await page.locator('.more-btn-nav:visible').click();
    const menu = page.getByRole('menu', { name: 'More' });
    await expect(menu).toBeVisible();
    expect((await axe(page)).violations).toEqual([]);
    await menu.getByRole('menuitem', { name: 'Sessions' }).click();
    await expect(page).toHaveURL(/#\/sessions$/);
    await expect(page.getByRole('heading', { name: 'Sessions', level: 1 })).toBeVisible();
    await expect(page.getByTestId('sessions').getByText('Session a1')).toBeVisible();
    expect((await axe(page)).violations).toEqual([]);
  });

  test('rail order on desktop; tab bar on phone', async ({ page }, info) => {
    await setup(page);
    await page.goto('/#/now');
    if (info.project.name === 'mobile') {
      await expect(page.locator('.tabbar .tab')).toHaveText(['Now', 'My day', '', 'Priorities', 'More']);
      return;
    }
    await expect(page.locator('.rail .tab.view')).toHaveText(['Now', 'My day', 'Priorities', 'Inbox', 'Agents', 'Projects', 'Full stack']);
    await expect(page.locator('.rail .more-btn-nav')).toHaveText('More');
  });
});

test.describe('Global rules', () => {
  test('no key badges on any button, link, or menu item; keys live in tooltips', async ({ page }) => {
    await setup(page);
    for (const h of ['#/now', '#/today', '#/notifications', '#/priorities', '#/sessions', '#/home', '#/list']) {
      await page.goto(`/${h}`);
      await page.waitForLoadState('networkidle');
      expect(await page.locator(':is(button, a, [role="menuitem"]) kbd').count(), h).toBe(0);
    }
    await page.goto('/#/now');
    await expect(page.locator('.now-btn.primary')).toHaveAttribute('title', /\(D\)$/);
  });

  test('cards change background on hover', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'hover is a pointer state');
    await setup(page);
    await page.goto('/#/notifications');
    const row = page.locator('.ask-row').first();
    const before = await row.evaluate((e) => getComputedStyle(e).backgroundColor);
    await row.hover();
    await expect.poll(() => row.evaluate((e) => getComputedStyle(e).backgroundColor)).not.toBe(before);
  });
});
