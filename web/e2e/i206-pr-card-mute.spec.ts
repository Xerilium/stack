/**
 * PR cards are quiet: a neutral panel, a muted 3 px owner edge, strong = elevation, one accent. On a phone the title uses the full width.
 * @req FR:pr-page/card.color @req FR:pr-page/card.color.phone
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mockApi } from './mock';

const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const U = (n: number) => `https://github.com/Xerilium/stack/pull/${n}`;
const row = (n: number, o: Record<string, unknown>) => ({
  url: U(n), repo: 'Xerilium/stack', number: n, title: `A long pull request title that wraps when the tools column eats the width ${n}`, author: 'me', mine: true, project: 'xerilium', group: 'waiting', draft: false,
  createdAt: ago(30), updatedAt: ago(1), ci: 'passing', unresolved: 0, labels: [], state: { owner: 'me', blocker: '', link: '', stalled: false, source: 'rule' }, healthy: true, agent: false, after: [], rank: null, pinned: false, autopilot: false,
  nextAction: null, specLines: null, detail: {}, ...o,
});
const BOARD = () => ({
  at: new Date().toISOString(), user: 'me', agents: { count: 0, source: 'sessions' }, counts: { waiting: 4, processing: 0, pending: 0, paused: 0 }, footer: { running: 0, waiting: 4, parked: 0 }, queue: true,
  rows: [
    row(1, { autopilot: true, labels: ['Status: 🤖 Autopilot'], nextAction: 'signoff' }),
    row(2, { nextAction: 'autopilot' }),
    row(3, { mine: false, author: 'roland', nextAction: 'approve' }),
    row(4, { mine: false, author: 'roland' }),
  ],
});

async function open(page: Page) {
  await mockApi(page);
  await page.route('**/api/prs**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(BOARD()) }));
  await page.goto('/#/prs');
  const pg = page.getByTestId('prs-page');
  await pg.getByRole('tab', { name: /Waiting on me/ }).click();
  await expect(pg.locator('.pr-card')).toHaveCount(4);
  return pg;
}

for (const scheme of ['light', 'dark'] as const) {
  test(`${scheme}: every card has the panel background and a 3 px muted edge; strong is elevation only`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const pg = await open(page);
    const looks = await pg.locator('.pr-card').evaluateAll((els) => {
      const probe = document.createElement('span');
      probe.style.color = 'var(--panel)';
      document.body.appendChild(probe);
      const panel = getComputedStyle(probe).color;
      probe.remove();
      return els.map((e) => {
        const cs = getComputedStyle(e);
        return { bg: cs.backgroundColor, panel, edge: cs.borderLeftWidth, top: cs.borderTopWidth, shadow: cs.boxShadow !== 'none', strong: e.classList.contains('strong'), edgeColor: cs.borderLeftColor };
      });
    });
    for (const l of looks) {
      expect(l.bg).toBe(l.panel);
      expect(l.edge).toBe('3px');
      expect(l.top).toBe('1px');
      expect(l.shadow).toBe(l.strong);
      expect(l.edgeColor).not.toBe('rgb(15, 108, 189)'); // the old second brand blue
    }
    expect(new Set(looks.map((l) => l.edgeColor)).size).toBe(3); // three owner kinds still tell apart
    const axe = await new AxeBuilder({ page }).include('[data-testid="prs-page"]').withRules(['color-contrast']).analyze();
    expect(axe.violations).toEqual([]);
  });
}

test('at 375 px the title uses at least 85% of the card width; Pin sits in the top row', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'phone layout');
  const pg = await open(page);
  const c = pg.locator('.pr-card[data-number="3"]');
  const card = (await c.boundingBox())!;
  const title = (await c.locator('.ui-card-title').boundingBox())!;
  expect(title.width / card.width).toBeGreaterThanOrEqual(0.85);
  const pin = (await c.getByRole('button', { name: /^Pin / }).boundingBox())!;
  const top = (await c.locator('.ui-card-top').boundingBox())!;
  expect(pin.y).toBeLessThan(top.y + top.height);
  expect(pin.y + pin.height).toBeGreaterThan(top.y);
});
