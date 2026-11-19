// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import * as parts from '../src/parts';
import { Dialog } from '../src/ui/Dialog';
import { EmptyState } from '../src/ui/States';
import { Toasts } from '../src/ui/Toasts';

const mount = (node: preact.ComponentChild) => { const root = document.createElement('div'); document.body.append(root); act(() => render(node, root)); return root; };
afterEach(() => { document.body.innerHTML = ''; });
const press = (el: Element, key: string, shiftKey = false) => act(() => { el.dispatchEvent(new KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })); });

describe('EmptyState', () => {
  // @req FR:ui-kit/empty
  it('says what is empty, then the next step; the markup is the one the views had', () => {
    expect(mount(<EmptyState what="Inbox zero" next={<a href="#/now">Back to Now</a>} />).innerHTML)
      .toBe('<div class="empty-state" data-testid="empty-state"><p class="empty-what">Inbox zero</p><p class="empty-next"><a href="#/now">Back to Now</a></p></div>');
    expect(mount(<EmptyState what="Nothing here" />).innerHTML).toBe('<div class="empty-state" data-testid="empty-state"><p class="empty-what">Nothing here</p></div>');
  });
});

describe('Dialog', () => {
  // @req FR:ui-kit/dialog
  it('is a titled modal box over a scrim; the markup is the one the views had', () => {
    const r = mount(<Dialog title="Set properties" onClose={() => undefined}><button type="button">A</button></Dialog>);
    expect(r.innerHTML).toBe('<div class="scrim"><div class="dialog sheet" role="dialog" aria-modal="true" aria-label="Set properties"><h2 class="dialog-title">Set properties</h2><button type="button">A</button></div></div>');
  });
  // @req FR:ui-kit/dialog.sheet
  it('is not a sheet when sheet is false', () => {
    expect(mount(<Dialog title="T" sheet={false} onClose={() => undefined}>x</Dialog>).querySelector('[role=dialog]')!.className).toBe('dialog');
  });
  // @req FR:ui-kit/dialog.focus
  // @req FR:ui-kit/dialog.trap
  // @req FR:ui-kit/dialog.return
  it('focuses the first control, keeps Tab inside, and returns focus to the opener on close', () => {
    const opener = document.createElement('button'); document.body.append(opener); opener.focus();
    const root = document.createElement('div'); document.body.append(root);
    act(() => render(<Dialog title="T" onClose={() => undefined}><button type="button" id="a">A</button><button type="button" disabled>Off</button><button type="button" id="b">B</button></Dialog>, root));
    const box = root.querySelector('[role=dialog]')!;
    expect(document.activeElement?.id).toBe('a');
    press(box, 'Tab', true);
    expect(document.activeElement?.id).toBe('b');
    press(box, 'Tab');
    expect(document.activeElement?.id).toBe('a');
    act(() => render(null, root));
    expect(document.activeElement).toBe(opener);
  });
  // @req FR:ui-kit/dialog.close
  it('closes on Escape and on a tap on the scrim, not on a tap in the box', () => {
    let n = 0;
    const r = mount(<Dialog title="T" onClose={() => { n++; }}><button type="button">A</button></Dialog>);
    act(() => { r.querySelector<HTMLElement>('[role=dialog]')!.click(); });
    expect(n).toBe(0);
    press(r.querySelector('[role=dialog]')!, 'Escape');
    act(() => { r.querySelector<HTMLElement>('.scrim')!.click(); });
    expect(n).toBe(2);
  });
});

describe('Toasts', () => {
  // @req FR:ui-kit/toasts
  it('shows every toast in one polite live region; the markup is the one the views had', () => {
    const r = mount(<Toasts toasts={[{ id: 1, text: 'Saved', kind: 'ok' }, { id: 2, text: 'Cannot save', kind: 'err' }]} dismiss={() => undefined} />);
    expect(r.innerHTML).toBe('<div class="toasts" role="status" aria-live="polite"><div class="toast ok"><span>Saved</span><button type="button" class="link" aria-label="Dismiss">×</button></div><div class="toast err"><span>Cannot save</span><button type="button" class="link" aria-label="Dismiss">×</button></div></div>');
  });
  // @req FR:ui-kit/toasts.dismiss
  // @req FR:ui-kit/toasts.undo
  it('Undo runs the undo and dismisses; Dismiss only dismisses', () => {
    const log: string[] = [];
    const r = mount(<Toasts toasts={[{ id: 7, text: 'Done', kind: 'ok', undo: () => log.push('undo') }]} dismiss={(id) => log.push(`dismiss ${id}`)} />);
    const [undo, x] = [...r.querySelectorAll<HTMLButtonElement>('button')];
    expect(undo.textContent).toBe('Undo');
    act(() => { undo.click(); });
    act(() => { x.click(); });
    expect(log).toEqual(['undo', 'dismiss 7', 'dismiss 7']);
  });
});

// Not an FR: guards the re-export from `parts`.
it('parts still exports the moved components, so no view import changes', () => {
  expect([parts.Dialog, parts.EmptyState, parts.Toasts]).toEqual([Dialog, EmptyState, Toasts]);
});
