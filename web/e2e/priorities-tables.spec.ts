/** Now: the owner's priorities report as tabs (QM, Now, PRs, Today, Next 3 days) in place of Waiting on you. */
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mockApi, seed } from './mock';

const at = () => { const d = new Date(); d.setHours(11, 0, 0, 0); return d; };
const iso = (minsAgo = 0) => new Date(at().getTime() - minsAgo * 60_000).toISOString();
const S = (id: string, name: string) => ({ name, link: `claude://claude.ai/epitaxy/${id}` });
const row = (id: string, project: string, o: Record<string, unknown> = {}) => ({ id, project, agent: null, status: null, action: 'No tiered task in tasks/', gap: true, ref: null, at: iso(), stale: false, ...o });
const task = (id: string, project: string, action: string, o: Record<string, unknown> = {}) => row(id, project, { action, gap: false, ref: `tasks/${id}.md:4`, ...o });
const pr = (n: number, emoji: string, action: string, minutes: number, o: Record<string, unknown> = {}) => ({ emoji, number: n, url: `https://github.com/allytehq/finops-hubs/pull/${n}`, agent: null, action, minutes, server: null, details: null, ...o });
const view = () => ({
  at: iso(),
  qm: { title: 'QM', today: true, at: iso(), stale: false, rows: [
    task('qm', 'Catalyst', 'Approve the QM 5: 251, 244, 245, 243, 298'),
    task('qm', 'Stack', '3 PM final calls on plan PR 119', { agent: { name: 'qm-planner', link: null }, status: 'idle' }),
  ] },
  now: { at: iso(), stale: false, rows: [
    task('adhoc', 'Ad hoc', 'File the weekly unemployment claim'),
    task('fh', 'FH Premium', 'Live-validate 430 on the dev hub', { agent: S('s1', 'FH backend'), status: 'working' }),
    row('fh11', 'FH 0.11'),
  ] },
  prs: { at: iso(), stale: false, verified: true, manager: S('sm', 'Sweep Manager') as { name: string; link: string } | null, rows: [
    pr(1142, '🏦', 'Autopilot: promote', 5, { agent: S('s1', 'FH backend') }),
    pr(439, '🏦', 'Live: validate', 15, { server: 'https://dev.example.test', details: 'https://github.com/allytehq/finops-hubs/pull/439#issuecomment-1' }),
  ] },
  today: { at: iso(40), stale: true, rows: [
    task('focus', 'FOCUS', 'work with FOCUS CoS + 2 more', { agent: S('s2', 'focus-cos'), status: 'pairing', at: iso(40), stale: true }),
    task('ftk', 'FTK 16', '⏳ Brett re-review on 2248', { agent: { name: 'ftk-rm', link: null }, status: 'unknown' }),
  ] },
  next: { at: iso(), stale: false, rows: [] as unknown[] },
});

const open = async (page: import('@playwright/test').Page, v = view(), hash = '#/now') => {
  await page.clock.setFixedTime(at());
  const m = await mockApi(page, { tasks: seed() });
  m.priorities = v;
  await page.goto(`/${hash}`);
  await expect(page.getByTestId('pri-tables')).toBeVisible();
  return m;
};
const shot = async (page: import('@playwright/test').Page, name: string) => {
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 1400 });
  await page.getByTestId('pri-tables').screenshot({ path: `e2e/screenshots/priorities-report-${name}.png` });
};

