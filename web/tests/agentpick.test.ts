/** @req FR:product-reset/ui.thread @req FR:product-reset/ui.agentchip */
import { describe, expect, it } from 'vitest';
import { pickerList, pickKeyOf, loadPick, savePick, loadRecent, PICK_KEY, RECENT_KEY } from '../src/agentpick';
import type { TeamAgent } from '../src/team';

const ag = (slug: string, name: string, o: Partial<TeamAgent> = {}): TeamAgent => ({ slug, name, scope: [], mode: 'ad-hoc', prompt: '', defined: true, source: 'stack', projects: [], ...o });
const team = [ag('cos', 'CoS', { scope: ['*'], role: 'Chief of Staff' }), ag('zed', 'Zed'), ag('cid-manager', '🎧 Cid Manager', { role: 'label manager' }), ag('away', 'Away', { home: 'other' }), ag('allyte-cos', 'Allyte CoS')];

function mem(): Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v), removeItem: (k) => void data.delete(k) };
}

describe('pickerList', () => {
  it('lists the whole runnable team: recent first, then by name', () => {
    expect(pickerList(team, { recent: ['zed', 'gone'], query: '' }).map((a) => a.slug)).toEqual(['zed', 'allyte-cos', 'cid-manager', 'cos']);
  });
  it('filters by name, slug or role, ignoring case and emoji', () => {
    expect(pickerList(team, { recent: [], query: 'cid' }).map((a) => a.slug)).toEqual(['cid-manager']);
    expect(pickerList(team, { recent: [], query: 'LABEL' }).map((a) => a.slug)).toEqual(['cid-manager']);
    expect(pickerList(team, { recent: [], query: 'cos' }).map((a) => a.slug)).toEqual(['allyte-cos', 'cos']);
    expect(pickerList(team, { recent: [], query: 'nobody' })).toEqual([]);
  });
});

describe('pickKeyOf', () => {
  it('follows the task by project and title, not by line, and ignores marks', () => {
    expect(pickKeyOf({ project: 'f4', text: 'Ship the single 🟡' })).toBe(pickKeyOf({ project: 'f4', text: '🪄 🚧 Ship the single 🟡' }));
    expect(pickKeyOf({ project: 'f4', text: 'Ship' })).not.toBe(pickKeyOf({ project: 'f5', text: 'Ship' }));
    expect(pickKeyOf({ project: 'f4', text: '🙋 Ship' })).toBe('f4␟Ship');
  });
});

describe('the pick per task', () => {
  it('is remembered per task and feeds the recent list', () => {
    const s = mem();
    expect(loadPick(s, 'f4:7')).toBeUndefined();
    savePick(s, 'f4:7', 'zed');
    savePick(s, 'f4:9', 'cos');
    expect(loadPick(s, 'f4:7')).toBe('zed');
    expect(loadPick(s, 'f4:9')).toBe('cos');
    expect(loadRecent(s)).toEqual(['cos', 'zed']);
    savePick(s, 'f4:7', 'zed');
    expect(loadRecent(s)).toEqual(['zed', 'cos']);
  });
  it('clears with no agent, survives bad or missing storage', () => {
    const s = mem();
    savePick(s, 'f4:7', 'zed');
    savePick(s, 'f4:7', undefined);
    expect(loadPick(s, 'f4:7')).toBeUndefined();
    s.data.set(PICK_KEY, '{bad'); s.data.set(RECENT_KEY, '7');
    expect(loadPick(s, 'f4:7')).toBeUndefined();
    expect(loadRecent(s)).toEqual([]);
    expect(loadPick(undefined, 'x')).toBeUndefined();
    const boom = { getItem: () => { throw new Error('no'); }, setItem: () => { throw new Error('no'); }, removeItem: () => undefined };
    expect(() => savePick(boom, 'x', 'y')).not.toThrow();
  });
  it('keeps at most 200 tasks and 8 recent agents', () => {
    const s = mem();
    for (let i = 0; i < 210; i++) savePick(s, `p:${i}`, `a${i % 12}`);
    expect(Object.keys(JSON.parse(s.data.get(PICK_KEY)!))).toHaveLength(200);
    expect(loadPick(s, 'p:0')).toBeUndefined();
    expect(loadPick(s, 'p:209')).toBe('a5');
    expect(loadRecent(s)).toHaveLength(8);
  });
});
