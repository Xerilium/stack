/** @req FR:web-app/today.capacity */
import { describe, expect, it } from 'vitest';
import { budgetOf, clampBudget, loadBudget, saveBudget, STEP } from '../src/day';
import { DEFAULT_DAY } from '../src/plan';

const at = (h: number, m = 0, d = 28) => new Date(2026, 9, d, h, m);
const mem = () => { const m = new Map<string, string>(); return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }; };

describe('available time', () => {
  it('defaults to what is left of the work day from the plan start', () => {
    expect(budgetOf(at(13, 5), DEFAULT_DAY, null)).toEqual({ minutes: 285, isDefault: true });
    expect(budgetOf(at(7), DEFAULT_DAY, null)).toEqual({ minutes: 540, isDefault: true });
    expect(budgetOf(at(19), DEFAULT_DAY, null)).toEqual({ minutes: 0, isDefault: true });
    expect(budgetOf(at(13), DEFAULT_DAY, 120)).toEqual({ minutes: 120, isDefault: false });
  });
  it('steps by 30 min within 0-16h', () => {
    expect(STEP).toBe(30);
    expect(clampBudget(-30)).toBe(0);
    expect(clampBudget(17 * 60)).toBe(16 * 60);
    expect(clampBudget(95)).toBe(95);
    expect(clampBudget(285 + STEP)).toBe(315); // odd default steps by 30
  });
  it('keeps the value for today only, and survives broken storage', () => {
    const s = mem();
    saveBudget(s, at(9), 180);
    expect(loadBudget(s, at(15))).toBe(180);
    expect(loadBudget(s, at(9, 0, 29))).toBeNull();
    saveBudget(s, at(9), null);
    expect(loadBudget(s, at(10))).toBeNull();
    const broken = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
    expect(loadBudget(broken, at(9))).toBeNull();
    expect(() => saveBudget(broken, at(9), 60)).not.toThrow();
    s.m.set('stack.available', '{bad json');
    expect(loadBudget(s, at(9))).toBeNull();
  });
});
