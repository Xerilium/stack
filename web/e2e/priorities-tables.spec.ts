/** Now: the owner's priorities report (QM, Now, PRs, Today, Next 3 days) in place of Waiting on you. */
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
  qm: { title: 'QM', at: iso(), stale: false, rows: [
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
  next: { at: iso(), stale: false, rows: [] },
});

test.describe('Priorities report', () => {
  // @req FR:ux-consolidation/one.messages @req FR:priorities-tables/web.place @req FR:priorities-tables/web.sections @req FR:priorities-tables/web.sections.cols @req FR:priorities-tables/web.sections.head @req FR:priorities-tables/web.sections.gap @req FR:priorities-tables/web.sections.empty @req FR:priorities-tables/web.links @req FR:priorities-tables/pr.cols.live @req FR:priorities-tables/pr.manager
  test('shows QM, Now, PRs, Today, Next 3 days, each a rule, an h2 with a stamp, and a table', async ({ page }, info) => {
    await page.clock.setFixedTime(at());
    const m = await mockApi(page, { tasks: seed() });
    m.priorities = view();
    await page.goto('/#/now');
    const box = page.getByTestId('pri-tables');
    await expect(box.locator('table')).toHaveCount(5);
    await expect(box.locator('h2')).toHaveText([/^QM\s*as of 11:00 AM$/, /^Now\s*as of 11:00 AM$/, /^PRs\s*as of 11:00 AM$/, /^Today\s*as of 10:20 AM, stale$/, /^Next 3 days\s*as of 11:00 AM$/]);
    await expect(box.locator('hr')).toHaveCount(5);
    for (const k of ['qm', 'now', 'today', 'next']) await expect(page.getByTestId(`pri-${k}`).getByRole('columnheader')).toHaveText(['Project', 'Agent', '🤖 Status', '👱‍♂️ Next action']);
    await expect(page.getByTestId('pri-prs').getByRole('columnheader')).toHaveText(['PR', 'Agent', '👱‍♂️ Next action', 'Time']);
    const now = page.getByTestId('pri-now');
    await expect(now.locator('tbody tr')).toHaveCount(3);
    const fh = now.locator('tbody tr').nth(1);
    await expect(fh.getByRole('cell')).toHaveText(['FH Premium', 'FH backend', '🔄 Working', 'Live-validate 430 on the dev hub']);
    await expect(fh.getByRole('link', { name: 'FH backend' })).toHaveAttribute('href', 'claude://claude.ai/epitaxy/s1');
    // a gap is explicit, -- is plain text
    const gap = now.locator('tbody tr').nth(2);
    await expect(gap.locator('td')).toHaveText(['FH 0.11', '--', '--', 'Gap: No tiered task in tasks/']);
    expect(await gap.getByRole('link').count()).toBe(0);
    // an agent with no session is plain text
    await expect(page.getByTestId('pri-qm').locator('tbody tr').nth(1).getByRole('cell').nth(1)).toHaveText('qm-planner');
    expect(await page.getByTestId('pri-qm').locator('tbody tr').nth(1).getByRole('link').count()).toBe(0);
    // one PR table, quickest first
    const prs = page.getByTestId('pri-prs');
    await expect(prs.locator('tbody tr').first().getByRole('cell')).toHaveText(['🏦 1142', 'FH backend', 'Autopilot: promote', '5m']);
    await expect(prs.getByRole('link', { name: '1142' })).toHaveAttribute('href', 'https://github.com/allytehq/finops-hubs/pull/1142');
    // live rows link the server and the details; the Sweep Manager is above the table
    await expect(prs.locator('tbody tr').nth(1).locator('.pri-c-action')).toHaveText('Live: server, details');
    await expect(prs.getByRole('link', { name: 'server' })).toHaveAttribute('href', 'https://dev.example.test');
    await expect(prs.getByRole('link', { name: 'Sweep Manager' })).toHaveAttribute('href', 'claude://claude.ai/epitaxy/sm');
    // a stale row says so; an empty section has one row
    await expect(page.getByTestId('pri-today').locator('tbody tr').first().getByRole('cell').first()).toHaveText('FOCUS stale');
    await expect(page.getByTestId('pri-next').locator('tbody tr')).toHaveText(['Nothing here']);
    // in place of Waiting on you; no new nav item
    await expect(page.getByText('Waiting on you')).toHaveCount(0);
    await expect(page.getByRole('navigation').getByText(/priorit/i)).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.setViewportSize({ width: page.viewportSize()!.width, height: 2400 });
    await box.screenshot({ path: `e2e/screenshots/priorities-report-${info.project.name}.png` });
  });

  // @req FR:priorities-tables/pr.live.none
  test('says Not verified live when the board has no good poll', async ({ page }) => {
    await page.clock.setFixedTime(at());
    const m = await mockApi(page, { tasks: seed() });
    const v = view(); v.prs = { at: iso(), stale: true, verified: false, manager: null, rows: [] }; m.priorities = v;
    await page.goto('/#/now');
    await expect(page.getByTestId('pri-prs').locator('tbody tr')).toHaveText(['Not verified live']);
  });

  for (const scheme of ['light', 'dark'] as const) {
    // @req NFR:priorities-tables/a11y.axe @req NFR:priorities-tables/a11y.tokens @req NFR:priorities-tables/a11y.mobile
    test(`has no axe violations and fits the width (${scheme})`, async ({ page }, info) => {
      await page.emulateMedia({ colorScheme: scheme });
      await page.clock.setFixedTime(at());
      const m = await mockApi(page, { tasks: seed() });
      m.priorities = view();
      await page.goto('/#/now');
      const box = page.getByTestId('pri-tables');
      await expect(box.locator('table')).toHaveCount(5);
      expect((await new AxeBuilder({ page }).include('[data-testid="pri-tables"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations).toEqual([]);
      expect(await box.evaluate((el) => getComputedStyle(el).getPropertyValue('--fl-fg2').trim().length > 0)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      if (info.project.name === 'mobile') {
        // Each row is a block: project and status on line 1, the action on line 2, the agent on line 3.
        const cells = page.getByTestId('pri-now').locator('tbody tr').nth(1).getByRole('cell');
        const top = async (i: number) => (await cells.nth(i).boundingBox())!.y;
        const [project, agent, status, action] = [await top(0), await top(1), await top(2), await top(3)];
        expect(Math.abs(project - status)).toBeLessThan(4);
        expect(action).toBeGreaterThan(project + 4);
        expect(agent).toBeGreaterThan(action + 4);
      }
      await page.setViewportSize({ width: page.viewportSize()!.width, height: 2400 });
      await box.screenshot({ path: `e2e/screenshots/priorities-report-${scheme}-${info.project.name}.png` });
    });
  }

  // @req NFR:priorities-tables/a11y.keys
  test('every link takes keyboard focus with a visible ring', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'keyboard');
    await page.clock.setFixedTime(at());
    const m = await mockApi(page, { tasks: seed() });
    m.priorities = view();
    await page.goto('/#/now');
    const link = page.getByTestId('pri-now').getByRole('link', { name: 'FH backend' });
    await link.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    await expect(link).toBeFocused();
    expect(await link.evaluate((el) => getComputedStyle(el).outlineStyle)).not.toBe('none');
  });

  // @req FR:priorities-tables/web.live
  test('reads the report again every 60 s', async ({ page }) => {
    await page.clock.install({ time: at() });
    const m = await mockApi(page, { tasks: seed() });
    m.priorities = view();
    await page.goto('/#/now');
    await expect(page.getByTestId('pri-now').locator('tbody tr')).toHaveCount(3);
    const v = view(); v.now.rows = v.now.rows.slice(0, 1); m.priorities = v;
    await page.clock.runFor(61_000);
    await expect(page.getByTestId('pri-now').locator('tbody tr')).toHaveCount(1);
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
