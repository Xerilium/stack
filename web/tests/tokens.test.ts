// @req FR:now-screen/tokens.contrast @req FR:now-screen/tokens.scale @req FR:now-screen/tokens.motion
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
/** Custom properties of the first `:root` block and of the dark `:root` block. */
const vars = (block: string) => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*([^;]+?)\s*;/g)].map((m) => [m[1], m[2]]));
const light = vars(/:root\s*\{([^}]*)\}/.exec(css)![1]);
const dark = { ...light, ...vars(/prefers-color-scheme:\s*dark\)\s*\{\s*:root\s*\{([^}]*)\}/.exec(css)![1]) };

const lum = (h: string) => {
  const hex = h.length === 4 ? `#${[...h.slice(1)].map((x) => x + x).join('')}` : h;
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a: string, b: string) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

describe.each([['light', light], ['dark', dark]] as const)('%s theme', (_, t) => {
  it.each(['ink', 'ink2', 'muted', 'warn', 'ok'])('--%s is 4.5:1 on bg and panel', (k) => {
    expect(ratio(t[k], t.bg)).toBeGreaterThanOrEqual(4.5);
    expect(ratio(t[k], t.panel)).toBeGreaterThanOrEqual(4.5);
  });
  it('accent and focus ring are 3:1 on bg', () => {
    expect(ratio(t.accent, t.bg)).toBeGreaterThanOrEqual(3);
    expect(ratio(t.focus, t.bg)).toBeGreaterThanOrEqual(3);
  });
  it('accent-ink is 4.5:1 on accent (button text)', () => expect(ratio(t['accent-ink'], t.accent)).toBeGreaterThanOrEqual(4.5));
});

it('light muted is the value from the design principles', () => expect(light.muted).toBe('#6e6e76'));
it('defines the space, radius, and motion tokens', () => {
  expect([4, 8, 12, 16, 24, 32, 48].map((n) => light[`s-${n}`])).toEqual(['4px', '8px', '12px', '16px', '24px', '32px', '48px']);
  expect([light['r-chip'], light['r-row'], light['r-card']]).toEqual(['6px', '10px', '16px']);
  expect([light['t-feedback'], light['t-enter'], light['t-sheet']]).toEqual(['120ms', '200ms', '280ms']);
});
it('defines the type scale for touch and desktop', () => {
  for (const k of ['fs-title', 'fs-screen', 'fs-body', 'fs-secondary', 'fs-caption']) expect(light[k], k).toMatch(/px$/);
  expect(css).toMatch(/@media \(hover: hover\) and \(pointer: fine\)\s*\{\s*:root\s*\{[^}]*--fs-body:\s*13px/);
});
it('reduced motion zeroes the motion tokens', () => {
  expect(css).toMatch(/prefers-reduced-motion:\s*reduce\)\s*\{\s*:root\s*\{[^}]*--t-enter:\s*0ms/);
});
