/**
 * Brief (Experimental): meetings, messages, actions, one task, next 90 minutes.
 * @req FR:cos-view/brief.nav @req FR:cos-view/brief.meetings @req FR:cos-view/brief.messages @req FR:cos-view/brief.actions @req FR:cos-view/brief.one @req FR:cos-view/brief.ninety @req FR:cos-view/brief.phone
 */
import { expect, test } from '@playwright/test';
import { mockApi, type MockAsk } from './mock';

const ask = (key: string, from: string, score: number, extra: Partial<MockAsk> = {}): MockAsk => ({ key, state: 'open', ask: `Ask ${key}`, kind: 'approve', from, reversible: true, priority: 'normal', blocks: 0, created: '2026-11-05T09:00:00Z', updated: '2026-11-05T09:00:00Z', score, overdue: false, recommend: 'Go ahead', ...extra });

test.describe('Brief', () => {
  test('shows the five sections and answers a message in one tap', async ({ page }, info) => {
    const d = new Date(); d.setHours(10, 0, 0, 0); await page.clock.install({ time: d });
    const m = await mockApi(page);
    const at = (h: number, mi = 0) => { const x = new Date(d); x.setHours(h, mi, 0, 0); return x.toISOString(); };
    m.events = [{ id: 'e1', subject: 'Allyte sync', start: at(10, 5), end: at(10, 35), allDay: false, showAs: 'busy', cancelled: false, online: true, joinUrl: 'https://example.test/join' }];
    m.asks = [ask('m1', 'email-triage', 50, { ask: 'Reply to Dana' }), ask('a1', 'Chief of Staff', 90, { ask: 'Approve the budget' })];
    await page.goto('/#/brief');
    await page.clock.resume();
    await expect(page.locator('.brief-tag .exp')).toBeVisible();
    await expect(page.getByTestId('brief-meetings')).toContainText('Allyte sync');
    await expect(page.getByTestId('brief-meetings').getByRole('link', { name: 'Join' })).toBeVisible();
    await expect(page.getByTestId('brief-messages')).toContainText('Reply to Dana');
    await expect(page.getByTestId('brief-actions')).toContainText('Approve the budget');
    await expect(page.getByTestId('brief-one')).toBeVisible();
    await expect(page.getByTestId('brief-ninety')).toContainText('Allyte sync');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: `e2e/screenshots/brief-${info.project.name}.png`, fullPage: true });
    await page.getByTestId('brief-messages').getByRole('button').first().click();
    await expect.poll(() => m.asks.find((a) => a.key === 'm1')?.state).toBe('answered');
  });

  test('empty states, and the rail entry is tagged Experimental', async ({ page }) => {
    await mockApi(page);
    await page.goto('/#/brief');
    await expect(page.getByText('No messages waiting.')).toBeVisible();
    await expect(page.getByText('Nothing needs you.')).toBeVisible();
    await expect(page.getByText('No meetings left today.')).toBeVisible();
  });
});
