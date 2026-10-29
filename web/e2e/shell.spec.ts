/** The shell: layout, nav, palette, and the states Michael hit on first use. */
import { expect, test, type Page } from '@playwright/test';
import { mockApi, seed, type MockAsk } from './mock';

const KEYBOARD = 'keyboard';
const iso = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const ask = (key: string, text: string, score = 50): MockAsk => ({ key, state: 'open', ask: text, kind: 'approve', from: 'cos', project: 'alpha', reversible: true, priority: 'normal', blocks: 0, created: iso(-2), updated: iso(-1), score, overdue: false });
const center = async (page: Page, sel: string) => { const b = (await page.locator(sel).boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

test.describe('layout and nav', () => {
  // @req FR:web-shell/layout.fill @req FR:web-shell/nav.rail @req FR:web-shell/nav.tabbar
  test('fills the window; one nav with the right words', async ({ page }, info) => {
    const m = await mockApi(page);
    m.asks = [ask('a', 'Approve PR 1'), ask('b', 'Approve PR 2')];
    await page.goto('/');
    await expect(page).toHaveURL(/\/$|#\/home/);
    await expect(page.getByTestId('next-title')).toBeVisible();
    if (info.project.name === 'mobile') {
      const tabs = page.locator('.tabbar .tab');
      await expect(tabs).toHaveText(['Home', 'My day', '', 'Needs you2', 'More']);
      await expect(page.locator('.tabbar').getByRole('button', { name: 'New task' })).toBeVisible();
      // the + sits in the middle of its circle (optical centering, not just box centering)
      const fab = await center(page, '.tabbar .fab');
      const glyph = await center(page, '.tabbar .fab > *');
      expect(Math.abs(fab.x - glyph.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(fab.y - glyph.y)).toBeLessThanOrEqual(1);
      // five equal slots
      const boxes = await Promise.all((await tabs.all()).map((t) => t.boundingBox()));
      const widths = boxes.map((b) => Math.round(b!.width));
      expect(Math.max(...widths) - Math.min(...widths)).toBeLessThanOrEqual(2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    } else {
      await expect(page.locator('.rail .tab:not(.add)').filter({ hasNotText: /Commands|Shortcuts/ })).toHaveText(['Homeg h', 'My dayg d', 'Needs you2g k', 'Projectsg p', 'Full stackg a']);
      await expect(page.locator('.tabbar')).toBeHidden();
      const main = (await page.locator('.main').boundingBox())!;
      const rail = (await page.locator('.rail').boundingBox())!;
      expect(main.x).toBeGreaterThanOrEqual(rail.width);
      expect(main.width).toBeGreaterThanOrEqual(1280 - rail.width - 2);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    }
  });

  // @req FR:web-shell/layout.breakpoint
  test('a tablet-wide window keeps the rail; only a phone-wide one gets the tab bar, and a reload changes nothing', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'desktop sizes');
    await mockApi(page);
    await page.setViewportSize({ width: 760, height: 900 });
    await page.goto('/');
    await expect(page.locator('.rail')).toBeVisible();
    await page.reload();
    await expect(page.locator('.rail')).toBeVisible();
    await expect(page.locator('.tabbar')).toBeHidden();
    await page.setViewportSize({ width: 700, height: 900 });
    await expect(page.locator('.tabbar')).toBeVisible();
  });

  // @req FR:web-shell/nav.keys
  test('g h, g d, g k, g p, g a move between the five views', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', KEYBOARD);
    await mockApi(page);
    await page.goto('/#/list');
    const chord = async (k: string, re: RegExp) => { await page.keyboard.press('g'); await page.keyboard.press(k); await expect(page).toHaveURL(re); };
    await chord('h', /#\/home/);
    await chord('d', /#\/today/);
    await chord('k', /#\/asks/);
    await chord('p', /#\/projects/);
    await chord('a', /#\/list/);
    await chord('t', /#\/today/);
  });

  // @req FR:web-shell/palette.jump @req FR:web-shell/palette.scope
  test('the palette jumps to a project by name; row commands only where there are rows', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', KEYBOARD);
    await mockApi(page);
    await page.goto('/#/asks');
    await page.keyboard.press('Control+k');
    const box = page.getByRole('combobox', { name: 'Command' });
    await box.fill('mark done');
    await expect(page.getByText('No matching command')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.keyboard.press('g'); await page.keyboard.press('h');
    await expect(page).toHaveURL(/#\/home/);
    await page.keyboard.press('Control+k');
    await box.fill('mark done');
    await expect(page.locator('#palette-list [role=option]').first()).toHaveText(/Mark done/);
    await box.fill('');
    await box.fill('alpha');
    await expect(page.locator('#palette-list [role=option]').first()).toHaveText(/Project: Alpha/);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/list\?project=alpha/);
    await expect(page.locator('.row')).toHaveCount(2); // alpha's open top-level rows
  });
});

test.describe('honest states', () => {
  // @req FR:web-shell/state.needs
  test('open 🙋 rows show on Needs you when no agent wrote an ask; Go with it sends the decision', async ({ page }) => {
    const tasks = seed();
    tasks.push({ ref: 'alpha:20', text: '🙋 Pick the ADU path', project: 'alpha', section: '🔄 Active', done: false, depth: 0, notes: ['> **Recommendation:** Studio Shed quote'] });
    tasks.push({ ref: 'alpha:21', text: '🙋 Pick a color', project: 'alpha', section: '🔄 Active', done: false, depth: 0, notes: ['Blue or green'] });
    const m = await mockApi(page, { tasks });
    await page.goto('/#/asks');
    const card = page.locator('.ask-card');
    await expect(card.locator('.ask-title')).toHaveText('Pick the ADU path');
    await expect(card).toContainText('Studio Shed quote');
    await expect(page.getByTestId('asks-empty')).toHaveCount(0);
    await expect(page.locator('.rail, .tabbar').getByRole('button', { name: /Needs you/ }).first()).toContainText('2');
    await card.getByRole('button', { name: /Go with it/ }).click();
    await expect.poll(() => m.calls.at(-1)).toMatchObject({ path: '/inbox', body: { ref: 'alpha:20', kind: 'decision', expect: '🙋 Pick the ADU path' } });
    // a 🙋 row with no recommendation wants an answer; Details opens the row itself
    await expect(card.locator('.ask-title')).toHaveText('Pick a color');
    await expect(card.getByLabel('Answer Alpha agent')).toBeVisible();
    await card.getByRole('button', { name: /Details/ }).click();
    await expect(page.locator('.focus-mode')).toContainText('Blue or green');
    await page.keyboard.press('Escape');
    await card.getByLabel('Answer Alpha agent').fill('Green');
    await card.getByLabel('Answer Alpha agent').press('Enter');
    await expect.poll(() => m.calls.at(-1)).toMatchObject({ path: '/inbox', body: { ref: 'alpha:21', kind: 'reply', text: 'Green' } });
    await expect(page.getByTestId('asks-empty')).toContainText('Nothing needs you. No open asks, decisions, or replies');
  });

  // @req FR:web-shell/state.live @req FR:web-shell/state.unreachable
  test('an unreachable api says so, and Retry really retries', async ({ page }) => {
    const m = await mockApi(page);
    m.asks = [ask('a', 'Approve PR 1')];
    let down = true;
    await page.route('**/api/asks**', (r) => (down ? r.abort('connectionrefused') : r.fallback()));
    await page.goto('/#/asks');
    const badge = page.getByTestId('live-status');
    await expect(badge).toContainText("Can't reach Stack");
    await expect(page.getByRole('alert')).toContainText(/Can't reach Stack at localhost:\d+\. Is stack web still running\?/);
    await expect(page.getByText('Network error')).toHaveCount(0);
    down = false;
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.locator('.ask-card .ask-title')).toHaveText('Approve PR 1');
    await expect(badge).toHaveText(/Checks every 15 s/); // the mock host has no stream: polling, and honest about it
  });

  // @req FR:web-shell/state.notify
  test('a blocked notification permission explains how to unblock', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'Notifications API on desktop Chromium');
    await page.addInitScript(() => {
      Object.defineProperty(Notification, 'permission', { configurable: true, get: () => 'denied' });
      Notification.requestPermission = () => Promise.resolve('denied');
    });
    await mockApi(page);
    await page.goto('/#/asks');
    const btn = page.getByRole('button', { name: 'Notifications blocked' });
    await expect(btn).toBeEnabled();
    await btn.click();
    await expect(page.locator('.toast')).toContainText("Allow notifications for this site in the browser's site settings");
  });

  // @req FR:web-shell/state.capture @req FR:web-shell/state.unreachable
  test('a capture that cannot reach Stack keeps the text and offers Retry', async ({ page }) => {
    const m = await mockApi(page);
    await page.goto('/');
    let down = true;
    await page.route('**/api/capture', (r) => (down ? r.abort('connectionrefused') : r.fallback()));
    await page.getByRole('button', { name: /New task/ }).first().click();
    const box = page.getByLabel('Quick capture');
    await box.fill('water plants');
    const line = page.getByTestId('capture-preview');
    await expect(line).toContainText(/Can't reach Stack at localhost:\d+/); // the preview already says so
    await box.press('Enter');
    await expect(line).toContainText(/Can't reach Stack at localhost:\d+/);
    await expect(line).not.toContainText('Network error');
    await expect(box).toHaveValue('water plants');
    down = false;
    await page.getByRole('dialog', { name: 'New task' }).getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByText('Added: Water plants')).toBeVisible();
    expect(m.calls.filter((c) => c.path === '/capture' && !c.body.dryRun)).toHaveLength(1);
  });
});
