import { expect, test, type Page } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dateTag, mockApi, seed } from './mock';

const rows = (page: Page) => page.locator('.row .title');
const shot = (page: Page, name: string, info: { project: { name: string } }) => page.screenshot({ path: `e2e/screenshots/${name}-${info.project.name}.png`, fullPage: false });

test.describe('shell and security', () => {
  // @req FR:web-app/host.static @req FR:web-app/host.nosecrets
  test('built bundle holds no task data, secrets, or inline script', async () => {
    const dist = fileURLToPath(new URL('../dist', import.meta.url));
    const files = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(join(d, e.name)) : [join(d, e.name)]));
    const all = files(dist).filter((f) => !f.endsWith('.json')).map((f) => readFileSync(f, 'utf8')).join('\n');
    for (const t of seed()) expect(all).not.toContain(t.text.replace(/^[^A-Za-z]+/, '').slice(0, 12));
    expect(all).not.toMatch(/ghp_|github_pat_|Bearer /);
    expect(readFileSync(join(dist, 'index.html'), 'utf8')).not.toMatch(/<script(?![^>]*\bsrc=)/);
    expect(files(dist).some((f) => f.endsWith('staticwebapp.config.json'))).toBe(true);
  });

  // @req FR:web-app/host.auth
  test('401 sends the browser to GitHub login; 403 shows the allow-list screen', async ({ page }) => {
    const m = await mockApi(page);
    m.anonymous = true;
    const hit = page.waitForRequest((r) => r.url().includes('/.auth/login/github'), { timeout: 5000 }).catch(() => null);
    await page.route('**/.auth/login/github**', (r) => r.fulfill({ status: 200, body: 'login' }));
    await page.goto('/');
    const req = await hit;
    expect(req?.url()).toContain('post_login_redirect_uri=%2F');
    m.anonymous = false; m.forbidden = true;
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Not on the allow-list' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Sign out' })).toHaveAttribute('href', '/.auth/logout');
    await expect(page.getByText('Ship the')).toHaveCount(0);
  });

  // @req FR:web-app/host.swa
  test('serves the security headers', async ({ page }) => {
    const m = await mockApi(page);
    void m;
    const res = await page.goto('/');
    const h = res!.headers();
    expect(h['content-security-policy']).toContain("default-src 'self'");
    expect(h['x-content-type-options']).toBe('nosniff');
  });

  test('no CSP violations or console errors', async ({ page }) => {
    const errs: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error' || /Content Security Policy/i.test(m.text())) errs.push(m.text()); });
    page.on('pageerror', (e) => errs.push(String(e)));
    await mockApi(page);
    await page.goto('/#/list');
    await expect(rows(page).first()).toBeVisible();
    await page.goto('/#/projects');
    await expect(page.getByTestId('cap-alpha')).toBeVisible();
    await page.goto('/#/now');
    await expect(page.getByTestId('next-title')).toBeVisible();
    expect(errs).toEqual([]);
  });
});

const KEYBOARD = 'keyboard';
const selectRow = async (page: Page, ref: string) => { await page.locator(`.row[data-ref="${ref}"] .title`).click(); await page.keyboard.press('x'); };

