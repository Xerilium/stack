import { readFileSync, readdirSync, existsSync } from 'fs';
import { parseProject, serializeProject } from '../../src/core/parser';

const sample = `﻿# 💰 Finance

- **Project value:** 💰💰💰 ⚠️⚠️
- **Aliases:** finance

## 🔄 Active

- [ ] 📅 Nov 1: Pay bills 💰 ⬆️
  > note line
  - [x] 📅 Oct 17: 🔄 Monthly: Chase 🔹
  - [ ] Child two
    - [ ] Grandchild
- [x] Done 🟢

## 📋 Backlog

- [ ] Later ⚫️
`;

// @req FR:task-parser/parse.@function
describe('parseProject', () => {
  const p = parseProject(sample);
  // @req FR:task-parser/parse.title @req FR:task-parser/parse.metadata
  it('reads title and metadata', () => {
    expect(p.title).toBe('💰 Finance');
    expect(p.metadata['Project value']).toBe('💰💰💰 ⚠️⚠️');
    expect(p.metadata['Aliases']).toBe('finance');
  });
  // @req FR:task-parser/parse.sections
  it('reads sections', () => {
    expect(p.sections.map(s => s.heading)).toEqual(['🔄 Active', '📋 Backlog']);
  });
  // @req FR:task-parser/parse.tree @req FR:task-parser/task.state @req FR:task-parser/task.notes
  it('builds task tree', () => {
    const [bills, done] = p.sections[0].tasks;
    expect(bills.checked).toBe(false);
    expect(bills.text).toBe('📅 Nov 1: Pay bills 💰 ⬆️');
    expect(bills.notes).toEqual(['> note line']);
    expect(bills.children).toHaveLength(2);
    expect(bills.children[0].checked).toBe(true);
    expect(bills.children[1].children[0].text).toBe('Grandchild');
    expect(done.checked).toBe(true);
  });
  // @req FR:task-parser/roundtrip.exact
  it('round-trips sample exactly', () => {
    expect(serializeProject(p)).toBe(sample);
  });

  // @req FR:task-parser/roundtrip.exact
  it.each<[string, string]>([
    ['CRLF', sample.replace(/\n/g, '\r\n')],
    ['no trailing newline', '# T\n\n## S\n\n- [ ] a'],
    ['mixed CRLF/LF', '# T\r\n\n## S\r\n- [ ] a\n  - [x] b\r\n'],
    ['tabs', '# T\n\n## S\n\n- [ ] a\n\t- [ ] b\n\t\t> note\n'],
    ['empty string', ''],
    ['BOM only', '\uFEFF'],
    ['unknown lines', '# T\n\n## S\n\n### sub\nprose here\n* [ ] star\n- [ ] ok\n'],
    ['blockquote notes', '# T\n\n## S\n\n- [ ] a\n  > note\n  > more\n'],
    ['weekly row', '# T\n\n## S\n\n- [ ] 🔄 Weekly: 📅 Mondays: Review 🔹\n'],
  ])('round-trips %s', (_n, src) => {
    expect(serializeProject(parseProject(src))).toBe(src);
  });

  // @req FR:task-parser/task.notes
  it('attaches blockquote notes to the owning task', () => {
    const q = parseProject('# T\n\n## S\n\n- [ ] a\n  > n1\n  - [ ] b\n    > n2\n');
    const a = q.sections[0].tasks[0];
    expect(a.notes).toEqual(['> n1']);
    expect(a.children[0].notes).toEqual(['> n2']);
  });

  // @req FR:task-parser/parse.tree.tabs
  it('counts a tab as 4 columns for depth', () => {
    const q = parseProject('# T\n\n## S\n\n- [ ] a\n\t- [ ] b\n    - [ ] c\n');
    const a = q.sections[0].tasks[0];
    expect(a.children.map(c => c.text)).toEqual(['b', 'c']);
    expect(a.children[0].depth).toBe(4);
  });

  // @req FR:task-parser/parse.tree.orphan
  it('ignores tasks before the first section but preserves them', () => {
    const src = '# T\n- [ ] orphan\n\n## S\n- [ ] a\n';
    const q = parseProject(src);
    expect(q.sections[0].tasks.map(t => t.text)).toEqual(['a']);
    expect(serializeProject(q)).toBe(src);
  });

  // @req FR:task-parser/mutate.set-checked
  it('setChecked edits one line', () => {
    const q = parseProject(sample);
    q.setChecked(q.sections[0].tasks[0], true);
    const out = serializeProject(q).split('\n');
    const orig = sample.split('\n');
    expect(out.filter((l, i) => l !== orig[i])).toEqual(['- [x] 📅 Nov 1: Pay bills 💰 ⬆️']);
  });

  // @req FR:task-parser/mutate.set-checked
  it('setChecked preserves CRLF', () => {
    const src = '# T\r\n\r\n## S\r\n- [ ] a\r\n- [ ] b\r\n';
    const q = parseProject(src);
    q.setChecked(q.sections[0].tasks[1], true);
    expect(serializeProject(q)).toBe('# T\r\n\r\n## S\r\n- [ ] a\r\n- [x] b\r\n');
  });

  // @req FR:task-parser/mutate.set-checked
  it('setChecked on nested child touches only that line, and can uncheck', () => {
    const q = parseProject(sample);
    const child = q.sections[0].tasks[0].children[1].children[0];
    q.setChecked(child, true);
    const out = serializeProject(q).split('\n');
    const orig = sample.split('\n');
    expect(out.filter((l, i) => l !== orig[i])).toEqual(['    - [x] Grandchild']);
    q.setChecked(child, false);
    expect(serializeProject(q)).toBe(sample);
  });
});

// @req FR:task-parser/roundtrip.exact
const legacyDir = process.env.STACK_LEGACY_DIR;
const legacy = legacyDir && existsSync(legacyDir) ? describe : describe.skip;
if (legacy === describe.skip) {
  console.warn('SKIPPED legacy round-trip tests: set STACK_LEGACY_DIR to a folder of .md files');
}
legacy('legacy files (STACK_LEGACY_DIR)', () => {
  it('round-trips every .md file', () => {
    for (const f of readdirSync(legacyDir!).filter(f => f.endsWith('.md'))) {
      const s = readFileSync(`${legacyDir}/${f}`, 'utf8');
      expect(serializeProject(parseProject(s))).toBe(s);
    }
  });
});
