/** @req FR:agent-thread/web.expand @req FR:agent-thread/web.hero @req FR:agent-thread/thread.ask @req FR:agent-thread/thread.assign @req FR:agent-thread/web.keys @req FR:agent-thread/web.a11y */
import { expect, test, type Page } from '@playwright/test';
import { mockApi, type Mock, type MockTeamAgent } from './mock';

const team: MockTeamAgent[] = [
  { slug: 'cos', name: 'CoS', role: 'Roll-up', scope: ['*'], mode: 'long-running', prompt: '', defined: true, projects: ['alpha', 'beta'] },
  { slug: 'alpha-lead', name: '🅰️ Alpha Lead', role: 'owns alpha', scope: ['alpha'], mode: 'ad-hoc', prompt: '', defined: true, projects: ['alpha'] },
];
const iso = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();
const frames = (updates: unknown[]) => updates.map((u) => `event: update\ndata: ${JSON.stringify(u)}\n\n`).join('');

async function open(page: Page, o: { runner?: boolean } = {}): Promise<Mock> {
  const m = await mockApi(page);
  m.team = team;
  if (o.runner !== false) m.sessions = [];
  m.inbox.push(
    { id: 'in-1', at: iso(30), project: 'alpha', ref: 'alpha:9', task: 'Review pull requests', kind: 'reply', to: 'none', text: 'Can you take this one?', state: 'open', row: 'alpha:9' },
    { id: 'in-2', at: iso(25), project: 'alpha', ref: 'alpha:9', task: 'Review pull requests', kind: 'reply', to: 'human', text: 'Yes. One question first.', state: 'handled', row: 'alpha:9', from: 'agent', agent: 'alpha-lead' },
  );
  m.asks.push({ key: 'q1', state: 'open', ask: 'Merge the docs PRs without a second review?', kind: 'approve', from: 'alpha-lead', project: 'alpha', recommend: 'Approve', reversible: true, priority: 'normal', blocks: 1, created: iso(20), updated: iso(20), score: 40, overdue: false, ref: 'alpha:9', row: 'alpha:9' });
  m.reviews = [{ ref: 'alpha:9', at: iso(22), verdict: 'partial', plan: 'Merge the docs PRs, hold the schema one', estimate: '1h', agent: 'alpha-lead', needs: ['q1'] }];
  await page.route('**/sessions/*/events', (r) => r.fulfill({ status: 200, contentType: 'text/event-stream', body: frames([{ type: 'done', stopReason: 'end_turn', cost: { usd: 0.1, tokens: 10 }, turns: 1, durationMs: 5 }]) }));
  await page.goto('/#/list');
  await expect(page.locator('.row').first()).toBeVisible();
  return m;
}
const row = (p: Page, ref: string) => p.locator(`.row[data-ref="${ref}"]`);

