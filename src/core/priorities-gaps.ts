/**
 * The gap list for the Chief of Staff: each priority with no tiered task, in `<home>/gaps.json`. The CoS reads the file
 * and adds the tasks. Stack never sends a message for a gap.
 * @req FR:priorities-tables/gaps.@function @req FR:priorities-tables/gaps.silent
 */
import { mkdirSync } from 'fs';
import { join } from 'path';
import { readJsonFile, writeAtomic } from './file-lock';
import type { PrioritiesView, PriRow } from './priorities-view';

export type GapSection = 'qm' | 'now' | 'today' | 'next';
/** One gap: the priority, its project file, the CoS who must add the task, and what the report says. */
export interface Gap { id: string; project: string; file: string | null; cos: string; section: GapSection; action: string }
/** `at`: when the list last changed. */
export interface GapsFile { version: 1; at: string; gaps: Gap[] }

/** Each gap row of QM, Now, Today and Next 3 days, in that order. @req FR:priorities-tables/gaps.list */
export function gapsOf(v: PrioritiesView): Gap[] {
  const of = (section: GapSection, rows: PriRow[]): Gap[] => rows.filter((r) => r.gap).map((r) => ({ id: r.id, project: r.project, file: r.file, cos: r.cos?.name ?? 'CoS', section, action: r.action }));
  return [...of('qm', v.qm?.rows ?? []), ...of('now', v.now.rows), ...of('today', v.today.rows), ...of('next', v.next.rows)];
}

/**
 * Writes `<dir>/gaps.json` when the gap list changed; true when it wrote. Never throws: a failed write must not fail the report.
 * @req FR:priorities-tables/gaps.file @req FR:priorities-tables/gaps.file.change @req FR:priorities-tables/gaps.file.safe
 */
export function writeGaps(dir: string, v: PrioritiesView): boolean {
  try {
    const file = join(dir, 'gaps.json');
    const gaps = gapsOf(v);
    let old: unknown;
    try { old = (readJsonFile(file) as Partial<GapsFile>).gaps; } catch { old = undefined; }
    if (JSON.stringify(old) === JSON.stringify(gaps)) return false;
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeAtomic(file, `${JSON.stringify({ version: 1, at: v.at, gaps } satisfies GapsFile, null, 2)}\n`);
    return true;
  } catch { return false; }
}
