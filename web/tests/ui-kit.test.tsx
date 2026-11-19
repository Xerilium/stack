// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { render } from 'preact';
import { act } from 'preact/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { ActionBar, ActionMenu, type ActionItem } from '../src/ui/ActionMenu';
import { DayGrid, placeItems } from '../src/ui/DayGrid';
import { Flag } from '../src/ui/Flag';
import { MessageBox } from '../src/ui/MessageBox';
import { LinkList } from '../src/ui/LinkList';
import { PageHeader } from '../src/ui/PageHeader';
import { EmptyState, ErrorState, Loading } from '../src/ui/States';
import { SelectCard } from '../src/ui/SelectCard';
import { SourceLink, sourceOf } from '../src/ui/SourceLink';
import { SplitView } from '../src/ui/SplitView';
import { StatusChip } from '../src/ui/StatusChip';
import { Tabs } from '../src/ui/Tabs';

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

// @req FR:ui-kit/source @req FR:ui-kit/source.name @req FR:ui-kit/source.tab @req FR:ui-kit/source.click @req FR:ui-kit/source.empty
describe('SourceLink', () => {
  it('sourceOf names a link by its kind', () => {
    expect(sourceOf('https://github.com/Xerilium/stack/pull/158')).toEqual({ kind: 'pr', label: 'PR stack#158' });
    expect(sourceOf('https://github.com/Xerilium/stack/issues/152#issuecomment-1')).toEqual({ kind: 'issue', label: 'Issue stack#152' });
    expect(sourceOf('claude://claude.ai/epitaxy/abc')).toEqual({ kind: 'session', label: 'Session' });
    expect(sourceOf('https://claude.ai/code/session_1')).toEqual({ kind: 'session', label: 'Session' });
    expect(sourceOf('https://outlook.office.com/mail/id/1')).toEqual({ kind: 'email', label: 'Email' });
    expect(sourceOf('mailto:a@example.test')).toEqual({ kind: 'email', label: 'Email' });
    expect(sourceOf('https://mail.google.com/mail/u/0/#inbox/1')).toEqual({ kind: 'email', label: 'Email' });
    for (const [href, site] of [['https://www.office.com/launch', 'office.com'], ['https://onedrive.live.com/x', 'onedrive.live.com'], ['https://drive.proton.me/u/0', 'drive.proton.me']]) expect(sourceOf(href)).toEqual({ kind: 'site', label: site });
    expect(sourceOf('https://www.npmjs.com/settings')).toEqual({ kind: 'site', label: 'npmjs.com' });
    expect(sourceOf('https://github.com/Xerilium/stack')).toEqual({ kind: 'site', label: 'github.com' });
    for (const bad of [undefined, '', 'not a link', 'javascript:alert(1)']) expect(sourceOf(bad)).toBeNull();
  });
  it('is a new-tab link that ends in an arrow; a click does not reach the row; no link draws nothing', () => {
    let rowClicks = 0;
    const r = mount(<div onClick={() => { rowClicks++; }}><SourceLink href="https://github.com/o/r/pull/7" /></div>);
    const a = r.querySelector<HTMLAnchorElement>('a.ui-source')!;
    expect(a.textContent).toBe('PR r#7 ↗');
    expect([a.getAttribute('href'), a.target, a.rel, a.dataset.kind]).toEqual(['https://github.com/o/r/pull/7', '_blank', 'noopener noreferrer', 'pr']);
    a.addEventListener('click', (e) => e.preventDefault());
    act(() => { a.click(); });
    expect(rowClicks).toBe(0);
    expect(mount(<SourceLink href="nope" />).innerHTML).toBe('');
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
  it('with label: links in the title and sub line stay outside the button; the chevron button is named label', () => {
    let n = 0;
    const r = mount(<ul><SelectCard label="Details: FH" selected={false} onSelect={() => n++} title={<>Ship <a href="#pr">430</a></>} sub={<a href="#agent">fh-pm</a>} /></ul>);
    const b = r.querySelector<HTMLButtonElement>('button.ui-card-open')!;
    expect(b.getAttribute('aria-label')).toBe('Details: FH');
    expect(b.textContent).toBe('›');
    expect(b.querySelector('a')).toBeNull();
    expect([...r.querySelectorAll('.ui-card-body a')].map((a) => a.getAttribute('href'))).toEqual(['#pr', '#agent']);
    act(() => { b.click(); });
    expect(n).toBe(1);
  });
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

describe('Tabs and SplitView', () => {
  // @req FR:ui-kit/tabs
  it('Tabs: one selected tab; arrows, Home and End pick; an aside at the end', () => {
    const picks: string[] = [];
    const r = mount(<Tabs items={[{ key: 'a', label: 'A (1)' }, { key: 'b', label: 'B (2)' }, { key: 'c', label: 'C (0)' }]} current="a" onPick={(k) => picks.push(k)} label="T" idPrefix="t" aside={<span>as of 9 AM</span>} />);
    const tabs = [...r.querySelectorAll<HTMLButtonElement>('[role=tab]')];
    expect(tabs.map((t) => [t.textContent, t.getAttribute('aria-selected'), t.tabIndex])).toEqual([['A (1)', 'true', 0], ['B (2)', 'false', -1], ['C (0)', 'false', -1]]);
    const list = r.querySelector('[role=tablist]')!;
    for (const key of ['ArrowRight', 'ArrowLeft', 'End', 'Home']) act(() => { list.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true })); });
    expect(picks).toEqual(['b', 'c', 'c', 'a']);
    expect(r.querySelector('.ui-tabbar-aside')?.textContent).toBe('as of 9 AM');
  });
  // @req FR:ui-kit/message
  it('MessageBox: sends the text, says Sent, keeps the text on an error; off with a reason', async () => {
    const sent: string[] = [];
    let fail = false;
    const r = mount(<MessageBox heading="Message agent" to="FH backend" onSend={async (t) => { if (fail) throw new Error('Session is busy'); sent.push(t); }} />);
    const box = r.querySelector<HTMLTextAreaElement>('textarea')!;
    const btn = r.querySelector<HTMLButtonElement>('button[type=submit]')!;
    expect(r.querySelector('h4')?.textContent).toBe('Message agent');
    expect([box.getAttribute('aria-label'), box.maxLength, btn.textContent, btn.disabled]).toEqual(['Message FH backend', 4000, 'Send', true]);
    const type = (v: string) => act(() => { box.value = v; box.dispatchEvent(new Event('input', { bubbles: true })); });
    const submit = async () => { await act(async () => { r.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); await Promise.resolve(); }); await act(async () => { await Promise.resolve(); }); };
    type('  status?  ');
    expect(btn.disabled).toBe(false);
    await submit();
    expect(sent).toEqual(['status?']);
    expect([box.value, r.querySelector('[role=status]')?.textContent]).toEqual(['', 'Sent to FH backend']);
    fail = true;
    type('again');
    await submit();
    expect([box.value, r.querySelector('[role=status]')?.textContent]).toEqual(['again', 'Session is busy']);
    const off = mount(<MessageBox heading="Ask CoS" send="Ask CoS" to="Xe CoS" text="Add a task" off="No live session for Xe CoS" onSend={async () => {}} />);
    expect([off.querySelector('textarea')!.value, off.querySelector('textarea')!.disabled, off.querySelector<HTMLButtonElement>('button')!.disabled, off.querySelector<HTMLButtonElement>('button')!.textContent]).toEqual(['Add a task', true, true, 'Ask CoS']);
    expect(off.querySelector('.ui-msg-hint')?.textContent).toBe('No live session for Xe CoS');
  });
  // @req FR:ui-kit/split
  it('SplitView: side by side when wide; when narrow the detail replaces the list, with Back', () => {
    let backs = 0;
    const wide = mount(<SplitView wide open={false} list={<p>L</p>} detail={<p>D</p>} label="X" empty="Pick one" onBack={() => { backs++; }} />);
    expect(wide.querySelector('.ui-split-list')?.hasAttribute('hidden')).toBe(false);
    expect(wide.querySelector('.ui-split-detail')?.textContent).toBe('Pick one');
    const narrow = mount(<SplitView wide={false} open list={<p>L</p>} detail={<h3>D</h3>} label="X" empty="Pick one" onBack={() => { backs++; }} />);
    expect(narrow.querySelector('.ui-split-list')?.hasAttribute('hidden')).toBe(true);
    act(() => { narrow.querySelector<HTMLButtonElement>('.ui-back')!.click(); });
    expect(backs).toBe(1);
    const closed = mount(<SplitView wide={false} open={false} list={<p>L</p>} detail={<h3>D</h3>} label="X" empty="Pick one" onBack={() => {}} />);
    expect(closed.querySelector('.ui-split-detail')).toBeNull();
  });
});

