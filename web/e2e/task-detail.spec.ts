/** My day rows, the task detail, and the shared message composer. Spec: `.xe/features/task-detail-design/spec.md`. */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mockApi, type MockTask } from './mock';

const at = (h: number, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d; };
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const mon = (d: Date) => d.toLocaleString('en-US', { month: 'short' });
const row = (ref: string, text: string): MockTask => ({ ref, text, project: 'alpha', section: '🔄 Active', done: false, depth: 0, notes: [] });
const TEAM = [
  { slug: 'cos', name: 'CoS', role: 'Chief of Staff', scope: ['*'], mode: 'long-running', prompt: '', defined: true, source: 'claude', projects: ['alpha'] },
  { slug: 'alpha-lead', name: 'Alpha Lead', role: 'owns alpha', scope: ['alpha'], mode: 'ad-hoc', prompt: '', defined: true, source: 'stack', projects: ['alpha'], reportsTo: 'cos' },
  { slug: 'scribe', name: 'Scribe', role: 'writes', scope: ['*'], mode: 'ad-hoc', prompt: '', defined: true, source: 'stack', projects: ['alpha'], reportsTo: 'cos' },
];
const DUE = `${mon(at(0))} ${at(0).getDate()}`;

async function open(page: Page) {
  await page.clock.install({ time: at(10) });
  const m = await mockApi(page, { tasks: [row('alpha:1', `🚨 📅 ${DUE}: Answer the acks 🟢`), row('alpha:2', 'Write the notes 🟡')], projects: [{ name: 'alpha', title: 'Alpha' }] });
  m.team = TEAM as never; m.sessions = [];
  m.schedule = { timezone: 'UTC', date: ymd(at(0)), wake: at(8).toISOString(), bed: at(23).toISOString(), asleep: false, blocks: [] };
  await page.goto('/#/today');
  await page.clock.resume();
  const first = page.locator('[data-testid="plan"] .block').filter({ hasText: 'Answer the acks' });
  await expect(first).toBeVisible();
  return { m, first };
}
const detail = (page: Page) => page.getByRole('dialog', { name: 'Task detail' });

test.describe('My day rows', () => {
  // @req FR:task-detail-design/detail.open @req FR:task-detail-design/rules.clickable
  test('one click opens the detail; the row looks clickable and ends in a chevron', async ({ page }) => {
    const { first } = await open(page);
    const body = first.locator('.what');
    expect(await body.evaluate((e) => getComputedStyle(e).cursor)).toBe('pointer');
    await expect(first.locator('.chev')).toBeVisible();
    await first.locator('.what-title').click();
    await expect(detail(page)).toBeVisible();
    await expect(detail(page).getByRole('heading', { level: 1 })).toContainText('Answer the acks');
  });

  // @req FR:task-detail-design/detail.open
  test('Enter on a focused row opens the detail', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'keyboard');
    const { first } = await open(page);
    await first.getByRole('button', { name: /^Open Answer the acks/ }).focus();
    await page.keyboard.press('Enter');
    await expect(detail(page)).toBeVisible();
  });

  // @req FR:task-detail-design/myday.message @req FR:task-detail-design/myday.nodelegate @req FR:home/myday.actions
  test('no Delegate; the message icon opens the composer addressed to the owning agent', async ({ page }) => {
    const { first } = await open(page);
    await expect(first.getByRole('button', { name: 'Delegate' })).toHaveCount(0);
    const msg = first.getByRole('button', { name: 'Message Alpha Lead' });
    await expect(msg).toHaveAttribute('title', 'Message Alpha Lead');
    await msg.click();
    const box = detail(page).getByRole('textbox', { name: /Message Alpha Lead/ });
    await expect(box).toBeFocused();
    await expect(box).toHaveAttribute('placeholder', 'Message Alpha Lead…');
  });
});

