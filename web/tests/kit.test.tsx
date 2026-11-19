// @vitest-environment jsdom
/** The shared view kit: chip, card, tabs, split view. */
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { describe, expect, it } from 'vitest';
import { Chip, ItemCard, SplitView, Tabs } from '../src/kit';

const mount = (el: preact.VNode) => { const root = document.createElement('div'); document.body.append(root); act(() => { render(el, root); }); return root; };

describe('kit', () => {
  // @req FR:priorities-tables/web.kit @req FR:priorities-tables/web.status.chip
  it('Chip: an outline chip with an icon and one word', () => {
    const r = mount(<Chip icon="🔄" cls="x">Working</Chip>);
    const c = r.querySelector('.kit-chip.x')!;
    expect(c.textContent).toBe('🔄Working');
    expect(c.querySelector('.kit-chip-icon')?.getAttribute('aria-hidden')).toBe('true');
  });
  // @req FR:priorities-tables/web.card.open
  it('ItemCard: the whole card opens; links stay outside the open button; ends in a chevron', () => {
    let opened = 0;
    const r = mount(<ul><ItemCard label="Details: FH" onOpen={() => { opened++; }} top={<a href="#/list?project=fh">FH</a>} aside={<Chip>Idle</Chip>} title="Ship it" sub="fh-pm" /></ul>);
    const b = r.querySelector<HTMLButtonElement>('button.kit-card-open')!;
    expect(b.getAttribute('aria-label')).toBe('Details: FH');
    expect(b.textContent).toBe('›');
    expect(b.querySelector('a')).toBeNull();
    expect(r.querySelector('.kit-card-top a')?.getAttribute('href')).toBe('#/list?project=fh');
    act(() => { b.click(); });
    expect(opened).toBe(1);
  });
  // @req FR:priorities-tables/web.tabs.keys
  it('Tabs: one selected tab; arrows, Home and End pick; an aside at the end', () => {
    const picks: string[] = [];
    const r = mount(<Tabs items={[{ key: 'a', label: 'A (1)' }, { key: 'b', label: 'B (2)' }, { key: 'c', label: 'C (0)' }]} current="a" onPick={(k) => picks.push(k)} label="T" idPrefix="t" aside={<span>as of 9 AM</span>} />);
    const tabs = [...r.querySelectorAll<HTMLButtonElement>('[role=tab]')];
    expect(tabs.map((t) => [t.textContent, t.getAttribute('aria-selected'), t.tabIndex])).toEqual([['A (1)', 'true', 0], ['B (2)', 'false', -1], ['C (0)', 'false', -1]]);
    const list = r.querySelector('[role=tablist]')!;
    for (const key of ['ArrowRight', 'ArrowLeft', 'End', 'Home']) act(() => { list.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); });
    expect(picks).toEqual(['b', 'c', 'c', 'a']);
    expect(r.querySelector('.kit-tabbar-aside')?.textContent).toBe('as of 9 AM');
  });
  // @req FR:priorities-tables/web.detail
  it('SplitView: side by side when wide; when narrow the detail replaces the list, with Back', () => {
    let backs = 0;
    const wide = mount(<SplitView wide open={false} list={<p>L</p>} detail={<p>D</p>} label="X" empty="Pick one" onBack={() => { backs++; }} />);
    expect(wide.querySelector('.kit-split-list')?.hasAttribute('hidden')).toBe(false);
    expect(wide.querySelector('.kit-split-detail')?.textContent).toBe('Pick one');
    const narrow = mount(<SplitView wide={false} open list={<p>L</p>} detail={<h3>D</h3>} label="X" empty="Pick one" onBack={() => { backs++; }} />);
    expect(narrow.querySelector('.kit-split-list')?.hasAttribute('hidden')).toBe(true);
    act(() => { narrow.querySelector<HTMLButtonElement>('.kit-back')!.click(); });
    expect(backs).toBe(1);
    const closed = mount(<SplitView wide={false} open={false} list={<p>L</p>} detail={<h3>D</h3>} label="X" empty="Pick one" onBack={() => {}} />);
    expect(closed.querySelector('.kit-split-detail')).toBeNull();
  });
});
