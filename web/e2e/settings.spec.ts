/**
 * Settings: accounts in one compact list (all 6 on one screen), honest states, one Fix, a row menu, Learn more, other ways to connect;
 * agents delivery; updates. Fluent 2, axe clean in light and dark, at 375 and 1280.
 */
import { expect, test, type Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mockApi, seed, type Mock } from './mock';

const T0 = new Date('2026-11-12T18:00:00Z');
const iso = (ms: number) => new Date(T0.getTime() + ms).toISOString();
/** The owner's 6 accounts: 3 healthy, 1 needs sign-in, 1 Microsoft down, 1 not working. */
const SIX = [
  { account: 'michael@allyte.com', type: 'work', mail: true, calendar: true, drafts: false, state: 'down', lastOkAt: iso(-20 * 60_000), retryAt: iso(120_000) },
  { account: 'michael@michaelflanakin.com', type: 'personal', mail: true, calendar: true, drafts: false, state: 'connected', lastOkAt: iso(-60_000) },
  { account: 'michael@xerilium.com', type: 'work', mail: true, calendar: true, drafts: true, state: 'connected', lastOkAt: iso(-60_000) },
  { account: 'flanakin@outlook.com', type: 'personal', mail: true, calendar: true, drafts: false, state: 'expired', lastOkAt: iso(-86_400_000) },
  { account: 'mf@hotmail.com', type: 'personal', mail: true, calendar: true, drafts: false, state: 'connected', lastOkAt: iso(-60_000) },
  { account: 'm@contoso.test', type: 'work', mail: true, calendar: false, drafts: false, state: 'error' },
];
/** A local host (`stack web`): /setup and the updater exist. */
const local = (page: Page) => page.route('**/.auth/me', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ clientPrincipal: { identityProvider: 'local', userId: 'local', userDetails: 'local', userRoles: ['authenticated'] }, local: { mode: 'demo', repo: '/r', branch: 'main' } }) }));
async function open(page: Page, o: { setup?: boolean; accounts?: Record<string, unknown>[]; local?: boolean } = {}): Promise<Mock> {
  await page.clock.install({ time: T0 });
  const m = await mockApi(page, { tasks: seed() });
  m.connect = { info: { setup: { clientId: o.setup ?? true }, accounts: (o.accounts ?? SIX).map((a) => ({ ...a })) } };
  if (o.local) await local(page);
  await page.goto('/#/settings');
  await page.clock.resume();
  await expect(page.getByTestId('connect-accounts')).toBeVisible();
  return m;
}
const row = (page: Page, a: string) => page.locator(`.acct-row[data-account="${a}"]`);
const axe = async (page: Page) => (await new AxeBuilder({ page }).include('[data-testid="settings"]').analyze()).violations.flatMap((v) => v.nodes.map((n) => `${v.id}: ${n.target.join(' ')}`));
const noScrollX = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
const tall = async (page: Page) => {
  for (const el of await page.locator('[data-testid="settings"] :is(button, a, input):visible').all()) {
    const h = (await el.boundingBox())!.height;
    // A radio sits inside its 44 px label.
    if ((await el.getAttribute('type')) === 'radio') continue;
    expect(h, await el.evaluate((e) => e.outerHTML.slice(0, 80))).toBeGreaterThanOrEqual(44);
  }
};

