/**
 * The agent's face, and project-title emoji, drawn the same way: bundled Fluent Emoji, else native text, else the monogram.
 * Decorative, since the name is always next to it.
 * @req FR:agent-team/web.avatar @req FR:agent-team/web.avatar.fluent @req FR:agent-team/web.avatar.project
 */
import { useEffect, useState } from 'preact/hooks';
import { avatarChain, emojiView, type AvatarWho } from './avatar';
import { leadEmoji } from './fluent';

export function Avatar({ who, size = 28 }: { who: AvatarWho; size?: number }) {
  const [fails, setFails] = useState(0);
  useEffect(() => setFails(0), [who.icon, who.name]); // a new agent gets a fresh try
  const chain = avatarChain(who);
  const v = chain[Math.min(fails, chain.length - 1)]!;
  const failed = () => setFails((n) => n + 1);
  const style = { width: `${size}px`, height: `${size}px` };
  if (v.kind === 'fluent') return <img key={v.src} class="avatar fluent" src={v.src} alt="" aria-hidden="true" width={size} height={size} style={style} onError={failed} />;
  if (v.kind === 'img') return <img key={v.src} class="avatar" src={v.src} alt="" aria-hidden="true" width={size} height={size} style={style} onError={failed} />;
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
  useEffect(() => setBroken(false), [text]);
  const v = emojiView(text);
  if (v.kind === 'fluent' && !broken) return <img class="emo" src={v.src} alt="" aria-hidden="true" onError={() => setBroken(true)} />;
  return <span class="emo-native" aria-hidden="true">{text}</span>;
}

/** A project title with its leading emoji drawn by the same renderer: `🎧 Flantastic 4`. */
export function Titled({ text }: { text: string }) {
  const lead = leadEmoji(text);
  return lead && lead.rest ? <><Emoji text={lead.emoji} /> {lead.rest}</> : <>{text}</>; // an emoji-only title stays text so it has a name
}
