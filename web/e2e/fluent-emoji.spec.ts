// Agent and project emoji render as bundled Fluent Emoji; others stay native. Runs at 375 px (mobile) and 1280 px (desktop).
import { expect, test, type Locator, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mockApi, seed } from './mock';

const ten = async (page: Page) => { const d = new Date(); d.setHours(10, 0, 0, 0); await page.clock.setFixedTime(d); };
const loaded = (img: Locator) => img.evaluate((el) => (el as HTMLImageElement).complete && (el as HTMLImageElement).naturalWidth > 0);
const projects: { name: string; title: string; metadata: Record<string, string> }[] = [{ name: 'alpha', title: '🎧 Alpha', metadata: { 'Work capacity': '2h' } }, { name: 'beta', title: '🧌 Beta', metadata: {} }];

test.describe('Fluent emoji', () => {
  // @req FR:agent-team/web.avatar.fluent @req FR:agent-team/web.avatar
  test('the agent avatar uses the Fluent art for the emoji that starts its name', async ({ page }, info) => {
    await ten(page);
    const m = await mockApi(page, { tasks: seed(), projects });
    m.team = [{ slug: 'alpha-lead', name: '🎧 Ada Lead', scope: ['alpha'], mode: 'ad-hoc', prompt: '', defined: true, projects: ['alpha'] }];
    await page.goto('/#/now');
    const face = page.getByTestId('now-chat').locator('form img.avatar.fluent');
    await expect(face).toHaveAttribute('aria-hidden', 'true');
    await expect(face).toHaveAttribute('alt', '');
    await expect.poll(() => loaded(face)).toBe(true);
    const box = (await face.boundingBox())!;
    expect([Math.round(box.width), Math.round(box.height)]).toEqual([36, 36]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const axe = await new AxeBuilder({ page }).include('[data-testid="now"]').analyze();
    expect(axe.violations).toEqual([]);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `e2e/screenshots/fluent-now-${info.project.name}.png` });
  });

  // @req FR:agent-team/web.avatar.fluent: an emoji with no bundled art stays native text
  test('an icon with no bundled art stays native; fluent:<name> resolves by file name', async ({ page }) => {
    await ten(page);
    const m = await mockApi(page, { tasks: seed() });
    m.team = [{ slug: 'alpha-lead', name: 'Ada Lead', scope: ['alpha'], mode: 'ad-hoc', prompt: '', defined: true, projects: ['alpha'], icon: '🧌' } as never];
    await page.goto('/#/now');
    await expect(page.getByTestId('now-chat').locator('form span.avatar.emoji')).toHaveText('🧌');
    m.team = [{ slug: 'alpha-lead', name: 'Ada Lead', scope: ['alpha'], mode: 'ad-hoc', prompt: '', defined: true, projects: ['alpha'], icon: 'fluent:headphone' } as never];
    await page.reload();
    await expect.poll(() => loaded(page.getByTestId('now-chat').locator('form img.avatar.fluent'))).toBe(true);
  });

  // @req FR:agent-team/web.avatar.fluent: a Fluent image that fails to load falls back to native text
  test('a Fluent image that fails to load shows the native emoji', async ({ page }) => {
    await ten(page);
    await page.route(/\/assets\/[^/]+\.svg$/, (r) => r.abort());
    const m = await mockApi(page, { tasks: seed() });
    m.team = [{ slug: 'alpha-lead', name: '🎧 Ada Lead', scope: ['alpha'], mode: 'ad-hoc', prompt: '', defined: true, projects: ['alpha'] }];
    await page.goto('/#/now');
    await expect(page.getByTestId('now-chat').locator('form span.avatar.emoji')).toHaveText('🎧');
    await expect(page.getByTestId('now-chat').locator('form img.avatar')).toHaveCount(0);
  });

  // @req FR:agent-team/web.avatar.project
  test('project headings draw their emoji with the same renderer', async ({ page }, info) => {
    await ten(page);
    await mockApi(page, { tasks: seed(), projects });
    await page.goto('/#/list');
    const head = page.locator('li.group').filter({ hasText: 'Alpha' }).first();
    await expect(head).toBeVisible();
    const emo = head.locator('img.emo');
    await expect.poll(() => loaded(emo)).toBe(true);
    const size = (await emo.boundingBox())!;
    expect(size.width).toBeGreaterThan(10);
    expect(size.width).toBeLessThan(24);
    await expect(page.locator('li.group').filter({ hasText: 'Beta' }).first().locator('.emo-native')).toHaveText('🧌');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    const axe = await new AxeBuilder({ page }).include('li.group').analyze();
    expect(axe.violations).toEqual([]);
    await page.screenshot({ path: `e2e/screenshots/fluent-list-${info.project.name}.png` });
  });
});
