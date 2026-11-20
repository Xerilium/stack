// @vitest-environment jsdom
/** The Asks page for ask routing (`.xe/features/ask-routing/spec.md`, `FR:ui`). */
import { readFileSync } from 'node:fs';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import type { Client } from '../src/api';
import { actionsFor, agentOf, deliveryChip, liveSessions, questionBody, questionKey, rowActions, type AskItem } from '../src/asks';
import { AsksView } from '../src/AsksView';
import type { Inventory } from '../src/inventory';
import { useAsks } from '../src/useAsks';

const NOW = new Date('2026-11-19T14:00:00Z');
const LINK = '[Stack architect](#local_arch-1)';
const base = { kind: 'approve', from: 'allyte-cos', reversible: false, priority: 'normal', blocks: 0, created: '2026-11-19T10:00:00Z', updated: '2026-11-19T10:00:00Z', score: 30, overdue: false } as const;
const ask = (o: Partial<AskItem>): AskItem => ({ key: 'a', state: 'open', ask: 'Approve merging PR 879', ...base, ...o } as AskItem);
const minsAgo = (m: number) => new Date(Date.now() - m * 60_000).toISOString();

describe('helpers', () => {
  // @req FR:ask-routing/ui.waiting
  it('delivery chip: delivered ok with time ago, not delivered bad with the reason, else sending', () => {
    expect(deliveryChip({ delivered: '2026-11-19T13:55:00Z' }, NOW)).toEqual({ label: 'Delivered 5 min ago', tone: 'ok' });
    expect(deliveryChip({ undelivered: 'Session gone' }, NOW)).toEqual({ label: 'Not delivered: Session gone', tone: 'bad' });
    expect(deliveryChip({}, NOW)).toEqual({ label: 'Sending…', tone: 'neutral' });
  });
  // @req FR:ask-routing/ui.mine
  it('agent name: the link name, else who sent it', () => {
    expect(agentOf({ from: 'owner', agent: LINK })).toBe('Stack architect');
    expect(agentOf({ from: 'session:Fix the build' })).toBe('Fix the build');
    expect(agentOf({ from: 'owner' })).toBe('the agent');
  });
  // @req FR:ask-routing/ui.ask
  it('question key and body: q-<yyyymmdd>-<4 hex>, from owner, kind answer, the session as a link', () => {
    expect(questionKey(new Date(2026, 10, 9, 23, 0), () => 0xbeef)).toBe('q-20261109-beef');
    expect(questionKey(new Date(2026, 10, 9), () => 0x2)).toBe('q-20261109-0002');
    expect(questionBody({ id: 'local_x-1', title: 'Fix [the] build (v2)' }, ' What blocks it? ')).toEqual({ ask: 'What blocks it?', from: 'owner', kind: 'answer', agent: '[Fix the build v2](#local_x-1)' });
  });
  // @req FR:ask-routing/ui.ask
  it('live sessions: not done, not archived, newest first, by title', () => {
    const s = (id: string, state: string, at: string, title = id) => ({ id, title, state, lastActivityAt: at }) as Inventory['sessions'][number];
    const inv = { sessions: [s('local_a', 'idle', '2026-11-19T10:00:00Z', 'Alpha'), s('local_b', 'running', '2026-11-19T12:00:00Z', 'Beta'), s('local_c', 'done', '2026-11-19T13:00:00Z'), s('local_d', 'waiting', '2026-11-19T11:00:00Z', 'Delta'), s('local_e', 'idle', '2026-11-19T13:30:00Z')], archive: [s('local_e', 'idle', '2026-11-19T13:30:00Z')] } as unknown as Inventory;
    expect(liveSessions(inv)).toEqual([{ id: 'local_b', title: 'Beta' }, { id: 'local_d', title: 'Delta' }, { id: 'local_a', title: 'Alpha' }]);
  });
  // @req FR:ask-routing/ui.reply
  it('an answered owner question offers Done and Reply only', () => {
    const q = ask({ key: 'q1', from: 'owner', kind: 'answer', state: 'answered', agent: LINK });
    expect(actionsFor(q).map((x) => [x.label, !!x.send, !!x.reply])).toEqual([['Reply', false, true], ['Done', true, false]]);
    expect(actionsFor(q)[1].send).toEqual({ answer: 'done' });
    expect(rowActions(q).map((x) => x.label)).toEqual(['Reply', 'Done', 'Defer']);
  });
});

