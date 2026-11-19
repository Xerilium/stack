/**
 * The PR page at 375 px (touch) and 1280 px: icon, flyout, Summary tab, one card shape, details pane, Pinned tab, axe, tap size.
 * @req FR:pr-page/icon.place @req FR:pr-page/icon.absent @req FR:pr-page/icon.open @req FR:pr-page/flyout.shape @req FR:pr-page/flyout.tabs @req FR:pr-page/flyout.header
 * @req FR:pr-page/flyout.filter @req FR:pr-page/flyout.empty @req FR:pr-page/flyout.a11y @req FR:pr-page/act.list @req FR:pr-page/act.never @req FR:pr-page/live.age @req FR:pr-page/live.event @req FR:pr-page/group.footer
 * @req FR:pr-page/nav.rail @req FR:pr-page/nav.badge @req FR:pr-page/nav.phone @req FR:pr-page/nav.page @req FR:pr-page/nav.load @req FR:pr-page/auth.state @req FR:pr-page/auth.signin
 * @req FR:pr-page/summary.live @req FR:pr-page/summary.signoff @req FR:pr-page/summary.autopilot @req FR:pr-page/summary.missing @req FR:pr-page/summary.layout
 * @req FR:pr-page/card.fields @req FR:pr-page/card.action @req FR:pr-page/card.color @req FR:pr-page/card.space @req FR:pr-page/card.select
 * @req FR:pr-page/detail.layout @req FR:pr-page/detail.validate @req FR:pr-page/detail.signoff @req FR:pr-page/detail.approve @req FR:pr-page/detail.publish @req FR:pr-page/detail.autopilot @req FR:pr-page/detail.none
 * @req FR:ui-kit/a11y @req FR:ui-kit/card @req FR:ui-kit/menu @req FR:ui-kit/bar @req FR:ui-kit/flag
 * @req FR:pr-page/check.view @req FR:pr-page/check.none @req FR:pr-page/card.flag @req FR:pr-page/menu.shape @req FR:pr-page/menu.detail @req FR:pr-page/menu.run
 * @req FR:pr-page/pin.toggle @req FR:pr-page/pin.tab @req FR:pr-page/pin.drag @req FR:pr-page/pin.keys @req FR:pr-page/state.view
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { mockApi } from './mock';

const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const st = (owner: string, blocker = '', link = '', extra: Record<string, unknown> = {}) => ({ owner, blocker, link, stalled: false, source: 'rule', ...extra });
const U = (n: number, repo = 'Xerilium/stack') => `https://github.com/${repo}/pull/${n}`;
const row = (n: number, o: Record<string, unknown>) => ({
  url: U(n), repo: 'Xerilium/stack', number: n, title: `PR ${n}`, author: 'me', mine: true, project: 'xerilium', group: 'processing', draft: false,
  createdAt: ago(30), updatedAt: ago(1), ci: 'passing', unresolved: 0, labels: ['Status: 🤖 Autopilot'], state: st('none'), healthy: true, agent: false, after: [], rank: null, pinned: false, autopilot: true,
  nextAction: null, specLines: null, detail: {}, ...o,
});
const hold = (id: string, n: number, text: string) => ({
  id, url: `${U(n)}#discussion_r${id.length}`, path: 'src/core/x.ts', ask: { author: 'me', body: text, url: `${U(n)}#discussion_r1`, at: ago(20) },
  after: [{ author: 'me', body: '🤖 [AI] Fixed in a1b2c3d', url: `${U(n)}#discussion_r2`, at: ago(10) }], commits: [{ sha: 'a1b2c3d4', title: 'Fix the cache key', url: 'https://github.com/Xerilium/stack/commit/a1b2c3d4', at: ago(9) }],
});
const BOARD = () => ({
  at: new Date(Date.now() - 12_000).toISOString(), user: 'me', agents: { count: 3, source: 'sessions' },
  counts: { waiting: 2, processing: 4, pending: 3, paused: 1 }, footer: { running: 3, waiting: 4, parked: 2 }, queue: true,
  rows: [
    row(109, { title: 'Tailnet access for the app', nextAction: 'validate', specLines: 12, pinned: true, rank: 2, detail: { steps: { source: 'lane', state: 'ready-for-michael', serverUrl: 'http://localhost:5174', items: [{ text: 'Open the app on the phone', state: 'open' }, { text: 'Sign in works', state: 'failed' }] }, check: { ask: 'Check the app on the phone', server: 'pnpm web', steps: ['Open the app'], pass: [], fail: [] } } }),
    row(101, { title: 'Pick the API shape for task comments', nextAction: 'signoff', specLines: 40, pinned: true, rank: 1, state: st('me', 'Sign-off: wait for my ack', `${U(101)}#discussion_r9`), detail: { signoff: [hold('PRRT_one', 101, 'Wait for my ack before you merge'), { ...hold('PRRT_two', 101, 'Hold: test it live first'), after: [], commits: [] }] } }),
    row(1105, { repo: 'allytehq/finops-hubs', url: U(1105, 'allytehq/finops-hubs'), project: 'allyte', title: 'FTK spec approval', nextAction: 'signoff', specLines: 8, detail: { signoff: [hold('PRRT_three', 1105, 'wait for my ack')] } }),
    row(106, { title: 'Ready for Autopilot', group: 'pending', autopilot: false, labels: [], nextAction: 'autopilot', specLines: 3, detail: { notes: [{ body: 'Not yet: the copy is wrong', url: `${U(106)}#issuecomment-4`, at: ago(48) }] } }),
    row(107, { title: 'Draft idea', group: 'pending', draft: true, autopilot: false, labels: [] }),
    row(102, { repo: 'microsoft/finops-toolkit', url: U(102, 'microsoft/finops-toolkit'), project: 'ftk', author: 'roland', mine: false, group: 'waiting', autopilot: false, labels: [], title: 'FTK: add the cost export', nextAction: 'approve' }),
    row(103, { repo: 'microsoft/finops-toolkit', url: U(103, 'microsoft/finops-toolkit'), project: 'ftk', author: 'roland', mine: false, group: 'waiting', autopilot: false, labels: [], title: 'FTK: new docs', nextAction: 'publish', detail: { review: { url: `${U(103, 'microsoft/finops-toolkit')}#pullrequestreview-7`, body: 'Two notes', comments: [{ path: 'docs/a.md', body: 'Use the short name' }] } } }),
    row(104, { title: 'Healthy agent work', agent: true }),
    row(108, { title: 'Paused idea', group: 'paused', labels: ['Status: ⏸️ Paused'], autopilot: false }),
    row(110, { title: 'Agent asks a question', state: st('me', '🧭 Keep the old API or break it?', `${U(110)}#issuecomment-1`) }),
  ],
  summary: {
    live: [U(109)], signoff: [U(101), U(1105, 'allytehq/finops-hubs')], autopilot: [U(106)],
    missing: [{ url: U(102, 'microsoft/finops-toolkit'), reason: 'Approve' }, { url: U(103, 'microsoft/finops-toolkit'), reason: 'Publish review' }, { url: U(110), reason: '🧭 Keep the old API or break it?' }, { url: U(109), reason: 'Live check failed: Sign in works' }],
  },
});
const EMPTY_BOARD = () => ({ ...BOARD(), rows: [row(104, { title: 'Healthy agent work' })], summary: { live: [], signoff: [], autopilot: [], missing: [] }, counts: { waiting: 0, processing: 1, pending: 0, paused: 0 } });

async function setup(page: Page, o: { board?: unknown; status?: number; delayMs?: number; signIn?: unknown[] } = {}) {
  const m = await mockApi(page);
  const posts: { path: string; body: any }[] = [];
  const gets: string[] = [];
  await page.route('**/api/prs**', async (route) => {
    const req = route.request();
    const u = new URL(req.url());
    const path = u.pathname.replace(/^\/api/, '');
    if (path === '/prs/sign-in') {
      posts.push({ path: `${req.method()} ${path}`, body: null });
      const next = req.method() === 'POST' ? o.signIn?.[0] : o.signIn?.[Math.min(posts.filter((p) => p.path === 'GET /prs/sign-in').length, (o.signIn?.length ?? 1) - 1)];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(next ?? { state: 'none' }) });
    }
    if (req.method() === 'GET') {
      gets.push(u.search);
      if (o.delayMs) await new Promise((r) => setTimeout(r, o.delayMs));
      if (o.status) return route.fulfill({ status: o.status, contentType: 'application/json', body: JSON.stringify({ error: { code: 'not_found', message: 'No PR board on this host' } }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o.board ?? BOARD()) });
    }
    const body = req.postDataJSON();
    posts.push({ path, body });
    const reply = path === '/prs/queue' ? { rank: body.rank ?? 1, was: 2, pinned: body.op === 'pin' } : { ok: true, op: body.op };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply) });
  });
  return { m, posts, gets };
}
const icon = (page: Page, mobile: boolean) => page.getByTestId(mobile ? 'prs-btn-phone' : 'prs-btn');
async function openFly(page: Page, mobile: boolean) {
  await page.goto('/#/now');
  await icon(page, mobile).click();
  const fly = page.getByTestId('prs-flyout');
  await expect(fly).toBeVisible();
  return fly;
}
async function openPage(page: Page) {
  await page.goto('/#/prs');
  const pg = page.getByTestId('prs-page');
  await expect(pg.getByRole('tab').first()).toBeVisible();
  return pg;
}
const card = (scope: Locator, n: number) => scope.locator(`.pr-card[data-number="${n}"]`).first();