test.describe('now view', () => {
  // @req FR:web-app/now.focus @req FR:web-app/ux.responsive
  test('shows the focus task with chips, Active rows below, and no horizontal scroll', async ({ page }, info) => {
    await mockApi(page);
    await page.goto('/#/now');
    await expect(page).toHaveURL(/\/$|#\/now/); // old name still opens Home
    await expect(page.getByTestId('next-title')).toContainText('Ship the web app');
    const focus = page.locator('.focus-block');
    await expect(focus.getByRole('button', { name: /Priority: High/ })).toBeVisible();
    await expect(focus.getByTestId('expected')).toHaveText('1h'); // effort reads as expected time on Home
    // @req FR:web-app/now.active @req FR:web-app/home.next
    await expect(rows(page)).toHaveText(['Review pull requests', 'Plan the trip']);
    await expect(page.locator('.row[data-ref="alpha:6"]')).toHaveCount(0);
    await expect(page.locator('.row[data-ref="alpha:7"]')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await shot(page, 'now', info);
  });

  test('old hashes still work', async ({ page }) => {
    await mockApi(page);
    await page.goto('/#/next');
    await expect(page.getByTestId('next-title')).toBeVisible();
    await page.goto('/#/capacity');
    await expect(page.getByTestId('cap-alpha')).toBeVisible();
  });

  test('empty state when nothing is active', async ({ page }) => {
    await mockApi(page, { tasks: [] });
    await page.goto('/#/now');
    await expect(page.getByRole('heading', { name: 'Nothing active' })).toBeVisible();
  });

  // @req FR:web-app/now.focus @req FR:web-app/now.undo
  test('start, skip, done with undo', async ({ page }) => {
    const m = await mockApi(page);
    await page.goto('/#/now');
    const focus = page.locator('.focus-block');
    await focus.getByRole('button', { name: 'Start' }).click();
    await expect(page.getByText('Started')).toBeVisible();
    await expect.poll(() => m.calls.at(-1)).toMatchObject({ path: '/tasks/start', body: { ref: 'alpha:6' } });
    await page.keyboard.press('Shift+S');
    await expect.poll(() => m.calls.at(-1)).toMatchObject({ path: '/tasks/skip', body: { ref: 'alpha:6' } });
    await expect(page.getByTestId('next-title')).toContainText('Write docs');
    await focus.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText('Undo')).toBeVisible();
    await expect.poll(() => m.calls.at(-1)).toMatchObject({ path: '/tasks/complete', body: { ref: 'alpha:7' } });
    await page.getByRole('button', { name: 'Undo' }).click();
    await expect.poll(() => m.calls.at(-1)).toMatchObject({ path: '/tasks/set', body: { ref: 'alpha:7', checkbox: 'Incomplete' } });
    await expect(page.getByTestId('next-title')).toContainText('Write docs');
  });

  // @req FR:web-app/now.defer
  test('Defer button opens the menu: 2 hours, tomorrow, next week', async ({ page }) => {
    const m = await mockApi(page);
    await page.goto('/#/now');
    const choose = async (name: RegExp) => {
      await page.locator('.focus-block').getByRole('button', { name: /Not now/ }).click();
      const dlg = page.getByRole('dialog', { name: 'Defer until' });
      await expect(dlg).toBeVisible();
      await dlg.getByRole('button', { name }).click();
      await expect(dlg).toHaveCount(0);
    };
    await choose(/2 hours/);
    await expect.poll(() => m.calls.at(-1)).toMatchObject({ path: '/tasks/suspend', body: { ref: 'alpha:6', hours: 2 } });
    await expect(page.getByTestId('next-title')).toContainText('Write docs');
    await choose(/Tomorrow/);
    await expect.poll(() => m.calls.at(-1)).toMatchObject({ path: '/tasks/suspend', body: { ref: 'alpha:7', days: 1 } });
    await expect(page.getByTestId('next-title')).toContainText('Review pull requests');
    await choose(/Next week/);
    await expect.poll(() => m.calls.at(-1)).toMatchObject({ path: '/tasks/suspend', body: { ref: 'alpha:9', days: 7 } });
  });

  test('z then number keys defer; Esc closes the menu', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', KEYBOARD);
    const m = await mockApi(page);
    await page.goto('/#/now');
    await expect(page.getByTestId('next-title')).toBeVisible();
    await page.keyboard.press('z');
    await expect(page.getByRole('dialog', { name: 'Defer until' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(m.calls.filter((c) => c.path === '/tasks/suspend')).toHaveLength(0);
    await page.keyboard.press('z');
    await page.keyboard.press('2');
    await expect.poll(() => m.calls.at(-1)).toMatchObject({ path: '/tasks/suspend', body: { ref: 'alpha:6', days: 1 } });
    await expect(page.getByTestId('next-title')).toContainText('Write docs');
    await page.keyboard.press('z');
    await page.keyboard.press('1');
    await expect.poll(() => m.calls.at(-1)).toMatchObject({ path: '/tasks/suspend', body: { ref: 'alpha:7', hours: 2 } });
    await page.keyboard.press('z');
    await page.keyboard.press('3');
    await expect.poll(() => m.calls.at(-1)).toMatchObject({ path: '/tasks/suspend', body: { days: 7 } });
  });

  test('keys: cursor starts on the focus task, j/k move, d/s act, Shift+S skips', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', KEYBOARD);
    const m = await mockApi(page);
    await page.goto('/#/now');
    await expect(page.locator('.focus-block.cursor')).toHaveAttribute('data-ref', 'alpha:6');
    await page.keyboard.press('j');
    await expect(page.locator('.row.cursor')).toHaveAttribute('data-ref', 'alpha:9');
    await page.keyboard.press('j');
    await expect(page.locator('.row.cursor')).toHaveAttribute('data-ref', 'beta:4');
    await page.keyboard.press('k');
    await page.keyboard.press('s');
    await expect.poll(() => m.calls.at(-1)).toMatchObject({ path: '/tasks/start', body: { ref: 'alpha:9' } });
    await page.keyboard.press('Shift+S');
    await expect.poll(() => m.calls.at(-1)).toMatchObject({ path: '/tasks/skip', body: { ref: 'alpha:9' } });
  });

  // @req FR:web-app/now.undo
  test('a failed complete shows an error, not Done with Undo', async ({ page }) => {
    const m = await mockApi(page);
    await page.goto('/#/now');
    m.fail.set('/tasks/complete', { status: 500, code: 'internal', message: 'Boom' });
    await page.locator('.focus-block').getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText('Boom')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);
  });
});

test.describe('focus mode', () => {
  // @req FR:web-app/now.focusmode
  test('opens from the Focus button, shows notes and a subtask checklist, and closes', async ({ page }, info) => {
    const m = await mockApi(page);
    await page.goto('/#/now');
    await page.getByTestId('next-title').dblclick();
    const dlg = page.getByRole('dialog', { name: 'Focus' });
    await expect(dlg).toBeVisible();
    await expect(dlg.locator('h1')).toContainText('Ship the web app');
    await expect(dlg.locator('.notes a')).toHaveAttribute('href', 'https://example.test/spec');
    const list = dlg.getByRole('list', { name: 'Subtasks' });
    await expect(list).toContainText('Write docs');
    await shot(page, 'focus', info);
    await list.getByRole('button', { name: 'Mark done' }).click();
    await expect.poll(() => m.calls.at(-1)).toMatchObject({ path: '/tasks/complete', body: { ref: 'alpha:7' } });
    await expect(list.locator('li.done')).toHaveCount(1);
    if (info.project.name === 'mobile') await dlg.getByRole('button', { name: 'Back' }).click();
    else await page.keyboard.press('Escape');
    await expect(dlg).toHaveCount(0);
  });

  test('Enter on a list row opens it; s, d, z work; Esc returns', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', KEYBOARD);
    const m = await mockApi(page);
    await page.goto('/#/list');
    await expect(page.locator('.row.cursor')).toHaveAttribute('data-ref', 'alpha:6');
    await page.keyboard.press('j');
    await page.keyboard.press('Enter');
    const dlg = page.getByRole('dialog', { name: 'Focus' });
    await expect(dlg.locator('h1')).toContainText('Review pull requests');
    await page.keyboard.press('s');
    await expect.poll(() => m.calls.at(-1)).toMatchObject({ path: '/tasks/start', body: { ref: 'alpha:9' } });
    await page.keyboard.press('z');
    await expect(page.getByRole('dialog', { name: 'Defer until' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Defer until' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(dlg).toBeVisible();
    await page.keyboard.press('d');
    await expect.poll(() => m.calls.at(-1)).toMatchObject({ path: '/tasks/complete', body: { ref: 'alpha:9' } });
  });
});

test.describe('list', () => {
  // @req FR:web-app/list.view
  test('groups by project and section, collapses Backlog and subtasks by default, mutes done', async ({ page }, info) => {
    await mockApi(page);
    await page.goto('/#/list');
    await expect(rows(page)).toHaveText(['Ship the web app', 'Review pull requests', 'Plan the trip']);
    await expect(page.locator('.row.done')).toHaveCount(0);
    await page.goto('/#/list?state=all');
    await expect(page.locator('.group')).toHaveCount(2);
    await expect(page.locator('.row.done')).toHaveCount(1);
    await expect(rows(page)).toHaveCount(6);
    await expect(page.locator('.title b')).toHaveText('web app');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await shot(page, 'list', info);
  });

  // @req FR:web-app/list.view
  test('sections collapse and expand', async ({ page }) => {
    await mockApi(page);
    await page.goto('/#/list');
    const backlog = page.getByRole('button', { name: /Backlog/ });
    await expect(backlog).toHaveAttribute('aria-expanded', 'false');
    await expect(page.locator('.row[data-ref="alpha:13"]')).toHaveCount(0);
    await backlog.click();
    await expect(page.locator('.row[data-ref="alpha:13"]')).toBeVisible();
    await expect(page.getByRole('button', { name: /Backlog/ })).toHaveAttribute('aria-expanded', 'true');
    const active = page.getByRole('button', { name: /Active/ }).first();
    await expect(active).toHaveAttribute('aria-expanded', 'true');
    await active.click();
    await expect(page.locator('.row[data-ref="alpha:6"]')).toHaveCount(0);
    await expect(page.locator('.row[data-ref="alpha:9"]')).toHaveCount(0);
    await expect(page.locator('.row[data-ref="beta:4"]')).toBeVisible();
    await expect(page.locator('.row[data-ref="alpha:13"]')).toBeVisible();
  });

  // @req FR:web-app/list.view
  test('searching or a state filter expands every section', async ({ page }) => {
    await mockApi(page);
    await page.goto('/#/list');
    await expect(page.locator('.row[data-ref="alpha:13"]')).toHaveCount(0);
    await page.getByLabel('Search tasks').fill('tidy');
    await expect(rows(page)).toHaveText(['Tidy the backlog']);
    await page.getByLabel('Search tasks').fill('');
    await expect(page.locator('.row[data-ref="alpha:13"]')).toHaveCount(0);
    await page.getByLabel('State').selectOption('all');
    await expect(page.locator('.row[data-ref="alpha:13"]')).toBeVisible();
  });

  // @req FR:web-app/list.view @req FR:web-app/edit.notes
  test('details expand with the arrow button, ArrowRight, and show subtasks and notes', async ({ page }, info) => {
    await mockApi(page);
    await page.goto('/#/list');
    const row = page.locator('.row[data-ref="alpha:6"]');
    await expect(row.locator('.notes')).toHaveCount(0);
    await expect(page.locator('.row[data-ref="alpha:7"]')).toHaveCount(0);
    await row.getByRole('button', { name: 'Expand details' }).click();
    await expect(row.locator('.notes a')).toHaveAttribute('href', 'https://example.test/spec');
    await expect(page.locator('.row[data-ref="alpha:7"]')).toBeVisible();
    await row.getByRole('button', { name: 'Collapse details' }).click();
    await expect(row.locator('.notes')).toHaveCount(0);
    await expect(page.locator('.row[data-ref="alpha:7"]')).toHaveCount(0);
    if (info.project.name === 'mobile') return;
    await expect(page.locator('.row.cursor')).toHaveAttribute('data-ref', 'alpha:6');
    await page.keyboard.press('ArrowRight');
    await expect(row.locator('.notes a')).toBeVisible();
    await page.keyboard.press('ArrowLeft');
    await expect(row.locator('.notes')).toHaveCount(0);
  });

  // @req FR:web-app/list.filters
  test('filters combine, show as chips, and survive reload', async ({ page }) => {
    await mockApi(page);
    await page.goto('/#/list');
    await expect(rows(page)).toHaveCount(3);
    await page.getByLabel('Project', { exact: true }).selectOption('alpha');
    await expect(rows(page)).toHaveCount(2);
    await page.getByLabel('Priority', { exact: true }).selectOption('‼️');
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByRole('button', { name: /Remove filter Project: alpha/ })).toBeVisible();
    await page.reload();
    await expect(rows(page)).toHaveCount(1);
    await page.getByRole('button', { name: /Remove filter Priority/ }).click();
    await expect(rows(page)).toHaveCount(2);
    await page.getByLabel('Search tasks').fill('docs');
    await expect(rows(page)).toHaveCount(1);
    await page.getByLabel('State').selectOption('done');
    await expect(page.getByText('No tasks match.')).toBeVisible();
  });

  // @req FR:web-app/list.nav @req FR:web-app/keys.global
  test('keyboard: g chords, cursor, selection with x, search focus, help', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', KEYBOARD);
    await mockApi(page);
    await page.goto('/#/now');
    await page.keyboard.press('g'); await page.keyboard.press('a');
    await expect(page).toHaveURL(/#\/list/);
    await expect(page.locator('.row.cursor')).toHaveAttribute('data-ref', 'alpha:6');
    await page.keyboard.press('j'); await page.keyboard.press('ArrowDown');
    await expect(page.locator('.row.cursor')).toHaveAttribute('data-ref', 'beta:4');
    await page.keyboard.press('k');
    await expect(page.locator('.row.cursor')).toHaveAttribute('data-ref', 'alpha:9');
    await expect(page.locator('.row.selected')).toHaveCount(0);
    await page.keyboard.press('x');
    await expect(page.locator('.row[data-ref="alpha:9"]')).toHaveClass(/selected/);
    await expect(page.locator('.row.selected')).toHaveCount(1);
    await expect(page.getByRole('toolbar', { name: 'Bulk edit' })).toContainText('1 selected');
    await page.keyboard.press('x');
    await expect(page.getByRole('toolbar')).toHaveCount(0);
    await page.keyboard.press('x');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('toolbar')).toHaveCount(0);
    await page.keyboard.press('/');
    await expect(page.getByLabel('Search tasks')).toBeFocused();
    await page.keyboard.type('jjj');
    await expect(page.locator('.row.cursor')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.keyboard.press('g'); await page.keyboard.press('p');
    await expect(page).toHaveURL(/#\/projects/);
    await page.keyboard.press('g'); await page.keyboard.press('h');
    await expect(page).toHaveURL(/#\/home/);
    await page.keyboard.press('g'); await page.keyboard.press('p');
    await expect(page.getByTestId('cap-alpha')).toBeVisible();
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('the per-row select checkbox is hidden; shift-click selects', async ({ page }) => {
    await mockApi(page);
    await page.goto('/#/list');
    await expect(page.locator('.row').first()).toBeVisible();
    expect(await page.getByLabel(/^Select /).first().isVisible()).toBe(false);
    await page.locator('.row[data-ref="alpha:9"]').getByRole('button', { name: 'Mark done' }).click({ modifiers: ['Shift'] });
    await expect(page.locator('.row[data-ref="alpha:9"]')).toHaveClass(/\bselected\b/);
  });

  // @req FR:web-app/pick.touch
  test('a touch that turns into a scroll (pointercancel) never selects the row', async ({ page }) => {
    await mockApi(page);
    await page.goto('/#/list');
    const r = page.locator('.row[data-ref="alpha:9"]');
    await r.dispatchEvent('pointerdown', { pointerType: 'touch', bubbles: true });
    await page.evaluate(() => window.dispatchEvent(new PointerEvent('pointercancel', { pointerType: 'touch' })));
    await page.waitForTimeout(600);
    await expect(r).not.toHaveClass(/\bselected\b/);
    await r.dispatchEvent('pointerdown', { pointerType: 'touch', bubbles: true });
    await expect(r).toHaveClass(/\bselected\b/); // a held press still selects
  });
});

test.describe('pickers and bulk edit', () => {
  // @req FR:web-app/pick.chips @req FR:web-app/pick.touch
  test('chip opens a picker that sets the value; ghost chip lists all groups', async ({ page }, info) => {
    const m = await mockApi(page);
    await page.goto('/#/list');
    await page.locator('.row[data-ref="alpha:9"]').getByRole('button', { name: /Effort: 2 hours/ }).click();
    const dlg = page.getByRole('dialog', { name: 'Set properties' });
    await expect(dlg).toBeVisible();
    if (info.project.name === 'mobile') {
      const box = await dlg.getByRole('button', { name: /1 hour/ }).boundingBox();
      expect(box!.height).toBeGreaterThanOrEqual(44);
      await shot(page, 'picker', info);
    }
    await dlg.getByRole('button', { name: /1 hour/ }).click();
    await expect.poll(() => m.calls.at(-1)).toMatchObject({ path: '/tasks/set', body: { ref: 'alpha:9', effort: '🟡' } });
    await page.locator('.row[data-ref="beta:4"]').getByRole('button', { name: 'Set properties' }).click();
    await expect(page.getByRole('group', { name: 'Priority' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Impact' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('number keys choose in a single-group picker', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', KEYBOARD);
    const m = await mockApi(page);
    await page.goto('/#/list');
    await expect(page.locator('.row.cursor')).toHaveAttribute('data-ref', 'alpha:6');
    await page.keyboard.press('p');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('1');
    await expect.poll(() => m.calls.at(-1)).toMatchObject({ path: '/tasks/set', body: { ref: 'alpha:6', priority: '🚨' } });
  });

  // @req FR:web-app/bulk.bar
  test('bulk sets a property and reports partial failure', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', KEYBOARD);
    const m = await mockApi(page);
    await page.goto('/#/list');
    await selectRow(page, 'alpha:6');
    await selectRow(page, 'alpha:9');
    await selectRow(page, 'beta:4');
    const bar = page.getByRole('toolbar', { name: 'Bulk edit' });
    await expect(bar).toContainText('3 selected');
    await bar.getByRole('button', { name: 'Set…' }).click();
    // second call fails
    let n = 0;
    await page.route('**/api/tasks/set', async (route) => { n++; if (n === 2) return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: { code: 'invalid', message: 'nope' } }) }); return route.fallback(); });
    await page.getByRole('dialog').getByRole('button', { name: /Critical/ }).click();
    await expect(page.getByText('2 updated, 1 failed. nope')).toBeVisible();
    await expect(page.getByRole('toolbar')).toContainText('1 selected');
    await expect.poll(() => m.calls.filter((c) => c.path === '/tasks/set').map((c) => c.body.ref)).toEqual(['alpha:6', 'beta:4']);
    expect(n).toBe(3);
  });

  test('bulk done', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', KEYBOARD);
    const m = await mockApi(page);
    await page.goto('/#/list');
    await selectRow(page, 'alpha:9');
    await selectRow(page, 'beta:4');
    await page.getByRole('toolbar').getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText('2 done')).toBeVisible();
    await expect.poll(() => m.calls.filter((c) => c.path === '/tasks/complete')).toHaveLength(2);
    await expect(page.getByRole('toolbar')).toHaveCount(0);
  });
});

test.describe('stale line numbers', () => {
  // @req FR:web-app/api.edit
  test('edit with a stale ref gets 409, writes nothing, and reloads', async ({ page }) => {
    const m = await mockApi(page);
    await page.goto('/#/list');
    await expect(rows(page).first()).toContainText('Ship the');
    m.insertAbove('alpha', 'Added by someone else');
    await page.locator('.row[data-ref="alpha:6"] .title').dblclick();
    await page.getByLabel('Edit task text').fill('Ship it 🟡');
    await page.getByLabel('Edit task text').press('Enter');
    await expect(page.getByText('Changed elsewhere')).toBeVisible();
    await expect.poll(() => m.calls.at(-1)).toMatchObject({ path: '/tasks/edit', body: { ref: 'alpha:6', expect: `‼️ 📅 ${dateTag()}: Ship the **web app** 🟡` } });
    expect(m.tasks.map((t) => t.text)).not.toContain('Ship it 🟡');
    expect(m.tasks.find((t) => t.ref === 'alpha:7')!.text).toContain('Ship the');
    await expect(page.locator('.row[data-ref="alpha:6"]')).toContainText('Added by someone else');
  });

  // @req FR:web-app/api.move
  test('move with a stale ref gets 409 and changes nothing', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'no drag handles on touch');
    const m = await mockApi(page);
    await page.goto('/#/list');
    await expect(rows(page).first()).toContainText('Ship the');
    m.tasks.find((t) => t.ref === 'alpha:9')!.text = 'Retitled by someone else';
    const before = m.tasks.map((t) => t.ref + t.text);
    const from = await page.locator('.row[data-ref="alpha:9"] .handle').boundingBox();
    const to = await page.locator('.row[data-ref="alpha:6"]').boundingBox();
    await page.mouse.move(from!.x + 5, from!.y + 5);
    await page.mouse.down();
    await page.mouse.move(to!.x + 60, to!.y + 6, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByText('Changed elsewhere')).toBeVisible();
    await expect.poll(() => m.calls.at(-1)).toMatchObject({ path: '/tasks/move', body: { ref: 'alpha:9', expect: 'Review pull requests 🟠', expectTarget: `‼️ 📅 ${dateTag()}: Ship the **web app** 🟡` } });
    expect(m.tasks.map((t) => t.ref + t.text)).toEqual(before);
  });

  // @req FR:web-app/bulk.bar
  test('bulk done re-resolves shifted refs by text', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', KEYBOARD);
    const m = await mockApi(page);
    await page.goto('/#/list');
    await selectRow(page, 'alpha:6');
    await selectRow(page, 'alpha:9');
    m.insertAbove('alpha', 'Added by someone else');
    await page.getByRole('toolbar').getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText('2 done')).toBeVisible();
    await expect.poll(() => m.calls.filter((c) => c.path === '/tasks/complete').map((c) => c.body.ref)).toEqual(['alpha:7', 'alpha:10']);
    expect(m.tasks.filter((t) => t.done && t.project === 'alpha').map((t) => t.text)).toEqual([`‼️ 📅 ${dateTag()}: Ship the **web app** 🟡`, 'Review pull requests 🟠']);
  });
});

