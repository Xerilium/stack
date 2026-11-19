/** @req FR:ask-queue/web.card @req FR:ask-queue/web.responsive @req FR:product-reset/ui.askcard */
import { expect, test, type Page } from '@playwright/test';
import { mockApi, type MockAsk, type MockNeed } from './mock';

const iso = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const late = iso(-40); // overdue, not yet stale (FR:ask-queue/needs.web.stale moves items 48 h late out of the list)
const need = (id: string, title: string, recommendation: string, project: string, by = late): MockNeed & { by?: string } => ({ id, title, recommendation, project, by, link: `https://github.com/o/r/pull/${id.length}` });
const seed = () => [
  need('a1', 'Ack and resolve the keep / workflow thread on the release PR', 'ack and resolve; keep / workflow as drafted for now', 'finops-toolkit'),
  need('a2', 'Approve both FOCUS PRs', 'Approve both', 'finops-toolkit'),
  need('a3', 'Approve the Allyte site copy', 'Approve', 'allyte-web'),
  need('a4', 'Open the link and decide on the venue', 'Open the link and decide', 'flantastic'),
  need('a5', 'Pick the launch day', 'Monday', 'flantastic', iso(-30)),
  need('a6', 'Sign the lease renewal', 'Sign it', 'home', iso(3)),
  need('a7', 'Book the venue', 'Book it', 'home', iso(5)),
];

async function open(page: Page) {
  const m = await mockApi(page);
  m.asks = [];
  m.needs = seed();
  await page.goto('/#/asks');
  await expect(page.locator('.ask-card')).toBeVisible();
}

test.describe('Needs you rows: quiet meta that fits a phone (i203)', () => {
  test('the verb is the plain word; no row meta says Approve:', async ({ page }) => {
    await open(page);
    const verbs = await page.locator('.ask-row .verb').allTextContents();
    expect(new Set(verbs)).toEqual(new Set(['Approve']));
    for (const t of await page.locator('.ask-row .row-meta').allTextContents()) expect(t).not.toContain('Approve:');
    await expect(page.locator('.ask-row .verb').first()).toHaveCSS('text-transform', 'none');
  });

  test('at most one row uses the warn color for its deadline', async ({ page }) => {
    await open(page);
    const warn = await page.evaluate(() => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--warn)';
      document.querySelector('.asks-view')!.appendChild(probe);
      const c = getComputedStyle(probe).color;
      probe.remove();
      return c;
    });
    await page.getByRole('button', { name: /Show 2 more/ }).click();
    const colors = await page.locator('.ask-row .dl').evaluateAll((els) => els.map((e) => getComputedStyle(e).color));
    expect(colors.length).toBeGreaterThan(3);
    expect(colors.filter((c) => c === warn)).toHaveLength(1);
  });

  test('an Approve recommendation is the button label, never Approve: Approve', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: /^2\. Approve both FOCUS PRs/ }).click();
    await expect(page.locator('.ask-card .btn.primary')).toHaveAccessibleName(/^Approve both/);
    await expect(page.locator('.ask-card')).not.toContainText('Approve: Approve');
  });

  test('at 375 px: verb, deadline and project are fully visible; the primary button is one line', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await open(page);
    const clipped = await page.locator('.ask-row .row-meta').evaluateAll((metas) => metas.flatMap((m) => {
      const box = m.getBoundingClientRect();
      return [...m.children].filter((c) => (c as HTMLElement).offsetParent !== null).filter((c) => {
        const r = c.getBoundingClientRect();
        return c.scrollWidth > c.clientWidth + 1 || r.right > box.right + 1 || r.left < box.left - 1;
      }).map((c) => c.textContent);
    }));
    expect(clipped).toEqual([]);
    const cardBox = (await page.locator('.ask-card').boundingBox())!;
    const dl = (await page.locator('.ask-card .ask-eyebrow .dl').boundingBox())!;
    expect(dl.x + dl.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
    const lines = await page.locator('.ask-card .btn.primary .btn-label').evaluate((el) => {
      const lh = parseFloat(getComputedStyle(el).lineHeight) || 20;
      return Math.round(el.getBoundingClientRect().height / lh);
    });
    expect(lines).toBe(1);
    await expect(page.locator('.ask-card .btn.primary')).toHaveAttribute('title', /^Approve: ack and resolve/);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  });

  test('at 375 px: a primary button that says what it will do stays one line', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    const m = await mockApi(page);
    const long = 'Pay every bill this week before the mortgage is due Friday';
    m.asks = [{ key: 'q', state: 'open', ask: 'Pay bills first?', kind: 'decide', options: [long, 'Later'], applies: ['set priority=🚨', 'suspend 7d'], recommend: long, from: 'finance-cos', reversible: true, priority: 'normal', blocks: 0, created: iso(-1), updated: iso(-1), score: 90, overdue: false, ref: 'alpha:9' } as MockAsk];
    m.needs = [];
    await page.goto('/#/asks');
    const label = page.locator('.ask-card .btn.primary .btn-label');
    await expect(label).toHaveText(long);
    const lines = await label.evaluate((el) => Math.round(el.getBoundingClientRect().height / (parseFloat(getComputedStyle(el).lineHeight) || 20)));
    expect(lines).toBe(1);
    await expect(page.locator('.ask-card .btn.primary')).toHaveAttribute('title', long);
  });
});
