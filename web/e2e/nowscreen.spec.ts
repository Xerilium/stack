/** Now: one task, one reason, Done / Defer with Undo, a message composer to the task's agent, an empty state. */
import { expect, test } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import { mockApi, seed, type MockAsk } from './mock';

const ask = (key: string, from: string, score: number, extra: Partial<MockAsk> = {}): MockAsk => ({ key, state: 'open', ask: `Ask ${key}`, kind: 'approve', from, reversible: true, priority: 'normal', blocks: 0, created: '2026-11-05T09:00:00Z', updated: '2026-11-05T09:00:00Z', score, overdue: false, recommend: 'Go ahead', ...extra });

const ten = async (page: import('@playwright/test').Page) => { const d = new Date(); d.setHours(10, 0, 0, 0); await page.clock.setFixedTime(d); };

test.describe('Now screen', () => {
  // @req FR:now-screen/now.one @req FR:now-screen/now.why @req FR:now-screen/now.layout
  test('shows the one task, one reason, three actions, and nothing else', async ({ page }, info) => {
    await ten(page);
    await mockApi(page, { tasks: seed() });
    await page.goto('/#/now');
    const now = page.getByTestId('now');
    await expect(now.getByRole('heading', { level: 1 })).toHaveText('Ship the web app'); // the task Home shows
    await expect(page.getByTestId('now-why')).toHaveText(/^due today · high priority · fits your /);
    expect((await page.getByTestId('now-why').innerText()).length).toBeLessThanOrEqual(60);
    await expect(now.getByRole('group', { name: 'Actions' }).getByRole('button')).toHaveText([/^Done/, /^Defer/]);
    expect(await now.locator('li, table').count()).toBe(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // the action targets are 44 px on touch
    if (info.project.name === 'mobile') for (const b of await now.getByRole('button').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.waitForTimeout(400); // past the enter motion
    await page.screenshot({ path: `e2e/screenshots/now-${info.project.name}.png` });
  });

  // @req FR:now-screen/now.actions @req FR:now-screen/now.undo @req FR:now-screen/now.next
  test('Done completes, shows the next task, and Undo brings the first back', async ({ page }) => {
    await ten(page);
    const m = await mockApi(page, { tasks: seed() });
    await page.goto('/#/now');
    await page.getByRole('button', { name: /^Done/ }).click();
    await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('Ship the web app'); // the next one takes its place
    expect(m.calls.some((c) => c.path === '/tasks/complete' && c.body.ref === 'alpha:6')).toBe(true);
    await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ship the web app');
  });

  test('Defer parks the row for 2 hours; Undo resumes it', async ({ page }) => {
    await ten(page);
    const m = await mockApi(page, { tasks: seed() });
    await page.goto('/#/now');
    await page.getByRole('button', { name: /^Defer/ }).click();
    expect(m.calls.some((c) => c.path === '/tasks/suspend' && c.body.hours === 2)).toBe(true);
    await expect(page.getByRole('heading', { level: 1 })).not.toHaveText('Ship the web app');
    await expect(page.getByRole('status')).toContainText('Deferred 2h');
    await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ship the web app');
  });

  // @req FR:now-screen/now.compose @req FR:now-screen/now.thread @req FR:now-screen/now.undo @req FR:agent-team/web.avatar @req FR:now-screen/now.a11y
  test('the composer messages the task agent: Enter sends the instruction and 🪄 in one step; bubbles show; Undo withdraws both', async ({ page }, info) => {
    await ten(page);
    const m = await mockApi(page, { tasks: seed() });
    m.team = [
      { slug: 'cos', name: 'Chief of Staff', scope: ['*'], mode: 'ad-hoc', prompt: '', defined: true, projects: ['alpha', 'beta'] },
      { slug: 'alpha-lead', name: 'Ada Lead', scope: ['alpha'], mode: 'ad-hoc', prompt: '', defined: true, projects: ['alpha'], reportsTo: 'cos' },
    ];
    m.inbox.push(
      { id: 'in-20261101T100000Z-aaaa', at: '2026-11-01T10:00:00Z', project: 'alpha', ref: 'alpha:6', task: 'Ship the web app', kind: 'instruction', to: 'agent', text: 'Start with the login page', state: 'handled', row: 'alpha:6' },
      { id: 'in-20261101T110000Z-bbbb', at: '2026-11-01T11:00:00Z', project: 'alpha', ref: 'alpha:6', task: 'Ship the web app', kind: 'reply', to: 'human', from: 'agent', agent: 'alpha-lead', text: 'Login page is in PR 12', state: 'handled', row: 'alpha:6' },
    );
    await page.goto('/#/now');
    const now = page.getByTestId('now');
    await expect(now.getByRole('button', { name: /Delegate/ })).toHaveCount(0);
    const box = now.getByRole('textbox', { name: 'Message Ada Lead' }); // the project's agent, not the roll-up
    await expect(box).toHaveAttribute('placeholder', 'Message Ada Lead…');
    const chat = page.getByTestId('now-chat');
    await expect(chat.locator('form svg.avatar')).toContainText('AL');
    const thread = page.getByTestId('now-thread');
    await expect(thread.locator('li')).toHaveCount(2);
    await expect(thread.locator('li.from-me')).toContainText('Start with the login page');
    await expect(thread.locator('li.from-agent')).toContainText('Ada Lead');
    await expect(thread.locator('li.from-agent')).toContainText('Login page is in PR 12');
    await expect(thread.locator('li.from-agent svg.avatar')).toHaveCount(1);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (info.project.name === 'mobile') {
      for (const b of await now.getByRole('button').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect((await box.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    await box.fill('x');
    const axe = await new AxeBuilder({ page }).include('[data-testid="now"]').analyze();
    expect(axe.violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target).join(' ')}`)).toEqual([]);
    await box.fill('');
    // Shift+Enter is a new line; Enter sends
    await box.pressSequentially('Use the new logo');
    await box.press('Shift+Enter');
    await box.pressSequentially('then ship to staging');
    await expect(box).toHaveValue('Use the new logo\nthen ship to staging');
    await page.waitForTimeout(400);
    await page.screenshot({ path: `e2e/screenshots/now-chat-${info.project.name}.png` });
    await box.press('Enter');
    await expect.poll(() => m.calls.find((c) => c.path === '/inbox')?.body).toMatchObject({ ref: 'alpha:6', kind: 'instruction', text: 'Use the new logo / then ship to staging' });
    // the mark goes first, so the entry is addressed to the agent
    const edit = m.calls.findIndex((c) => c.path === '/tasks/edit'); const send = m.calls.findIndex((c) => c.path === '/inbox');
    expect(edit).toBeGreaterThanOrEqual(0); expect(edit).toBeLessThan(send);
    expect(m.inbox.at(-1)!.to).toBe('agent');
    await expect.poll(() => m.tasks.find((t) => t.ref === 'alpha:6')!.text.startsWith('🪄')).toBe(true);
    await expect(page.getByTestId('now-thread')).toContainText('Use the new logo');
    await expect(page.getByRole('status')).toContainText('Sent to Ada Lead');
    await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => m.tasks.find((t) => t.ref === 'alpha:6')!.text.startsWith('🪄')).toBe(false);
    await expect.poll(() => m.calls.find((c) => c.path === '/inbox/handled')?.body).toMatchObject({ note: 'Withdrawn by the owner', withdrawn: true });
    // Undo means never sent: the bubble goes at once, without waiting for the poll
    await expect(page.getByTestId('now-thread')).not.toContainText('Use the new logo', { timeout: 3000 });
  });

  // @req FR:now-screen/now.undo: Undo after the agent handled the message keeps it and says so
  test('Undo after the agent picked up a message keeps the bubble and says so', async ({ page }) => {
    await ten(page);
    const m = await mockApi(page, { tasks: seed() });
    m.team = [{ slug: 'alpha-lead', name: 'Ada Lead', scope: ['alpha'], mode: 'ad-hoc', prompt: '', defined: true, projects: ['alpha'] }];
    await page.goto('/#/now');
    const box = page.getByTestId('now').getByRole('textbox', { name: 'Message Ada Lead' });
    await box.fill('Use the new logo');
    await box.press('Enter');
    await expect(page.getByRole('status')).toContainText('Sent to Ada Lead');
    await expect.poll(() => m.inbox.length).toBe(1);
    m.inbox[0]!.state = 'handled'; // the agent took it inside the Undo window
    await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
    await expect(page.getByRole('status')).toContainText('Restored; the agent already picked it up');
    await expect(page.getByTestId('now-thread')).toContainText('Use the new logo');
  });

  // @req FR:agent-team/web.avatar: an emoji icon shows; a missing image falls back to the monogram
  test('the composer avatar uses the agent icon, and a missing image falls back to the monogram', async ({ page }) => {
    await ten(page);
    const m = await mockApi(page, { tasks: seed() });
    m.team = [{ slug: 'alpha-lead', name: 'Ada Lead', scope: ['alpha'], mode: 'ad-hoc', prompt: '', defined: true, projects: ['alpha'], icon: '/agents/missing.png' } as never];
    await page.goto('/#/now');
    await expect(page.getByTestId('now-chat').locator('form svg.avatar')).toContainText('AL');
  });

  // @req FR:now-screen/now.compose: a live session offers its chat
  test('a task with a live agent session offers Open live chat', async ({ page }) => {
    await ten(page);
    const m = await mockApi(page, { tasks: seed() });
    m.team = [{ slug: 'alpha-lead', name: 'Ada Lead', scope: ['alpha'], mode: 'ad-hoc', prompt: '', defined: true, projects: ['alpha'] }];
    m.sessions = [{ id: 'a1b2c3d4-0000-0000-0000-000000000001', title: 'Ada Lead · alpha:6', project: 'alpha', owner: 'alpha', cwd: '/x/alpha', lastActive: new Date().toISOString(), state: 'active', cost: { usd: 0, tokens: 10 }, prs: [] }];
    await page.goto('/#/now');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ship the web app');
    await expect(page.getByRole('button', { name: 'Open live chat' })).toBeVisible();
  });

  // @req FR:now-screen/now.compose: a row an agent already has keeps its mark; only the text goes
  test('a row with 🪄 keeps its mark: the message only writes the inbox; Undo only withdraws it', async ({ page }) => {
    await ten(page);
    const tasks = seed();
    const t = tasks.find((x) => x.ref === 'alpha:6')!; t.text = `🪄 ${t.text}`;
    const m = await mockApi(page, { tasks });
    await page.goto('/#/now');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ship the web app');
    const box = page.getByRole('textbox', { name: /^Message / });
    await expect(box).toHaveAttribute('placeholder', 'Message the agent…'); // no team: a plain address
    await box.fill('Ping me when done');
    await box.press('Enter');
    await expect.poll(() => m.calls.find((c) => c.path === '/inbox')?.body?.text).toBe('Ping me when done');
    expect(m.calls.some((c) => c.path === '/tasks/edit')).toBe(false);
    await page.getByRole('status').getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => m.calls.find((c) => c.path === '/inbox/handled')?.body?.id).toBe(m.inbox.at(-1)!.id);
    expect(m.calls.some((c) => c.path === '/tasks/edit')).toBe(false);
    expect(m.tasks.find((x) => x.ref === 'alpha:6')!.text.startsWith('🪄')).toBe(true);
  });

  // @req FR:now-screen/now.compose: a failed inbox write takes the 🪄 back off
  test('a failed send reverts the mark', async ({ page }) => {
    await ten(page);
    const m = await mockApi(page, { tasks: seed() });
    m.fail.set('POST /inbox', { status: 500, code: 'internal', message: 'Disk full' });
    await page.goto('/#/now');
    const box = page.getByRole('textbox', { name: /^Message / });
    await box.fill('Do it');
    await box.press('Enter');
    await expect(page.getByRole('status')).toContainText('Disk full');
    await expect.poll(() => m.calls.filter((c) => c.path === '/tasks/edit').length).toBe(2);
    expect(m.tasks.find((x) => x.ref === 'alpha:6')!.text.startsWith('🪄')).toBe(false);
    await expect(box).toHaveValue('Do it'); // the text stays for a retry
  });

  // @req FR:now-screen/now.thread: stored Markdown escapes never show; an agent reply appears without a send
  test('the thread shows unescaped text and picks up a new reply on its own', async ({ page }) => {
    const d = new Date(); d.setHours(10, 0, 0, 0); await page.clock.install({ time: d });
    const m = await mockApi(page, { tasks: seed() });
    m.inbox.push({ id: 'in-1', at: '2026-11-05T09:00:00Z', project: 'alpha', ref: 'alpha:6', row: 'alpha:6', task: 'Ship the web app', kind: 'instruction', to: 'agent', text: 'Use \\[logo\\] here', state: 'open' });
    await page.goto('/#/now');
    const thread = page.getByTestId('now-thread');
    await expect(thread).toContainText('Use [logo] here');
    await expect(thread).not.toContainText('\\[');
    m.inbox.push({ id: 'in-2', at: '2026-11-05T09:05:00Z', project: 'alpha', ref: 'alpha:6', row: 'alpha:6', task: 'Ship the web app', kind: 'reply', to: 'human', text: 'On it', state: 'open', from: 'agent', agent: 'alpha-lead' });
    await page.clock.runFor(11_000);
    await expect(thread).toContainText('On it');
  });

  // @req FR:now-screen/now.compose: a draft typed while a send is in flight survives it
  test('text typed during a send is kept', async ({ page }) => {
    await ten(page);
    const m = await mockApi(page, { tasks: seed() });
    let release = () => {};
    const gate = new Promise<void>((r) => { release = r; });
    await page.route('**/api/inbox', async (route) => { await gate; await route.fallback(); });
    await page.goto('/#/now');
    const box = page.getByRole('textbox', { name: /^Message / });
    await box.fill('First');
    await box.press('Enter');
    await box.fill('Second draft');
    release();
    await expect.poll(() => m.calls.filter((c) => c.path === '/inbox').length).toBe(1);
    await expect(page.getByRole('status')).toContainText('Sent to');
    await expect(box).toHaveValue('Second draft');
  });

  // @req FR:now-screen/now.compose (keys)
  test('m focuses the composer; Esc leaves it; Shift+A still delegates', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'keys are for desktop');
    await ten(page);
    const m = await mockApi(page, { tasks: seed() });
    await page.goto('/#/now');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ship the web app');
    await page.keyboard.press('m');
    const box = page.getByRole('textbox', { name: /^Message / });
    await expect(box).toBeFocused();
    await expect(box).toHaveValue('');
    await page.keyboard.press('Escape');
    await expect(box).not.toBeFocused();
    await page.keyboard.press('Shift+A');
    await expect.poll(() => m.tasks.find((t) => t.ref === 'alpha:6')!.text.startsWith('🪄')).toBe(true);
    expect(m.calls.some((c) => c.path === '/inbox')).toBe(false);
  });

  // @req FR:now-screen/now.actions (desktop keys)
  test('keys d / n act on the task', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'keys are for desktop');
    await ten(page);
    const m = await mockApi(page, { tasks: seed() });
    await page.goto('/#/now');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Ship the web app');
    await page.keyboard.press('d');
    await expect.poll(() => m.calls.some((c) => c.path === '/tasks/complete')).toBe(true);
  });

  // @req FR:now-screen/now.empty
  test('empty state: Nothing now, no buttons', async ({ page }, info) => {
    await ten(page);
    await mockApi(page, { tasks: [] });
    await page.goto('/#/now');
    await expect(page.getByTestId('now-empty')).toContainText('Nothing now');
    await expect(page.getByTestId('now-empty')).toContainText('You are clear.');
    await expect(page.getByTestId('now-focus').getByRole('button')).toHaveCount(0); // the win state; the side may still offer a calendar fix
    await page.waitForTimeout(400); // past the enter motion
    await page.screenshot({ path: `e2e/screenshots/now-empty-${info.project.name}.png` });
  });

  test('dark theme', async ({ page }, info) => {
    await ten(page);
    await page.emulateMedia({ colorScheme: 'dark' });
    await mockApi(page, { tasks: seed() });
    await page.goto('/#/now');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.waitForTimeout(400); // past the enter motion
    await page.screenshot({ path: `e2e/screenshots/now-dark-${info.project.name}.png` });
  });

  // @req FR:ux-consolidation/one.meetings @req FR:ux-consolidation/one.messages @req FR:ux-consolidation/one.answer @req FR:ux-consolidation/one.focus @req FR:ux-consolidation/one.layout
  test('the one place: next meetings and top messages under the task; one tap answers', async ({ page }, info) => {
    const d = new Date(); d.setHours(10, 0, 0, 0); await page.clock.install({ time: d });
    const m = await mockApi(page, { tasks: seed() });
    const at = (h: number, mi = 0) => { const x = new Date(d); x.setHours(h, mi, 0, 0); return x.toISOString(); };
    m.events = [
      { id: 'e1', subject: 'Allyte sync', start: at(10, 5), end: at(10, 35), allDay: false, showAs: 'busy', cancelled: false, online: true, joinUrl: 'https://example.test/join' },
      { id: 'e2', subject: 'FOCUS TF1', start: at(13), end: at(14), allDay: false, showAs: 'busy', cancelled: false, online: true },
      { id: 'e3', subject: 'Third', start: at(15), end: at(16), allDay: false, showAs: 'busy', cancelled: false, online: false },
    ];
    m.asks = [ask('m1', 'email-triage', 50, { ask: 'Reply to Dana' }), ask('a1', 'Chief of Staff', 90, { ask: 'Approve the budget' }), ask('a2', 'cos', 80, { ask: 'Pick a venue' }), ask('a3', 'cos', 70, { ask: 'Fourth ask' })];
    await page.goto('/#/now');
    await page.clock.resume();
    const now = page.getByTestId('now');
    await expect(now.getByRole('heading', { level: 1 })).toHaveText('Ship the web app');
    // the first screen: task, reason, actions, then the two sections
    const meetings = page.getByTestId('now-meetings');
    await expect(meetings.locator('li')).toHaveCount(2);
    await expect(meetings).toContainText('Allyte sync');
    await expect(meetings).toContainText('in 5m');
    await expect(meetings.getByRole('link', { name: 'Join' })).toHaveAttribute('href', 'https://example.test/join');
    await expect(meetings).not.toContainText('Third');
    await expect(page.getByTestId('now-layer')).toHaveText(/Live calendar/);
    const waiting = page.getByTestId('now-asks');
    await expect(waiting.locator('li')).toHaveCount(3);
    await expect(waiting.locator('li').first()).toContainText('Reply to Dana'); // messages first
    await expect(waiting).toContainText('Approve the budget');
    await expect(waiting).not.toContainText('Fourth ask');
    await expect(page.getByRole('button', { name: '1 more in Needs you' })).toBeVisible();
    // only the task, the reason, and the actions sit above the first section head
    const sections = await now.locator('h2').count();
    expect(sections).toBe(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    if (info.project.name === 'mobile') for (const b of await now.locator('button, a.now-join').all()) expect((await b.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.waitForTimeout(400);
    await page.screenshot({ path: `e2e/screenshots/now-one-${info.project.name}.png`, fullPage: true });
    // one tap answers the message the same way Needs you does, and the line leaves
    await waiting.locator('li').first().getByRole('button', { name: 'Approve', exact: true }).click();
    await expect.poll(() => m.asks.find((a) => a.key === 'm1')?.state).toBe('answered');
    await expect(waiting).not.toContainText('Reply to Dana');
    await expect(page.getByRole('status')).toContainText('Sent to email-triage');
  });

  // @req FR:ux-consolidation/cal.fresh: only a fresh, connected calendar may say there are no meetings
  test('empty sections say so in one line', async ({ page }) => {
    await ten(page);
    const m = await mockApi(page, { tasks: seed() });
    m.events = [];
    await page.goto('/#/now');
    await expect(page.getByText('No meetings left today.')).toBeVisible();
    await expect(page.getByText('Nothing waiting.')).toBeVisible();
    await expect(page.getByRole('button', { name: /more in Needs you/ })).toHaveCount(0);
  });

  // @req FR:ux-consolidation/one.messages
  test('the more link opens Needs you', async ({ page }) => {
    await ten(page);
    const m = await mockApi(page, { tasks: seed() });
    m.asks = ['a1', 'a2', 'a3', 'a4'].map((k, i) => ask(k, 'cos', 90 - i));
    await page.goto('/#/now');
    await page.getByRole('button', { name: '1 more in Needs you' }).click();
    await expect(page).toHaveURL(/#\/asks/);
  });

  // @req FR:ux-consolidation/one.clamp
  test('a long title clamps; the full text is in the tooltip; actions stay on the first screen', async ({ page }, info) => {
    await ten(page);
    const long = 'Ship the web app (879 merged to dev Oct 29; must precede the FTK v15 announcement on Tue Nov 3, else delay that; the Sweep Manager merges, never ask the owner to merge; see the release notes and the runbook for the rest of the steps)';
    await mockApi(page, { tasks: [{ ...seed()[0], text: `‼️ ${long} 🟡` }] });
    await page.goto('/#/now');
    const h1 = page.getByTestId('now').getByRole('heading', { level: 1 });
    await expect(h1).toHaveAttribute('title', long);
    const lines = await h1.evaluate((el) => Math.round(el.getBoundingClientRect().height / parseFloat(getComputedStyle(el).lineHeight)));
    expect(lines).toBeLessThanOrEqual(info.project.name === 'mobile' ? 4 : 3);
    const done = (await page.getByRole('button', { name: /^Done/ }).boundingBox())!;
    expect(done.y + done.height).toBeLessThanOrEqual(info.project.name === 'mobile' ? 812 : 800);
  });

  // @req FR:ux-consolidation/nav.brief
  test('#/brief opens Now', async ({ page }) => {
    await ten(page);
    await mockApi(page, { tasks: seed() });
    await page.goto('/#/brief');
    await expect(page.getByTestId('now')).toBeVisible();
  });
});
