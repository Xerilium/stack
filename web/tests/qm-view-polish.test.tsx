// @vitest-environment jsdom
/** @req FR:qm-plan/ui.table @req FR:qm-plan/ui.back @req FR:qm-plan/ui.sort */
import { render } from 'preact';
import { describe, expect, it } from 'vitest';
import { QmView } from '../src/QmView';

const PLAN = {
  version: 1, asOf: '2026-11-18T19:00:00Z',
  projects: [
    { project: 'Stack', agent: { name: 'stack-architect', sessionId: 'local_11aa9613-132f', url: 'https://example.com/s' }, tasks: [{ title: 'Ship QM' }], weeklyTokens: 25_000_000, preAckMin: 10, postReviewMin: 30 },
    { project: 'FOCUS', agent: { name: 'focus-lead', sessionId: 'local_22bb' }, tasks: [], weeklyTokens: 2_000_000, preAckMin: null, postReviewMin: null },
  ],
};
const ok = (body: unknown): typeof fetch => async () => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });
const tick = () => new Promise((r) => setTimeout(r, 0));

async function mount(body: unknown = { plan: PLAN }) {
  const root = document.createElement('div'); document.body.append(root);
  render(<QmView fetchFn={ok(body)} live={() => () => undefined} />, root);
  for (let i = 0; i < 50 && !root.querySelector('table'); i++) await new Promise((r) => setTimeout(r, 10));
  return root;
}

describe('QM view', () => {
  it('hides session ids; keeps them in the agent cell title', async () => {
    const root = await mount();
    expect(root.textContent).not.toContain('local_');
    const cells = [...root.querySelectorAll<HTMLElement>('tbody td.qm-agent')];
    expect(cells.map((c) => c.title).sort()).toEqual(['local_11aa9613-132f', 'local_22bb']);
  });
  it('shows compact weekly tokens with the raw value in title; sort uses the raw number', async () => {
    const root = await mount();
    const tok = [...root.querySelectorAll<HTMLElement>('tbody td.qm-tokens')];
    expect(tok.map((t) => t.textContent)).toEqual(['2.0M', '25M']);
    expect(tok.map((t) => t.title)).toEqual(['2,000,000', '25,000,000']);
    expect(root.textContent).not.toContain('25,000,000');
    const btn = [...root.querySelectorAll('button')].find((b) => b.textContent?.startsWith('Weekly tokens'))!;
    btn.click(); await tick(); btn.click(); await tick();
    expect([...root.querySelectorAll('tbody th')].map((t) => t.textContent)).toEqual(['Stack', 'FOCUS']);
  });
  it('back is a quiet icon button labeled Back', async () => {
    const root = await mount();
    const back = root.querySelector<HTMLAnchorElement>('.qm-back')!;
    expect(back.getAttribute('aria-label')).toBe('Back');
    expect(back.getAttribute('href')).toBe('#/now');
    expect(back.classList.contains('fl-btn')).toBe(true);
    expect(back.classList.contains('subtle')).toBe(true);
    expect(back.textContent).not.toContain('Back');
  });
  it('Top 5 is a count with a chevron disclosure', async () => {
    const root = await mount();
    const sum = root.querySelector('.qm-tasks summary')!;
    expect(sum.querySelector('.qm-chev')).not.toBeNull();
    expect(sum.textContent?.trim().startsWith('1')).toBe(true);
  });
});
