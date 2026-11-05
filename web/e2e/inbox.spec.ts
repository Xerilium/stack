/** @req FR:inbox-page/web.view @req FR:inbox-page/web.draft @req FR:inbox-page/web.phone @req FR:inbox-page/action.request */
import { expect, test, type Page } from '@playwright/test';
import { mockApi, type Mock } from './mock';

const at = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const seed = () => [
  { id: 'mail-aaaaaaaaaaaa', source: 'email', account: 'me@example.test', from: 'Alex Rivera', subject: 'Quarterly plan', receivedAt: at(1), unread: true, urgency: 2, summary: 'Alex wants your review of the plan by Friday and asks if the budget line is final.', suggested: 'reply-draft', actions: ['reply-draft', 'mark-done', 'snooze', 'create-task', 'archive', 'unsubscribe', 'delegate', 'schedule', 'forward-draft'], link: 'https://outlook.example.test/m/1', kind: 'needs_reply' },
  { id: 'mail-bbbbbbbbbbbb', source: 'email', account: 'me@personal.test', from: 'Weekly Digest', subject: 'Ten things to read this week', receivedAt: at(9), unread: true, urgency: 0, summary: 'Newsletter. You read 1 of the last 8 issues.', suggested: 'unsubscribe', actions: ['unsubscribe', 'reply-draft', 'mark-done', 'snooze', 'create-task', 'archive', 'delegate', 'schedule', 'forward-draft'], kind: 'newsletter' },
  { id: 'chat-cccccccccccc', source: 'teams', account: 'work', from: 'Sam Lee', subject: 'Build team', receivedAt: at(2), unread: true, urgency: 1, summary: 'Sam asks whether the release build is green and who owns the retry.', suggested: 'ask-me-later', actions: ['ask-me-later', 'mark-done', 'snooze', 'create-task', 'delegate'], kind: 'group' },
  { id: 'chat-dddddddddddd', source: 'slack', account: 'xerilium', from: 'U02ABCDE', subject: 'eng-general', receivedAt: at(30), unread: false, urgency: 0, summary: 'Thread about lunch plans for the offsite. No action for you.', suggested: 'mark-done', actions: ['mark-done', 'ask-me-later', 'snooze', 'create-task', 'delegate'], kind: 'channel' },
];
async function open(page: Page): Promise<Mock> {
  const m = await mockApi(page);
  m.inboxItems = seed();
  await page.goto('/#/inbox');
  await expect(page.locator('.in-row').first()).toBeVisible();
  return m;
}

test('lists email, Teams and Slack with summary and one suggested action', async ({ page }) => {
  await open(page);
  await expect(page.locator('.in-row')).toHaveCount(4);
  const first = page.locator('.in-row').first();
  await expect(first).toContainText('Alex Rivera');
  await expect(first).toContainText('Alex wants your review');
  await expect(first.getByRole('button', { name: 'Draft reply' })).toBeVisible();
  await expect(page.locator('.in-src.teams')).toHaveCount(1);
  await expect(page.locator('.in-src.slack')).toHaveCount(1);
});

test('draft reply: edit, create draft, no send control anywhere', async ({ page }) => {
  const m = await open(page);
  const row = page.locator('.in-row').first();
  await row.getByRole('button', { name: 'Draft reply' }).click();
  const box = row.getByRole('textbox', { name: 'Draft reply' });
  await box.fill('Looks good. Budget is final.');
  await row.getByRole('button', { name: 'Create draft' }).click();
  await expect(row.getByRole('link', { name: 'Open draft in Outlook' })).toBeVisible();
  expect(m.calls.find((c) => c.path.endsWith('/action'))?.body).toEqual({ action: 'reply-draft', text: 'Looks good. Budget is final.' });
  await expect(page.getByRole('button', { name: /^send/i })).toHaveCount(0);
});

test('a missing action offers Request this action and files it', async ({ page }) => {
  const m = await open(page);
  const row = page.locator('.in-row').nth(1);
  await row.getByRole('button', { name: 'Request: Unsubscribe' }).click();
  await expect(page.getByText('Requested: issue filed')).toBeVisible();
  expect(m.calls.at(-1)?.body).toEqual({ action: 'unsubscribe', request: true });
});

test('mark done removes the row', async ({ page }) => {
  await open(page);
  await page.locator('.in-row').nth(3).getByRole('button', { name: 'Mark done' }).click();
  await expect(page.locator('.in-row')).toHaveCount(3);
});

test('no sideways scroll; screenshot', async ({ page }, info) => {
  await open(page);
  await page.locator('.in-row').first().getByRole('button', { name: 'More' }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `e2e/screenshots/inbox-${info.project.name}.png` });
});
