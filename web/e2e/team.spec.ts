/** @req FR:agent-team/web.chip @req FR:agent-team/web.talk @req FR:agent-team/web.anything @req FR:agent-team/web.review @req FR:agent-team/web.norunner @req FR:agent-team/web.keys @req FR:agent-team/web.a11y */
import { expect, test, type Page } from '@playwright/test';
import { mockApi, type Mock, type MockTeamAgent } from './mock';

const team: MockTeamAgent[] = [
  { slug: 'cos', name: 'CoS', role: 'Roll-up', scope: ['*'], mode: 'long-running', prompt: '', defined: true, projects: ['alpha', 'beta'] },
  { slug: 'alpha-lead', name: '🅰️ Alpha Lead', role: 'owns alpha', scope: ['alpha'], mode: 'ad-hoc', prompt: '', defined: true, projects: ['alpha'] },
];
const frames = (updates: unknown[]) => updates.map((u) => `event: update\ndata: ${JSON.stringify(u)}\n\n`).join('');

async function open(page: Page, o: { runner?: boolean; review?: boolean } = {}): Promise<Mock> {
  const m = await mockApi(page);
  m.team = team;
  if (o.runner !== false) m.sessions = [];
  if (o.review) m.reviews = [{ ref: 'alpha:9', at: new Date().toISOString(), verdict: 'partial', plan: 'Read the PRs, then ask about the release gate', estimate: '1h', agent: 'alpha-lead', needs: ['rev-alpha-10-x-1', 'rev-alpha-10-x-2'] }];
  await page.route('**/sessions/*/events', (r) => r.fulfill({ status: 200, contentType: 'text/event-stream', body: frames([{ type: 'message_chunk', role: 'assistant', text: 'On it.' }, { type: 'done', stopReason: 'end_turn', cost: { usd: 0.12, tokens: 300 }, turns: 1, durationMs: 90 }]) }));
  await page.goto('/#/list');
  await expect(page.locator('.row').first()).toBeVisible();
  return m;
}
const row = (p: Page, ref: string) => p.locator(`.row[data-ref="${ref}"]`);

