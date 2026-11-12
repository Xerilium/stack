// @req FR:agent-team/web.avatar.fluent @req FR:agent-team/web.avatar.project @req FR:agent-team/web.avatar.fetch
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { emojiKey, fluentNamed, fluentSrc, leadEmoji } from '../src/fluent';

const dir = new URL('../src/emoji/', import.meta.url);

describe('fluent emoji', () => {
  it('keys an emoji by code points, variation selectors dropped', () => {
    expect(emojiKey('🎧')).toBe('1f3a7');
    expect(emojiKey('⚗️')).toBe('2697');
    expect(emojiKey('⚗')).toBe('2697');
    expect(emojiKey('👨‍👩‍👧‍👦')).toBe('1f468-200d-1f469-200d-1f467-200d-1f466');
  });
  it('resolves bundled emoji to a same-origin asset and leaves the rest native', () => {
    for (const e of ['🎧', '👔', '🔄', '🧰', '👓', '📚', '⚗️', '⚗', '🏠']) expect(fluentSrc(e), e).toMatch(/^(\/|data:image\/svg\+xml)/);
    expect(fluentSrc('🧌')).toBeUndefined();
    expect(fluentSrc('👨‍👩‍👧‍👦')).toBeUndefined(); // Fluent has no family sequence: native text
    expect(fluentSrc('')).toBeUndefined();
  });
  it('resolves fluent:<name> by the Fluent file name', () => {
    expect(fluentNamed('headphone')).toEqual({ src: fluentSrc('🎧'), text: '🎧' });
    expect(fluentNamed('no_such_emoji')).toBeUndefined();
  });
  it('splits the emoji that starts a title', () => {
    expect(leadEmoji('🎧 Flantastic 4')).toEqual({ emoji: '🎧', rest: 'Flantastic 4' });
    expect(leadEmoji('⚗️ Catalyst')).toEqual({ emoji: '⚗️', rest: 'Catalyst' });
    expect(leadEmoji('👨‍👩‍👧‍👦 Family')).toEqual({ emoji: '👨‍👩‍👧‍👦', rest: 'Family' });
    expect(leadEmoji('Stack')).toBeUndefined();
    expect(leadEmoji('1 thing')).toBeUndefined();
    expect(leadEmoji('#tag')).toBeUndefined();
  });
  it('bundles only indexed Color SVGs, under 400 KB, from a pinned commit', () => {
    const idx = JSON.parse(readFileSync(new URL('index.json', dir), 'utf8')) as { commit: string; emoji: Record<string, string> };
    expect(idx.commit).toMatch(/^[0-9a-f]{40}$/);
    const files = readdirSync(dir).filter((f) => f.endsWith('.svg')).sort();
    expect(files).toEqual(Object.keys(idx.emoji).map((k) => `${k}.svg`).sort());
    expect(files.length).toBeGreaterThanOrEqual(30);
    const total = files.reduce((n, f) => n + statSync(new URL(f, dir)).size, 0);
    expect(total).toBeLessThan(400 * 1024);
    for (const f of files) expect(readFileSync(new URL(f, dir), 'utf8'), f).not.toMatch(/<script|on\w+=|href="http/i);
  });
});

// @req FR:agent-team/web.avatar.fetch
describe('fetch-fluent-emoji', () => {
  it('shortens numbers and whitespace, and rejects anything that runs or reaches out', async () => {
    const { minify } = await import('../../scripts/fetch-fluent-emoji');
    expect(minify('<?xml version="1.0"?>\n<svg>\n  <!-- c -->\n  <path d="M8.97123 7.24512 C 0.123456 -0.000123 1 2"/>\n</svg>')).toBe('<svg><path d="M9 7.2 C .123-.000123 1 2"/></svg>');
    for (const bad of ['<svg><script>x()</script></svg>', '<svg onload="x()"/>', '<svg><use href="https://x.test/a.svg#b"/></svg>']) expect(() => minify(bad)).toThrow(/Unsafe/);
    expect(minify('<svg><use href="#a"/></svg>')).toBe('<svg><use href="#a"/></svg>');
  });
  it('keeps emoji an earlier run added unless --reset, and caps the bundle at 400 KB', async () => {
    const { wanted, MAX_BYTES } = await import('../../scripts/fetch-fluent-emoji');
    expect(wanted([], ['1f989'])).toContain('1f989');
    expect(wanted(['🦉'], [])).toContain('1f989');
    expect(wanted(['--reset'], ['1f989'])).not.toContain('1f989');
    expect(wanted([], [])).toContain('1f3a7');
    expect(MAX_BYTES).toBe(400 * 1024);
  });
});
