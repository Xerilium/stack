// @vitest-environment jsdom
/** New ui-kit pieces for the Asks page: the thread, a collapsed group, and a message box with a recipient picker. */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { CollapseGroup } from '../src/ui/CollapseGroup';
import { MessageBox } from '../src/ui/MessageBox';
import { PickMessageBox } from '../src/ui/PickMessageBox';
import { ThreadLines } from '../src/ui/ThreadLines';

const mount = (node: preact.ComponentChild) => { const root = document.createElement('div'); document.body.append(root); act(() => render(node, root)); return root; };
afterEach(() => { document.body.innerHTML = ''; });
const click = (el: Element) => act(() => { el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true })); });
const button = (r: HTMLElement, name: string) => [...r.querySelectorAll('button')].find((b) => b.textContent === name);
const type = (el: HTMLTextAreaElement | HTMLInputElement, v: string) => act(() => { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); });
const submit = (f: HTMLFormElement) => act(async () => { f.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve(); });

const line = (i: number, who = 'Stack architect') => ({ at: `2026-11-19T14:0${i}:00Z`, who, text: `line ${i}` });

// @req FR:ask-routing/ui.thread @req FR:ask-routing/ui.kit
describe('ThreadLines', () => {
  it('shows the newest 5 lines oldest first, each as who: text with its time; Show all shows the rest', () => {
    const lines = [0, 1, 2, 3, 4, 5, 6].map((i) => line(i));
    const r = mount(<ThreadLines label="Thread" lines={lines} />);
    const items = () => [...r.querySelectorAll('.ui-thread li')];
    expect(items().map((li) => li.querySelector('.ui-thread-say')!.textContent)).toEqual(['Stack architect: line 2', 'Stack architect: line 3', 'Stack architect: line 4', 'Stack architect: line 5', 'Stack architect: line 6']);
    expect(items()[0].querySelector('time')!.getAttribute('datetime')).toBe('2026-11-19T14:02:00Z');
    click(button(r, 'Show all')!);
    expect(items()).toHaveLength(7);
    expect(items()[0].textContent).toContain('line 0');
  });
  it('mutes the lines the caller marks, and shows no Show all for 5 lines or fewer', () => {
    const r = mount(<ThreadLines label="Thread" lines={[{ ...line(1, 'stack'), muted: true }, line(2)]} />);
    const items = [...r.querySelectorAll('.ui-thread li')];
    expect(items.map((li) => li.classList.contains('muted'))).toEqual([true, false]);
    expect(button(r, 'Show all')).toBeUndefined();
  });
});

// @req FR:ask-routing/ui.waiting @req FR:ask-routing/ui.kit
describe('CollapseGroup', () => {
  it('starts collapsed with its label and count; a click opens it', () => {
    const r = mount(<CollapseGroup label="Waiting on agents" count={2}><ul class="x"><li>a</li></ul></CollapseGroup>);
    const head = r.querySelector<HTMLButtonElement>('.ui-group-head')!;
    expect([head.textContent, head.getAttribute('aria-expanded'), r.querySelector('.x')]).toEqual(['Waiting on agents (2)', 'false', null]);
    click(head);
    expect([head.getAttribute('aria-expanded'), !!r.querySelector('.x')]).toEqual(['true', true]);
  });
});

// @req FR:ask-routing/ui.ask @req FR:ask-routing/ui.kit @req FR:ui-kit/send.box
describe('PickMessageBox', () => {
  const options = [{ id: 'local_b', label: 'Newest' }, { id: 'local_a', label: 'Older' }];
  it('names the button after the pick, keeps the draft when the pick changes, and sends only on submit', async () => {
    const sent: string[][] = [];
    const r = mount(<PickMessageBox heading="Ask an agent" pickLabel="Agent" options={options} empty="No live sessions" onSend={async (id, t) => { sent.push([id, t]); }} />);
    const pick = r.querySelector<HTMLSelectElement>('select')!;
    expect([...pick.options].map((o) => o.textContent)).toEqual(['Newest', 'Older']);
    expect(pick.getAttribute('aria-label')).toBe('Agent');
    const box = r.querySelector('textarea')!;
    type(box, 'What blocks PR 316?');
    expect(button(r, 'Send to Newest')).toBeTruthy();
    act(() => { pick.value = 'local_a'; pick.dispatchEvent(new Event('change', { bubbles: true })); });
    expect([box.value, !!button(r, 'Send to Older'), sent]).toEqual(['What blocks PR 316?', true, []]);
    await submit(r.querySelector('form')!);
    expect(sent).toEqual([['local_a', 'What blocks PR 316?']]);
  });
  it('with no options the box is off and says why', () => {
    const r = mount(<PickMessageBox heading="Ask an agent" pickLabel="Agent" options={[]} empty="No live sessions" onSend={async () => undefined} />);
    expect(r.querySelector('textarea')!.disabled).toBe(true);
    expect(r.textContent).toContain('No live sessions');
  });
});

// @req FR:ask-routing/ui.ask
describe('MessageBox max', () => {
  it('caps the text at max', () => {
    const r = mount(<MessageBox heading="H" to="X" max={200} onSend={async () => undefined} />);
    expect(r.querySelector('textarea')!.maxLength).toBe(200);
  });
});
