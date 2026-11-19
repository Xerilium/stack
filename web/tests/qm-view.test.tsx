// @vitest-environment jsdom
/** `#/qm` reloads the plan when an agent writes it. @req FR:qm-plan/live.reload */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { QmView } from '../src/QmView';

const plan = (project: string) => ({ plan: { version: 1, asOf: '2026-11-18T19:00:00Z', projects: [{ project, agent: { name: 'a' }, tasks: [], weeklyTokens: null, preAckMin: null, postReviewMin: null }] } });
const flush = () => act(async () => { await new Promise((ok) => setTimeout(ok, 0)); });

let root: HTMLElement | undefined;
afterEach(() => { if (root) { const r = root; act(() => render(null, r)); r.remove(); root = undefined; } });

function mount() {
  let n = 0; let name = 'First';
  const fetchFn = (async () => { n++; return new Response(JSON.stringify(plan(name)), { status: 200 }); }) as unknown as typeof fetch;
  let emit: (kinds: string[]) => void = () => undefined; let stops = 0;
  const live = (fn: (kinds: string[]) => void) => { emit = fn; return () => { stops++; }; };
  root = document.createElement('div'); document.body.append(root);
  const r = root; act(() => render(<QmView fetchFn={fetchFn} live={live} />, r));
  return { root, loads: () => n, rename: (v: string) => { name = v; }, emit: (k: string[]) => act(() => emit(k)), stops: () => stops };
}

describe('QmView live reload', () => {
  it('reads the plan again on a qm change and shows the new plan', async () => {
    const m = mount(); await flush();
    expect(m.loads()).toBe(1);
    expect(m.root.textContent).toContain('First');
    m.rename('Second');
    await m.emit(['qm']); await flush();
    expect(m.loads()).toBe(2);
    expect(m.root.textContent).toContain('Second');
  });

  it('ignores other kinds; reloads on a poll and a full refresh', async () => {
    const m = mount(); await flush();
    await m.emit(['pris']); await m.emit(['tasks', 'pr-priority']); await flush();
    expect(m.loads()).toBe(1);
    await m.emit(['poll']); await flush();
    expect(m.loads()).toBe(2);
    await m.emit(['asks', 'tasks', 'state']); await flush();
    expect(m.loads()).toBe(3);
  });

  it('stops listening when the page closes', async () => {
    const m = mount(); await flush();
    act(() => render(null, m.root));
    expect(m.stops()).toBe(1);
  });
});
