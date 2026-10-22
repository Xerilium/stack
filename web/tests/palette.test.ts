import { describe, expect, it } from 'vitest';
import { filterCommands, fuzzyScore } from '../src/palette';

// @req FR:web-app/palette.match
describe('fuzzyScore', () => {
  it('matches subsequences and ranks prefixes and word starts higher', () => {
    expect(fuzzyScore('gl', 'Go to list')).not.toBeNull();
    expect(fuzzyScore('zz', 'Go to list')).toBeNull();
    expect(fuzzyScore('go', 'Go to list')!).toBeGreaterThan(fuzzyScore('go', 'Cargo')!);
    expect(fuzzyScore('gtl', 'Go to list')!).toBeGreaterThan(fuzzyScore('gtl', 'Gentle tail')!);
  });
  it('is case-insensitive and empty matches all', () => {
    expect(fuzzyScore('LIST', 'go to list')).not.toBeNull();
    expect(fuzzyScore('', 'anything')).toBe(0);
  });
});

// @req FR:web-app/palette.open
describe('filterCommands', () => {
  const cmds = [{ id: 'a', label: 'Go to next' }, { id: 'b', label: 'Go to list' }, { id: 'c', label: 'Sign out' }];
  it('keeps registry order for an empty query and sorts by score otherwise', () => {
    expect(filterCommands(cmds, '').map((c) => c.id)).toEqual(['a', 'b', 'c']);
    expect(filterCommands(cmds, 'sign').map((c) => c.id)).toEqual(['c']);
    expect(filterCommands(cmds, 'list')[0].id).toBe('b');
  });
});
