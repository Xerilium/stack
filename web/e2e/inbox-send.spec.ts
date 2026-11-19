/** @req FR:email-send/draft.web @req FR:email-send/draft.show @req FR:email-send/draft.edit @req FR:email-send/draft.outlook @req FR:email-send/send.web @req FR:email-send/send.click @req FR:connect-accounts/scope.send */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mockApi, type Mock } from './mock';

const at = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const ACTIONS = ['reply-draft', 'mark-done', 'snooze', 'create-task'];
const seed = () => [
  { id: 'mail-aaaaaaaaaaaa', source: 'email', account: 'me@example.test', from: 'Alex Rivera', subject: 'Quarterly plan', receivedAt: at(1), unread: true, urgency: 2, summary: 'Alex wants your review of the plan by Friday.', suggested: 'reply-draft', actions: ACTIONS, link: 'https://outlook.example.test/m/1', kind: 'needs_reply' },
  { id: 'mail-bbbbbbbbbbbb', source: 'email', account: 'me@personal.test', from: 'Sam Lee', subject: 'Lunch on Friday', receivedAt: at(5), unread: false, urgency: 0, summary: 'Sam asks if Friday works for lunch.', suggested: 'reply-draft', actions: ACTIONS, link: 'https://outlook.example.test/m/2', kind: 'needs_reply' },
];
const message = { id: 'AAMk1', from: { name: 'Alex Rivera', address: 'alex@example.test' }, to: [{ name: 'Me', address: 'me@example.test' }], subject: 'Quarterly plan', receivedAt: at(1), body: 'Hi Michael,\n\nCan you review the plan by Friday?\nIs the budget line final?\n\nThanks,\nAlex', mine: false };
const DRAFT = 'Hi Alex,\n\nYes, the budget line is final. I will send my notes on the plan by Thursday.\n\nMichael';
async function open(page: Page): Promise<Mock> {
  const m = await mockApi(page);
  m.inboxItems = seed();
  m.inboxDetail = {
    'mail-aaaaaaaaaaaa': { live: true, message, thread: [], draft: { text: DRAFT, canSend: true } },
    'mail-bbbbbbbbbbbb': { live: false, draft: { text: 'Friday works. Noon?', canSend: false, link: 'https://outlook.example.test/d/2' } },
  };
  await page.goto('/#/inbox');
  await expect(page.locator('.in-row').first()).toBeVisible();
  return m;
}
const pane = (page: Page) => page.getByTestId('split-detail');
const sends = (m: Mock) => m.calls.filter((c) => c.path.endsWith('/send'));

test('the reply is ready in the detail; editing stores it; nothing is sent without a click', async ({ page }, info) => {
  const m = await open(page);
  await page.getByRole('button', { name: 'Quarterly plan' }).click();
  const box = pane(page).getByRole('textbox', { name: 'Reply to Alex Rivera' });
  await expect(box).toHaveValue(DRAFT);
  await expect(pane(page).getByRole('button', { name: 'Send', exact: true })).toBeVisible();
  await expect(pane(page)).toContainText('Stack sends this reply when you click Send.');
  const axe = await new AxeBuilder({ page }).include('.inbox-view').analyze();
  expect(axe.violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => v.id)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await box.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `e2e/screenshots/inbox-send-${info.project.name}.png` });
  await box.fill('Yes, final. Notes by Thursday.');
  await pane(page).getByRole('heading', { name: 'Quarterly plan' }).click(); // leave the box
  await expect.poll(() => m.calls.find((c) => c.path === '/inbox-items/mail-aaaaaaaaaaaa/draft')?.body).toEqual({ text: 'Yes, final. Notes by Thursday.' });
  expect(sends(m)).toEqual([]);
});

test('Send is one click: it sends the edited text once and the item leaves the list', async ({ page }) => {
  const m = await open(page);
  await page.getByRole('button', { name: 'Quarterly plan' }).click();
  const box = pane(page).getByRole('textbox', { name: 'Reply to Alex Rivera' });
  await box.fill('Yes, final.');
  await pane(page).getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Reply sent to Alex Rivera')).toBeVisible();
  expect(sends(m)).toEqual([{ path: '/inbox-items/mail-aaaaaaaaaaaa/send', body: { text: 'Yes, final.' } }]);
  await expect(page.locator('.in-row')).toHaveCount(1);
  await expect(page.locator('.in-row').first()).toContainText('Lunch on Friday');
});

test('a failed send keeps the draft and says so', async ({ page }) => {
  const m = await open(page);
  m.sendFails = true;
  await page.getByRole('button', { name: 'Quarterly plan' }).click();
  await pane(page).getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('Could not send. The draft is kept.')).toBeVisible();
  await expect(pane(page).getByRole('textbox', { name: 'Reply to Alex Rivera' })).toHaveValue(DRAFT);
  await expect(page.locator('.in-row')).toHaveCount(2);
});

test('with Send off there is no Send button: the draft opens in Outlook', async ({ page }) => {
  const m = await open(page);
  await page.getByRole('button', { name: 'Lunch on Friday' }).click();
  await expect(pane(page).getByRole('textbox', { name: 'Reply to Sam Lee' })).toHaveValue('Friday works. Noon?');
  await expect(pane(page).getByRole('button', { name: 'Send', exact: true })).toHaveCount(0);
  await expect(pane(page).getByRole('link', { name: 'Open draft in Outlook' })).toHaveAttribute('href', 'https://outlook.example.test/d/2');
  await expect(pane(page)).toContainText('Send is off for this account.');
  await expect(pane(page).getByRole('link', { name: 'Turn on Send in Settings' })).toHaveAttribute('href', '#/settings/accounts');
  expect(sends(m)).toEqual([]);
});
