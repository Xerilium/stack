/** Inbox: the toast after an action says the result in plain words. Spec: `.xe/features/inbox-page/spec.md`. */
import { expect, test } from '@playwright/test';
import { mockApi } from './mock';

const item = { id: 'mail-aaaaaaaaaaaa', source: 'email', account: 'me@example.test', from: 'Alex Rivera', subject: 'Quarterly plan', receivedAt: new Date(Date.now() - 3600_000).toISOString(), unread: true, urgency: 1, summary: 'Alex sent the plan.', suggested: 'mark-done', actions: ['mark-done', 'snooze', 'create-task'] };

// @req FR:inbox-page/web.toast
test('mark done says Marked done, not the button label twice', async ({ page }) => {
  const m = await mockApi(page);
  m.inboxItems = [item] as never;
  await page.goto('/#/inbox');
  await page.locator('.in-row').first().getByRole('button', { name: 'Mark done' }).click();
  await expect(page.getByText('Marked done', { exact: true })).toBeVisible();
  await expect(page.getByText('Mark done: done')).toHaveCount(0);
});
