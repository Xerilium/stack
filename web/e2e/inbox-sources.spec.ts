/**
 * Inbox source status: no false Inbox zero, the sources panel with exact steps, Check connection, and the nav dot.
 * Runs at 1280 (desktop) and 375 (mobile): axe clean, no sideways scroll, 44 px targets on a phone.
 * @req FR:inbox-page/web.empty @req FR:inbox-page/web.sources @req FR:inbox-page/web.check @req FR:inbox-page/web.dot @req FR:inbox-page/web.phone @req FR:inbox-page/src.multi
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mockApi, type Mock } from './mock';

const DOC = 'https://github.com/Xerilium/stack/blob/main/docs/inbox-sources.md';
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const login = (a: string, w = 'mail') => `stack graph login --client-id 11111111-2222-3333-4444-555555555555 --account ${a} --with ${w}`;
const SIGN_IN = 'Sign in from a terminal. Read-only by default: Stack reads mail. Use --with mail,drafts to let Stack write reply drafts. Stack never sends.';
const planned = [
  { kind: 'teams', account: '', state: 'not-connected', planned: true, needs: 'Needs a work or school account and delegated Chat.Read on the Stack app registration. The Teams connector is not wired yet. Read only.', doc: `${DOC}#teams` },
  { kind: 'slack', account: '', state: 'not-connected', planned: true, needs: 'Needs a Slack app with a user token (xoxp-) and read scopes. The Slack connector is not wired yet. Read only.', doc: `${DOC}#slack` },
];
const nothing = () => ({
  sources: [
    { kind: 'email', account: '', state: 'not-connected', needs: SIGN_IN, command: 'stack graph login --client-id <app id> --account <address> --with mail', doc: `${DOC}#email` },
    { kind: 'github', account: '', state: 'not-connected', planned: true, needs: 'Sign in to the GitHub CLI, or set GITHUB_TOKEN for the Stack host. Read only: Stack never posts.', command: 'gh auth login', doc: `${DOC}#github` },
    ...planned,
  ],
  summary: { connected: 0, total: 1, fresh: 0, attention: true, canClaimZero: false, headline: 'No inboxes connected' },
});
/** Two M365 and four Outlook.com mailboxes, each in its own state. */
const six = () => ({
  sources: [
    { kind: 'email', account: 'a@outlook.com', state: 'ok', mode: 'drafts', lastSyncAt: ago(4) },
    { kind: 'email', account: 'b@outlook.com', state: 'stale', mode: 'read-only', lastSyncAt: ago(180), needs: 'Sync is behind. Run every mailbox now and check the schedule (stack email schedule).', command: 'stack email run --all', doc: `${DOC}#email` },
    { kind: 'email', account: 'c@outlook.com', state: 'connecting', mode: 'read-only', needs: 'Signed in. Run the first sync, then schedule it with stack email schedule. Stack never sends.', command: 'stack email run --account c@outlook.com', doc: `${DOC}#email` },
    { kind: 'email', account: 'd@outlook.com', state: 'not-connected', needs: SIGN_IN, command: login('d@outlook.com'), doc: `${DOC}#email` },
    { kind: 'email', account: 'me@contoso.test', state: 'error', mode: 'drafts', lastSyncAt: ago(20), error: 'Email sign-in expired: me@contoso.test', needs: SIGN_IN, command: login('me@contoso.test', 'mail,drafts'), doc: `${DOC}#email` },
    { kind: 'email', account: 'ops@contoso.test', state: 'ok', mode: 'read-only', lastSyncAt: ago(2) },
    { kind: 'github', account: '', state: 'connecting', planned: true, needs: 'GitHub is signed in. The GitHub inbox sync is not scheduled yet, so GitHub items do not show here.', doc: `${DOC}#github` },
    ...planned,
  ],
  summary: { connected: 4, total: 6, fresh: 2, attention: true, canClaimZero: false, headline: 'Email sign-in expired: me@contoso.test' },
});

async function open(page: Page, src: Mock['inboxSources'], items: Record<string, unknown>[] = []): Promise<Mock> {
  const m = await mockApi(page);
  m.inboxSources = src;
  m.inboxItems = items;
  await page.goto('/#/inbox');
  await expect(page.getByTestId('inbox-sources')).toBeVisible();
  return m;
}

test('nothing connected: never says Inbox zero; says No inboxes connected and shows how to connect', async ({ page }) => {
  await open(page, nothing());
  await expect(page.getByText('Inbox zero')).toHaveCount(0);
  await expect(page.getByTestId('empty-state')).toContainText('No inboxes connected');
  await expect(page.getByTestId('src-progress')).toHaveText('0 of 1 sources connected');
  await expect(page.getByTestId('inbox-sources')).toContainText('Stack never sends.');
  await page.getByRole('button', { name: 'Connect: Email' }).click();
  const step = page.locator('.src-row[data-kind="email"] .src-step');
  await expect(step).toContainText('Read-only by default');
  await expect(step.locator('code')).toHaveText('stack graph login --client-id <app id> --account <address> --with mail');
  await expect(step.getByRole('link', { name: 'How to connect Email' })).toHaveAttribute('href', `${DOC}#email`);
  await page.getByRole('button', { name: 'Connect: GitHub' }).click();
  await expect(page.locator('.src-row[data-kind="github"] code')).toHaveText('gh auth login');
  await expect(page.locator('.src-row[data-kind="teams"]')).toContainText('Not available yet');
});

