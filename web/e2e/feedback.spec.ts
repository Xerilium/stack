/**
 * The feedback icon and panel at 375 px (top bar) and 1280 px (rail footer): open, send, Sent, screenshot flag, axe.
 * @req FR:feedback-button/ui.icon @req FR:feedback-button/ui.panel @req FR:feedback-button/ui.sent @req FR:feedback-button/ui.shot @req FR:feedback-button/ui.a11y
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mockApi } from './mock';

async function setup(page: Page, o: { desktop?: boolean; fail?: boolean } = {}) {
  await page.addInitScript((desktop) => {
    // No real screen picker in tests: the Screen Capture API is denied.
    if (navigator.mediaDevices) navigator.mediaDevices.getDisplayMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
    if (desktop) Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 Chrome/130 Electron/33.0.0 Safari/537.36' });
  }, !!o.desktop);
  await mockApi(page);
  const posts: any[] = [];
  await page.route('**/api/feedback', async (route) => {
    posts.push(route.request().postDataJSON());
    if (o.fail) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: { code: 'internal', message: 'Disk full' } }) });
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'fb-1', at: new Date().toISOString(), screenshot: false }) });
  });
  await page.goto('/#/now');
  return posts;
}
const icon = (page: Page, mobile: boolean) => page.getByTestId(mobile ? 'feedback-btn-phone' : 'feedback-btn');

test('icon sits in the chrome with its tooltip and no shortcut badge', async ({ page }, info) => {
  await setup(page);
  const mobile = info.project.name === 'mobile';
  const b = icon(page, mobile);
  await expect(b).toBeVisible();
  await expect(b).toHaveAttribute('title', 'Send feedback (F)');
  await expect(b).toHaveAccessibleName('Send feedback (F)');
  await expect(b.locator('kbd')).toHaveCount(0);
  if (!mobile) await expect(page.locator('.rail .fb-btn')).toBeVisible();
  else await expect(page.locator('.phone-brand .fb-btn')).toBeVisible();
  const box = await b.boundingBox();
  expect(box!.height).toBeGreaterThanOrEqual(mobile ? 44 : 36);
});

test('sends the text with context, shows only Sent, then returns focus', async ({ page }, info) => {
  const posts = await setup(page);
  const mobile = info.project.name === 'mobile';
  await icon(page, mobile).click();
  const panel = page.getByRole('dialog', { name: 'Send feedback' });
  await expect(panel).toBeVisible();
  const box = panel.getByRole('textbox', { name: 'Feedback' });
  await expect(box).toBeFocused();
  await expect(panel.getByRole('checkbox', { name: 'Include a screenshot of this page' })).toBeChecked();
  const send = panel.getByRole('button', { name: 'Send', exact: true });
  await expect(send).toBeDisabled();
  await box.fill('Rail is too wide');
  await send.click();
  await expect(panel.getByRole('status')).toHaveText('Sent');
  await expect(panel.getByRole('textbox')).toHaveCount(0);
  await expect(panel).toBeHidden({ timeout: 4000 });
  await expect(icon(page, mobile)).toBeFocused();
  expect(posts).toHaveLength(1);
  // The browser capture was denied: no png, no capture flag; context is the route without a query.
  expect(posts[0]).toEqual({ text: 'Rail is too wide', route: '/#/now', viewport: mobile ? '375x812' : '1280x800', theme: expect.stringMatching(/^(light|dark)$/) });
});

test('desktop app asks the host to capture; unchecked sends none', async ({ page }, info) => {
  const posts = await setup(page, { desktop: true });
  const mobile = info.project.name === 'mobile';
  await icon(page, mobile).click();
  await page.getByRole('textbox', { name: 'Feedback' }).fill('one');
  await page.getByRole('dialog', { name: 'Send feedback' }).getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Sent' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Send feedback' })).toBeHidden({ timeout: 4000 });
  await icon(page, mobile).click();
  await page.getByRole('textbox', { name: 'Feedback' }).fill('two');
  await page.getByRole('checkbox', { name: 'Include a screenshot of this page' }).uncheck();
  await page.getByRole('dialog', { name: 'Send feedback' }).getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Sent' })).toBeVisible();
  expect(posts.map((p) => p.capture)).toEqual([true, undefined]);
});

test('a failure keeps the text and shows the error', async ({ page }, info) => {
  await setup(page, { fail: true });
  await icon(page, info.project.name === 'mobile').click();
  await page.getByRole('textbox', { name: 'Feedback' }).fill('keep me');
  await page.getByRole('dialog', { name: 'Send feedback' }).getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByRole('alert')).toHaveText('Disk full');
  await expect(page.getByRole('textbox', { name: 'Feedback' })).toHaveValue('keep me');
  await expect(page.getByRole('textbox', { name: 'Feedback' })).toBeFocused();
});

test('Shift+F opens it; Escape closes it; axe clean', async ({ page }, info) => {
  await setup(page);
  await page.locator('body').click({ position: { x: 5, y: 400 } }).catch(() => undefined);
  await page.keyboard.press('Shift+F');
  const panel = page.getByRole('dialog', { name: 'Send feedback' });
  await expect(panel).toBeVisible();
  const { violations } = await new AxeBuilder({ page }).include('.fb-panel').analyze();
  expect(violations).toEqual([]);
  const chrome = await new AxeBuilder({ page }).include(info.project.name === 'mobile' ? '.phone-brand' : '.rail').analyze();
  expect(chrome.violations).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
});

test('app and view keys stand down while the panel is open', async ({ page }, info) => {
  await setup(page);
  await icon(page, info.project.name === 'mobile').click();
  const panel = page.getByRole('dialog', { name: 'Send feedback' });
  await panel.getByRole('textbox', { name: 'Feedback' }).fill('keys');
  await panel.getByRole('button', { name: 'Send', exact: true }).focus();
  for (const k of ['?', ':', 'c', 'd']) await page.keyboard.press(k);
  await expect(page.getByRole('dialog')).toHaveCount(1);
  await expect(panel).toBeVisible();
});
