import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { parsePris, parsePrisMarkdown, PrisConflict, PrisInvalid, PriStore } from '../../src/core/pris';

const NOW = new Date('2026-11-11T18:00:00Z');
const SEED = `# Known priorities

Rule: only these.

1. Quota-maxxing (window ends Thu 10am PT): 1.1 FH+Catalyst PR quality pass (security, reliability); 1.2 Stack v2; 1.3 anything below.
2. Autopilot PR progress: scheduled SM nags; escalations as ONE task per set: top 3 (with context), top 1 PR (quick + high pri). Prep next set while he reviews. No escalations = fail.
3. Allyte marketplace (+ is sign-in required? work around limits).
4. FH 0.11: marketplace, FH backend, maybe 1 extensibility step (extensions, e.g. hub.allyte.com).
7. Personal: Clyde's patch, Clyde's Xbox gift card.
8. Stack v2 as central tracker/hub for this list; backlog items tracked, progressed weekly.
1. Duplicate number in a later list.
9. Catalyst 0.3.4 / 0.4: status, target, accelerate with quality (no PR clean; predict corrections).

Next evolution: not a priority.
`;

const pri = (o: Record<string, unknown> = {}) => ({ id: 'p1', title: 'One', status: 'active', items: [], backlog: [], weekly: [], ...o });

// @req FR:session-inventory/pris.seed
it('parsePrisMarkdown reads numbered lines into priorities', () => {
  const p = parsePrisMarkdown(SEED);
  expect(p.map((x) => x.id)).toEqual(['p1', 'p2', 'p3', 'p4', 'p7', 'p8', 'p9']);
  expect(p[0]).toEqual({
    id: 'p1', title: 'Quota-maxxing (window ends Thu 10am PT)', status: 'active', backlog: [], weekly: [],
    items: [{ text: 'FH+Catalyst PR quality pass (security, reliability)', status: 'todo' }, { text: 'Stack v2', status: 'todo' }, { text: 'anything below', status: 'todo' }],
  });
  expect(p[1].items.map((i) => i.text)).toEqual(['scheduled SM nags', 'escalations as ONE task per set: top 3 (with context), top 1 PR (quick + high pri)', 'Prep next set while he reviews', 'No escalations = fail']);
  expect(p[2]).toMatchObject({ title: 'Allyte marketplace (+ is sign-in required? work around limits)', items: [] });
  expect(p[3].items.map((i) => i.text)).toEqual(['marketplace', 'FH backend', 'maybe 1 extensibility step (extensions, e.g. hub.allyte.com)']);
  expect(p[4].items.map((i) => i.text)).toEqual(["Clyde's patch", "Clyde's Xbox gift card"]);
  expect(p[5]).toMatchObject({ title: 'Stack v2 as central tracker/hub for this list', items: [{ text: 'backlog items tracked, progressed weekly', status: 'todo' }] });
  expect(p[6].items.map((i) => i.text)).toEqual(['status', 'target', 'accelerate with quality (no PR clean; predict corrections)']);
  expect(() => parsePris(p)).not.toThrow();
});

// @req FR:session-inventory/pris.model @req FR:session-inventory/pris.validate @req FR:session-inventory/$pri
describe('parsePris', () => {
  it('accepts a valid list with items, backlog and weekly progress', () => {
    const list = [pri({ items: [{ text: 'a', status: 'doing' }], backlog: [{ text: 'b', status: 'todo' }], weekly: [{ week: '2026-W46', text: 'Shipped chunk 2' }] }), pri({ id: 'p2', status: 'paused' })];
    expect(parsePris(list)).toEqual(list);
  });
  it('lists every issue at once', () => {
    try {
      parsePris([pri({ id: 'Bad', extra: 1, status: 'nope', title: 'a\nb', items: [{ text: '', status: 'x', more: 1 }], weekly: [{ week: '2026-46', text: 'x' }] }), pri({ id: 'p1' }), pri({ id: 'p1' })]);
      throw new Error('no throw');
    } catch (e) {
      expect(e).toBeInstanceOf(PrisInvalid);
      expect((e as PrisInvalid).issues.map((i) => i.field)).toEqual(expect.arrayContaining([
        '[0].id', '[0].extra', '[0].status', '[0].title', '[0].items[0].text', '[0].items[0].status', '[0].items[0].more', '[0].weekly[0].week', '[2].id',
      ]));
    }
  });
  it('needs weekly progress newest first, one per week', () => {
    expect(() => parsePris([pri({ weekly: [{ week: '2026-W45', text: 'a' }, { week: '2026-W46', text: 'b' }] })])).toThrow(PrisInvalid);
    expect(() => parsePris([pri({ weekly: [{ week: '2026-W46', text: 'a' }, { week: '2026-W46', text: 'b' }] })])).toThrow(PrisInvalid);
    expect(() => parsePris([pri({ weekly: [{ week: '2026-W54', text: 'a' }] })])).toThrow(PrisInvalid);
  });
  it('rejects a non-array and too many items', () => {
    expect(() => parsePris({})).toThrow(PrisInvalid);
    expect(() => parsePris(Array.from({ length: 31 }, (_, i) => pri({ id: `p${i}` })))).toThrow(PrisInvalid);
    expect(() => parsePris([pri({ items: Array.from({ length: 21 }, () => ({ text: 'a', status: 'todo' })) })])).toThrow(PrisInvalid);
    expect(() => parsePris([pri({ title: 'x'.repeat(201) })])).toThrow(PrisInvalid);
  });
});

