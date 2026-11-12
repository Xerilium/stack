/**
 * The PR page at 375 px (touch) and 1280 px: icon, flyout, tabs, filters, one-tap actions, axe, tap size.
 * @req FR:pr-page/icon.place @req FR:pr-page/icon.absent @req FR:pr-page/icon.open @req FR:pr-page/flyout.shape @req FR:pr-page/flyout.tabs @req FR:pr-page/flyout.row
 * @req FR:pr-page/flyout.filter @req FR:pr-page/flyout.empty @req FR:pr-page/flyout.a11y @req FR:pr-page/act.queue @req FR:pr-page/act.autopilot @req FR:pr-page/act.accept
 * @req FR:pr-page/act.thread @req FR:pr-page/act.rec @req FR:pr-page/act.set @req FR:pr-page/act.never @req FR:pr-page/live.age @req FR:pr-page/state.view @req FR:pr-page/group.footer
 * @req FR:pr-page/nav.rail @req FR:pr-page/nav.badge @req FR:pr-page/nav.phone @req FR:pr-page/nav.page @req FR:pr-page/nav.load @req FR:pr-page/auth.state @req FR:pr-page/auth.signin
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mockApi } from './mock';

const ago = (h: number) => new Date(Date.now() - h * 3600_000).toISOString();
const st = (owner: string, blocker = '', link = '', extra: Record<string, unknown> = {}) => ({ owner, blocker, link, stalled: false, source: 'rule', ...extra });
const row = (n: number, o: Record<string, unknown>) => ({
  url: `https://github.com/Xerilium/stack/pull/${n}`, repo: 'Xerilium/stack', number: n, title: `PR ${n}`, author: 'me', project: 'xerilium', group: 'processing', draft: false,
  createdAt: ago(30), updatedAt: ago(1), ci: 'passing', unresolved: 0, labels: ['Status: 🤖 Autopilot'], state: st('none'), healthy: true, agent: false, after: [], rank: null, pinned: false, autopilot: true, ...o,
});
const BOARD = () => ({
  at: new Date(Date.now() - 12_000).toISOString(), user: 'me', agents: { count: 3, source: 'sessions' },
  counts: { blocked: 1, waiting: 1, processing: 3, pending: 2, paused: 1 }, footer: { running: 3, waiting: 4, parked: 2 }, queue: true,
  rows: [
    row(101, { title: 'Pick the API shape for task comments', group: 'blocked', bucket: 'decide', healthy: false, unresolved: 2, rank: 1, state: st('me', '🧭 Keep the old API or break it?', 'https://github.com/Xerilium/stack/pull/101#discussion_r9', { bucket: 'decide', key: 't:9', replyTo: 9 }) }),
    row(102, { title: 'FH: add the cost export', repo: 'microsoft/finops-hubs', url: 'https://github.com/microsoft/finops-hubs/pull/102', project: 'allyte', author: 'roland', group: 'waiting', bucket: 'approve', healthy: false, autopilot: false, labels: [] }),
    row(103, { title: 'Healthy agent work', agent: true, rank: 2 }),
    row(104, { title: 'Waits on a re-review', healthy: false, state: st('reviewer', 'Waiting on roland', 'https://github.com/Xerilium/stack/pull/104', { login: 'roland' }), after: ['#101'] }),
    row(105, { title: 'Checks stuck in the queue', healthy: false, ci: 'pending', state: st('runner', 'Checks queued over 1 h', 'https://github.com/Xerilium/stack/pull/105/checks'), rec: { id: 'pp-0000000a', agent: 'xe-cos', reason: 'Blocks the release', toRank: 1 } }),
    row(106, { title: 'Ready for your review', group: 'pending', bucket: 'review', autopilot: false, labels: [], healthy: false }),
    row(107, { title: 'Draft idea', group: 'pending', draft: true, autopilot: false, labels: [], healthy: false }),
    row(108, { title: 'On hold', group: 'paused', labels: ['Status: ⏸️ Paused'], healthy: false }),
  ],
  escalations: {
    at: ago(1),
    blocked: [{ repo: 'Xerilium/stack', number: 101, url: 'https://github.com/Xerilium/stack/pull/101', title: 'Pick the API shape', blocker: 'Keep the old API or break it?', context: 'Two callers use the old shape.', recommend: 'Keep the old API for one release', link: 'https://github.com/Xerilium/stack/pull/101#discussion_r9' }],
    enable: [{ repo: 'Xerilium/stack', number: 106, url: 'https://github.com/Xerilium/stack/pull/106', title: 'Ready for your review' }],
    live: [{ repo: 'Xerilium/stack', number: 109, url: 'https://github.com/Xerilium/stack/pull/109', title: 'Tailnet access' }],
  },
});

async function setup(page: Page, o: { board?: unknown; status?: number; delayMs?: number; signIn?: unknown[] } = {}) {
  const m = await mockApi(page);
  const posts: { path: string; body: any }[] = [];
  await page.route('**/api/prs**', async (route) => {
    const req = route.request();
    const path = new URL(req.url()).pathname.replace(/^\/api/, '');
    if (path === '/prs/sign-in') {
      posts.push({ path: `${req.method()} ${path}`, body: null });
      const next = req.method() === 'POST' ? o.signIn?.[0] : o.signIn?.[Math.min(posts.filter((p) => p.path === 'GET /prs/sign-in').length, (o.signIn?.length ?? 1) - 1)];
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(next ?? { state: 'none' }) });
    }
    if (req.method() === 'GET') {
      if (o.delayMs) await new Promise((r) => setTimeout(r, o.delayMs));
      if (o.status) return route.fulfill({ status: o.status, contentType: 'application/json', body: JSON.stringify({ error: { code: 'not_found', message: 'No PR board on this host' } }) });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o.board ?? BOARD()) });
    }
    const body = req.postDataJSON();
    posts.push({ path, body });
    const reply = path === '/prs/queue' ? { rank: body.op === 'top' ? 1 : null, was: body.op === 'add' ? null : 2, pinned: body.op === 'pin' } : { ok: true, posted: !!body.post };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(reply) });
  });
  return { m, posts };
}
const icon = (page: Page, mobile: boolean) => page.getByTestId(mobile ? 'prs-btn-phone' : 'prs-btn');
async function openFly(page: Page, mobile: boolean) {
  await page.goto('/#/now');
  await icon(page, mobile).click();
  const fly = page.getByTestId('prs-flyout');
  await expect(fly).toBeVisible();
  return fly;
}

