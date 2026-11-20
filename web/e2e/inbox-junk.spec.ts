/** @req FR:inbox-page/junk.web @req FR:inbox-page/junk.group @req FR:inbox-page/junk.group.fold @req FR:inbox-page/junk.group.count @req FR:inbox-page/junk.group.reason @req FR:inbox-page/junk.restore.web @req FR:inbox-page/junk.archive @req FR:inbox-page/junk.unsubscribe @req FR:inbox-page/junk.never */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mockApi, type Mock } from './mock';

const at = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const base = { source: 'email', account: 'me@example.test', unread: true, urgency: 0 };
const seed = () => [
  { ...base, id: 'mail-aaaaaaaaaaaa', from: 'Alex Rivera', subject: 'Quarterly plan', receivedAt: at(1), urgency: 2, summary: 'Alex wants your review of the plan by Friday.', suggested: 'reply-draft', actions: ['reply-draft', 'mark-done', 'snooze'], kind: 'needs_reply' },
  { ...base, id: 'mail-bbbbbbbbbbbb', from: 'Weekly Digest', subject: 'Ten things to read this week', receivedAt: at(9), summary: 'Newsletter. Ten links on design.', suggested: 'unsubscribe', actions: ['unsubscribe', 'not-junk', 'mark-done', 'snooze'], kind: 'newsletter' },
  { ...base, id: 'mail-cccccccccccc', from: 'Jordan at GrowthPilot', subject: 'Quick question about your pipeline', receivedAt: at(12), summary: 'Cold sales outreach. Jordan asks for a 15 minute call.', suggested: 'mark-done', actions: ['mark-done', 'not-junk', 'snooze'], kind: 'spam' },
  { ...base, id: 'mail-dddddddddddd', account: 'readonly@example.test', from: 'Deals Daily', subject: 'Today only: 40% off', receivedAt: at(20), summary: 'Newsletter. A sale.', suggested: 'unsubscribe', actions: ['unsubscribe', 'not-junk', 'mark-done'], kind: 'newsletter' },
];
async function open(page: Page): Promise<Mock> {
  const m = await mockApi(page);
  m.inboxItems = seed();
  await page.goto('/#/inbox');
  await expect(page.locator('.in-row').first()).toBeVisible();
  return m;
}
const junkBtn = (page: Page) => page.getByRole('button', { name: /^›?\s*Junk/ });

test('junk sits in one closed section and is not counted as unread', async ({ page }, info) => {
  await open(page);
  await expect(page.locator('.in-row')).toHaveCount(1);
  await expect(page.locator('#inbox-h .count')).toHaveText('1');
  await expect(junkBtn(page)).toHaveAttribute('aria-expanded', 'false');
  await expect(junkBtn(page)).toContainText('3');
  await expect(page.getByRole('button', { name: 'Archive all', exact: true })).toHaveCount(0);
  await junkBtn(page).click();
  await expect(page.locator('#inbox-junk .in-row')).toHaveCount(3);
  await expect(page.locator('#inbox-junk .in-row').first()).toContainText('Newsletter');
  await expect(page.locator('#inbox-junk .in-row').nth(1)).toContainText('Spam or cold outreach');
  await expect(page.locator('#inbox-junk .in-row').first().getByRole('button', { name: 'Not junk' })).toBeVisible();
  // Never deletes: no delete control anywhere on the page.
  await expect(page.getByRole('button', { name: /delete/i })).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const min = info.project.name === 'mobile' ? 44 : 24;
  const small = await page.locator('.inbox-view button:visible').evaluateAll((els, mn) => els.map((e) => ({ h: Math.round(e.getBoundingClientRect().height), what: (e.textContent ?? '').trim().slice(0, 30) })).filter((x) => x.h > 0 && x.h < mn), min);
  expect(small, JSON.stringify(small)).toEqual([]);
  const axe = await new AxeBuilder({ page }).include('.inbox-view').analyze();
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
  await page.screenshot({ path: `e2e/screenshots/inbox-junk-${info.project.name}.png`, fullPage: true });
});

test('Not junk moves the row back to the list', async ({ page }) => {
  const m = await open(page);
  await junkBtn(page).click();
  await page.locator('#inbox-junk .in-row').nth(1).getByRole('button', { name: 'Not junk' }).click();
  await expect(page.getByText('Moved out of Junk')).toBeVisible();
  expect(m.calls.at(-1)).toEqual({ path: '/inbox-items/mail-cccccccccccc/action', body: { action: 'not-junk' } });
  await expect(page.locator('#inbox-junk .in-row')).toHaveCount(2);
  await expect(page.locator('.ui-split-list > .in-list > .in-row')).toHaveCount(2);
});

test('Archive all clears the junk in one click and says what stays', async ({ page }) => {
  const m = await open(page);
  await junkBtn(page).click();
  await page.getByRole('button', { name: 'Archive all', exact: true }).click();
  await expect(page.getByText('Archived 2. 1 stays: Stack cannot move that mail.')).toBeVisible();
  expect(m.calls.at(-1)).toEqual({ path: '/inbox-junk', body: { action: 'archive', ids: ['mail-bbbbbbbbbbbb', 'mail-cccccccccccc', 'mail-dddddddddddd'] } });
  await expect(page.locator('#inbox-junk .in-row')).toHaveCount(1);
  await expect(page.locator('.in-row').first()).toContainText('Quarterly plan');
});

test('Unsubscribe and archive all sends one request', async ({ page }) => {
  const m = await open(page);
  await junkBtn(page).click();
  await page.getByRole('button', { name: 'Unsubscribe and archive all' }).click();
  await expect(page.getByText('Unsubscribed from 1. Archived 2. 1 stays: Stack cannot move that mail.')).toBeVisible();
  expect(m.calls.at(-1)).toEqual({ path: '/inbox-junk', body: { action: 'unsubscribe-archive', ids: ['mail-bbbbbbbbbbbb', 'mail-cccccccccccc', 'mail-dddddddddddd'] } });
});