test.describe('Task detail', () => {
  // @req FR:task-detail-design/detail.actions @req FR:task-detail-design/rules.nokeys
  test('actions are plain verbs with an outcome line and no key badges', async ({ page }) => {
    const { first } = await open(page);
    await first.locator('.what-title').click();
    const d = detail(page);
    await expect(d.locator('button kbd:visible')).toHaveCount(0);
    const done = d.getByRole('button', { name: 'Done', exact: true });
    await expect(done).toHaveAttribute('title', 'Done: checks it off; Undo for 8 s');
    await done.focus();
    await expect(d.getByTestId('action-hint')).toHaveText('Done: checks it off; Undo for 8 s');
  });

  // @req FR:task-detail-design/detail.priority @req FR:task-detail-design/detail.save @req FR:task-detail-design/detail.undo @req FR:task-detail-design/a11y.names
  test('priority is a picker that saves with Undo and a Saved state', async ({ page }) => {
    const { m, first } = await open(page);
    await first.locator('.what-title').click();
    const pri = detail(page).getByRole('button', { name: 'Priority: Critical' });
    await expect(pri).toHaveAttribute('aria-haspopup', 'listbox');
    await pri.click();
    await detail(page).getByRole('option', { name: 'High' }).click();
    await expect.poll(() => m.calls.find((c) => c.path === '/tasks/set')?.body).toEqual({ ref: 'alpha:1', priority: '‼️', expect: `🚨 📅 ${DUE}: Answer the acks 🟢` });
    await expect(detail(page).getByText('Saved', { exact: true })).toBeVisible();
    await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => m.calls.filter((c) => c.path === '/tasks/set').at(-1)?.body).toEqual({ ref: 'alpha:1', priority: '🚨', expect: `‼️ 📅 ${DUE}: Answer the acks 🟢` }); // pinned to what the set wrote
  });

  // @req FR:task-detail-design/detail.save — /tasks/set does not take 🔹: Undo restores the row text, checked against the task text set wrote
  test('Undo after changing a 12-minute effort restores the row text', async ({ page }) => {
    await page.clock.install({ time: at(10) });
    const m = await mockApi(page, { tasks: [row('alpha:1', 'Quick fix 🔹')], projects: [{ name: 'alpha', title: 'Alpha' }] });
    m.team = TEAM as never; m.sessions = [];
    m.schedule = { timezone: 'UTC', date: ymd(at(0)), wake: at(8).toISOString(), bed: at(23).toISOString(), asleep: false, blocks: [] };
    await page.goto('/#/today');
    await page.clock.resume();
    await page.locator('[data-testid="plan"] .block .what-title').first().click();
    await detail(page).getByRole('button', { name: 'Effort: 12 min' }).click();
    await detail(page).getByRole('option', { name: '1 hour' }).click();
    await expect.poll(() => m.calls.find((c) => c.path === '/tasks/set')?.body).toEqual({ ref: 'alpha:1', effort: '🟡', expect: 'Quick fix 🔹' });
    await page.locator('.toast').getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => m.calls.find((c) => c.path === '/tasks/edit')?.body).toEqual({ ref: 'alpha:1', text: 'Quick fix 🔹', expect: 'Quick fix 🟡' });
    await expect.poll(() => m.tasks[0].text).toBe('Quick fix 🔹');
  });

  // @req FR:task-detail-design/detail.effort
  test('effort takes a custom time and says what it saved', async ({ page }) => {
    const { m, first } = await open(page);
    await first.locator('.what-title').click();
    await detail(page).getByRole('button', { name: 'Effort: 30 min' }).click();
    await detail(page).getByLabel('Custom minutes').fill('45');
    await detail(page).getByRole('button', { name: 'Set', exact: true }).click();
    await expect.poll(() => m.calls.find((c) => c.path === '/tasks/set')?.body).toMatchObject({ ref: 'alpha:1', effort: '🟡' });
    await expect(page.locator('.toast')).toContainText('Saved as 1 hour');
  });

  // @req FR:task-detail-design/detail.due @req FR:task-detail-design/rules.facts @req FR:task-detail-design/detail.facts
  test('the date says Due, opens a date picker, and clears with No date', async ({ page }) => {
    const { m, first } = await open(page);
    await first.locator('.what-title').click();
    const due = detail(page).getByRole('button', { name: `Due ${DUE}` });
    await due.click();
    // A typed date saves only on Set: partial values never write.
    const next = new Date(at(0).getFullYear(), 11, 20);
    await detail(page).locator('input[type="date"]').fill(ymd(next));
    expect(m.calls.filter((c) => c.path === '/tasks/edit')).toEqual([]);
    await detail(page).getByRole('button', { name: 'Set', exact: true }).click();
    await expect.poll(() => m.calls.find((c) => c.path === '/tasks/edit')?.body.text).toBe('🚨 📅 Dec 20: Answer the acks 🟢');
    await detail(page).getByRole('button', { name: 'Due Dec 20' }).click();
    await detail(page).getByRole('button', { name: 'No date' }).click();
    await expect.poll(() => m.calls.filter((c) => c.path === '/tasks/edit').at(-1)?.body.text).toBe('🚨 Answer the acks 🟢');
    await expect(detail(page).getByRole('button', { name: 'No due date' })).toBeVisible();
    // Project and section are facts: plain text, not chips.
    await expect(detail(page).locator('.fl-facts .chip, .fl-facts button')).toHaveCount(0);
  });

  // @req FR:task-detail-design/detail.undo @req FR:task-detail-design/a11y.names
  test('Tab reaches the toast Undo while the detail is open', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'keyboard');
    const { m, first } = await open(page);
    await first.locator('.what-title').click();
    await detail(page).getByRole('button', { name: 'Priority: Critical' }).click();
    await detail(page).getByRole('option', { name: 'High' }).click();
    const undo = page.locator('.toast').getByRole('button', { name: 'Undo' });
    await expect(undo).toBeVisible();
    let reached = false;
    for (let i = 0; i < 40 && !reached; i++) { await page.keyboard.press('Tab'); reached = await undo.evaluate((e) => e === document.activeElement); }
    expect(reached).toBe(true);
    await page.keyboard.press('Enter');
    await expect.poll(() => m.calls.filter((c) => c.path === '/tasks/set').at(-1)?.body.priority).toBe('🚨');
  });

  // @req FR:task-detail-design/detail.facts
  test('a bare URL lifted out of the title stays a link in the detail', async ({ page }) => {
    await page.clock.install({ time: at(10) });
    const m = await mockApi(page, { tasks: [row('alpha:1', 'File taxes @ https://dor.wa.gov/file-pay-taxes')], projects: [{ name: 'alpha', title: 'Alpha' }] });
    m.team = TEAM as never; m.sessions = [];
    m.schedule = { timezone: 'UTC', date: ymd(at(0)), wake: at(8).toISOString(), bed: at(23).toISOString(), asleep: false, blocks: [] };
    await page.goto('/#/today');
    await page.clock.resume();
    await page.locator('[data-testid="plan"] .block .what-title').first().click();
    await expect(detail(page).getByRole('link', { name: /dor\.wa\.gov/ })).toHaveAttribute('href', 'https://dor.wa.gov/file-pay-taxes');
  });
});