test('icon counts active agents; click opens the flyout; Escape closes and focus returns', async ({ page }, info) => {
  const mobile = info.project.name === 'mobile';
  await setup(page);
  await page.goto('/#/now');
  const b = icon(page, mobile);
  await expect(b).toHaveAccessibleName('Pull requests: 3 agents active');
  await expect(b.locator('.badge')).toHaveText('3');
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

test('the rail has Pull requests with a count of Blocked plus Waiting; it opens #/prs', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'the rail is desktop');
  await setup(page);
  await page.goto('/#/now');
  const rail = page.getByRole('navigation', { name: 'Views' });
  const entry = rail.locator('button.tab', { hasText: 'Pull requests' });
  await expect(entry).toBeVisible();
  // BOARD counts: blocked 1 + waiting 1.
  await expect(entry.getByTestId('prs-nav-badge')).toHaveText('2');
  await expect(entry.getByTestId('prs-nav-badge')).toHaveAttribute('aria-label', '2 need you');
  // After Needs you.
  const names = await rail.locator('button.tab').allInnerTexts();
  expect(names.findIndex((n) => n.startsWith('Pull requests'))).toBe(names.findIndex((n) => n.startsWith('Needs you')) + 1);
  await entry.click();
  await expect(page).toHaveURL(/#\/prs$/);
  const pg = page.getByTestId('prs-page');
  await expect(pg.getByRole('tab', { name: /Blocked on me/ })).toBeVisible();
  // Every PR title is a full GitHub link.
  for (const href of await pg.locator('a.pr-title').evaluateAll((els) => els.map((e) => (e as HTMLAnchorElement).href))) expect(href).toMatch(/^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/);
  // Direct actions on the page too: Top on a queued row; Apply Autopilot on a pending row; open link.
  await pg.getByRole('tab', { name: /Blocked on me/ }).click();
  await expect(pg.locator('.pr-row').first().getByRole('button', { name: 'Top', exact: true })).toBeVisible();
  await pg.getByRole('tab', { name: /Pending/ }).click();
  await expect(pg.getByRole('button', { name: 'Apply Autopilot' })).toBeVisible();
  // The top bar icon still opens the flyout over the page.
  await icon(page, false).click();
  await expect(page.getByTestId('prs-flyout')).toBeVisible();
});

test('phone: More lists Go to Pull requests with the count; the top icon opens the flyout full screen', async ({ page }, info) => {
  test.skip(info.project.name !== 'mobile', 'the tab bar is phone');
  await setup(page);
  await page.goto('/#/now');
  await expect(page.getByRole('navigation', { name: 'Views (mobile)' }).getByRole('button')).toHaveCount(5);
  await page.getByRole('button', { name: /^More/ }).click();
  const go = page.getByRole('option', { name: /Go to Pull requests \(2\)/ }).or(page.getByRole('button', { name: /Go to Pull requests \(2\)/ }));
  await expect(go.first()).toBeVisible();
  await go.first().click();
  await expect(page).toHaveURL(/#\/prs$/);
  await expect(page.getByTestId('prs-page')).toBeVisible();
});

test('first open shows a skeleton, never zero counts, until the board answers', async ({ page }, info) => {
  const mobile = info.project.name === 'mobile';
  await setup(page, { delayMs: 1500 });
  await page.goto('/#/prs');
  const sk = page.getByTestId('prs-skeleton');
  await expect(sk).toBeVisible();
  await expect(sk).toHaveAttribute('aria-busy', 'true');
  await expect(page.getByTestId('prs-page').getByRole('tab')).toHaveCount(0);
  await expect(page.getByTestId('prs-page').getByRole('tab', { name: /Blocked on me/ })).toBeVisible({ timeout: 5000 });
  await expect(page.getByTestId('prs-age')).toHaveText(/Updated \d+ s ago/);
  await expect(icon(page, mobile)).toBeVisible();
});

test('signed out: one honest state with Sign in to GitHub; the device code; the board after done', async ({ page }, info) => {
  const mobile = info.project.name === 'mobile';
  const SIGNED_OUT = { auth: { state: 'signed-out', method: 'gh' } };
  let board: unknown = SIGNED_OUT;
  const { posts } = await setup(page, { signIn: [{ state: 'waiting', userCode: 'AB12-CD34', verificationUri: 'https://github.com/login/device' }, { state: 'waiting', userCode: 'AB12-CD34', verificationUri: 'https://github.com/login/device' }, { state: 'done' }] });
  await page.route('**/api/prs', (route) => route.request().method() === 'GET' ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(board) }) : route.fallback());
  await page.goto('/#/now');
  // The icon and the nav entry show, with no count.
  const b = icon(page, mobile);
  await expect(b).toHaveAccessibleName('Pull requests: sign in to GitHub');
  await expect(b.locator('.badge')).toHaveCount(0);
  if (!mobile) await expect(page.getByTestId('prs-nav-dot')).toHaveAttribute('aria-label', 'Sign in to GitHub');
  await page.goto('/#/prs');
  const pg = page.getByTestId('prs-page');
  await expect(pg.getByTestId('prs-signin')).toContainText('Sign in to GitHub to see your PRs.');
  await expect(pg.getByRole('tab')).toHaveCount(0);
  await expect(pg.getByTestId('prs-foot')).toHaveCount(0);
  await pg.getByTestId('prs-signin-btn').click();
  await expect(pg.getByTestId('prs-code')).toHaveText('AB12-CD34');
  await expect(pg.getByRole('link', { name: 'Open github.com/login/device' })).toHaveAttribute('href', 'https://github.com/login/device');
  expect(posts.some((p) => p.path === 'POST /prs/sign-in')).toBe(true);
  board = BOARD();
  await expect(pg.getByRole('tab', { name: /Blocked on me/ })).toBeVisible({ timeout: 10_000 });
});