// @req FR:ui-kit/daygrid
describe('DayGrid', () => {
  const it30 = { key: 'a', start: 600, end: 630 }, it60 = { key: 'b', start: 660, end: 720 }, it15 = { key: 'c', start: 735, end: 750 }, it12 = { key: 'd', start: 750, end: 762 };
  it('placeItems: size is in proportion to length, top to start', () => {
    const p = placeItems([it60, it30, it15, it12], 600, 780);
    expect(p.map((x) => [x.item.key, x.top, x.size])).toEqual([['a', 0, 1], ['b', 2, 2], ['c', 4.5, 0.5], ['d', 5, 0.4]]);
    expect(p.every((x) => x.lane === 0 && x.lanes === 1)).toBe(true);
  });
  it('placeItems: clips to the span and drops items outside it', () => {
    const p = placeItems([{ key: 'early', start: 540, end: 630 }, { key: 'late', start: 760, end: 840 }, { key: 'out', start: 900, end: 930 }], 600, 780);
    expect(p.map((x) => [x.item.key, x.top, x.size])).toEqual([['early', 0, 1], ['late', 16 / 3, 2 / 3]]);
    // an item cut by the span keeps its cut size; a short one at the end stops at the last row
    expect(placeItems([{ key: 'cut', start: 560, end: 605 }, { key: 'end', start: 775, end: 780 }], 600, 780).map((x) => [x.item.key, x.size])).toEqual([['cut', 5 / 30], ['end', 5 / 30]]);
    // back to back, 12 minutes and up: one under the other, full width
    expect(placeItems([{ key: 'x', start: 600, end: 612 }, { key: 'y', start: 612, end: 642 }, { key: 'z', start: 642, end: 672 }], 600, 780).map((x) => [x.size, x.lane, x.lanes])).toEqual([[0.4, 0, 1], [1, 0, 1], [1, 0, 1]]);
    // an item under 12 minutes is drawn 12 minutes high; overlap is judged on the drawn height, so the next item sits beside it, never under it
    expect(placeItems([{ key: 'x', start: 600, end: 605 }, { key: 'y', start: 605, end: 635 }], 600, 780).map((x) => [x.size, x.lane, x.lanes])).toEqual([[0.4, 0, 2], [1, 1, 2]]);
    expect(placeItems([{ key: 'x', start: 600, end: 605 }, { key: 'y', start: 605, end: 610 }], 600, 780).map((x) => [x.lane, x.lanes])).toEqual([[0, 2], [1, 2]]);

  });
  it('placeItems: items that overlap sit side by side; later ones get the full width again', () => {
    const p = placeItems([{ key: 'a', start: 600, end: 660 }, { key: 'b', start: 630, end: 690 }, { key: 'c', start: 660, end: 690 }, { key: 'd', start: 720, end: 750 }], 600, 780);
    expect(p.map((x) => [x.item.key, x.lane, x.lanes])).toEqual([['a', 0, 2], ['b', 1, 2], ['c', 0, 2], ['d', 0, 1]]);
  });
  it('draws one row per 30 minutes, hour labels, bands, items in time order, and a now line', () => {
    const r = mount(<DayGrid label="Day" from={605} to={770} now={640} testid="plan"
      bands={[{ start: 480, end: 660, label: 'Work' }, { start: 660, end: 780, label: 'Family', muted: true }]}
      items={[{ ...it60, node: <b>Sixty</b> }, { ...it30, node: <b>Thirty</b> }]} />);
    const slots = [...r.querySelectorAll('.ui-slot')];
    expect(slots).toHaveLength(6); // 10:00a to 1:00p
    expect(slots.map((x) => x.querySelector('time')?.textContent ?? '')).toEqual(['10a', '', '11a', '', '12p', '']);
    expect(slots.map((x) => x.querySelector('.ui-slot-band')?.textContent ?? '')).toEqual(['Work', '', 'Family', '', '', '']);
    // the tint covers the band's own time, not whole rows; it is decoration
    const tint = [...r.querySelectorAll<HTMLElement>('.ui-grid-band.muted')];
    expect(tint.map((x) => [x.style.getPropertyValue('--top'), x.style.getPropertyValue('--size')])).toEqual([['2', '4']]);
    expect(r.querySelector('.ui-grid-bands')!.getAttribute('aria-hidden')).toBe('true');
    expect(r.querySelector('.ui-slots')!.getAttribute('aria-hidden')).toBe('true');
    const list = r.querySelector('[data-testid="plan"]')!;
    expect(list.tagName).toBe('OL');
    expect(list.getAttribute('aria-label')).toBe('Day');
    const items = [...list.querySelectorAll<HTMLElement>(':scope > li.ui-grid-item')];
    expect(items.map((x) => x.textContent)).toEqual(['ThirtyWork', 'SixtyFamily']); // each item names its band for assistive tech
    expect(items.map((x) => x.querySelector('.ui-sr')?.textContent)).toEqual(['Work', 'Family']);
    expect(items.map((x) => [x.style.getPropertyValue('--top'), x.style.getPropertyValue('--size')])).toEqual([['0', '1'], ['2', '2']]);
    const now = r.querySelector<HTMLElement>('.now-line')!;
    expect(now.getAttribute('aria-label')).toBe('Now 10:40a');
    expect(Number(now.style.getPropertyValue('--top'))).toBeCloseTo(4 / 3);
  });
  // @req FR:ui-kit/daygrid.bands @req FR:ui-kit/daygrid.a11y
  it('tints a band that starts off the half hour from its real start, and labels each band in the row that holds its start', () => {
    const r = mount(<DayGrid label="Day" from={600} to={780} items={[{ key: 'x', start: 700, end: 730, node: <b>X</b> }, { key: 'y', start: 620, end: 640, node: <b>Y</b> }]}
      bands={[{ start: 480, end: 615, label: 'Work' }, { start: 615, end: 645, label: 'Break', muted: true }, { start: 690, end: 780, label: 'Family', muted: true }]} />);
    const tint = [...r.querySelectorAll<HTMLElement>('.ui-grid-band')];
    expect(tint.map((x) => [Number(x.style.getPropertyValue('--top')), Number(x.style.getPropertyValue('--size'))])).toEqual([[0.5, 1], [3, 3]]);
    const labels = [...r.querySelectorAll('.ui-slot')].map((x) => [...x.querySelectorAll('.ui-slot-band')].map((b) => b.textContent));
    expect(labels).toEqual([['Work', 'Break'], [], [], ['Family'], [], []]);
    expect([...r.querySelectorAll('.ui-grid-item .ui-sr')].map((x) => x.textContent)).toEqual(['Break', 'Family']);
  });
  it('draws no now line when now is outside the span or not given', () => {
    expect(mount(<DayGrid label="Day" from={600} to={780} now={900} items={[]} />).querySelector('.now-line')).toBeNull();
    expect(mount(<DayGrid label="Day" from={600} to={780} items={[]} />).querySelector('.now-line')).toBeNull();
  });
});