test.describe('Row links', () => {
  // @req FR:task-detail-design/detail.open
  test('a markdown link in a title is its own control: never inside the open button, and a click does not open the detail', async ({ page }) => {
    await page.clock.install({ time: at(10) });
    const m = await mockApi(page, { tasks: [row('alpha:1', 'Read [the spec](https://example.com/spec) 🟠')], projects: [{ name: 'alpha', title: 'Alpha' }] });
    m.team = TEAM as never; m.sessions = [];
    m.schedule = { timezone: 'UTC', date: ymd(at(0)), wake: at(8).toISOString(), bed: at(23).toISOString(), asleep: false, blocks: [] };
    await page.goto('/#/today');
    await page.clock.resume();
    const b = page.locator('[data-testid="plan"] .block').first();
    await expect(b.locator('button a')).toHaveCount(0);
    const link = b.getByRole('link', { name: /the spec/ });
    await expect(link).toHaveAttribute('href', 'https://example.com/spec');
    await page.context().route('https://example.com/**', (r) => r.fulfill({ status: 200, body: '' }));
    await link.click();
    await expect(detail(page)).toHaveCount(0);
  });
});

test.describe('Composer', () => {
  // @req FR:task-detail-design/compose.to @req FR:task-detail-design/compose.text
  test('agents are avatar chips, owner first; others behind + Other agent', async ({ page }) => {
    const { first } = await open(page);
    await first.locator('.what-title').click();
    const c = detail(page).getByRole('group', { name: 'Message' });
    await expect(c.locator('select')).toHaveCount(0);
    const chips = c.getByRole('button', { pressed: true });
    await expect(chips).toHaveCount(1);
    await expect(chips).toHaveAccessibleName('Alpha Lead');
    await c.getByRole('button', { name: '+ Other agent' }).click();
    await c.getByRole('menuitem', { name: /Chief of Staff/ }).click();
    await expect(c.getByRole('button', { pressed: true })).toHaveAccessibleName('Chief of Staff');
    await expect(c.getByRole('textbox')).toHaveAttribute('placeholder', 'Message Chief of Staff…');
    await expect(c.locator('.avatar').first()).toBeVisible();
  });

  // @req FR:task-detail-design/compose.mode @req FR:task-detail-design/compose.doit @req FR:task-detail-design/compose.nokeep
  test('Ask | Do it explains itself; Do it assigns with the note, which shows in the thread', async ({ page }) => {
    const { m, first } = await open(page);
    await first.locator('.what-title').click();
    const c = detail(page).getByRole('group', { name: 'Message' });
    await expect(c.getByLabel(/Keep/)).toHaveCount(0);
    for (const old of ['Assign', 'Review']) await expect(c.getByRole('button', { name: old })).toHaveCount(0);
    const mode = c.getByRole('radiogroup', { name: 'What should Alpha Lead do?' });
    await expect(mode.getByRole('radio', { name: 'Ask' })).toBeChecked();
    await expect(c.getByTestId('mode-hint')).toHaveText('Ask: Alpha Lead answers here; nothing changes on the task.');
    await mode.getByRole('radio', { name: 'Do it' }).click();
    await expect(c.getByTestId('mode-hint')).toHaveText('Do it: Alpha Lead takes the task and starts work; your note goes with it.');
    await c.getByRole('textbox').fill('Use the short version');
    await c.getByRole('button', { name: 'Do it', exact: true }).last().click();
    // The note rides in the assign prompt; the thread keeps a handled record of it.
    await expect.poll(() => m.calls.find((c2) => c2.path === '/tasks/alpha:1/assign')?.body).toEqual({ agent: 'alpha-lead', note: 'Use the short version' });
    await expect(detail(page).locator('.th-text.you')).toHaveText('Use the short version');
    expect(m.calls.filter((c2) => c2.path === '/inbox')).toEqual([]); // the server records it, not the page
  });
});

