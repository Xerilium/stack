import { expect, test, type Page } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mockApi, seed } from './mock';

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
    await page.goto('/#/capacity');
    await expect(page.getByTestId('cap-alpha')).toBeVisible();
    expect(errs).toEqual([]);
  });
});

test.describe('next view', () => {
  // @req FR:web-app/next.show @req FR:web-app/ux.responsive
  test('shows the top task with chips and no horizontal scroll', async ({ page }, info) => {
    await mockApi(page);
    await page.goto('/');
    await expect(page.getByTestId('next-title')).toContainText('Ship the web app');
    await expect(page.getByRole('button', { name: /Priority: High/ })).toBeVisible();
    await expect(page.getByRole('button', { name: /Effort: 1 hour/ })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await shot(page, 'next', info);
  });

  test('empty state when nothing is active', async ({ page }) => {
    await mockApi(page, { tasks: [] });
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Nothing active' })).toBeVisible();
  });

  // @req FR:web-app/next.actions
  test('start, skip, suspend, done with undo', async ({ page }) => {
    const m = await mockApi(page);
    await page.goto('/');
    await page.getByRole('button', { name: 'Start' }).click();
    await expect(page.getByText('Started')).toBeVisible();
    expect(m.calls.at(-1)).toMatchObject({ path: '/tasks/start', body: { ref: 'alpha:6' } });
    await page.getByRole('button', { name: 'Suspend 1 day' }).click();
    expect(m.calls.at(-1)).toMatchObject({ path: '/tasks/suspend', body: { ref: 'alpha:6', days: 1 } });
    await expect(page.getByTestId('next-title')).toContainText('Write docs');
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText('Undo')).toBeVisible();
    await page.getByRole('button', { name: 'Undo' }).click();
    expect(m.calls.at(-1)).toMatchObject({ path: '/tasks/set', body: { ref: 'alpha:7', checkbox: 'Incomplete' } });
    await expect(page.getByTestId('next-title')).toContainText('Write docs');
  });

  test('desktop keys s d k z', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'keyboard');
    const m = await mockApi(page);
    await page.goto('/');
    await expect(page.getByTestId('next-title')).toBeVisible();
    await page.keyboard.press('k');
    await expect.poll(() => m.calls.at(-1)?.path).toBe('/tasks/skip');
  });
});

