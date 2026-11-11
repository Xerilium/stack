/* iOS install and notification permission screen at phone width. */
import { expect, test, type Page } from '@playwright/test';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
const SUB = { endpoint: 'https://web.push.apple.com/x', keys: { p256dh: 'P', auth: 'A' } };

test.use({ userAgent: IPHONE });

/** Fakes standalone display, the permission prompt (counted), and a push subscription. */
async function phone(page: Page, o: { standalone: boolean; grant?: NotificationPermission; device?: string }) {
  await page.addInitScript(({ standalone, grant, sub, device }) => {
    const w = window as unknown as { __asks: number };
    w.__asks = 0;
    Object.defineProperty(navigator, 'standalone', { value: standalone, configurable: true });
    let perm: NotificationPermission = 'default';
    Object.defineProperty(Notification, 'permission', { get: () => perm, configurable: true });
    Notification.requestPermission = async () => { w.__asks++; perm = grant; return perm; };
    let made: unknown = null;
    const reg = { pushManager: { getSubscription: async () => made, subscribe: async () => (made = { toJSON: () => sub }) } };
    Object.defineProperty(navigator.serviceWorker, 'ready', { value: Promise.resolve(reg), configurable: true });
    if (device) localStorage.setItem('stack.device', device);
  }, { standalone: o.standalone, grant: o.grant ?? 'granted', sub: SUB, device: o.device ?? '' });
  const saved: unknown[] = [];
  await page.route('**/api/auth/devices/me/push-key', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ key: 'AQID' }) }));
  await page.route('**/api/auth/devices/me/push', async (r) => {
    saved.push({ auth: r.request().headers().authorization, body: r.request().postDataJSON() });
    await r.fulfill({ status: 200, contentType: 'application/json', body: '{"push":true}' });
  });
  return { saved, asks: () => page.evaluate(() => (window as unknown as { __asks: number }).__asks) };
}

const noSideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);

test.describe('install screen', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone width');

  // @req FR:iphone-access/install.@ui @req FR:iphone-access/install.steps @req FR:iphone-access/install.gesture
  test('Safari tab shows Add to Home Screen steps and never asks', async ({ page }, info) => {
    const p = await phone(page, { standalone: false });
    await page.goto('/#/install');
    await expect(page.getByRole('heading', { name: 'Add Stack to your Home Screen' })).toBeVisible();
    await expect(page.getByText('Add to Home Screen', { exact: true })).toBeVisible();
    expect(await p.asks()).toBe(0);
    expect(await noSideways(page)).toBe(true);
    await page.screenshot({ path: info.outputPath('install-add-375.png'), fullPage: true });
  });

  // @req FR:iphone-access/install.pair
  test('a pairing link stores the token and clears the hash', async ({ page }) => {
    await phone(page, { standalone: true });
    await page.goto('/#/install?device=sk_test.secret');
    await expect(page.getByRole('button', { name: 'Turn on notifications' })).toBeEnabled();
    expect(await page.evaluate(() => location.hash)).toBe('#/install');
    expect(await page.evaluate(() => localStorage.getItem('stack.device'))).toBe('sk_test.secret');
  });

  // @req FR:iphone-access/install.gesture @req FR:iphone-access/install.subscribe
  test('installed app asks only on tap, then saves the subscription', async ({ page }, info) => {
    const p = await phone(page, { standalone: true, device: 'sk_dev.tok' });
    await page.goto('/#/install');
    const btn = page.getByRole('button', { name: 'Turn on notifications' });
    await expect(btn).toBeVisible();
    await page.reload();
    await expect(btn).toBeVisible();
    expect(await p.asks()).toBe(0);
    expect(await noSideways(page)).toBe(true);
    await page.screenshot({ path: info.outputPath('install-enable-375.png'), fullPage: true });
    await btn.click();
    await expect(page.getByRole('heading', { name: 'Notifications are on' })).toBeVisible();
    expect(await p.asks()).toBe(1);
    expect(p.saved).toEqual([{ auth: 'Bearer sk_dev.tok', body: SUB }]);
    await page.screenshot({ path: info.outputPath('install-on-375.png'), fullPage: true });
  });

  // @req FR:iphone-access/install.subscribe
  test('denied shows the Settings path and saves nothing', async ({ page }, info) => {
    const p = await phone(page, { standalone: true, grant: 'denied', device: 'sk_dev.tok' });
    await page.goto('/#/install');
    await page.getByRole('button', { name: 'Turn on notifications' }).click();
    await expect(page.getByText('Blocked: allow notifications for Stack in Settings > Notifications')).toBeVisible();
    expect(p.saved).toEqual([]);
    await page.screenshot({ path: info.outputPath('install-blocked-375.png'), fullPage: true });
  });

  // @req FR:iphone-access/install.pair
  test('without a device token the enable step waits for pairing', async ({ page }) => {
    await phone(page, { standalone: true });
    await page.goto('/#/install');
    await expect(page.getByText('Pair this phone first')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Turn on notifications' })).toBeDisabled();
  });
});
