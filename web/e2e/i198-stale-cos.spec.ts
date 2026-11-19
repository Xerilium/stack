/**
 * CoS escalations more than 48 h past `by` leave the list and the badge for a collapsed Stale group.
 * @req FR:ask-queue/needs.web.stale
 */
import { expect, test, type Page } from '@playwright/test';
import { mockApi, type MockNeed } from './mock';

const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const need = (id: string, by?: string): MockNeed => ({ id, title: `Escalation ${id}`, recommendation: 'Go', link: `https://example.com/${id}`, ...(by ? { by } : {}) } as MockNeed);
const badge = (page: Page) => page.locator('[data-testid="nav-notifications"]:visible .badge');

async function setup(page: Page) {
  const m = await mockApi(page);
  m.needs = [
    ...Array.from({ length: 11 }, (_, i) => need(`old${i}`, ago(6 * 24))),
    need('recent', ago(24)),
    need('nodate'),
  ];
  await page.goto('/#/notifications');
  await expect(page.locator('.ask-card')).toBeVisible();
  return m;
}

test('stale items leave the main list and the badge; one collapsed group at the end', async ({ page }) => {
  await setup(page);
  await expect(badge(page)).toHaveText('2');
  const group = page.getByTestId('stale-group');
  const toggle = group.getByRole('button', { name: /^Stale · 11/ });
  await expect(toggle).toHaveText('Stale · 11 · CoS must re-verify');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('ol[aria-label="Asks, highest score first"] .ask-li')).toHaveCount(2);
  await expect(page.locator('ol[aria-label="Asks, highest score first"]')).toContainText('Escalation recent');
  await expect(page.locator('ol[aria-label="Asks, highest score first"]')).toContainText('Escalation nodate');
  await expect(group.locator('.ask-li')).toHaveCount(0);
});

test('opening the group lists the stale items with their actions unchanged', async ({ page }) => {
  const m = await setup(page);
  await page.getByTestId('stale-group').getByRole('button', { name: /^Stale · 11/ }).click();
  const list = page.getByRole('list', { name: 'Stale asks' });
  await expect(list.locator('.ask-li')).toHaveCount(11);
  await list.locator('.ask-li').first().click();
  const card = list.locator('.ask-card');
  await expect(card).toContainText('Escalation old0');
  await expect(card.getByRole('button', { name: /Reply/ })).toBeVisible();
  await card.locator('.btn.primary').click();
  await expect.poll(() => m.calls.find((c) => c.path === '/needs-you/old0/answer')?.body.choice).toBe('go');
  await expect(page.getByTestId('stale-group').getByRole('button', { name: /^Stale · 10/ })).toBeVisible();
  await expect(badge(page)).toHaveText('2'); // answering a stale item never touches the count
});
