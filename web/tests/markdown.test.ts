import { describe, expect, it } from 'vitest';
import { parseInline, toHtml } from '../src/markdown';

// @req FR:web-app/edit.preview
describe('markdown subset', () => {
  it('renders bold, italic, code, and https links', () => {
    expect(toHtml('a **b** *c* `d` [e](https://x.io/p?q=1)')).toBe('a <b>b</b> <i>c</i> <code>d</code> <a href="https://x.io/p?q=1" rel="noopener noreferrer" target="_blank">e</a>');
  });
  it('escapes html and never emits other tags', () => {
    expect(toHtml('<img src=x onerror=alert(1)> & "q"')).toBe('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;q&quot;');
    expect(toHtml('**<script>**')).toBe('<b>&lt;script&gt;</b>');
  });
  it('rejects non-http links', () => {
    expect(toHtml('[x](javascript:alert(1))')).toBe('[x](javascript:alert(1))');
    expect(toHtml('[x](data:text/html,hi)')).toBe('[x](data:text/html,hi)');
    expect(toHtml('[x](http://ok.test)')).toContain('href="http://ok.test"');
  });
  it('leaves unmatched markers alone and returns nodes', () => {
    expect(toHtml('2 * 3 and **open')).toBe('2 * 3 and **open');
    expect(parseInline('plain')).toEqual(['plain']);
  });
});
