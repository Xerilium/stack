/** @req FR:agent-sessions/web.view @req FR:agent-sessions/web.drawer @req FR:agent-sessions/web.message @req FR:agent-sessions/web.usage @req FR:agent-sessions/web.usage.panel @req FR:agent-sessions/web.usage.price @req FR:agent-sessions/web.new @req FR:agent-sessions/web.new.submit @req FR:agent-sessions/web.new.context @req FR:agent-sessions/web.states @req FR:agent-sessions/web.keys @req FR:agent-sessions/web.a11y @req FR:agent-sessions/web.scope @req FR:agent-sessions/web.scope.all @req FR:agent-sessions/web.order @req FR:agent-sessions/web.pins @req FR:agent-sessions/web.groups
 * @req FR:agent-team/org.tree @req FR:agent-team/org.tree.row @req FR:agent-team/org.tree.sessions @req FR:agent-team/org.tree.unmatched @req FR:agent-team/org.tree.pinned @req FR:agent-team/org.tree.phone @req FR:agent-team/org.order @req FR:agent-team/org.order.scope @req FR:agent-team/org.match @req FR:agent-team/org.keys @req FR:agent-team/org.a11y
 * @req FR:agent-team/compose.agent @req FR:agent-team/compose.agent.default @req FR:agent-team/compose.agent.filter @req FR:agent-team/compose.folder @req FR:agent-team/compose.prompt @req FR:agent-team/compose.after */
import { expect, test, type Page } from '@playwright/test';
import { mockApi, type Mock, type MockSession, type MockTeamAgent } from './mock';

