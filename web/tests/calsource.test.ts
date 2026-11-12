// @req FR:ux-consolidation/cal.fresh @req FR:ux-consolidation/cal.ui @req FR:ux-consolidation/cal.check
import { describe, expect, it } from 'vitest';
import { calLine, checkText, isFresh, sourceOf } from '../src/calsource';

const NOW = new Date('2026-11-11T18:00:00Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();

describe('sourceOf', () => {
  it('takes the host source when it is one', () => {
    expect(sourceOf({ configured: true, items: [], source: { kind: 'calendar', via: 'ics', account: 'outlook.office365.com', state: 'ok', lastSyncAt: ago(3) } }, NOW))
      .toEqual({ kind: 'calendar', via: 'ics', account: 'outlook.office365.com', state: 'ok', lastSyncAt: ago(3) });
  });
  it('derives one from an older host: configured and no error is ok as of the reply', () => {
    expect(sourceOf({ configured: true, items: [] }, NOW)).toEqual({ kind: 'calendar', state: 'ok', lastSyncAt: NOW.toISOString() });
    expect(sourceOf({ configured: true, items: [], error: 'Calendar unavailable' }, NOW)).toEqual({ kind: 'calendar', state: 'error' });
    expect(sourceOf({ configured: false, items: [] }, NOW)).toEqual({ kind: 'calendar', state: 'not-connected' });
  });
  it('ignores a malformed source', () => {
    expect(sourceOf({ configured: false, items: [], source: { state: 'great' } }, NOW)).toEqual({ kind: 'calendar', state: 'not-connected' });
  });
});

describe('isFresh', () => {
  it('is true only for ok and synced under 60 min ago', () => {
    expect(isFresh({ kind: 'calendar', state: 'ok', lastSyncAt: ago(59) }, NOW)).toBe(true);
    expect(isFresh({ kind: 'calendar', state: 'ok', lastSyncAt: ago(61) }, NOW)).toBe(false);
    expect(isFresh({ kind: 'calendar', state: 'ok' }, NOW)).toBe(false);
    expect(isFresh({ kind: 'calendar', state: 'stale', lastSyncAt: ago(1) }, NOW)).toBe(false);
    expect(isFresh({ kind: 'calendar', state: 'error' }, NOW)).toBe(false);
    expect(isFresh(null, NOW)).toBe(false);
  });
});

describe('calLine', () => {
  it('says why and offers the fix; nothing when fresh', () => {
    expect(calLine({ kind: 'calendar', state: 'not-connected' }, NOW)).toEqual({ text: 'Calendar not connected', act: 'connect' });
    expect(calLine({ kind: 'calendar', state: 'error' }, NOW)).toEqual({ text: 'Calendar unavailable', act: 'fix' });
    expect(calLine({ kind: 'calendar', state: 'stale', lastSyncAt: ago(125) }, NOW)).toEqual({ text: 'Calendar last synced 2 h ago', act: 'fix' });
    expect(calLine({ kind: 'calendar', state: 'ok', lastSyncAt: ago(90) }, NOW)).toEqual({ text: 'Calendar last synced 2 h ago', act: 'fix' });
    expect(calLine({ kind: 'calendar', state: 'ok', lastSyncAt: ago(1) }, NOW)).toBeNull();
    expect(calLine(null, NOW)).toEqual({ text: 'Checking your calendar…', act: null });
  });
});

describe('checkText', () => {
  it('reads like a result', () => {
    expect(checkText({ kind: 'calendar', state: 'ok', lastSyncAt: ago(0) }, NOW)).toBe('Connected · synced just now');
    expect(checkText({ kind: 'calendar', state: 'ok', account: 'a.test', lastSyncAt: ago(5) }, NOW)).toBe('Connected to a.test · synced 5 min ago');
    expect(checkText({ kind: 'calendar', state: 'not-connected' }, NOW)).toBe('Not connected');
    expect(checkText({ kind: 'calendar', state: 'error' }, NOW)).toBe('Calendar unavailable. Check the link, then try again.');
    expect(checkText({ kind: 'calendar', via: 'graph', state: 'error' }, NOW)).toBe('Calendar unavailable. Click Fix and sign in again.');
  });
});
