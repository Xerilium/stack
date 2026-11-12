/**
 * Agent avatars: the agent's icon (emoji or same-origin image), else a monogram on a stable color. Pure; no network.
 * @req FR:agent-team/web.avatar
 */

/** Each reaches 4.5:1 with white text. */
export const AVATAR_COLORS = ['#4338ca', '#0f766e', '#b45309', '#be123c', '#6d28d9', '#1d4ed8', '#15803d', '#a21caf'] as const;

export type AvatarView = { kind: 'emoji'; text: string } | { kind: 'img'; src: string } | { kind: 'mono'; text: string; color: string };
export interface AvatarWho { slug?: string; name: string; icon?: string }

/** Up to two initials (first and last word), emoji and punctuation dropped. */
export function initials(name: string): string {
  const words = name.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (!words.length) return '?';
  const pick = words.length > 1 ? [words[0], words[words.length - 1]] : [words[0]];
  return pick.map((w) => (w ?? '').charAt(0).toUpperCase()).join('');
}

/** FNV-1a: the same key always picks the same color. */
const hash = (s: string): number => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return h >>> 0; };
const EMOJI = (v: string) => v.length > 0 && v.length <= 16 && !/[\sA-Za-z0-9/\\<>"'`]/.test(v);
const IMAGE = (v: string) => /^\/(?!\/)[A-Za-z0-9._/-]{1,200}\.(?:png|jpe?g|gif|webp|svg)$/i.test(v) && !v.includes('..');

export function avatarOf(who: AvatarWho): AvatarView {
  if (who.icon && EMOJI(who.icon)) return { kind: 'emoji', text: who.icon };
  if (who.icon && IMAGE(who.icon)) return { kind: 'img', src: who.icon };
  const key = (who.slug || who.name).toLowerCase();
  return { kind: 'mono', text: initials(who.name), color: AVATAR_COLORS[hash(key) % AVATAR_COLORS.length] };
}
