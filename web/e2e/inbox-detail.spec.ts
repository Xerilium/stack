/** @req FR:inbox-page/detail.web @req FR:inbox-page/detail.split @req FR:inbox-page/detail.split.phone @req FR:inbox-page/detail.head @req FR:inbox-page/detail.body @req FR:inbox-page/detail.thread @req FR:inbox-page/detail.thread.fold @req FR:inbox-page/detail.offline @req FR:inbox-page/detail.safe */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mockApi, type Mock } from './mock';

const at = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const ACTIONS = ['reply-draft', 'mark-done', 'snooze', 'create-task'];
const seed = () => [
  { id: 'mail-aaaaaaaaaaaa', source: 'email', account: 'me@example.test', from: 'Alex Rivera', subject: 'Quarterly plan', receivedAt: at(1), unread: true, urgency: 2, summary: 'Alex wants your review of the plan by Friday.', suggested: 'reply-draft', actions: ACTIONS, link: 'https://outlook.example.test/m/1', kind: 'needs_reply' },
  { id: 'mail-bbbbbbbbbbbb', source: 'email', account: 'me@personal.test', from: 'Sam Lee', subject: 'Lunch on Friday', receivedAt: at(5), unread: false, urgency: 0, summary: 'Sam asks if Friday works for lunch.', suggested: 'reply-draft', actions: ACTIONS, link: 'https://outlook.example.test/m/2', kind: 'needs_reply' },
];
const DETAIL = {
  live: true,
  message: { id: 'AAMk1', from: { name: 'Alex Rivera', address: 'alex@example.test' }, to: [{ name: 'Me', address: 'me@example.test' }], subject: 'Quarterly plan', receivedAt: at(1), body: 'Hi Michael,\n\nCan you review the plan by Friday?\nIs the budget line final?\n\n<img src=x onerror=alert(1)>\n\nThanks,\nAlex', mine: false },
  thread: [
    { id: 'AAMk0', from: { name: 'Me', address: 'me@example.test' }, to: [{ address: 'alex@example.test' }], subject: 'Re: Quarterly plan', receivedAt: at(20), body: 'Send me the draft when it is ready.', mine: true },
    { id: 'AAMj9', from: { name: 'Alex Rivera', address: 'alex@example.test' }, to: [{ address: 'me@example.test' }], subject: 'Quarterly plan', receivedAt: at(30), body: 'I started the plan for next quarter.', mine: false },
  ],
};
async function open(page: Page): Promise<Mock> {
  const m = await mockApi(page);
  m.inboxItems = seed();
  m.inboxDetail = { 'mail-aaaaaaaaaaaa': DETAIL };
  await page.goto('/#/inbox');
  await expect(page.locator('.in-row').first()).toBeVisible();
  return m;
}
const pane = (page: Page) => page.getByTestId('split-detail');

test('a row opens the full message with sender, account and thread', async ({ page }, info) => {
  await open(page);
  await page.getByRole('button', { name: 'Quarterly plan' }).click();
  const d = pane(page);
  await expect(d.getByRole('heading', { name: 'Quarterly plan' })).toBeVisible();
  await expect(d).toContainText('Alex Rivera <alex@example.test>');
  await expect(d).toContainText('me@example.test');
  await expect(d.locator('.ui-tmsg-body').first()).toContainText('Is the budget line final?');
  // Mail text is data: markup shows as text and never becomes an element.
  await expect(d.locator('.ui-tmsg-body').first()).toContainText('<img src=x onerror=alert(1)>');
  await expect(d.locator('img')).toHaveCount(0);
  await expect(d.getByRole('heading', { name: 'Other messages in this thread (2)' })).toBeVisible();
  const earlier = d.locator('details.ui-tmsg');
  await expect(earlier).toHaveCount(2);
  await expect(earlier.first().locator('summary')).toContainText('You');
  await expect(earlier.first().locator('.ui-tmsg-body')).toBeHidden();
  await earlier.first().locator('summary').click();
  await expect(earlier.first().locator('.ui-tmsg-body')).toHaveText('Send me the draft when it is ready.');
  await expect(d.getByRole('link', { name: 'Open in Outlook' })).toHaveAttribute('href', 'https://outlook.example.test/m/1');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  const axe = await new AxeBuilder({ page }).include('.inbox-view').analyze();
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
  await page.screenshot({ path: `e2e/screenshots/inbox-detail-${info.project.name}.png` });
});

test('wide: list and detail side by side; narrow: the detail replaces the list, with Back', async ({ page }, info) => {
  await open(page);
  await expect(page.locator('.in-row').first()).toBeVisible();
  if (info.project.name === 'desktop') {
    await expect(pane(page)).toContainText('Select a message to read it.');
    await page.getByRole('button', { name: 'Quarterly plan' }).click();
    await expect(page.locator('.in-row').first()).toBeVisible();
    await expect(page.locator('.in-row').first()).toHaveAttribute('data-selected', 'true');
  } else {
    await expect(pane(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Quarterly plan' }).click();
    await expect(page.locator('.in-row').first()).toBeHidden();
    await page.getByRole('button', { name: '‹ Back' }).click();
    await expect(page.locator('.in-row')).toHaveCount(2);
    await expect(pane(page)).toHaveCount(0);
  }
});

test('a mailbox this host cannot read shows the summary and the Outlook link', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Lunch on Friday' }).click();
  const d = pane(page);
  await expect(d.getByRole('heading', { name: 'Lunch on Friday' })).toBeVisible();
  await expect(d).toContainText('Sam asks if Friday works for lunch.');
  await expect(d).toContainText('Stack cannot read this message here.');
  await expect(d.getByRole('link', { name: 'Open in Outlook' })).toBeVisible();
  await expect(d.locator('.ui-tmsg')).toHaveCount(0);
});
