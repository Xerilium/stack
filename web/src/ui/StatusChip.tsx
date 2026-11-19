/**
 * A status chip: a state word on a light tint with a dot. Not a control: a span, no border, no hover, default cursor.
 * @req FR:ui-kit/chip
 */
import './ui.css';

export type ChipTone = 'neutral' | 'info' | 'ok' | 'warn' | 'bad';
export function StatusChip({ label, tone = 'neutral', title }: { label: string; tone?: ChipTone; title?: string }) {
  return <span class={`ui-chip t-${tone}`} {...(title ? { title } : {})}><span class="ui-chip-dot" aria-hidden="true" />{label}</span>;
}