test('icon counts active agents; click opens the flyout; Escape closes and focus returns', async ({ page }, info) => {
  const mobile = info.project.name === 'mobile';
  await setup(page);
  await page.goto('/#/now');
  const b = icon(page, mobile);
  await expect(b).toHaveAccessibleName('Pull requests: 3 agents active');
  await b.click();
  const fly = page.getByTestId('prs-flyout');
  await expect(fly).toBeVisible();
  const box = await fly.boundingBox();
  if (mobile) expect(Math.round(box!.width)).toBe(375); else expect(Math.round(box!.width)).toBe(480);
  await expect(page.getByTestId('prs-age')).toHaveText(/Updated \d+ s ago/);
  await expect(page.getByTestId('prs-foot')).toHaveText('running 3 · waiting 4 · parked 2');
  await page.keyboard.press('Escape');
  await expect(fly).toHaveCount(0);
  await expect(b).toBeFocused();
});

test('g r opens the Pull requests page', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'keys are desktop');
  await setup(page);
  await page.goto('/#/now');
  await expect(icon(page, false)).toBeVisible();
  await page.locator('body').click({ position: { x: 600, y: 700 } });
  await page.keyboard.press('g');
  await page.keyboard.press('r');
  await expect(page).toHaveURL(/#\/prs$/);
  await expect(page.getByTestId('prs-page')).toBeVisible();
});