test.describe('Settings > Accounts', () => {
  // @req FR:connect-accounts/web.panel @req FR:connect-accounts/web.row @req FR:connect-accounts/web.fix @req FR:connect-accounts/web.fit @req FR:settings/view.sections
  test('all 6 accounts on one screen, each one line with kind, address, dot and one word; Fix only where sign-in helps', async ({ page }, info) => {
    await open(page);
    const rows = page.locator('.acct-row');
    await expect(rows).toHaveCount(6);
    await expect(page.locator('.set-sec h2')).toHaveText(['Accounts', 'Agents', 'Updates']);
    await expect(row(page, 'michael@xerilium.com')).toContainText('Connected');
    await expect(row(page, 'michael@xerilium.com').getByRole('img', { name: 'Work' })).toBeVisible();
    await expect(row(page, 'mf@hotmail.com').getByRole('img', { name: 'Personal' })).toBeVisible();
    await expect(row(page, 'flanakin@outlook.com')).toContainText('Needs sign-in');
    await expect(row(page, 'm@contoso.test')).toContainText('Not working');
    // An outage is not a sign-in problem: no Fix, and the tip says Stack retries.
    await expect(row(page, 'michael@allyte.com')).toContainText('Microsoft not responding');
    await expect(row(page, 'michael@allyte.com').getByRole('button', { name: /^Fix/ })).toHaveCount(0);
    await expect(row(page, 'michael@allyte.com').locator('.acct-status')).toHaveAttribute('title', /^Last synced .+ · Retrying in 2 min$/);
    await expect(row(page, 'flanakin@outlook.com').getByRole('button', { name: 'Fix flanakin@outlook.com' })).toBeVisible();
    await expect(row(page, 'm@contoso.test').getByRole('button', { name: 'Fix m@contoso.test' })).toBeVisible();
    await expect(page.getByRole('button', { name: /^Fix/ })).toHaveCount(2);
    // No paragraphs per row: the old drafts sentence and Sign in again buttons are gone from the list.
    await expect(page.locator('.acct-list')).not.toContainText('Drafts lets Stack');
    await expect(page.locator('.acct-list').getByRole('button', { name: 'Sign in again' })).toHaveCount(0);
    for (const r of await rows.all()) expect((await r.boundingBox())!.height).toBeLessThanOrEqual(info.project.name === 'mobile' ? 96 : 48);
    if (info.project.name === 'desktop') {
      // 1280x800: every row, Add account and Other ways to connect are on screen without scrolling.
      const vh = page.viewportSize()!.height;
      for (const el of [page.getByRole('button', { name: 'Add account' }), rows.last(), page.getByRole('button', { name: 'Other ways to connect' })]) {
        const b = (await el.boundingBox())!;
        expect(b.y + b.height).toBeLessThanOrEqual(vh);
      }
    }
    expect(await noScrollX(page)).toBe(true);
    await page.screenshot({ path: `e2e/screenshots/settings-accounts-${info.project.name}.png` });
  });

  // @req FR:connect-accounts/web.fix @req FR:connect-accounts/web.signin
  test('Fix signs that account in again (drafts kept) and shows the browser step', async ({ page }) => {
    const m = await open(page);
    await page.getByRole('button', { name: 'Fix flanakin@outlook.com' }).click();
    await expect(page.getByTestId('connect-session')).toContainText('Finish signing in in your browser.');
    expect(m.calls.find((c) => c.path === '/connect/sign-in')?.body).toEqual({ account: 'flanakin@outlook.com' });
  });

  // @req FR:connect-accounts/web.menu @req FR:connect-accounts/scope.drafts @req FR:connect-accounts/acct.remove
  test('the row menu: drafts with a one-line hint, Sign in again, Disconnect asks first; Escape returns focus', async ({ page }) => {
    const m = await open(page);
    const more = page.getByRole('button', { name: 'More for michael@xerilium.com' });
    await more.click();
    const menu = page.getByRole('menu');
    const drafts = menu.getByRole('menuitemcheckbox', { name: /Let Stack save reply drafts in my mailbox/ });
    await expect(drafts).toHaveAttribute('aria-checked', 'true');
    await expect(drafts).toBeFocused();
    await expect(drafts).toContainText('Stack writes drafts for you to review. It never sends.');
    await expect(drafts).toContainText('On');
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name: 'Sign in again' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
    await expect(more).toBeFocused();
    await more.click();
    await page.getByRole('menuitemcheckbox', { name: /Let Stack save reply drafts in my mailbox/ }).click();
    await expect.poll(() => m.calls.find((c) => c.path === '/connect/drafts')?.body).toEqual({ account: 'michael@xerilium.com', on: false });
    await page.getByRole('button', { name: 'More for mf@hotmail.com' }).click();
    await page.getByRole('menuitem', { name: 'Disconnect' }).click();
    await expect(page.getByRole('menu')).toContainText('Disconnect mf@hotmail.com? Stack stops reading it.');
    expect(m.calls.some((c) => c.path === '/connect/remove')).toBe(false);
    await page.getByRole('menuitem', { name: 'Disconnect' }).click();
    await expect.poll(() => m.calls.find((c) => c.path === '/connect/remove')?.body).toEqual({ account: 'mf@hotmail.com' });
  });

  // @req FR:connect-accounts/web.learn
  test('Learn more explains reads and drafts in a popover', async ({ page }) => {
    await open(page);
    await expect(page.locator('#settings-accounts .set-sum')).toContainText('Stack reads mail and calendar. It never sends.');
    await page.getByRole('button', { name: 'Learn more' }).click();
    await expect(page.locator('#set-learn')).toContainText('Reply drafts is off by default');
    await page.keyboard.press('Escape');
    await expect(page.locator('#set-learn')).toHaveCount(0);
  });

  // @req FR:connect-accounts/web.manual @req FR:ux-consolidation/cal.connect @req FR:ux-consolidation/cal.save
  test('Other ways to connect is closed by default; on a local host a published link saves through /setup', async ({ page }) => {
    await open(page, { local: true });
    const other = page.getByRole('button', { name: 'Other ways to connect' });
    await expect(other).toHaveAttribute('aria-expanded', 'false');
    await expect(page.getByTestId('connect-manual')).toHaveCount(0);
    await other.click();
    const posts: unknown[] = [];
    await page.route('**/setup', async (r) => {
      if (r.request().method() !== 'POST') return r.fulfill({ status: 404, body: '' });
      posts.push(r.request().postDataJSON());
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ restart: false, status: null }) });
    });
    const field = page.getByRole('textbox', { name: 'Published calendar link (ICS)' });
    await field.fill('http://not-secure.test/cal.ics');
    await page.getByTestId('cal-link').getByRole('button', { name: 'Connect', exact: true }).click();
    await expect(page.getByTestId('cal-link').getByRole('alert')).toContainText('https');
    expect(posts).toEqual([]);
    const link = 'https://outlook.office365.com/owa/calendar/abc/def/calendar.ics';
    await field.fill(link);
    await field.press('Enter');
    await expect.poll(() => posts).toEqual([{ connect: 'calendar', ics: link }]);
    expect(await page.content()).not.toContain('abc/def');
    await expect(page.getByTestId('cal-link')).toContainText('Outlook');
    await expect(page.getByTestId('cal-link')).not.toContainText('STACK_CALENDAR_ICS');
  });

  // @req FR:connect-accounts/web.setup @req FR:connect-accounts/web.manual @req FR:connect-accounts/web.signin
  test('setup needed: Other ways is open with Run setup; then Add account with a device code', async ({ page }) => {
    const m = await open(page, { setup: false, accounts: [] });
    m.connect!.setup = 'needs-azure-signin';
    m.connect!.session = { id: 's1', method: 'device', state: 'waiting', userCode: 'ABCD-1234', verificationUri: 'https://microsoft.com/devicelogin' };
    m.connect!.polls = [{ id: 's1', method: 'device', state: 'done', account: 'me@outlook.com' }];
    await expect(page.getByRole('button', { name: 'Other ways to connect' })).toHaveAttribute('aria-expanded', 'true');
    await expect(page.getByRole('button', { name: 'Add account' })).toBeDisabled();
    await page.getByRole('button', { name: 'Run setup' }).click();
    await expect(page.getByTestId('connect-setup')).toContainText('Sign in to Azure once: open PowerShell, run Connect-AzAccount, then click Run setup again.');
    m.connect!.setup = 'done';
    await page.getByRole('button', { name: 'Run setup' }).click();
    await page.getByRole('button', { name: 'Add account' }).click();
    await expect(page.getByTestId('connect-code')).toHaveText('ABCD-1234');
    await page.clock.runFor(2500);
    await expect(row(page, 'me@outlook.com')).toContainText('Connected');
  });

  // @req FR:connect-accounts/web.nocmd @req FR:product-reset/connect.rule
  test('no command, script, env var or docs path in Settings', async ({ page }) => {
    await open(page);
    await page.getByRole('button', { name: 'Other ways to connect' }).click();
    const text = await page.getByTestId('settings').innerText();
    expect(text).not.toMatch(/\bstack (web|graph|asks|task|report)\b|\.ps1\b|\b(npm|pnpm|npx|az|gh) |\bSTACK_[A-Z_]+|docs\/|runbook|\bterminal\b/);
  });
});

