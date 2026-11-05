/** @req FR:agent-team/web.chip @req FR:agent-team/web.chip.live @req FR:agent-team/web.chip.title @req FR:agent-team/web.talk @req FR:agent-team/web.anything @req FR:agent-team/web.review @req FR:agent-team/web.norunner @req FR:agent-team/web.keys @req FR:agent-team/web.a11y */
import { expect, test, type Page } from '@playwright/test';
import { mockApi, type Mock, type MockTeamAgent } from './mock';

const team: MockTeamAgent[] = [
  { slug: 'cos', name: 'CoS', role: 'Roll-up', scope: ['*'], mode: 'long-running', prompt: '', defined: true, source: 'claude', projects: ['alpha', 'beta'] },
  { slug: 'alpha-lead', name: '🅰️ Alpha Lead', role: 'owns alpha', scope: ['alpha'], mode: 'ad-hoc', prompt: '', defined: true, source: 'stack', projects: ['alpha'], reportsTo: 'cos' },
  { slug: 'old-worker', name: 'PR sweep worker: alpha', scope: ['alpha'], mode: 'ad-hoc', prompt: '', defined: false, source: 'metadata', projects: ['alpha'], reportsTo: 'cos' },
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
  test('every row names its agent (the roll-up, then the specialists in the title) on hover or cursor; a project with no agent says so', async ({ page }) => {
    const m = await open(page);
    await row(page, 'alpha:6').hover();
    await expect(row(page, 'alpha:6').locator('.agent-chip')).toHaveText('CoS');
    await expect(row(page, 'alpha:6').locator('.agent-chip')).toHaveAttribute('title', 'CoS › 🅰️ Alpha Lead. Talk to it (a)'); // the stale metadata worker is gone
    await row(page, 'beta:4').hover();
    await expect(row(page, 'beta:4').locator('.agent-chip')).toHaveText('CoS');
    await expect(row(page, 'beta:4').locator('.agent-chip')).toHaveAttribute('title', 'CoS: Roll-up. Talk to it (a)');
    m.team = [team[1]];
    await page.reload();
    await row(page, 'alpha:6').hover();
    await expect(row(page, 'alpha:6').locator('.agent-chip')).toHaveText('🅰️ Alpha Lead');
    await row(page, 'beta:4').hover();
    await expect(row(page, 'beta:4').locator('.agent-chip')).toHaveText('No agent');
    // a metadata-only worker with a recent session is live again
    m.team = team; m.sessions = [{ id: 'a1b2c3d4-0000-0000-0000-000000000009', title: 'PR sweep worker: alpha', project: 'alpha', owner: 'alpha', cwd: '/x/alpha', lastActive: new Date().toISOString(), state: 'idle', cost: { usd: 0, tokens: 10 }, prs: [] }];
    await page.reload();
    await row(page, 'alpha:6').hover();
    await expect(row(page, 'alpha:6').locator('.agent-chip')).toHaveAttribute('title', 'CoS › 🅰️ Alpha Lead › PR sweep worker: alpha. Talk to it (a)');
  });

  test('a opens the inline composer on the cursor row: agent picker, quick actions, Send starts a session and the row follows it', async ({ page }, info) => {
    const m = await open(page);
    await row(page, 'alpha:6').click();
    await expect(row(page, 'alpha:6')).toHaveClass(/cursor/);
    await page.keyboard.press('a');
    const talk = row(page, 'alpha:6').locator('.thread .agent-talk');
    await expect(talk).toBeVisible();
    await expect(talk).toHaveAttribute('aria-label', /Talk to CoS about/);
    await expect(talk.locator('select')).toHaveValue('cos');
    await expect(talk.locator('select option')).toHaveCount(2);
    await expect(talk.locator('select option').first()).toHaveAttribute('title', 'Roll-up');
    await expect(talk.locator('select option').nth(1)).toHaveText('🅰️ Alpha Lead');
    await expect(talk.getByRole('button', { name: /^Review/ })).toBeVisible();
    await expect(talk.locator('input[type="text"]')).toBeFocused();
    if (info.project.name !== 'mobile') { await expect(talk.getByLabel('Keep open')).toBeChecked(); await talk.getByLabel('Keep open').uncheck(); await talk.locator('input[type="text"]').focus(); } // the roll-up is long-running
    await page.keyboard.type('Check the deploy and tell me if the plan is solid');
    await page.keyboard.press('Enter');
    await expect.poll(() => m.calls.find((c) => c.path === '/sessions')?.body).toEqual({ text: 'Check the deploy and tell me if the plan is solid', agent: 'cos', ref: 'alpha:6' });
    if (info.project.name === 'mobile') { await expect(page.getByRole('dialog')).toBeVisible(); await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0); } // a phone keeps the long-running agent's drawer open
    await expect(row(page, 'alpha:6').locator('.thread .th-text.you')).toHaveText('Check the deploy and tell me if the plan is solid'); // the composer is the thread's own: it stays, the message lands above it
    await expect(row(page, 'alpha:6').locator('.agent-chip')).toHaveText('Working');
    // One open task at a time: a on another row moves the thread there.
    await page.keyboard.press('Escape');
    await page.keyboard.press('j');
    await page.keyboard.press('a');
    await expect(page.locator('.thread')).toHaveCount(1);
    await expect(row(page, 'alpha:9').locator('.thread')).toBeVisible();
    await page.keyboard.press('Escape'); await page.keyboard.press('Escape');
    await expect(page.locator('.thread')).toHaveCount(0);
  });

  test('the chip opens the thread; Keep open + Assign hands the task over and opens the drawer', async ({ page }, info) => {
    const m = await open(page);
    await row(page, 'alpha:9').click(); // the cursor row shows its chip on every device
    await row(page, 'alpha:9').locator('.agent-chip').click();
    const talk = row(page, 'alpha:9').locator('.thread .agent-talk');
    await expect(talk).toBeVisible();
    if (info.project.name === 'mobile') { await expect(talk.getByLabel('Keep open')).toBeVisible(); await talk.getByLabel('Keep open').uncheck(); await talk.getByRole('button', { name: /^Assign/ }).click(); await expect.poll(() => m.calls.find((c) => c.path === '/tasks/alpha:9/assign')?.body).toEqual({ agent: 'cos' }); await expect(page.locator('.toast')).toContainText('Assigned to cos'); return; }
    await talk.getByLabel('Keep open').check();
    await talk.getByRole('button', { name: /^Assign/ }).click();
    await expect.poll(() => m.calls.find((c) => c.path === '/tasks/alpha:9/assign')?.body).toEqual({ agent: 'cos' });
    await expect(page.getByRole('dialog')).toBeVisible();
    await expect(page.getByRole('dialog')).toContainText('CoS · Review pull requests 🟠 · alpha:9');
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
    await expect(row(page, 'alpha:6').locator('.agent-chip')).toHaveText('CoS');
    await expect(row(page, 'alpha:6').locator('.agent-chip')).toHaveAttribute('title', 'CoS › 🅰️ Alpha Lead › PR sweep worker: alpha. Talk to it (a)'); // no session data: nothing is dropped
    await row(page, 'alpha:6').locator('.agent-chip').click();
    const talk = row(page, 'alpha:6').locator('.thread .agent-talk');
    await expect(talk).toBeVisible();
    await expect(talk.locator('input[type="text"]')).toBeEnabled(); // a question still lands on the task
    await expect(talk).toContainText('Runs in stack web on your machine');
    await expect(talk.getByRole('button', { name: /^Assign/ })).toBeDisabled();
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
    await expect(hero.locator('.agent-chip')).toHaveCount(0); // no agent name on the NOW card (home3.context)
    await hero.click();
    await page.keyboard.press('a');
    await expect(hero.locator('.thread .agent-talk')).toBeVisible();
    await expect(page.locator('.agent-talk input[type="text"]')).toBeFocused();
    await page.keyboard.type('Go');
    await page.keyboard.press('Enter');
    await expect(hero.locator('.thread .th-text.you')).toHaveText('Go');
    // The roll-up is long-running, so Keep open is its default and the session drawer opens; close it to get back to the card.
    if (await page.getByRole('dialog').count()) { await page.keyboard.press('Escape'); await expect(page.getByRole('dialog')).toHaveCount(0); }
    // The context line follows the session: `agent has it` while it works; once the mock flips it to idle, a 15 s poll clears it (no poll = stuck). Two cycles of slack: the flip can land right after a poll.
    // @req FR:web-app/home3.context
    await expect(hero.getByTestId('now-context')).toContainText('agent has it');
    // @req FR:web-app/home3.menu.agent — an agent has it, so the menu does not offer Delegate
    await hero.locator('.h1-toggle').click(); // the open card shows its detail; closed, it shows the actions and the menu
    await hero.getByRole('button', { name: 'More actions' }).click();
    await expect(hero.getByRole('menuitem', { name: /Delegate/ })).toHaveCount(0);
    await expect(hero.getByRole('menuitem', { name: /Defer 2h/ })).toBeVisible();
    await page.keyboard.press('Escape');
    for (const x of m.sessions!) x.state = 'idle';
    await expect(hero.getByTestId('now-context')).not.toContainText('agent has it', { timeout: 35_000 });
  });

  test('Home rows carry the composer too (no agent chip on a row: title and project only)', async ({ page }) => {
    const m = await open(page);
    await page.goto('/#/home');
    const first = page.locator('section[aria-label="Home"] .home-row').first();
    await expect(first).toBeVisible();
    await first.click();
    await expect(first.locator('.agent-chip')).toHaveCount(0);
    await page.keyboard.press('a');
    await expect(first.locator('.thread .agent-talk')).toBeVisible();
    await expect(page.locator('.agent-talk input[type="text"]')).toBeFocused();
    await page.keyboard.type('Status?');
    await page.keyboard.press('Enter');
    await expect.poll(() => m.calls.find((c) => c.path === '/sessions')?.body?.text).toBe('Status?');
  });

  test('the project tile on Today carries the project agent and opens the composer', async ({ page }) => {
    const m = await open(page);
    await page.goto('/#/today');
    await page.getByTestId('quiet-side').locator('.quiet-toggle').click(); // tiles sit below the timeline, out of the way
    const tile = page.locator('[data-testid="tops"] li').filter({ hasText: 'Alpha' });
    await expect(tile.locator('.agent-chip')).toHaveText('CoS');
    await tile.locator('.agent-chip').click();
    await expect(tile.locator('.agent-talk')).toBeVisible();
    await expect(page.locator('.agent-talk input[type="text"]')).toBeFocused();
    await page.keyboard.type('Where are we?');
    await page.keyboard.press('Enter');
    await expect.poll(() => m.calls.find((c) => c.path === '/sessions')?.body).toEqual({ text: 'Where are we?', agent: 'cos', project: 'alpha' });
  });
});