test('the rail has Pull requests with the count of PRs with a next action', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'the rail is desktop');
  await setup(page);
  await page.goto('/#/now');
  const entry = page.getByRole('navigation', { name: 'Views' }).locator('button.tab', { hasText: 'Pull requests' });
  await expect(entry.getByTestId('prs-nav-badge')).toHaveText('6');
  await expect(entry.getByTestId('prs-nav-badge')).toHaveAttribute('aria-label', '6 need you');
  await entry.click();
  await expect(page).toHaveURL(/#\/prs$/);
});

test('phone: More lists Go to Pull requests with the count', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'the tab bar is phone');
  await setup(page);
  await page.goto('/#/now');
  await page.getByRole('button', { name: /^More/ }).click();
  const go = page.getByRole('option', { name: /Go to Pull requests \(6\)/ }).or(page.getByRole('button', { name: /Go to Pull requests \(6\)/ }));
  await go.first().click();
  await expect(page.getByTestId('prs-page')).toBeVisible();
});

test('first open shows a skeleton, never zero counts, until the board answers', async ({ page }, info) => {
  const mobile = info.project.name === 'mobile';
  await setup(page, { delayMs: 1500 });
  await page.goto('/#/prs');
  const sk = page.getByTestId('prs-skeleton');
  await expect(sk).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByTestId('prs-page').getByRole('tab')).toHaveCount(0);
  // @req FR:pr-page/flyout.header.total: no count before the board.
  await expect(page.getByTestId('prs-page').getByRole('heading', { level: 2 })).toHaveText('Pull requests');
  await expect(icon(page, mobile)).toHaveAccessibleName('Pull requests: loading');
  await expect(page.getByTestId('prs-page').getByRole('tab', { name: /Summary/ })).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('prs-page').getByRole('heading', { level: 2 })).toHaveText('Pull requests (10)');
});

test('signed out: Sign in to GitHub, the device code, then the board', async ({ page }) => {
  let board: unknown = { auth: { state: 'signed-out', method: 'gh' } };
  const { posts } = await setup(page, { signIn: [{ state: 'waiting', userCode: 'AB12-CD34', verificationUri: 'https://github.com/login/device' }, { state: 'waiting', userCode: 'AB12-CD34', verificationUri: 'https://github.com/login/device' }, { state: 'done' }] });
  await page.route('**/api/prs', (route) => route.request().method() === 'GET' ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(board) }) : route.fallback());
  await page.goto('/#/prs');
  const pg = page.getByTestId('prs-page');
  await expect(pg.getByTestId('prs-signin')).toContainText('Sign in to GitHub to see your PRs.');
  await pg.getByTestId('prs-signin-btn').click();
  await expect(pg.getByTestId('prs-code')).toHaveText('AB12-CD34');
  expect(posts.some((p) => p.path === 'POST /prs/sign-in')).toBe(true);
  board = BOARD();
  await expect(pg.getByRole('tab', { name: /Summary/ })).toBeVisible({ timeout: 10_000 });
});

test('no icon and no nav entry on a host with no board; a direct #/prs says so', async ({ page }, info) => {
  await setup(page, { board: { off: true } });
  await page.goto('/#/now');
  await expect(page.locator('.main')).toBeVisible();
  await page.waitForTimeout(300);
  await expect(icon(page, info.project.name === 'mobile')).toHaveCount(0);
  await page.goto('/#/prs');
  await expect(page.getByTestId('prs-off')).toContainText('This host has no PR board.');
});

test('tabs: Summary first, clear names, counts; no Live check, no multi-select, no queue buttons', async ({ page }) => {
  await setup(page);
  const pg = await openPage(page);
  await expect(pg.getByRole('tab')).toHaveText(['Summary 7', 'Processing 5', 'Waiting on me 2', 'Pending 2', 'Paused 1', 'Pinned 2']);
  await expect(pg.getByRole('tab', { name: /Summary/ })).toHaveAttribute('aria-selected', 'true');
  for (const name of [/Live check/i, /^Select$/, /^Top$/, /^Up$/, /^Down$/, /^Remove/, /Remove Autopilot/, /Accept/, /merge|un-?draft|close pr|^approve$/i]) await expect(pg.getByRole('button', { name })).toHaveCount(0);
  await expect(pg.getByRole('link', { name: /Live check/i })).toHaveCount(0);
  await expect(pg.locator('input[type=checkbox]')).toHaveCount(0);
  // The words: no hold, escalation, or blocked anywhere on the page.
  const text = await pg.innerText();
  expect(text).not.toMatch(/\bhold\b|\bheld\b|escalat|blocked/i);
});