// ---- the page

const q1 = ask({
  key: 'q1', from: 'owner', kind: 'answer', state: 'answered', ask: 'What blocks PR 316?', agent: LINK, turn: 'owner', answer: 'reply', text: 'Blocked on CI: lint', score: 90, rank: 1,
  thread: [0, 1, 2, 3, 4, 5].map((i) => ({ at: `2026-11-19T13:0${i}:00Z`, who: i === 1 ? 'stack' : i % 2 ? 'you' : 'Stack architect', text: `t${i}` })),
});
const a1 = ask({ key: 'a1', turn: 'owner', rank: 2 });
const q2 = ask({ key: 'q2', from: 'owner', kind: 'answer', ask: 'Status of the deploy?', agent: '[Deploy bot](#local_dep-1)', turn: 'agent', delivered: minsAgo(5) });
const q3 = ask({ key: 'q3', from: 'owner', kind: 'answer', ask: 'Any news?', agent: '[Gone bot](#local_gone-1)', turn: 'agent', undelivered: 'Session gone' });
const a2 = ask({ key: 'a2', state: 'answered', answer: 'go', turn: 'agent', agent: '[Allyte CoS](#local_cos-1)' });

function fake() {
  const calls: unknown[][] = [];
  const inv = { at: '', total: 2, counts: {}, needsYou: [], archive: [], sessions: [
    { id: 'local_old', title: 'Old one', state: 'idle', lastActivityAt: '2026-11-19T09:00:00Z' },
    { id: 'local_new', title: 'New one', state: 'waiting', lastActivityAt: '2026-11-19T12:00:00Z' },
  ] };
  const api = {
    asks: async () => ({ items: [], total: 0 }),
    asksTurn: async (turn: string) => (turn === 'owner' ? { items: [q1, a1], total: 2 } : { items: [q2, q3, a2], total: 3 }),
    answerAsk: async (key: string, body: unknown) => { calls.push(['answer', key, body]); return { changed: true }; },
    putAsk: async (key: string, body: unknown) => { calls.push(['put', key, body]); return { key, created: true }; },
    inventory: async () => inv,
    sync: async () => null,
  } as unknown as Client;
  return { api, calls };
}
function Page({ api }: { api: Client }) {
  const asks = useAsks(api, () => undefined, () => undefined, null);
  return <AsksView asks={asks} />;
}
const flush = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); });
async function mount() {
  const f = fake();
  const root = document.createElement('div'); document.body.append(root);
  await act(() => { render(<Page api={f.api} />, root); });
  await flush();
  return { r: root, ...f };
}
afterEach(() => { document.body.innerHTML = ''; });
const click = async (el: Element) => { await act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); }); await flush(); };
const button = (r: Element, name: string) => [...r.querySelectorAll('button')].find((b) => b.textContent!.replace(/[⏎a-z]$/, '').trim() === name || b.textContent === name);
const type = (el: HTMLTextAreaElement | HTMLInputElement, v: string) => act(() => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); });
const submit = async (f: HTMLFormElement) => { await act(async () => { f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); }); await flush(); };