// @req FR:ui-kit/links
describe('LinkList', () => {
  it('shows a label and its links; web links open in a new tab, app links in place', () => {
    const r = mount(<LinkList label="Context" items={[{ text: 'Tasks: FH', href: '#/list?project=fh' }, { text: 'PR 12', href: 'https://github.com/o/r/pull/12' }]} />);
    const box = r.querySelector('.ui-links')!;
    expect(box.querySelector('.ui-links-h')!.textContent).toBe('Context');
    const [a, b] = [...box.querySelectorAll('a')];
    expect([a.textContent, a.getAttribute('href'), a.getAttribute('target')]).toEqual(['Tasks: FH', '#/list?project=fh', null]);
    expect([b.textContent, b.getAttribute('target'), b.getAttribute('rel')]).toEqual(['PR 12', '_blank', 'noopener noreferrer']);
  });
  it('shows nothing with no items', () => {
    expect(mount(<LinkList label="Context" items={[]} />).querySelector('.ui-links')).toBeNull();
  });
});

// @req FR:ui-kit/header @req FR:ui-kit/header.wrap
describe('PageHeader', () => {
  it('is an h1 title with optional meta, sub line and actions', () => {
    const r = mount(<PageHeader title="Sessions" meta="139 waiting" sub="Every agent session." actions={<button type="button">Refresh</button>} />);
    const h = r.querySelector('header.ui-head')!;
    expect(h.querySelector('h1.ui-head-title')!.textContent).toBe('Sessions');
    expect(h.querySelector('.ui-head-meta')!.textContent).toBe('139 waiting');
    expect(h.querySelector('.ui-head-sub')!.textContent).toBe('Every agent session.');
    expect(h.querySelector('.ui-head-actions button')!.textContent).toBe('Refresh');
  });
  it('draws only the title when given only a title', () => {
    const h = mount(<PageHeader title="Projects" />).querySelector('.ui-head')!;
    expect(h.querySelector('.ui-head-meta, .ui-head-sub, .ui-head-actions')).toBeNull();
  });
  it('skips meta, sub and actions passed as null', () => {
    const h = mount(<PageHeader title="Projects" meta={null} sub={null} actions={null} />).querySelector('.ui-head')!;
    expect(h.querySelector('.ui-head-meta, .ui-head-sub, .ui-head-actions')).toBeNull();
  });
  it('wraps the actions under the title on a narrow screen', () => {
    expect(readFileSync('src/ui/ui.css', 'utf8')).toMatch(/\.ui-head \{ display: flex; flex-wrap: wrap;/);
  });
});

// @req FR:ui-kit/empty
describe('EmptyState', () => {
  it('says what is empty, then the next step', () => {
    const e = mount(<EmptyState what="No projects." next={<a href="#/list">Open Full stack</a>} />).querySelector('[data-testid="empty-state"]')!;
    expect(e.className).toBe('empty-state');
    expect(e.querySelector('.empty-what')!.textContent).toBe('No projects.');
    expect(e.querySelector('.empty-next a')!.textContent).toBe('Open Full stack');
    expect(e.querySelector('svg, img')).toBeNull();
    expect(mount(<EmptyState what="None." />).querySelector('.empty-next')).toBeNull();
  });
});

// @req FR:ui-kit/loading @req FR:ui-kit/loading.bars @req FR:ui-kit/loading.motion
describe('Loading', () => {
  it('is a status whose text says what loads, with gray bars hidden from assistive tech', () => {
    const l = mount(<Loading what="sessions" />).querySelector('.ui-loading')!;
    expect(l.getAttribute('role')).toBe('status');
    expect(l.hasAttribute('aria-busy')).toBe(false);
    expect(l.querySelector('.sr-only')!.textContent).toBe('Loading sessions');
    expect(l.querySelectorAll('.ui-sk')).toHaveLength(3);
    for (const b of l.querySelectorAll('.ui-sk')) expect(b.getAttribute('aria-hidden')).toBe('true');
    expect(mount(<Loading what="x" rows={5} />).querySelectorAll('.ui-sk')).toHaveLength(5);
  });
  it('does not move with reduced motion', () => {
    const css = readFileSync('src/ui/ui.css', 'utf8');
    expect(css).toMatch(/prefers-reduced-motion: reduce\) \{ \.ui-sk \{ animation: none; \} \}/);
  });
});

// @req FR:ui-kit/error @req FR:ui-kit/error.retry
describe('ErrorState', () => {
  it('is an alert: what happened, the next step, and Retry', () => {
    let n = 0;
    const e = mount(<ErrorState what="Cannot load sessions." next="Check that Stack is open on your Mac." onRetry={() => { n += 1; }} />).querySelector('.ui-error')!;
    expect(e.getAttribute('role')).toBe('alert');
    expect(e.querySelector('.ui-error-what')!.textContent).toBe('Cannot load sessions.');
    expect(e.querySelector('.ui-error-next')!.textContent).toBe('Check that Stack is open on your Mac.');
    const b = e.querySelector('button')!;
    expect(b.textContent).toBe('Retry');
    act(() => b.click());
    expect(n).toBe(1);
  });
  it('has no button without onRetry', () => expect(mount(<ErrorState what="Cannot load." />).querySelector('button')).toBeNull());
});
