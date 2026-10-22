import * as fs from 'fs';
import * as path from 'path';
import { parseConfig } from '../../src/core/config';
import { Dec, formatNumber, generateSummaries, netSort, roundHalfEven } from '../../src/core/summaries';

const config = parseConfig();
const at = new Date('2026-10-21T17:00:00Z'); // Wed 10:00 PDT, Work

const gen = (files: Record<string, string>, extra: { now?: Date; previousReadme?: string; previousProjects?: string } = {}) =>
  generateSummaries({
    projects: Object.entries(files).map(([fileName, content]) => ({ fileName, content })),
    config, now: extra.now ?? at, previousReadme: extra.previousReadme, previousProjects: extra.previousProjects,
  });

// @req FR:summaries/format.number

describe('formatNumber', () => {
  it.each([
    [0, '0'], [5, '5'], [-2, '-2'], [16.2, '16.2'], [0.1 + 0.2, '0.3'], [1 / 3, '0.333333333333333'],
    [101.42105263157895, '101.421052631579'], [123456789012345, '123456789012345'], [1e15, '1E+15'], [1.5e20, '1.5E+20'],
    [0.00001, '0.00001'], [0.000001, '1E-06'], [-0.5, '-0.5'],
  ])('%p -> %s', (n, s) => expect(formatNumber(n)).toBe(s));

  it('prints negative zero and non-finite values like .NET', () => {
    expect(formatNumber(-0)).toBe('-0');
    expect(formatNumber(NaN)).toBe('NaN');
    expect(formatNumber(Infinity)).toBe('Infinity');
    expect(formatNumber(-Infinity)).toBe('-Infinity');
  });
});

// @req FR:summaries/format.round

describe('roundHalfEven', () => {
  it.each([[0.25, 0.2], [0.35, 0.4], [0.45, 0.4], [2.5, 2.5], [1.04, 1], [1.06, 1.1], [-0.25, -0.2]])('Round(%p, 1) = %p', (n, r) => {
    expect(roundHalfEven(n, 1)).toBeCloseTo(r, 10);
  });
  it('rounds exact halves to even', () => {
    expect(roundHalfEven(0.5, 0)).toBe(0);
    expect(roundHalfEven(1.5, 0)).toBe(2);
    expect(roundHalfEven(2.5, 0)).toBe(2);
  });
});

describe('Dec (.NET decimal subset)', () => {
  it('converts doubles at 15 significant digits', () => {
    expect(Dec.fromDouble(0.1 + 0.2).toString()).toBe('0.3');
    expect(Dec.fromDouble(1.9000000000000001).toString()).toBe('1.9');
    expect(Dec.fromDouble(100).toString()).toBe('100');
    expect(Dec.fromDouble(-2.5).toString()).toBe('-2.5');
  });
  it('divides to 28 digits with trailing zeros removed', () => {
    expect(Dec.fromDouble(192.7).div(Dec.fromDouble(1.9)).toString()).toBe('101.42105263157894736842105263');
    expect(Dec.fromDouble(222.8).div(Dec.fromDouble(0.4)).toString()).toBe('557');
    expect(Dec.fromDouble(1).div(Dec.fromDouble(3)).toString()).toBe('0.3333333333333333333333333333');
    expect(Dec.fromDouble(41.2).div(Dec.fromDouble(4.7)).toString()).toBe('8.765957446808510638297872340'.replace(/0+$/, ''));
  });
  it('adds across scales', () => {
    expect(Dec.fromDouble(10).add(Dec.fromDouble(0.25)).toString()).toBe('10.25');
  });
});

// @req FR:summaries/format.sort

describe('netSort', () => {
  const golden = JSON.parse(fs.readFileSync(path.join(__dirname, '../fixtures/summaries-sort.json'), 'utf8')) as { n: number; scores: number[]; ids: number[] }[];
  for (const g of golden) {
    it(`orders ${g.n} items with ties like PowerShell Sort-Object -Descending`, () => {
      const items = g.scores.map((score, id) => ({ id, score }));
      const out = netSort(items, (a, b) => (a.score < b.score ? 1 : a.score > b.score ? -1 : 0)).map(x => x.id);
      expect(out).toEqual(g.ids);
    });
  }
  it('does not mutate its input', () => {
    const input = [3, 1, 2];
    netSort(input, (a, b) => a - b);
    expect(input).toEqual([3, 1, 2]);
  });
});

