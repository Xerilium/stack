/**
 * A count on a nav item or an icon button. `label` says what it counts; with no label it is hidden from assistive tech,
 * for a control whose own name already says the count.
 * @req FR:ui-kit/badge
 * @req FR:ui-kit/badge.hidden
 * @owns class:badge legacy: App.tsx=1
 */
export function CountBadge({ count, label, testId }: { count: number; label?: string; testId?: string }) {
  return <span class="badge" {...(label ? { 'aria-label': label } : { 'aria-hidden': 'true' })} {...(testId ? { 'data-testid': testId } : {})}>{count}</span>;
}