test.describe('Access', () => {
  // @req FR:task-detail-design/a11y.targets @req FR:task-detail-design/rules.nokeys
  for (const scheme of ['light', 'dark'] as const) {
    test(`My day and the detail pass axe with 44 px touch targets (${scheme})`, async ({ page }, info) => {
      await page.emulateMedia({ colorScheme: scheme });
      const { first } = await open(page);
      const check = async () => {
        await page.waitForFunction(() => document.getAnimations().every((a) => a.playState !== 'running')); // axe reads colors mid-fade otherwise
        const { violations } = await new AxeBuilder({ page }).analyze();
        const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').flatMap((v) => v.nodes.map((n) => `${v.id} ${n.target.join(' ')}`));
        expect(bad, bad.join('\n')).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
        // Every impact, not only serious: the rows and the detail this PR owns.
        const { violations: all } = await new AxeBuilder({ page }).include('[data-testid="plan"]').include('.focus-mode').analyze();
        expect(all.flatMap((v) => v.nodes.map((n) => `${v.id} ${n.target.join(' ')}`))).toEqual([]);
      };
      await check();
      await expect(page.locator('.main button kbd:visible, .main [role="menuitem"] kbd:visible, .main a.btn kbd:visible')).toHaveCount(0);
      await first.locator('.what-title').click();
      await check();
      if (info.project.name === 'mobile') {
        const small = await detail(page).locator('button:visible, input:visible, [role="radio"]:visible').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height < 44).map((e) => e.outerHTML.slice(0, 80)));
        expect(small).toEqual([]);
        const rowSmall = await first.locator('button:visible').evaluateAll((els) => els.filter((e) => e.getBoundingClientRect().height < 44).map((e) => e.outerHTML.slice(0, 80)));
        expect(rowSmall).toEqual([]);
      }
      await page.screenshot({ path: `e2e/screenshots/task-detail-${scheme}-${info.project.name}.png`, fullPage: true });
    });
  }
});
