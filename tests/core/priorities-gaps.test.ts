import { mkdtempSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { gapsOf, writeGaps } from '../../src/core/priorities-gaps';
import type { PrioritiesView, PriRow } from '../../src/core/priorities-view';

const AT = '2026-11-18T19:00:00.000Z';
const row = (id: string, gap: boolean, o: Partial<PriRow> = {}): PriRow => ({ id, project: id.toUpperCase(), file: `tasks/${id}.md`, agent: null, more: 0, status: null, action: gap ? `CoS will add a task today: ⭐️ in tasks/${id}.md with (agent: ...)` : 'Ship', gap, cos: gap ? { name: 'Xe CoS', link: null, file: null, session: null } : null, ref: null, at: AT, stale: false, ...o });
const table = (rows: PriRow[]) => ({ at: AT, stale: false, rows });
const view = (o: Partial<PrioritiesView> = {}): PrioritiesView => ({ at: AT, qm: null, now: table([]), prs: { at: AT, stale: false, verified: true, manager: null, rows: [] }, today: table([]), next: table([]), ...o });
const entry = (id: string, section: string) => ({ id, project: id.toUpperCase(), file: `tasks/${id}.md`, cos: 'Xe CoS', section, action: row(id, true).action });

describe('gaps for the CoS', () => {
  // @req FR:priorities-tables/gaps.@function @req FR:priorities-tables/gaps.list
  it('lists each gap row of QM, Now, Today and Next 3 days, in that order; never a row with a task', () => {
    const v = view({ qm: { ...table([row('q', true)]), title: 'QM', today: true }, now: table([row('a', false), row('b', true)]), today: table([row('c', true, { file: null })]), next: table([row('d', true)]) });
    expect(gapsOf(v)).toEqual([entry('q', 'qm'), entry('b', 'now'), { ...entry('c', 'today'), file: null }, entry('d', 'next')]);
    expect(gapsOf(view({ now: table([row('a', false)]) }))).toEqual([]);
  });

  // @req FR:priorities-tables/gaps.file @req FR:priorities-tables/gaps.file.change @req FR:priorities-tables/gaps.file.safe
  it('writes gaps.json only when the list changes, makes the folder, and never throws', () => {
    const dir = join(mkdtempSync(join(tmpdir(), 'stack-gaps-')), 'home');
    const file = join(dir, 'gaps.json');
    const v = view({ now: table([row('b', true)]) });
    expect(writeGaps(dir, v)).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 1, at: AT, gaps: [entry('b', 'now')] });
    expect(writeGaps(dir, { ...v, at: '2026-11-18T20:00:00.000Z' })).toBe(false);
    expect(JSON.parse(readFileSync(file, 'utf8')).at).toBe(AT);
    expect(writeGaps(dir, view({ at: '2026-11-18T21:00:00.000Z' }))).toBe(true);
    expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({ version: 1, at: '2026-11-18T21:00:00.000Z', gaps: [] });
    // A broken file is replaced. A folder that cannot be made does not fail the report.
    writeFileSync(file, '{');
    expect(writeGaps(dir, v)).toBe(true);
    const blocked = join(file, 'under-a-file');
    expect(() => writeGaps(blocked, v)).not.toThrow();
    expect(writeGaps(blocked, v)).toBe(false);
  });
});
