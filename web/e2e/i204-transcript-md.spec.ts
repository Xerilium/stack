/** @req FR:agent-sessions/web.drawer.md */
import { expect, test } from '@playwright/test';
import { mockApi } from './mock';

const iso = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();
const sid = 'a1b2c3d4-0000-0000-0000-000000000002';

// @req FR:agent-sessions/web.drawer.md
test('a transcript turn renders block markdown: bold heading, list, link, rule; no raw markers', async ({ page }) => {
  const m = await mockApi(page);
  m.sessions = [{ id: sid, title: 'stack: transcript', project: 'stack', owner: 'stack', cwd: '/x/stack', branch: 'main', lastActive: iso(5), state: 'idle', cost: { usd: 0.1, tokens: 1000 }, prs: [] }];
  m.sessionCost = { attribution: 'lastActive', days: [], projects: [], models: [], total: { usd: 0, tokens: 0, sessions: 0 } };
  m.sessionTurns[sid] = [
    { at: iso(9), role: 'user', text: 'Run the **sweep**' },
    { at: iso(8), role: 'assistant', text: '---\n## Running\n- a\n- b\n[PR 184](https://github.com/o/r/pull/184)\n```\npnpm test\n```' },
  ];
  await page.goto('/#/sessions');
  await page.locator('.sess-row').first().click();
  const d = page.getByRole('dialog');
  await expect(d.locator('.turns .tl')).toHaveCount(2);
  const a = d.locator('.turns .tl.assistant');
  await expect(a.locator('.md-h b')).toHaveText('Running');
  await expect(a.locator('ul > li')).toHaveText(['a', 'b']);
  await expect(a.getByRole('link', { name: 'PR 184' })).toHaveAttribute('href', 'https://github.com/o/r/pull/184');
  await expect(a.locator('hr')).toHaveCount(1);
  await expect(a.locator('pre code')).toHaveText('pnpm test');
  await expect(a.locator('h1, h2, h3')).toHaveCount(0);
  await expect(a).not.toContainText('##');
  await expect(d.locator('.turns .tl.user b')).toHaveText('sweep');
  await expect(d.locator('.turns .tl.user')).toHaveText('Run the sweep');
});
