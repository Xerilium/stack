/**
 * The agent's face, and project-title emoji, drawn the same way: bundled Fluent Emoji, else native text, else the monogram.
 * Decorative, since the name is always next to it.
 * @req FR:agent-team/web.avatar @req FR:agent-team/web.avatar.fluent @req FR:agent-team/web.avatar.project
 */
import { useState } from 'preact/hooks';
import { avatarOf, emojiView, type AvatarView, type AvatarWho } from './avatar';
import { leadEmoji } from './fluent';

export function Avatar({ who, size = 28 }: { who: AvatarWho; size?: number }) {
  const [broken, setBroken] = useState(false); // a missing Fluent image falls back to native text; a missing icon image to the name's emoji or monogram
  const first = avatarOf(who);
  const v: AvatarView = !broken ? first : first.kind === 'fluent' ? { kind: 'emoji', text: first.text } : avatarOf({ ...who, icon: undefined });
  const style = { width: `${size}px`, height: `${size}px` };
  if (v.kind === 'fluent') return <img class="avatar fluent" src={v.src} alt="" aria-hidden="true" width={size} height={size} style={style} onError={() => setBroken(true)} />;
  if (v.kind === 'img') return <img class="avatar" src={v.src} alt="" aria-hidden="true" width={size} height={size} style={style} onError={() => setBroken(true)} />;
  if (v.kind === 'emoji') return <span class="avatar emoji" aria-hidden="true" style={{ ...style, fontSize: `${Math.round(size * 0.6)}px` }}>{v.text}</span>;
  return (
    <svg class="avatar" aria-hidden="true" viewBox="0 0 32 32" width={size} height={size} style={style}>
      <circle cx="16" cy="16" r="16" fill={v.color} />
      <text x="16" y="16" dy=".35em" text-anchor="middle" fill="#fff" font-size={v.text.length > 1 ? 13 : 15} font-weight="600" font-family="system-ui, sans-serif">{v.text}</text>
    </svg>
  );
}

/** One emoji inline with text, sized to the font. */
export function Emoji({ text }: { text: string }) {
  const [broken, setBroken] = useState(false);
  const v = emojiView(text);
  if (v.kind === 'fluent' && !broken) return <img class="emo" src={v.src} alt="" aria-hidden="true" onError={() => setBroken(true)} />;
  return <span class="emo-native" aria-hidden="true">{text}</span>;
}

/** A project title with its leading emoji drawn by the same renderer: `🎧 Flantastic 4`. */
export function Titled({ text }: { text: string }) {
  const lead = leadEmoji(text);
  return lead ? <><Emoji text={lead.emoji} /> {lead.rest}</> : <>{text}</>;
}