test.describe('Priorities report', () => {
  // @req FR:ux-consolidation/one.messages @req FR:priorities-tables/web.place @req FR:priorities-tables/web.tabs @req FR:priorities-tables/web.tabs.count @req FR:priorities-tables/web.tabs.default @req FR:priorities-tables/web.tabs.head @req FR:priorities-tables/web.table @req FR:priorities-tables/web.table.gap @req FR:priorities-tables/web.links @req FR:priorities-tables/web.links.none
  test('shows the sections as tabs with real-row counts; QM first on QM days; one table at a time', async ({ page }) => {
    await open(page);
    const tabs = page.getByRole('tab');
    await expect(tabs).toHaveText(['QM (2)', 'Now (2)', 'PRs (2)', 'Today (2)', 'Next 3 days (0)']);
    await expect(page.getByRole('tab', { name: 'QM (2)' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('pri-tables').locator('table')).toHaveCount(1);
    await page.getByRole('tab', { name: /^Now/ }).click();
    const now = page.getByTestId('pri-now');
    await expect(now.getByText('as of 11:00 AM')).toBeVisible();
    await expect(now.getByRole('columnheader')).toHaveText(['Project', 'Agent', '🤖 Status', '👱‍♂️ Next action']);
    await expect(now.locator('tbody tr')).toHaveCount(3);
    const fh = now.locator('tbody tr').nth(1);
    await expect(fh.locator('td')).toHaveText(['FH Premium', 'FH backend', '🔄 Working', 'Live-validate 430 on the dev hub']);
    await expect(fh.getByRole('link', { name: 'FH backend' })).toHaveAttribute('href', 'claude://claude.ai/epitaxy/s1');
    const gap = now.locator('tbody tr').nth(2);
    await expect(gap.locator('td')).toHaveText(['FH 0.11', '--', '--', 'Gap: No tiered task in tasks/']);
    expect(await gap.getByRole('link').count()).toBe(0);
    await expect(page.getByText('Waiting on you')).toHaveCount(0);
    await expect(page.getByRole('navigation').getByText(/priorit/i)).toHaveCount(0);
  });

  // @req FR:priorities-tables/web.tabs.default
  test('opens Now when QM is not a priority today', async ({ page }) => {
    const v = view(); v.qm.today = false;
    await open(page, v);
    await expect(page.getByRole('tab', { name: /^Now/ })).toHaveAttribute('aria-selected', 'true');
  });

  // @req FR:priorities-tables/web.tabs.hash @req FR:priorities-tables/web.tabs.keys @req NFR:priorities-tables/a11y.keys
  test('keeps the tab in the hash and moves by keyboard', async ({ page }, info) => {
    await open(page, view(), '#/now?pri=prs');
    await expect(page.getByRole('tab', { name: /^PRs/ })).toHaveAttribute('aria-selected', 'true');
    test.skip(info.project.name === 'mobile', 'keyboard');
    await page.getByRole('tab', { name: /^PRs/ }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('tab', { name: /^Today/ })).toBeFocused();
    await expect(page.getByRole('tab', { name: /^Today/ })).toHaveAttribute('aria-selected', 'true');
    expect(await page.evaluate(() => location.hash)).toBe('#/now?pri=today');
    await page.keyboard.press('End');
    await expect(page.getByRole('tab', { name: /^Next 3 days/ })).toBeFocused();
    await page.keyboard.press('Home');
    await expect(page.getByRole('tab', { name: /^QM/ })).toBeFocused();
    expect(await page.getByRole('tab', { name: /^QM/ }).evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
    await page.reload();
    await expect(page.getByRole('tab', { name: /^QM/ })).toHaveAttribute('aria-selected', 'true');
  });

  // @req FR:priorities-tables/web.table.line @req FR:priorities-tables/web.table.detail
  test('shows one line per cell and the full row on tap', async ({ page }) => {
    const v = view();
    v.now.rows[0] = task('adhoc', 'Ad hoc', 'File the weekly unemployment claim and then answer the two open follow-up emails from the state office about the October claim dates');
    await open(page, v, '#/now?pri=now');
    const cell = page.getByTestId('pri-now').locator('tbody tr').first().locator('.pri-c-action');
    const one = (await cell.boundingBox())!.height;
    const more = cell.getByRole('button');
    await expect(more).toHaveAttribute('aria-expanded', 'false');
    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'true');
    expect((await cell.boundingBox())!.height).toBeGreaterThan(one + 8);
    await more.click();
    await expect(more).toHaveAttribute('aria-expanded', 'false');
  });

  // @req FR:priorities-tables/pr.cols.live @req FR:priorities-tables/pr.manager @req FR:priorities-tables/web.table
  test('PRs: one table, quickest first, live links and the Sweep Manager', async ({ page }) => {
    await open(page, view(), '#/now?pri=prs');
    const prs = page.getByTestId('pri-prs');
    await expect(prs.getByRole('columnheader')).toHaveText(['PR', 'Agent', '👱‍♂️ Next action', 'Time']);
    await expect(prs.locator('tbody tr').first().locator('td')).toHaveText(['🏦 1142', 'FH backend', 'Autopilot: promote', '5m']);
    await expect(prs.getByRole('link', { name: '1142' })).toHaveAttribute('href', 'https://github.com/allytehq/finops-hubs/pull/1142');
    await expect(prs.locator('tbody tr').nth(1).locator('.pri-c-action')).toHaveText('Live: server, details');
    await expect(prs.getByRole('link', { name: 'server' })).toHaveAttribute('href', 'https://dev.example.test');
    await expect(prs.getByRole('link', { name: 'Sweep Manager' })).toHaveAttribute('href', 'claude://claude.ai/epitaxy/sm');
  });

  // @req FR:priorities-tables/pr.live.none @req FR:priorities-tables/web.table.empty
  test('says Not verified live with no good poll, and Nothing here when empty', async ({ page }) => {
    const v = view(); v.prs = { at: iso(), stale: true, verified: false, manager: null, rows: [] };
    await open(page, v, '#/now?pri=prs');
    await expect(page.getByTestId('pri-prs').locator('tbody tr')).toHaveText(['Not verified live']);
    await page.getByRole('tab', { name: /^Next 3 days/ }).click();
    await expect(page.getByTestId('pri-next').locator('tbody tr')).toHaveText(['Nothing here']);
    await page.getByRole('tab', { name: /^Today/ }).click();
    await expect(page.getByTestId('pri-today').locator('tbody tr').first().locator('td').first()).toHaveText('FOCUS stale');
    await expect(page.getByTestId('pri-today').getByText('as of 10:20 AM, stale')).toBeVisible();
  });

  // @req NFR:priorities-tables/a11y.target @req NFR:priorities-tables/a11y.mobile
  test('has 44 px tabs and toggles on touch, and fits the width', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'touch');
    await open(page, view(), '#/now?pri=now');
    for (const t of await page.getByRole('tab').all()) expect((await t.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    const cells = page.getByTestId('pri-now').locator('tbody tr').nth(1).locator('td');
    const top = async (i: number) => (await cells.nth(i).boundingBox())!.y;
    const [project, agent, status, action] = [await top(0), await top(1), await top(2), await top(3)];
    expect(Math.abs(project - status)).toBeLessThan(4);
    expect(action).toBeGreaterThan(project + 4);
    expect(agent).toBeGreaterThan(action + 4);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });

  for (const scheme of ['light', 'dark'] as const) {
    // @req NFR:priorities-tables/a11y.axe @req NFR:priorities-tables/a11y.tokens
    test(`has no axe violations on any tab (${scheme})`, async ({ page }, info) => {
      await page.emulateMedia({ colorScheme: scheme });
      await open(page);
      for (const k of ['qm', 'now', 'prs', 'today', 'next']) {
        await page.getByTestId(`pri-tab-${k}`).click();
        await expect(page.getByTestId(`pri-${k}`)).toBeVisible();
        expect((await new AxeBuilder({ page }).include('[data-testid="pri-tables"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        if (scheme === 'light' || k === 'now') await shot(page, `${k}-${scheme}-${info.project.name}`);
      }
    });
  }

  // @req FR:priorities-tables/web.live
  test('reads the report again every 60 s', async ({ page }) => {
    await page.clock.install({ time: at() });
    const m = await mockApi(page, { tasks: seed() });
    m.priorities = view();
    await page.goto('/#/now?pri=now');
    await expect(page.getByTestId('pri-now').locator('tbody tr')).toHaveCount(3);
    const v = view(); v.now.rows = v.now.rows.slice(0, 1); m.priorities = v;
    await page.clock.runFor(61_000);
    await expect(page.getByTestId('pri-now').locator('tbody tr')).toHaveCount(1);
    await expect(page.getByRole('tab', { name: /^Now/ })).toHaveText('Now (1)');
  });

  // @req FR:priorities-tables/web.live.absent
  test('hides the report on a host with no priority store', async ({ page }) => {
    await page.clock.setFixedTime(at());
    await mockApi(page, { tasks: seed() });
    await page.goto('/#/now');
    await expect(page.getByTestId('now-focus')).toBeVisible();
    await expect(page.getByTestId('pri-tables')).toHaveCount(0);
  });
});
