/**
 * @req FR:first-run-onboarding/web.gate @req FR:first-run-onboarding/web.a11y @req FR:first-run-onboarding/web.phone
 * @req FR:first-run-onboarding/step.repo @req FR:first-run-onboarding/step.mode @req FR:first-run-onboarding/step.calendar
 * @req FR:first-run-onboarding/step.email @req FR:first-run-onboarding/step.phone @req FR:first-run-onboarding/state.resume
 * @req FR:first-run-onboarding/host.apply @req FR:first-run-onboarding/step.max
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { mockApi } from './mock';

const STEPS = ['repo', 'mode', 'calendar', 'email', 'phone'] as const;
type Step = (typeof STEPS)[number];
interface Fake { step: Step; done: boolean; repo: string | null; mode: 'demo' | 'live'; posts: Record<string, unknown>[]; fail?: string; restartOnce?: boolean; error?: string }

/** A fake host: `/setup` GET and POST, with the same step order as the server. */
async function fakeSetup(page: Page, start: Partial<Fake> = {}): Promise<Fake> {
  const f: Fake = { step: 'repo', done: false, repo: null, mode: 'demo', posts: [], ...start };
  let down = 0;
  const status = () => ({ needed: !f.done, reason: f.error ? 'broken' : f.repo ? 'resume' : 'no-repo', step: f.step, steps: STEPS, repo: f.repo, mode: f.mode, calendar: false, email: false, signIn: 'stack graph login --client-id <app id> --with calendar,mail,drafts', ...(f.error ? { error: f.error } : {}) });
  // The host marks the page: the built index.html gets the meta tag, as the local server adds it.
  await page.route(/\/(index\.html)?(#.*)?$/, async (route) => {
    const r = await route.fetch();
    const html = await r.text();
    await route.fulfill({ response: r, body: f.done ? html : html.replace(/<head[^>]*>/i, (h) => h + '<meta name="stack-setup" content="1">') });
  });
  await page.route('**/setup', async (route) => {
    const req = route.request();
    if (req.method() === 'GET') {
      if (down > 0) { down--; return route.abort(); }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(status()) });
    }
    const body = JSON.parse(req.postData() ?? '{}') as Record<string, unknown>;
    f.posts.push(body);
    if (f.fail) { const message = f.fail; f.fail = undefined; return route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { code: 'invalid', message } }) }); }
    if (typeof body.go === 'string') f.step = body.go as Step;
    else {
      if (body.step === 'repo') f.repo = String(body.repo);
      if (body.step === 'mode') f.mode = body.mode as 'demo' | 'live';
      if (body.step === 'phone') f.done = true;
      else f.step = STEPS[STEPS.indexOf(body.step as Step) + 1];
      f.error = undefined;
    }
    const restart = !!f.restartOnce; f.restartOnce = false;
    if (restart) down = 2; // the host is away for two polls
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ restart, status: status() }) });
  });
  return f;
}

const heading = (page: Page) => page.getByRole('heading', { level: 1 });

