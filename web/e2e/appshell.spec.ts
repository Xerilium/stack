/** The app is a fixed shell: the document never scrolls, only the content region does. @req FR:web-shell/layout.app @req FR:web-shell/layout.sticky */
import { expect, test, type Page } from '@playwright/test';
import { mockApi, seed, type MockTask } from './mock';

const many = (): MockTask[] => {
  const t = seed();
  for (let i = 0; i < 120; i++) t.push({ ref: `alpha:${100 + i}`, text: `Filler task ${i + 1} 🟢`, project: 'alpha', section: i < 60 ? '🔄 Active' : '📋 Backlog', done: false, depth: 0, notes: [] });
  return t;
};
const docFits = (page: Page) => page.evaluate(() => ({ doc: document.documentElement.scrollHeight, vp: window.innerHeight, scrollY: window.scrollY, bodyOverflow: getComputedStyle(document.body).overflow }));
const scrollContent = (page: Page, px: number) => page.evaluate((n) => { const el = document.querySelector('.main') as HTMLElement; el.scrollTop = n; return el.scrollTop; }, px);

test.describe('fixed app shell', () => {
  test('the document never scrolls; the content region does; nav and section headers stay put', async ({ page }, info) => {
    await mockApi(page, { tasks: many() });
    await page.goto('/#/list');
    await expect(page.locator('.row').first()).toBeVisible();
    const before = await docFits(page);
    expect(before.doc).toBeLessThanOrEqual(before.vp);
    expect(before.bodyOverflow).toBe('hidden');
    // scrolling the content moves rows, not the chrome
    const nav = info.project.name === 'mobile' ? page.locator('.tabbar') : page.locator('.rail');
    const navTop = (await nav.boundingBox())!.y;
    const moved = await scrollContent(page, 600);
    expect(moved).toBeGreaterThan(0);
    const after = await docFits(page);
    expect(after.scrollY).toBe(0);
    expect((await nav.boundingBox())!.y).toBe(navTop);
    // the project name and its section header are sticky at the top of the content region, stacked
    const mainTop = (await page.locator('.main').boundingBox())!.y;
    const group = (await page.locator('.group').first().boundingBox())!;
    expect(Math.abs(group.y - mainTop)).toBeLessThanOrEqual(2);
    const header = (await page.locator('.section').first().boundingBox())!;
    expect(Math.abs(header.y - (group.y + group.height))).toBeLessThanOrEqual(2);
    // wheel/touch scroll on the content never rubber-bands the page
    expect(await page.evaluate(() => getComputedStyle(document.querySelector('.main')!).overscrollBehaviorY)).toBe('contain');
  });

  test('focus mode and the capture dialog scroll inside themselves', async ({ page }) => {
    await mockApi(page, { tasks: many() });
    await page.goto('/#/list');
    await page.locator('.row').first().click();
    await page.keyboard.press('Enter');
    await expect(page.locator('.focus-mode')).toBeVisible();
    const f = await page.evaluate(() => { const el = document.querySelector('.focus-mode') as HTMLElement; return { overflow: getComputedStyle(el).overflowY, osb: getComputedStyle(el).overscrollBehaviorY, doc: document.documentElement.scrollHeight, vp: window.innerHeight }; });
    expect(f.overflow).toBe('auto');
    expect(f.osb).toBe('contain');
    expect(f.doc).toBeLessThanOrEqual(f.vp);
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: /New task/ }).first().click();
    const d = await page.evaluate(() => { const el = document.querySelector('.dialog') as HTMLElement; return { overflow: getComputedStyle(el).overflowY, osb: getComputedStyle(el).overscrollBehaviorY }; });
    expect(d.overflow).toBe('auto');
    expect(d.osb).toBe('contain');
  });
});
