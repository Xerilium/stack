/**
 * Emoji as Microsoft Fluent Emoji: a bundled `Color` SVG per code point (web/src/emoji, from scripts/fetch-fluent-emoji.ts), else native text.
 * Same-origin assets only; no network to third parties.
 * @req FR:agent-team/web.avatar.fluent @req FR:agent-team/web.avatar.project
 */
import index from './emoji/index.json';

const urls = import.meta.glob<string>('./emoji/*.svg', { eager: true, query: '?url', import: 'default' });
const BY_KEY = new Map<string, string>(Object.entries(urls).map(([p, u]) => [p.slice('./emoji/'.length, -'.svg'.length), u]));
const BY_NAME = new Map<string, string>(Object.entries(index.emoji as Record<string, string>).map(([k, n]) => [n, k]));

/** Code points in hex joined by `-`, variation selectors dropped (the asset file name). */
export const emojiKey = (e: string): string => [...e].map((c) => c.codePointAt(0)!).filter((c) => c !== 0xfe0f && c !== 0xfe0e).map((c) => c.toString(16)).join('-');
const fromKey = (k: string): string => String.fromCodePoint(...k.split('-').map((h) => parseInt(h, 16)));

/** The bundled Fluent asset for an emoji, or undefined (render native). */
export const fluentSrc = (e: string): string | undefined => (e ? BY_KEY.get(emojiKey(e)) : undefined);

/** `fluent:<name>` by Fluent file name (`headphone`). */
export function fluentNamed(name: string): { src: string; text: string } | undefined {
  const k = BY_NAME.get(name);
  const src = k && BY_KEY.get(k);
  return k && src ? { src, text: fromKey(k) } : undefined;
}

/** One emoji: a pictograph (or a flag) with its modifiers, variation selectors, and ZWJ parts. */
const LEAD = /^(?:\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?(?:‍\p{Extended_Pictographic}(?:️|\p{Emoji_Modifier})?)*)/u;

/** The emoji that starts a title, and the rest: `🎧 Flantastic 4` → `{ emoji: '🎧', rest: 'Flantastic 4' }`. */
export function leadEmoji(text: string): { emoji: string; rest: string } | undefined {
  const m = LEAD.exec(text);
  return m ? { emoji: m[0], rest: text.slice(m[0].length).trimStart() } : undefined;
}
