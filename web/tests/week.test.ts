/** @req FR:web-app/week.days @req FR:web-app/week.plan @req FR:web-app/week.summary @req FR:web-app/week.bars */
import { describe, expect, it } from 'vitest';
import { planWeek, weekDates } from '../src/week';
import type { Task } from '../src/types';

let n = 0;
const t = (text: string): Task => ({ ref: `a:${++n}`, text, project: 'a', section: '🔄 Active', done: false, depth: 0, notes: [] });
const wed = new Date(2026, 9, 28, 10, 0); // Wednesday 10:00

describe('week dates', () => {
  it('runs today through Sunday, or through next Friday on a weekend', () => {
    expect(weekDates(wed).map((d) => d.getDate())).toEqual([28, 29, 30, 31, 1]);
    expect(weekDates(new Date(2026, 9, 31)).map((d) => d.getDay())).toEqual([6, 0, 1, 2, 3, 4, 5]);
    expect(weekDates(new Date(2026, 10, 1)).map((d) => d.getDay())).toEqual([0, 1, 2, 3, 4, 5]);
  });
});

describe('planWeek', () => {
  it('gives work days 9 h, weekends 0, and today the time left or the budget', () => {
    const w = planWeek([], wed);
    expect(w.days.map((d) => d.available)).toEqual([480, 540, 540, 0, 0]);
    expect(planWeek([], wed, 120).days[0].available).toBe(120);
  });
  it('puts due tasks on their day and overdue on today', () => {
    const w = planWeek([t('📅 Oct 30: Due Friday 🟡'), t('📅 Oct 20: Late 🟢')], wed);
    expect(w.days[2].planned).toBe(60);
    expect(w.days[0].planned).toBe(30);
  });
  it('fills the rest in rank order, 2 h of a task per day, and reports what will not fit', () => {
    const w = planWeek([t('Big ⚫️'), t('Small 🟢')], wed, 60);
    expect(w.days.map((d) => d.planned)).toEqual([60, 150, 120, 0, 0]);
    expect(w.leftover).toBe(180);
    const full = planWeek(Array.from({ length: 12 }, () => t('Block 🔴')), wed);
    expect(full.leftover).toBeGreaterThan(0);
    expect(full.planned).toBeLessThanOrEqual(full.available);
  });
  it('puts long-overdue tasks on today too', () => {
    expect(planWeek([t('📅 Jun 1, 2026: Stale 🟢')], wed).days[0].planned).toBe(30);
  });
  it('marks today and over days for the bars', () => {
    const w = planWeek([t('📅 Oct 29: A ⚫️'), t('📅 Oct 29: B 🔴')], wed);
    expect(w.days.filter((d) => d.today)).toHaveLength(1);
    expect(w.days.map((d) => d.over > 0)).toEqual([false, true, false, false, false]);
  });
  it('shows a due-day overload as over', () => {
    const w = planWeek([t('📅 Oct 29: A ⚫️'), t('📅 Oct 29: B 🔴')], wed);
    expect(w.days[1].over).toBe(480 + 240 - 540);
  });
});