describe('generateSummaries', () => {
  const alpha = '# 🟣 Alpha\n\n- **Work capacity:** 2h\n\n## 🔄 Active\n\n- [ ] 🚨 Fix it 🟢\n- [ ] Outcome 🎯\n  - [ ] Child ⛔️ 🟢\n';

  // @req FR:summaries/generate.output

  it('writes a BOM on three files, none on my-day, one trailing newline', () => {
    const out = gen({ 'alpha.md': alpha });
    for (const text of [out.readme, out.stack, out.projects]) expect(text.startsWith('﻿# ')).toBe(true);
    expect(out.myDay!.startsWith('# 📆 My day')).toBe(true);
    for (const text of [out.readme, out.stack, out.projects, out.myDay!]) expect(text).toMatch(/[^\n]\n$/);
  });

  // @req FR:summaries/generate.pure

  it('is deterministic for the same input', () => {
    expect(gen({ 'alpha.md': alpha })).toEqual(gen({ 'alpha.md': alpha }));
  });

  // @req FR:summaries/generate.load

  it('ignores a leading BOM and input order of files', () => {
    const a = gen({ 'a.md': '﻿# A\n\n## 🔄 Active\n\n- [ ] one 🟡\n', 'b.md': '# B\n\n## 🔄 Active\n\n- [ ] two 🟡\n' });
    const b = gen({ 'b.md': '# B\n\n## 🔄 Active\n\n- [ ] two 🟡\n', 'a.md': '# A\n\n## 🔄 Active\n\n- [ ] one 🟡\n' });
    expect(a).toEqual(b);
  });

  // @req FR:summaries/generate.load

  it('names a project from its file when there is no H1 and splits the emoji', () => {
    const out = gen({ 'my-proj.md': 'no heading\n\n## 🔄 Active\n\n- [ ] task 🟡\n', 'e.md': '# 🟣 Emoji name\n\n## 🔄 Active\n\n- [ ] t2 🟡\n' });
    expect(out.stack).toContain('- [my proj](./tasks/my-proj.md)');
    expect(out.stack).toContain('- 🟣 [Emoji name](./tasks/e.md)');
  });

  // @req FR:summaries/generate.load

  it('keeps project order from the previous projects.md on ties', () => {
    const files = { 'a.md': '# A\n\n## 🔄 Active\n\n- [ ] one 🟡\n', 'b.md': '# B\n\n## 🔄 Active\n\n- [ ] two 🟡\n' };
    const order = (text: string) => [...text.matchAll(/^## \[(\w)\]/gm)].map(m => m[1]);
    expect(order(gen(files).projects)).toEqual(['A', 'B']);
    expect(order(gen(files, { previousProjects: '## [B](./tasks/b.md)\n## [A](./tasks/a.md)\n' }).projects)).toEqual(['B', 'A']);
  });

  // @req FR:summaries/generate.parse

  it('only reads unchecked tasks of the Active section with their notes', () => {
    const out = gen({
      'p.md': '# P\n\n## 🔄 Active\n\n- [ ] shown 🟡\n  > a quote\n  - a list item\n- [x] done\n\n## 📋 Backlog\n\n- [ ] hidden\n',
    });
    expect(out.stack).toContain('    > a quote');
    expect(out.stack).toContain('    - a list item');
    expect(out.stack).not.toContain('hidden');
    expect(out.stack).not.toContain('done');
  });

  it('counts an only active leaf as 16 (the key count of a lone legacy hashtable)', () => {
    const out = gen({ 'p.md': '# P\n\n## 🔄 Active\n\n- [ ] one 🟡\n' });
    expect(out.stack).toContain('- 📄 16 leaf node tasks');
  });

  // @req FR:summaries/generate.output

  it('returns no my-day when there are no tasks', () => {
    const out = gen({ 'p.md': '# P\n\n## 🔄 Active\n' });
    expect(out.myDay).toBeNull();
    expect(out.readme).toContain('No active tasks available');
    expect(out.readme).toContain('🎉 Congrats! There are no tasks on hold!');
  });

  // @req FR:summaries/readme.banner

  it('shows the banner in the configured zone with active blocks', () => {
    const out = gen({ 'alpha.md': alpha });
    expect(out.readme).toContain('- 🕒 **Wednesday 10:00 AM**\n- 📆 **Work** time\n- 🚨 **1 urgent** task');
  });

  // @req FR:summaries/readme.footer

  it('keeps the README footer from the previous README', () => {
    const out = gen({ 'alpha.md': alpha }, { previousReadme: '# old\n\n---\n\n<br>\n\nKeep me<br>\n' });
    expect(out.readme.endsWith('---\n\n<br>\n\nKeep me\n\n<br>\n')).toBe(true);
  });

  // @req FR:summaries/readme.parking

  it('lists parked tasks in the parking lot', () => {
    const out = gen({ 'p.md': '# P\n\n## 🔄 Active\n\n- [ ] 🅿️ later 🟡\n- [ ] now 🟡\n' });
    expect(out.readme).toContain('## 🅿️ Parking lot\n\n- later 🟡 🟰 ');
  });

  // @req FR:summaries/projects.kpi

  it('reports over capacity in projects.md', () => {
    const out = gen({ 'p.md': '# P\n\n- **Weekly capacity:** 1\n\n## 🔄 Active\n\n- [ ] a 🔴\n' });
    expect(out.projects).toContain('- 🚨 1 projects over capacity (3h total)');
    expect(out.projects).toContain('🚨 Project is over capacity by 3 hours');
  });

  // @req FR:summaries/myday.capacity

  it('assigns tasks within block capacity once', () => {
    const out = gen({
      'p.md': '# P\n\n- **Work capacity:** 1h\n- **Family evening capacity:** 1h\n\n## 🔄 Active\n\n- [ ] a 🟡\n- [ ] b 🟡\n- [ ] c 🟡\n',
    }, { now: new Date('2026-10-21T15:30:00Z') });
    expect(out.myDay).toContain('> - 🗂️ **P** = 1 / 1 hours');
    const shown = (out.myDay!.match(/\n {4}- [abc] /g) ?? []).length + (out.myDay!.match(/^ {2}- [abc] /gm) ?? []).length;
    expect(shown).toBeGreaterThanOrEqual(1);
  });

  // @req FR:summaries/myday.top

  it('puts the best active-block task on top and not in the block list', () => {
    const out = gen({ 'p.md': '# P\n\n- **Work capacity:** 4h\n\n## 🔄 Active\n\n- [ ] best ‼️ 🟢\n- [ ] other 🟢\n- [ ] third 🟢\n' });
    const [top, rest] = out.myDay!.split('## ☀️ Work time');
    expect(top).toContain('best');
    expect(rest).not.toContain('best');
    expect(rest).toContain('other');
  });
});