test('no gh CLI: the state says how to fix it, no button', async ({ page }) => {
  await setup(page, { board: { auth: { state: 'signed-out', method: 'none' } } });
  await page.goto('/#/prs');
  const s = page.getByTestId('prs-signin');
  await expect(s).toContainText('Install the GitHub CLI, or set GITHUB_TOKEN.');
  await expect(page.getByTestId('prs-signin-btn')).toHaveCount(0);
});

test('no icon and no nav entry on a host with no board ({off: true}) or an older host (404)', async ({ page }, info) => {
  await setup(page, { board: { off: true } });
  await page.goto('/#/now');
  await expect(page.locator('.main')).toBeVisible();
  await page.waitForTimeout(300);
  await expect(icon(page, info.project.name === 'mobile')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Pull requests/ })).toHaveCount(0);
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await setup(page, { status: 404 });
  await page.goto('/#/now');
  await page.reload();
  await expect(page.locator('.main')).toBeVisible();
  await page.waitForTimeout(300);
  await expect(icon(page, info.project.name === 'mobile')).toHaveCount(0);
});

test('tabs show counts; rows show state, links open on GitHub in a new tab; Processing hides healthy', async ({ page }, info) => {
  await setup(page);
  const fly = await openFly(page, info.project.name === 'mobile');
  const tabs = fly.getByRole('tab');
  await expect(tabs).toHaveText(['Escalation set 3', 'Blocked on me 1', 'Waiting on me 1', 'Processing 2', 'Pending 2', 'Paused 1']);
  await fly.getByRole('tab', { name: /Blocked on me/ }).click();
  const r = fly.locator('.pr-row').first();
  await expect(r).toContainText('🧭 Decide');
  await expect(r).toContainText('#1');
  await expect(r.locator('.pr-owner.me')).toHaveText('You');
  await expect(r.getByRole('link', { name: /Open thread: 🧭 Keep the old API/ })).toHaveAttribute('href', 'https://github.com/Xerilium/stack/pull/101#discussion_r9');
  await expect(r.locator('a.pr-title')).toHaveAttribute('target', '_blank');
  await fly.getByRole('tab', { name: /Processing/ }).click();
  await expect(fly.locator('.pr-row')).toHaveCount(2);
  await expect(fly.locator('.pr-owner.reviewer')).toHaveText('roland');
  await expect(fly.getByText('CI/runner')).toBeVisible();
  await expect(fly.getByText('after #101')).toBeVisible();
  await fly.getByLabel(/Show healthy/).check();
  await expect(fly.locator('.pr-row')).toHaveCount(3);
  await fly.getByRole('tab', { name: /Paused/ }).click();
  await expect(fly.locator('.pr-row')).toHaveCount(1);
  // Never a merge, un-draft, close, or approve control.
  await expect(fly.getByRole('button', { name: /merge|ready for review|un-?draft|close pr|approve/i })).toHaveCount(0);
});