test.describe('Agent team', () => {
  test('every row names its active agent (most specific scope) on hover or cursor; a project with no agent says so', async ({ page }) => {
    const m = await open(page);
    await row(page, 'alpha:6').hover();
    await expect(row(page, 'alpha:6').locator('.agent-chip')).toHaveText('🅰️ Alpha Lead');
    await expect(row(page, 'alpha:6').locator('.agent-chip')).toHaveAttribute('title', /owns alpha. Talk to it \(a\)/);
    await row(page, 'beta:4').hover();
    await expect(row(page, 'beta:4').locator('.agent-chip')).toHaveText('CoS');
    m.team = [team[1]];
    await page.reload();
    await row(page, 'beta:4').hover();
    await expect(row(page, 'beta:4').locator('.agent-chip')).toHaveText('No agent');
  });

  test('a opens the inline composer on the cursor row: agent picker, quick actions, Send starts a session and the row follows it', async ({ page }) => {
    const m = await open(page);
    await row(page, 'alpha:6').click();
    await expect(row(page, 'alpha:6')).toHaveClass(/cursor/);
    await page.keyboard.press('a');
    const talk = row(page, 'alpha:6').locator('.agent-talk');
    await expect(talk).toBeVisible();
    await expect(talk).toHaveAttribute('aria-label', /Talk to 🅰️ Alpha Lead about/);
    await expect(talk.locator('select')).toHaveValue('alpha-lead');
    await expect(talk.locator('select option')).toHaveCount(2);
    await expect(talk.locator('select option').first()).toHaveAttribute('title', 'owns alpha');
    await expect(talk.getByRole('button', { name: /^Review/ })).toBeVisible();
    await expect(talk.locator('input[type="text"]')).toBeFocused();
    await page.keyboard.type('Check the deploy and tell me if the plan is solid');
    await page.keyboard.press('Enter');
    await expect(talk).toHaveCount(0);
    await expect.poll(() => m.calls.find((c) => c.path === '/sessions')?.body).toEqual({ text: 'Check the deploy and tell me if the plan is solid', agent: 'alpha-lead', ref: 'alpha:6' });
    await expect(page.locator('.toast')).toContainText('Sent to alpha-lead');
    await expect(row(page, 'alpha:6').locator('.agent-chip')).toHaveText('Working');
    // Only one composer at a time; Esc closes it.
    await page.keyboard.press('a');
    await expect(page.locator('.agent-talk')).toHaveCount(1);
    await page.keyboard.press('Escape');
    await page.keyboard.press('j');
    await page.keyboard.press('a');
    await expect(page.locator('.agent-talk')).toHaveCount(1);
    await expect(row(page, 'alpha:9').locator('.agent-talk')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.agent-talk')).toHaveCount(0);
  });

  test('Keep open starts the session and opens the drawer; Do it sends the quick prompt', async ({ page }, info) => {
    const m = await open(page);
    await row(page, 'alpha:9').click(); // the cursor row shows its chip on every device
    await row(page, 'alpha:9').locator('.agent-chip').click();
    const talk = row(page, 'alpha:9').locator('.agent-talk');
    // A phone has no room for the toggle: Keep open is the agent's own default there.
    if (info.project.name === 'mobile') { await expect(talk.getByLabel('Keep open')).toBeHidden(); await talk.getByRole('button', { name: /^Do it/ }).click(); await expect.poll(() => m.calls.find((c) => c.path === '/sessions')?.body?.text).toContain('Do this task'); await expect(page.locator('.toast')).toContainText('Sent to alpha-lead'); return; }
    await talk.getByLabel('Keep open').check();
    await talk.getByRole('button', { name: /^Do it/ }).click();
    await expect.poll(() => m.calls.find((c) => c.path === '/sessions')?.body?.text).toContain('Do this task');
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('🅰️ Alpha Lead · Review pull requests 🟠 · alpha:9');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('R reviews the cursor row; the chip shows Reviewing… then the verdict with its needs, which jumps to Asks', async ({ page }) => {
    const m = await open(page);
    const target = row(page, 'alpha:9');
    await target.click();
    await expect(target).toHaveClass(/cursor/);
    await page.route('**/sessions/*/events', (r) => setTimeout(() => r.fulfill({ status: 200, contentType: 'text/event-stream', body: frames([{ type: 'done', stopReason: 'end_turn', cost: { usd: 0.3, tokens: 10 }, turns: 2, durationMs: 9 }]) }), 400));
    await page.keyboard.press('R');
    await expect(target.locator('.agent-chip')).toHaveText('Reviewing…');
    await expect.poll(() => m.calls.find((c) => c.path === '/tasks/review')?.body).toEqual({ ref: 'alpha:9' });
    m.reviews = [{ ref: 'alpha:9', at: new Date().toISOString(), verdict: 'partial', plan: 'Read the PRs, then ask about the release gate', estimate: '1h', agent: 'alpha-lead', needs: ['rev-alpha-10-x-1', 'rev-alpha-10-x-2'] }];
    for (const x of m.sessions!) x.state = 'idle'; // the review run ended
    await expect(target.locator('.agent-chip')).toHaveText('Partial · needs 2');
    await expect(target.locator('.agent-chip')).toHaveClass(/warn/);
    await expect(target.locator('.agent-chip')).toHaveAttribute('title', 'alpha-lead: Read the PRs, then ask about the release gate (1h)');
    await target.locator('.agent-chip').click({ force: true });
    await expect(page).toHaveURL(/#\/asks/);
  });

  test('a verdict from an earlier review shows on load; Can reads green, Cannot reads warm', async ({ page }) => {
    const m = await open(page, { review: true });
    await expect(row(page, 'alpha:9').locator('.agent-chip')).toHaveText('Partial · needs 2');
    m.reviews = [{ ref: 'alpha:6', at: new Date().toISOString(), verdict: 'can', plan: 'Easy', estimate: '20m', agent: 'alpha-lead', needs: [] }, { ref: 'beta:4', at: new Date().toISOString(), verdict: 'cannot', plan: 'Needs a human', agent: 'cos', needs: [] }];
    await page.reload();
    await expect(row(page, 'alpha:6').locator('.agent-chip')).toHaveText('Can · 20m');
    await expect(row(page, 'alpha:6').locator('.agent-chip')).toHaveClass(/ok/);
    await expect(row(page, 'beta:4').locator('.agent-chip')).toHaveText("Can't");
    await expect(row(page, 'beta:4').locator('.agent-chip')).toHaveClass(/warn/);
  });

  test('without a runner the chip still shows and the composer says where sessions run', async ({ page }) => {
    await open(page, { runner: false });
    await row(page, 'alpha:6').click();
    await expect(row(page, 'alpha:6').locator('.agent-chip')).toHaveText('🅰️ Alpha Lead');
    await row(page, 'alpha:6').locator('.agent-chip').click();
    const talk = row(page, 'alpha:6').locator('.agent-talk');
    await expect(talk).toBeVisible();
    await expect(talk.locator('input[type="text"]')).toBeDisabled();
    await expect(talk).toContainText('Runs in stack web on your machine');
    await expect(talk.getByRole('button', { name: /^Send/ })).toBeDisabled();
  });

  test('an ask card has the agent too: a opens the composer about the ask', async ({ page }) => {
    const m = await mockApi(page);
    m.team = team; m.sessions = [];
    m.asks = [{ key: 'pr-1', state: 'open', ask: 'Approve merging PR 879', kind: 'approve', from: 'alpha-lead', project: 'alpha', reversible: false, priority: 'normal', blocks: 0, created: new Date().toISOString(), updated: new Date().toISOString(), score: 30, rank: 1, overdue: false }];
    await page.goto('/#/asks');
    await expect(page.locator('.ask-card')).toBeVisible();
    await expect(page.locator('.ask-card .agent-chip')).toHaveText('Talk'); // the author is the agent: no repeated name
    await page.keyboard.press('a');
    const talk = page.locator('.ask-card .agent-talk');
    await expect(talk).toHaveAttribute('aria-label', 'Talk to 🅰️ Alpha Lead about Approve merging PR 879');
    await expect(page.locator('.agent-talk input[type="text"]')).toBeFocused();
    await page.keyboard.type('What changed since the last review?');
    await page.keyboard.press('Enter');
    await expect.poll(() => m.calls.find((c) => c.path === '/sessions')?.body).toEqual({ text: 'What changed since the last review?', agent: 'alpha-lead', project: 'alpha' });
  });

  test('the Home hero takes a and renders the composer inline; a row-started session keeps the list polling until it ends', async ({ page }) => {
    const m = await open(page);
    await page.goto('/#/home');
    const hero = page.locator('.focus-block');
    await expect(hero).toBeVisible();
    await expect(hero.locator('.agent-chip')).toHaveText('🅰️ Alpha Lead');
    await hero.click();
    await page.keyboard.press('a');
    await expect(hero.locator('.agent-talk')).toBeVisible();
    await expect(page.locator('.agent-talk input[type="text"]')).toBeFocused();
    await page.keyboard.type('Go');
    await page.keyboard.press('Enter');
    await expect(hero.locator('.agent-talk')).toHaveCount(0);
    // The chip follows the session: once the mock flips it to idle, a 15 s poll shows Done (no poll = stuck on Working). Two cycles of slack: the flip can land right after a poll.
    await expect(hero.locator('.agent-chip')).toHaveText('Working');
    for (const x of m.sessions!) x.state = 'idle';
    await expect(hero.locator('.agent-chip')).toHaveText(/^Done/, { timeout: 35_000 });
  });

  test('Home rows carry the chip and the composer too', async ({ page }) => {
    const m = await open(page);
    await page.goto('/#/home');
    const first = page.locator('section[aria-label="Home"] .home-row').first();
    await expect(first).toBeVisible();
    await first.click();
    await expect(first.locator('.agent-chip')).toBeVisible();
    await page.keyboard.press('a');
    await expect(first.locator('.agent-talk')).toBeVisible();
    await expect(page.locator('.agent-talk input[type="text"]')).toBeFocused();
    await page.keyboard.type('Status?');
    await page.keyboard.press('Enter');
    await expect.poll(() => m.calls.find((c) => c.path === '/sessions')?.body?.text).toBe('Status?');
  });

  test('the project tile on Today carries the project agent and opens the composer', async ({ page }) => {
    const m = await open(page);
    await page.goto('/#/today');
    await page.getByTestId('quiet-side').locator('summary').click(); // tiles sit below the timeline, out of the way
    const tile = page.locator('[data-testid="tops"] li').filter({ hasText: 'Alpha' });
    await expect(tile.locator('.agent-chip')).toHaveText('🅰️ Alpha Lead');
    await tile.locator('.agent-chip').click();
    await expect(tile.locator('.agent-talk')).toBeVisible();
    await expect(page.locator('.agent-talk input[type="text"]')).toBeFocused();
    await page.keyboard.type('Where are we?');
    await page.keyboard.press('Enter');
    await expect.poll(() => m.calls.find((c) => c.path === '/sessions')?.body).toEqual({ text: 'Where are we?', agent: 'alpha-lead', project: 'alpha' });
  });
});
