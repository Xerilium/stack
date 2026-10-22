/** @req FR:web-app/palette.match */
export function fuzzyScore(query: string, label: string): number | null {
  const q = query.toLowerCase();
  const s = label.toLowerCase();
  if (!q) return 0;
  let score = 0;
  let from = 0;
  let prev = -2;
  for (const ch of q) {
    const i = s.indexOf(ch, from);
    if (i < 0) return null;
    score += 1;
    if (i === prev + 1) score += 5;
    if (i === 0 || !/[a-z0-9]/.test(s[i - 1])) score += 8;
    if (i === 0 && prev === -2) score += 10;
    prev = i;
    from = i + 1;
  }
  return score;
}

/** @req FR:web-app/palette.open */
export function filterCommands<T extends { label: string }>(cmds: T[], query: string): T[] {
  return cmds
    .map((c, i) => ({ c, i, s: fuzzyScore(query, c.label) }))
    .filter((x): x is { c: T; i: number; s: number } => x.s !== null)
    .sort((a, b) => b.s - a.s || a.i - b.i)
    .map((x) => x.c);
}
