// @req FR:now-screen/now.one @req FR:now-screen/now.why @req FR:now-screen/now.empty
import { describe, expect, it } from 'vitest';
import { homeOf, type RankItem } from '../src/home';
import { foldLines, nowOf, tellThread, TELL_MAX, whyLine, WHY_MAX } from '../src/nowscreen';
import type { ThreadItem } from '../src/thread';
import type { Project, Task } from '../src/types';

const at = new Date(2026, 9, 29, 15, 0);
const T = (ref: string, text: string, project = 'alpha'): Task => ({ ref, text, project, section: '🔄 Active', depth: 0, done: false, notes: [] });
const P = (name: string): Project => ({ name, title: name, open: 1, done: 0, metadata: {} });
const R = (ref: string, project = 'alpha'): RankItem => ({ ref, text: ref, project, score: 1 });
const home = (tasks: Task[], ranked: RankItem[], minutesLeft = 120) => homeOf({ tasks, projects: [P('alpha'), P('beta')], ranked, now: at, minutesLeft });

describe('nowOf', () => {
  const tasks = [T('alpha:1', '‼️ 📅 Oct 27: Ship the web app 🟠'), T('alpha:2', 'Write docs 🟢'), T('beta:1', 'Plan the trip 🟡', 'beta')];
  it('is the server\'s first ranked task, the same one Home shows', () => {
    const h = home(tasks, [R('alpha:1'), R('beta:1')]);
    expect(nowOf(h, 120)?.task.ref).toBe('alpha:1');
    expect(nowOf(h, 120)?.task.ref).toBe(h.one?.task.ref);
  });
  it('follows the server order, not the file order', () => expect(nowOf(home(tasks, [R('beta:1', 'beta'), R('alpha:1')]), 120)?.task.ref).toBe('beta:1'));
  it('offers the task that fits when the first does not', () => {
    // alpha:1 needs 2 h; 45 m left; alpha:2 needs 30 m
    expect(nowOf(home(tasks, [R('alpha:1'), R('alpha:2')], 45), 45)?.task.ref).toBe('alpha:2');
  });
  it('is null when nothing is ranked', () => expect(nowOf(home(tasks, []), 120)).toBeNull());
  it("uses the row title without markers", () => expect(nowOf(home(tasks, [R("alpha:1")]), 120)?.title).toBe("Ship the web app"));
});

describe('whyLine', () => {
  const why = (text: string, minutes = 120, agent = false) => {
    const t = T('alpha:1', text);
    return whyLine(homeOf({ tasks: [t], projects: [P('alpha')], ranked: [R('alpha:1')], now: at, minutesLeft: minutes }).one!, minutes, agent);
  };
  it('names lateness first, then priority, then fit', () => expect(why('‼️ 📅 Oct 27: Ship it 🟡')).toBe('2d late · high priority · fits your 2h'));
  it('says due today', () => expect(why('📅 Oct 29: Ship it 🟡')).toBe('due today · fits your 2h'));
  it('uses at most two factors', () => expect(why('🚧 ‼️ 📅 Oct 29: Ship it 🟢')).toBe('due today · high priority · fits your 2h'));
  it('says in progress', () => expect(why('🚧 Ship it 🟢')).toBe('in progress · fits your 2h'));
  it('says the agent has it', () => expect(why('Ship it 🟢', 120, true)).toBe('agent has it · fits your 2h'));
  it('falls back to top of stack', () => expect(why('Ship it 🟢')).toBe('top of your stack · fits your 2h'));
  it('says what is missing when it does not fit', () => expect(why('📅 Oct 29: Ship it 🟠', 45)).toBe('due today · needs 2h, 45m left'));
  it('skips fit when there is no window', () => expect(why('📅 Oct 29: Ship it 🟠', 0)).toBe('due today'));
  it('is at most 60 characters', () => {
    for (const text of ['🚨 🚧 📅 Oct 1: x 🔴', '‼️ 📅 Oct 27: x ⚫️', 'x']) for (const m of [0, 45, 600]) expect(why(text, m, true).length).toBeLessThanOrEqual(WHY_MAX);
  });
});

// @req FR:now-screen/now.tell @req FR:now-screen/now.thread
describe('tell the agent', () => {
  it('folds lines into one inbox line', () => {
    expect(foldLines('  Use the new logo  ')).toBe('Use the new logo');
    expect(foldLines('Step one\r\n\n  step two \nstep three')).toBe('Step one / step two / step three');
    expect(foldLines(' \n ')).toBe('');
    expect(foldLines('x'.repeat(1200)).length).toBe(TELL_MAX);
  });
  it('keeps only instructions and agent replies, oldest first', () => {
    const items: ThreadItem[] = [
      { at: '2026-11-02T10:00:00Z', kind: 'agent', id: 'b', agent: 'cid', text: 'Done' },
      { at: '2026-11-01T10:00:00Z', kind: 'owner', id: 'a', text: 'Do it', state: 'handled' },
      { at: '2026-11-01T11:00:00Z', kind: 'subtask', ref: 'alpha:7', text: 'x', done: false },
    ];
    expect(tellThread(items).map((i) => i.kind === 'owner' || i.kind === 'agent' ? i.id : '')).toEqual(['a', 'b']);
  });
});