test.describe('editor', () => {
  // @req FR:web-app/edit.open @req FR:web-app/edit.preview
  test('double click edits, previews markdown, Enter saves, Esc cancels', async ({ page }) => {
    const m = await mockApi(page);
    await page.goto('/#/list');
    await page.locator('.row[data-ref="alpha:9"] .title').dblclick();
    const box = page.getByLabel('Edit task text');
    await expect(box).toBeFocused();
    await expect(box).toHaveValue('Review pull requests 🟠');
    await box.fill('Review **the** docs <b>x</b> [a](javascript:alert(1)) [ok](https://ok.test) 🟠');
    const prev = page.locator('.preview');
    await expect(prev.locator('b')).toHaveText('the');
    await expect(prev.locator('a')).toHaveCount(1);
    await expect(prev).toContainText('<b>x</b>');
    await box.press('Escape');
    await expect(box).toHaveCount(0);
    expect(m.calls.filter((c) => c.path === '/tasks/edit')).toHaveLength(0);
    await page.locator('.row[data-ref="alpha:9"] .title').dblclick();
    await page.getByLabel('Edit task text').press('Enter');
    expect(m.calls.filter((c) => c.path === '/tasks/edit')).toHaveLength(0);
    await page.locator('.row[data-ref="alpha:9"] .title').dblclick();
    await page.getByLabel('Edit task text').fill('Review the PRs 🟠');
    await page.getByLabel('Edit task text').press('Enter');
    await expect(page.getByText('Saved')).toBeVisible();
    await expect.poll(() => m.calls.at(-1)).toMatchObject({ path: '/tasks/edit', body: { ref: 'alpha:9', text: 'Review the PRs 🟠' } });
  });

  test('e on the cursor row opens the editor; Enter opens focus mode instead', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', KEYBOARD);
    await mockApi(page);
    await page.goto('/#/list');
    await expect(page.locator('.row.cursor')).toBeVisible();
    await page.keyboard.press('e');
    await expect(page.getByLabel('Edit task text')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('Edit task text')).toHaveCount(0);
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Focus' })).toBeVisible();
    await expect(page.getByLabel('Edit task text')).toHaveCount(0);
  });
});

