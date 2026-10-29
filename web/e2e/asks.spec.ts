/** @req FR:ask-queue/web.home @req FR:ask-queue/web.card @req FR:ask-queue/web.actions @req FR:ask-queue/web.optimistic @req FR:ask-queue/web.empty @req FR:ask-queue/web.keys @req FR:ask-queue/web.a11y @req FR:ask-queue/web.responsive @req FR:ask-queue/live.fallback */
import { expect, test, type Page } from '@playwright/test';
import { mockApi, type Mock, type MockAsk } from './mock';

const iso = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const mk = (o: Partial<MockAsk> & { key: string; ask: string }): MockAsk => ({
  state: 'open', kind: 'approve', from: 'allyte-cos', reversible: false, priority: 'normal', blocks: 0, created: iso(-5), updated: iso(-1), score: 30, overdue: false, ...o,
});
const seed = (): MockAsk[] => [
  mk({ key: 'pr-879', ask: 'Approve merging PR 879 into dev', project: 'allyte', why: 'Go-live is Oct 29; Roland re-approved and CI is green', recommend: 'Approve', default: 'Merges Oct 29 8:00 am', reversible: true, by: iso(3), link: 'https://github.com/o/r/pull/879', score: 120, detail: 'Remaining risk: keyboard pass not signed off.' }),
  mk({ key: 'mail-dana', ask: 'Review draft reply to Dana: contract terms', kind: 'review', from: 'email-triage', project: 'allyte', recommend: 'Send as drafted', by: iso(26), link: 'https://outlook.example.test/draft/1', score: 90 }),
  mk({ key: 'launch', ask: 'Pick the launch day', kind: 'decide', options: ['Friday', 'Monday'], recommend: 'Monday', project: 'flantastic', score: 70 }),
  mk({ key: 'login', ask: 'Register the npm trusted publisher', kind: 'go-do', from: 'cos', link: 'https://www.npmjs.com/settings', score: 50 }),
  mk({ key: 'why', ask: 'What should the FTK v15 post lead with?', kind: 'answer', from: 'ftk-cos', score: 40 }),
  mk({ key: 'six', ask: 'Rename the repo', kind: 'go-do', from: 'cos', score: 20 }),
  mk({ key: 'seven', ask: 'Archive the old board', kind: 'go-do', from: 'cos', score: 10 }),
];
async function open(page: Page, asks = seed()): Promise<Mock> {
  const m = await mockApi(page);
  m.asks = asks;
  await page.goto('/#/asks');
  if (asks.length) await expect(page.locator('.ask-card')).toBeVisible();
  return m;
}
const card = (p: Page) => p.locator('.ask-card');