test.describe('Settings: entry, agents, updates', () => {
  // @req FR:settings/view.entry @req FR:settings/view.route
  test('the rail footer (desktop) or More (phone) opens Settings', async ({ page }, info) => {
    const m = await mockApi(page, { tasks: seed() });
    m.connect = { info: { setup: { clientId: true }, accounts: [] } };
    await page.goto('/#/now');
    if (info.project.name === 'desktop') {
      await page.locator('.rail').getByRole('button', { name: /Settings/ }).click();
    } else {
      await page.getByRole('button', { name: /^More/ }).click();
      await page.getByRole('combobox', { name: 'Command' }).fill('settings');
      await page.getByRole('option', { name: /Go to Settings/ }).click();
    }
    await expect(page).toHaveURL(/#\/settings$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
  });

  // @req FR:settings/agents.state @req FR:settings/agents.api @req FR:settings/agents.off
  test('Agents: delivery and Claude sign-in; Sign in to Claude starts it; a host without delivery says so', async ({ page }) => {
    await open(page);
    let login = 0;
    // After mockApi: the last route registered wins.
    await page.route('**/api/inbox/delivery/login', (r) => { login++; return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ started: true }) }); });
    await expect(page.locator('#settings-agents')).toContainText('Agents answer from Stack on your Mac.');
    await page.route('**/api/inbox/delivery', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ mode: 'off', login: 'expired' }) }));
    await page.reload();
    const agents = page.getByTestId('settings-agents');
    await expect(agents).toContainText('DeliveryOff');
    await expect(agents).toContainText('Claude sign-inSign-in expired');
    await expect(page.locator('#settings-agents')).toContainText('Turn it on in Stack settings on your Mac.');
    await page.getByRole('button', { name: 'Sign in to Claude' }).click();
    await expect(page.locator('#settings-agents')).toContainText('Finish signing in in your browser.');
    expect(login).toBe(1);
  });

  // @req FR:settings/updates.modes @req FR:settings/updates.builds @req FR:settings/updates.none
  test('Updates: four modes in plain words; picking one saves; no installer says so', async ({ page }) => {
    const state = { running: { version: '0.0.1', sha: 'abc1234', dirty: false, builtAt: '2026-11-12T08:00:00Z' }, available: null, ready: false, mode: 'on-quit', idleMinutes: 30, canRestart: true, last: null };
    const modes: unknown[] = [];
    await open(page, { local: true });
    await expect(page.locator('#settings-updates')).toContainText('Updates come with the desktop app.');
    await page.route('**/api/version', (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(state) }));
    await page.route('**/api/version/mode', (r) => { const b = r.request().postDataJSON(); modes.push(b); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ...state, mode: b.mode }) }); });
    await page.reload();
    const u = page.getByTestId('settings-updates');
    await expect(u.getByRole('radio')).toHaveCount(4);
    await expect(u.getByRole('radio', { name: 'When I quit Stack (recommended)' })).toBeChecked();
    await u.getByRole('radio', { name: 'Only when I select Restart' }).click();
    await expect.poll(() => modes).toEqual([{ mode: 'ask' }]);
    await expect(u.getByRole('radio', { name: 'Only when I select Restart' })).toBeChecked();
    await expect(page.locator('#settings-updates')).toContainText('Saved');
    await expect(page.locator('#settings-updates')).toContainText('Up to date');
  });
});

for (const scheme of ['light', 'dark'] as const) {
  // @req FR:settings/view.fit
  test(`Settings (${scheme}): axe clean with a menu open, no sideways scroll, touch targets`, async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: scheme });
    await open(page, { local: true });
    await page.getByRole('button', { name: 'Other ways to connect' }).click();
    expect(await axe(page)).toEqual([]);
    expect(await noScrollX(page)).toBe(true);
    if (info.project.name === 'mobile') await tall(page);
    await page.getByRole('button', { name: 'More for michael@xerilium.com' }).click();
    expect(await axe(page)).toEqual([]);
    await page.screenshot({ path: `e2e/screenshots/settings-${scheme}-${info.project.name}.png`, fullPage: true });
  });
}
