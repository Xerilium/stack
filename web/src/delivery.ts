/**
 * What Now shows under the owner's newest message: the agent working, not delivered (with Sign in), or delivery off.
 * @req FR:agent-delivery/state.bubble @req FR:agent-delivery/live.offer
 */
export type DeliveryState = 'working' | 'delivered' | 'failed' | 'not-delivered';
export interface DeliveryInfo {
  mode: 'claude' | 'off'; login: 'ok' | 'expired' | 'unknown';
  items: Record<string, { state: DeliveryState; agent: string; reason?: string }>;
  live?: { id: string; title: string; link: string };
}
export type DeliveryNote =
  | { kind: 'working' }
  | { kind: 'failed'; text: string; signIn: boolean }
  | { kind: 'off' }
  | null;

/** The note for the newest message, when it is the owner's and still waits for a reply. */
export function deliveryNote(info: DeliveryInfo | null | undefined, last: { kind: 'owner' | 'agent'; id: string; state?: 'open' | 'handled' } | undefined): DeliveryNote {
  if (!info || !last || last.kind !== 'owner') return null;
  const r = info.items[last.id];
  if (r?.state === 'working') return { kind: 'working' };
  if (r?.state === 'failed' || r?.state === 'not-delivered') {
    const signIn = r.state === 'not-delivered' || info.login === 'expired';
    return { kind: 'failed', text: `Not delivered${r.reason ? `: ${r.reason}` : ''}`, signIn };
  }
  if (last.state === 'open' && info.mode === 'off' && !r) return { kind: 'off' };
  if (last.state === 'open' && info.login === 'expired') return { kind: 'failed', text: 'Not delivered: Claude login expired', signIn: true };
  return null;
}

/** Only the app's own session links open from Now; anything else is dropped. */
export const liveLink = (info: DeliveryInfo | null | undefined): string | null => (info?.live && /^claude:\/\/claude\.ai\/epitaxy\/[A-Za-z0-9_-]+$/.test(info.live.link) ? info.live.link : null);
