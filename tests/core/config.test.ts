import { parseConfig, getTimeBlock, ConfigError } from '../../src/core/config';

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