test('Summary: four clearly separated sections; Nothing else when empty', async ({ page }) => {
  await setup(page);
  const pg = await openPage(page);
  const secs = pg.locator('section.pr-sec');
  await expect(secs.locator('h3')).toHaveText(['Needs live validation', 'Needs your sign-off', 'Ready for Autopilot', 'Am I missing anything?']);
  await expect(secs.nth(0).locator('.pr-card')).toHaveCount(1);
  await expect(secs.nth(1).locator('.pr-card')).toHaveCount(2);
  await expect(secs.nth(2).locator('.pr-card')).toHaveCount(1);
  const miss = secs.nth(3).locator('li');
  await expect(miss).toHaveCount(4);
  await expect(miss.nth(0)).toContainText('microsoft/finops-toolkit#102');
  await expect(miss.nth(0)).toContainText('Approve');
  await expect(miss.nth(3)).toContainText('Live check failed: Sign in works');
  const [a, b] = [await secs.nth(0).boundingBox(), await secs.nth(1).boundingBox()];
  expect(b!.y - (a!.y + a!.height)).toBeGreaterThanOrEqual(16);
  await expect(pg.getByTestId('prs-miss-more')).toHaveCount(0);
  // More than 10 lines: the first 10, then where the rest are.
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  const many = BOARD();
  const extra = Array.from({ length: 12 }, (_, k) => row(300 + k, { author: 'roland', mine: false, group: k < 8 ? 'waiting' : 'pending', autopilot: false, labels: [], nextAction: 'approve' }));
  many.rows.push(...extra);
  many.summary.missing = extra.map((r) => ({ url: r.url, reason: 'Approve' }));
  await setup(page, { board: many });
  await page.reload();
  await expect(pg.locator('section.pr-sec').nth(3).locator('li')).toHaveCount(10);
  await expect(pg.getByTestId('prs-miss-more')).toHaveText('2 more in Pending.');
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await setup(page, { board: EMPTY_BOARD() });
  await page.reload();
  await expect(pg.locator('section.pr-sec').nth(3)).toContainText('Nothing else.');
  await expect(pg.locator('section.pr-sec').nth(0)).toContainText('None now.');
});

test('one card: repo, # link, title, author, one action flag, spec lines, Pin, Actions; nothing else; owner colors', async ({ page }) => {
  await setup(page);
  const pg = await openPage(page);
  const c = card(pg, 1105);
  await expect(c.locator('.pr-repo')).toHaveText('allytehq/finops-hubs');
  await expect(c.getByRole('link', { name: '#1105' })).toHaveAttribute('href', U(1105, 'allytehq/finops-hubs'));
  await expect(c.getByRole('link', { name: '#1105' })).toHaveAttribute('target', '_blank');
  await expect(c.locator('.ui-card-title')).toHaveText('FTK spec approval');
  await expect(c.locator('.pr-author')).toHaveText('My Autopilot');
  await expect(c.locator('.ui-flag')).toHaveText('Sign off');
  // A flag, not a control: no fill, no border, default cursor, not focusable, no button role. @req FR:pr-page/card.flag
  const flag = await c.locator('.ui-flag').evaluate((e) => { const cs = getComputedStyle(e); return { bg: cs.backgroundColor, border: cs.borderTopWidth, cursor: cs.cursor, tab: (e as HTMLElement).tabIndex, role: e.getAttribute('role'), tag: e.tagName, icon: !!e.querySelector('svg') }; });
  expect(flag).toEqual({ bg: 'rgba(0, 0, 0, 0)', border: '0px', cursor: 'default', tab: -1, role: null, tag: 'SPAN', icon: true });
  await expect(c.locator('.pr-spec')).toHaveText('8 spec lines');
  // The chevron: its 44 px column spans the card height at the right edge; the tools stay clear of it. @req FR:ui-kit/card.chev
  const [box, chev, tools] = [(await c.boundingBox())!, (await c.locator('.ui-card-chev').boundingBox())!, (await c.locator('.ui-card-tools').boundingBox())!];
  expect(Math.abs((chev.y + chev.height / 2) - (box.y + box.height / 2))).toBeLessThanOrEqual(1);
  expect([chev.width >= 44, box.x + box.width - (chev.x + chev.width) <= 1, tools.x + tools.width <= chev.x + 1]).toEqual([true, true, true]);
  await expect(c.getByRole('button')).toHaveCount(3); // select + Pin + Actions
  await expect(c.getByRole('button', { name: 'Actions for allytehq/finops-hubs#1105' })).toHaveAttribute('aria-haspopup', 'menu');
  await expect(c.getByRole('button', { name: 'Pin allytehq/finops-hubs#1105' })).toHaveAttribute('aria-pressed', 'false');
  await expect(c).toHaveClass(/tone-auto strong/);
  await pg.getByRole('tab', { name: /Waiting on me/ }).click();
  await expect(card(pg, 102).locator('.pr-author')).toHaveText('roland');
  await expect(card(pg, 102)).toHaveClass(/tone-other strong/);
  await expect(card(pg, 103).locator('.ui-flag')).toHaveText('Publish review');
  await pg.getByRole('tab', { name: /Pending/ }).click();
  await expect(card(pg, 106).locator('.pr-author')).toHaveText('You');
  await expect(card(pg, 106).locator('.ui-flag')).toHaveText('Enable Autopilot');
  await expect(card(pg, 107)).toHaveClass(/tone-mine(?! strong)/);
  await expect(card(pg, 107).locator('.ui-flag')).toHaveCount(0);
  // Generous spacing.
  const boxes = await pg.locator('.pr-card').evaluateAll((els) => els.slice(0, 2).map((e) => e.getBoundingClientRect()).map((r) => ({ y: r.y, h: r.height })));
  expect(boxes[1].y - (boxes[0].y + boxes[0].h)).toBeGreaterThanOrEqual(12);
});

