import { parseConfig, getTimeBlock, ConfigError } from '../../src/core/config';

// @req FR:config/$stack-config @req FR:config/$time-block
describe('parseConfig', () => {
  // @req FR:config/load.@function @req FR:config/load.input @req FR:config/load.output
  // @req FR:config/load.defaults
  it('returns legacy defaults for missing input', () => {
    const c = parseConfig(undefined);
    expect(c.timezone).toBe('America/Los_Angeles');
    expect(c.startOfDay).toBe('08:00');
    expect(c.taskScoring.emojiWeights.priority['🔝']).toBe(1000);
    expect(c.taskScoring.effortHours['🟢']).toBe(0.5);
    expect(c.timeBlocks.map(b => b.name)).toContain('Work');
  });

  // @req FR:config/load.merge
  it('overrides per key and merges weight maps', () => {
    const c = parseConfig({ startOfDay: '06:00', taskScoring: { emojiWeights: { priority: { '🔺': 99 } } } });
    expect(c.startOfDay).toBe('06:00');
    expect(c.taskScoring.emojiWeights.priority['🔺']).toBe(99);
    expect(c.taskScoring.emojiWeights.priority['🔝']).toBe(1000);
  });

  // @req FR:config/load.timeblocks-replace
  it('replaces time blocks when provided', () => {
    const c = parseConfig({ timeBlocks: [{ name: 'A', days: ['Mon'], startTime: '09:00', endTime: '10:00', emoji: 'x' }] });
    expect(c.timeBlocks).toHaveLength(1);
  });

  // @req FR:config/load.validate
  it('throws ConfigError naming the path on wrong type', () => {
    expect(() => parseConfig({ startOfDay: 5 })).toThrow(ConfigError);
    expect(() => parseConfig({ startOfDay: 5 })).toThrow(/startOfDay/);
  });

  // @req FR:config/load.validate.time
  it('rejects bad time format', () => {
    expect(() => parseConfig({ timeBlocks: [{ name: 'A', days: ['Mon'], startTime: '9am', endTime: '10:00', emoji: 'x' }] })).toThrow(/startTime/);
  });

  // @req FR:config/load.validate.days
  it('rejects bad day names', () => {
    expect(() => parseConfig({ timeBlocks: [{ name: 'A', days: ['Funday'], startTime: '09:00', endTime: '10:00', emoji: 'x' }] })).toThrow(/days/);
  });

  // @req FR:config/load.validate.timezone
  it('rejects unknown timezone', () => {
    expect(() => parseConfig({ timezone: 'Mars/Base' })).toThrow(/timezone/);
  });
});

describe('getTimeBlock', () => {
  const c = parseConfig({ timezone: 'UTC' });
  // 2026-10-21 is a Wednesday
  // @req FR:config/time-block.@function @req FR:config/time-block.input @req FR:config/time-block.output
  // @req FR:config/time-block.resolve
  it('finds the block containing the instant', () => {
    expect(getTimeBlock(c, new Date('2026-10-21T10:00:00Z'))?.name).toBe('Work');
    expect(getTimeBlock(c, new Date('2026-10-21T17:00:00Z'))?.name).toBe('Family evening');
  });

  // @req FR:config/time-block.overnight
  it('attributes post-midnight hours to the previous day block', () => {
    expect(getTimeBlock(c, new Date('2026-10-22T00:30:00Z'))?.name).toBe('Project');
  });

  // @req FR:config/time-block.none
  it('returns undefined when no block matches', () => {
    const only = parseConfig({ timezone: 'UTC', timeBlocks: [{ name: 'A', days: ['Mon'], startTime: '09:00', endTime: '10:00', emoji: 'x' }] });
    expect(getTimeBlock(only, new Date('2026-10-21T09:30:00Z'))).toBeUndefined();
  });
});

describe('edge cases', () => {
  const c = parseConfig({ timezone: 'UTC' });
  // @req FR:config/time-block.resolve
  it('treats the end of a range as exclusive', () => {
    expect(getTimeBlock(c, new Date('2026-10-21T16:00:00Z'))?.name).toBe('Family evening');
  });

  // @req FR:config/time-block.overnight
  it('wraps Sunday overnight into Monday morning', () => {
    const only = parseConfig({ timezone: 'UTC', timeBlocks: [{ name: 'N', days: ['Sun'], startTime: '23:00', endTime: '02:00', emoji: 'x' }] });
    expect(getTimeBlock(only, new Date('2026-10-26T01:00:00Z'))?.name).toBe('N'); // Monday 01:00
  });

  // @req FR:config/time-block.resolve
  it('resolves in the configured non-UTC timezone', () => {
    const la = parseConfig({ timezone: 'America/Los_Angeles' });
    expect(getTimeBlock(la, new Date('2026-10-21T17:00:00Z'))?.name).toBe('Work'); // 10:00 PDT
  });

  // @req FR:config/load.validate
  it('rejects invalid startOfDay and non-object input', () => {
    expect(() => parseConfig({ startOfDay: '25:00' })).toThrow(/startOfDay/);
    expect(() => parseConfig('nope')).toThrow(ConfigError);
  });

  // @req FR:config/load.merge
  it('merges a new weight category and ignores __proto__', () => {
    const x = parseConfig(JSON.parse('{"taskScoring":{"emojiWeights":{"custom":{"x":1},"__proto__":{"y":2}}}}'));
    expect(x.taskScoring.emojiWeights.custom.x).toBe(1);
    expect(({} as Record<string, unknown>).y).toBeUndefined();
    expect((x.taskScoring.emojiWeights as Record<string, unknown>).y).toBeUndefined();
  });

  // @req FR:config/load.defaults
  it('does not let callers corrupt defaults', () => {
    parseConfig().taskScoring.emojiWeights.priority['🔝'] = 0;
    expect(parseConfig().taskScoring.emojiWeights.priority['🔝']).toBe(1000);
  });
});

describe('range and overlap', () => {
  const mk = (name: string, s: string, e: string) => ({ name, days: ['Wed'], startTime: s, endTime: e, emoji: 'x' });
  // @req FR:config/time-block.overlap
  it('returns the first matching block when blocks overlap', () => {
    const c = parseConfig({ timezone: 'UTC', timeBlocks: [mk('A', '09:00', '12:00'), mk('B', '10:00', '11:00')] });
    expect(getTimeBlock(c, new Date('2026-10-21T10:30:00Z'))?.name).toBe('A');
  });

  // @req FR:config/load.validate.range
  it('rejects a block whose start equals its end', () => {
    expect(() => parseConfig({ timeBlocks: [mk('A', '09:00', '09:00')] })).toThrow(/startTime equals endTime/);
  });

  // @req FR:config/load.validate
  it('rejects wrong types in weights and time blocks', () => {
    expect(() => parseConfig({ taskScoring: { emojiWeights: { priority: { a: 'x' } } } })).toThrow(/priority.a/);
    expect(() => parseConfig({ timeBlocks: 'x' })).toThrow(/timeBlocks/);
    expect(() => parseConfig({ timeBlocks: [{ ...mk('A', '09:00', '10:00'), label: 5 }] })).toThrow(/label/);
  });

  // @req FR:config/load.merge
  it('merges effortHours', () => {
    expect(parseConfig({ taskScoring: { effortHours: { '🟢': 0.75 } } }).taskScoring.effortHours['🟢']).toBe(0.75);
  });
});