test.describe('Agent thread', () => {
  test('the expanded task shows the thread in order: you, the agent, the verdict, the ask (answerable in place)', async ({ page }) => {
    const m = await open(page);
    const r = row(page, 'alpha:9');
    await r.locator('.title').click();
    const th = r.locator('.thread');
    await expect(th).toBeVisible();
    await expect(th.locator('.th-item')).toHaveCount(4);
    const metas = th.locator('.th-meta');
    await expect(metas.nth(0)).toHaveText(/^You · /);
    await expect(metas.nth(1)).toHaveText(/^🅰️ Alpha Lead · /);
    await expect(th.locator('.th-text.you')).toHaveText('Can you take this one?');
    await expect(th.locator('.th-item.review .th-text')).toHaveText('Partly · 1h: Merge the docs PRs, hold the schema one');
    await expect(th.locator('.th-ask .th-text')).toHaveText('Merge the docs PRs without a second review?');
    await th.locator('.th-ask').getByRole('button', { name: 'Approve' }).click();
    await expect.poll(() => m.calls.find((c) => c.path === '/asks/q1/answer')?.body).toEqual({ answer: 'go' });
    await expect(th.locator('.th-ask .th-state')).toHaveText('Approved');
    await expect(th.getByRole('group', { name: /Talk to 🅰️ Alpha Lead/ })).toBeVisible();
  });

  test('a opens the task and focuses the composer; Ask saves on the task and starts the agent; a second ask follows up an idle session', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'keyboard flow');
    const m = await open(page);
    const r = row(page, 'alpha:6');
    await r.click();
    await page.keyboard.press('a');
    const box = r.locator('.thread input[type="text"]');
    await expect(box).toBeFocused();
    await page.keyboard.type('Is the plan solid?');
    await page.keyboard.press('Enter');
    await expect.poll(() => m.calls.find((c) => c.path === '/inbox')?.body).toEqual({ ref: 'alpha:6', text: 'Is the plan solid?', kind: 'reply' });
    await expect.poll(() => m.calls.find((c) => c.path === '/sessions')?.body).toEqual({ text: 'Is the plan solid?', agent: 'alpha-lead', ref: 'alpha:6' });
    await expect(r.locator('.thread .th-text.you')).toHaveText('Is the plan solid?');
    await expect(r.locator('.thread .th-note.live')).toContainText('Working');
    // The session goes idle: the next question is a follow-up to it, not a new session.
    for (const x of m.sessions!) x.state = 'idle';
    await expect(r.locator('.thread .th-note.live')).toHaveCount(0, { timeout: 35_000 }); // the next sessions poll re-reads the thread
    await page.keyboard.press('a');
    await expect(box).toBeFocused();
    await page.keyboard.type('And the deploy?');
    await page.keyboard.press('Enter');
    await expect.poll(() => m.calls.filter((c) => c.path.endsWith('/prompt')).length, { timeout: 15_000 }).toBe(1);
    expect(m.calls.filter((c) => c.path === '/sessions')).toHaveLength(1);
    await page.keyboard.press('Escape'); // leaves the box
    await page.keyboard.press('Escape'); // closes the row
    await expect(r.locator('.thread')).toHaveCount(0);
  });

  test('Assign claims the row and starts the agent with the assign prompt; the Home hero has the thread too', async ({ page }) => {
    const m = await open(page);
    const r = row(page, 'alpha:9');
    await r.locator('.title').click();
    await r.locator('.thread').getByRole('button', { name: /^Assign/ }).click();
    await expect.poll(() => m.calls.find((c) => c.path === '/tasks/alpha:9/assign')?.body).toEqual({ agent: 'alpha-lead' });
    await expect(page.locator('.toast')).toContainText('Assigned to alpha-lead');
    await expect(r.locator('.thread .th-note.live')).toContainText('Working');
    await page.goto('/#/home');
    const hero = page.locator('.focus-block');
    await expect(hero).toBeVisible();
    await hero.locator('h1').click();
    await expect(hero.locator('.thread')).toBeVisible();
    await expect(hero.locator('.thread input[type="text"]')).toBeVisible();
  });

  test('without a runner the thread still reads and Ask saves on the task; Assign is off', async ({ page }) => {
    const m = await open(page, { runner: false });
    const r = row(page, 'alpha:9');
    await r.locator('.title').click();
    const th = r.locator('.thread');
    await expect(th.locator('.th-item')).toHaveCount(4);
    await expect(th.getByRole('button', { name: /^Assign/ })).toBeDisabled();
    await th.locator('input[type="text"]').fill('Noted, thanks');
    await th.locator('input[type="text"]').press('Enter');
    await expect.poll(() => m.calls.find((c) => c.path === '/inbox')?.body).toEqual({ ref: 'alpha:9', text: 'Noted, thanks', kind: 'reply' });
    await expect(page.locator('.toast')).toContainText('runs in stack web');
    expect(m.calls.find((c) => c.path === '/sessions')).toBeUndefined();
  });
});
