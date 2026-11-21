// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { DriftBanner, type Drift } from '../src/ui/DriftBanner';

const mount = (node: preact.ComponentChild) => { const root = document.createElement('div'); document.body.append(root); act(() => render(node, root)); return root; };
afterEach(() => { document.body.innerHTML = ''; });
const d = (o: Partial<Drift>): Drift => ({ base: 'origin/main', state: 'conflict', behind: 34, files: [], at: '2026-11-20T12:00:00.000Z', ...o });

describe('DriftBanner', () => {
  // @req FR:store-sync/banner.component
  it.each(['ok', 'behind', 'merged', 'offline'] as const)('shows nothing for %s', (state) => {
    expect(mount(<DriftBanner drift={d({ state })} />).innerHTML).toBe('');
  });
  it('shows nothing with no state', () => { expect(mount(<DriftBanner drift={null} />).innerHTML).toBe(''); });

  // @req FR:store-sync/banner.text @req FR:store-sync/banner.role
  it('a conflict: the count and the conflicting files in an alert', () => {
    const r = mount(<DriftBanner drift={d({ files: ['tasks/a.md', 'tasks/b.md'] })} />);
    const el = r.querySelector('[role="alert"]')!;
    expect(el.classList.contains('ui-drift')).toBe(true);
    expect(el.querySelector('.ui-drift-title')!.textContent).toBe('Task store out of sync with main: 34 commits behind');
    expect(el.querySelector('.ui-drift-files')!.textContent).toBe('Conflicts: tasks/a.md, tasks/b.md');
  });

  // @req FR:store-sync/banner.text
  it('blocked: the uncommitted files; one commit reads singular', () => {
    const r = mount(<DriftBanner drift={d({ state: 'blocked', behind: 1, files: ['tasks/b.md'] })} />);
    expect(r.querySelector('.ui-drift-title')!.textContent).toBe('Task store out of sync with main: 1 commit behind');
    expect(r.querySelector('.ui-drift-files')!.textContent).toBe('Uncommitted: tasks/b.md');
  });

  // @req FR:store-sync/banner.text
  it('error: the message, as text', () => {
    const r = mount(<DriftBanner drift={d({ state: 'error', behind: 3, message: '<b>lock busy</b>' })} />);
    expect(r.querySelector('.ui-drift-files')!.textContent).toBe('<b>lock busy</b>');
    expect(r.querySelector('b')).toBeNull();
  });
});