test.describe('reorder', () => {
  // @req FR:web-app/reorder.drag
  test('dragging a handle onto the top half of another row moves it', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'no drag handles on touch');
    const m = await mockApi(page);
    await page.goto('/#/list');
    const from = await page.locator('.row[data-ref="alpha:9"] .handle').boundingBox();
    const to = await page.locator('.row[data-ref="alpha:6"]').boundingBox();
    await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
    await page.mouse.down();
    await page.mouse.move(to!.x + 60, to!.y + 6, { steps: 8 });
    await expect(page.locator('.row.drop-top')).toHaveAttribute('data-ref', 'alpha:6');
    await page.mouse.up();
    await expect.poll(() => m.calls.at(-1)).toMatchObject({ path: '/tasks/move', body: { ref: 'alpha:9', target: 'alpha:6', position: 'before' } });
    await expect(rows(page).first()).toContainText('Review pull requests');
  });

  test('dropping on another project does nothing', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'no drag handles on touch');
    const m = await mockApi(page);
    await page.goto('/#/list');
    const from = await page.locator('.row[data-ref="alpha:9"] .handle').boundingBox();
    const to = await page.locator('.row[data-ref="beta:4"]').boundingBox();
    await page.mouse.move(from!.x + 5, from!.y + 5);
    await page.mouse.down();
    await page.mouse.move(to!.x + 60, to!.y + 10, { steps: 8 });
    await page.mouse.up();
    expect(m.calls.filter((c) => c.path === '/tasks/move')).toHaveLength(0);
  });

  // @req FR:web-app/reorder.keys
  test('Shift+J / Shift+K and handle arrows move rows', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'no drag handles on touch');
    const m = await mockApi(page);
    await page.goto('/#/list');
    await page.locator('.row[data-ref="alpha:9"] .handle').focus();
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => m.calls.at(-1)).toMatchObject({ path: '/tasks/move', body: { ref: 'alpha:9', position: 'before' } });
    await page.locator('body').click({ position: { x: 700, y: 5 } });
    await page.keyboard.press('Shift+J');
    await expect.poll(() => m.calls.at(-1)?.path).toBe('/tasks/move');
  });
});

