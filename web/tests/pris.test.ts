/** @req FR:pris-sessions-ui/pris.block @req FR:pris-sessions-ui/pris.status @req FR:pris-sessions-ui/pris.edit @req FR:pris-sessions-ui/pris.limits */
import { describe, expect, it } from 'vitest';
import { ApiFailure } from '../src/api';
import { commitPris, edits, ITEM_STATUS, LIMITS, nextItem, oneLine, PRI_STATUS, progress, slugId, visiblePris, type Pri, type PrisFile } from '../src/pris';

const P = (id: string, title: string, o: Partial<Pri> = {}): Pri => ({ id, title, status: 'active', items: [], backlog: [], weekly: [], ...o });
const file = (pris: Pri[], rev = 3): PrisFile => ({ version: 1, rev, pris });

describe('visiblePris', () => {
  // @req FR:pris-sessions-ui/pris.block
  it('shows the first 5 that are not done, in stored order, with their number; the rest are behind a count', () => {
    const list = [P('a', 'A'), P('b', 'B', { status: 'done' }), P('c', 'C'), P('d', 'D'), P('e', 'E'), P('f', 'F'), P('g', 'G')];
    const v = visiblePris(list, false);
    expect(v.shown.map((x) => [x.n, x.pri.id])).toEqual([[1, 'a'], [3, 'c'], [4, 'd'], [5, 'e'], [6, 'f']]);
    expect(v.more).toBe(2);
    expect(visiblePris(list, true).shown.map((x) => x.pri.id)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    expect(visiblePris(list, true).more).toBe(0);
  });
});

describe('progress and nextItem', () => {
  // @req FR:pris-sessions-ui/pris.block
  it('counts done items and picks doing before todo, else blocked', () => {
    const p = P('a', 'A', { items: [{ text: 'one', status: 'done' }, { text: 'two', status: 'todo' }, { text: 'three', status: 'doing' }, { text: 'four', status: 'blocked' }] });
    expect(progress(p)).toEqual({ done: 1, total: 4 });
    expect(nextItem(p)?.text).toBe('three');
    expect(nextItem(P('b', 'B', { items: [{ text: 'x', status: 'blocked' }, { text: 'y', status: 'done' }] }))?.text).toBe('x');
    expect(nextItem(P('c', 'C', { items: [{ text: 'y', status: 'done' }] }))).toBeUndefined();
  });
});

describe('status words', () => {
  // @req FR:pris-sessions-ui/pris.status
  it('every status has a glyph and a word; only blocked warns', () => {
    for (const s of Object.values({ ...PRI_STATUS, ...ITEM_STATUS })) { expect(s.glyph).toBeTruthy(); expect(s.word).toMatch(/^[A-Z][a-z]+$/); }
    expect(Object.entries(PRI_STATUS).filter(([, v]) => v.warn).map(([k]) => k)).toEqual(['blocked']);
    expect(Object.entries(ITEM_STATUS).filter(([, v]) => v.warn).map(([k]) => k)).toEqual(['blocked']);
  });
});

describe('edits', () => {
  const base = [P('a', 'Alpha', { items: [{ text: 'one', status: 'todo' }, { text: 'two', status: 'todo' }] }), P('b', 'Beta')];
  // @req FR:pris-sessions-ui/pris.edit
  it('change one priority and leave the input untouched', () => {
    expect(edits.title('a', 'Alpha 2')(base)![0].title).toBe('Alpha 2');
    expect(edits.status('b', 'paused')(base)![1].status).toBe('paused');
    expect(edits.itemText('a', 1, 'two', 'deux')(base)![0].items[1].text).toBe('deux');
    expect(edits.itemStatus('a', 0, 'one', 'done')(base)![0].items[0].status).toBe('done');
    expect(edits.addItem('a', 'three')(base)![0].items.map((i) => i.text)).toEqual(['one', 'two', 'three']);
    expect(edits.removeItem('a', 0, 'one')(base)![0].items.map((i) => i.text)).toEqual(['two']);
    expect(edits.move('a', 1)(base)!.map((p) => p.id)).toEqual(['b', 'a']);
    expect(edits.move('b', -1)(base)!.map((p) => p.id)).toEqual(['b', 'a']);
    expect(base[0].title).toBe('Alpha');
    expect(base[0].items).toHaveLength(2);
  });
  // @req FR:pris-sessions-ui/pris.conflict
  it('return null when the target is gone or moved, so a rebase never edits the wrong item', () => {
    expect(edits.title('zz', 'x')(base)).toBeNull();
    expect(edits.itemText('a', 0, 'not one', 'x')(base)).toBeNull();
    expect(edits.itemStatus('a', 5, 'one', 'done')(base)).toBeNull();
    expect(edits.removeItem('a', 1, 'one')(base)).toBeNull();
    expect(edits.move('a', -1)(base)).toBeNull();
    expect(edits.move('b', 1)(base)).toBeNull();
  });
  // @req FR:pris-sessions-ui/pris.edit
  it('an empty or unchanged text saves nothing', () => {
    expect(edits.title('a', '   ')(base)).toBeNull();
    expect(edits.title('a', 'Alpha')(base)).toBeNull();
    expect(edits.addItem('a', ' ')(base)).toBeNull();
    expect(edits.itemText('a', 0, 'one', 'one')(base)).toBeNull();
  });
  // @req FR:pris-sessions-ui/pris.limits
  it('keep text to one line within the limits and stop at the list limits', () => {
    expect(edits.title('a', 'two\nlines\there')(base)![0].title).toBe('two lines here');
    expect(edits.title('a', 'x'.repeat(500))(base)![0].title).toHaveLength(LIMITS.title);
    expect(edits.addItem('a', 'y'.repeat(500))(base)![0].items[2].text).toHaveLength(LIMITS.item);
    const full = [P('a', 'A', { items: Array.from({ length: LIMITS.items }, (_, i) => ({ text: `i${i}`, status: 'todo' as const })) })];
    expect(edits.addItem('a', 'more')(full)).toBeNull();
    const many = Array.from({ length: LIMITS.pris }, (_, i) => P(`p${i}`, `P${i}`));
    expect(edits.addPri('One more')(many)).toBeNull();
  });
  // @req FR:pris-sessions-ui/pris.limits
  it('a new priority goes last, active, with a unique slug id', () => {
    const out = edits.addPri('Ship the Web App!')(base)!;
    expect(out.at(-1)).toEqual(P('ship-the-web-app', 'Ship the Web App!'));
    expect(slugId('Alpha', new Set(['alpha']))).toBe('alpha-2');
    expect(slugId('!!!', new Set())).toBe('p');
    expect(slugId('x'.repeat(40), new Set())).toHaveLength(24);
    expect(slugId('x'.repeat(40), new Set(['x'.repeat(24)]))).toMatch(/^x{22}-2$/);
    expect(oneLine('  a \n b  ', 10)).toBe('a b');
  });
});

describe('commitPris', () => {
  const fail = (status: number, code: string, message = code, details?: { field: string; message: string }[]) => new ApiFailure(status, code, message, details);
  const fake = (o: { put: ((rev: number, pris: Pri[]) => PrisFile)[]; reads?: PrisFile[] }) => {
    const calls: { rev: number; pris: Pri[] }[] = [];
    let reads = 0;
    return {
      calls,
      api: {
        putPris: async (rev: number, pris: Pri[]) => { calls.push({ rev, pris }); const f = o.put.shift(); if (!f) throw new Error('no more puts'); return f(rev, pris); },
        pris: async () => o.reads![reads++],
      },
    };
  };
  // @req FR:pris-sessions-ui/pris.save
  it('sends the rev read and the whole list; adopts the returned file', async () => {
    const f = fake({ put: [(rev, pris) => file(pris, rev + 1)] });
    const r = await commitPris(f.api, file([P('a', 'A')]), edits.title('a', 'B'));
    expect(f.calls).toEqual([{ rev: 3, pris: [P('a', 'B')] }]);
    expect(r).toMatchObject({ outcome: 'saved', file: { rev: 4 } });
  });
  // @req FR:pris-sessions-ui/pris.conflict
  it('on 409 re-reads, applies the same edit to the new list, and sends once more', async () => {
    const theirs = file([P('a', 'A'), P('z', 'Theirs')], 7);
    const f = fake({ put: [() => { throw fail(409, 'conflict'); }, (rev, pris) => file(pris, rev + 1)], reads: [theirs] });
    const r = await commitPris(f.api, file([P('a', 'A')]), edits.title('a', 'Mine'));
    expect(f.calls[1]).toEqual({ rev: 7, pris: [P('a', 'Mine'), P('z', 'Theirs')] });
    expect(r).toMatchObject({ outcome: 'rebased', file: { rev: 8 } });
  });
  // @req FR:pris-sessions-ui/pris.conflict
  it('gives up with the server list when the edit no longer applies or the retry conflicts too', async () => {
    const gone = file([P('z', 'Theirs')], 7);
    const f1 = fake({ put: [() => { throw fail(409, 'conflict'); }], reads: [gone] });
    expect(await commitPris(f1.api, file([P('a', 'A')]), edits.title('a', 'Mine'))).toEqual({ outcome: 'conflict', file: gone });
    const later = file([P('a', 'Later')], 9);
    const f2 = fake({ put: [() => { throw fail(409, 'conflict'); }, () => { throw fail(409, 'conflict'); }], reads: [file([P('a', 'A')], 8), later] });
    expect(await commitPris(f2.api, file([P('a', 'A')]), edits.title('a', 'Mine'))).toEqual({ outcome: 'conflict', file: later });
  });
  // @req FR:pris-sessions-ui/pris.invalid
  it('keeps the last server list on 400 or a network error, with the message', async () => {
    const base = file([P('a', 'A')]);
    const f1 = fake({ put: [() => { throw fail(400, 'bad_request', 'Validation failed', [{ field: 'pris[0].title', message: 'Too long' }]); }] });
    expect(await commitPris(f1.api, base, edits.title('a', 'B'))).toEqual({ outcome: 'invalid', file: base, message: 'pris[0].title: Too long' });
    const f2 = fake({ put: [() => { throw fail(0, 'network', 'Cannot reach Stack'); }] });
    expect(await commitPris(f2.api, base, edits.title('a', 'B'))).toEqual({ outcome: 'error', file: base, message: 'Cannot reach Stack' });
  });
  it('an edit that does not apply sends nothing', async () => {
    const f = fake({ put: [] });
    expect(await commitPris(f.api, file([P('a', 'A')]), edits.title('zz', 'B'))).toMatchObject({ outcome: 'noop' });
    expect(f.calls).toHaveLength(0);
  });
});
