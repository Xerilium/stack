/**
 * Asks need context: a brief on the expanded card, `No context yet` and `Ask <agent> for context` when an approve or
 * decide ask has none, going ahead only behind a confirm, and references as links. 375 px and 1280 px, axe clean.
 * @req FR:ask-briefs/web.brief @req FR:ask-briefs/web.none @req FR:ask-briefs/web.context @req FR:ask-briefs/web.anyway
 * @req FR:ask-briefs/context.need @req FR:ask-briefs/link.web @req FR:ask-briefs/link.repo
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { BRIEF, mockApi, seed, type MockAsk, type MockNeed } from './mock';

const iso = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const FULL = {
  problem: 'PR 130 adds status ingest. Agents cannot report without it.',
  solution: 'Merge #130, then FH 1105 can ship.',
  risks: ['The store is new.', 'See Xerilium/stack#152 for open items.'],
  recommendation: 'Approve. CI is green.',
  evidence: ['https://github.com/Xerilium/stack/actions/runs/1'],
};
const PROJECTS: { name: string; title: string; metadata: Record<string, string> }[] = [
  { name: 'stack', title: 'Stack', metadata: { Repository: '[Xerilium/stack](https://github.com/Xerilium/stack)' } },
  { name: 'finops-toolkit', title: 'FinOps toolkit', metadata: { Repository: '[microsoft/finops-toolkit](https://github.com/microsoft/finops-toolkit)', Aliases: 'ftk, fh' } },
];
const need = (over: Partial<MockNeed>): MockNeed => ({ id: 'rp.xe-cos.stack.pr-130', title: 'Approve PR 130', recommendation: 'Approve', link: 'https://github.com/Xerilium/stack/pull/130', project: 'stack', from: 'xe-cos', askKind: 'approve', ...over });
const ask = (o: Partial<MockAsk> & { key: string; ask: string }): MockAsk => ({ state: 'open', kind: 'approve', from: 'allyte-cos', reversible: false, priority: 'normal', blocks: 0, created: iso(-5), updated: iso(-1), score: 30, overdue: false, ...o });

async function now(page: Page, needs: MockNeed[]) {
  const m = await mockApi(page, { tasks: seed(), projects: PROJECTS });
  m.needs = needs;
  await page.goto('/#/now');
  return m;
}
const axe = async (page: Page, sel: string) => { const { violations } = await new AxeBuilder({ page }).include(sel).analyze(); expect(violations).toEqual([]); };

test.describe('Ask briefs', () => {
  test('Now: a need with no brief says No context yet; its one action asks the agent; it waits until the brief comes back', async ({ page }) => {
    const m = await now(page, [need({})]);
    const card = page.getByTestId('now-asks').locator(':scope > li').first();
    await expect(card.getByRole('button', { name: 'Ask xe-cos for context' })).toBeVisible(); // the collapsed card's one action
    await card.getByRole('button', { name: /Approve PR 130/ }).click();
    const more = card.getByTestId('now-ask-more');
    await expect(more.getByTestId('brief-none')).toContainText('No context yet');
    await expect(more.getByRole('button', { name: 'Go with it', exact: true })).toHaveCount(0);
    await expect(more.getByRole('button', { name: 'Ask xe-cos for context' })).toHaveClass(/primary/);
    await axe(page, '[data-testid="now-asks"]');
    await more.getByRole('button', { name: 'Ask xe-cos for context' }).click();
    await expect.poll(() => m.calls.find((c) => c.path === '/needs-you/rp.xe-cos.stack.pr-130/answer')?.body).toEqual({ choice: 'context' });
    await expect(page.getByRole('status')).toContainText('Asked xe-cos for context');
    await expect(page.getByTestId('now-asks')).toHaveCount(0);
    // the agent sends the brief: the item is back, with it
    m.needs[0].brief = FULL;
    await page.reload();
    await expect(page.getByTestId('now-asks').locator(':scope > li')).toHaveCount(1);
  });

  test('Now: the brief shows problem, solution, risks, recommendation, evidence; references are links that open a new tab', async ({ page }, info) => {
    await now(page, [need({ brief: FULL })]);
    const card = page.getByTestId('now-asks').locator(':scope > li').first();
    await card.getByRole('button', { name: /Approve PR 130/ }).click();
    const brief = card.getByTestId('brief');
    for (const t of ['Problem', 'Proposed solution', 'Risks', 'Recommendation', 'Evidence']) await expect(brief.locator('dt', { hasText: t })).toHaveCount(1);
    await expect(brief).toContainText('The store is new.');
    await expect(brief.getByRole('link', { name: 'PR 130' })).toHaveAttribute('href', 'https://github.com/Xerilium/stack/pull/130');
    await expect(brief.getByRole('link', { name: '#130' })).toHaveAttribute('href', 'https://github.com/Xerilium/stack/issues/130');
    await expect(brief.getByRole('link', { name: 'FH 1105' })).toHaveAttribute('href', 'https://github.com/microsoft/finops-toolkit/issues/1105');
    await expect(brief.getByRole('link', { name: 'Xerilium/stack#152' })).toHaveAttribute('target', '_blank');
    await expect(card.getByRole('button', { name: 'Go with it', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await axe(page, '[data-testid="now-asks"]');
    await page.screenshot({ path: `e2e/screenshots/ask-brief-${info.project.name}.png` });
  });

  test('Needs you: No context yet; Enter asks for context; Go with it anyway needs a confirm', async ({ page }) => {
    const m = await mockApi(page, { projects: PROJECTS });
    m.asks = [ask({ key: 'pr-879', ask: 'Approve merging PR 879', project: 'stack', recommend: 'Approve', link: 'https://github.com/Xerilium/stack/pull/879', score: 90 }), ask({ key: 'ok', ask: 'Approve the docs', brief: BRIEF, score: 10 })];
    await page.goto('/#/asks');
    const card = page.locator('.ask-card');
    await expect(card.getByTestId('brief-none')).toContainText('No context yet');
    await expect(card.getByRole('link', { name: 'PR 879' })).toHaveAttribute('href', 'https://github.com/Xerilium/stack/pull/879');
    await expect(card.getByRole('button', { name: /^Approve/ })).toHaveCount(0);
    await expect(page.locator('.ask-row', { hasText: 'Approve the docs' })).toBeVisible();
    await axe(page, '.ask-card');
    await card.getByRole('button', { name: 'Go with it anyway' }).click();
    await expect(card.getByRole('button', { name: 'Confirm: no context' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(card.getByRole('button', { name: 'Go with it anyway' })).toBeVisible();
    await page.keyboard.press('Enter');
    await expect.poll(() => m.calls.find((c) => c.path === '/asks/pr-879/answer')?.body).toMatchObject({ answer: 'ask', text: expect.stringMatching(/^Send a brief/) });
    await expect(page.getByText('Asked allyte-cos for context')).toBeVisible();
  });

  test('Needs you: going ahead without context posts go only after the second tap', async ({ page }) => {
    const m = await mockApi(page);
    m.asks = [ask({ key: 'pr-1', ask: 'Approve PR 1', recommend: 'Approve' })];
    await page.goto('/#/asks');
    const card = page.locator('.ask-card');
    await card.getByRole('button', { name: 'Go with it anyway' }).click();
    expect(m.calls.some((c) => c.path === '/asks/pr-1/answer')).toBe(false);
    await card.getByRole('button', { name: 'Confirm: no context' }).click();
    await expect.poll(() => m.calls.find((c) => c.path === '/asks/pr-1/answer')?.body).toEqual({ answer: 'go' });
  });
});
