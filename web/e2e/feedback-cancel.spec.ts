/** The feedback panel: a Cancel button closes it without a keyboard, and the box says what to write. Spec: `.xe/features/feedback-button/spec.md`. */
import { expect, test, type Page } from '@playwright/test';
import { mockApi } from './mock';

async function open(page: Page, mobile: boolean) {
  await mockApi(page);
  const posts: unknown[] = [];
  await page.route('**/api/feedback', async (route) => { posts.push(route.request().postDataJSON()); return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'fb-1', at: new Date().toISOString(), screenshot: false }) }); });
  await page.goto('/#/now');
  const icon = page.getByTestId(mobile ? 'feedback-btn-phone' : 'feedback-btn');
  await icon.click();
  const panel = page.getByRole('dialog', { name: 'Send feedback' });
  await expect(panel).toBeVisible();
  return { panel, icon, posts };
}

// @req FR:feedback-button/ui.panel.cancel @req FR:feedback-button/ui.a11y
test('Cancel closes the panel, sends nothing, and returns focus to the icon', async ({ page }, info) => {
  const { panel, icon, posts } = await open(page, info.project.name === 'mobile');
  await panel.getByRole('textbox', { name: 'Feedback' }).fill('Not sure yet');
  await panel.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(panel).toBeHidden();
  await expect(icon).toBeFocused();
  expect(posts).toHaveLength(0);
});

// @req FR:feedback-button/ui.panel.fit
test('the three actions fit one line and keep 44 px targets on a phone', async ({ page }, info) => {
  const mobile = info.project.name === 'mobile';
  const { panel } = await open(page, mobile);
  for (const name of ['Cancel', 'Design review', 'Send']) await expect(panel.getByRole('button', { name, exact: true })).toBeVisible();
  // One read for all three: the panel fades in, so separate reads can see different frames.
  const boxes = await panel.locator('.fb-actions .btn').evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, height: r.height }; }));
  expect(boxes).toHaveLength(3);
  expect(new Set(boxes.map((b) => Math.round(b.y))).size).toBe(1);
  expect(boxes[0].x).toBeLessThan(boxes[1].x);
  if (mobile) for (const b of boxes) expect(b.height).toBeGreaterThanOrEqual(44);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

// @req FR:feedback-button/ui.panel.cancel.busy
test('Cancel is off while the feedback sends', async ({ page }, info) => {
  const { panel } = await open(page, info.project.name === 'mobile');
  let release = () => {};
  const held = new Promise<void>((r) => { release = r; });
  await page.route('**/api/feedback', async (route) => { await held; return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'fb-2', at: new Date().toISOString(), screenshot: false }) }); });
  await panel.getByRole('textbox', { name: 'Feedback' }).fill('Hold on');
  await panel.getByRole('checkbox', { name: 'Include a screenshot of this page' }).uncheck(); // the panel stays in view while it sends
  await panel.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(panel.getByRole('button', { name: 'Cancel', exact: true })).toBeDisabled();
  release();
  await expect(panel.getByRole('status')).toHaveText('Sent');
});

// @req FR:feedback-button/ui.panel.hint
test('the empty box says what to write', async ({ page }, info) => {
  const { panel } = await open(page, info.project.name === 'mobile');
  await expect(panel.getByRole('textbox', { name: 'Feedback' })).toHaveAttribute('placeholder', 'What should change?');
});