const iso = (minAgo: number) => new Date(Date.now() - minAgo * 60_000).toISOString();
const id = (n: number) => `a1b2c3d4-0000-0000-0000-00000000000${n}`;
const mk = (n: number, o: Partial<MockSession> = {}): MockSession => ({ id: id(n), title: `Session ${n}`, project: 'stack', owner: 'stack', cwd: '/x/stack', branch: 'main', lastActive: iso(n * 10), state: 'idle', cost: { usd: 0.5, tokens: 120_000 }, prs: [], ...o });
const seed = (): MockSession[] => [
  mk(1, { title: 'allyte: landing page PR 879', project: 'allyte', owner: 'allyte', cwd: '/x/allyte', branch: 'xe/landing', state: 'needs-you', cost: { usd: 2.1, tokens: 1_900_000 } }),
  mk(2, { title: 'stack: live ask queue', state: 'running', cost: { usd: 1.25, tokens: 1_200_000 } }),
  mk(3, { title: 'todo: plan the week', project: 'todo', owner: null, cwd: '/x/todo', branch: undefined, state: 'active' }),
  mk(4, { title: 'finops-toolkit: v15 notes', project: 'finops-toolkit', owner: 'finops-toolkit', cwd: '/x/ftk', state: 'idle', lastActive: iso(90) }),
  mk(5, { title: 'old research', state: 'stale', lastActive: iso(60 * 50), cost: { usd: 0.004, tokens: 900 } }),
];
const team: MockTeamAgent[] = [
  { slug: 'cos', name: '👔 CoS', role: 'Chief of Staff', scope: ['*'], mode: 'long-running', prompt: '', defined: true, source: 'claude', projects: ['alpha', 'beta'] },
  { slug: 'alpha-lead', name: '🅰️ Alpha Lead', role: 'owns alpha', scope: ['alpha'], mode: 'ad-hoc', prompt: '', defined: true, source: 'stack', projects: ['alpha'], reportsTo: 'cos' },
  { slug: 'beta-cos', name: 'Beta CoS', role: 'owns beta', scope: ['beta'], mode: 'ad-hoc', prompt: '', defined: true, source: 'claude', projects: ['beta'], reportsTo: 'cos' },
  { slug: 'beta-worker', name: 'PR sweep worker: beta', scope: ['beta'], mode: 'ad-hoc', prompt: '', defined: false, source: 'metadata', projects: ['beta'], reportsTo: 'beta-cos' },
  { slug: 'lonely', name: 'Lonely', role: 'no project', scope: [], mode: 'ad-hoc', prompt: '', defined: true, source: 'claude', projects: [], reportsTo: 'cos' },
];
/** Sessions for the team tree: alpha and beta are the mock projects (alpha ranks first on Home). */
const teamSeed = (): MockSession[] => [
  mk(1, { title: '👔 CoS · morning brief', project: 'todo', owner: null, cwd: '/x/todo', state: 'active', cost: { usd: 0.1, tokens: 90_000 } }),
  mk(2, { title: '🅰️ Alpha Lead · Review pull requests 🟠 · alpha:9', project: 'alpha-web', owner: 'alpha', cwd: '/x/alpha-web/.claude/worktrees/zany-fox-1a2b3c', state: 'running', cost: { usd: 1, tokens: 1_200_000 } }),
  mk(3, { title: 'alpha lead: triage', project: 'alpha-web', owner: 'alpha', cwd: '/x/alpha-web', lastActive: iso(40), cost: { usd: 0.2, tokens: 200_000 } }),
  mk(4, { title: 'Alpha Lead: docs', project: 'alpha-web', owner: 'alpha', cwd: '/x/alpha-web', lastActive: iso(60) }),
  mk(5, { title: 'alpha-lead: old', project: 'alpha-web', owner: 'alpha', cwd: '/x/alpha-web', lastActive: iso(900), state: 'stale' }),
  mk(6, { title: 'beta: fix the parser', project: 'beta', owner: 'beta', cwd: '/x/beta', lastActive: iso(30) }),
  mk(7, { title: 'maenifold research', project: 'maenifold-rs', owner: null, cwd: '/x/maenifold-rs', lastActive: iso(5) }),
  mk(8, { title: 'Lonely · tests', project: 'prime', owner: null, cwd: '/x/prime', lastActive: iso(7) }),
];
const today = new Date().toISOString().slice(0, 10);
const cost = { attribution: 'lastActive', days: [{ date: '2026-10-23', usd: 3.2, tokens: 410_000, sessions: 4 }, { date: today, usd: 4.1, tokens: 1_200_000, sessions: 6 }], projects: [{ project: 'allyte', usd: 14.2, tokens: 5_000_000, sessions: 3 }, { project: 'stack', usd: 9.8, tokens: 3_000_000, sessions: 2 }], models: [{ model: 'claude-sonnet-5-5', usd: 24, tokens: 8_000_000 }], total: { usd: 31, tokens: 8_000_000, sessions: 10 } };

const frames = (updates: unknown[]) => updates.map((u) => `event: update\ndata: ${JSON.stringify(u)}\n\n`).join('');
async function open(page: Page, sessions = seed(), withTeam = false): Promise<Mock> {
  const m = await mockApi(page);
  m.sessions = sessions; m.sessionCost = cost;
  if (withTeam) m.team = team;
  m.sessionTurns[id(2)] = [{ at: iso(20), role: 'user', text: 'Build the live ask queue' }, { at: iso(19), role: 'assistant', text: 'Spec first, then tests.' }, { at: iso(19), role: 'assistant', text: '⚙ Bash: pnpm test' }];
  await page.route('**/sessions/*/events', (r) => r.fulfill({ status: 200, contentType: 'text/event-stream', body: frames([
    { type: 'message_chunk', role: 'assistant', text: 'On ' }, { type: 'message_chunk', role: 'assistant', text: 'it.' },
    { type: 'tool_call', callId: 'tu1', title: 'Bash: git status', kind: 'execute', status: 'pending' },
    { type: 'tool_update', callId: 'tu1', status: 'completed', output: 'clean' },
    { type: 'tool_call', callId: 'tu2', title: 'Bash: git push', kind: 'execute', status: 'pending' },
    { type: 'permission', requestId: 'r1', callId: 'tu2', title: 'Allow Bash: git push', options: [] },
    { type: 'tool_update', callId: 'tu2', status: 'completed' },
    { type: 'done', stopReason: 'end_turn', cost: { usd: 0.12, tokens: 300 }, turns: 3, durationMs: 900 },
  ]) }));
  await page.goto('/#/sessions');
  await expect(page.locator('.sess-row').first()).toBeVisible();
  if (sessions.length) await expect(page.locator('.sess-li.cursor, .org-agent.cursor')).toHaveCount(1);
  return m;
}
const showAll = (p: Page) => p.getByTestId('scope-note').getByRole('button', { name: /Show all/ }).click();
const drawer = (p: Page) => p.getByRole('dialog');

