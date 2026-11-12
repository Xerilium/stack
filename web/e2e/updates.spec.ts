/**
 * The Updates dialog on a desktop host: `#/updates` on first load opens it; app keys stand down while it is open.
 * @req FR:devops-installer/notice.menu @req FR:devops-installer/notice.dialog
 */
import { expect, test, type Page } from '@playwright/test';
import { mockApi } from './mock';

const STAMP = { version: '0.0.1', sha: 'bbbbbbbbbbbb', dirty: false, builtAt: '2026-11-12T10:00:00.000Z' };

async function setup(page: Page) {
  await mockApi(page);
  // The desktop host: a local principal and an installer behind /api/version.
  await page.route('**/.auth/me', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ clientPrincipal: { identityProvider: 'local', userId: 'owner', userDetails: 'owner', userRoles: ['authenticated'] } }) }));
  await page.route('**/api/version', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ running: { ...STAMP, sha: 'aaaaaaaaaaaa' }, available: STAMP, ready: true, mode: 'on-quit', idleMinutes: 30, canRestart: true, last: null }) }));
}

test('a fresh load of #/updates opens the dialog, and app keys stand down', async ({ page }) => {
  await setup(page);
  await page.goto('/#/updates');
  const dlg = page.getByRole('dialog', { name: 'Updates' });
  await expect(dlg).toBeVisible();
  await dlg.getByRole('button', { name: 'Close' }).focus();
  for (const k of ['?', ':', 'c', 'd']) await page.keyboard.press(k);
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(dlg).toBeVisible();
});