describe('Asks page', () => {
  // @req FR:ask-routing/ui.mine
  it('lists only his turns; an answered owner question says who replied and what', async () => {
    const { r } = await mount();
    const main = r.querySelector('ol.asks')!;
    expect([...main.querySelectorAll(':scope > li')].map((li) => li.getAttribute('data-key'))).toEqual(['q1', 'a1']);
    const card = main.querySelector('[data-key=q1]')!;
    expect(card.querySelector('.ask-reply')!.textContent).toBe('Stack architect replied: Blocked on CI: lint');
    expect(r.querySelector('h1 .count')!.textContent).toBe('2');
  });

  // @req FR:ask-routing/ui.waiting
  it('waiting asks sit in a collapsed group: agent name and one delivery chip each, no actions', async () => {
    const { r } = await mount();
    const head = button(r, 'Waiting on agents (3)')!;
    expect(head.getAttribute('aria-expanded')).toBe('false');
    expect(r.querySelector('[data-testid=waiting] .ui-card')).toBeNull();
    await click(head);
    const cards = [...r.querySelectorAll('[data-testid=waiting] .ui-card')];
    expect(cards.map((c) => [c.querySelector('.ask-agent')!.textContent, [...c.querySelectorAll('.ui-chip')].map((x) => [x.textContent, x.className])])).toEqual([
      ['Deploy bot', [['Delivered 5 min ago', 'ui-chip t-ok']]],
      ['Gone bot', [['Not delivered: Session gone', 'ui-chip t-bad']]],
      ['Allyte CoS', [['Sending…', 'ui-chip t-neutral']]],
    ]);
    expect(cards.flatMap((c) => [...c.querySelectorAll('button')]).every((b) => b.classList.contains('ui-card-open'))).toBe(true);
  });

  // @req FR:ask-routing/ui.thread
  it('the card shows the newest 5 thread lines with Show all; stack lines are muted', async () => {
    const { r } = await mount();
    const card = r.querySelector('[data-key=q1]')!;
    const lines = () => [...card.querySelectorAll('.ui-thread li')];
    expect(lines().map((l) => l.querySelector('.ui-thread-say')!.textContent)).toEqual(['stack: t1', 'you: t2', 'Stack architect: t3', 'you: t4', 'Stack architect: t5']);
    expect(lines()[0].classList.contains('muted')).toBe(true);
    await click(button(card, 'Show all')!);
    expect(lines()).toHaveLength(6);
  });

  // @req FR:ask-routing/ui.reply
  it('Done closes it; Reply opens an editable box that sends only on Send to <Agent>', async () => {
    const { r, calls } = await mount();
    const card = () => r.querySelector('[data-key=q1]')!;
    expect(card().querySelector('.ask-reply-box')).toBeNull();
    await click(button(card(), 'Reply')!);
    const box = card().querySelector<HTMLInputElement>('.ask-reply-box input')!;
    type(box, 'Which check');
    type(box, 'Which check?');
    expect(calls).toEqual([]);
    expect(button(card(), 'Send to Stack architect')).toBeTruthy();
    await submit(card().querySelector('form')!);
    expect(calls).toEqual([['answer', 'q1', { answer: 'ask', text: 'Which check?' }]]);
  });
  // @req FR:ask-routing/ui.reply
  it('Done sends done', async () => {
    const { r, calls } = await mount();
    await click(button(r.querySelector('[data-key=q1]')!, 'Done')!);
    expect(calls).toEqual([['answer', 'q1', { answer: 'done' }]]);
  });

  // @req FR:ask-routing/ui.ask
  it('Ask an agent: pick a live session (newest first), write the question, send only on Send to <Agent>', async () => {
    const { r, calls } = await mount();
    await click(button(r, 'Ask an agent')!);
    const form = r.querySelector('[data-testid=ask-agent]')!;
    const pick = form.querySelector('select')!;
    expect([...pick.options].map((o) => o.textContent)).toEqual(['New one', 'Old one']);
    type(form.querySelector('textarea')!, 'What blocks PR 316?');
    expect(calls).toEqual([]);
    expect(button(form, 'Send to New one')).toBeTruthy();
    await submit(form.querySelector('form')!);
    expect(calls).toHaveLength(1);
    const [, key, body] = calls[0] as [string, string, unknown];
    expect(key).toMatch(/^q-\d{8}-[0-9a-f]{4}$/);
    expect(body).toEqual({ ask: 'What blocks PR 316?', from: 'owner', kind: 'answer', agent: '[New one](#local_new)' });
  });

  // @req FR:ask-routing/ui.kit
  it('builds on ui-kit components only', () => {
    const src = readFileSync(new URL('../src/AsksView.tsx', import.meta.url), 'utf8');
    for (const c of ['SelectCard', 'StatusChip', 'ThreadLines', 'CollapseGroup', 'PickMessageBox']) expect(src, c).toContain(`from './ui/${c}'`);
  });
});
