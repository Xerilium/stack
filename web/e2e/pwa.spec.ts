/* Mobile PWA, offline reading, notifications, and the week view. */
import { expect, test, type Page } from '@playwright/test';
import { mockApi, type MockAsk } from './mock';

const at10 = () => { const d = new Date(); d.setHours(10, 0, 0, 0); return d; };
const ask = (key: string, text: string): MockAsk => ({ key, ask: text, state: 'open', kind: 'approve', from: 'cos', project: 'alpha', reversible: false, priority: 'normal', blocks: 0, created: new Date().toISOString(), updated: new Date().toISOString(), score: 50, overdue: false });
const swReady = (page: Page) => page.evaluate(async () => { await navigator.serviceWorker.ready; });

test.describe('install', () => {
  // @req FR:pwa/install.manifest @req FR:pwa/install.head
  test('manifest, icons, and head tags', async ({ page, request }) => {
    const m = await (await request.get('/manifest.webmanifest')).json();
    expect(m).toMatchObject({ name: 'Stack', short_name: 'Stack', start_url: '/', scope: '/', display: 'standalone' });
    expect(m.icons.map((i: { sizes: string; purpose: string }) => `${i.sizes}/${i.purpose}`)).toEqual(['any/any', '192x192/any', '512x512/any', '512x512/maskable']);
    for (const i of m.icons) expect((await request.get(i.src)).status()).toBe(200);
    await mockApi(page);
    await page.goto('/');
    await expect(page.locator('link[rel=manifest]')).toHaveAttribute('href', '/manifest.webmanifest');
    await expect(page.locator('link[rel=apple-touch-icon]')).toHaveAttribute('href', '/icons/apple-touch-icon.png');
    await expect(page.locator('meta[name=theme-color]')).toHaveCount(2);
    await expect(page.locator('meta[name=apple-mobile-web-app-capable]')).toHaveAttribute('content', 'yes');
  });

  // @req FR:pwa/install.standalone
  test('no sideways scroll at 320 px', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'phone width');
    await mockApi(page);
    await page.setViewportSize({ width: 320, height: 640 });
    for (const h of ['/#/today', '/#/asks', '/#/projects']) {
      await page.goto(h);
      await page.waitForTimeout(300);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  });
});

test.describe('offline', () => {
  test.use({ serviceWorkers: 'allow' });

  // @req FR:pwa/offline.sw @req FR:pwa/offline.banner
  test('shows the saved plan and blocks writes when offline', async ({ page, context }) => {
    await mockApi(page, { context: true });
    await page.goto('/#/today');
    await swReady(page);
    await page.reload();
    await expect(page.locator('.today')).toBeVisible();
    await context.setOffline(true);
    await page.reload();
    await expect(page.getByTestId('offline-banner')).toContainText('Offline · showing');
    await expect(page.locator('.today')).toBeVisible();
    const start = page.locator('.lead-actions .btn.primary');
    if (await start.count()) await expect(start).toBeDisabled();
    await context.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await expect(page.getByTestId('offline-banner')).toHaveCount(0);
  });

  // @req FR:pwa/offline.private
  test('sign out deletes the Stack caches first', async ({ page }) => {
    await mockApi(page, { context: true });
    await page.route('**/.auth/logout', (r) => r.fulfill({ status: 200, contentType: 'text/html', body: '<p>bye</p>' }));
    await page.goto('/#/today');
    await swReady(page);
    await page.reload();
    await expect.poll(() => page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith('stack-')).length)).toBeGreaterThan(0);
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Command' }).fill('Sign out');
    await page.keyboard.press('Enter');
    await page.waitForURL('**/.auth/logout');
    expect(await page.evaluate(async () => (await caches.keys()).filter((k) => k.startsWith('stack-')).length)).toBe(0);
  });
});

test.describe('notifications', () => {
  test.use({ serviceWorkers: 'allow' });

  // @req FR:pwa/notify.optin @req FR:pwa/notify.new
  test('opt in, then a new ask while hidden raises one notification', async ({ page, context }, info) => {
    test.skip(info.project.name === 'mobile', 'Notifications API on desktop Chromium');
    await context.grantPermissions(['notifications']);
    await page.addInitScript(() => {
      const w = window as unknown as { __notes: unknown[]; __hidden: boolean };
      w.__notes = []; w.__hidden = false;
      // headless Chromium reports notifications as denied even when granted
      Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'granted' });
      ServiceWorkerRegistration.prototype.showNotification = function (title: string, o?: NotificationOptions) { w.__notes.push([title, o?.body, o?.tag]); return Promise.resolve(); };
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => w.__hidden });
    });
    const m = await mockApi(page, { context: true });
    m.asks.push(ask('one', 'Approve PR 879'));
    await page.clock.install({ time: at10() });
    await page.goto('/#/asks');
    await swReady(page);
    await page.getByRole('button', { name: 'Notify me' }).click();
    await expect(page.getByRole('button', { name: 'Notifications on' })).toHaveAttribute('aria-pressed', 'true');
    expect(await page.evaluate(() => localStorage.getItem('stack.notify'))).toBe('on');
    // visible page: a new ask only fades in
    m.asks.push(ask('two', 'Pick the launch day'));
    await page.clock.fastForward('00:20');
    await expect(page.getByText('Pick the launch day')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { __notes: unknown[] }).__notes)).toEqual([]);
    // hidden page: one notification, tagged so newer ones replace it
    await page.evaluate(() => { (window as unknown as { __hidden: boolean }).__hidden = true; });
    m.asks.push(ask('three', 'Sign the vendor form'));
    await page.clock.fastForward('00:20');
    await expect.poll(() => page.evaluate(() => (window as unknown as { __notes: unknown[] }).__notes)).toEqual([['Sign the vendor form', 'alpha', 'stack-asks']]);
  });

  // @req FR:pwa/notify.none
  test('no control without permission support', async ({ page }) => {
    await page.addInitScript(() => { delete (window as unknown as { Notification?: unknown }).Notification; });
    await mockApi(page);
    await page.goto('/#/asks');
    await expect(page.getByRole('heading', { name: /Needs you/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Notify me|Notifications on/ })).toHaveCount(0);
  });
});

test.describe('week', () => {
  // @req FR:web-app/week.days @req FR:web-app/week.summary @req FR:web-app/week.bars
  test('shows available vs planned per day with text labels', async ({ page }) => {
    await page.clock.install({ time: at10() });
    await mockApi(page);
    await page.goto('/#/projects');
    const week = page.getByTestId('week');
    await expect(week).toBeVisible();
    await expect(week.locator('.week-sum')).toContainText('available');
    await expect(week.locator('.week-sum')).toContainText('planned');
    expect(await week.locator('.wd').count()).toBeGreaterThanOrEqual(5);
    await expect(week.locator('.wd.today')).toHaveCount(1);
    await expect(week.locator('.wd').first()).toHaveAttribute('aria-label', /^Today: .+ planned of .+ available/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
});