test('six mailboxes: each with its own state; an expired sign-in is the headline; a stale sync is named', async ({ page }) => {
  await open(page, six());
  await expect(page.locator('.src-row[data-kind="email"]')).toHaveCount(6);
  const state = (a: string) => page.locator(`.src-row[data-account="${a}"]`);
  await expect(state('a@outlook.com')).toHaveAttribute('data-state', 'ok');
  await expect(state('a@outlook.com')).toContainText('Synced 4m ago');
  await expect(state('a@outlook.com')).toContainText('writes reply drafts');
  await expect(state('b@outlook.com')).toContainText('Synced 3h ago');
  await expect(state('me@contoso.test')).toContainText('Email sign-in expired: me@contoso.test');
  await expect(page.getByTestId('src-progress')).toHaveText('4 of 6 sources connected');
  // One mailbox is broken, so Inbox zero would be untrue: the problem is the empty state.
  await expect(page.getByText('Inbox zero')).toHaveCount(0);
  await expect(page.getByTestId('empty-state')).toContainText('Email sign-in expired: me@contoso.test');
  await page.getByRole('button', { name: 'Fix: Email me@contoso.test' }).click();
  await expect(state('me@contoso.test').locator('code')).toHaveText(login('me@contoso.test', 'mail,drafts'));
});

test('stale only: says when it last synced, not Inbox zero', async ({ page }) => {
  await open(page, { sources: [{ kind: 'email', account: 'a@outlook.com', state: 'stale', mode: 'read-only', lastSyncAt: ago(180), needs: 'Sync is behind.', command: 'stack email run --all' }, { kind: 'github', account: '', state: 'connecting', planned: true, needs: 'GitHub is signed in.' }, ...planned], summary: { connected: 1, total: 1, fresh: 0, attention: false, canClaimZero: false, headline: 'Last synced 3h ago' } });
  await expect(page.getByTestId('empty-state')).toContainText('Last synced 3h ago');
  await expect(page.getByText('Inbox zero')).toHaveCount(0);
});

test('items with a problem: the headline shows above the list', async ({ page }) => {
  await open(page, six(), [{ id: 'mail-aaaaaaaaaaaa', source: 'email', account: 'a@outlook.com', from: 'Alex', subject: 'Plan', receivedAt: ago(30), unread: true, urgency: 1, summary: 'Review the plan.', suggested: 'mark-done', actions: ['mark-done'] }]);
  await expect(page.getByTestId('inbox-headline')).toHaveText('Email sign-in expired: me@contoso.test');
});

test('Check connection re-reads fresh status, redraws, and clears the dot', async ({ page }) => {
  const m = await open(page, nothing());
  await expect(page.getByTestId('inbox-dot').first()).toBeAttached();
  m.inboxSources = { sources: [{ kind: 'email', account: 'a@outlook.com', state: 'ok', mode: 'read-only', lastSyncAt: ago(1) }, { kind: 'github', account: '', state: 'ok', lastSyncAt: ago(1) }, ...planned], summary: { connected: 2, total: 2, fresh: 2, attention: false, canClaimZero: true, headline: null } };
  await page.getByRole('button', { name: 'Check connection' }).click();
  await expect(page.getByTestId('src-progress')).toHaveText('2 of 2 sources connected');
  expect(m.sourceQueries).toContain('?fresh=1');
  await expect(page.getByTestId('inbox-dot')).toHaveCount(0);
  await expect(page.getByTestId('empty-state')).toContainText('Inbox zero. Nothing needs you.');
});

test('all fresh: no dot; the panel folds to one line', async ({ page }) => {
  const m = await mockApi(page);
  await page.goto('/#/inbox');
  await expect(page.getByTestId('src-progress')).toHaveText('2 of 2 sources connected');
  await expect(page.getByRole('button', { name: 'Manage' })).toHaveAttribute('aria-expanded', 'false');
  await expect(page.getByTestId('inbox-dot')).toHaveCount(0);
  expect(m.inboxSources.summary.attention).toBe(false);
});

test('the dot shows on the Inbox rail item (desktop) or the More tab (phone) from any view', async ({ page }, info) => {
  const m = await mockApi(page);
  m.inboxSources = nothing();
  await page.goto('/#/today');
  if (info.project.name === 'mobile') await expect(page.getByRole('button', { name: /More: open command palette\. Inbox needs setup/ })).toBeVisible();
  else await expect(page.locator('.rail').getByRole('img', { name: 'Inbox needs setup' })).toBeVisible();
});

for (const scheme of ['light', 'dark'] as const) {
  test(`sources panel open (${scheme}): axe clean, no sideways scroll, touch targets; screenshot`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page, six());
    await page.getByRole('button', { name: 'Fix: Email me@contoso.test' }).click();
    await page.waitForTimeout(300);
    const { violations } = await new AxeBuilder({ page }).analyze();
    const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').flatMap((v) => v.nodes.map((n) => `${v.id} ${n.target.join(' ')}`));
    expect(bad, bad.join('\n')).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
    const min = info.project.name === 'mobile' ? 44 : 24;
    const small = await page.locator('main button:visible, main a:visible, .tabbar button:visible').evaluateAll((els, mn) => els.map((e) => { const r = e.getBoundingClientRect(); return { h: Math.round(r.height), what: `${e.className || e.tagName} "${(e.textContent ?? '').trim().slice(0, 30)}"` }; }).filter((x) => x.h > 0 && x.h < mn), min);
    expect(small, JSON.stringify(small, null, 1)).toEqual([]);
    await page.screenshot({ path: `e2e/screenshots/inbox-sources-${scheme}-${info.project.name}.png`, fullPage: true });
  });
}
