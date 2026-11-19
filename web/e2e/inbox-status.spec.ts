/**
 * Inbox status: mail only, no setup UI, honest empty states, one quiet link to Settings > Accounts, and the nav dot.
 * Runs at 1280 (desktop) and 375 (mobile): axe clean, no sideways scroll, 44 px targets on a phone.
 * @req FR:inbox-page/web.empty @req FR:inbox-page/web.status @req FR:inbox-page/web.nocmd @req FR:inbox-page/web.dot @req FR:inbox-page/web.phone @req FR:inbox-page/web.view.unread @req FR:inbox-page/web.view.border @req FR:inbox-page/web.view.button @req FR:inbox-page/web.accounts @req FR:inbox-page/web.status.fix @req FR:inbox-page/web.empty.fix @req FR:inbox-page/web.status.setup
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mockApi, type Mock } from './mock';

const DOC = 'https://github.com/Xerilium/stack/blob/main/docs/inbox-sources.md';
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const SIGN_IN = 'Click Connect and sign in with Microsoft. Read-only by default. Stack never sends.';
/** The same patterns as `FR:product-reset/connect.rule.test`. */
const CMD = /\bstack (web|graph|asks|task|report|email|inbox)\b|\.ps1\b|\b(npm|pnpm|npx|az|gh) |\bSTACK_[A-Z_]+|GITHUB_TOKEN|docs\/|runbook|\bterminal\b/;
const planned = [
  { kind: 'teams', account: '', state: 'not-connected', planned: true, needs: 'The Teams connector is not wired yet.', doc: `${DOC}#teams` },
  { kind: 'slack', account: '', state: 'not-connected', planned: true, needs: 'The Slack connector is not wired yet.', doc: `${DOC}#slack` },
];
const nothing = () => ({
  sources: [
    { kind: 'email', account: '', state: 'not-connected', needs: SIGN_IN, connect: true, doc: `${DOC}#email` },
    { kind: 'github', account: '', state: 'not-connected', planned: true, needs: 'Sign in to the GitHub CLI, or set GITHUB_TOKEN.', command: 'gh auth login', doc: `${DOC}#github` },
    ...planned,
  ],
  summary: { connected: 0, total: 1, fresh: 0, attention: true, canClaimZero: false, headline: 'No inboxes connected' },
});
const broken = () => ({
  sources: [
    { kind: 'email', account: 'a@outlook.com', state: 'ok', mode: 'drafts', lastSyncAt: ago(4) },
    { kind: 'email', account: 'b@outlook.com', state: 'stale', mode: 'read-only', lastSyncAt: ago(180), needs: 'Sync is behind.', command: 'stack email run --all', doc: `${DOC}#email` },
    { kind: 'email', account: 'me@contoso.test', state: 'error', mode: 'drafts', lastSyncAt: ago(20), error: 'Email sign-in expired: me@contoso.test', needs: SIGN_IN, connect: true, doc: `${DOC}#email` },
    ...planned,
  ],
  summary: { connected: 2, total: 3, fresh: 1, attention: true, canClaimZero: false, headline: 'Email sign-in expired: me@contoso.test' },
});
const fresh = () => ({ sources: [{ kind: 'email', account: 'a@outlook.com', state: 'ok', mode: 'read-only', lastSyncAt: ago(1) }, ...planned], summary: { connected: 1, total: 1, fresh: 1, attention: false, canClaimZero: true, headline: null } });
const mail = { id: 'mail-bbbbbbbbbbbb', source: 'email', account: 'a@outlook.com', from: 'Alex', subject: 'Budget', receivedAt: ago(2), unread: true, urgency: 1, summary: 'Approve the budget.', suggested: 'mark-done', actions: ['mark-done'] };

async function open(page: Page, src: Mock['inboxSources'], items: Record<string, unknown>[] = []): Promise<Mock> {
  const m = await mockApi(page);
  m.inboxSources = src;
  m.inboxItems = items;
  await page.goto('/#/inbox');
  await expect(page.getByRole('heading', { level: 1, name: /Inbox/ })).toBeVisible();
  await expect(page.getByText('Loading')).toHaveCount(0);
  return m;
}
const main = (page: Page) => page.locator('.inbox-view');

test('nothing connected: no Inbox zero, no setup UI; one link to Settings > Accounts', async ({ page }) => {
  await open(page, nothing());
  await expect(page.getByText('Inbox zero')).toHaveCount(0);
  await expect(page.getByTestId('empty-state')).toContainText('No inboxes connected');
  await expect(page.getByTestId('inbox-sources')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Check connection|Connect|Fix/ })).toHaveCount(0);
  await expect(main(page).locator('code')).toHaveCount(0);
  const link = main(page).getByRole('link', { name: 'Fix in Settings' });
  await expect(link).toHaveCount(1);
  await expect(link).toHaveAttribute('href', '#/settings/accounts');
  await link.click();
  await expect(page).toHaveURL(/#\/settings\/accounts$/);
});

test('no command, env var or docs path on the page, whatever the sources say', async ({ page }) => {
  for (const [src, items] of [[nothing(), []], [broken(), [mail]]] as const) {
    await open(page, src, [...items]);
    expect(await main(page).innerText()).not.toMatch(CMD);
    expect(await main(page).locator('[aria-label],[title]').evaluateAll((els) => els.map((e) => `${e.getAttribute('aria-label') ?? ''} ${e.getAttribute('title') ?? ''}`).join('\n'))).not.toMatch(CMD);
  }
});

test('a broken mailbox: the empty state names it, never Inbox zero', async ({ page }) => {
  await open(page, broken());
  await expect(page.getByText('Inbox zero')).toHaveCount(0);
  await expect(page.getByTestId('empty-state')).toContainText('Email sign-in expired: me@contoso.test');
  await expect(main(page).getByRole('link', { name: 'Fix in Settings' })).toHaveCount(1);
});

