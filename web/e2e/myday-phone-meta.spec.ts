/** My day rows on a phone: the start time and the estimate stay in view; the project name is cut first. Spec: `.xe/features/home/spec.md`. */
import { expect, test, type Page } from '@playwright/test';
import { mockApi, type MockTask } from './mock';

const at = (h: number, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d; };
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const row = (ref: string, text: string): MockTask => ({ ref, text, project: 'alpha', section: '🔄 Active', done: false, depth: 0, notes: [] });
const TEAM = [{ slug: 'cos', name: 'CoS', role: 'Chief of Staff', scope: ['*'], mode: 'long-running', prompt: '', defined: true, source: 'claude', projects: ['alpha'] }];

/** 10:10: the plan starts at 10:15, off the half hour, so each row shows its start time. */
async function open(page: Page) {
  await page.clock.install({ time: at(10, 10) });
  const m = await mockApi(page, {
    tasks: [row('alpha:1', 'Sign the permission slip'), row('alpha:2', 'Write the release notes')],
    projects: [{ name: 'alpha', title: '🏦 FinOps toolkit' }],
  });
  m.team = TEAM as never; m.sessions = [];
  m.schedule = { timezone: 'UTC', date: ymd(at(0)), wake: at(8).toISOString(), bed: at(23).toISOString(), asleep: false, blocks: [] };
  await page.goto('/#/today');
  await page.clock.resume();
  await expect(page.locator('[data-testid="plan"] .block .what').first()).toBeVisible();
}

// @req FR:home/myday.timeline.phone @req FR:home/myday.timeline.start @req FR:home/myday.timeline.estimate
test('on a phone a row keeps its start time and estimate in view', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'phone layout');
  await open(page);
  const blocks = page.locator('[data-testid="plan"] .block:not(.short)');
  await expect(blocks).toHaveCount(2);
  for (const b of await blocks.all()) {
    const meta = (await b.locator('.what-meta').boundingBox())!;
    for (const sel of ['.at', '.est']) {
      const mark = b.locator(`.what-meta ${sel}`);
      await expect(mark).toBeVisible();
      const box = (await mark.boundingBox())!;
      // The whole mark is inside the meta line: nothing cuts it.
      expect(box.x).toBeGreaterThanOrEqual(meta.x - 0.5);
      expect(box.x + box.width).toBeLessThanOrEqual(meta.x + meta.width + 0.5);
    }
    // The project name keeps the space that is left.
    expect((await b.locator('.what-meta > span').first().boundingBox())!.width).toBeGreaterThanOrEqual(24);
    // The meta line and the actions do not overlap, and the actions keep their place at the row end.
    const acts = (await b.locator('.row-acts').boundingBox())!;
    expect(meta.x + meta.width).toBeLessThanOrEqual(acts.x + 0.5);
  }
  await expect(blocks.nth(0).locator('.what-meta .at')).toHaveText('10:15a');
  await expect(blocks.nth(0).locator('.what-meta .est')).toHaveText('~30m');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
