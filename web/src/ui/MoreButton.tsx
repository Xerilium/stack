/**
 * The button under a short list that shows the rest: `Show 4 more`. `keyHint` is the view's shortcut key for it.
 * @req FR:ui-kit/more
 * @req FR:ui-kit/more.key
 * @owns class:more-btn legacy: PrisSessions.tsx=1 views.tsx=1
 */
export function MoreButton({ count, onMore, keyHint }: { count: number; onMore: () => void; keyHint?: string }) {
  return <button type="button" class="more-btn" onClick={onMore}>Show {count} more{keyHint && <> <kbd aria-hidden="true">{keyHint}</kbd></>}</button>;
}
