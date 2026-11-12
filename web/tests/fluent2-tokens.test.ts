// @req FR:task-detail-design/rules.tokens @req FR:task-detail-design/rules.nokeys @req FR:task-detail-design/rules.clickable @req FR:task-detail-design/rules.facts @req FR:task-detail-design/rules.doc
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/fluent2.css', import.meta.url), 'utf8');
const vars = (block: string) => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+?)\s*;/g)].map((m) => [m[1], m[2]]));
const light = vars(/:root\s*\{([^}]*)\}/.exec(css)![1]);
const dark = { ...light, ...vars(/prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(css)![1]) };
const lum = (h: string) => {
  const c = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe.each([['light', light], ['dark', dark]] as const)('Fluent 2 %s tokens', (_, t) => {
  it.each(['fl-fg1', 'fl-fg2', 'fl-fg3', 'fl-brand-fg', 'fl-danger', 'fl-success'])('--%s is 4.5:1 on bg1, bg2, and bg3', (k) => {
    for (const bg of ['fl-bg1', 'fl-bg2', 'fl-bg3']) expect(ratio(t[k], t[bg]), `${k} on ${bg}`).toBeGreaterThanOrEqual(4.5);
  });
  it('on-brand text is 4.5:1 on brand and its hover', () => {
    expect(ratio(t['fl-on-brand'], t['fl-brand'])).toBeGreaterThanOrEqual(4.5);
    expect(ratio(t['fl-on-brand'], t['fl-brand-hover'])).toBeGreaterThanOrEqual(4.5);
  });
  it('selected chip text is 4.5:1 on its fill', () => expect(ratio(t['fl-brand-fg'], t['fl-brand2'])).toBeGreaterThanOrEqual(4.5));
});

it('defines the type ramp, radius, spacing, elevation, and motion', () => {
  for (const k of ['fl-caption', 'fl-body', 'fl-sub2', 'fl-sub1', 'fl-title', 'fl-r-sm', 'fl-r-md', 'fl-r-lg', 'fl-r-xl', 'fl-s-xs', 'fl-s-s', 'fl-s-m', 'fl-s-l', 'fl-s-xxl', 'fl-shadow4', 'fl-shadow16', 'fl-fast', 'fl-normal']) expect(light[k], k).toBeTruthy();
  expect(css).toMatch(/prefers-reduced-motion:\s*reduce\)\s*\{\s*:root\s*\{[^}]*--fl-normal:\s*0ms/);
});
it('is loaded once by the app entry, with no network', () => {
  expect(readFileSync(new URL('../src/main.tsx', import.meta.url), 'utf8')).toMatch(/import '\.\/fluent2\.css';/);
  expect(css).not.toMatch(/@import|url\(\s*['"]?https?:/);
});
it('hides key badges on every button, link button, and menu item; keeps the rail hint', () => {
  expect(css).toMatch(/body :is\(button, a\.btn, \[role="menuitem"\]\) kbd \{ display: none !important; \}/);
  expect(css).toMatch(/\.rail \.tab kbd \{ display: inline-block !important; \}/);
});
it('gives clickable rows a pointer and draws facts as text', () => {
  expect(css).toMatch(/\.top-rows > li[^{]*\{ cursor: pointer; \}/);
  expect(css).toMatch(/span\.chip:not\(\.removable\) \{ background: none !important;/);
});
it('docs/design-system.md states the rules in at most 60 lines', () => {
  const doc = readFileSync(new URL('../../docs/design-system.md', import.meta.url), 'utf8');
  expect(doc.trimEnd().split('\n').length).toBeLessThanOrEqual(60);
  for (const r of ['No shortcut-key badges', 'Dropdowns only for long lists', 'display name plus avatar', 'confirm first or offer Undo', 'Why hand-written CSS']) expect(doc).toContain(r);
});
