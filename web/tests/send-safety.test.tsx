// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { AgentTalk } from '../src/AgentTalk';
import { PrioritiesTables } from '../src/PrioritiesTables';
import type { PrioritiesView, PriRow } from '../src/priorities';
import type { Team } from '../src/useTeam';

const mount = (node: preact.ComponentChild) => { const root = document.createElement('div'); document.body.append(root); act(() => render(node, root)); return root; };
afterEach(() => { document.body.innerHTML = ''; });
const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
const AT = '2026-11-18T19:00:00Z';

describe('gap rows on the priorities report', () => {
  const cos = { name: 'AM (Roland)', link: 'claude://claude.ai/epitaxy/cos', file: null, session: '22222222-2222-4222-8222-222222222222' };
  const gap: PriRow = { id: 'am', project: 'AM', file: 'tasks/am.md', agent: null, more: 0, status: null, action: 'AM (Roland) will add a task today: 1️⃣/2️⃣/3️⃣ in tasks/am.md with (agent: ...)', gap: true, cos, ref: null, at: AT, stale: false };
  const table = (rows: PriRow[]) => ({ at: AT, stale: false, rows });
  const view: PrioritiesView = { at: AT, qm: null, now: table([gap]), prs: { at: AT, stale: false, verified: true, manager: null, rows: [] }, today: table([]), next: table([]) };

  // @req FR:priorities-tables/web.gap @req FR:priorities-tables/gaps.silent @req FR:ui-kit/send.box
  it('a gap detail says the CoS will add a task, with no text box, no send button and no send', () => {
    const sent: string[][] = [];
    const r = mount(<PrioritiesTables v={view} send={async (s, t) => { sent.push([s, t]); }} />);
    click(r.querySelector('.pri-card button')!);
    const d = r.querySelector('[data-testid=pri-detail]')!;
    expect(d.textContent).toContain(gap.action);
    expect(d.querySelector('.pri-gap-note')?.textContent).toBe('AM (Roland) will add a task. No action for you.');
    expect([d.querySelectorAll('textarea, input, form').length, d.querySelectorAll('button').length, d.textContent!.includes('Ask CoS')]).toEqual([0, 0, false]);
    for (const el of d.querySelectorAll('*')) click(el);
    expect(sent).toEqual([]);
  });
});

describe('ready text in the agent composer', () => {
  const agents = [{ slug: 'cos', name: 'CoS', role: 'Chief of Staff', mode: 'long-running' }] as never;
  const fake = () => {
    const calls: unknown[][] = [];
    const team = { enabled: true, setTalk: () => {}, start: async (...a: unknown[]) => { calls.push(['start', ...a]); return true; }, review: async (...a: unknown[]) => { calls.push(['review', ...a]); } } as unknown as Team;
    return { team, calls };
  };

  // @req FR:ui-kit/send.box.fill @req FR:agent-team/web.talk
  it('Do it and Plan put their text in the box and send nothing; Send then sends what the box shows', async () => {
    const { team, calls } = fake();
    const r = mount(<AgentTalk team={team} talk={{ ref: 'stack:4', project: 'stack', about: 'Ship it' }} agents={agents} />);
    const box = r.querySelector<HTMLInputElement>('input[type=text]')!;
    const btn = (name: string) => [...r.querySelectorAll('button')].find((b) => b.textContent!.replace('⏎', '') === name)!;
    click(btn('Plan'));
    expect([box.value, calls]).toEqual(['Plan this task in steps with a rough estimate each; do not start it.', []]);
    click(btn('Do it'));
    expect(box.value).toMatch(/^Do this task\./);
    expect(calls).toEqual([]);
    act(() => { box.value = 'Do it my way'; box.dispatchEvent(new Event('input', { bubbles: true })); });
    await act(async () => { r.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve(); });
    expect(calls).toEqual([['start', expect.objectContaining({ ref: 'stack:4' }), 'cos', 'Do it my way', true]]);
  });

  // @req FR:ui-kit/send.decision @req FR:agent-team/web.review
  it('the review button names its effect', () => {
    const { team } = fake();
    const r = mount(<AgentTalk team={team} talk={{ ref: 'stack:4', project: 'stack', about: 'Ship it' }} agents={agents} />);
    expect([...r.querySelectorAll('.quick button')].map((b) => b.textContent)).toEqual(['Start review', 'Do it', 'Plan']);
  });
});