test('project chips filter, multi-select, and are remembered', async ({ page }, info) => {
  const mobile = info.project.name === 'mobile';
  await setup(page);
  let fly = await openFly(page, mobile);
  await fly.getByRole('button', { name: 'Allyte' }).click();
  await expect(fly.getByRole('button', { name: 'Allyte' })).toHaveAttribute('aria-pressed', 'true');
  await expect(fly.getByRole('tab', { name: /Waiting on me/ })).toHaveText('Waiting on me 1');
  await expect(fly.getByRole('tab', { name: /Blocked on me/ })).toHaveText('Blocked on me 0');
  await fly.getByRole('tab', { name: /Blocked on me/ }).click();
  await expect(fly.getByTestId('prs-empty')).toHaveText('Nothing blocked on you.');
  await page.reload();
  fly = await openFly(page, mobile);
  await expect(fly.getByRole('button', { name: 'Allyte' })).toHaveAttribute('aria-pressed', 'true');
  await expect(fly.getByRole('tab', { name: /Blocked on me/ })).toHaveAttribute('aria-selected', 'true');
  await fly.getByRole('button', { name: 'Xerilium' }).click();
  await expect(fly.getByRole('tab', { name: /Blocked on me/ })).toHaveText('Blocked on me 1');
});

test('queue: Top with Undo (pr-pri undo); Queue; Pin; Remove; keys on a row', async ({ page }, info) => {
  const mobile = info.project.name === 'mobile';
  const { posts } = await setup(page);
  const fly = await openFly(page, mobile);
  await fly.getByRole('tab', { name: /Processing/ }).click();
  await fly.getByLabel(/Show healthy/).check();
  const r = fly.locator('.pr-row', { hasText: 'Healthy agent work' });
  await r.getByRole('button', { name: 'Top', exact: true }).click();
  expect(posts.at(-1)).toEqual({ path: '/prs/queue', body: { repo: 'Xerilium/stack', number: 103, op: 'top' } });
  await page.getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => posts.at(-1)).toEqual({ path: '/prs/queue', body: { repo: 'Xerilium/stack', number: 103, op: 'undo' } });
  await fly.locator('.pr-row', { hasText: 'Waits on a re-review' }).getByRole('button', { name: 'Queue' }).click();
  await expect.poll(() => posts.at(-1)?.body.op).toBe('add');
  await r.getByRole('button', { name: 'Pin', exact: true }).click();
  await expect.poll(() => posts.at(-1)?.body.op).toBe('pin');
  await r.getByRole('button', { name: /^Remove .* from the queue$/ }).click();
  await expect.poll(() => posts.at(-1)?.body.op).toBe('remove');
  if (!mobile) {
    await r.focus();
    await page.keyboard.press('d');
    await expect.poll(() => posts.at(-1)?.body).toEqual({ repo: 'Xerilium/stack', number: 103, op: 'down' });
  }
});

