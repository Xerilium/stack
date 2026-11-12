/** The agent's face: decorative, since the name is always next to it. @req FR:agent-team/web.avatar */
import { useState } from 'preact/hooks';
import { avatarOf, type AvatarWho } from './avatar';

export function Avatar({ who, size = 28 }: { who: AvatarWho; size?: number }) {
  const [broken, setBroken] = useState(false); // a missing image falls back to the monogram
  const v = avatarOf(broken ? { ...who, icon: undefined } : who);
  const style = { width: `${size}px`, height: `${size}px` };
  if (v.kind === 'img') return <img class="avatar" src={v.src} alt="" aria-hidden="true" width={size} height={size} style={style} onError={() => setBroken(true)} />;
  if (v.kind === 'emoji') return <span class="avatar emoji" aria-hidden="true" style={{ ...style, fontSize: `${Math.round(size * 0.6)}px` }}>{v.text}</span>;
  return (
    <svg class="avatar" aria-hidden="true" viewBox="0 0 32 32" width={size} height={size} style={style}>
      <circle cx="16" cy="16" r="16" fill={v.color} />
      <text x="16" y="16" dy=".35em" text-anchor="middle" fill="#fff" font-size={v.text.length > 1 ? 13 : 15} font-weight="600" font-family="system-ui, sans-serif">{v.text}</text>
    </svg>
  );
}