test.describe('list', () => {
  // @req FR:web-app/list.view @req FR:web-app/edit.notes
  test('groups by project and section, shows chips and notes, mutes done', async ({ page }, info) => {
    await mockApi(page);
    await page.goto('/#/list?state=all');
    await expect(page.locator('.group')).toHaveCount(3);
    await expect(page.locator('.row.done')).toHaveCount(1);
    await expect(page.locator('.notes a')).toHaveAttribute('href', 'https://example.test/spec');
    await expect(page.locator('.title b')).toHaveText('web app');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await shot(page, 'list', info);
  });

  // @req FR:web-app/list.filters
  test('filters combine, show as chips, and survive reload', async ({ page }) => {
    await mockApi(page);
    await page.goto('/#/list');
    await expect(rows(page)).toHaveCount(5);
    await page.getByLabel('Project', { exact: true }).selectOption('alpha');
    await page.getByLabel('Priority', { exact: true }).selectOption('‼️');
    await expect(rows(page)).toHaveCount(1);
    await expect(page.getByRole('button', { name: /Remove filter Project: alpha/ })).toBeVisible();
    await page.reload();
    await expect(rows(page)).toHaveCount(1);
    await page.getByRole('button', { name: /Remove filter Priority/ }).click();
    await expect(rows(page)).toHaveCount(4);
    await page.getByLabel('Search tasks').fill('docs');
    await expect(rows(page)).toHaveCount(1);
    await page.getByLabel('State').selectOption('done');
    await expect(page.getByText('No tasks match.')).toBeVisible();
  });

  // @req FR:web-app/list.nav @req FR:web-app/keys.global
  test('keyboard navigation, selection, search focus', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'keyboard');
    await mockApi(page);
    await page.goto('/');
    await page.keyboard.press('g'); await page.keyboard.press('l');
    await expect(page).toHaveURL(/#\/list/);
    await expect(page.locator('.row.cursor')).toHaveAttribute('data-ref', 'alpha:6');
    await page.keyboard.press('j'); await page.keyboard.press('ArrowDown');
    await expect(page.locator('.row.cursor')).toHaveAttribute('data-ref', 'alpha:9');
    await page.keyboard.press('k');
    await expect(page.locator('.row.cursor')).toHaveAttribute('data-ref', 'alpha:7');
    await page.keyboard.press('x');
    await expect(page.getByRole('toolbar', { name: 'Bulk edit' })).toContainText('1 selected');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('toolbar')).toHaveCount(0);
    await page.keyboard.press('/');
    await expect(page.getByLabel('Search tasks')).toBeFocused();
    await page.keyboard.type('jjj');
    await expect(page.locator('.row.cursor')).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.keyboard.press('g'); await page.keyboard.press('c');
    await expect(page).toHaveURL(/#\/capacity/);
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
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
    expect(m.calls.at(-1)).toMatchObject({ path: '/tasks/set', body: { ref: 'alpha:9', effort: '🟡' } });
    await page.locator('.row[data-ref="beta:4"]').getByRole('button', { name: 'Set properties' }).click();
    await expect(page.getByRole('group', { name: 'Priority' })).toBeVisible();
    await expect(page.getByRole('group', { name: 'Impact' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('number keys choose in a single-group picker', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'keyboard');
    const m = await mockApi(page);
    await page.goto('/#/list');
    await expect(page.locator('.row.cursor')).toHaveAttribute('data-ref', 'alpha:6');
    await page.keyboard.press('p');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('1');
    await expect.poll(() => m.calls.at(-1)).toMatchObject({ path: '/tasks/set', body: { ref: 'alpha:6', priority: '🚨' } });
  });

  // @req FR:web-app/bulk.bar
  test('bulk sets a property and reports partial failure', async ({ page }) => {
    const m = await mockApi(page);
    await page.goto('/#/list');
    await page.getByLabel('Select Write docs').check();
    await page.getByLabel('Select Review pull requests').check();
    await page.getByLabel('Select Plan the trip').check();
    const bar = page.getByRole('toolbar', { name: 'Bulk edit' });
    await expect(bar).toContainText('3 selected');
    await bar.getByRole('button', { name: 'Set…' }).click();
    // second call fails
    let n = 0;
    await page.route('**/api/tasks/set', async (route) => { n++; if (n === 2) return route.fulfill({ status: 422, contentType: 'application/json', body: JSON.stringify({ error: { code: 'invalid', message: 'nope' } }) }); return route.fallback(); });
    await page.getByRole('dialog').getByRole('button', { name: /Critical/ }).click();
    await expect(page.getByText('2 updated, 1 failed. nope')).toBeVisible();
    await expect(page.getByRole('toolbar')).toContainText('1 selected');
    expect(m.calls.filter((c) => c.path === '/tasks/set').map((c) => c.body.ref)).toEqual(['alpha:7', 'beta:4']);
    expect(n).toBe(3);
  });

  test('bulk done', async ({ page }) => {
    const m = await mockApi(page);
    await page.goto('/#/list');
    await page.getByLabel('Select Write docs').check();
    await page.getByLabel('Select Plan the trip').check();
    await page.getByRole('toolbar').getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText('2 done')).toBeVisible();
    expect(m.calls.filter((c) => c.path === '/tasks/complete')).toHaveLength(2);
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
    await page.locator('.row[data-ref="alpha:7"] .title').dblclick();
    await page.getByLabel('Edit task text').fill('Write the docs 🟢');
    await page.getByLabel('Edit task text').press('Enter');
    await expect(page.getByText('Changed elsewhere')).toBeVisible();
    expect(m.calls.at(-1)).toMatchObject({ path: '/tasks/edit', body: { ref: 'alpha:7', expect: 'Write docs 🟢' } });
    expect(m.tasks.map((t) => t.text)).toContain('Write docs 🟢');
    expect(m.tasks.find((t) => t.ref === 'alpha:7')!.text).toContain('Ship the');
    await expect(page.locator('.row[data-ref="alpha:6"]')).toContainText('Added by someone else');
  });

  // @req FR:web-app/api.move
  test('move with a stale ref gets 409 and changes nothing', async ({ page }) => {
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
    expect(m.calls.at(-1)).toMatchObject({ path: '/tasks/move', body: { ref: 'alpha:9', expect: 'Review pull requests 🟠', expectTarget: '‼️ 📅 Oct 23: Ship the **web app** 🟡' } });
    expect(m.tasks.map((t) => t.ref + t.text)).toEqual(before);
  });

  // @req FR:web-app/bulk.bar
  test('bulk done re-resolves shifted refs by text', async ({ page }) => {
    const m = await mockApi(page);
    await page.goto('/#/list');
    await page.getByLabel('Select Write docs').check();
    await page.getByLabel('Select Review pull requests').check();
    m.insertAbove('alpha', 'Added by someone else');
    await page.getByRole('toolbar').getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText('2 done')).toBeVisible();
    expect(m.calls.filter((c) => c.path === '/tasks/complete').map((c) => c.body.ref)).toEqual(['alpha:8', 'alpha:10']);
    expect(m.tasks.filter((t) => t.done && t.project === 'alpha').map((t) => t.text)).toEqual(['Write docs 🟢', 'Review pull requests 🟠']);
  });

  // @req FR:web-app/next.act
  test('a failed complete shows an error, not Done with Undo', async ({ page }) => {
    const m = await mockApi(page);
    await page.goto('/');
    m.fail.set('/tasks/complete', { status: 500, code: 'internal', message: 'Boom' });
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText('Boom')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Undo' })).toHaveCount(0);
  });
});