test('quick actions: one ⋯ menu per card, only what fits, keyboard, and the same actions in the details', async ({ page }, info) => {
  const mobile = info.project.name === 'mobile';
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const { posts } = await setup(page);
  const pg = await openPage(page);
  await pg.getByRole('tab', { name: /Pending/ }).click();
  const btn = card(pg, 106).getByRole('button', { name: 'Actions for Xerilium/stack#106' });
  await expect(btn).toHaveAttribute('aria-expanded', 'false');
  await btn.click();
  await expect(btn).toHaveAttribute('aria-expanded', 'true');
  const menu = pg.getByRole('menu', { name: 'Actions for Xerilium/stack#106' });
  await expect(menu.getByRole('menuitem')).toHaveText(['Sweep next', 'Enable Autopilot', 'Open on GitHub', 'Copy sweep command']);
  await expect(menu.getByRole('menuitem', { name: 'Open on GitHub' })).toHaveAttribute('href', U(106));
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  // Keyboard: arrows move, End jumps, Escape closes and returns focus.
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Enable Autopilot' })).toBeFocused();
  await page.keyboard.press('End');
  await expect(menu.getByRole('menuitem', { name: 'Copy sweep command' })).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.getByRole('menuitem', { name: 'Sweep next' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(btn).toBeFocused();
  // One menu at a time; a tap outside closes it.
  await card(pg, 107).getByRole('button', { name: /^Actions for/ }).click();
  await expect(pg.getByRole('menu').getByRole('menuitem')).toHaveText(['Sweep next', 'Open on GitHub', 'Copy sweep command']);
  await btn.click();
  await expect(pg.getByRole('menu')).toHaveCount(1);
  await expect(pg.getByRole('menu')).toHaveAccessibleName('Actions for Xerilium/stack#106');
  await pg.getByRole('heading', { name: 'Pull requests' }).click();
  await expect(pg.getByRole('menu')).toHaveCount(0);
  // Enable Autopilot: the label route, a toast with Undo.
  await btn.click();
  await pg.getByRole('menuitem', { name: 'Enable Autopilot' }).click();
  await expect.poll(() => posts.filter((p) => p.path === '/prs/label').map((p) => p.body)).toEqual([{ repo: 'Xerilium/stack', number: 106, op: 'add' }]);
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => posts.filter((p) => p.path === '/prs/label').map((p) => p.body.op)).toEqual(['add', 'remove']);
  // Sweep next: not queued, so add (top of the unpinned queue).
  await btn.click();
  await pg.getByRole('menuitem', { name: 'Sweep next' }).click();
  await expect.poll(() => posts.filter((p) => p.path === '/prs/queue').map((p) => p.body)).toEqual([{ repo: 'Xerilium/stack', number: 106, op: 'add' }]);
  await expect(page.locator('.toasts')).toContainText('Xerilium/stack#106 is next for the Sweep Manager');
  // Copy: the Catalyst sweep command for my PR.
  await btn.click();
  await pg.getByRole('menuitem', { name: 'Copy sweep command' }).click();
  await expect(page.locator('.toasts')).toContainText('Copied');
  if (!mobile) expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('/catalyst:pr-sweep 106 update');
  // Someone else's PR: review, and no Autopilot change.
  await pg.getByRole('tab', { name: /Waiting on me/ }).click();
  await card(pg, 102).getByRole('button', { name: /^Actions for/ }).click();
  await expect(pg.getByRole('menu').getByRole('menuitem')).toHaveText(['Sweep next', 'Open on GitHub', 'Copy sweep command']);
  await page.keyboard.press('Escape');
  // The details pane ends with the same actions.
  await pg.getByRole('tab', { name: /Processing/ }).click();
  await card(pg, 101).locator('.ui-card-open').click();
  const d = pg.getByTestId('prs-detail');
  await expect(d.getByRole('heading', { name: 'Quick actions' })).toBeVisible();
  await expect(d.locator('.ui-bar').getByRole('button')).toHaveText(['Remove Autopilot', 'Copy sweep command']);
  await expect(d.locator('.ui-bar').getByRole('link')).toHaveText(['Open on GitHub']);
  await d.locator('.ui-bar').getByRole('button', { name: 'Remove Autopilot' }).click();
  await expect.poll(() => posts.filter((p) => p.path === '/prs/label').map((p) => p.body).at(-1)).toEqual({ repo: 'Xerilium/stack', number: 101, op: 'remove' });
});

test('live check: Ask, Server with Copy, numbered Steps, Pass, Fail, As of; no file is Not actionable', async ({ page }, info) => {
  const mobile = info.project.name === 'mobile';
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write']);
  const b = BOARD();
  const at = '2026-11-18T18:00:00Z';
  (b.rows[0] as any).detail.check = { ask: 'Check sign-in on the phone', server: 'pnpm web --port 5180', steps: ['Open the app', 'Sign in'], pass: ['Home shows tasks'], fail: ['An error toast'], at };
  (b.rows[3] as any).detail.check = { ask: 'Check the label copy', steps: [], pass: [], fail: [] };
  await setup(page, { board: b });
  const pg = await openPage(page);
  await card(pg, 109).locator('.ui-card-open').click();
  const d = pg.getByTestId('prs-detail');
  const c = d.locator('.pr-check');
  await expect(c.locator('.pr-check-ask')).toHaveText('Check sign-in on the phone');
  await expect(c.locator('code.pr-check-cmd')).toHaveText('pnpm web --port 5180');
  await expect(c.locator('ol li')).toHaveText(['Open the app', 'Sign in']);
  await expect(c.locator('.pr-check-pass li')).toHaveText(['Home shows tasks']);
  await expect(c.locator('.pr-check-fail li')).toHaveText(['An error toast']);
  await expect(c.locator('.pr-check-at')).toContainText('As of');
  await c.getByRole('button', { name: 'Copy server command' }).click();
  await expect(page.locator('.toasts')).toContainText('Copied');
  // A check with no steps still shows its Ask on any PR.
  if (mobile) await d.getByRole('button', { name: 'Back' }).click();
  await pg.getByRole('tab', { name: /Pending/ }).click();
  await card(pg, 106).locator('.ui-card-open').click();
  await expect(d.locator('.pr-check-ask')).toHaveText('Check the label copy');
  await expect(d.locator('.pr-check ol')).toHaveCount(0);
  // Validate with no file: never a bare Validate.
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  const none = BOARD();
  delete (none.rows[0] as any).detail.check;
  await setup(page, { board: none });
  await page.reload();
  if (mobile && await d.getByRole('button', { name: 'Back' }).isVisible()) await d.getByRole('button', { name: 'Back' }).click();
  await pg.getByRole('tab', { name: /Summary/ }).click();
  await expect(card(pg, 109).locator('.ui-flag')).toHaveText('Not actionable: no server/steps yet');
  await card(pg, 109).locator('.ui-card-open').click();
  await expect(d.getByRole('heading', { level: 3 })).toHaveText('Not actionable: no server/steps yet');
});

test('details: wide shows a pane on the right; narrow replaces the list with Back', async ({ page }, info) => {
  const mobile = info.project.name === 'mobile';
  await setup(page);
  const pg = await openPage(page);
  if (!mobile) await expect(pg.getByTestId('prs-detail')).toContainText('Select a PR to see its next step.');
  await expect(card(pg, 109).locator('.ui-card-open')).toHaveAccessibleName(/next: Validate/);
  await card(pg, 109).locator('.ui-card-open').click();
  const d = pg.getByTestId('prs-detail');
  await expect(d).toBeVisible();
  await expect(d.getByRole('heading', { level: 3 })).toHaveText('Validate');
  await expect(d.locator('.pr-d > ol li')).toHaveText([/Open the app on the phone/, /Sign in works.*Failed/]);
  await expect(d.getByRole('link', { name: /localhost:5174/ })).toHaveAttribute('href', 'http://localhost:5174');
  await expect(d.getByRole('link', { name: 'Open the checklist to tick items' })).toHaveAttribute('href', '#/live');
  await expect(card(pg, 109).locator('.ui-card-open')).toHaveAttribute('aria-current', 'true');
  if (mobile) {
    await expect(pg.locator('.pr-list-col')).toBeHidden();
    await d.getByRole('button', { name: 'Back' }).click();
    await expect(card(pg, 109).locator('.ui-card-open')).toBeFocused();
  } else {
    const [l, r] = [await pg.locator('.pr-list-col').boundingBox(), await d.boundingBox()];
    expect(r!.x).toBeGreaterThan(l!.x + l!.width - 1);
    await expect(d.getByRole('button', { name: 'Back' })).toHaveCount(0);
  }
  // Keyboard: Enter on the focused card selects it.
  await card(pg, 106).locator('.ui-card-open').focus();
  await page.keyboard.press('Enter');
  await expect(d.getByRole('heading', { level: 3 })).toHaveText('Enable Autopilot');
  await expect(d.getByRole('link', { name: 'Open on GitHub' })).toHaveAttribute('href', U(106));
  await expect(d.locator('.ui-bar').getByRole('button', { name: 'Enable Autopilot' })).toBeVisible();
  await expect(d).toContainText('Not yet: the copy is wrong');
});

test('phone: Back from a missing line returns focus to that line', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'the details replace the list below 1100 px');
  await setup(page);
  const pg = await openPage(page);
  const line = pg.locator('.pr-miss-open[data-url="https://github.com/Xerilium/stack/pull/110"]');
  await line.click();
  const d = pg.getByTestId('prs-detail');
  await expect(d).toContainText('Nothing for you now.');
  await d.getByRole('button', { name: 'Back' }).click();
  await expect(line).toBeFocused();
});

