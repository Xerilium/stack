/** Now: the owner's priorities report as tabs (QM, Now, PRs, Today, Next 3 days) of muted cards, in place of Waiting on you. */
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mockApi, seed } from './mock';

const at = () => { const d = new Date(); d.setHours(11, 0, 0, 0); return d; };
const iso = (minsAgo = 0) => new Date(at().getTime() - minsAgo * 60_000).toISOString();
const CLI = { s1: '11111111-1111-4111-8111-111111111111', cos: '22222222-2222-4222-8222-222222222222' } as Record<string, string>;
const S = (id: string, name: string) => ({ name, link: `claude://claude.ai/epitaxy/${id}`, file: null as string | null, session: CLI[id] ?? null });
const F = (name: string, file: string | null) => ({ name, link: null as string | null, file, session: null as string | null });
const GAP = 'Allyte CoS, today: add a 1️⃣/2️⃣/3️⃣ task in tasks/fh11.md with (agent: ...)';
const REQUEST = 'Priority "FH 0.11" has no tiered task. Add a 1️⃣/2️⃣/3️⃣ task in tasks/fh11.md with (agent: ...) today.';
const U = (n: number, repo = 'allytehq/finops-hubs') => `https://github.com/${repo}/issues/${n}`;
const row = (id: string, project: string, o: Record<string, unknown> = {}) => ({ id, project, file: `tasks/${id}.md` as string | null, agent: null as unknown, status: null as string | null, action: GAP, gap: true, cos: S('cos', 'Allyte CoS') as unknown, request: REQUEST as string | null, ref: null as string | null, at: iso(), stale: false, ...o });
const task = (id: string, project: string, action: string, o: Record<string, unknown> = {}) => row(id, project, { action, gap: false, cos: null, request: null, ref: `tasks/${id}.md:4`, ...o });
const pr = (n: number, emoji: string, action: string, minutes: number, o: Record<string, unknown> = {}) => ({ emoji, number: n, url: `https://github.com/allytehq/finops-hubs/pull/${n}`, agent: null as unknown, action, minutes, server: null as string | null, details: null as string | null, ...o });
const view = () => ({
  at: iso(),
  qm: { title: 'QM', today: true, at: iso(), stale: false, rows: [
    task('catalyst', 'Catalyst', `Approve the QM 5: [251](${U(251, 'Xerilium/catalyst')}), [244](${U(244, 'Xerilium/catalyst')})`),
    task('stack', 'Stack', `3 PM final calls on plan PR [119](${U(119, 'flanakin/todo')})`, { agent: F('qm-planner', '.claude/agents/qm-planner.md'), status: 'idle' }),
  ] },
  now: { at: iso(), stale: false, rows: [
    task('adhoc', 'Ad hoc', 'File the weekly unemployment claim'),
    task('allyte', 'FH Premium', `Live-validate PR [430](${U(430)}) on the dev hub`, { agent: S('s1', 'FH backend'), status: 'working' }),
    row('fh11', 'FH 0.11', { file: null }),
  ] },
  prs: { at: iso(), stale: false, verified: true, manager: S('sm', 'Sweep Manager') as unknown, rows: [
    pr(1142, '🏦', 'Autopilot: promote', 5, { agent: S('s1', 'FH backend') }),
    pr(439, '🏦', 'Live: validate', 15, { server: 'https://dev.example.test', details: 'https://github.com/allytehq/finops-hubs/pull/439#issuecomment-1' }),
  ] },
  today: { at: iso(40), stale: true, rows: [
    task('focus', 'FOCUS', `Publish [2826](${U(2826, 'FinOps-Open-Cost-and-Usage-Spec/FOCUS_Spec')}) + 2 more`, { agent: S('s2', 'focus-cos'), status: 'pairing', at: iso(40), stale: true }),
    task('ftk', 'FTK 16', '⏳ Brett re-review on 2248 ⚠ no link', { agent: F('ftk-rm', null), status: 'unknown' }),
  ] },
  next: { at: iso(), stale: false, rows: [] as unknown[] },
});
const open = async (page: Page, v = view(), hash = '#/now') => {
  await page.clock.setFixedTime(at());
  const m = await mockApi(page, { tasks: seed() });
  m.priorities = v;
  await page.goto(`/${hash}`);
  await expect(page.getByTestId('pri-tables')).toBeVisible();
  return m;
};
const cards = (page: Page, k: string) => page.getByTestId(`pri-${k}`).locator('li.ui-card');
const detail = (page: Page) => page.getByTestId('pri-detail');
const shot = async (page: Page, name: string) => {
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 1400 });
  await page.getByTestId('pri-tables').screenshot({ path: `e2e/screenshots/priorities-report-${name}.png` });
};
/** Narrow: the open detail hides the list; go back to it. */
const back = async (page: Page) => { const b = page.getByRole('button', { name: '‹ Back' }); if (await b.count()) await b.click(); };
/** Text outside links that still looks like a PR or issue ref. */
const bareRefs = (page: Page) => page.getByTestId('pri-tables').evaluate((el) => [...el.querySelectorAll('.ui-card-title, .ui-card-top, .pri-d')].flatMap((c) => {
  const x = c.cloneNode(true) as HTMLElement;
  x.querySelectorAll('a, .pri-nolink, .ui-card-open').forEach((a) => a.remove());
  return /#\d+|\b(PRs?|issues?) #?\d+\b/i.test(x.textContent ?? '') ? [x.textContent] : [];
}));

