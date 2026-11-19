/**
 * Error toasts say what happened and what to do; words the app writes for the owner reach the toast unchanged.
 * @req FR:web-shell/state.errors @req FR:web-shell/state.errors.specific @req FR:web-shell/state.errors.code
 */
import { expect, test } from '@playwright/test';
import { mockApi } from './mock';

test('a blocked live check cannot be deferred: the toast says so in its own words', async ({ page }) => {
  await page.clock.setFixedTime(new Date(2026, 9, 28, 10)); // a weekday morning: every defer choice shows
  const m = await mockApi(page);
  m.needs = [{ id: 'lv.pr-12.3', title: 'Live check blocked: sign-in page', recommendation: 'Reopen it', link: 'https://example.com/lv' }];
  await page.goto('/#/notifications');
  await expect(page.locator('.ask-card')).toBeVisible();
  await page.keyboard.press('z');
  const group = page.getByRole('group', { name: 'Defer until' });
  await expect(group).toBeVisible();
  await page.keyboard.press(String((await group.getByRole('button').count()) - 1));
  await expect(page.locator('.toast.err')).toHaveText(/A blocked live check cannot be deferred: answer it or reply/);
  await expect(page.locator('.toast.err')).not.toHaveText(/Try again/);
});

test('a bare internal error on an answer says to try again, then send feedback', async ({ page }) => {
  const m = await mockApi(page);
  m.needs = [{ id: 'n1', title: 'Approve the plan', recommendation: 'Go', link: 'https://example.com/1' }];
  m.fail.set('POST /needs-you/n1/answer', { status: 500, code: 'internal', message: 'Internal error' });
  await page.goto('/#/notifications');
  await expect(page.locator('.ask-card')).toBeVisible();
  await page.locator('.ask-card .btn.primary').click();
  await expect(page.locator('.toast.err')).toHaveText(/Could not send the answer\. Try again\. If it happens again, send feedback \(F\)\./);
});
