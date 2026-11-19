// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { Composer } from '../src/Composer';
import type { TeamAgent } from '../src/team';

const AGENTS = [{ slug: 'cos', name: 'CoS', role: 'Chief of Staff' }] as TeamAgent[];
afterEach(() => { document.body.innerHTML = ''; });

function mount() {
  const root = document.createElement('div'); document.body.append(root);
  const sent: string[] = [];
  let done: (ok: boolean) => void = () => undefined;
  const onAsk = (text: string) => { sent.push(text); return new Promise<boolean>((r) => { done = r; }); };
  act(() => render(<Composer agents={AGENTS} offline={false} onAsk={onAsk} onDo={onAsk} />, root));
  const box = root.querySelector<HTMLInputElement>('input.fl-input')!;
  const type = (v: string) => act(() => { box.value = v; box.dispatchEvent(new Event('input', { bubbles: true })); });
  const submit = () => act(() => { root.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); });
  const finish = async (ok: boolean) => { await act(async () => { done(ok); await Promise.resolve(); }); };
  return { box, sent, type, submit, finish };
}

describe('Composer draft', () => {
  // @req FR:task-detail-design/compose.text
  it('clears the box after a send', async () => {
    const c = mount();
    c.type('Ship it');
    c.submit();
    await c.finish(true);
    expect(c.sent).toEqual(['Ship it']);
    expect(c.box.value).toBe('');
  });

  // @req FR:task-detail-design/compose.keep
  it('keeps text typed while the send is in flight', async () => {
    const c = mount();
    c.type('Ship it');
    c.submit();
    c.type('Ship it. Also check the');
    await c.finish(true);
    expect(c.box.value).toBe('Ship it. Also check the');
  });

  // @req FR:task-detail-design/compose.keep
  it('keeps the text when the send fails', async () => {
    const c = mount();
    c.type('Ship it');
    c.submit();
    await c.finish(false);
    expect(c.box.value).toBe('Ship it');
  });
});