test.describe('projects', () => {
  // @req FR:web-app/projects.glance
  test('one row per project with top task, count, and load; over capacity warns without a red bar', async ({ page }, info) => {
    await mockApi(page);
    await page.goto('/#/projects');
    const a = page.getByTestId('cap-alpha');
    await expect(a).toContainText('Alpha');
    await expect(a.locator('.proj-top')).toContainText('Ship the web app');
    await expect(a.locator('.proj-count')).toHaveText('4');
    await expect(a.locator('.proj-hrs')).toHaveText('7.5h / 2h');
    await expect(a).toHaveClass(/over/);
    expect(await a.locator('.proj-hrs').evaluate((el) => getComputedStyle(el, '::before').content)).toContain('▲');
    const b = page.getByTestId('cap-beta');
    await expect(b.locator('.proj-top')).toContainText('Plan the trip');
    await expect(b.locator('.proj-hrs')).toHaveText('0.5h');
    await expect(b).not.toHaveClass(/over/);
    await expect(b).toHaveClass(/nocap/);
    await shot(page, 'projects', info);
  });

  // @req FR:web-app/projects.glance
  test('clicking a project opens its list', async ({ page }) => {
    await mockApi(page);
    await page.goto('/#/projects');
    await page.getByTestId('cap-beta').getByRole('button').click();
    await expect(page).toHaveURL(/#\/list\?project=beta/);
    await expect(rows(page)).toHaveText(['Plan the trip']);
  });
});

test.describe('capture', () => {
  // @req FR:web-app/capture.box @req FR:web-app/capture.project
  test('New task opens the overlay; previews while typing, adds on Enter and closes, remembers the project', async ({ page }, info) => {
    const m = await mockApi(page);
    await page.goto('/#/list');
    await expect(page.getByLabel('Quick capture')).toHaveCount(0);
    const open = () => page.getByRole('button', { name: /New task/ }).first().click();
    await open();
    const dlg = page.getByRole('dialog', { name: 'New task' });
    const box = dlg.getByLabel('Quick capture');
    await expect(box).toBeFocused();
    await box.fill('call dentist tomorrow 30m #beta');
    await expect(page.getByTestId('capture-preview')).toContainText('Call dentist · due 2026-10-23 · 🟢 30m · #beta');
    await shot(page, 'capture', info);
    await box.press('Enter');
    await expect(page.getByText('Added: Call dentist')).toBeVisible();
    await expect(dlg).toHaveCount(0);
    await expect.poll(() => m.calls.at(-1)).toMatchObject({ path: '/capture', body: { text: 'call dentist tomorrow 30m #beta' } });
    await open();
    const box2 = page.getByLabel('Quick capture');
    await expect(box2).toHaveValue('');
    await box2.fill('water plants');
    await expect(page.getByTestId('capture-preview')).toContainText('#beta');
    await box2.press('Enter');
    await expect(page.getByText('Added: Water plants')).toBeVisible();
    await expect.poll(() => m.calls.at(-1)?.body.project).toBe('beta');
  });

  test('parse errors stay inline and keep the text and the overlay', async ({ page }) => {
    await mockApi(page);
    await page.goto('/#/now');
    await page.getByRole('button', { name: /New task/ }).first().click();
    const box = page.getByLabel('Quick capture');
    await box.fill('x');
    await expect(page.getByTestId('capture-preview')).toContainText('No title left after parsing');
    await box.press('Enter');
    await expect(box).toHaveValue('x');
    await expect(page.getByRole('dialog', { name: 'New task' })).toBeVisible();
  });

  test('c opens capture, Enter adds, Esc closes', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', KEYBOARD);
    const m = await mockApi(page);
    await page.goto('/#/now');
    await expect(page.getByTestId('next-title')).toBeVisible();
    await page.keyboard.press('c');
    await expect(page.getByLabel('Quick capture')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.keyboard.press('c');
    await page.keyboard.type('buy milk #beta');
    await page.keyboard.press('Enter');
    await expect(page.getByText('Added: Buy milk')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(m.calls.filter((c) => c.path === '/capture' && !c.body.dryRun)).toHaveLength(1);
  });
});

test.describe('palette', () => {
  // @req FR:web-app/palette.open
  test('opens with Ctrl+K, filters, runs a command, and returns focus', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', KEYBOARD);
    const m = await mockApi(page);
    await page.goto('/#/list');
    await expect(page.locator('.row.cursor')).toBeVisible();
    await page.keyboard.press('Control+k');
    const dlg = page.getByRole('dialog', { name: 'Command palette' });
    await expect(dlg).toBeVisible();
    await shot(page, 'palette', info);
    await page.getByLabel('Command', { exact: true }).fill('prio');
    await expect(dlg.getByRole('option').first()).toContainText('Set priority');
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog', { name: 'Set properties' })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: /High/ }).first().click();
    await expect.poll(() => m.calls.at(-1)).toMatchObject({ path: '/tasks/set', body: { ref: 'alpha:6', priority: '‼️' } });
    await page.keyboard.press('Control+k');
    await page.getByLabel('Command', { exact: true }).fill('go to proj');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/projects/);
    await page.keyboard.press('Control+k');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('colon opens it and bad queries say so', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', KEYBOARD);
    await mockApi(page);
    await page.goto('/#/now');
    await expect(page.getByTestId('next-title')).toBeVisible();
    await page.keyboard.press(':');
    await page.getByLabel('Command', { exact: true }).fill('zzzz');
    await expect(page.getByText('No matching command')).toBeVisible();
  });

  test('mobile: More opens the palette', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'mobile only');
    await mockApi(page);
    await page.goto('/#/now');
    await page.getByRole('button', { name: 'Open command palette' }).click();
    await expect(page.getByRole('dialog', { name: 'Command palette' })).toBeVisible();
  });
});

