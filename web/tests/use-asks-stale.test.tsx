// @vitest-environment jsdom
/** @req FR:ask-queue/needs.web.stale.group @req FR:ask-queue/needs.web.stale.count @req FR:ask-queue/needs.web.stale.open */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '../src/api';
import type { AskItem } from '../src/asks';
import { useAsks, type Asks } from '../src/useAsks';

const ask = (key: string): AskItem => ({ key, kind: 'approve', ask: key, from: 'cos', state: 'open', reversible: true, priority: 'high', blocks: 0, created: '', updated: '', score: 1000, overdue: true } as AskItem);
const api = { asks: async () => ({ items: [], total: 0 }), sync: async () => ({}) } as unknown as Client;

let root: HTMLElement;
let last: Asks;
function Probe(p: { tasks: AskItem[]; stale: AskItem[] }) {
  last = useAsks(api, () => undefined, () => undefined, null, undefined, { tasks: p.tasks, stale: p.stale });
  return null;
}

describe('useAsks stale group', () => {
  beforeEach(() => { root = document.createElement('div'); document.body.append(root); });
  afterEach(() => { render(null, root); root.remove(); });

  it('stale items stay out of items and the count, open or not; the keys reach them only while open', async () => {
    const tasks = [ask('need:fresh')];
    const stale = [ask('need:old1'), ask('need:old2')];
    await act(() => { render(<Probe tasks={tasks} stale={stale} />, root); });
    await act(async () => { await new Promise((r) => setTimeout(r, 0)); });
    expect(last.items.map((a) => a.key)).toEqual(['need:fresh']);
    expect(last.total).toBe(1);
    expect(last.stale.map((a) => a.key)).toEqual(['need:old1', 'need:old2']);
    expect(last.itemsRef.current.map((a) => a.key)).toEqual(['need:fresh']);
    await act(() => { last.setStaleOpen(true); });
    expect(last.items.map((a) => a.key)).toEqual(['need:fresh']);
    expect(last.total).toBe(1);
    expect(last.itemsRef.current.map((a) => a.key)).toEqual(['need:fresh', 'need:old1', 'need:old2']);
  });
});