test('Sign off: one thread at a time, how it was addressed, Resolve thread with Undo, Re-review', async ({ page }) => {
  const { posts } = await setup(page);
  const pg = await openPage(page);
  await card(pg, 101).locator('.ui-card-open').click();
  const d = pg.getByTestId('prs-detail');
  await expect(d.getByRole('heading', { level: 3 })).toHaveText('Sign off');
  await expect(d).toContainText('Thread 1 of 2');
  await expect(d).toContainText('src/core/x.ts');
  await expect(d).toContainText('Wait for my ack before you merge');
  await expect(d).toContainText('Fixed in a1b2c3d');
  await expect(d).toContainText('Fix the cache key');
  await expect(d.getByRole('link', { name: 'Re-review' })).toHaveAttribute('href', `${U(101)}/files`);
  await d.getByRole('button', { name: 'Next thread' }).click();
  await expect(d).toContainText('Thread 2 of 2');
  await expect(d).toContainText('No reply or commit since your ask.');
  await d.getByRole('button', { name: 'Previous thread' }).click();
  await d.getByRole('button', { name: 'Resolve thread' }).click();
  await expect.poll(() => posts.filter((p) => p.path === '/prs/resolve').map((p) => p.body)).toEqual([{ repo: 'Xerilium/stack', number: 101, thread: 'PRRT_one', op: 'resolve' }]);
  await page.locator('.toasts').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => posts.filter((p) => p.path === '/prs/resolve').map((p) => p.body.op)).toEqual(['resolve', 'unresolve']);
});

