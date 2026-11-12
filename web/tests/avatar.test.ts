// @req FR:agent-team/web.avatar
import { describe, expect, it } from 'vitest';
import { AVATAR_COLORS, avatarOf, initials } from '../src/avatar';

const lum = (hex: string) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};

describe('avatar', () => {
  it('uses up to two initials, emoji dropped', () => {
    expect(initials('🎧 Cid Manager')).toBe('CM');
    expect(initials('Chief of Staff')).toBe('CS');
    expect(initials('cos')).toBe('C');
    expect(initials('🎧')).toBe('?');
  });
  it('picks a stable color per agent, and white text reaches 4.5:1 on every color', () => {
    expect(avatarOf({ slug: 'cid', name: 'Cid' })).toEqual(avatarOf({ slug: 'cid', name: 'Cid' }));
    expect(new Set(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'].map((s) => (avatarOf({ slug: s, name: s }) as { color: string }).color)).size).toBeGreaterThan(3);
    for (const c of AVATAR_COLORS) expect((1.05) / (lum(c) + 0.05)).toBeGreaterThanOrEqual(4.5);
  });
  it('shows the icon when set: emoji or a same-origin image; anything else falls back to the monogram', () => {
    expect(avatarOf({ slug: 'cid', name: 'Cid', icon: '🎧' })).toEqual({ kind: 'emoji', text: '🎧' });
    expect(avatarOf({ slug: 'cid', name: 'Cid', icon: '/agents/cid.png' })).toEqual({ kind: 'img', src: '/agents/cid.png' });
    expect(avatarOf({ slug: 'cid', name: 'Cid', icon: 'https://x.test/a.png' })).toMatchObject({ kind: 'mono', text: 'C' });
    expect(avatarOf({ slug: 'cid', name: 'Cid', icon: '#' })).toMatchObject({ kind: 'mono' });
  });
});
