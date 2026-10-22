import { describe, expect, it } from 'vitest';
import { effortMinutes, parseRow, PRIORITY } from '../src/row';

// @req FR:web-app/row.parse
describe('parseRow', () => {
  it('extracts markers and cleans the title', () => {
    const r = parseRow('🚧 ‼️ 📅 Oct 22: Write the report 🟡 ⬆️');
    expect(r).toMatchObject({ status: '🚧', priority: '‼️', effort: '🟡', impact: '⬆️', due: 'Oct 22', title: 'Write the report' });
  });
  it('reads recurrence, suspend, and start markers', () => {
    const r = parseRow('📅 Monday: 🔄 Weekly: Review inbox 🟢');
    expect(r).toMatchObject({ due: 'Monday', recurrence: 'Weekly', title: 'Review inbox', effort: '🟢' });
    expect(parseRow('💤 Oct 23 10:00: Call back').suspend).toBe('Oct 23 10:00');
    expect(parseRow('⏰ Nov 2: Later').start).toBe('Nov 2');
  });
  it('matches emoji with or without variation selectors', () => {
    expect(parseRow('⏸ Hold').status).toBe('⏸️');
    expect(parseRow('⏸️ Hold').title).toBe('Hold');
    expect(parseRow('⬆ Up').impact).toBe('⬆️');
  });
  it('keeps unknown text and empty rows safe', () => {
    expect(parseRow('Plain 🎉 text').title).toBe('Plain 🎉 text');
    expect(parseRow('')).toMatchObject({ title: '' });
    expect(parseRow('  spaced   out  ').title).toBe('spaced out');
  });
  it('exposes picker values', () => {
    expect(PRIORITY.map((p) => p.e)).toEqual(['🚨', '‼️', '🔺', '🔻']);
  });
});

// @req FR:web-app/row.effort
describe('effortMinutes', () => {
  it('maps emoji to minutes', () => {
    expect(['🔹', '🟢', '🟡', '🟠', '🔴', '⚫️'].map(effortMinutes)).toEqual([12, 30, 60, 120, 240, 480]);
    expect(effortMinutes(undefined)).toBe(0);
  });
});