test('Approve and Publish review: links only, findings when simple', async ({ page }) => {
  await setup(page);
  const pg = await openPage(page);
  await pg.getByRole('tab', { name: /Waiting on me/ }).click();
  await card(pg, 102).locator('.ui-card-open').click();
  const d = pg.getByTestId('prs-detail');
  await expect(d.getByRole('link', { name: 'Open PR files' })).toHaveAttribute('href', `${U(102, 'microsoft/finops-toolkit')}/files`);
  await expect(d.getByRole('button', { name: /approve/i })).toHaveCount(0);
  if (await d.getByRole('button', { name: 'Back' }).isVisible()) await d.getByRole('button', { name: 'Back' }).click();
  await card(pg, 103).locator('.ui-card-open').click();
  await expect(d.getByRole('link', { name: 'Open your draft review' })).toHaveAttribute('href', `${U(103, 'microsoft/finops-toolkit')}#pullrequestreview-7`);
  await expect(d).toContainText('docs/a.md');
  await expect(d).toContainText('Use the short name');
});

test('Pin on every card; Pinned is sorted by drag and by keyboard', async ({ page }, info) => {
  const mobile = info.project.name === 'mobile';
  const { posts } = await setup(page);
  const pg = await openPage(page);
  await card(pg, 1105).getByRole('button', { name: 'Pin allytehq/finops-hubs#1105' }).click();
  await expect.poll(() => posts.filter((p) => p.path === '/prs/queue').map((p) => p.body)).toEqual([{ repo: 'allytehq/finops-hubs', number: 1105, op: 'pin' }]);
  await card(pg, 101).getByRole('button', { name: 'Unpin Xerilium/stack#101' }).click();
  await expect.poll(() => posts.filter((p) => p.path === '/prs/queue').length).toBe(2);
  expect(posts.filter((p) => p.path === '/prs/queue')[1].body).toEqual({ repo: 'Xerilium/stack', number: 101, op: 'unpin' });
  await pg.getByRole('tab', { name: /Pinned/ }).click();
  await expect(pg.locator('.pr-card')).toHaveCount(2);
  await expect(pg.locator('.pr-card').nth(0)).toHaveAttribute('data-number', '101');
  // Sorting is only here: a handle per card; no other tab has one.
  const handles = pg.getByRole('button', { name: /^Reorder / });
  await expect(handles).toHaveCount(2);
  // Drag 109 above 101.
  const h = card(pg, 109).getByRole('button', { name: 'Reorder Xerilium/stack#109' });
  const hb = (await h.boundingBox())!; const tb = (await card(pg, 101).boundingBox())!;
  if (mobile) {
    // Touch: the same pointer events.
    await h.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', clientX: hb.x + hb.width / 2, clientY: hb.y + hb.height / 2, isPrimary: true, button: 0 });
    await h.dispatchEvent('pointermove', { pointerId: 1, pointerType: 'touch', clientX: hb.x + hb.width / 2, clientY: tb.y + 4, isPrimary: true });
    await h.dispatchEvent('pointerup', { pointerId: 1, pointerType: 'touch', clientX: hb.x + hb.width / 2, clientY: tb.y + 4, isPrimary: true });
  } else {
    await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
    await page.mouse.down();
    await page.mouse.move(hb.x + hb.width / 2, tb.y + 20, { steps: 6 });
    await page.mouse.move(hb.x + hb.width / 2, tb.y + 4, { steps: 2 });
    await page.mouse.up();
  }
  await expect.poll(() => posts.filter((p) => p.path === '/prs/queue').map((p) => p.body).slice(2)).toEqual([{ repo: 'Xerilium/stack', number: 109, op: 'move', rank: 1 }]);
  if (mobile) return;
  // The reload after the drop brings the board order back (this mock board never changes).
  await expect(pg.locator('.pr-card').nth(0)).toHaveAttribute('data-number', '101');
  // Keyboard: Space picks up, ArrowDown moves, Space drops.
  await pg.getByRole('button', { name: 'Reorder Xerilium/stack#101' }).focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowDown');
  await expect(pg.getByTestId('prs-sort-status')).toHaveText(/Xerilium\/stack#101, place 2 of 2/);
  await page.keyboard.press('Space');
  await expect.poll(() => posts.filter((p) => p.path === '/prs/queue').map((p) => p.body).slice(3)).toEqual([{ repo: 'Xerilium/stack', number: 101, op: 'move', rank: 2 }]);
  // Escape cancels a pick-up.
  await pg.getByRole('button', { name: /Reorder Xerilium\/stack#10/ }).first().focus();
  await page.keyboard.press('Enter');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  expect(posts.filter((p) => p.path === '/prs/queue')).toHaveLength(4);
  await pg.getByRole('tab', { name: /Processing/ }).click();
  await expect(pg.getByRole('button', { name: /^Reorder / })).toHaveCount(0);
});

test('a move under a project filter sends the queue rank of the target place, not the visible place', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'keys are desktop');
  const b = BOARD();
  for (const r of b.rows) { if (r.number === 101) Object.assign(r, { pinned: true, rank: 1 }); if (r.number === 1105) Object.assign(r, { pinned: true, rank: 2 }); if (r.number === 109) Object.assign(r, { pinned: true, rank: 3 }); }
  const { posts } = await setup(page, { board: b });
  const pg = await openPage(page);
  await pg.getByRole('group', { name: 'Filter by project' }).getByRole('button', { name: /^Xerilium/ }).click();
  await pg.getByRole('tab', { name: /Pinned/ }).click();
  await expect(pg.locator('.pr-card')).toHaveCount(2);
  await pg.getByRole('button', { name: 'Reorder Xerilium/stack#101' }).focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Space');
  await expect.poll(() => posts.filter((p) => p.path === '/prs/queue').map((p) => p.body)).toEqual([{ repo: 'Xerilium/stack', number: 101, op: 'move', rank: 3 }]);
});

test('no automatic reload; Refresh asks the host to poll; the age ticks', async ({ page }) => {
  await page.clock.install();
  const { gets } = await setup(page);
  const pg = await openPage(page);
  const n = gets.length;
  await page.clock.runFor(5 * 60_000);
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await page.waitForTimeout(100);
  expect(gets.length).toBe(n);
  await expect(pg.getByTestId('prs-age')).toHaveText(/Updated \d+ min ago/);
  await pg.getByRole('button', { name: 'Refresh pull requests' }).click();
  await expect.poll(() => gets.slice(n)).toEqual(['?refresh=1']);
});

// @req FR:pr-page/flyout.filter.pills @req FR:pr-page/flyout.filter.count @req FR:pr-page/flyout.header.total
test('project chips show counts, filter the Summary and the header total, and are remembered', async ({ page }) => {
  await setup(page);
  const pg = await openPage(page);
  await expect(pg.getByRole('heading', { level: 2 })).toHaveText('Pull requests (10)');
  const chips = pg.getByRole('group', { name: 'Filter by project' }).getByRole('button');
  await expect(chips).toHaveText(['Allyte 1', 'FTK 2', 'Xerilium 7']);
  await pg.getByRole('button', { name: 'Allyte 1' }).click();
  await expect(pg.getByRole('tab', { name: /Summary/ })).toHaveText('Summary 1');
  await expect(pg.getByRole('heading', { level: 2 })).toHaveText('Pull requests (1)');
  await expect(pg.locator('section.pr-sec').nth(1).locator('.pr-card')).toHaveCount(1);
  // The chip counts do not follow the selection or the tab.
  await pg.getByRole('tab', { name: /Paused/ }).click();
  await expect(chips).toHaveText(['Allyte 1', 'FTK 2', 'Xerilium 7']);
  await page.reload();
  await expect(pg.getByRole('button', { name: 'Allyte 1' })).toHaveAttribute('aria-pressed', 'true');
});

for (const scheme of ['light', 'dark'] as const) {
  test(`page (${scheme}): axe clean on Summary, details, Pinned; no sideways scroll; tap size; screenshot`, async ({ page }, info) => {
    const mobile = info.project.name === 'mobile';
    await page.emulateMedia({ colorScheme: scheme });
    await setup(page);
    const pg = await openPage(page);
    const check = async (name: string) => {
      await page.waitForTimeout(300);
      const { violations } = await new AxeBuilder({ page }).include('[data-testid="prs-page"]').analyze();
      const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').flatMap((v) => v.nodes.map((n) => `${v.id} ${n.target.join(' ')}`));
      expect(bad, bad.join('\n')).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      const min = mobile ? 44 : 24;
      const small = await pg.locator('button:visible, a:visible').evaluateAll((els, m) => els.map((e) => { const r = e.getBoundingClientRect(); return { h: Math.round(r.height), w: Math.round(r.width), what: `${(e as HTMLElement).className} "${(e.textContent ?? '').trim().slice(0, 30)}"` }; }).filter((x) => x.h > 0 && (x.h < m || x.w < m)), min);
      expect(small, JSON.stringify(small, null, 1)).toEqual([]);
      await page.screenshot({ path: `e2e/screenshots/prs-${name}-${info.project.name}-${scheme}.png`, fullPage: true });
    };
    await check('summary');
    await card(pg, 101).locator('.ui-card-open').click();
    await check('detail');
    if (mobile) await pg.getByTestId('prs-detail').getByRole('button', { name: 'Back' }).click();
    await pg.getByRole('tab', { name: /Pinned/ }).click();
    await check('pinned');
  });
}

test('flyout: axe clean, tap size, details replace the list with Back', async ({ page }, info) => {
  const mobile = info.project.name === 'mobile';
  await setup(page);
  const fly = await openFly(page, mobile);
  await card(fly, 109).locator('.ui-card-open').click();
  await expect(fly.getByTestId('prs-detail').getByRole('button', { name: 'Back' })).toBeVisible();
  await page.waitForTimeout(300);
  const { violations } = await new AxeBuilder({ page }).include('[data-testid="prs-flyout"]').analyze();
  const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').flatMap((v) => v.nodes.map((n) => `${v.id} ${n.target.join(' ')}`));
  expect(bad, bad.join('\n')).toEqual([]);
  await fly.getByTestId('prs-detail').getByRole('button', { name: 'Back' }).click();
  await expect(card(fly, 109)).toBeVisible();
});
