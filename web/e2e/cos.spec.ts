/** Chief of Staff view: the CoS brief, then compact summaries drawn by the shared components, at 375 and 1280. */
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mockApi, seed, type Mock, type MockAsk } from './mock';

const NOW = new Date('2026-11-12T10:00:00-08:00');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const ask = (key: string, extra: Partial<MockAsk> = {}): MockAsk => ({ key, state: 'open', ask: `Ask ${key}`, kind: 'approve', from: 'cos', reversible: true, priority: 'normal', blocks: 0, created: ago(60), updated: ago(60), score: 10, overdue: false, recommend: 'Approve', ...extra });
const noScrollX = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const axe = async (page: Page) => (await new AxeBuilder({ page }).include('[data-testid="cos"]').withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']).analyze()).violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`);
const tall = async (page: Page, scope: string) => {
  for (const el of await page.locator(`${scope} button:visible, ${scope} a:visible, ${scope} input:visible, ${scope} textarea:visible, ${scope} select:visible`).all()) expect((await el.boundingBox())!.height, await el.evaluate((e) => e.outerHTML.slice(0, 80))).toBeGreaterThanOrEqual(44);
};
const pr = (n: number, title: string) => ({ repo: 'Xerilium/stack', number: n, url: `https://github.com/Xerilium/stack/pull/${n}`, title, blocker: 'Pick the label name', project: 'xerilium' });

async function setup(page: Page, o: { report?: boolean; staleH?: number } = {}): Promise<Mock> {
  await page.clock.install({ time: NOW });
  const m = await mockApi(page, { tasks: seed() });
  m.team = [{ slug: 'cos', name: 'Roland', scope: ['*'], mode: 'long-running', prompt: '', defined: true, source: 'stack', projects: ['alpha', 'beta'], icon: '🧭' } as never];
  m.reports = o.report === false ? [] : [{ agent: 'cos', project: 'all', at: ago((o.staleH ?? 0.2) * 60), top: [{ text: 'Ship CoS view', link: 'https://github.com/Xerilium/stack/pull/160' }, { text: 'Clear FH queue' }], asks: [], blockers: [{ text: 'Waiting on CI runner' }], progress: [{ text: 'Spec merged' }] }];
  m.asks = [ask('a1', { ask: 'Approve the FH release plan' })];
  m.pris = { version: 1, rev: 2, pris: [{ id: 'quota', title: 'Quota-maxxing', status: 'active', items: [{ text: 'Stack v2', status: 'doing' }], backlog: [], weekly: [], statusAt: ago(60) } as never, { id: 'allyte', title: 'Allyte marketplace', status: 'active', items: [], backlog: [], weekly: [] }] };
  m.inventory = { at: NOW.toISOString(), total: 3, counts: { running: 2, waiting: 1 }, needsYou: [{ id: 's1', title: 'FH sweep', project: 'allyte', state: 'waiting', reason: 'question', pinned: false, lastActivityAt: ago(5), link: 'claude://claude.ai/epitaxy/s1', prs: [] }], archive: [], sessions: [] };
  m.prs = { at: NOW.toISOString(), user: 'me', agents: { count: 2, source: 'sessions' }, counts: { blocked: 1, waiting: 0, processing: 1, pending: 0, paused: 0 }, footer: { running: 0, waiting: 0, parked: 0 }, queue: true,
    rows: [{ url: 'https://github.com/Xerilium/stack/pull/150', repo: 'Xerilium/stack', number: 150, title: 'Fix it', author: 'me', project: 'xerilium', group: 'blocked', draft: false, createdAt: ago(600), updatedAt: ago(60), ci: 'passing', unresolved: 1, labels: [], state: { owner: 'me', blocker: 'Answer the thread', link: 'https://github.com/Xerilium/stack/pull/150', stalled: false, source: 'rule' }, healthy: false, agent: false, after: [], rank: 1, pinned: false, autopilot: false }],
    escalations: { blocked: [pr(150, 'Fix it')], enable: [], live: [] } };
  return m;
}

test.describe('Chief of Staff view', () => {
  // @req FR:cos-base-of-ops/route.nav @req FR:cos-base-of-ops/state.age @req FR:cos-base-of-ops/state.line @req FR:cos-base-of-ops/brief.top @req FR:cos-base-of-ops/brief.blockers @req FR:cos-base-of-ops/brief.progress
  // @req FR:cos-base-of-ops/compose.decisions @req FR:cos-base-of-ops/compose.pris @req FR:cos-base-of-ops/compose.prs @req FR:cos-base-of-ops/compose.team @req FR:cos-base-of-ops/layout.grid @req FR:cos-base-of-ops/layout.look
  test('the brief, the state line, and the composed sections', async ({ page }, info) => {
    const m = await setup(page);
    await page.goto('/#/cos');
    const v = page.getByTestId('cos');
    await expect(v.getByRole('heading', { level: 1 })).toHaveText('Roland');
    await expect(v.getByTestId('cos-age')).toHaveText('Last report 12m ago');
    await expect(v.getByTestId('cos-line')).toHaveText('1 need you, 1 blocked, 2 moving');
    await expect(v.getByTestId('cos-top').getByRole('link', { name: 'Ship CoS view' })).toHaveAttribute('href', 'https://github.com/Xerilium/stack/pull/160');
    await expect(v.getByTestId('cos-blockers')).toContainText('Waiting on CI runner');
    await expect(v.getByTestId('cos-progress')).toContainText('Spec merged');
    // Decisions: the Now ask cards (shared component), answered the same way
    await v.getByTestId('now-asks').getByRole('button', { name: 'Approve', exact: true }).click();
    await expect.poll(() => m.calls.find((c) => c.path === '/asks/a1/answer')?.body?.answer).toBe('go');
    // Priorities: the Needs you block, with age and the stale flag
    await expect(v.getByTestId('pris')).toContainText('Quota-maxxing');
    await expect(v.getByTestId('pris')).toContainText('Updated 1h ago');
    await expect(v.getByTestId('pris')).toContainText('No status');
    // Agents: the Needs you sessions block
    await expect(v.getByText('FH sweep')).toBeVisible();
    // PRs: counts and the escalation link open the PR flyout on its tab
    const prs = v.getByTestId('cos-prs');
    await expect(prs.getByRole('link', { name: 'Blocked on me: 1' })).toHaveAttribute('href', '#/prs?tab=blocked');
    await expect(prs).toContainText('Fix it');
    expect(await noScrollX(page)).toBe(true);
    expect(await axe(page)).toEqual([]);
    if (info.project.name === 'mobile') await tall(page, '[data-testid="cos-head"]');
    await prs.getByRole('link', { name: 'Blocked on me: 1' }).click();
    await expect(page.getByTestId('prs-flyout')).toBeVisible();
    await expect(page.getByTestId('prs-flyout').getByRole('tab', { selected: true })).toContainText('Blocked on me');
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('prs-flyout')).toHaveCount(0);
    await expect(page).toHaveURL(/#\/cos$/);
    await expect(v).toBeVisible();
  });

  // @req FR:cos-base-of-ops/msg.box @req FR:cos-base-of-ops/msg.send @req FR:cos-base-of-ops/msg.anchor
  test('Message the CoS sends an inbox instruction on the CoS row', async ({ page }) => {
    const m = await setup(page);
    await page.goto('/#/cos');
    const box = page.getByRole('textbox', { name: 'Message the CoS' });
    await box.fill('Push FH 0.11 first');
    await box.press('Enter');
    await expect.poll(() => m.calls.find((c) => c.path === '/inbox')?.body).toMatchObject({ ref: 'alpha:6', text: 'Push FH 0.11 first', kind: 'instruction' });
    await expect(box).toHaveValue('');
    await expect(page.getByText('Sent to Roland')).toBeVisible();
  });

  // @req FR:cos-base-of-ops/state.stale @req FR:cos-base-of-ops/msg.ask @req FR:cos-base-of-ops/state.line
  test('no report: says so, offers Ask for a report, never shows a fake zero', async ({ page }) => {
    const m = await setup(page, { report: false });
    await page.goto('/#/cos');
    const v = page.getByTestId('cos');
    await expect(v.getByTestId('cos-age')).toHaveText('CoS has not reported yet');
    await expect(v.getByTestId('cos-line')).toHaveText('1 need you, 2 moving');
    await expect(v.getByTestId('cos-blockers')).toHaveCount(0);
    await v.getByRole('button', { name: 'Ask for a report' }).click();
    await expect.poll(() => m.calls.find((c) => c.path === '/inbox')?.body).toMatchObject({ kind: 'instruction', text: 'Send your status report now (docs/cos-reporting.md).' });
    expect(await axe(page)).toEqual([]);
  });

  // @req FR:cos-base-of-ops/state.stale
  test('a report older than 24 h shows since when, and stays visible under it', async ({ page }) => {
    await setup(page, { staleH: 30 });
    await page.goto('/#/cos');
    const v = page.getByTestId('cos');
    await expect(v.getByTestId('cos-age')).toHaveText(/^CoS has not reported since Wed, Nov 11, 4:00\s?AM$/);
    await expect(v.getByRole('button', { name: 'Ask for a report' })).toBeVisible();
    await expect(v.getByTestId('cos-top')).toContainText('Ship CoS view');
  });

  // @req FR:cos-base-of-ops/state.off
  test('sources absent on this host say so in one line', async ({ page }) => {
    const m = await setup(page);
    m.prs = undefined; m.pris = null; m.reports = null;
    await page.goto('/#/cos');
    const v = page.getByTestId('cos');
    await expect(v.getByTestId('cos-prs')).toHaveText(/PR board is off on this host/);
    await expect(v.getByTestId('cos-pris-off')).toHaveText('No priorities store on this host');
    await expect(v.getByTestId('cos-age')).toHaveText('No report store on this host');
  });
});
