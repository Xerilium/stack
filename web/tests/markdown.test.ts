import { describe, expect, it } from 'vitest';
import { mdLinks, parseInline, refCtxOf, toHtml } from '../src/markdown';

// @req FR:web-app/edit.preview
describe('markdown subset', () => {
  it('renders bold, italic, code, and https links', () => {
    expect(toHtml('a **b** *c* `d` [e](https://x.io/p?q=1)')).toBe('a <b>b</b> <i>c</i> <code>d</code> <a href="https://x.io/p?q=1" rel="noopener noreferrer" target="_blank">e</a>');
  });
  // @req NFR:live-deploy/security.text
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

// @req FR:product-reset/ui.reflink @req FR:product-reset/schema.refs
describe('refs autolink', () => {
  const ctx = refCtxOf([
    { name: 'stack', metadata: { Repository: 'https://github.com/Xerilium/stack' } },
    { name: 'music', metadata: { Repos: 'allytehq/f4-music, allytehq/f4-site', 'Ref prefixes': 'FH = microsoft/finops-toolkit' } },
    { name: 'home', metadata: {} },
  ]);
  const links = (text: string, project?: string) => mdLinks(text, ctx(project));
  it('links a full GitHub URL with a short label', () => {
    expect(links('see https://github.com/allytehq/f4-music/pull/97.')).toEqual([{ href: 'https://github.com/allytehq/f4-music/pull/97', label: 'f4-music#97' }]);
    expect(links('<https://example.test/a?b=1>')).toEqual([{ href: 'https://example.test/a?b=1', label: 'https://example.test/a?b=1' }]);
  });
  it('links owner/repo#N anywhere', () => {
    expect(links('blocked by microsoft/finops-toolkit#123')).toEqual([{ href: 'https://github.com/microsoft/finops-toolkit/issues/123', label: 'finops-toolkit#123' }]);
  });
  it('resolves #N and PR N from the project repo', () => {
    expect(links('Fix #12 then PR 34', 'stack')).toEqual([
      { href: 'https://github.com/Xerilium/stack/issues/12', label: '#12' },
      { href: 'https://github.com/Xerilium/stack/pull/34', label: 'PR 34' },
    ]);
  });
  it('resolves repo#N from the known repos and {prefix} N from Ref prefixes', () => {
    expect(links('merge f4-music#97 and FH 2041', 'home')).toEqual([
      { href: 'https://github.com/allytehq/f4-music/issues/97', label: 'f4-music#97' },
      { href: 'https://github.com/microsoft/finops-toolkit/issues/2041', label: 'FH 2041' },
    ]);
  });
  it('keeps unresolved refs as text', () => {
    expect(links('Fix #12 and PR 34 and nope#9', 'home')).toEqual([]);
    expect(links('Fix #12')).toEqual([]);
    expect(parseInline('Fix #12', ctx('home'))).toEqual(['Fix #12']);
  });
  it('links every ref in one text, never inside code or an existing link', () => {
    expect(links('#1, #2 and `#3` [x](https://x.test/#4)', 'stack').map((l) => l.label)).toEqual(['#1', '#2', 'x']);
  });
  it('opens refs in a new tab and escapes them', () => {
    expect(toHtml('PR 5', ctx('stack'))).toBe('<a href="https://github.com/Xerilium/stack/pull/5" rel="noopener noreferrer" target="_blank">PR 5</a>');
  });
});
