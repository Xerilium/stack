/** @req FR:pr-review-lane/panel.chip @req FR:pr-review-lane/panel.check */
import { describe, expect, it } from 'vitest';
import { byWord, CHIP, newerLane, toggleOp, type Lane } from '../src/live-lane';

describe('live lane helpers', () => {
  it('chip words per lane state', () => {
    expect(CHIP).toEqual({ idle: 'Idle', preparing: 'Preparing', working: 'Agent working', 'ready-for-michael': 'Ready for you', revalidating: 'Recheck' });
  });
  it('a tap toggles passed and open', () => {
    expect(toggleOp({ state: 'passed' })).toBe('uncheck');
    expect(toggleOp({ state: 'open' })).toBe('check');
    expect(toggleOp({ state: 'needs-fix' })).toBe('check');
    expect(byWord('owner')).toBe('you');
    expect(byWord('live-1')).toBe('live-1');
  });
  // @req FR:pr-review-lane/panel.refresh
  it('an older reload never replaces a newer lane', () => {
    const lane = (rev: number): Lane => ({ state: 'working', rev, items: [], done: [] });
    expect(newerLane(null, lane(3)).rev).toBe(3);
    expect(newerLane(lane(5), lane(4)).rev).toBe(5);
    expect(newerLane(lane(5), lane(6)).rev).toBe(6);
  });
});
