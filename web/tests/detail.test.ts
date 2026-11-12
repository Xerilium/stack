import { describe, expect, it } from 'vitest';
import { ACTION_HINT, displayName, dueLabel, dueValue, EFFORT_OPTIONS, effortOf, modeHint, nearestEffort, PRIORITY_OPTIONS, priorityOf, withDue } from '../src/detail';

describe('priority', () => {
  // @req FR:task-detail-design/detail.priority
  it('offers Critical, High, Normal, Low; Normal clears the marker', () => {
    expect(PRIORITY_OPTIONS.map((o) => o.name)).toEqual(['Critical', 'High', 'Normal', 'Low']);
    expect(PRIORITY_OPTIONS.find((o) => o.name === 'Normal')!.value).toBe('None');
  });
  it('reads the current priority from the row', () => {
    expect(priorityOf('🚨 Ship it').name).toBe('Critical');
    expect(priorityOf('‼️ Ship it').name).toBe('High');
    expect(priorityOf('🔻 Ship it').name).toBe('Low');
    expect(priorityOf('Ship it').name).toBe('Normal');
    expect(priorityOf('🔺 Ship it').name).toBe('Raised');
  });
});

describe('effort', () => {
  // @req FR:task-detail-design/detail.effort
  it('offers the common durations and None', () => {
    expect(EFFORT_OPTIONS.map((o) => o.name)).toEqual(['30 min', '1 hour', '2 hours', '4 hours', '8+ hours', 'None']);
  });
  it('reads the current effort', () => {
    expect(effortOf('Ship it 🟢').name).toBe('30 min');
    expect(effortOf('Ship it').name).toBe('None');
  });
  it('custom minutes snap to the nearest step', () => {
    expect(nearestEffort(45).name).toBe('1 hour');
    expect(nearestEffort(10).name).toBe('30 min');
    expect(nearestEffort(150).name).toBe('2 hours');
    expect(nearestEffort(600).name).toBe('8+ hours');
  });
});

describe('due', () => {
  const now = new Date(2026, 10, 11);
  // @req FR:task-detail-design/detail.due
  it('says Due, or No due date', () => {
    expect(dueLabel('🚨 📅 Nov 2: Ship it')).toBe('Due Nov 2');
    expect(dueLabel('Ship it')).toBe('No due date');
  });
  it('reads the due day as an input value', () => {
    expect(dueValue('📅 Nov 2: Ship it', now)).toBe('2026-11-02');
    expect(dueValue('📅 Feb 1, 2027: Ship it', now)).toBe('2027-02-01');
    expect(dueValue('Ship it', now)).toBe('');
  });
  it('writes 📅 MMM d: at the front, with the year when not this year, and clears it', () => {
    expect(withDue('🚨 Ship it 🟢', '2026-11-20', now)).toBe('🚨 📅 Nov 20: Ship it 🟢'); // after the leading markers
    expect(withDue('🚨 🚧 Ship it', '2026-11-20', now)).toBe('🚨 🚧 📅 Nov 20: Ship it');
    expect(withDue('🏠 Mow the lawn', '2026-11-20', now)).toBe('📅 Nov 20: 🏠 Mow the lawn'); // only priority and status lead
    expect(withDue('📅 Nov 2: Ship it', '2026-11-20', now)).toBe('📅 Nov 20: Ship it');
    expect(withDue('📅 Nov 2: Ship it', '2027-01-05', now)).toBe('📅 Jan 5, 2027: Ship it');
    expect(withDue('🚨 📅 Nov 2: Ship it', null, now)).toBe('🚨 Ship it');
    expect(withDue('🚨 📅 Nov 2: Ship it', '2026-11-20', now)).toBe('🚨 📅 Nov 20: Ship it');
  });
});

describe('names and hints', () => {
  // @req FR:task-detail-design/compose.to
  it('uses the role when the name is only the slug', () => {
    expect(displayName({ slug: 'cos', name: 'CoS', role: 'Chief of Staff' })).toBe('Chief of Staff');
    expect(displayName({ slug: 'xe-cos', name: 'Xe CoS', role: 'Xerilium workspace CoS (solo)' })).toBe('Xe CoS');
    expect(displayName({ slug: 'cos', name: 'cos' })).toBe('cos');
  });
  // @req FR:task-detail-design/compose.mode
  it('explains Ask and Do it with the agent name', () => {
    expect(modeHint('ask', 'Chief of Staff')).toBe('Ask: Chief of Staff answers here; nothing changes on the task.');
    expect(modeHint('do', 'Chief of Staff')).toBe('Do it: Chief of Staff takes the task and starts work; your note goes with it.');
  });
  // @req FR:task-detail-design/detail.actions
  it('has a one-line outcome for each action', () => {
    expect(ACTION_HINT.start).toBe('Start: marks it in progress');
    expect(ACTION_HINT.done).toBe('Done: checks it off; Undo for 8 s');
    expect(ACTION_HINT.defer).toBe('Defer: hides it until a time you pick');
  });
});