test('items with a problem: one quiet line above the list, linked to Settings', async ({ page }) => {
  await open(page, broken(), [mail]);
  const line = page.getByTestId('inbox-status');
  await expect(line).toContainText('Email sign-in expired: me@contoso.test');
  await expect(line.getByRole('link', { name: 'Fix in Settings' })).toHaveAttribute('href', '#/settings/accounts');
  await expect(page.locator('.in-row')).toHaveCount(1);
});

test('all fresh: Inbox zero, no status line, no dot; accounts stay one quiet link away', async ({ page }) => {
  await open(page, fresh());
  await expect(page.getByTestId('empty-state')).toContainText('Inbox zero. Nothing needs you.');
  await expect(page.getByTestId('inbox-status')).toHaveCount(0);
  await expect(main(page).getByRole('link', { name: 'Fix in Settings' })).toHaveCount(0);
  // Add another account, drafts and disconnect stay reachable once mail works. @req FR:connect-accounts/web.where
  const manage = main(page).getByRole('link', { name: 'Manage accounts' });
  await expect(manage).toHaveAttribute('href', '#/settings/accounts');
  await manage.click();
  await expect(page).toHaveURL(/#\/settings\/accounts$/);
  await expect(page.getByTestId('inbox-dot')).toHaveCount(0);
});

test('all fresh with items: no status line', async ({ page }) => {
  await open(page, fresh(), [mail]);
  await expect(page.locator('.in-row')).toHaveCount(1);
  await expect(page.getByTestId('inbox-status')).toHaveCount(0);
});

// An open tab reads the status again, so Inbox zero ends when the window does. @req FR:inbox-page/web.empty.refresh @req FR:inbox-page/web.empty.headline
test('an open tab drops Inbox zero once the sync goes stale', async ({ page }) => {
  const m = await open(page, fresh());
  await expect(page.getByTestId('empty-state')).toContainText('Inbox zero. Nothing needs you.');
  m.inboxSources = { sources: [{ kind: 'email', account: 'a@outlook.com', state: 'stale', mode: 'read-only', lastSyncAt: ago(45) }, ...planned], summary: { connected: 1, total: 1, fresh: 0, attention: false, canClaimZero: false, headline: 'Last synced 45m ago' } };
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await expect(page.getByText('Inbox zero')).toHaveCount(0);
  await expect(page.getByTestId('empty-state')).toContainText('Last synced 45m ago');
  // A sync that is behind has nothing to fix in Settings: no Fix link.
  await expect(main(page).getByRole('link', { name: 'Fix in Settings' })).toHaveCount(0);
});

test('a failed read never claims Inbox zero', async ({ page }) => {
  const m = await mockApi(page);
  m.fail.set('/inbox-items', { status: 500, code: 'internal', message: 'boom' });
  await page.goto('/#/inbox');
  await expect(page.getByText('Could not load the inbox.')).toBeVisible();
  await expect(page.getByText('Inbox zero')).toHaveCount(0);
});

test('unread rows are calm: bold subject and a dot, no colored border, no accent button', async ({ page }) => {
  await open(page, fresh(), [mail, { ...mail, id: 'mail-dddddddddddd', unread: false, subject: 'Read one' }]);
  const row = page.locator('.in-row').first();
  await expect(row.locator('.in-dot')).toBeAttached();
  const s = await row.evaluate((el) => { const c = getComputedStyle(el); return { left: c.borderLeftWidth, top: c.borderTopWidth }; });
  expect(s.left).toBe(s.top);
  expect(await row.locator('.in-subject').evaluate((el) => Number(getComputedStyle(el).fontWeight))).toBeGreaterThanOrEqual(600);
  await expect(row.locator('.in-actions .btn.primary')).toHaveCount(0);
  const read = page.locator('.in-row').nth(1);
  await expect(read.locator('.in-dot')).toHaveCount(0);
  expect(await read.locator('.in-subject').evaluate((el) => Number(getComputedStyle(el).fontWeight))).toBeLessThan(600);
});

test('the dot shows on the Inbox rail item (desktop) or the More tab (phone) from any view', async ({ page }, info) => {
  const m = await mockApi(page);
  m.inboxSources = nothing();
  await page.goto('/#/today');
  if (info.project.name === 'mobile') await expect(page.getByRole('button', { name: /More: open command palette\. Inbox needs setup/ })).toBeVisible();
  else await expect(page.locator('.rail').getByRole('img', { name: 'Inbox needs setup' })).toBeVisible();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`status line with items (${scheme}): axe clean, no sideways scroll, touch targets; screenshot`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page, broken(), [mail, { ...mail, id: 'mail-cccccccccccc', unread: false, from: 'Sam', subject: 'Notes from Monday', summary: 'FYI. No action.' }]);
    const { violations } = await new AxeBuilder({ page }).analyze();
    const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').flatMap((v) => v.nodes.map((n) => `${v.id} ${n.target.join(' ')}`));
    expect(bad, bad.join('\n')).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    const min = info.project.name === 'mobile' ? 44 : 24;
    const small = await page.locator('.inbox-view button:visible, .inbox-view a:visible').evaluateAll((els, mn) => els.map((e) => { const r = e.getBoundingClientRect(); return { h: Math.round(r.height), what: `${e.className || e.tagName} "${(e.textContent ?? '').trim().slice(0, 30)}"` }; }).filter((x) => x.h > 0 && x.h < mn), min);
    expect(small, JSON.stringify(small, null, 1)).toEqual([]);
    await page.screenshot({ path: `e2e/screenshots/inbox-status-${scheme}-${info.project.name}.png`, fullPage: true });
  });
}
