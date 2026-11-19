// @vitest-environment jsdom
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { ActionBar, ActionMenu, type ActionItem } from '../src/ui/ActionMenu';
import { Flag } from '../src/ui/Flag';
import { SelectCard } from '../src/ui/SelectCard';
import { StatusChip } from '../src/ui/StatusChip';

const mount = (node: preact.ComponentChild) => { const root = document.createElement('div'); document.body.append(root); act(() => render(node, root)); return root; };
afterEach(() => { document.body.innerHTML = ''; });
const key = (k: string) => act(() => { document.activeElement!.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true })); });

// @req FR:ui-kit/flag
describe('Flag', () => {
  it('is a span with an icon and the word; never a control', () => {
    const r = mount(<Flag text="Sign off" />);
    const f = r.querySelector('.ui-flag')!;
    expect(f.tagName).toBe('SPAN');
    expect(f.textContent).toBe('Sign off');
    expect(f.querySelector('svg')).not.toBeNull();
    expect(f.getAttribute('role')).toBeNull();
    expect((f as HTMLElement).tabIndex).toBe(-1);
    expect(f.getAttribute('aria-hidden')).toBeNull();
    expect(mount(<Flag text="x" hidden />).querySelector('.ui-flag')!.getAttribute('aria-hidden')).toBe('true');
  });
});

// @req FR:ui-kit/chip
describe('StatusChip', () => {
  it('is a span with a tone class and a dot; never a button', () => {
    const r = mount(<StatusChip label="Passing" tone="ok" title="CI passing" />);
    const c = r.querySelector('.ui-chip')!;
    expect(c.tagName).toBe('SPAN');
    expect(c.className).toBe('ui-chip t-ok');
    expect(c.textContent).toBe('Passing');
    expect(c.getAttribute('title')).toBe('CI passing');
    expect(r.querySelector('button')).toBeNull();
    expect(mount(<StatusChip label="New" />).querySelector('.ui-chip')!.className).toBe('ui-chip t-neutral');
  });
});

// @req FR:ui-kit/card
describe('SelectCard', () => {
  it('one select target for the whole card; top and tools sit outside it; selected state', () => {
    let n = 0;
    const r = mount(<ul><SelectCard class="pr-card tone-auto" data={{ number: 7, url: 'u', gone: undefined }} selected onSelect={() => n++} top={<a href="#x">#7</a>} title="Fix it" sr=", next: Sign off" sub={<span>You</span>} tools={<button type="button">Pin</button>} /></ul>);
    const li = r.querySelector('li')!;
    expect(li.className).toBe('ui-card pr-card tone-auto');
    expect(li.dataset).toMatchObject({ number: '7', url: 'u', selected: 'true' });
    expect('gone' in li.dataset).toBe(false);
    const open = li.querySelector<HTMLButtonElement>('.ui-card-open')!;
    expect(open.getAttribute('aria-current')).toBe('true');
    expect(open.textContent).toBe('Fix it, next: Sign offYou›');
    expect(open.querySelector('a, .ui-card-tools')).toBeNull();
    open.click();
    expect(n).toBe(1);
    expect(li.querySelector('.ui-card-top a')).not.toBeNull();
    expect(li.querySelector('.ui-card-tools button')!.textContent).toBe('Pin');
    const plain = mount(<ul><SelectCard selected={false} onSelect={() => undefined} title="T" /></ul>).querySelector('li')!;
    expect(plain.dataset.selected).toBeUndefined();
    expect(plain.querySelector('.ui-card-top, .ui-card-tools, .ui-card-sub')).toBeNull();
  });
});

// @req FR:ui-kit/menu @req FR:ui-kit/bar
describe('ActionMenu and ActionBar', () => {
  const ran: string[] = [];
  const items: ActionItem[] = [
    { id: 'a', label: 'Sweep next', onSelect: () => ran.push('a') },
    { id: 'b', label: 'Busy', disabled: true, onSelect: () => ran.push('b') },
    { id: 'o', label: 'Open on GitHub', href: 'https://github.com/o/r/pull/1' },
    { id: 'c', label: 'Copy', title: 'Copy it', onSelect: () => ran.push('c') },
  ];
  it('a quiet button opens a menu; focus moves in; arrows, Home, End skip disabled; Escape returns focus', () => {
    const r = mount(<ActionMenu name="Actions for o/r#1" items={items} />);
    const btn = r.querySelector<HTMLButtonElement>('.ui-more-btn')!;
    expect(btn.getAttribute('aria-haspopup')).toBe('menu');
    expect(btn.getAttribute('aria-label')).toBe('Actions for o/r#1');
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(r.querySelector('[role="menu"]')).toBeNull();
    act(() => btn.click());
    const menu = r.querySelector('[role="menu"]')!;
    expect(menu.getAttribute('aria-label')).toBe('Actions for o/r#1');
    expect([...menu.querySelectorAll('[role="menuitem"]')].map((x) => x.textContent)).toEqual(['Sweep next', 'Busy', 'Open on GitHub', 'Copy']);
    expect(menu.querySelector('a')!.getAttribute('target')).toBe('_blank');
    expect(document.activeElement!.textContent).toBe('Sweep next');
    key('ArrowDown');
    expect(document.activeElement!.textContent).toBe('Open on GitHub');
    key('End');
    expect(document.activeElement!.textContent).toBe('Copy');
    key('ArrowDown');
    expect(document.activeElement!.textContent).toBe('Sweep next');
    key('ArrowUp');
    expect(document.activeElement!.textContent).toBe('Copy');
    key('Home');
    expect(document.activeElement!.textContent).toBe('Sweep next');
    key('Escape');
    expect(r.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(btn);
  });
  it('a pick runs its action and closes; a pointer down outside closes', () => {
    ran.length = 0;
    const r = mount(<><p id="out">x</p><ActionMenu name="m" items={items} /></>);
    const btn = r.querySelector<HTMLButtonElement>('.ui-more-btn')!;
    act(() => btn.click());
    act(() => [...r.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')].find((x) => x.textContent === 'Copy')!.click());
    expect(ran).toEqual(['c']);
    expect(r.querySelector('[role="menu"]')).toBeNull();
    act(() => btn.click());
    act(() => { r.querySelector('#out')!.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    expect(r.querySelector('[role="menu"]')).toBeNull();
  });
  it('the bar shows the same items as buttons and links under a heading', () => {
    ran.length = 0;
    const r = mount(<ActionBar heading="Quick actions" items={items} />);
    expect(r.querySelector('section')!.getAttribute('aria-label')).toBe('Quick actions');
    expect(r.querySelector('h4')!.textContent).toBe('Quick actions');
    expect([...r.querySelectorAll('.ui-bar-row > *')].map((x) => `${x.tagName} ${x.textContent}`)).toEqual(['BUTTON Sweep next', 'BUTTON Busy', 'A Open on GitHub', 'BUTTON Copy']);
    expect(r.querySelector<HTMLButtonElement>('button:disabled')!.textContent).toBe('Busy');
    r.querySelector<HTMLButtonElement>('button')!.click();
    expect(ran).toEqual(['a']);
  });
});
