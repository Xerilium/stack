// @req FR:agent-delivery/state.bubble @req FR:agent-delivery/live.offer
import { describe, expect, it } from 'vitest';
import { deliveryNote, liveLink, type DeliveryInfo } from '../src/delivery';

const info = (o: Partial<DeliveryInfo> = {}): DeliveryInfo => ({ mode: 'claude', login: 'ok', items: {}, ...o });
const mine = { kind: 'owner' as const, id: 'in-1', state: 'open' as const };

describe('deliveryNote', () => {
  it('shows working while the agent runs', () => {
    expect(deliveryNote(info({ items: { 'in-1': { state: 'working', agent: 'cid' } } }), mine)).toEqual({ kind: 'working' });
  });
  it('shows Not delivered with the reason, and Sign in when signed out', () => {
    expect(deliveryNote(info({ items: { 'in-1': { state: 'failed', agent: 'cid', reason: 'Timed out' } } }), mine)).toEqual({ kind: 'failed', text: 'Not delivered: Timed out', signIn: false });
    expect(deliveryNote(info({ login: 'expired', items: { 'in-1': { state: 'not-delivered', agent: 'cid', reason: 'Claude login expired' } } }), mine)).toEqual({ kind: 'failed', text: 'Not delivered: Claude login expired', signIn: true });
    expect(deliveryNote(info({ login: 'expired' }), mine)).toEqual({ kind: 'failed', text: 'Not delivered: Claude login expired', signIn: true });
  });
  it('says delivery is off for an open message, and nothing once replied or delivered', () => {
    expect(deliveryNote(info({ mode: 'off' }), mine)).toEqual({ kind: 'off' });
    expect(deliveryNote(info({ items: { 'in-1': { state: 'delivered', agent: 'cid' } } }), { ...mine, state: 'handled' })).toBeNull();
    expect(deliveryNote(info({ mode: 'off' }), { kind: 'agent', id: 'in-2' })).toBeNull();
    expect(deliveryNote(null, mine)).toBeNull();
  });
});

describe('liveLink', () => {
  it('keeps only app session links', () => {
    expect(liveLink(info({ live: { id: 's1', title: 't', link: 'claude://claude.ai/epitaxy/s1' } }))).toBe('claude://claude.ai/epitaxy/s1');
    expect(liveLink(info({ live: { id: 's1', title: 't', link: 'javascript:alert(1)' } }))).toBeNull();
    expect(liveLink(info())).toBeNull();
  });
});
