/** My day rows on a phone: the title has the row width, not a narrow column. Spec: `.xe/features/task-detail-design/spec.md`. */
import { expect, test, type Page } from '@playwright/test';
import { mockApi, type MockTask } from './mock';

const at = (h: number, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d; };
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const row = (ref: string, text: string): MockTask => ({ ref, text, project: 'alpha', section: '🔄 Active', done: false, depth: 0, notes: [] });
const TEAM = [
  { slug: 'cos', name: 'CoS', role: 'Chief of Staff', scope: ['*'], mode: 'long-running', prompt: '', defined: true, source: 'claude', projects: ['alpha'] },
  { slug: 'alpha-lead', name: 'Alpha Lead', role: 'owns alpha', scope: ['alpha'], mode: 'ad-hoc', prompt: '', defined: true, source: 'stack', projects: ['alpha'], reportsTo: 'cos' },
];
const LONG = 'Record the LinkedIn posts for the hubs site and the toolkit release notes 🟡';

async function open(page: Page) {
  await page.clock.install({ time: at(10) });
  const m = await mockApi(page, { tasks: [row('alpha:1', LONG)], projects: [{ name: 'alpha', title: 'Alpha' }] });
  m.team = TEAM as never; m.sessions = [];
  m.schedule = { timezone: 'UTC', date: ymd(at(0)), wake: at(8).toISOString(), bed: at(23).toISOString(), asleep: false, blocks: [] };
  await page.goto('/#/today');
  await page.clock.resume();
  const what = page.locator('[data-testid="plan"] .block .what').first();
  await expect(what).toBeVisible();
  return what;
}

// @req FR:task-detail-design/myday.phone.title @req FR:task-detail-design/myday.phone.acts
test('on a phone the title spans the row: the actions sit under it, not beside it', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'phone layout');
  const what = await open(page);
  await expect(what.locator('.row-acts .ic')).toHaveCount(3);
  const w = (await what.boundingBox())!;
  const t = (await what.locator('.what-title').boundingBox())!;
  const a = (await what.locator('.row-acts').boundingBox())!;
  const c = (await what.locator('.chev').boundingBox())!;
  // The title takes the row but for the tick and the chevron.
  expect(t.width).toBeGreaterThan(w.width - 26 - 16 - 40);
  // The actions are on the line under the title; the chevron stays at the row end.
  expect(a.y).toBeGreaterThanOrEqual(t.y + t.height - 1);
  expect(c.x + c.width).toBeLessThanOrEqual(w.x + w.width + 1);
  expect(c.width).toBeLessThanOrEqual(24);
  // A title this long wraps to three lines at most.
  expect(t.height).toBeLessThanOrEqual(66);
});

// @req FR:task-detail-design/myday.phone.acts @req FR:task-detail-design/a11y.targets
test('on a phone the row actions keep 44 px targets and the page does not scroll sideways', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'phone layout');
  const what = await open(page);
  for (const b of await what.locator('.row-acts .ic').all()) {
    const box = (await b.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