test.describe('Priorities report', () => {
  // @req FR:ux-consolidation/one.messages @req FR:priorities-tables/web.place @req FR:priorities-tables/web.tabs @req FR:priorities-tables/web.tabs.count @req FR:priorities-tables/web.tabs.default @req FR:priorities-tables/web.tabs.head @req FR:priorities-tables/web.table @req FR:priorities-tables/web.table.gap
  test('shows tabs with real-row counts; QM first on QM days; one list of cards at a time', async ({ page }) => {
    await open(page);
    await expect(page.getByRole('tab')).toHaveText(['QM (2)', 'Now (2)', 'PRs (2)', 'Today (2)', 'Next 3 days (0)']);
    await expect(page.getByRole('tab', { name: 'QM (2)' })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByTestId('pri-tables').locator('table')).toHaveCount(0);
    await expect(page.getByTestId('pri-tables').locator('ul.pri-cards')).toHaveCount(1);
    await page.getByRole('tab', { name: /^Now/ }).click();
    await expect(page.getByTestId('pri-stamp')).toHaveText('as of 11:00 AM');
    await expect(cards(page, 'now')).toHaveCount(3);
    const fh = cards(page, 'now').nth(1);
    await expect(fh.locator('.ui-card-top')).toHaveText('FH Premium');
    await expect(fh.locator('.ui-chip')).toContainText('Working');
    await expect(fh.locator('.ui-card-title')).toContainText('Live-validate PR 430 on the dev hub');
    await expect(fh.locator('.ui-card-sub')).toContainText('FH backend');
    await expect(cards(page, 'now').nth(2).locator('.ui-card-title')).toHaveText(GAP);
    await expect(page.getByText('Waiting on you')).toHaveCount(0);
    // The report adds no nav item; the one Priorities item is the Priorities page (FR:notifications/nav.rail).
    expect(await page.getByRole('navigation').getByText(/priorit/i).count()).toBeLessThanOrEqual(1);
  });

  // @req FR:priorities-tables/web.links @req FR:priorities-tables/web.links.project @req FR:priorities-tables/web.links.agent @req FR:priorities-tables/web.links.refs @req FR:priorities-tables/web.links.gap @req FR:priorities-tables/web.links.none
  test('links every project, agent and ref; marks a missing target; leaves no bare ref', async ({ page }) => {
    await open(page);
    for (const k of ['qm', 'now', 'prs', 'today', 'next']) {
      await page.getByTestId(`pri-tab-${k}`).click();
      expect(await bareRefs(page)).toEqual([]);
    }
    await page.getByTestId('pri-tab-now').click();
    const fh = cards(page, 'now').nth(1);
    // no project or agent link on the card; they live in the detail pane. @req FR:priorities-tables/web.card.project
    await expect(fh.locator('.ui-card-top')).toHaveText('FH Premium');
    expect(await fh.locator('.ui-card-top a').count()).toBe(0);
    expect(await fh.locator('.ui-card-sub a').count()).toBe(0);
    await expect(fh.getByRole('link', { name: '430' })).toHaveAttribute('href', U(430));
    const gap = cards(page, 'now').nth(2);
    await expect(gap.locator('.ui-card-top')).toHaveText('FH 0.11');
    expect(await gap.getByRole('link').count()).toBe(0);
    await gap.getByRole('button', { name: 'Details: FH 0.11' }).click();
    await expect(detail(page).getByRole('heading')).toHaveText('FH 0.11 ⚠ no link');
    await back(page);
    await fh.getByRole('button', { name: 'Details: FH Premium' }).click();
    await expect(detail(page).getByRole('link', { name: 'FH Premium' })).toHaveAttribute('href', '#/list?project=allyte');
    await expect(detail(page).getByRole('link', { name: 'FH backend' })).toHaveAttribute('href', 'claude://claude.ai/epitaxy/s1');
    await back(page);
    await page.getByTestId('pri-tab-qm').click();
    await cards(page, 'qm').nth(1).getByRole('button').click();
    await expect(detail(page).getByRole('link', { name: 'qm-planner' })).toHaveAttribute('href', '#/agents?file=.claude%2Fagents%2Fqm-planner.md');
    await page.getByTestId('pri-tab-today').click();
    await expect(cards(page, 'today').nth(1).locator('.ui-card-sub')).toHaveText('ftk-rm');
    await cards(page, 'today').nth(1).getByRole('button').click();
    await expect(detail(page)).toContainText('ftk-rm ⚠ no link');
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

  // @req FR:priorities-tables/web.table.line @req FR:priorities-tables/web.card.open @req FR:priorities-tables/web.detail @req FR:priorities-tables/web.status.chip @req FR:priorities-tables/web.card.agent @req FR:priorities-tables/web.kit
  test('one line per field; the whole card opens the detail pane', async ({ page }, info) => {
    const v = view();
    v.now.rows[0] = task('adhoc', 'Ad hoc', 'File the weekly unemployment claim and then answer the two open follow-up emails from the state office about the October claim dates and the missing form');
    await open(page, v, '#/now?pri=now');
    const card = cards(page, 'now').first();
    expect(await card.locator('.ui-card-title').evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
    await expect(card.getByRole('button')).toHaveText('›');
    await expect(cards(page, 'now').nth(1).locator('.ui-chip')).toHaveText('Working');
    await card.click({ position: { x: 40, y: 50 } });
    await expect(detail(page)).toContainText('the missing form');
    await expect(detail(page).getByRole('heading')).toHaveText('Ad hoc');
    if (info.project.name === 'mobile') {
      await expect(page.getByTestId('pri-now').locator('.ui-split-list')).toBeHidden();
      await page.getByRole('button', { name: '‹ Back' }).click();
      await expect(cards(page, 'now')).toHaveCount(3);
    } else {
      await expect(cards(page, 'now')).toHaveCount(3);
      await expect(card).toHaveAttribute('data-selected', 'true');
    }
  });

  // @req FR:priorities-tables/pr.cols.live @req FR:priorities-tables/pr.manager @req FR:priorities-tables/web.table
  test('PRs: quickest first, live links and the Sweep Manager', async ({ page }) => {
    await open(page, view(), '#/now?pri=prs');
    const first = cards(page, 'prs').first();
    await expect(first.locator('.ui-card-top')).toContainText('🏦 1142');
    await expect(first.locator('.ui-card-tools')).toContainText('5m');
    await expect(first.getByRole('link', { name: '1142' })).toHaveAttribute('href', 'https://github.com/allytehq/finops-hubs/pull/1142');
    await expect(cards(page, 'prs').nth(1).locator('.ui-card-title')).toContainText('Live: server, details');
    await expect(page.getByTestId('pri-prs').getByRole('link', { name: 'server' })).toHaveAttribute('href', 'https://dev.example.test');
    await expect(page.getByTestId('pri-prs').getByRole('link', { name: 'Sweep Manager' })).toHaveAttribute('href', 'claude://claude.ai/epitaxy/sm');
  });

  // @req FR:priorities-tables/pr.live.none @req FR:priorities-tables/web.table.empty
  test('says Not verified live with no good poll, and Nothing here when empty', async ({ page }) => {
    const v = view(); v.prs = { at: iso(), stale: true, verified: false, manager: null, rows: [] };
    await open(page, v, '#/now?pri=prs');
    await expect(cards(page, 'prs')).toHaveText(['Not verified live']);
    await page.getByRole('tab', { name: /^Next 3 days/ }).click();
    await expect(cards(page, 'next')).toHaveText(['Nothing here']);
    await page.getByRole('tab', { name: /^Today/ }).click();
    await expect(cards(page, 'today').first().locator('.ui-card-top')).toHaveText('FOCUS stale');
    await expect(page.getByTestId('pri-stamp')).toHaveText('as of 10:20 AM, stale');
  });

  // @req NFR:priorities-tables/a11y.target @req NFR:priorities-tables/a11y.mobile @req NFR:priorities-tables/a11y.color
  test('cards at every width: project and status on line 1, action, then agent; neutral; 44 px targets on touch', async ({ page }, info) => {
    await open(page, view(), '#/now?pri=now');
    const c = cards(page, 'now').nth(1);
    const top = async (s: string) => (await c.locator(s).boundingBox())!.y;
    const [project, status, action, agent] = [await top('.ui-card-top'), await top('.ui-card-tools'), await top('.ui-card-title'), await top('.ui-card-sub')];
    expect(Math.abs(project - status)).toBeLessThan(4);
    expect(action).toBeGreaterThan(project + 4);
    expect(agent).toBeGreaterThan(action + 4);
    // neutral surface: the card background is the plain surface token
    expect(await c.evaluate((el) => getComputedStyle(el).backgroundColor)).toBe(await c.evaluate((el) => { const p = document.createElement('div'); p.style.background = 'var(--fl-bg1)'; el.parentElement!.appendChild(p); const b = getComputedStyle(p).backgroundColor; p.remove(); return b; }));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (info.project.name === 'mobile') for (const t of await page.getByRole('tab').all()) expect((await t.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

  // @req FR:priorities-tables/web.card.open @req FR:priorities-tables/web.tabs.head @req FR:ui-kit/card.chev @req FR:ui-kit/tabs
  test('the chevron is large and centred on the card height; the stamp has space after it', async ({ page }) => {
    await open(page, view(), '#/now?pri=now');
    for (const c of await cards(page, 'now').all()) {
      const [card, chev] = [(await c.boundingBox())!, (await c.locator('.ui-card-chev').boundingBox())!];
      expect(Math.abs((chev.y + chev.height / 2) - (card.y + card.height / 2))).toBeLessThanOrEqual(1);
      expect(chev.height).toBeGreaterThanOrEqual(card.height - 1);
      expect(chev.width).toBeGreaterThanOrEqual(44);
      expect(card.x + card.width - (chev.x + chev.width)).toBeLessThanOrEqual(1);
      expect(await c.locator('.ui-card-chev').evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(28);
      // the status chip stays clear of the chevron
      const tools = await c.locator('.ui-card-tools').count() ? await c.locator('.ui-card-tools').boundingBox() : null;
      if (tools) expect(tools.x + tools.width).toBeLessThanOrEqual(chev.x + 1);
    }
    const [bar, stamp] = [(await page.locator('.pri-head .ui-tabbar').boundingBox())!, (await page.getByTestId('pri-stamp').boundingBox())!];
    expect(bar.x + bar.width - (stamp.x + stamp.width)).toBeGreaterThanOrEqual(12);
  // @req FR:priorities-tables/web.message @req FR:priorities-tables/web.message.off @req FR:priorities-tables/web.message.result @req FR:ui-kit/message
  test('Message agent: sends the text to the agent session; off with no session', async ({ page }, info) => {
    const m = await open(page, view(), '#/now?pri=now');
    await cards(page, 'now').nth(1).getByRole('button', { name: 'Details: FH Premium' }).click();
    const box = detail(page).getByRole('group', { name: 'Message agent' });
    await expect(box.getByRole('button', { name: 'Send' })).toBeDisabled();
    await box.getByRole('textbox', { name: 'Message FH backend' }).fill('What happened to 430?');
    await shot(page, 'message-agent-' + info.project.name);
    expect((await new AxeBuilder({ page }).include('[data-testid="pri-tables"]').analyze()).violations).toEqual([]);
    await box.getByRole('button', { name: 'Send' }).click();
    await expect(box.getByRole('status')).toHaveText('Sent to FH backend');
    await expect(box.getByRole('textbox')).toHaveValue('');
    expect(m.calls.filter((c) => c.path.endsWith('/prompt')).map((c) => [c.path, c.body])).toEqual([['/sessions/' + CLI.s1 + '/prompt', { text: 'What happened to 430?' }]]);
    // an error keeps the text
    m.promptFail = 'The session is busy';
    await box.getByRole('textbox').fill('again');
    await box.getByRole('button', { name: 'Send' }).click();
    await expect(box.getByRole('status')).toHaveText('The session is busy');
    await expect(box.getByRole('textbox')).toHaveValue('again');
    // no agent: no box. An agent with no session: off, with the reason.
    await back(page);
    await cards(page, 'now').first().getByRole('button').click();
    await expect(detail(page).getByRole('group', { name: 'Message agent' })).toHaveCount(0);
    await back(page);
    await page.getByTestId('pri-tab-qm').click();
    await cards(page, 'qm').nth(1).getByRole('button').click();
    const off = detail(page).getByRole('group', { name: 'Message agent' });
    await expect(off.getByRole('textbox')).toBeDisabled();
    await expect(off).toContainText('No live session for this agent');
  });

  // @req FR:priorities-tables/web.askcos @req FR:priorities-tables/web.askcos.off @req FR:priorities-tables/web.table.gap
  test('a gap row says who, when and what; Ask CoS sends the request to the CoS session', async ({ page }, info) => {
    const v = view();
    v.today.rows.push(row('arc', 'Arc', { action: 'CoS, by 3 PM: add a 1️⃣/2️⃣/3️⃣ task in tasks/arc.md with (agent: ...)', cos: F('CoS', null), request: 'r' }) as never);
    const m = await open(page, v, '#/now?pri=now');
    const gap = cards(page, 'now').nth(2);
    await expect(gap.locator('.ui-card-title .pri-muted')).toHaveText(GAP);
    await gap.getByRole('button', { name: 'Details: FH 0.11' }).click();
    await expect(detail(page)).toContainText(GAP);
    await expect(detail(page).getByRole('link', { name: 'Allyte CoS' })).toHaveAttribute('href', 'claude://claude.ai/epitaxy/cos');
    const box = detail(page).getByRole('group', { name: 'Ask CoS' });
    await expect(box.getByRole('textbox', { name: 'Message Allyte CoS' })).toHaveValue(REQUEST);
    await shot(page, 'ask-cos-' + info.project.name);
    expect((await new AxeBuilder({ page }).include('[data-testid="pri-tables"]').analyze()).violations).toEqual([]);
    await box.getByRole('button', { name: 'Ask CoS' }).click();
    await expect(box.getByRole('status')).toHaveText('Sent to Allyte CoS');
    expect(m.calls.filter((c) => c.path.endsWith('/prompt')).map((c) => [c.path, c.body])).toEqual([['/sessions/' + CLI.cos + '/prompt', { text: REQUEST }]]);
    await back(page);
    await page.getByTestId('pri-tab-today').click();
    await cards(page, 'today').nth(2).getByRole('button').click();
    const off = detail(page).getByRole('group', { name: 'Ask CoS' });
    await expect(off.getByRole('button', { name: 'Ask CoS' })).toBeDisabled();
    await expect(off).toContainText('No live session for CoS');
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
    await expect(cards(page, 'now')).toHaveCount(3);
    const v = view(); v.now.rows = v.now.rows.slice(0, 1); m.priorities = v;
    await page.clock.runFor(61_000);
    await expect(cards(page, 'now')).toHaveCount(1);
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
