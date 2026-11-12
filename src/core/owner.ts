/**
 * Who owns a row, from its marks: the owner (`🙋`) or an agent (`🤖`, `🪄`). The `🤖:level` autonomy marker is not a mark.
 * @req FR:task-lifecycle/rank.owner
 */

export type RowOwner = 'me' | 'agent' | 'mixed';

const HUMAN = /🙋/u;
const AGENT = /🪄|🤖(?!:)/u;

/** The owner a row's own marks give; undefined when it has none. */
export function markOf(text: string): RowOwner | undefined {
  const me = HUMAN.test(text);
  const agent = AGENT.test(text);
  return me && agent ? 'mixed' : me ? 'me' : agent ? 'agent' : undefined;
}

/**
 * Owner of a row from its text and its ancestors' texts, nearest first. First match wins: the row's own marks (both is mixed),
 * else the nearest ancestor with exactly one kind of mark (a mixed ancestor is skipped), else the owner.
 * @req FR:task-lifecycle/rank.owner
 */
export function rowOwner(text: string, ancestors: Iterable<string>): RowOwner {
  const own = markOf(text);
  if (own) return own;
  for (const a of ancestors) {
    const m = markOf(a);
    if (m === 'me' || m === 'agent') return m;
  }
  return 'me';
}