describe('PriStore', () => {
  const store = () => { const dir = mkdtempSync(join(tmpdir(), 'stack-pris-')); return { dir, s: new PriStore(dir, { now: () => NOW }) }; };

  // @req FR:session-inventory/pris.seed.once
  it('seeds once from markdown; a second seed changes nothing', async () => {
    const { dir, s } = store();
    const md = join(dir, 'daily-pris.md'); writeFileSync(md, SEED);
    expect(s.read()).toEqual({ version: 1, rev: 0, pris: [] });
    const r = await s.seed(md);
    expect(r).toMatchObject({ seeded: true, count: 7 });
    const f = s.read();
    expect(f).toMatchObject({ version: 1, rev: 1, updatedAt: NOW.toISOString(), seed: { source: md, at: NOW.toISOString() } });
    expect(f.seed!.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(statSync(join(dir, 'pris.json')).mode & 0o777).toBe(0o600);
    const before = readFileSync(join(dir, 'pris.json'), 'utf8');
    expect(await s.seed(md)).toEqual({ seeded: false, count: 7 });
    expect(readFileSync(join(dir, 'pris.json'), 'utf8')).toBe(before);
  });

  // @req FR:session-inventory/pris.write
  it('put replaces the list, bumps rev, rejects a stale rev and an invalid list', async () => {
    const { dir, s } = store();
    const r1 = await s.put(0, [pri()]);
    expect(r1).toMatchObject({ rev: 1, pris: [pri()] });
    const r2 = await s.put(1, [pri({ weekly: [{ week: '2026-W46', text: 'Done' }] })]);
    expect(r2.rev).toBe(2);
    await expect(s.put(1, [pri()])).rejects.toBeInstanceOf(PrisConflict);
    await expect(s.put(2, [pri({ id: 'X' })])).rejects.toBeInstanceOf(PrisInvalid);
    expect(s.read().rev).toBe(2);
    expect(existsSync(join(dir, 'pris.lock'))).toBe(false);
  });

  // @req FR:session-inventory/pris.broken
  it('a broken file reads as none, is never seeded over, and a write moves it aside', async () => {
    const { dir, s } = store();
    writeFileSync(join(dir, 'pris.json'), '{bad');
    expect(s.read()).toEqual({ version: 1, rev: 0, pris: [] });
    const md = join(dir, 'x.md'); writeFileSync(md, SEED);
    expect(await s.seed(md)).toEqual({ seeded: false, count: 0 });
    expect((await s.put(0, [pri()])).rev).toBe(1);
    const aside = readdirSync(dir).filter((n) => n.startsWith('pris.json.broken-'));
    expect(aside).toHaveLength(1);
    expect(readFileSync(join(dir, aside[0]), 'utf8')).toBe('{bad');
    // a hand edit that fails the schema or has a fractional rev is broken too
    writeFileSync(join(dir, 'pris.json'), JSON.stringify({ version: 1, rev: 3, pris: [{ id: 'p1', title: 'x' }] }));
    expect(s.read()).toEqual({ version: 1, rev: 0, pris: [] });
    writeFileSync(join(dir, 'pris.json'), JSON.stringify({ version: 1, rev: 1.5, pris: [] }));
    expect(s.read().rev).toBe(0);
  });
});
