/** @req FR:quick-triage/web.stepper @req FR:quick-triage/web.done */
import { describe, expect, it } from 'vitest';
import type { AskItem } from '../src/asks';
import { changeText, flowOf } from '../src/triage';

const ask = (key: string, o: Partial<AskItem> = {}): AskItem => ({ key, state: 'open', ask: key, kind: 'approve', from: 'cos', reversible: true, priority: 'normal', blocks: 0, created: '', updated: '', score: 10, overdue: false, ...o });

describe('flowOf', () => {
  it('describes where the owner is in a flow: step, total, done', () => {
    expect(flowOf(ask('f2', { flow: 'tri', seq: 2, flowTotal: 5, flowDone: 1 }))).toEqual({ flow: 'tri', step: 2, total: 5, done: 1 });
    expect(flowOf(ask('plain'))).toBeNull();
  });
});

describe('changeText', () => {
  it('says what an action did, in words', () => {
    expect(changeText('set priority=🚨', 'Pay bills')).toBe('Priority: Critical · Pay bills');
    expect(changeText('set priority=None', 'Pay bills')).toBe('Priority cleared · Pay bills');
    expect(changeText('due Nov 3', 'Renew')).toBe('Due Nov 3 · Renew');
    expect(changeText('suspend 7d', 'Renew')).toBe('Parked 7 days · Renew');
    expect(changeText('skip', 'Insurer')).toBe('Skipped · Insurer');
    expect(changeText('complete', 'Insurer')).toBe('Done · Insurer');
    expect(changeText('note Draft the denial', 'Insurer')).toBe('Note added · Insurer');
    expect(changeText('-', 'Insurer')).toBe('Answered · Insurer');
  });
});
