/** @req FR:agent-sessions/web.view @req FR:agent-sessions/web.drawer @req FR:agent-sessions/web.cost @req FR:agent-sessions/web.message */
import { describe, expect, it } from 'vitest';
import { applyUpdate, barWidths, costStrip, dayLabel, fmtTokens, fmtUsd, groupTurns, localDay, rowOf, slugBranch, STATE_LABEL, type SessionItem, type Transcript } from '../src/sessions';

const now = new Date(2026, 9, 29, 10);
const s = (o: Partial<SessionItem> = {}): SessionItem => ({ id: 'a1b2c3d4-0000-0000-0000-000000000001', title: 'stack: web app', project: 'stack', cwd: '/x/stack', branch: 'main', lastActive: new Date(now.getTime() - 12 * 60_000).toISOString(), state: 'idle', cost: { usd: 0.5607, tokens: 1_670_596 }, prs: [], ...o });

describe('formatting', () => {
  it('money and tokens read at a glance', () => {
    expect([fmtUsd(0), fmtUsd(0.004), fmtUsd(0.5607), fmtUsd(4.1), fmtUsd(31.25), fmtUsd(1234.5)]).toEqual(['$0', '<$0.01', '$0.56', '$4.10', '$31', '$1,235']);
    expect([fmtTokens(0), fmtTokens(950), fmtTokens(1200), fmtTokens(410_000), fmtTokens(1_670_596), fmtTokens(12_300_000), fmtTokens(6_777_000_000)]).toEqual(['0', '950', '1.2k', '410k', '1.7M', '12M', '6.8B']);
  });
  it('rowOf: state label, project · branch, last active, cost', () => {
    expect(rowOf(s(), now)).toEqual({ label: 'Idle', where: 'stack · main', when: '12 min ago', cost: '$0.56' });
    expect(rowOf(s({ state: 'needs-you', branch: undefined }), now).label).toBe('Needs you');
    expect(rowOf(s({ state: 'needs-you', branch: undefined }), now).where).toBe('stack');
    expect(rowOf(s({ cost: { usd: 2, tokens: 1, approx: true } }), now).cost).toBe('≈$2.00');
    expect(rowOf(s({ branch: 'xe/zany-fox-1a2b3c' }), now).where).toBe('stack');
    expect(slugBranch('xe/fix-parser')).toBe(false);
    expect(localDay(new Date(2026, 9, 28, 23, 47))).toBe('2026-10-28');
    expect(STATE_LABEL).toEqual({ 'needs-you': 'Needs you', running: 'Running', active: 'Active', idle: 'Idle', stale: 'Stale' });
  });
  it('dayLabel names the day', () => {
    expect(dayLabel('2026-10-27')).toBe('Tue 27');
    expect(dayLabel('2026-10-29')).toBe('Thu 29');
  });
});

describe('cost strip and bars', () => {
  const report = { attribution: 'lastActive' as const, days: [{ date: '2026-10-28', usd: 3.2, tokens: 410_000, sessions: 4 }, { date: '2026-10-29', usd: 4.1, tokens: 1_200_000, sessions: 6 }], projects: [{ project: 'allyte', usd: 14.2, tokens: 5_000_000, sessions: 3 }], models: [{ model: 'claude-sonnet-5-5', usd: 7.3, tokens: 6_000_000 }], total: { usd: 31, tokens: 7_000_000, sessions: 10 } };
  it('costStrip: today then the window', () => {
    expect(costStrip(report, '2026-10-29')).toEqual({ today: 'Today $4.10 · 1.2M tokens · 6 sessions', window: '2 days $31' });
    expect(costStrip({ ...report, days: [] }, '2026-10-29')).toEqual({ today: 'Today $0 · 0 tokens · 0 sessions', window: '0 days $31' });
    expect(costStrip({ ...report, indexing: 12 }, '2026-10-29')).toEqual({ today: 'Today ≈$4.10 · 1.2M tokens · 6 sessions', window: '2 days ≈$31 · indexing 12' });
  });
  it('barWidths scale to the busiest day', () => {
    expect(barWidths(report.days)).toEqual([78, 100]);
    expect(barWidths([])).toEqual([]);
    expect(barWidths([{ date: 'x', usd: 0, tokens: 0, sessions: 0 }])).toEqual([0]);
  });
});