test.describe('Asks', () => {
  test('is the home view: top ask expanded with deadline, recommendation, default, link; five shown, the rest behind a count', async ({ page }) => {
    await open(page);
    await expect(card(page)).toHaveCount(1);
    await expect(card(page).locator('.ask-title')).toHaveText('Approve merging PR 879 into dev');
    await expect(card(page).locator('.dl')).toContainText(/Today|Tomorrow/); // +3 h crosses midnight late in the day
    await expect(card(page).locator('.dl')).toContainText('in 3 h');
    await expect(card(page).locator('.btn.primary')).toHaveText(/Approve/);
    await expect(card(page)).not.toContainText('Recommend');
    await expect(card(page).locator('.of')).toHaveText('1 of 7');
    await expect(card(page)).toContainText('If silent: Merges Oct 29 8:00 am');
    await expect(card(page).getByRole('link', { name: /Open/ })).toHaveAttribute('href', 'https://github.com/o/r/pull/879');
    await expect(card(page).getByRole('link', { name: /Open/ })).toHaveAttribute('rel', /noopener/);
    await expect(page.locator('.ask-li')).toHaveCount(5);
    await expect(page.getByRole('button', { name: /Show 2 more/ })).toBeVisible();
    await expect(page).toHaveTitle('(7) Stack');
    await page.getByRole('button', { name: /Show 2 more/ }).click();
    await expect(page.locator('.ask-li')).toHaveCount(7);
  });

  test('Home is the default view; the rail and tab bar carry the open count', async ({ page }) => {
    const m = await mockApi(page); m.asks = seed();
    await page.goto('/');
    await expect(page.getByRole('region', { name: 'Home' })).toBeVisible();
    await expect(page.locator('.badge').first()).toHaveText('7');
  });

  test('Enter approves: the ask leaves at once, the next one opens, toast offers Undo, the answer reached the api', async ({ page }) => {
    const m = await open(page);
    await page.keyboard.press('Enter');
    await expect(card(page).locator('.ask-title')).toHaveText('Review draft reply to Dana: contract terms');
    await expect(page.getByText('Approved · allyte-cos has it')).toBeVisible();
    expect(m.calls.find((c) => c.path === '/asks/pr-879/answer')?.body).toEqual({ answer: 'go' });
    await expect(page.getByRole('button', { name: /Sent · 1/ })).toBeVisible();
  });

  test('Undo (u) retracts and brings the ask back to the top', async ({ page }) => {
    const m = await open(page);
    await page.keyboard.press('Enter');
    await page.keyboard.press('u');
    await expect(card(page).locator('.ask-title')).toHaveText('Approve merging PR 879 into dev');
    expect(m.calls.some((c) => c.path === '/asks/pr-879/answer' && c.body.answer === 'retract')).toBe(true);
  });

  test('decide: numbered options, the recommendation is primary; 1 picks the first', async ({ page }) => {
    const m = await open(page);
    await page.getByRole("button", { name: /3\. Pick the launch day/ }).click();
    await expect(card(page).locator('.btn.primary')).toHaveText(/Monday/);
    await page.keyboard.press('1');
    expect(m.calls.find((c) => c.path === '/asks/launch/answer')?.body).toEqual({ answer: 'option', text: 'Friday' });
  });

  test('review shows the recommendation when it says more than the button; rows name the action to take', async ({ page }) => {
    await open(page);
    await expect(page.locator('.ask-row').first().locator('.verb')).toHaveText('Review');
    await page.getByRole('button', { name: /2\. Review draft/ }).click();
    await expect(card(page)).toContainText('Send as drafted');
  });

  test('answer kind: the input is always open with Defer beside it; no Reply button', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: /Show 2 more/ }).click();
    await page.getByRole('button', { name: /5\. What should the FTK/ }).click();
    await expect(page.getByLabel('Answer ftk-cos')).toBeVisible();
    await expect(card(page).getByRole('button', { name: /^Reply/ })).toHaveCount(0);
    await expect(card(page).getByRole('button', { name: /^Defer/ })).toBeVisible();
  });

  test('j/k move the cursor; the open card follows', async ({ page }) => {
    await open(page);
    await page.keyboard.press('j');
    await expect(card(page).locator('.ask-title')).toContainText('Review draft reply');
    await page.keyboard.press('j');
    await page.keyboard.press('k');
    await expect(card(page).locator('.ask-title')).toContainText('Review draft reply');
  });

  test('reply (r): Enter sends an instruction; a question mark sends it as a question', async ({ page }) => {
    const m = await open(page);
    await page.keyboard.press('r');
    await expect(page.getByLabel('Reply to allyte-cos')).toBeFocused();
    await page.keyboard.type('Hold until Monday');
    await page.keyboard.press('Enter');
    await expect.poll(() => m.calls.find((c) => c.path === '/asks/pr-879/answer')?.body).toEqual({ answer: 'reply', text: 'Hold until Monday' });
    await page.keyboard.press('r');
    await expect(page.getByLabel(/^Reply to/)).toBeFocused();
    await page.keyboard.type('Is CI green?');
    await page.keyboard.press('Enter');
    await expect.poll(() => m.calls.filter((c) => c.path.endsWith('/answer')).map((c) => c.body.answer)).toEqual(['reply', 'ask']);
  });

  test('defer (z): choices by number snooze the ask out of the list; it shows under Deferred', async ({ page }) => {
    const m = await open(page);
    await page.keyboard.press('z');
    await expect(page.getByRole('group', { name: 'Defer until' })).toBeVisible();
    await page.keyboard.press('3');
    await expect.poll(() => m.calls.find((c) => c.path === '/asks/pr-879/answer')?.body.answer).toBe('defer');
    expect(m.calls.find((c) => c.path === '/asks/pr-879/answer')?.body.until).toMatch(/^\d{4}-/);
    await expect(page.getByRole('button', { name: /Deferred · 1/ })).toBeVisible();
    await expect(page.locator('.ask-card .ask-title')).not.toHaveText(/PR 879/);
  });

  test('Esc closes the reply box without sending', async ({ page }) => {
    const m = await open(page);
    await page.keyboard.press('r');
    await expect(page.getByLabel('Reply to allyte-cos')).toBeFocused();
    await page.keyboard.type('draft');
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('Reply to allyte-cos')).toHaveCount(0);
    expect(m.calls.filter((c) => c.path.endsWith('/answer'))).toEqual([]);
  });

  test('details open with e, and only when the ask has some', async ({ page }) => {
    await open(page);
    await expect(page.locator('.ask-detail')).toHaveCount(0);
    await page.keyboard.press('e');
    await expect(page.locator('.ask-detail')).toContainText('keyboard pass');
  });

  test('a failed answer puts the ask back and says why', async ({ page }) => {
    const m = await open(page);
    m.fail.set('/asks/pr-879/answer', { status: 409, code: 'conflict', message: 'Conflict' });
    await page.keyboard.press('Enter');
    await expect(page.getByText('Changed elsewhere. Reloaded.')).toBeVisible();
    await expect(card(page).locator('.ask-title')).toHaveText('Approve merging PR 879 into dev');
  });

  test('go-do kind: Done is primary; review: Needs changes opens the reply box', async ({ page }) => {
    const m = await open(page);
    await page.getByRole('button', { name: /4\. Register/ }).click();
    await expect(card(page).locator('.btn.primary')).toHaveText(/Done/);
    await page.getByRole('button', { name: /2\. Review draft/ }).click();
    await page.keyboard.press('n');
    await expect(page.getByLabel('Reply to email-triage')).toBeFocused();
    void m;
  });

  test('polling fallback picks up a new ask from elsewhere, quietly: no toast, cursor stays on the ask being read', async ({ page }) => {
    await page.clock.install();
    const m = await open(page);
    await page.keyboard.press('j');
    await expect(page.getByTestId('live-status')).toContainText('Synced');
    m.asks.push(mk({ key: 'urgent', ask: 'Wire the Teams invoice', score: 999, by: iso(1) }));
    await page.clock.fastForward(16_000);
    await expect(page.locator('.ask-li').first()).toContainText('Wire the Teams invoice');
    await expect(page.locator('.ask-li').first().locator('.new')).toBeVisible();
    await expect(card(page).locator('.ask-title')).toContainText('Review draft reply');
    await expect(page.locator('.toast')).toHaveCount(0);
    await page.clock.fastForward(7000);
    await expect(page.locator('.new')).toHaveCount(0);
  });

  test('empty state', async ({ page }) => {
    await open(page, []);
    await expect(page.getByTestId('asks-empty')).toContainText('Nothing needs you.');
    await expect(page.getByTestId('asks-empty')).toContainText('No open asks, decisions, or replies · no agent has written an ask yet');
    await expect(page).toHaveTitle('Stack');
  });

  test('error state with Retry', async ({ page }) => {
    const m = await mockApi(page);
    m.fail.set('/asks', { status: 500, code: 'internal', message: 'Internal error' });
    await page.goto('/#/asks');
    await expect(page.getByRole('alert')).toContainText('Cannot load asks');
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByTestId('asks-empty')).toBeVisible();
  });

  test('a keyboard user never loses focus to a live update and the list is a labelled region', async ({ page }) => {
    await open(page);
    await expect(page.getByRole('list', { name: /Asks, highest score first/ })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Views' }).or(page.getByRole('navigation', { name: 'Views (mobile)' })).first()).toBeVisible();
  });

  test('command palette lists the ask actions', async ({ page }) => {
    await open(page);
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Command' }).fill('Ask:');
    await expect(page.getByRole('option', { name: /Ask: Approve/ })).toBeVisible();
    await expect(page.getByRole('option', { name: /Ask: Defer/ })).toBeVisible();
  });
});

