/** Live mode on the owner's checkout: the Unsaved chip, save on click, and the Live pill. */
import { expect, test, type Page } from '@playwright/test';
import { mockApi, seed } from './mock';

const liveMe = (page: Page) => page.route('**/.auth/me', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ clientPrincipal: { userDetails: 'local', identityProvider: 'local', userRoles: ['authenticated'] }, local: { mode: 'live', repo: '/Users/me/todo', branch: 'main' }, events: false }) }));
const since = new Date(2026, 9, 31, 14, 5).toISOString();
/** The chip renders in the rail and in the phone header; CSS shows one. */
const chipOf = (page: Page) => page.locator('[data-testid="unsaved"]:visible');

test.describe('Unsaved chip', () => {
  // @req FR:live-deploy/web.unsaved @req FR:live-deploy/web.unsaved.click @req FR:web-shell/state.unsaved
  test('shows the pending count where the shell keeps it; a click saves and clears it', async ({ page }, info) => {
    const m = await mockApi(page, { tasks: seed() });
    m.pending = 2; m.since = since;
    await liveMe(page);
    await page.goto('/#/home');
    const chip = chipOf(page);
    await expect(chip).toHaveText('Unsaved · 2');
    await expect(chip).toHaveAttribute('title', /First unsaved edit 2:05 PM/);
    // desktop: rail footer; phone: the header next to the brand
    const home = info.project.name === 'mobile' ? page.locator('.phone-brand') : page.locator('.rail .who');
    await expect(home.getByTestId('unsaved')).toHaveCount(1);
    await chip.click();
    await expect(chip).toHaveCount(0);
    expect(m.calls.filter((c) => c.path === '/sync')).toHaveLength(1);
  });

  // @req FR:live-deploy/web.unsaved.refresh
  test('the count is re-read after a write of its own', async ({ page }) => {
    const m = await mockApi(page, { tasks: seed() });
    m.pending = 0;
    await liveMe(page);
    await page.goto('/#/home');
    await expect(page.getByTestId('next-title')).toBeVisible();
    await expect(chipOf(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Done' }).first().click();
    await expect(chipOf(page)).toHaveText('Unsaved · 1');
  });

  // @req FR:live-deploy/web.unsaved.none
  test('absent when the answer has no pending (hosted app) and in demo mode', async ({ page }) => {
    await mockApi(page, { tasks: seed() });
    await page.goto('/#/home');
    await expect(page.getByTestId('next-title')).toBeVisible();
    await expect(chipOf(page)).toHaveCount(0);
  });

  // @req FR:live-deploy/web.unsaved.error
  test('a failed save keeps the chip and says why', async ({ page }) => {
    const m = await mockApi(page, { tasks: seed() });
    m.pending = 1; m.since = since;
    m.fail.set('POST /sync', { status: 409, code: 'conflict', message: 'Conflict on tasks/alpha.md: remote changed it concurrently' });
    await liveMe(page);
    await page.goto('/#/home');
    await chipOf(page).click();
    await expect(page.getByText('Conflict on tasks/alpha.md: remote changed it concurrently')).toBeVisible();
    await expect(chipOf(page)).toHaveText('Unsaved · 1');
  });

  // @req FR:web-shell/state.unsaved.pill @req FR:cli/web.live.pill
  test('live mode: brand reads Stack and the rail pill names the branch', async ({ page }, info) => {
    await mockApi(page, { tasks: seed() });
    await liveMe(page);
    await page.goto('/#/home');
    const brand = info.project.name === 'mobile' ? page.locator('.phone-brand .brand-text') : page.locator('.rail .brand');
    await expect(brand).toHaveText('Stack');
    if (info.project.name !== 'mobile') await expect(page.locator('.rail .who').getByTestId('repo-pill')).toHaveText('Live · main');
    await expect(page.getByText('/Users/me/todo')).toHaveCount(0);
  });
});