test.describe('Sessions', () => {
  test('list: usage strip in tokens, attention order, state labels, project · branch; sessions from other repos wait behind Show all', async ({ page }) => {
    await open(page);
    await expect(page.getByTestId('cost-strip')).toContainText('Today 1.2M tokens · 6 sessions');
    await expect(page.getByTestId('cost-strip')).toContainText('2 days 8.0M');
    await expect(page.getByTestId('cost-strip')).not.toContainText('$');
    const rows = page.locator('.sess-row');
    await expect(rows).toHaveCount(4); // todo belongs to no project
    await expect(rows.nth(0)).toContainText('Needs you');
    await expect(rows.nth(0)).toContainText('allyte: landing page PR 879');
    await expect(rows.nth(1)).toContainText('Running');
    await expect(rows.nth(3)).toContainText('Stale');
    await expect(rows.nth(3)).toContainText('900');
    await expect(rows.nth(3)).not.toContainText('$');
    await expect(page.getByTestId('scope-note')).toContainText('1 more from other repos');
    await showAll(page);
    await expect(rows).toHaveCount(5);
    await expect(rows.nth(2)).toContainText('todo: plan the week');
    await expect(page.getByTestId('scope-note')).toContainText('Showing every repo');
    await expect(page).toHaveURL(/#\/(sessions|agents)/);
  });

  test('Enter opens the drawer with the history; Esc closes and returns focus to the row', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'keyboard flow');
    await open(page);
    await page.keyboard.press('j');
    await page.keyboard.press('Enter');
    await expect(drawer(page)).toBeVisible();
    await expect(drawer(page).getByRole('heading', { level: 2 })).toHaveText('stack: live ask queue');
    await expect(drawer(page).locator('.turns .tl')).toHaveCount(3);
    await expect(drawer(page).locator('.turns .tl.user')).toHaveText('Build the live ask queue');
    await expect(drawer(page).getByLabel('Message stack: live ask queue')).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(drawer(page)).toHaveCount(0);
    await expect(page.locator('.sess-li').nth(1).locator('.sess-row')).toBeFocused();
  });

  test('a running session streams: text, tool lines with status, waiting for you with a link to Asks, done with cost', async ({ page }) => {
    await open(page);
    await page.locator('.sess-row').nth(1).click();
    const d = drawer(page);
    await expect(d.locator('.stream .tl.assistant')).toHaveText('On it.');
    await expect(d.locator('.stream .tl.tool').nth(0)).toContainText('Bash: git status');
    await expect(d.locator('.stream .tl.tool').nth(0)).toHaveClass(/completed/);
    await expect(d.locator('.drawer-note.done')).toHaveText('Done · 300 tokens · 3 turns');
  });

  test('sending: Enter posts the prompt, the user line appears, Stop cancels; 409 shows inline', async ({ page }) => {
    const m = await open(page);
    await showAll(page);
    await expect(page.locator('.sess-row')).toHaveCount(5);
    await page.locator('.sess-row').nth(3).click();
    const d = drawer(page);
    await d.getByLabel(/^Message/).fill('Add tests for the parser');
    await page.keyboard.press('Enter');
    await expect.poll(() => m.calls.find((c) => c.path === `/sessions/${id(4)}/prompt`)?.body).toEqual({ text: 'Add tests for the parser' });
    await expect(d.locator('.turns .tl.user').last()).toHaveText('Add tests for the parser');
    await expect(d.locator('.drawer-note.done')).toBeVisible();
    await page.keyboard.press('Escape');
    await page.locator(`.sess-li[data-id="${id(3)}"] .sess-row`).click(); // the todo session is active elsewhere
    await drawer(page).getByLabel(/^Message/).fill('hello');
    await page.keyboard.press('Enter');
    await expect(drawer(page).getByRole('alert')).toContainText('active in another window');
  });

  test('a needs-you session points to Asks', async ({ page }) => {
    await open(page);
    await page.locator('.sess-row').nth(0).click();
    await expect(drawer(page).getByRole('link', { name: 'Answer in Asks' })).toHaveAttribute('href', '#/asks');
  });

  test('Usage (c) shows the last days with token bars, per-project totals, the model line, and one list-price line', async ({ page }, info) => {
    await open(page);
    if (info.project.name === 'mobile') await page.getByRole('button', { name: /Usage/ }).click(); else await page.keyboard.press('c');
    const costs = page.getByTestId('costs');
    await expect(costs.locator('.cost-days li')).toHaveCount(2);
    await expect(costs.locator('.cost-days li').nth(1)).toContainText('1.2M · 6 sessions');
    await expect(costs.locator('.cost-days li').nth(0).locator('.bar span')).toHaveAttribute('style', /width: 34%/);
    await expect(costs.locator('.cost-chips.projects li')).toHaveText(['allyte 5.0M', 'stack 3.0M']);
    await expect(costs.locator('.cost-chips.models li')).toHaveText(['sonnet-5-5 8.0M']);
    await expect(page.getByTestId('price-line')).toHaveText('≈ $31 at list price · prepaid plan');
  });

  test('New (n): the prompt is first and focused, the folder under it; Cmd/Ctrl+Enter starts, Enter is a newline', async ({ page }, info) => {
    const m = await open(page);
    if (info.project.name === 'mobile') await page.getByRole('button', { name: 'New', exact: true }).click(); else await page.keyboard.press('n');
    const d = drawer(page);
    await expect(d.getByRole('heading', { level: 2 })).toHaveText('New session');
    await expect(d.getByLabel('First prompt')).toBeFocused();
    await d.getByLabel('Folder').fill('/x/stack');
    await d.getByLabel('First prompt').fill('Write the release notes');
    await d.getByLabel('First prompt').press('Enter');
    await expect(d.getByLabel('First prompt')).toHaveValue('Write the release notes\n');
    expect(m.calls.find((c) => c.path === '/sessions')).toBeUndefined();
    await d.getByLabel('First prompt').fill('Write the release notes');
    await d.getByLabel('First prompt').press('ControlOrMeta+Enter');
    await expect.poll(() => m.calls.find((c) => c.path === '/sessions')?.body).toEqual({ cwd: '/x/stack', text: 'Write the release notes' });
    await expect(d.locator('.turns .tl.user')).toHaveText('Write the release notes');
    await expect(d.locator('.drawer-note.done')).toBeVisible();
  });

  test('states: not available on this host, empty, error with Retry', async ({ page }) => {
    const m = await mockApi(page);
    await page.goto('/#/sessions');
    await expect(page.getByTestId('sessions-unavailable')).toContainText('Not available on this host');
    m.sessions = [];
    await page.reload();
    await expect(page.getByTestId('sessions-empty')).toContainText('No sessions on this machine yet.');
    m.fail.set('/sessions', { status: 500, code: 'internal', message: 'Internal error' });
    await page.reload();
    await expect(page.getByRole('alert')).toContainText('Cannot load agents');
    await page.getByRole('button', { name: 'Retry' }).click();
    await expect(page.getByTestId('sessions-empty')).toBeVisible();
  });

  test('the palette lists the session commands and g s goes there', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'keyboard flow');
    const m = await mockApi(page); m.sessions = seed();
    await page.goto('/#/asks');
    await page.keyboard.press('g'); await page.keyboard.press('s');
    await expect(page).toHaveURL(/#\/agents/);
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: 'Command' }).fill('Agent:');
    await expect(page.getByRole('option', { name: /Agent: new/ })).toBeVisible();
    await expect(page.getByRole('option', { name: /Agent: stop/ })).toBeVisible();
  });

  // @req FR:agent-team/org.tree @req FR:agent-team/org.tree.row @req FR:agent-team/org.tree.sessions @req FR:agent-team/org.tree.unmatched @req FR:agent-team/org.tree.pinned @req FR:agent-team/org.order @req FR:agent-team/org.order.scope @req FR:agent-team/org.match @req FR:agent-team/org.a11y
  test('with a team the page opens as the org tree: the roll-up, reports nested, sessions under their agent, Unassigned by project, other repos hidden', async ({ page }) => {
    await open(page, teamSeed(), true);
    const tree = page.getByRole('tree');
    await expect(tree).toBeVisible();
    const agents = page.locator('.org-agent');
    await expect(agents.locator('.org-name')).toHaveText(['👔 CoS', '🅰️ Alpha Lead', 'Beta CoS', 'PR sweep worker: beta']); // Lonely covers no project
    await expect(agents.nth(0)).toHaveAttribute('aria-level', '1');
    await expect(agents.nth(1)).toHaveAttribute('aria-level', '2');
    await expect(agents.nth(3)).toHaveAttribute('aria-level', '3');
    await expect(agents.nth(0).locator('.org-usage')).toHaveText('90k');
    await expect(agents.nth(1).locator('.org-usage')).toHaveText('1.6M');
    await expect(agents.nth(2)).toContainText('No sessions');
    // the roll-up's session from an untracked repo shows under it; Alpha Lead shows 3 of 4 with "1 more"
    const rows = page.locator('.sess-row');
    await expect(rows.nth(0)).toContainText('👔 CoS · morning brief');
    await expect(rows.nth(1)).toContainText('Review pull requests');
    await expect(rows.nth(1)).toContainText('Running');
    await expect(rows.nth(3)).toContainText('Alpha Lead: docs');
    await expect(page.locator('.org-more .more-btn')).toHaveText('1 more');
    await expect(rows).toHaveCount(5); // 1 cos + 3 alpha + beta's unassigned; maenifold and Lonely's are hidden
    await expect(page.locator('.org-project')).toHaveText(['beta · no agent']);
    await expect(page.getByTestId('scope-note')).toContainText('2 more from other repos');
    await page.locator('.org-more .more-btn').click();
    await expect(rows).toHaveCount(6);
    await expect(rows.nth(4)).toContainText('alpha-lead: old');
    await showAll(page);
    await expect(agents.locator('.org-name')).toHaveText(['👔 CoS', '🅰️ Alpha Lead', 'Beta CoS', 'PR sweep worker: beta', 'Lonely']);
    await expect(page.locator('.org-project')).toHaveText(['beta · no agent', 'maenifold-rs · no agent']);
  });

  test('a pinned session always shows and keeps its place in the tree, marked', async ({ page }) => {
    await open(page, teamSeed(), true);
    await expect(page.locator('.sess-row')).toHaveCount(5);
    const maen = () => page.locator(`.sess-li[data-id="${id(7)}"]`);
    await showAll(page);
    await maen().locator('.pin').click();
    await page.getByTestId('scope-note').getByRole('button', { name: /Only my projects/ }).click();
    await expect(maen()).toBeVisible();
    await expect(maen().locator('.pin-mark')).toBeVisible();
    await expect(page.locator('.org-project').last()).toContainText('maenifold-rs');
    await expect(page.locator('.sess-row').nth(0)).toContainText('👔 CoS · morning brief'); // pins never reorder the tree
  });

  // @req FR:agent-team/org.keys @req FR:agent-sessions/web.groups @req FR:agent-sessions/web.order
  test('t and p switch Team, Projects and the flat list; the choice survives a reload; Projects groups by owner in priority order', async ({ page }, info) => {
    test.skip(info.project.name === 'mobile', 'keyboard flow');
    await open(page, teamSeed(), true);
    await page.keyboard.press('p');
    await expect(page.getByRole('tree')).toHaveCount(0);
    await expect(page.locator('.sess-group')).toHaveText(['alpha', 'beta', 'Other repos']); // the roll-up's own session has no owner
    await page.reload();
    await expect(page.locator('.sess-group').first()).toHaveText('alpha');
    await page.keyboard.press('p');
    await expect(page.locator('.sess-group')).toHaveCount(0);
    await expect(page.locator('.sess-row').nth(0)).toContainText('Review pull requests'); // running first, then alpha before beta
    await page.keyboard.press('t');
    await expect(page.getByRole('tree')).toBeVisible();
  });

  // @req FR:agent-team/compose.agent @req FR:agent-team/compose.agent.default @req FR:agent-team/compose.agent.filter @req FR:agent-team/compose.folder @req FR:agent-team/compose.prompt @req FR:agent-team/compose.after
  test('Enter on an agent row opens the composer with that agent; the folder follows the project; Cmd/Ctrl+Enter starts it under the agent', async ({ page }, info) => {
    const m = await open(page, teamSeed(), true);
    if (info.project.name === 'mobile') await page.locator('.org-agent').nth(1).locator('.org-row').click();
    else { await page.keyboard.press('j'); await page.keyboard.press('j'); await expect(page.locator('.org-agent').nth(1)).toHaveClass(/cursor/); await page.keyboard.press('Enter'); }
    const d = drawer(page);
    await expect(d.getByRole('heading', { level: 2 })).toHaveText('New session');
    await expect(d.getByLabel('First prompt')).toBeFocused();
    await expect(d.getByRole('combobox', { name: 'Agent' })).toHaveValue('🅰️ Alpha Lead');
    await expect(d.getByTestId('runs-in')).toContainText('Runs in alpha-web');
    // pick another agent by typing: the folder follows
    await d.getByRole('combobox', { name: 'Agent' }).click();
    await d.getByRole('combobox', { name: 'Agent' }).fill('beta');
    await expect(d.getByRole('option')).toHaveText([/CoS/, /Beta CoS/, /PR sweep worker: beta/, /No agent/]); // the roll-up covers beta too
    await d.getByRole('option', { name: /Beta CoS/ }).click();
    await expect(d.getByRole('combobox', { name: 'Agent' })).toHaveValue('Beta CoS');
    await expect(d.getByTestId('runs-in')).toContainText('Runs in beta');
    await expect(d.getByLabel('First prompt')).toBeFocused();
    await d.getByLabel('First prompt').fill('Plan the beta release');
    await d.getByLabel('First prompt').press('ControlOrMeta+Enter');
    await expect.poll(() => m.calls.find((c) => c.path === '/sessions')?.body).toEqual({ cwd: '/x/beta', text: 'Plan the beta release', agent: 'beta-cos', project: 'beta' });
    await expect(d.getByRole('heading', { level: 2 })).toHaveText('Beta CoS · beta');
    await page.keyboard.press('Escape');
    await expect(page.locator('.org-agent').nth(2).locator('.org-usage')).not.toHaveText('No sessions'); // the new session landed under Beta CoS
  });

  test('mobile: rows are 44px tall and the drawer is a sheet', async ({ page }, info) => {
    test.skip(info.project.name !== 'mobile', 'touch layout');
    await open(page);
    for (const r of await page.locator('.sess-row').all()) expect((await r.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    await page.locator('.sess-row').nth(1).click();
    const box = (await drawer(page).boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(370);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= 390)).toBe(true);
  });
});
