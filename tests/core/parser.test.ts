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

describe('parseProject', () => {
  const p = parseProject(sample);
  it('reads title and metadata', () => {
    expect(p.title).toBe('💰 Finance');
    expect(p.metadata['Project value']).toBe('💰💰💰 ⚠️⚠️');
    expect(p.metadata['Aliases']).toBe('finance');
  });
  it('reads sections', () => {
    expect(p.sections.map(s => s.heading)).toEqual(['🔄 Active', '📋 Backlog']);
  });
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
  it('round-trips exactly', () => {
    expect(serializeProject(p)).toBe(sample);
    const crlf = sample.replace(/\n/g, '\r\n');
    expect(serializeProject(parseProject(crlf))).toBe(crlf);
  });
  it('setChecked edits one line', () => {
    const q = parseProject(sample);
    q.setChecked(q.sections[0].tasks[0], true);
    const out = serializeProject(q).split('\n');
    const orig = sample.split('\n');
    expect(out.filter((l, i) => l !== orig[i])).toEqual(['- [x] 📅 Nov 1: Pay bills 💰 ⬆️']);
  });
  it('round-trips real legacy files when present', () => {
    const dir = `${process.env.HOME}/dev/todo/tasks`;
    if (!existsSync(dir)) return;
    for (const f of readdirSync(dir).filter(f => f.endsWith('.md'))) {
      const s = readFileSync(`${dir}/${f}`, 'utf8');
      expect(serializeProject(parseProject(s))).toBe(s);
    }
  });
});
