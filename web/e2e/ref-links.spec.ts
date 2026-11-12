/** PR and issue refs in task text link to GitHub through the project repo; unresolved refs stay text. */
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mockApi, seed } from './mock';

const projects: { name: string; title: string; metadata: Record<string, string> }[] = [
  { name: 'alpha', title: 'Alpha', metadata: { Repository: 'https://github.com/Xerilium/stack' } },
  { name: 'beta', title: 'Beta', metadata: {} },
];

test.describe('ref links', () => {
  // @req FR:product-reset/ui.reflink @req FR:product-reset/schema.refs
  test('every ref in the Now title links to GitHub in a new tab; an unresolved ref stays text', async ({ page }) => {
    const d = new Date(); d.setHours(10, 0, 0, 0); await page.clock.setFixedTime(d);
    const tasks = seed();
    tasks[0] = { ...tasks[0], text: tasks[0].text.replace('Ship the **web app**', 'Ship #12 and PR 34 after allytehq/f4-music#97') };
    tasks.push({ ref: 'beta:9', text: '‼️ Check #55', project: 'beta', section: '🔄 Active', done: false, depth: 0, notes: [] });
    const m = await mockApi(page, { tasks, projects });
    m.asks = [{ key: 'q1', state: 'open', ask: 'Merge PR#77 today', kind: 'approve', from: 'cos', project: 'alpha', reversible: true, priority: 'normal', blocks: 0, created: '2026-11-05T09:00:00Z', updated: '2026-11-05T09:00:00Z', score: 50, overdue: false }];
    await page.goto('/#/now');
    const h1 = page.getByRole('heading', { level: 1 });
    await expect(h1.getByRole('link', { name: '#12' })).toHaveAttribute('href', 'https://github.com/Xerilium/stack/issues/12');
    await expect(h1.getByRole('link', { name: 'PR 34' })).toHaveAttribute('href', 'https://github.com/Xerilium/stack/pull/34');
    await expect(h1.getByRole('link', { name: 'f4-music#97' })).toHaveAttribute('href', 'https://github.com/allytehq/f4-music/issues/97');
    for (const a of await h1.getByRole('link').all()) { await expect(a).toHaveAttribute('target', '_blank'); await expect(a).toHaveAttribute('rel', /noopener/); }
    expect((await new AxeBuilder({ page }).include('[data-testid="now"]').analyze()).violations).toEqual([]);
    // Needs you: refs in the ask link too
    await page.goto('/#/asks');
    await expect(page.locator('.ask-title').getByRole('link', { name: 'PR#77' })).toHaveAttribute('href', 'https://github.com/Xerilium/stack/pull/77');
    // beta has no repo: #55 stays text
    await page.goto('/#/list?project=beta');
    const row = page.locator('.row', { hasText: 'Check #55' });
    await expect(row).toBeVisible();
    await expect(row.getByRole('link', { name: '#55' })).toHaveCount(0);
  });
});
