/**
 * Notifications: a bell nav item with a count, one page of only the things to act on.
 * Priorities lives in Settings; Sessions sits in More (the palette).
 * @req FR:notifications/list.route @req FR:notifications/list.what @req FR:notifications/list.not @req FR:notifications/list.empty @req FR:notifications/list.words
 * @req FR:notifications/bell.item @req FR:notifications/bell.count @req FR:notifications/pris.route
 * @req FR:notifications/sessions.route @req FR:notifications/sessions.more @req FR:notifications/nav.rail @req FR:notifications/nav.tabbar
 * @req FR:notifications/list.context @req FR:notifications/list.context.why @req FR:notifications/list.context.pick @req FR:notifications/list.context.read
 * @req FR:notifications/list.context.card @req FR:notifications/list.source @req FR:notifications/list.source.task @req FR:notifications/list.source.session @req FR:notifications/list.context.session @req FR:notifications/list.rowactions @req FR:notifications/list.rowactions.items @req FR:notifications/list.rowactions.context
 * @req FR:notifications/list.rowactions.select @req FR:notifications/list.rowactions.keep @req FR:notifications/list.context.phone @req FR:notifications/list.rowactions.focus @req FR:notifications/list.rowactions.card @req FR:notifications/list.drop @req FR:notifications/list.drop.count
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

  // Now shows the priorities report, not ask cards (FR:priorities-tables/web.place); the nav names Notifications.
  test('Now names Notifications', async ({ page }) => {
    await setup(page, [ask('k1', 'One'), ask('k2', 'Two'), ask('k3', 'Three'), ask('k4', 'Four')]);
    await page.goto('/#/now');
    await expect(item(page)).toContainText('Notifications');
    await expect(page.getByText('Needs you')).toHaveCount(0);
  });
});

test.describe('Notifications: context and actions on every row', () => {
  const rich = (): MockAsk[] => [
    { ...ask('top', 'Pick the launch date', 90), kind: 'answer', from: 'allyte-cos', why: 'Marketing needs a date' },
    { ...ask('pr', 'Approve merging PR 158 into main', 80), kind: 'approve', from: 'stack-architect', project: 'stack', why: 'CI is green; one review is in', link: 'https://github.com/Xerilium/stack/pull/158' },
    { ...ask('mail', 'Review draft reply to Dana', 70), kind: 'review', from: 'email-triage', why: 'Dana asked for the contract terms', link: 'https://outlook.office.com/mail/id/1' },
    { ...ask('sess', 'Unblock the deploy session', 60), from: 'cos', why: 'It waits on a permission', link: 'https://claude.ai/code/session_1', row: 'stack:3' },
    { ...ask('rec', 'Merge the release branch', 55), kind: 'approve', from: 'Chief of Staff', recommend: 'Merge it today', link: 'https://github.com/Xerilium/stack/issues/152' },
    { ...ask('bare', 'Rename the repo', 50) },
    { ...ask('dead', 'Pick one', 40), kind: 'decide' }, // no options: nothing to do
  ];
  const row = (page: Page, key: string) => page.locator(`.ask-li[data-key="${key}"]`);

  test('each row shows who, why and a source link; a row with no action is dropped and not counted', async ({ page }, info) => {
    await setup(page, rich());
    await page.goto('/#/notifications');
    await page.getByRole('button', { name: /Show 1 more/ }).click();
    await expect(page.locator('.ask-li')).toHaveCount(6);
    await expect(row(page, 'dead')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 1 }).locator('.count')).toHaveText('6');
    await expect(item(page).locator('.badge')).toHaveText('6');
    // with no reason, the row says what the sender recommends
    await expect(row(page, 'rec').locator('.ask-ctx-why')).toHaveText('Recommends: Merge it today');
    await expect(row(page, 'rec').getByRole('link', { name: /Issue stack#152/ })).toBeVisible();
    const pr = row(page, 'pr');
    await expect(pr.locator('.ask-who')).toHaveText('stack-architect');
    await expect(pr.locator('.ask-ctx-why')).toHaveText('CI is green; one review is in');
    // a screen reader reads who and why with the row
    await expect(pr.locator('.ask-row')).toHaveAccessibleDescription(/stack-architect.*CI is green; one review is in/);
    await expect(pr.getByRole('link', { name: /PR stack#158/ })).toHaveAttribute('href', 'https://github.com/Xerilium/stack/pull/158');
    await expect(row(page, 'mail').getByRole('link', { name: /Email/ })).toHaveAttribute('target', '_blank');
    await expect(row(page, 'sess').getByRole('link', { name: /Session/ })).toBeVisible();
    await expect(row(page, 'sess').getByRole('button', { name: 'Task' })).toBeVisible(); // an ask with a task row opens it in the app
    await expect(row(page, 'bare').locator('.ask-ctx-why')).toHaveText('No reason given');
    await expect(row(page, 'bare').locator('.ui-source')).toHaveCount(0);
    // the selected notification (the details) has Ask for context too, when it has none; an answer ask never has it
    await expect(page.locator('.ask-card').getByRole('button', { name: 'Ask for context' })).toHaveCount(0);
    await row(page, 'pr').locator('.ask-ctx-why').click(); // a click on who and why selects the row
    await expect(row(page, 'pr').locator('.ask-card .ask-why')).toHaveText('CI is green; one review is in');
    await row(page, 'bare').locator('.ask-ctx-why').click();
    await expect(row(page, 'bare').locator('.ask-card').getByRole('button', { name: 'Ask for context' })).toBeVisible();
    await row(page, 'top').locator('.ask-row').click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    expect((await axe(page)).violations).toEqual([]);
    for (const scheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme: scheme });
      await page.screenshot({ path: `e2e/screenshots/notifications-rows-${scheme}-${info.project.name}.png`, fullPage: true });
    }
  });

  test('the row menu holds the actions for its state; Approve answers from the row', async ({ page }) => {
    const m = await setup(page, rich());
    await page.goto('/#/notifications');
    await page.getByRole('button', { name: /Show 1 more/ }).click();
    const names = async (key: string) => { await row(page, key).getByRole('button', { name: /^Actions for/ }).click(); const t = await page.getByRole('menuitem').allTextContents(); await page.keyboard.press('Escape'); return t; };
    expect(await names('pr')).toEqual(['Approve', 'Reject', 'Open', 'Reply', 'Defer']);
    expect(await names('mail')).toEqual(['Looks good', 'Needs changes', 'Open', 'Reply', 'Defer']);
    expect(await names('bare')).toEqual(['Done', 'Reply', 'Defer', 'Ask for context']);
    await row(page, 'pr').getByRole('button', { name: 'Actions for Approve merging PR 158 into main' }).click();
    await expect(page.getByRole('menuitem', { name: 'Open' })).toHaveAttribute('href', 'https://github.com/Xerilium/stack/pull/158');
    await page.evaluate(() => window.scrollTo(0, 120));
    const y = await page.evaluate(() => window.scrollY);
    await page.getByRole('menuitem', { name: 'Approve' }).click();
    await expect.poll(() => m.calls.find((c) => c.path === '/asks/pr/answer')?.body).toEqual({ answer: 'go' });
    await expect(row(page, 'pr')).toHaveCount(0);
    // an answer from the row keeps the open notification, its focus, and the scroll position
    await expect(row(page, 'top').locator('.ask-card')).toBeFocused();
    expect(await page.evaluate(() => window.scrollY)).toBe(y);
    await row(page, 'bare').getByRole('button', { name: /^Actions for/ }).click();
    await page.getByRole('menuitem', { name: 'Defer' }).click();
    await expect(row(page, 'bare').locator('.ask-card')).toBeFocused();
    await expect(row(page, 'bare').getByRole('group', { name: 'Defer until' })).toBeVisible();
  });

  test('on a phone, who and the source link share a line; the why sits under them', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'phone layout');
    await setup(page, rich());
    await page.goto('/#/notifications');
    const pr = row(page, 'pr');
    const who = (await pr.locator('.ask-who').boundingBox())!;
    const link = (await pr.getByRole('link', { name: /PR stack#158/ }).boundingBox())!;
    const why = (await pr.locator('.ask-ctx-why').boundingBox())!;
    expect(Math.abs((who.y + who.height / 2) - (link.y + link.height / 2))).toBeLessThan(2); // one line
    expect(link.x).toBeGreaterThan(who.x + who.width);
    expect(why.y).toBeGreaterThanOrEqual(link.y + link.height - 1); // the why is under them
    expect(link.height).toBeGreaterThanOrEqual(44);
    const ctx = (await pr.locator('.ask-ctx').boundingBox())!;
    expect(ctx.height).toBeLessThanOrEqual(44 + 2 * 18 + 6); // one tap line, at most two why lines, the padding
  });

  test('Reply from the row opens that notification with the reply box; Ask for context fills the box and sends only on Send', async ({ page }) => {
    const m = await setup(page, rich());
    await page.goto('/#/notifications');
    await page.getByRole('button', { name: /Show 1 more/ }).click();
    await row(page, 'mail').getByRole('button', { name: /^Actions for/ }).click();
    await page.getByRole('menuitem', { name: 'Reply' }).click();
    await expect(row(page, 'mail').locator('.ask-card')).toBeVisible();
    await expect(row(page, 'mail').getByRole('textbox', { name: 'Reply to email-triage' })).toBeFocused();
    await page.keyboard.press('Escape');
    await row(page, 'bare').getByRole('button', { name: /^Actions for/ }).click();
    await page.getByRole('menuitem', { name: 'Ask for context' }).click();
    // Ready text goes into the reply box of that notification and waits. @req FR:notifications/list.rowactions.context @req FR:ui-kit/send.box.fill
    const box = row(page, 'bare').getByRole('textbox', { name: /^Reply to/ });
    await expect(box).toHaveValue(/What is the context/);
    expect(m.calls.filter((c) => c.path === '/asks/bare/answer')).toEqual([]);
    await box.fill('What is the context? Where is the source?');
    await row(page, 'bare').getByRole('button', { name: /^Send/ }).click();
    await expect.poll(() => m.calls.find((c) => c.path === '/asks/bare/answer')?.body).toMatchObject({ answer: 'ask', text: 'What is the context? Where is the source?' });
  });
});

test.describe('Priorities and Sessions', () => {
  // @req FR:notifications/pris.route @req FR:settings/priorities.place
  test('Priorities is a Settings section: the old address and the palette open it', async ({ page }) => {
    await setup(page);
    await page.goto('/#/priorities');
    await expect(page).toHaveURL(/#\/settings\/priorities$/);
    await expect(page.getByRole('heading', { name: 'Settings', level: 1 })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Priorities', level: 2 })).toBeVisible();
    await page.goto('/#/now');
    await page.keyboard.press('Control+k');
    await page.getByRole('option', { name: /Go to Priorities/ }).click();
    await expect(page).toHaveURL(/#\/settings\/priorities$/);
    await expect(page.getByRole('heading', { name: 'Priorities', level: 2 })).toBeVisible();
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

  // @req FR:notifications/pris.states
  test('a failed read says so on the page', async ({ page }) => {
    await setup(page);
    await page.route('**/api/session-inventory', (r) => r.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'boom' } }) }));
    await page.goto('/#/inventory');
    await expect(page.getByTestId('page-note')).toHaveText('Cannot load sessions. It tries again by itself.');
  });

  test('rail order on desktop; tab bar on phone', async ({ page }, info) => {
    await setup(page);
    await page.goto('/#/now');
    if (info.project.name === 'mobile') {
      await expect(page.locator('.tabbar .tab')).toHaveText([/Now/, /My day/, '', /Notifications/, /More/]);
      return;
    }
    await expect(page.locator('.rail .tab-label')).toContainText(['Now', 'My day', /Notifications/]);
    await expect(page.locator('.rail').getByRole('button', { name: /^Priorities/ })).toHaveCount(0);
    await expect(page.locator('.rail').getByRole('button', { name: /^Sessions/ })).toHaveCount(0);
  });

  test('a permission ask names its session and links to it', async ({ page }) => {
    const perm: MockAsk = { ...ask('perm-s1abcdef-r1', 'Allow Bash: ls', 40), kind: 'decide', from: 'session:🧰 CoS', why: '{"command":"ls"}', options: ['Allow once', 'Deny'], recommend: 'Allow once' };
    const m = await setup(page, [ask('k1', 'Register the npm trusted publisher', 60), perm]);
    m.sessions = [{ id: 's1abcdef-0000-4000-8000-000000000001', title: '🧰 CoS', project: 'stack', cwd: '/x', lastActive: iso(5), state: 'needs-you', cost: { usd: 0, tokens: 0 }, prs: [] }];
    await page.goto('/#/notifications');
    const row = page.locator('.ask-li-row[data-key="perm-s1abcdef-r1"]');
    await expect(row.locator('.ask-who')).toHaveText('🧰 CoS');
    const link = row.getByRole('button', { name: 'Session', exact: true });
    await expect(link).toBeVisible();
    const box = (await link.boundingBox())!;
    if (test.info().project.name === 'mobile') expect(box.height).toBeGreaterThanOrEqual(44);
    expect((await axe(page)).violations).toEqual([]);
    await link.click();
    // The link opens the session, and does not select the row.
    await expect(page.getByRole('dialog').getByRole('heading', { level: 2 })).toHaveText('🧰 CoS');
    await expect(page.locator('.ask-card')).toContainText('Register the npm trusted publisher');
    // An ask that is not from a session has no session link.
    await expect(page.locator('.ask-li').getByRole('button', { name: 'Session', exact: true })).toHaveCount(1);
  });
});