test.describe('editor', () => {
  // @req FR:web-app/edit.open @req FR:web-app/edit.preview
  test('double click edits, previews markdown, Enter saves, Esc cancels', async ({ page }) => {
    const m = await mockApi(page);
    await page.goto('/#/list');
    await page.locator('.row[data-ref="alpha:7"] .title').dblclick();
    const box = page.getByLabel('Edit task text');
    await expect(box).toBeFocused();
    await expect(box).toHaveValue('Write docs 🟢');
    await box.fill('Write **the** docs <b>x</b> [a](javascript:alert(1)) [ok](https://ok.test) 🟢');
    const prev = page.locator('.preview');
    await expect(prev.locator('b')).toHaveText('the');
    await expect(prev.locator('a')).toHaveCount(1);
    await expect(prev).toContainText('<b>x</b>');
    await box.press('Escape');
    await expect(box).toHaveCount(0);
    expect(m.calls.filter((c) => c.path === '/tasks/edit')).toHaveLength(0);
    await page.locator('.row[data-ref="alpha:7"] .title').dblclick();
    await page.getByLabel('Edit task text').press('Enter');
    expect(m.calls.filter((c) => c.path === '/tasks/edit')).toHaveLength(0);
    await page.locator('.row[data-ref="alpha:7"] .title').dblclick();
    await page.getByLabel('Edit task text').fill('Write the docs 🟢');
    await page.getByLabel('Edit task text').press('Enter');
    await expect(page.getByText('Saved')).toBeVisible();
    expect(m.calls.at(-1)).toMatchObject({ path: '/tasks/edit', body: { ref: 'alpha:7', text: 'Write the docs 🟢' } });
  });

  test('Enter or e on the cursor row opens the editor', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'keyboard');
    await mockApi(page);
    await page.goto('/#/list');
    await expect(page.locator('.row.cursor')).toBeVisible();
    await page.keyboard.press('e');
    await expect(page.getByLabel('Edit task text')).toBeFocused();
    await page.keyboard.press('Escape');
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('Edit task text')).toBeFocused();
  });
});

