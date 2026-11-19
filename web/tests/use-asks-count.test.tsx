// @vitest-environment jsdom
/** @req FR:ask-queue/web.home.count */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Client } from '../src/api';
import type { AskItem } from '../src/asks';
import { useAsks, type Asks } from '../src/useAsks';

const ask = (key: string): AskItem => ({ key, kind: 'approve', title: key, from: 'agent', at: '2026-11-18T10:00:00Z' } as unknown as AskItem);
const fakeApi = (open: AskItem[]) => ({
  asks: async (state: string) => ({ items: state === 'open' ? open : [], total: state === 'open' ? open.length : 0 }),
  sync: async () => ({}),
}) as unknown as Client;

let root: HTMLElement;
let last: Asks;
function Probe(p: { api: Client; tasks: AskItem[]; tasksReady: boolean }) {
  last = useAsks(p.api, () => undefined, () => undefined, null, undefined, { tasks: p.tasks, tasksReady: p.tasksReady });
  return null;
}
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

describe('useAsks count', () => {
  beforeEach(() => { root = document.createElement('div'); document.body.append(root); document.title = 'Stack'; });
  afterEach(() => { render(null, root); root.remove(); });

  // @req FR:ask-queue/web.home.count
  it('server asks loaded, task asks pending: no count, title unchanged', async () => {
    const api = fakeApi([ask('a'), ask('b')]);
    await act(() => { render(<Probe api={api} tasks={[]} tasksReady={false} />, root); });
    await flush();
    expect(last.phase).toBe('ready');
    expect(last.countReady).toBe(false);
    expect(document.title).toBe('Stack');
  });

  // @req FR:ask-queue/web.home.count
  it('both loaded: one value in the count and the title', async () => {
    const api = fakeApi([ask('a'), ask('b')]);
    await act(() => { render(<Probe api={api} tasks={[]} tasksReady={false} />, root); });
    await flush();
    await act(() => { render(<Probe api={api} tasks={[ask('t:1'), ask('t:2'), ask('t:3')]} tasksReady={true} />, root); });
    expect(last.countReady).toBe(true);
    expect(last.total).toBe(5);
    expect(document.title).toBe('(5) Stack');
  });

  // @req FR:ask-queue/web.home.count
  it('after the first complete count, live changes show at once', async () => {
    const api = fakeApi([ask('a')]);
    await act(() => { render(<Probe api={api} tasks={[]} tasksReady={true} />, root); });
    await flush();
    expect(document.title).toBe('(1) Stack');
    // a later reload of the task asks does not hide the count again
    await act(() => { render(<Probe api={api} tasks={[ask('t:1')]} tasksReady={false} />, root); });
    expect(last.countReady).toBe(true);
    expect(document.title).toBe('(2) Stack');
  });
});
