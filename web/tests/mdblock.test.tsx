// @vitest-environment jsdom
/** @req FR:agent-sessions/web.drawer.md */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { mdBlocks, MdBlock } from '../src/parts';

const mount = (text: string) => { const root = document.createElement('div'); document.body.append(root); act(() => render(<MdBlock text={text} />, root)); return root.firstElementChild as HTMLElement; };
afterEach(() => { document.body.innerHTML = ''; });

// @req FR:agent-sessions/web.drawer.md
describe('MdBlock', () => {
  it('renders a heading as bold text, a list, and a link', () => {
    const r = mount('## Title\n- a\n- b\n[x](https://x.test)');
    expect(r.querySelector('h1, h2, h3, h4, h5, h6')).toBeNull();
    expect(r.querySelector('.md-h b')!.textContent).toBe('Title');
    expect([...r.querySelectorAll('ul > li')].map((li) => li.textContent)).toEqual(['a', 'b']);
    const a = r.querySelector('a')!;
    expect(a.getAttribute('href')).toBe('https://x.test');
    expect(a.textContent).toBe('x');
    expect(r.textContent).not.toMatch(/##|\]\(/);
  });

  it('paragraphs, numbered lists, a rule, fenced code, inline marks', () => {
    const r = mount('First line\nsecond line\n\n1. one\n2. **two**\n\n---\n```ts\nconst x = `y`;\n```\nAfter');
    const ps = r.querySelectorAll(':scope > p');
    expect(ps[0].textContent).toBe('First line\nsecond line');
    expect([...r.querySelectorAll('ol > li')].map((li) => li.innerHTML)).toEqual(['one', '<b>two</b>']);
    expect(r.querySelectorAll('hr')).toHaveLength(1);
    expect(r.querySelector('pre > code')!.textContent).toBe('const x = `y`;');
    expect(ps[ps.length - 1].textContent).toBe('After');
  });

  it('never parses HTML: tags stay text', () => {
    const r = mount('<img src=x onerror=alert(1)> **b**');
    expect(r.querySelector('img')).toBeNull();
    expect(r.textContent).toBe('<img src=x onerror=alert(1)> b');
  });

  it('an open fence runs to the end; an empty text is no block', () => {
    expect(mdBlocks('```\na\nb')).toEqual([{ t: 'pre', text: 'a\nb' }]);
    expect(mdBlocks('')).toEqual([]);
    expect(mdBlocks('#nohash')).toEqual([{ t: 'p', text: '#nohash' }]);
  });
});