test.describe('reorder', () => {
  // @req FR:web-app/reorder.drag
  test('dragging a handle onto the bottom half of another row moves it', async ({ page }) => {
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

  test('dropping on another project does nothing', async ({ page }) => {
    const m = await mockApi(page);
    await page.goto('/#/list');
    const from = await page.locator('.row[data-ref="alpha:9"] .handle').boundingBox();
    const to = await page.locator('.row[data-ref="beta:4"]').boundingBox();
    await page.mouse.move(from!.x + 5, from!.y + 5);
    await page.mouse.down();
    await page.mouse.move(to!.x + 60, to!.y + 30, { steps: 8 });
    await page.mouse.up();
    expect(m.calls.filter((c) => c.path === '/tasks/move')).toHaveLength(0);
  });

  // @req FR:web-app/reorder.keys
  test('Shift+J / Shift+K and handle arrows move rows', async ({ page }, info) => {
    const m = await mockApi(page);
    await page.goto('/#/list');
    await page.locator('.row[data-ref="alpha:9"] .handle').focus();
    await page.keyboard.press('ArrowUp');
    await expect.poll(() => m.calls.at(-1)).toMatchObject({ path: '/tasks/move', body: { ref: 'alpha:9', target: 'alpha:7', position: 'before' } });
    if (info.project.name === 'mobile') return;
    await page.locator('body').click({ position: { x: 700, y: 5 } });
    await page.keyboard.press('Shift+J');
    await expect.poll(() => m.calls.at(-1)?.path).toBe('/tasks/move');
  });
});

test.describe('capacity', () => {
  // @req FR:web-app/capacity.view
  test('shows load against capacity and flags overload', async ({ page }, info) => {
    await mockApi(page);
    await page.goto('/#/capacity');
    const a = page.getByTestId('cap-alpha');
    await expect(a).toContainText('4 open');
    await expect(a).toContainText('7.5h of effort');
    await expect(a).toContainText('2h capacity');
    await expect(a).toHaveClass(/over/);
    const b = page.getByTestId('cap-beta');
    await expect(b).toContainText('no capacity set');
    await expect(b).not.toHaveClass(/over/);
    await shot(page, 'capacity', info);
  });
});

test.describe('capture', () => {
  // @req FR:web-app/capture.box @req FR:web-app/capture.project
  test('previews while typing, adds on Enter, remembers the project', async ({ page }, info) => {
    const m = await mockApi(page);
    await page.goto('/#/list');
    const box = page.getByLabel('Quick capture');
    await box.fill('call dentist tomorrow 30m #beta');
    await expect(page.getByTestId('capture-preview')).toContainText('Call dentist · due 2026-10-23 · 🟢 30m · #beta');
    await shot(page, 'capture', info);
    await box.press('Enter');
    await expect(page.getByText('Added: Call dentist')).toBeVisible();
    await expect(box).toHaveValue('');
    expect(m.calls.at(-1)).toMatchObject({ path: '/capture', body: { text: 'call dentist tomorrow 30m #beta' } });
    await box.fill('water plants');
    await expect(page.getByTestId('capture-preview')).toContainText('#beta');
    await box.press('Enter');
    await expect(page.getByText('Added: Water plants')).toBeVisible();
    expect(m.calls.at(-1)?.body.project).toBe('beta');
  });

  test('parse errors stay inline and keep the text', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    const box = page.getByLabel('Quick capture');
    await box.fill('x');
    await expect(page.getByTestId('capture-preview')).toContainText('No title left after parsing');
    await box.press('Enter');
    await expect(box).toHaveValue('x');
  });

  test('c focuses capture', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'keyboard');
    await mockApi(page);
    await page.goto('/');
    await expect(page.getByTestId('next-title')).toBeVisible();
    await page.keyboard.press('c');
    await expect(page.getByLabel('Quick capture')).toBeFocused();
  });
});

test.describe('palette', () => {
  // @req FR:web-app/palette.open
  test('opens with Ctrl+K, filters, runs a command, and returns focus', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'keyboard');
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
    expect(m.calls.at(-1)).toMatchObject({ path: '/tasks/set', body: { ref: 'alpha:6', priority: '‼️' } });
    await page.keyboard.press('Control+k');
    await page.getByLabel('Command', { exact: true }).fill('capac');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowUp');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/#\/capacity/);
    await page.keyboard.press('Control+k');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('colon opens it and bad queries say so', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'keyboard');
    await mockApi(page);
    await page.goto('/');
    await expect(page.getByTestId('next-title')).toBeVisible();
    await page.keyboard.press(':');
    await page.getByLabel('Command', { exact: true }).fill('zzzz');
    await expect(page.getByText('No matching command')).toBeVisible();
  });

  test('mobile: More opens the palette', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'mobile only');
    await mockApi(page);
    await page.goto('/');
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
    await page.locator('.row[data-ref="alpha:7"] .title').dblclick();
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
    await page.goto('/');
    if (info.project.name === 'mobile') {
      await expect(page.locator('.rail')).toBeHidden();
      const tab = page.locator('.tabbar .tab').first();
      await expect(tab).toBeVisible();
      expect((await tab.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      for (const sel of ['.btn.primary', '.capture input']) expect((await page.locator(sel).first().boundingBox())!.height).toBeGreaterThanOrEqual(44);
      await page.getByRole('button', { name: 'List' }).last().click();
      await expect(page).toHaveURL(/#\/list/);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= 375)).toBe(true);
    } else {
      await expect(page.locator('.rail')).toBeVisible();
      await expect(page.locator('.tabbar')).toBeHidden();
    }
  });

  // @req FR:web-app/ux.a11y
  test('controls are labelled and dialogs return focus', async ({ page }) => {
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
    for (const name of ['Search tasks', 'Quick capture', 'Project', 'State']) await expect(page.getByLabel(name, { exact: true })).toBeVisible();
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
