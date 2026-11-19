/**
 * The Design review action in the feedback panel: desktop capture, issue link, errors, and the browser with no screenshot.
 * @req FR:design-review/ui.button @req FR:design-review/ui.button.text @req FR:design-review/ui.shot @req FR:design-review/ui.no-shot
 * @req FR:design-review/ui.shot.hide @req FR:design-review/ui.no-shot.message @req FR:design-review/ui.progress
 * @req FR:design-review/ui.result @req FR:design-review/ui.result.focus @req FR:design-review/ui.error @req FR:design-review/ui.error.focus
 */
import { expect, test, type Page } from '@playwright/test';
import { mockApi } from './mock';

async function setup(page: Page, o: { desktop?: boolean; fail?: boolean; slow?: boolean } = {}) {
  await page.addInitScript((desktop) => {
    if (navigator.mediaDevices) navigator.mediaDevices.getDisplayMedia = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));
    if (desktop) Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 Chrome/130 Electron/33.0.0 Safari/537.36' });
  }, !!o.desktop);
  await mockApi(page);
  const posts: any[] = [];
  const captures: number[] = [];
  // The host capture runs while the panel is hidden. @req FR:design-review/ui.shot.hide
  await page.route('**/api/design-review/capture', async (route) => {
    captures.push(await page.locator('.fb-panel').count());
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ shot: 'a'.repeat(24) }) });
  });
  await page.route('**/api/design-review', async (route) => {
    posts.push(route.request().postDataJSON());
    if (o.slow) await new Promise((r) => setTimeout(r, 2500));
    if (o.fail) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { code: 'unavailable', message: 'ChatGPT is not connected' } }) });
    return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ page: 'asks', url: 'https://github.com/Xerilium/stack/issues/999' }) });
  });
  await page.goto('/#/asks');
  (setup as { captures?: number[] }).captures = captures;
  return posts;
}
const open = async (page: Page, mobile: boolean) => {
  await page.getByTestId(mobile ? 'feedback-btn-phone' : 'feedback-btn').click();
  return page.getByRole('dialog', { name: 'Send feedback' });
};

test('desktop app: one click captures, files, and links the issue', async ({ page }, info) => {
  const posts = await setup(page, { desktop: true });
  const panel = await open(page, info.project.name === 'mobile');
  const btn = panel.getByRole('button', { name: 'Design review' });
  await expect(btn).toBeEnabled();
  await btn.click();
  await expect(panel.getByText('Filed')).toBeVisible();
  await expect(panel.getByRole('link', { name: /issues\/999/ })).toBeFocused();
  await expect(panel.getByRole('link', { name: /issues\/999/ })).toHaveAttribute('href', 'https://github.com/Xerilium/stack/issues/999');
  expect(posts).toEqual([expect.objectContaining({ route: '/#/asks', shot: 'a'.repeat(24) })]);
  expect((setup as { captures?: number[] }).captures).toEqual([0]);
  expect(posts[0].png).toBeUndefined();
});

test('desktop app: a failure shows the error and keeps the panel', async ({ page }, info) => {
  await setup(page, { desktop: true, fail: true });
  const panel = await open(page, info.project.name === 'mobile');
  await panel.getByRole('button', { name: 'Design review' }).click();
  await expect(panel.getByRole('alert')).toHaveText('ChatGPT is not connected');
  await expect(panel.getByRole('textbox', { name: 'Feedback' })).toBeFocused();
});

test('browser with no screenshot sends nothing', async ({ page }, info) => {
  const posts = await setup(page);
  const panel = await open(page, info.project.name === 'mobile');
  await panel.getByRole('button', { name: 'Design review' }).click();
  await expect(panel.getByRole('alert')).toHaveText('A screenshot is needed');
  expect(posts).toHaveLength(0);
});

test('desktop app: shows progress while ChatGPT reviews', async ({ page }, info) => {
  await setup(page, { desktop: true, slow: true });
  const panel = await open(page, info.project.name === 'mobile');
  await panel.getByRole('button', { name: 'Design review' }).click();
  await expect(panel.getByRole('status')).toHaveText('Reviewing with ChatGPT…');
  await expect(panel.getByText('Filed')).toBeVisible({ timeout: 5000 });
});