test.describe('feedback and mobile', () => {
  // @req FR:web-app/ux.feedback
  test('409 reloads and asks to retry; errors toast', async ({ page }) => {
    const m = await mockApi(page);
    await page.goto('/#/list');
    m.fail.set('/tasks/edit', { status: 409, code: 'conflict', message: 'Version conflict' });
    await page.locator('.row[data-ref="alpha:9"] .title').dblclick();
    await page.getByLabel('Edit task text').fill('Changed');
    await page.getByLabel('Edit task text').press('Enter');
    await expect(page.getByText('Changed elsewhere. Reloaded; try again.')).toBeVisible();
    m.fail.set('/tasks/set', { status: 500, code: 'internal', message: 'Internal error' });
    await page.locator('.row[data-ref="alpha:9"]').getByRole('button', { name: /Effort/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: /1 hour/ }).click();
    await expect(page.locator('.toast.err', { hasText: 'Internal error' })).toBeVisible();
  });

  // @req FR:web-app/ux.responsive
  test('layout switches between rail and tab bar', async ({ page }, info) => {
    await mockApi(page);
    await page.goto('/#/now');
    if (info.project.name === 'mobile') {
      await expect(page.locator('.rail')).toBeHidden();
      for (const tab of await page.locator('.tabbar .tab').all()) expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect((await page.locator('.btn.primary').first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
      // Full stack and Projects live behind More on a phone
      await expect(page.locator('.tabbar').getByRole('button', { name: /Full stack|Projects/ })).toHaveCount(0);
      await page.locator('.tabbar').getByRole('button', { name: 'Open command palette' }).click();
      await page.getByRole('combobox', { name: 'Command' }).fill('full stack');
      await page.keyboard.press('Enter');
      await expect(page).toHaveURL(/#\/list/);
      await page.locator('.tabbar').getByRole('button', { name: /My day/ }).click();
      await expect(page).toHaveURL(/#\/today/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= 375)).toBe(true);
    } else {
      await expect(page.locator('.rail')).toBeVisible();
      await expect(page.locator('.tabbar')).toBeHidden();
      for (const name of ['Home', 'My day', 'Needs you', 'Projects', 'Full stack']) await expect(page.locator('.rail').getByRole('button', { name: new RegExp(name) })).toBeVisible();
    }
  });

  // @req FR:web-app/ux.a11y
  test('controls are labelled and dialogs return focus', async ({ page }, info) => {
    await mockApi(page);
    await page.goto('/#/list');
    const chip = page.locator('.row[data-ref="alpha:9"]').getByRole('button', { name: /Effort: 2 hours/ });
    await expect(chip).toBeVisible();
    await chip.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog').getByRole('button').first()).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(chip).toBeFocused();
    for (const name of ['Search tasks', 'Project', 'State']) await expect(page.getByLabel(name, { exact: true })).toBeVisible();
    if (info.project.name !== 'mobile')
    await expect(page.getByRole('button', { name: /Drag Ship the/ })).toBeVisible();
  });

  test('dark mode renders', async ({ page }, info) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await mockApi(page);
    await page.goto('/#/list');
    await expect(rows(page).first()).toBeVisible();
    await shot(page, 'list-dark', info);
  });
});

test.describe('now view sections', () => {
  const mk = (n: number, text: string, extra: Partial<import('./mock').MockTask> = {}) => ({ ref: `gamma:${n}`, text, project: 'gamma', section: '🔄 Active', done: false, depth: 0, notes: [] as string[], ...extra });
  const dateIn = (days: number) => { const d = new Date(Date.now() + days * 864e5); return `${d.toLocaleString('en-US', { month: 'short' })} ${d.getDate()}, ${d.getFullYear()}`; };

  test('far-future and parked tasks never appear on Now; links and AI become tags', async ({ page }) => {
    const tasks = [
      mk(1, '🔺 Hero task 🟡'),
      mk(2, `📅 ${dateIn(100)}: Far future task`),
      mk(3, `⏰ ${dateIn(3)}: Later task`),
      mk(4, '🅿️ Parked task'),
      mk(5, '🤖 Robot chore'),
      mk(6, 'Read https://www.example.test/page/x now'),
    ];
    await mockApi(page, { tasks });
    await page.goto('/#/now');
    await expect(page.getByTestId('next-title')).toContainText('Hero task');
    const body = page.locator('section[aria-label="Home"]');
    await expect(body).not.toContainText('Far future task');
    await expect(body).not.toContainText('Later task');
    await expect(body).not.toContainText('Parked task');
    const ai = page.locator('.row', { hasText: 'Robot chore' });
    await expect(ai.locator('.tag', { hasText: 'AI' })).toBeVisible();
    const link = page.locator('.row', { hasText: 'Read' }).locator('a.tag.link');
    await expect(link).toHaveText('example.test ↗');
    await expect(link).toHaveAttribute('href', 'https://www.example.test/page/x');
    await expect(page.locator('.row', { hasText: 'Read' }).locator('.title')).not.toContainText('https://');
  });

  // @req FR:web-app/home.next @req FR:web-app/home.quiet
  test('Home shows two up next and no expander; the rest is one chord away', async ({ page }) => {
    const tasks = [mk(1, '🔺 Hero task'), ...Array.from({ length: 8 }, (_, i) => mk(i + 2, `Filler ${i + 1}`))];
    await mockApi(page, { tasks });
    await page.goto('/#/now');
    await expect(page.locator('section[aria-label="Home"] .row')).toHaveCount(2);
    await expect(page.getByRole('button', { name: /Show all active/ })).toHaveCount(0);
  });
});

test.describe('today view', () => {
  const mk = (n: number, text: string, extra: Partial<import('./mock').MockTask> = {}) => ({ ref: `gamma:${n}`, text, project: 'gamma', section: '🔄 Active', done: false, depth: 0, notes: [] as string[], ...extra });
  const tenAm = () => { const d = new Date(); d.setHours(10, 0, 0, 0); return d; };
  const setup = async (page: Page, tasks: ReturnType<typeof mk>[]) => {
    await page.clock.install({ time: tenAm() });
    const m = await mockApi(page, { tasks });
    await page.goto('/#/today');
    await page.clock.resume();
    return m;
  };
  const day = () => [
    mk(1, '🔺 Plain priority 🟡'),
    mk(3, 'Third thing 🟢'),
    mk(2, `📅 ${dateTag(1)}: Due soon 🟢`),
    mk(10, '🙋 Pick a vendor', { notes: ['> **Recommendation:** Use Acme for now'] }),
    mk(11, '🙋 Pick a color'),
    mk(20, '🤖 Build the engine 🚧'),
    mk(22, '🤖 Research options'),
    mk(23, '🙋 Approve budget', { depth: 1 }),
    mk(21, '🪄 Draft the report'),
  ];

  // @req FR:web-app/today.plan
  test('Today route: header, lead block actions, blocks in order, done circle completes', async ({ page }, info) => {
    const m = await setup(page, day());
    await expect(page.getByRole('region', { name: 'Today' }).getByRole('heading', { level: 1 })).toContainText('of 8h');
    await expect(page.locator('.t-sub')).toContainText('free');
    const blocks = page.locator('[data-testid="plan"] .block');
    await expect(blocks.first().locator('.what-title')).toContainText('Plain priority'); // the server's next task leads
    await expect(blocks.nth(1).locator('.what-title')).toContainText('Due soon'); // then due-soon before file order
    await expect(blocks.nth(2).locator('.what-title')).toContainText('Third thing');
    const lead = page.locator('.block.lead');
    await expect(lead).toHaveCount(1);
    for (const n of ['Start', 'Done', 'Not now']) await expect(lead.getByRole('button', { name: new RegExp(n) })).toBeVisible();
    await blocks.nth(2).getByRole('button', { name: 'Mark done' }).click();
    await expect.poll(() => m.calls.at(-1)).toMatchObject({ path: '/tasks/complete', body: { ref: 'gamma:3' } });
    await lead.getByRole('button', { name: /Start/ }).click();
    await expect.poll(() => m.calls.at(-1)).toMatchObject({ path: '/tasks/start', body: { ref: 'gamma:1' } });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await shot(page, 'today', info);
  });

  test('Not now on the lead block opens the defer menu', async ({ page }) => {
    await setup(page, day());
    await page.locator('.block.lead').getByRole('button', { name: /Not now/ }).click();
    await expect(page.getByRole('dialog', { name: 'Defer until' })).toBeVisible();
  });

  // @req FR:web-app/today.fit
  test('tasks that do not fit are listed with estimates and +30m grows the budget', async ({ page }) => {
    await setup(page, Array.from({ length: 6 }, (_, i) => mk(i + 1, `Big ${i + 1} 🔴`)));
    await expect(page.getByTestId('nofit')).toContainText('Big 5');
    const nofit = page.getByTestId('nofit');
    await expect(nofit.locator('li').first()).toContainText('2h');
    const before = await page.locator('[data-testid="plan"] .block').count();
    await nofit.getByRole('button', { name: '+30m' }).click();
    await expect(page.getByTestId('available')).toContainText('8h 30m');
    await nofit.getByRole('button', { name: '+30m' }).click();
    await nofit.getByRole('button', { name: '+30m' }).click();
    await nofit.getByRole('button', { name: '+30m' }).click();
    await expect(page.locator('[data-testid="plan"] .block')).toHaveCount(before + 1);
  });

  // @req FR:web-app/today.capacity
  test('Available time: buttons, [ ] keys, reset, and kept on reload today', async ({ page }, info) => {
    await setup(page, day());
    const avail = page.getByTestId('available');
    await expect(avail).toContainText('8h');
    await avail.getByRole('button', { name: 'Less time' }).click();
    await expect(avail).toContainText('7h 30m');
    if (info.project.name !== 'mobile') {
      await page.keyboard.press('[');
      await expect(avail).toContainText('7h');
      await page.keyboard.press(']');
      await page.keyboard.press(']');
      await expect(avail).toContainText('8h');
      for (let i = 0; i < 7; i++) await page.keyboard.press('[');
    } else for (let i = 0; i < 6; i++) await avail.getByRole('button', { name: 'Less time' }).click();
    await expect(avail).toContainText('4h 30m');
    await page.reload();
    await expect(page.getByTestId('available')).toContainText('4h 30m');
    await page.getByTestId('available').getByRole('button', { name: 'Reset' }).click();
    await expect(page.getByTestId('available')).toContainText('8h');
    await expect(page.getByTestId('available').getByRole('button', { name: 'Reset' })).toHaveCount(0);
  });

  test('zero available plans nothing and says so', async ({ page }) => {
    await setup(page, day());
    for (let i = 0; i < 16; i++) await page.getByTestId('available').getByRole('button', { name: 'Less time' }).click();
    await expect(page.getByTestId('available')).toContainText('0m');
    await expect(page.locator('[data-testid="plan"] .block')).toHaveCount(0);
    await expect(page.getByTestId('nofit')).toBeVisible();
  });

  // @req FR:web-app/today.needs @req FR:web-app/today.reply
  test('Needs you: Go with it and Reply go to the agent inbox; the card shows it was sent', async ({ page }) => {
    const m = await setup(page, day());
    const card = page.locator('[data-testid="needs"] .card', { hasText: 'Pick a vendor' });
    await expect(card.locator('.rec')).toContainText('Use Acme for now');
    await card.getByRole('button', { name: 'Go with it' }).click();
    await expect.poll(() => m.calls.at(-1)).toMatchObject({ path: '/inbox', body: { ref: 'gamma:10', kind: 'decision', expect: '🙋 Pick a vendor' } });
    expect(m.calls.at(-1)!.body.text).toMatch(/^Go with the recommendation: Use Acme for now/);
    await expect(page.locator('[data-testid="needs"] .card', { hasText: 'Pick a vendor' })).toContainText('Sent, waiting on the agent');
    await expect(page.locator('[data-testid="needs"] .card').last()).toContainText('Pick a vendor');
    expect(m.calls.some((c) => c.path === '/tasks')).toBe(false);
    const plain = page.locator('[data-testid="needs"] .card', { hasText: 'Pick a color' });
    await expect(plain.getByRole('button', { name: 'Go with it' })).toHaveCount(0);
    await plain.getByRole('button', { name: 'Reply' }).click();
    await plain.getByLabel('Reply').fill('Blue');
    await plain.getByRole('button', { name: 'Send' }).click();
    await expect.poll(() => m.calls.at(-1)).toMatchObject({ path: '/inbox', body: { ref: 'gamma:11', text: 'Blue', kind: 'reply' } });
    await expect(page.locator('[data-testid="needs"] .card', { hasText: 'Pick a color' }).locator('.sent')).toContainText('Blue');
  });

  // @req FR:web-app/today.reply
  test('a reply to a row that moved gets 409 instead of attaching to the wrong row', async ({ page }) => {
    const m = await setup(page, day());
    const plain = page.locator('[data-testid="needs"] .card', { hasText: 'Pick a color' });
    await expect(plain).toBeVisible();
    m.insertAbove('gamma', 'Added by someone else');
    await plain.getByRole('button', { name: 'Reply' }).click();
    await plain.getByLabel('Reply').fill('Blue');
    await plain.getByRole('button', { name: 'Send' }).click();
    await expect(page.getByText('Changed elsewhere')).toBeVisible();
    expect(m.calls.find((c) => c.path === '/inbox')).toMatchObject({ body: { text: 'Blue', ref: 'gamma:11' } });
    // the draft stays on the same decision (now on a new line) and resending targets it
    await expect(plain.getByLabel('Reply')).toHaveValue('Blue');
    await expect(page.getByLabel('Reply')).toHaveCount(1);
    const ask = m.tasks.find((t) => t.text.includes('Pick a color'))!;
    await plain.getByRole('button', { name: 'Send' }).click();
    await expect.poll(() => m.calls.filter((c) => c.path === '/inbox').at(-1)?.body).toMatchObject({ text: 'Blue', ref: ask.ref, expect: ask.text });
    expect(ask.ref).not.toBe('gamma:11');
  });

  // @req FR:web-app/today.needs
  test('identical 🙋 rows get their own cards and reply boxes', async ({ page }) => {
    const m = await setup(page, [mk(1, 'Plain 🟢'), mk(5, '🙋 Approve'), mk(6, '🙋 Approve')]);
    const cards = page.locator('[data-testid="needs"] .card');
    await expect(cards).toHaveCount(2);
    await cards.nth(1).getByRole('button', { name: 'Reply' }).click();
    await expect(page.getByLabel('Reply')).toHaveCount(1);
    await cards.nth(1).getByLabel('Reply').fill('Yes');
    await cards.nth(1).getByRole('button', { name: 'Send' }).click();
    await expect.poll(() => m.calls.at(-1)?.body).toMatchObject({ text: 'Yes', ref: 'gamma:6' });
  });

  // @req FR:web-app/today.agents
  test('AI team shows state from artifacts, PR links with checks, last activity, and Reply', async ({ page }, info) => {
    const iso = (h: number) => new Date(Date.now() - h * 36e5).toISOString();
    const agents = [
      { ref: 'gamma:21', project: 'gamma', title: 'Draft the report', text: '🪄 Draft the report', state: 'failing', prs: [{ url: 'https://github.com/o/r/pull/7', repo: 'o/r', number: 7, state: 'open', checks: 'failing', title: 'Report', updatedAt: iso(1) }], replies: 0, since: iso(1) },
      { ref: 'gamma:22', project: 'gamma', title: 'Research options', text: '🤖 Research options', state: 'waiting', prs: [], waitingOn: 'gamma:23', last: { at: iso(3), action: 'result', outcome: 'needs-human', summary: 'Pick a budget' }, replies: 0, since: iso(3) },
      { ref: 'gamma:20', project: 'gamma', title: 'Build the engine', text: '🤖 Build the engine 🚧', state: 'working', prs: [], last: { at: iso(2), action: 'claimed' }, replies: 0, since: iso(2) },
    ];
    const m = await (async () => { await page.clock.install({ time: tenAm() }); const mm = await mockApi(page, { tasks: day(), agents }); await page.goto('/#/today'); await page.clock.resume(); return mm; })();
    const panel = page.getByTestId('agents');
    await expect(panel.locator('.agent').first()).toContainText('CI failing');
    await expect(panel.getByRole('link', { name: /^r#7/ })).toHaveAttribute('href', 'https://github.com/o/r/pull/7');
    await expect(panel.locator('.agent.waiting')).toContainText('Needs you');
    await expect(panel.locator('.agent.waiting')).toContainText('needs-human: Pick a budget');
    await expect(panel.locator('.agent.working')).toContainText('claimed');
    await expect(page.locator('.t-sub')).toContainText('1 CI failing');
    const w = panel.locator('.agent.working');
    await w.getByRole('button', { name: 'Reply' }).click();
    await w.getByLabel('Reply').fill('Keep it short');
    await w.getByRole('button', { name: 'Send' }).click();
    await expect.poll(() => m.calls.at(-1)).toMatchObject({ path: '/inbox', body: { ref: 'gamma:20', text: 'Keep it short', kind: 'reply' } });
    await expect(panel.locator('.agent.working .sent')).toContainText('Keep it short');
    await shot(page, 'today-agents', info);
  });

  test('AI team error shows Retry and the rest of Today works', async ({ page }) => {
    await page.clock.install({ time: tenAm() });
    const m = await mockApi(page, { tasks: day() });
    m.agentsFail = true;
    await page.goto('/#/today');
    await page.clock.resume();
    await expect(page.locator('.block.lead')).toBeVisible();
    const retry = page.getByTestId('agents-error').getByRole('button', { name: 'Retry' });
    await expect(retry).toBeVisible();
    m.agentsFail = false;
    await retry.click();
    await expect(page.getByTestId('agents').locator('.agent').first()).toBeVisible();
  });

  // @req FR:web-app/today.meetings
  test('meetings block time: fixed rows, hatched on the bar, less available, tasks start after', async ({ page }, info) => {
    const at = (h: number, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d.toISOString(); };
    await page.clock.install({ time: tenAm() });
    const m = await mockApi(page, { tasks: day() });
    m.events = [
      { id: 'e1', subject: 'Allyte sync', start: at(10, 30), end: at(11, 30), allDay: false, showAs: 'busy', cancelled: false, online: true, joinUrl: 'https://teams.example.test/join/1' },
      { id: 'e2', subject: 'Lunch', start: at(12), end: at(13), allDay: false, showAs: 'free', cancelled: false, online: false },
      { id: 'e3', subject: 'Offsite', start: at(0), end: at(23, 59), allDay: true, showAs: 'busy', cancelled: false, online: false },
    ];
    await page.goto('/#/today');
    await page.clock.resume();
    const meeting = page.locator('[data-testid="plan"] .meeting');
    await expect(meeting).toHaveCount(1);
    await expect(meeting).toContainText('Allyte sync');
    await expect(meeting).toContainText('10:30a');
    await expect(meeting.getByRole('link', { name: 'Join' })).toHaveAttribute('href', 'https://teams.example.test/join/1');
    await expect(page.locator('.t-sub')).toContainText('1h in meetings');
    await expect(page.locator('.next-meeting')).toContainText('Allyte sync in 30m');
    await expect(page.getByTestId('available')).toContainText('7h');
    await expect(page.locator('.allday')).toContainText('Offsite');
    await expect(page.locator('.day-bar u')).toHaveCount(1);
    const blocks = page.locator('[data-testid="plan"] .block');
    await expect(blocks.nth(0).locator('.when')).toContainText('10:00a');
    await expect(blocks.nth(1).locator('.when')).toContainText('11:30a'); // the 1h lead task would cross the meeting, so a 30m task fills the gap first
    await shot(page, 'today-meetings', info);
  });

  test('J joins a meeting that starts within 10 minutes', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', KEYBOARD);
    const at = (h: number, m = 0) => { const d = new Date(); d.setHours(h, m, 0, 0); return d; };
    await page.clock.install({ time: at(10, 25) });
    const m = await mockApi(page, { tasks: day() });
    m.events = [{ id: 'e1', subject: 'Allyte sync', start: at(10, 30).toISOString(), end: at(11, 30).toISOString(), allDay: false, showAs: 'busy', cancelled: false, online: true, joinUrl: 'https://teams.example.test/join/1' }];
    await page.context().route('https://teams.example.test/**', (r) => r.fulfill({ status: 200, body: 'joined' }));
    await page.goto('/#/today');
    await page.clock.resume();
    await expect(page.locator('[data-testid="plan"] .meeting')).toBeVisible();
    const popup = page.waitForEvent('popup');
    await page.keyboard.press('Shift+J');
    expect((await popup).url()).toBe('https://teams.example.test/join/1');
  });

  // @req FR:home/day.frame @req FR:home/day.available @req FR:home/day.personal @req FR:home/day.calendar
  test('at 11:12p the day runs to bed at 2a, personal time stays out of the plan', async ({ page }, info) => {
    const at = (h: number, m = 0, plus = 0) => { const d = new Date(); d.setDate(d.getDate() + plus); d.setHours(h, m, 0, 0); return d; };
    await page.clock.install({ time: at(23, 12) });
    const m = await mockApi(page, { tasks: day() });
    const date = (() => { const d = at(0); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
    m.schedule = {
      timezone: 'UTC', date, wake: at(8).toISOString(), bed: at(2, 0, 1).toISOString(), asleep: false,
      blocks: [
        { name: 'Work', emoji: '☀️', kind: 'focus', start: at(8).toISOString(), end: at(16).toISOString() },
        { name: 'Family evening', label: 'Family', emoji: '🏠', kind: 'personal', start: at(16).toISOString(), end: at(20).toISOString() },
        { name: 'Project', emoji: '🌙', kind: 'focus', start: at(23).toISOString(), end: at(2, 0, 1).toISOString() },
      ],
    };
    m.events = [{ id: 'late', subject: 'APAC call', start: at(0, 30, 1).toISOString(), end: at(1, 0, 1).toISOString(), allDay: false, showAs: 'busy', cancelled: false, online: false }];
    await page.goto('/#/today');
    await page.clock.resume();
    await expect(page.getByTestId('available')).toContainText('2h 15m'); // 11:15p-2:00a minus the 30m call
    await expect(page.locator('.day-ends')).toContainText('2:00a');
    await expect(page.locator('[data-testid="plan"] .meeting')).toContainText('APAC call');
    await expect(page.locator('[data-testid="plan"] .block').first().locator('.when')).toContainText('11:15p');
    await shot(page, 'today-schedule-late', info);
  });

  // @req FR:home/day.asleep
  test('after bed the plan is the next waking day, from wake', async ({ page }) => {
    const at = (h: number, m = 0, plus = 0) => { const d = new Date(); d.setDate(d.getDate() + plus); d.setHours(h, m, 0, 0); return d; };
    await page.clock.install({ time: at(3) });
    const m = await mockApi(page, { tasks: day() });
    const d0 = at(0);
    m.schedule = { timezone: 'UTC', date: `${d0.getFullYear()}-${String(d0.getMonth() + 1).padStart(2, '0')}-${String(d0.getDate()).padStart(2, '0')}`, wake: at(8).toISOString(), bed: at(2, 0, 1).toISOString(), asleep: true, blocks: [] };
    await page.goto('/#/today');
    await page.clock.resume();
    await expect(page.locator('.t-date')).toContainText('Today from 8:00a');
    await expect(page.locator('[data-testid="plan"] .block').first().locator('.when')).toContainText('8:00a');
  });

  test('a calendar error is a quiet note; no calendar changes nothing', async ({ page }) => {
    await page.clock.install({ time: tenAm() });
    const m = await mockApi(page, { tasks: day() });
    m.calendarFail = true;
    await page.goto('/#/today');
    await page.clock.resume();
    await expect(page.locator('.cal-note')).toContainText('Calendar unavailable');
    await expect(page.getByTestId('available')).toContainText('8h');
  });

  // @req FR:web-app/today.mail
  test('email asks reserve one Email block first; it opens the Asks view', async ({ page }) => {
    await page.clock.install({ time: tenAm() });
    const m = await mockApi(page, { tasks: day() });
    const ask = (key: string, from: string) => ({ key, state: 'open', ask: `Review draft reply to Ann: ${key}`, kind: 'review', from, reversible: true, priority: 'normal', blocks: 0, created: new Date().toISOString(), updated: new Date().toISOString(), score: 1, overdue: false });
    m.asks = [ask('mail-1', 'email-triage'), ask('mail-2', 'email-triage'), ask('mail-3', 'email-triage'), ask('mail-4', 'email-triage'), ask('pr-1', 'allyte-cos')];
    await page.goto('/#/today');
    await page.clock.resume();
    const email = page.locator('[data-testid="plan"] .email-block');
    await expect(email).toContainText('Email · 4 asks');
    await expect(email.locator('.when')).toContainText('10:00a');
    await expect(email.locator('.when')).toContainText('20m');
    await expect(page.locator('[data-testid="plan"] .block').first().locator('.when')).toContainText('10:20a');
    await email.getByRole('button', { name: /Email · 4 asks/ }).click();
    await expect(page).toHaveURL(/#\/asks/);
  });

  // @req FR:web-app/today.projects
  test('project tiles open that project in the list', async ({ page }) => {
    await mockApi(page);
    await page.goto('/#/today');
    await page.getByTestId('tops').getByRole('button', { name: /Beta/ }).click();
    await expect(page).toHaveURL(/#\/list.*project=beta/);
    await expect(rows(page)).toHaveText(['Plan the trip']);
  });

  test('g t / g h / g p / g a move between views', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', KEYBOARD);
    await mockApi(page);
    await page.goto('/#/list');
    const chord = async (k: string, re: RegExp) => { await page.keyboard.press('g'); await page.keyboard.press(k); await expect(page).toHaveURL(re); };
    await chord('t', /#\/today/);
    await chord('h', /#\/home/);
    await chord('p', /#\/projects/);
    await chord('a', /#\/list/);
  });

  test('mobile: no horizontal scroll at 375px', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'mobile only');
    await setup(page, day());
    await expect(page.locator('.block.lead')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= 375)).toBe(true);
  });
});