test.describe('first-run onboarding', () => {
  test('walks all five steps, one per screen, then lands on Now', async ({ page }) => {
    await mockApi(page);
    const f = await fakeSetup(page);
    await page.goto('/');
    await expect(page.getByTestId('onboarding')).toBeVisible();
    await expect(page.getByText('Step 1 of 5')).toBeVisible();
    await expect(heading(page)).toHaveText('Where do your tasks live?');
    await page.getByLabel('Folder path or git url').fill('~/tasks');
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByText('Step 2 of 5')).toBeVisible();
    await expect(page.getByRole('radio', { name: /Demo/ })).toBeChecked();
    await page.getByRole('radio', { name: /Live/ }).check();
    await expect(page.getByTestId('live-warning')).toContainText('Live edits your repo. Stack writes task files in tasks/, commits them, and pushes to your remote.');
    const cont = page.getByRole('button', { name: 'Continue' });
    await expect(cont).toBeDisabled();
    await page.getByLabel('I understand').check();
    await cont.click();
    expect(f.posts[1]).toEqual({ step: 'mode', mode: 'live', ack: true });

    await expect(page.getByText('Step 3 of 5')).toBeVisible();
    await page.getByRole('button', { name: 'Skip' }).click();

    await expect(page.getByText('Step 4 of 5')).toBeVisible();
    await expect(page.getByTestId('sign-in')).toHaveText('stack graph login --client-id <app id> --with calendar,mail,drafts');
    await expect(page.getByText('It never sends mail.')).toBeVisible();
    await page.getByRole('button', { name: 'Skip' }).click();

    await expect(page.getByText('Step 5 of 5')).toBeVisible();
    await expect(page.getByText(/only when an ask is due within 1 hour/)).toBeVisible();
    await page.getByRole('button', { name: 'Finish' }).click();
    await expect(page.getByTestId('onboarding')).toHaveCount(0);
    await expect(page).toHaveURL(/#\/now$/);
    expect(f.posts.map((p) => p.step)).toEqual(['repo', 'mode', 'calendar', 'email', 'phone']);
  });

  test('resumes at the saved step; Back goes one step back', async ({ page }) => {
    await mockApi(page);
    const f = await fakeSetup(page, { step: 'calendar', repo: '/r' });
    await page.goto('/');
    await expect(page.getByText('Step 3 of 5')).toBeVisible();
    await expect(heading(page)).toBeFocused();
    await page.getByRole('button', { name: 'Back' }).click();
    await expect(page.getByText('Step 2 of 5')).toBeVisible();
    expect(f.posts.at(-1)).toEqual({ go: 'mode' });
  });

  test('a bad value shows one plain error line and stays on the step', async ({ page }) => {
    await mockApi(page);
    const f = await fakeSetup(page, { fail: 'Folder not found: /nope' });
    await page.goto('/');
    await page.getByLabel('Folder path or git url').fill('/nope');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByRole('alert')).toHaveText('Folder not found: /nope');
    await expect(page.getByText('Step 1 of 5')).toBeVisible();
    expect(f.posts).toHaveLength(1);
  });

  test('a calendar link must be https or webcal before it is sent', async ({ page }) => {
    await mockApi(page);
    const f = await fakeSetup(page, { step: 'calendar', repo: '/r' });
    await page.goto('/');
    await page.getByLabel('Published calendar link (ICS)').fill('http://x.test/a.ics');
    await page.getByRole('button', { name: 'Save link' }).click();
    await expect(page.getByRole('alert')).toContainText('https or webcal');
    expect(f.posts).toHaveLength(0);
  });

  test('a restart waits for the host, then shows the next step', async ({ page }) => {
    await mockApi(page);
    await fakeSetup(page, { restartOnce: true });
    await page.goto('/');
    await page.getByLabel('Folder path or git url').fill('/r');
    await page.getByRole('button', { name: 'Continue' }).click();
    await expect(page.getByText('Step 2 of 5')).toBeVisible();
  });

  test('a repo that failed to start says so on the repo step', async ({ page }) => {
    await mockApi(page);
    await fakeSetup(page, { repo: '/gone', error: '/gone is not a git repo' });
    await page.goto('/');
    await expect(page.getByRole('alert')).toHaveText('Stack could not open this repo: /gone is not a git repo');
    await expect(page.getByLabel('Folder path or git url')).toHaveValue('/gone');
  });

  test('no setup route (hosted, or an older host): the app shows', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await expect(page.getByTestId('onboarding')).toHaveCount(0);
    await expect(page.getByRole('navigation').first()).toBeVisible();
  });

  for (const scheme of ['light', 'dark'] as const) {
    test(`every step: axe clean, 44 px targets on touch, no sideways scroll (${scheme})`, async ({ page }, info) => {
      await page.emulateMedia({ colorScheme: scheme });
      await mockApi(page);
      for (const step of STEPS) {
        await page.unrouteAll({ behavior: 'ignoreErrors' });
        await mockApi(page);
        await fakeSetup(page, { step, repo: step === 'repo' ? null : '/r', mode: step === 'mode' ? 'live' : 'demo' });
        await page.goto('/');
        await page.reload();
        await expect(page.getByTestId('onboarding')).toHaveAttribute('data-step', step);
        if (step === 'mode') await expect(page.getByTestId('live-warning')).toBeVisible();
        // Let the 120 ms transitions settle before axe samples colors.
        await page.waitForTimeout(200);
        const { violations } = await new AxeBuilder({ page }).analyze();
        const bad = violations.filter((v) => v.impact === 'serious' || v.impact === 'critical').map((v) => `${step} ${v.id}: ${v.nodes.map((n) => n.target.join(' ')).join(', ')}`);
        expect(bad, bad.join('\n')).toEqual([]);
        expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
        if (info.project.name === 'mobile') {
          const small = await page.locator('.ob button, .ob input[type="text"], .ob input[type="url"], .ob label.ob-choice, .ob label.ob-check').evaluateAll((els) => els.map((e) => ({ h: e.getBoundingClientRect().height, t: (e.textContent || e.getAttribute('id') || '').trim() })).filter((x) => x.h > 0 && x.h < 44));
          expect(small, JSON.stringify(small)).toEqual([]);
        }
      }
    });
  }
});
