import { describe, expect, it } from 'vitest';
import { keyboardMove, moveTarget, type RowPos } from '../src/reorder';

const R = (ref: string, project: string, depth = 0): RowPos => ({ ref, project, depth });
const ROWS = [R('a:1', 'a'), R('a:2', 'a', 1), R('a:3', 'a'), R('b:1', 'b'), R('a:5', 'a')];

// @req FR:web-app/reorder.plan
describe('moveTarget', () => {
  it('maps drop halves to before/after', () => {
    expect(moveTarget(ROWS, 'a:1', 'a:3', 'top')).toEqual({ target: 'a:3', position: 'before' });
    expect(moveTarget(ROWS, 'a:1', 'a:3', 'bottom')).toEqual({ target: 'a:3', position: 'after' });
  });
  it('refuses self, other project, own subtree, unknown rows', () => {
    expect(moveTarget(ROWS, 'a:1', 'a:1', 'top')).toBeNull();
    expect(moveTarget(ROWS, 'a:1', 'b:1', 'top')).toBeNull();
    expect(moveTarget(ROWS, 'a:1', 'a:2', 'bottom')).toBeNull();
    expect(moveTarget(ROWS, 'a:1', 'zz:1', 'top')).toBeNull();
    expect(moveTarget(ROWS, 'zz:1', 'a:1', 'top')).toBeNull();
  });
});

// @req FR:web-app/reorder.keys
describe('keyboardMove', () => {
  it('moves down past the subtree and up before the previous row', () => {
    expect(keyboardMove(ROWS, 'a:1', 'down')).toEqual({ target: 'a:3', position: 'after' });
    expect(keyboardMove(ROWS, 'a:3', 'up')).toEqual({ target: 'a:2', position: 'before' });
  });
  it('stops at project edges', () => {
    expect(keyboardMove(ROWS, 'a:1', 'up')).toBeNull();
    expect(keyboardMove(ROWS, 'a:3', 'down')).toBeNull();
    expect(keyboardMove(ROWS, 'a:5', 'up')).toBeNull();
  });
});