describe('applyUpdate builds the transcript from the stream', () => {
  const empty = (): Transcript => ({ lines: [], tools: new Map(), waiting: null, done: null });
  it('chunks append to one assistant line; a new user line starts a new assistant line', () => {
    let t = empty();
    t = applyUpdate(t, { type: 'message_chunk', role: 'assistant', text: 'On ' });
    t = applyUpdate(t, { type: 'message_chunk', role: 'assistant', text: 'it.' });
    expect(t.lines).toEqual([{ kind: 'text', role: 'assistant', text: 'On it.' }]);
    t = applyUpdate(t, { type: 'message_chunk', role: 'user', text: 'Hold' });
    t = applyUpdate(t, { type: 'message_chunk', role: 'assistant', text: 'Ok' });
    expect(t.lines.map((l) => (l.kind === 'text' ? l.text : l.kind))).toEqual(['On it.', 'Hold', 'Ok']);
  });
  it('tool calls get one line each; updates change the status in place', () => {
    let t = empty();
    t = applyUpdate(t, { type: 'tool_call', callId: 'tu1', title: 'Bash: git status', kind: 'execute', status: 'pending' });
    t = applyUpdate(t, { type: 'tool_update', callId: 'tu1', status: 'completed', output: 'M x.ts' });
    expect(t.lines).toEqual([{ kind: 'tool', callId: 'tu1', title: 'Bash: git status', toolKind: 'execute', status: 'completed', output: 'M x.ts' }]);
    t = applyUpdate(t, { type: 'tool_update', callId: 'zzz', status: 'failed' });
    expect(t.lines).toHaveLength(1);
  });
  it('permission sets waiting with the title; the next tool update clears it; done records the result', () => {
    let t = empty();
    t = applyUpdate(t, { type: 'tool_call', callId: 'tu1', title: 'Bash: git push', kind: 'execute', status: 'pending' });
    t = applyUpdate(t, { type: 'permission', requestId: 'r1', callId: 'tu1', title: 'Allow Bash: git push', options: [] });
    expect(t.waiting).toEqual({ callId: 'tu1', title: 'Allow Bash: git push' });
    t = applyUpdate(t, { type: 'tool_update', callId: 'tu1', status: 'failed' });
    expect(t.waiting).toBeNull();
    t = applyUpdate(t, { type: 'done', stopReason: 'end_turn', cost: { usd: 0.12, tokens: 300 }, turns: 3, durationMs: 900 });
    expect(t.done).toEqual({ text: 'Done · $0.12 · 3 turns', error: false });
    expect(applyUpdate(empty(), { type: 'done', stopReason: 'cancelled', cost: { usd: 0, tokens: 0 }, turns: 0, durationMs: 0 }).done).toEqual({ text: 'Stopped', error: false });
    expect(applyUpdate(empty(), { type: 'done', stopReason: 'error', cost: { usd: 0, tokens: 0 }, turns: 0, durationMs: 0, error: 'boom' }).done).toEqual({ text: 'Failed: boom', error: true });
    expect(applyUpdate(empty(), { type: 'done', stopReason: 'max_budget', cost: { usd: 2, tokens: 0 }, turns: 0, durationMs: 0 }).done).toEqual({ text: 'Stopped at the budget · $2.00', error: true });
  });
  it('a session update is ignored by the transcript', () => {
    expect(applyUpdate(empty(), { type: 'session', sessionId: 'x' })).toEqual(empty());
  });
});

describe('groupTurns folds tool runs', () => {
  it('keeps text, folds consecutive tool lines into a count with a per-tool summary', () => {
    const at = '2026-10-29T10:00:00Z';
    const g = groupTurns([{ at, role: 'user', text: 'Go' }, { at, role: 'assistant', text: '⚙ Bash: ls' }, { at, role: 'assistant', text: '⚙ Bash: cat x' }, { at, role: 'assistant', text: '⚙ Edit: x.ts' }, { at, role: 'assistant', text: 'Done.' }, { at, role: 'assistant', text: '⚙ mcp__Claude_Browser__navigate: x' }]);
    expect(g).toEqual([
      { kind: 'text', role: 'user', text: 'Go' },
      { kind: 'tools', count: 3, titles: ['⚙ Bash: ls', '⚙ Bash: cat x', '⚙ Edit: x.ts'], summary: 'Bash ×2, Edit' },
      { kind: 'text', role: 'assistant', text: 'Done.' },
      { kind: 'tools', count: 1, titles: ['⚙ mcp__Claude_Browser__navigate: x'], summary: 'navigate' },
    ]);
  });
});
