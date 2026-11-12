/**
 * The Needs-you count for the dock and tray: the host's session inventory over loopback.
 * @req FR:pris-sessions-ui/tray.badge
 */
type FetchLike = (url: string) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** Waiting and stuck sessions; 0 when the host has no inventory (404). Throws on any other failure. */
export async function needsYouCount(hostUrl: string, fetchFn: FetchLike = (u) => fetch(u)): Promise<number> {
  const r = await fetchFn(`${hostUrl}/api/session-inventory`);
  if (r.status === 404) return 0;
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const j = (await r.json()) as { needsYou?: unknown };
  return Array.isArray(j.needsYou) ? j.needsYou.length : 0;
}

/** Tooltip text for a count. */
export const badgeTip = (n: number): string => (n > 0 ? `Stack · ${n} ${n === 1 ? 'needs' : 'need'} you` : 'Stack');
