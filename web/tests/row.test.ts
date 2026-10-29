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

// @req FR:web-app/row.clean
describe('parseRow cleanup', () => {
  it('lifts links, outcome, and who out of the title and drops value marks', () => {
    const r = parseRow('📅 Feb 1, 2027: 🔄 Quarterly: File taxes ⚠️⚠️⚠️ 💰 @ https://dor.wa.gov/file-pay-taxes 🔹');
    expect(r.title).toBe('File taxes');
    expect(r.links).toEqual([{ href: 'https://dor.wa.gov/file-pay-taxes', label: 'dor.wa.gov' }]);
    expect(parseRow('🎯 **Korr** 💰 😊😊😊 🟡')).toMatchObject({ outcome: true, title: '**Korr**' });
    expect(parseRow('🤖 Decide launch').who).toBe('agent');
    expect(parseRow('🙋 Answer these').who).toBe('human');
    expect(parseRow('⏰ Jan 7, 2027: 📅 Feb 1, 2027: Prepare').start).toBe('Jan 7, 2027');
  });
  it('keeps markdown links, including ones whose text is a URL; balanced parens stay in a URL', () => {
    const r = parseRow('Read [https://a.test/x](https://a.test/x) now');
    expect(r).toMatchObject({ title: 'Read [https://a.test/x](https://a.test/x) now', links: [] });
    const w = parseRow('See https://en.wikipedia.org/wiki/Foo_(bar) first');
    expect(w).toMatchObject({ title: 'See first', links: [{ href: 'https://en.wikipedia.org/wiki/Foo_(bar)' }] });
    expect(parseRow('(see https://x.test/a)').links[0].href).toBe('https://x.test/a');
    expect(parseRow('See [spec](https://example.test/spec)').links).toEqual([]);
  });
});

describe('saved queries', () => {
  it('drops a trailing GitHub query from the title', () => {
    expect(parseRow('Open PRs @GitHub/x/y (is:open is:pr label:"a b")').title).toBe('Open PRs @GitHub/x/y');
  });
});
