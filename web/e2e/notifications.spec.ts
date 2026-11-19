/**
 * Notifications: a bell nav item with a count, one page of only the things to act on.
 * Priorities gets its own page; Sessions sits in More (the palette).
 * @req FR:notifications/list.route @req FR:notifications/list.what @req FR:notifications/list.not @req FR:notifications/list.empty @req FR:notifications/list.words
 * @req FR:notifications/bell.item @req FR:notifications/bell.count @req FR:notifications/pris.route
 * @req FR:notifications/sessions.route @req FR:notifications/sessions.more @req FR:notifications/nav.rail @req FR:notifications/nav.tabbar
 * @req NFR:notifications/a11y.axe @req NFR:notifications/calm
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
/** The visible Notifications nav item: the rail on desktop, the tab bar on a phone. */
const item = (page: Page) => page.locator('[data-testid="nav-notifications"]:visible');

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
    await expect(page.getByTestId('sessions')).toHaveCount(0);
    expect((await axe(page)).violations).toEqual([]);
  });

  test('the nav item has a bell and the count, and opens the page', async ({ page }) => {
    await setup(page);
    await page.goto('/#/now');
    const it = item(page);
    await expect(it).toHaveCount(1);
    await expect(it.locator('svg')).toHaveCount(1);
    await expect(it).toHaveAccessibleName(/^Notifications\b.*2 open/);
    await expect(it.locator('.badge')).toHaveText('2');
    await it.click();
    await expect(page).toHaveURL(/#\/notifications$/);
    await expect(page.getByRole('heading', { name: /^Notifications/, level: 1 })).toBeVisible();
  });

  test('an expired sign-in is a notification and counts; empty state is calm', async ({ page }) => {
    const m = await setup(page, []);
    await page.goto('/#/notifications');
    await expect(page.getByTestId('asks-empty')).toContainText("You're all caught up.");
    await expect(item(page).locator('.badge')).toHaveCount(0);
    m.fail.set('/sync', { status: 401, code: 'unauthorized', message: 'Authentication required' });
    await page.reload();
    const n = page.getByTestId('signin-notice');
    await expect(n).toContainText('Sign-in expired');
    await expect(n.getByRole('button', { name: 'Sign in' })).toBeVisible();
    await expect(page.getByTestId('asks-empty')).toHaveCount(0);
    await expect(item(page).locator('.badge')).toHaveText('1');
  });

  test('Now names Notifications', async ({ page }) => {
    await setup(page, [ask('k1', 'One'), ask('k2', 'Two'), ask('k3', 'Three'), ask('k4', 'Four')]);
    await page.goto('/#/now');
    await expect(page.getByRole('button', { name: /more in Notifications/ })).toBeVisible();
  });
});

test.describe('Priorities and Sessions', () => {
  test('Priorities has its own page', async ({ page }, info) => {
    await setup(page);
    await page.goto('/#/now');
    if (info.project.name !== 'mobile') await page.locator('.rail').getByRole('button', { name: /^Priorities/ }).click();
    else await page.goto('/#/priorities');
    await expect(page).toHaveURL(/#\/priorities$/);
    await expect(page.getByRole('heading', { name: 'Priorities', level: 1 })).toBeVisible();
    await expect(page.locator('.pri[data-id="p1"]')).toContainText('Quota-maxxing');
    await expect(page.locator('.ask-li')).toHaveCount(0);
    expect((await axe(page)).violations).toEqual([]);
  });

  test('Sessions sits in More and opens #/inventory', async ({ page }) => {
    await setup(page);
    await page.goto('/#/now');
    await page.keyboard.press('Control+k');
    await page.getByRole('option', { name: /Go to Sessions/ }).click();
    await expect(page).toHaveURL(/#\/inventory$/);
    await expect(page.getByRole('heading', { name: 'Sessions', level: 1 })).toBeVisible();
    await expect(page.getByTestId('sessions').getByText('Session a1')).toBeVisible();
    expect((await axe(page)).violations).toEqual([]);
  });

  test('Sessions with nothing waiting says so', async ({ page }) => {
    const m = await setup(page);
    m.inventory = { at: new Date().toISOString(), total: 0, counts: {}, needsYou: [], archive: [], sessions: [] };
    await page.goto('/#/inventory');
    await expect(page.getByText('No sessions wait on you.')).toBeVisible();
  });

  test('rail order on desktop; tab bar on phone', async ({ page }, info) => {
    await setup(page);
    await page.goto('/#/now');
    if (info.project.name === 'mobile') {
      await expect(page.locator('.tabbar .tab')).toHaveText([/Now/, /My day/, '', /Notifications/, /More/]);
      return;
    }
    await expect(page.locator('.rail .tab-label')).toContainText(['Now', 'My day', /Notifications/, 'Priorities']);
    await expect(page.locator('.rail').getByRole('button', { name: /^Sessions/ })).toHaveCount(0);
  });
});
