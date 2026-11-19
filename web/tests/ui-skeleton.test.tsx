// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { Skeleton } from '../src/ui/Skeleton';

const html = (node: preact.ComponentChild) => { const root = document.createElement('div'); document.body.append(root); act(() => render(node, root)); return root.innerHTML; };
afterEach(() => { document.body.innerHTML = ''; });

describe('Skeleton', () => {
  // @req FR:ui-kit/skeleton
  it('is a busy box of placeholder rows; a status with a name when the view gives a label', () => {
    // The markup each view had before it used the component: the pages look the same.
    expect(html(<Skeleton status label="Loading" rows={['big', '', '', '']} />))
      .toBe('<div class="skeleton" role="status" aria-busy="true" aria-label="Loading"><div class="sk big"></div><div class="sk"></div><div class="sk"></div><div class="sk"></div></div>');
    expect(html(<Skeleton class="prs-sk" status label="Loading pull requests" rows={4} testId="prs-skeleton" />))
      .toBe('<div class="skeleton prs-sk" role="status" aria-busy="true" aria-label="Loading pull requests" data-testid="prs-skeleton"><div class="sk"></div><div class="sk"></div><div class="sk"></div><div class="sk"></div></div>');
  });
  // @req FR:ui-kit/skeleton.shape
  it('takes the shape of the content it stands for: a list or lines of text', () => {
    expect(html(<Skeleton as="ol" class="asks" label="Loading asks" rows={['big', '', '']} />))
      .toBe('<ol class="asks" aria-busy="true" aria-label="Loading asks"><li class="sk big"></li><li class="sk"></li><li class="sk"></li></ol>');
    expect(html(<Skeleton as="ol" class="sess-list" label="Loading agents" rows={3} />))
      .toBe('<ol class="sess-list" aria-busy="true" aria-label="Loading agents"><li class="sk"></li><li class="sk"></li><li class="sk"></li></ol>');
    expect(html(<Skeleton as="lines" class="turns" rows={['', 'short', '']} />))
      .toBe('<div class="turns" aria-busy="true"><p class="sk"></p><p class="sk short"></p><p class="sk"></p></div>');
  });
});