test('Apply Autopilot needs a confirm that shows the PR link and the label', async ({ page }, info) => {
  const { posts } = await setup(page);
  const fly = await openFly(page, info.project.name === 'mobile');
  await fly.getByRole('tab', { name: /Pending/ }).click();
  await expect(fly.locator('.pr-row', { hasText: 'Draft idea' }).getByRole('button', { name: 'Apply Autopilot' })).toHaveCount(0);
  await fly.locator('.pr-row', { hasText: 'Ready for your review' }).getByRole('button', { name: 'Apply Autopilot' }).click();
  const sheet = page.getByRole('dialog', { name: 'Apply Autopilot?' });
  await expect(sheet.getByRole('link', { name: 'Xerilium/stack#106' })).toHaveAttribute('href', 'https://github.com/Xerilium/stack/pull/106');
  await expect(sheet).toContainText('Status: 🤖 Autopilot');
  expect(posts).toEqual([]);
  await sheet.getByRole('button', { name: 'Apply' }).click();
  await expect.poll(() => posts.at(-1)).toEqual({ path: '/prs/label', body: { repo: 'Xerilium/stack', number: 106, op: 'add' } });
});

test('a cancelled sheet gives focus back; Tab reaches the toast Undo while the flyout is open', async ({ page }, info) => {
  test.skip(info.project.name === 'mobile', 'keyboard');
  await setup(page);
  const fly = await openFly(page, false);
  await fly.getByRole('tab', { name: /Pending/ }).click();
  const apply = fly.locator('.pr-row', { hasText: 'Ready for your review' }).getByRole('button', { name: 'Apply Autopilot' });
  await apply.click();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Apply Autopilot?' })).toHaveCount(0);
  await expect(apply).toBeFocused();
  await expect(fly).toBeVisible();
  await fly.getByRole('tab', { name: /Processing/ }).click();
  await fly.getByLabel(/Show healthy/).check();
  await fly.locator('.pr-row', { hasText: 'Healthy agent work' }).getByRole('button', { name: 'Top', exact: true }).click();
  const undo = page.getByRole('button', { name: 'Undo' });
  await expect(undo).toBeVisible();
  let reached = false;
  for (let i = 0; i < 80 && !reached; i++) { await page.keyboard.press('Tab'); reached = await undo.evaluate((el) => el === document.activeElement); }
  expect(reached).toBe(true);
  await expect(fly).toBeVisible();
});