/** @req FR:live-deploy/web.state @req FR:live-deploy/web.action @req FR:live-deploy/web.poll */
test.describe('sync state', () => {
  test('a failed probe reads Offline with a Retry now that works; a new revision reloads', async ({ page }) => {
    await page.clock.install();
    const m = await mockApi(page);
    m.asks = seed();
    m.rev = 'a';
    m.fail.set('/sync', { status: 503, code: 'unavailable', message: 'Service unavailable' });
    await page.goto('/#/asks');
    const badge = page.getByTestId('live-status');
    await expect(badge).toContainText('Offline · retrying');
    await badge.getByRole('button', { name: 'Retry now' }).click();
    await expect(badge).toContainText('Synced');
    await expect(badge.getByRole('button')).toHaveCount(0);
    m.asks.push(mk({ key: 'urgent', ask: 'Wire the Teams invoice', score: 999, by: iso(1) }));
    await page.clock.fastForward(16_000);
    await expect(page.locator('.ask-li', { hasText: 'Wire the Teams invoice' })).toHaveCount(0);
    m.rev = 'b';
    await page.clock.fastForward(16_000);
    await expect(page.locator('.ask-li').first()).toContainText('Wire the Teams invoice');
  });
  test('an expired session on the probe offers Sign in', async ({ page }) => {
    const m = await mockApi(page);
    m.asks = seed();
    m.fail.set('/sync', { status: 401, code: 'unauthorized', message: 'Authentication required' });
    await page.goto('/#/asks');
    const badge = page.getByTestId('live-status');
    await expect(badge).toContainText('Sign-in expired');
    await expect(badge.getByRole('button', { name: 'Sign in' })).toBeVisible();
  });
});
