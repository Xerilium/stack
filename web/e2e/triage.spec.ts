/** Quick triage: a flow of questions answered one at a time, each answer landing on the task. @req FR:quick-triage/web.stepper @req FR:quick-triage/web.undo @req FR:quick-triage/web.done @req FR:quick-triage/web.mobile */
import { expect, test } from '@playwright/test';
import { mockApi, type MockAsk } from './mock';

const iso = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();
const q = (key: string, seq: number, o: Partial<MockAsk>): MockAsk => ({ key, state: 'open', ask: key, kind: 'approve', from: 'finance-cos', project: 'finance', reversible: true, priority: 'normal', blocks: 0, created: iso(-1), updated: iso(-1), score: 100 - seq, overdue: false, flow: 'triage-today', seq, flowTotal: 3, flowDone: 0, ...o });
const flow = (): MockAsk[] => [
  q('q1', 1, { ask: 'What is top of mind?', kind: 'answer', ref: 'alpha:6' }),
  q('q2', 2, { ask: 'Pay bills first?', kind: 'decide', options: ['Yes, critical', 'Later'], applies: ['set priority=🚨', 'suspend 7d'], recommend: 'Yes, critical', ref: 'alpha:9' }),
  q('q3', 3, { ask: 'Archive the old board?', kind: 'approve', apply: 'complete', ref: 'beta:4' }),
];

test.describe('Quick triage', () => {
  test('steps through the flow: progress, what each option does, what changed, done', async ({ page }, info) => {
    const m = await mockApi(page);
    m.asks = flow();
    await page.goto('/#/asks');
    const card = page.locator('.ask-card');
    await expect(card.getByTestId('flow-step')).toHaveText('Quick triage · 1 of 3');
    await expect(card.getByRole('progressbar', { name: 'Triage progress' })).toHaveAttribute('aria-valuenow', '0');
    await expect(card.locator('.ask-title')).toHaveText('What is top of mind?');
    // one line, Enter
    await card.getByLabel('Answer finance-cos').fill('Taxes before anything else');
    await card.getByLabel('Answer finance-cos').press('Enter');
    await expect.poll(() => m.calls.at(-1)).toMatchObject({ path: '/asks/q1/answer', body: { answer: 'reply', text: 'Taxes before anything else' } });
    // the next question takes its place; options say what they will do
    await expect(card.getByTestId('flow-step')).toHaveText('Quick triage · 2 of 3');
    await expect(card.locator('.ask-title')).toHaveText('Pay bills first?');
    const yes = card.getByRole('button', { name: /Yes, critical/ });
    await expect(yes).toContainText('Priority: Critical');
    await expect(card.getByRole('button', { name: /Later/ })).toContainText('Parked 7 days');
    if (info.project.name === 'mobile') {
      const a = (await yes.boundingBox())!, b = (await card.getByRole('button', { name: /Later/ }).boundingBox())!;
      expect(a.y).not.toBe(b.y); // options stack in the thumb zone
      expect(a.height).toBeGreaterThanOrEqual(44);
    }
    await yes.click();
    const changed = page.locator('.toast', { hasText: 'Priority: Critical · Pay bills first?' });
    await expect(changed).toBeVisible();
    await expect(changed.getByRole('button', { name: 'Undo' })).toHaveCount(0); // an applied action stays
    await expect.poll(() => m.calls.at(-1)).toMatchObject({ path: '/asks/q2/answer', body: { answer: 'option', text: 'Yes, critical' } });
    // last question: done
    await expect(card.locator('.ask-title')).toHaveText('Archive the old board?');
    await expect(card.getByRole('button', { name: /Approve/ })).toContainText('Done');
    await card.getByRole('button', { name: /Approve/ }).click();
    await expect(page.locator('.toast', { hasText: 'Triage done · 3 answered' })).toBeVisible();
    await expect(page.getByTestId('asks-empty')).toBeVisible();
  });
});