test('Escalation set: one tap Accept; reply shows the exact AI text; bulk runs selected', async ({ page }, info) => {
  const { posts } = await setup(page);
  const fly = await openFly(page, info.project.name === 'mobile');
  await fly.getByRole('tab', { name: /Escalation set/ }).click();
  await expect(fly.getByRole('textbox', { name: /Answer for Xerilium\/stack#101/ })).toHaveValue('Keep the old API for one release');
  await fly.locator('.pr-esc-sec', { hasText: 'Decide' }).getByRole('button', { name: 'Accept', exact: true }).click();
  expect(posts.at(-1)).toEqual({ path: '/prs/ack', body: { repo: 'Xerilium/stack', number: 101, thread: 'https://github.com/Xerilium/stack/pull/101#discussion_r9', note: 'Keep the old API for one release' } });
  // No Undo: the store has no unack; answering again replaces the answer.
  await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);
  await fly.getByRole('button', { name: 'Accept and reply…' }).click();
  const sheet = page.getByRole('dialog', { name: 'Reply on GitHub?' });
  await expect(sheet.getByRole('textbox')).toHaveValue('Keep the old API for one release');
  await expect(sheet.getByTestId('prs-preview')).toHaveText('🤖 [AI] Keep the old API for one release');
  await sheet.getByRole('button', { name: 'Post reply' }).click();
  await expect.poll(() => posts.at(-1)?.body).toMatchObject({ post: true, text: '🤖 [AI] Keep the old API for one release', replyTo: 9 });
  await expect(fly.getByRole('link', { name: 'Open PR' })).toHaveAttribute('href', 'https://github.com/Xerilium/stack/pull/109');
  await fly.getByRole('button', { name: 'Select' }).click();
  await fly.getByRole('checkbox', { name: 'Select Xerilium/stack#101' }).check();
  await fly.getByRole('checkbox', { name: 'Select Xerilium/stack#106' }).check();
  await fly.getByRole('button', { name: 'Run 2' }).click();
  const bulk = page.getByRole('dialog', { name: 'Run 2 actions?' });
  await expect(bulk).toContainText('Apply Autopilot');
  const before = posts.length;
  await bulk.getByRole('button', { name: 'Run all' }).click();
  await expect.poll(() => posts.slice(before).map((p) => p.path)).toEqual(['/prs/ack', '/prs/label']);
});

test('a recommendation: Reject needs a reason', async ({ page }, info) => {
  const { posts } = await setup(page);
  const fly = await openFly(page, info.project.name === 'mobile');
  await fly.getByRole('tab', { name: /Processing/ }).click();
  const r = fly.locator('.pr-row', { hasText: 'Checks stuck' });
  await expect(r).toContainText('Raise to 1: Blocks the release');
  await r.getByRole('button', { name: 'Reject' }).click();
  const sheet = page.getByRole('dialog', { name: 'Reject the recommendation?' });
  await expect(sheet.getByRole('button', { name: 'Reject' })).toBeDisabled();
  await sheet.getByRole('textbox', { name: /Reason/ }).fill('Not this week');
  await sheet.getByRole('button', { name: 'Reject' }).click();
  await expect.poll(() => posts.at(-1)).toEqual({ path: '/prs/recs/pp-0000000a', body: { decision: 'reject', reason: 'Not this week' } });
});

for (const scheme of ['light', 'dark'] as const) {
  test(`#/prs page and signed-out state (${scheme}): axe clean, no sideways scroll, tap size`, async ({ page }, info) => {
    const mobile = info.project.name === 'mobile';
    await page.emulateMedia({ colorScheme: scheme });
    for (const [name, board] of [['page', BOARD()], ['signin', { auth: { state: 'signed-out', method: 'gh' } }]] as const) {
      await page.unrouteAll({ behavior: 'ignoreErrors' });
      await setup(page, { board });
      await page.goto('/#/prs');
      await page.reload();
      const pg = page.getByTestId('prs-page');
      await expect(name === 'page' ? pg.getByRole('tab').first() : pg.getByTestId('prs-signin')).toBeVisible();
      await page.waitForTimeout(350);
      const { violations } = await new AxeBuilder({ page }).include('[data-testid="prs-page"]').analyze();
      const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').flatMap((v) => v.nodes.map((n) => `${v.id} ${n.target.join(' ')}`));
      expect(bad, bad.join('\n')).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      const min = mobile ? 44 : 24;
      const small = await pg.locator('button:visible, a:visible').evaluateAll((els, m) => els.map((e) => { const r = e.getBoundingClientRect(); return { h: Math.round(r.height), what: `${(e as HTMLElement).className} "${(e.textContent ?? '').trim().slice(0, 30)}"` }; }).filter((x) => x.h > 0 && x.h < m), min);
      expect(small, JSON.stringify(small, null, 1)).toEqual([]);
      await page.screenshot({ path: `e2e/screenshots/prs-${name}-${info.project.name}-${scheme}.png`, fullPage: true });
    }
  });
  test(`flyout (${scheme}): axe clean, no sideways scroll, tap size; screenshot`, async ({ page }, info) => {
    const mobile = info.project.name === 'mobile';
    await page.emulateMedia({ colorScheme: scheme });
    await setup(page);
    await page.goto('/#/now');
    await page.reload();
    await icon(page, mobile).click();
    const fly = page.getByTestId('prs-flyout');
    for (const t of ['Escalation set', 'Blocked on me', 'Processing']) {
      await fly.getByRole('tab', { name: new RegExp(t) }).click();
      await page.waitForTimeout(350);
      const { violations } = await new AxeBuilder({ page }).include('[data-testid="prs-flyout"]').analyze();
      const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').flatMap((v) => v.nodes.map((n) => `${v.id} ${n.target.join(' ')}`));
      expect(bad, bad.join('\n')).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
      const min = mobile ? 44 : 24;
      const small = await fly.locator('button:visible, a:visible, input:not([type=checkbox]):visible, label:visible').evaluateAll((els, m) => els.map((e) => { const r = e.getBoundingClientRect(); return { h: Math.round(r.height), w: Math.round(r.width), what: `${(e as HTMLElement).className || e.tagName} "${(e.textContent ?? (e as HTMLInputElement).value ?? '').trim().slice(0, 30)}"` }; })
        .filter((x) => x.h > 0 && x.h < m), min);
      expect(small, JSON.stringify(small, null, 1)).toEqual([]);
      await page.screenshot({ path: `e2e/screenshots/prs-${t.split(' ')[0].toLowerCase()}-${info.project.name}-${scheme}.png` });
    }
  });
}
