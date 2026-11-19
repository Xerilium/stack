// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { CountBadge } from '../src/ui/CountBadge';
import { MoreButton } from '../src/ui/MoreButton';

const mount = (node: preact.ComponentChild) => { const root = document.createElement('div'); document.body.append(root); act(() => render(node, root)); return root; };
afterEach(() => { document.body.innerHTML = ''; });

describe('CountBadge', () => {
  // @req FR:ui-kit/badge
  it('shows the count and says what it counts; the markup is the one the views had', () => {
    expect(mount(<CountBadge count={3} label="3 need you" testId="prs-nav-badge" />).innerHTML).toBe('<span class="badge" aria-label="3 need you" data-testid="prs-nav-badge">3</span>');
    expect(mount(<CountBadge count={12} label="12 open" />).innerHTML).toBe('<span class="badge" aria-label="12 open">12</span>');
  });
  // @req FR:ui-kit/badge.hidden
  it('with no label it is hidden from assistive tech: the control it sits on says the count', () => {
    expect(mount(<CountBadge count={3} />).innerHTML).toBe('<span class="badge" aria-hidden="true">3</span>');
  });
});

describe('MoreButton', () => {
  // @req FR:ui-kit/more
  it('says how many more rows there are and shows them on a tap; the markup is the one the views had', () => {
    let n = 0;
    const r = mount(<MoreButton count={4} onMore={() => { n++; }} />);
    expect(r.innerHTML).toBe('<button type="button" class="more-btn">Show 4 more</button>');
    act(() => { r.querySelector('button')!.click(); });
    expect(n).toBe(1);
  });
  // @req FR:ui-kit/more.key
  it('shows its shortcut key, hidden from assistive tech', () => {
    expect(mount(<MoreButton count={2} keyHint="m" onMore={() => undefined} />).innerHTML).toBe('<button type="button" class="more-btn">Show 2 more <kbd aria-hidden="true">m</kbd></button>');
  });
});
