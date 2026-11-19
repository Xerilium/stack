/**
 * Placeholder rows while a view loads. The box is busy (`aria-busy`); with `status` it is a live status named `label`.
 * `as` is the shape of the content it stands for: a block of rows (the box is `skeleton`), a list (`ol`), or lines of text.
 * For a list or lines, `class` is the view's list or pane class, so the rows sit where the content will.
 * @req FR:ui-kit/skeleton
 * @req FR:ui-kit/skeleton.shape
 * @owns class:sk
 * @owns class:skeleton
 */
export type SkeletonRow = '' | 'big' | 'short';

export function Skeleton({ class: cls, rows, as = 'div', label, status = false, testId }: {
  /** The class of a list or lines box; an extra class on a block. */
  class?: string;
  /** A row count, or the size of each row. */
  rows: number | SkeletonRow[];
  as?: 'div' | 'ol' | 'lines';
  label?: string;
  /** Announce it as a status (`role="status"`). */
  status?: boolean;
  testId?: string;
}) {
  const Box = as === 'ol' ? 'ol' : 'div';
  const Row = as === 'ol' ? 'li' : as === 'lines' ? 'p' : 'div';
  const list: SkeletonRow[] = typeof rows === 'number' ? Array.from({ length: rows }, () => '' as const) : rows;
  return (
    <Box class={as === 'div' ? `skeleton${cls ? ` ${cls}` : ''}` : cls} {...(status ? { role: 'status' } : {})} aria-busy="true" {...(label ? { 'aria-label': label } : {})} {...(testId ? { 'data-testid': testId } : {})}>
      {list.map((r, i) => <Row key={i} class={r ? `sk ${r}` : 'sk'} />)}
    </Box>
  );
}
