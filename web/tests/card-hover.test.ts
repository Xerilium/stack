// @req FR:product-reset/ui.taskcard
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const css = (f: string) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');
const lum = (hex: string) => { const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4)); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const token = (src: string, name: string, dark: boolean) => { const part = dark ? src.slice(src.indexOf('prefers-color-scheme: dark')) : src; return new RegExp(`--${name}: (#[0-9a-f]{6})`).exec(part)![1]; };

describe('card hover and focus', () => {
  it('each card style changes the background on hover and on focus', () => {
    expect(css('nowscreen.css')).toMatch(/\.now-ask:not\(\.open\):hover, \.now-ask:not\(\.open\):focus-within \{ background: var\(--card-hover\); \}/);
    expect(css('asks.css')).toMatch(/\.ask-card:hover, \.ask-card:focus-within \{ background: var\(--card-hover\); \}/);
    expect(css('myday.css')).toMatch(/\.today \.what:hover \{ background: var\(--card-hover\); \}/);
    expect(css('myday.css')).toMatch(/\.today \.block:focus-within \.what \{ background: var\(--card-hover\); \}/);
  });
  it('dark cards rest a shade below the panel and lift on hover; light hover differs from rest', () => {
    const s = css('styles.css');
    expect(lum(token(s, 'card-bg', true))).toBeLessThan(lum(token(s, 'panel', true)));
    expect(lum(token(s, 'card-hover', true))).toBeGreaterThan(lum(token(s, 'card-bg', true)));
    expect(token(s, 'card-hover', false)).not.toBe(token(s, 'card-bg', false));
  });
});
