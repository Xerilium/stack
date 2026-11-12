/**
 * Agent avatars: the agent's icon (emoji, `fluent:<name>`, or same-origin image), else the emoji that starts its name,
 * else a monogram on a stable color. An emoji renders as bundled Fluent Emoji when there is one. Pure; no network.
 * @req FR:agent-team/web.avatar @req FR:agent-team/web.avatar.fluent
 */
import { emojiKey, fluentNamed, fluentSrc, leadEmoji } from './fluent';

/** Each reaches 4.5:1 with white text. */
export const AVATAR_COLORS = ['#4338ca', '#0f766e', '#b45309', '#be123c', '#6d28d9', '#1d4ed8', '#15803d', '#a21caf'] as const;

export type AvatarView = { kind: 'fluent'; src: string; text: string } | { kind: 'emoji'; text: string } | { kind: 'img'; src: string } | { kind: 'mono'; text: string; color: string };
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
const EMOJI = (v: string) => v.length > 0 && v.length <= 16 && !/[\s\p{L}\p{N}/\\<>"'`]/u.test(v) && /[^\x20-\x7e]/.test(v);
const IMAGE = (v: string) => /^\/(?!\/)[A-Za-z0-9._/-]{1,200}\.(?:png|jpe?g|gif|webp|svg)$/i.test(v) && !v.includes('..');
const FLUENT = /^fluent:([a-z0-9_]{1,60})$/;

/** An emoji as Fluent when bundled, else native text. */
export function emojiView(text: string): AvatarView {
  const src = fluentSrc(text);
  return src ? { kind: 'fluent', src, text } : { kind: 'emoji', text };
}

/** The name to print next to the avatar: without its leading emoji only when the avatar already draws that emoji. */
export function nameBeside(who: AvatarWho): string {
  const lead = leadEmoji(who.name);
  const v = avatarOf(who);
  return lead && lead.rest && (v.kind === 'fluent' || v.kind === 'emoji') && emojiKey(v.text) === emojiKey(lead.emoji) ? lead.rest : who.name;
}

export function avatarOf(who: AvatarWho): AvatarView {
  const named = who.icon ? FLUENT.exec(who.icon) : null;
  const fl = named ? fluentNamed(named[1]) : undefined;
  if (fl) return { kind: 'fluent', ...fl };
  if (who.icon && EMOJI(who.icon)) return emojiView(who.icon);
  if (who.icon && IMAGE(who.icon)) return { kind: 'img', src: who.icon };
  const lead = !who.icon ? leadEmoji(who.name) : undefined;
  if (lead) return emojiView(lead.emoji);
  const key = (who.slug || who.name).toLowerCase();
  return { kind: 'mono', text: initials(who.name), color: AVATAR_COLORS[hash(key) % AVATAR_COLORS.length] };
}
